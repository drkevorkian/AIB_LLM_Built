import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { ZodError } from 'zod';
import {
  controlSchema,
  retrySchema,
  idSchema,
  connectionTestSchema,
  stopDiscussionSchema,
  agentLabel,
  bulkWorkspaceTokenSchema,
  workspaceInstructionHistory,
} from '../shared/contracts.js';
import type { ConversationEngine } from './engine.js';
import { AppError } from './errors.js';
import { applicationVersion } from '../shared/version.js';
import {
  messageInstructionProvenance,
  instructionProvenanceLabel,
  instructionProvenanceDetails,
} from '../shared/instruction-provenance.js';

export interface HttpOptions {
  port: number;
  clientDir: string;
  dev?: boolean;
}
type ViteServer = Awaited<ReturnType<(typeof import('vite'))['createServer']>>;

export async function serve(engine: ConversationEngine, options: HttpOptions) {
  const token = randomBytes(32).toString('hex');
  const clients = new Set<ServerResponse>();
  let vite: ViteServer | null = null;
  let port = options.port;
  const origins = () => [`http://127.0.0.1:${port}`, `http://localhost:${port}`];

  function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  }

  function secure(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      options.dev
        ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        : "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (!origins().some((origin) => new URL(origin).host === req.headers.host))
      throw new AppError(403, 'Unrecognized local host.');
    if (req.headers.origin && !origins().includes(req.headers.origin))
      throw new AppError(403, 'Origin is not allowed.');
    if (req.headers['sec-fetch-site'] === 'cross-site')
      throw new AppError(403, 'Cross-site requests are not allowed.');
  }

  function authenticate(req: IncomingMessage) {
    const supplied = req.headers['x-aib-token'];
    if (
      typeof supplied !== 'string' ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
    )
      throw new AppError(401, 'Local session token is missing or invalid.');
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof ZodError) {
        json(res, 400, {
          error: 'Invalid command.',
          details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      } else if (error instanceof AppError) {
        json(res, error.status, { error: error.message });
      } else {
        console.error('Request failed:', error instanceof Error ? error.name : 'Unknown error');
        json(res, 500, { error: 'The application could not complete this request.' });
      }
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;

  if (options.dev) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server },
        fs: { allow: [resolve('.')], deny: ['.env', '.env.*', '**/.git/**', '**/*.sqlite*'] },
      },
      appType: 'custom',
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    secure(req, res);
    const url = new URL(req.url ?? '/', origins()[0]);
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'GET' && url.pathname === '/api/session') {
        json(res, 200, {
          token,
          version: applicationVersion,
          transport: 'configured',
          continuesWithoutClient: true,
        });
        return;
      }
      authenticate(req);
      if (url.pathname === '/api/settings' && req.method === 'GET') {
        json(res, 200, engine.settings());
        return;
      }
      if (url.pathname === '/api/settings' && req.method === 'PUT') {
        json(res, 200, engine.saveSettings(await body(req)));
        return;
      }
      if (url.pathname === '/api/settings/provider-limits') {
        if (req.method !== 'PUT') throw new AppError(405, 'Method not allowed.');
        json(
          res,
          200,
          engine.saveProviderConcurrency(
            (await body(req)) as Parameters<typeof engine.saveProviderConcurrency>[0],
          ),
        );
        return;
      }
      if (url.pathname === '/api/providers' && req.method === 'GET') {
        json(res, 200, engine.connections());
        return;
      }
      const providerMatch = /^\/api\/providers\/([a-z-]+)\/models$/.exec(url.pathname);
      if (providerMatch && req.method === 'GET') {
        json(
          res,
          200,
          await engine.models(providerMatch[1]!, url.searchParams.get('baseUrl') ?? ''),
        );
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        if (clients.size >= 10) throw new AppError(429, 'Too many active views.');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('data: {"ready":true}\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname === '/api/rooms' && req.method === 'GET') {
        json(res, 200, engine.store.list());
        return;
      }
      if (url.pathname === '/api/rooms' && req.method === 'POST') {
        json(
          res,
          201,
          engine.createRoom((await body(req)) as Parameters<typeof engine.createRoom>[0]),
        );
        return;
      }
      if (url.pathname === '/api/workspaces/bulk/preview') {
        if (req.method !== 'POST') throw new AppError(405, 'Method not supported.');
        json(
          res,
          200,
          engine.previewWorkspaces(
            (await body(req)) as Parameters<typeof engine.previewWorkspaces>[0],
          ),
        );
        return;
      }
      if (url.pathname === '/api/workspaces/bulk/confirm') {
        if (req.method !== 'POST') throw new AppError(405, 'Method not supported.');
        json(res, 200, engine.confirmWorkspaces(bulkWorkspaceTokenSchema.parse(await body(req))));
        return;
      }
      if (url.pathname === '/api/workspaces/bulk/preview-cancel') {
        if (req.method !== 'POST') throw new AppError(405, 'Method not supported.');
        engine.cancelWorkspacePreview(bulkWorkspaceTokenSchema.parse(await body(req)));
        json(res, 200, { ok: true });
        return;
      }
      const threadMatch = /^\/api\/rooms\/([a-zA-Z0-9_-]+)\/threads\/([a-zA-Z0-9_-]+)$/.exec(
        url.pathname,
      );
      if (threadMatch) {
        const roomId = idSchema.parse(threadMatch[1]);
        const threadId = idSchema.parse(threadMatch[2]);
        if (req.method === 'DELETE') {
          json(res, 200, engine.deleteThread(roomId, threadId));
          return;
        }
        if (req.method === 'PUT') {
          json(
            res,
            200,
            engine.renameThread(
              roomId,
              threadId,
              (await body(req)) as Parameters<typeof engine.renameThread>[2],
            ),
          );
          return;
        }
        throw new AppError(405, 'Method not supported.');
      }
      const participantMatch =
        /^\/api\/rooms\/([a-zA-Z0-9_-]+)\/participants(?:\/([a-zA-Z0-9_-]+))?$/.exec(url.pathname);
      if (participantMatch) {
        const roomId = idSchema.parse(participantMatch[1]);
        if (!participantMatch[2] && req.method === 'POST') {
          engine.addAgent(roomId, (await body(req)) as Parameters<typeof engine.addAgent>[1]);
          json(res, 201, engine.store.get(roomId));
          return;
        }
        if (participantMatch[2] && req.method === 'PUT') {
          engine.setAgentActive(
            roomId,
            idSchema.parse(participantMatch[2]),
            (await body(req)) as Parameters<typeof engine.setAgentActive>[2],
          );
          json(res, 200, engine.store.get(roomId));
          return;
        }
        if (participantMatch[2] && req.method === 'DELETE') {
          json(
            res,
            200,
            engine.removeAgent(
              roomId,
              idSchema.parse(participantMatch[2]),
              (await body(req)) as Parameters<typeof engine.removeAgent>[2],
            ),
          );
          return;
        }
        throw new AppError(405, 'Method not supported.');
      }
      const summarySource =
        /^\/api\/rooms\/([a-zA-Z0-9_-]+)\/context-summaries\/([a-zA-Z0-9_-]+)\/sources\/([a-zA-Z0-9_-]+)$/.exec(
          url.pathname,
        );
      if (summarySource) {
        if (req.method !== 'GET') throw new AppError(405, 'Method not supported.');
        json(
          res,
          200,
          engine.contextSummarySource(summarySource[1]!, summarySource[2]!, summarySource[3]!),
        );
        return;
      }
      const match =
        /^\/api\/rooms\/([a-zA-Z0-9_-]+)(?:\/(messages|control|retry|updated-synthesis|context-summaries|export|agents|connection-test|discussion-stop|settings|archive|activity))?$/.exec(
          url.pathname,
        );
      if (!match) throw new AppError(404, 'Endpoint not found.');
      const roomId = idSchema.parse(match[1]);
      if (match[2] === 'context-summaries' && req.method === 'POST') {
        json(
          res,
          201,
          engine.createContextSummary(
            roomId,
            (await body(req)) as Parameters<typeof engine.createContextSummary>[1],
          ),
        );
        return;
      }
      if (match[2] === 'activity' && req.method === 'GET') {
        json(res, 200, engine.activity(roomId));
        return;
      }
      if (!match[2] && req.method === 'DELETE') {
        engine.deleteRoom(roomId);
        json(res, 200, { ok: true });
        return;
      }
      if (match[2] === 'archive' && req.method === 'PUT') {
        json(
          res,
          200,
          engine.setWorkspaceArchived(
            roomId,
            (await body(req)) as Parameters<typeof engine.setWorkspaceArchived>[1],
          ),
        );
        return;
      }
      if (match[2] === 'settings' && req.method === 'PUT') {
        engine.configureWorkspace(
          roomId,
          (await body(req)) as Parameters<typeof engine.configureWorkspace>[1],
        );
        json(res, 200, engine.store.get(roomId));
        return;
      }
      if (!match[2] && req.method === 'GET') {
        json(res, 200, engine.store.get(roomId));
        return;
      }
      if (match[2] === 'agents' && req.method === 'POST') {
        engine.configureAgent(
          roomId,
          (await body(req)) as Parameters<typeof engine.configureAgent>[1],
        );
        json(res, 200, { ok: true });
        return;
      }
      if (match[2] === 'connection-test' && req.method === 'POST') {
        const input = connectionTestSchema.parse(await body(req));
        json(res, 200, await engine.testConnection(roomId, input.agentId, input.kind));
        return;
      }
      if (match[2] === 'messages' && req.method === 'POST') {
        json(res, 201, engine.send(roomId, (await body(req)) as Parameters<typeof engine.send>[1]));
        return;
      }
      if (match[2] === 'control' && req.method === 'POST') {
        engine.control(roomId, controlSchema.parse(await body(req)).action);
        json(res, 200, { ok: true });
        return;
      }
      if (match[2] === 'retry' && req.method === 'POST') {
        engine.retry(roomId, retrySchema.parse(await body(req)).jobId);
        json(res, 200, { ok: true });
        return;
      }
      if (match[2] === 'updated-synthesis' && req.method === 'POST') {
        json(
          res,
          201,
          engine.updatedSynthesis(
            roomId,
            (await body(req)) as Parameters<typeof engine.updatedSynthesis>[1],
          ),
        );
        return;
      }
      if (match[2] === 'discussion-stop' && req.method === 'POST') {
        engine.stopDiscussion(roomId, stopDiscussionSchema.parse(await body(req)).discussionId);
        json(res, 200, { ok: true });
        return;
      }
      if (match[2] === 'export' && req.method === 'GET') {
        const room = engine.store.get(roomId);
        res.setHeader('Content-Disposition', `attachment; filename="room-${room.id}.md"`);
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        const parts = [
          `# ${room.title}\n\n${room.objective}\n\n${room.agents.every((a) => a.provider === 'simulated') ? 'Simulation transcript' : 'Conversation transcript'}. All messages are room-visible. Provider labels below describe the frozen invocation settings.\n`,
        ];
        parts.push(
          `\n## Workspace instruction revisions\n\n\`\`\`json\n${JSON.stringify(workspaceInstructionHistory(room), null, 2)}\n\`\`\`\n`,
        );
        if (room.contextSummaries?.length)
          parts.push(
            `\n## Human-reviewed context summaries\n\nOriginal messages below remain authoritative. Summaries retain attributed excerpts, original decision links, disagreement and open-question notes; truncated excerpts are incomplete.\n\n\`\`\`json\n${JSON.stringify(
              room.contextSummaries.map(
                ({ clientId: _id, commandHash: _hash, ...summary }) => summary,
              ),
              null,
              2,
            )}\n\`\`\`\n`,
          );
        if (room.contextCursors?.length)
          parts.push(
            `\n## Locally supplied context cursors\n\nThese records show application-prepared invocation context, not remote receipt or comprehension.\n\n\`\`\`json\n${JSON.stringify(room.contextCursors, null, 2)}\n\`\`\`\n`,
          );
        if (room.archivedAt)
          parts.push(
            `\nWorkspace archived: ${room.archivedAt}. Restore and resume explicitly to run work.\n`,
          );
        for (const discussion of room.discussions)
          parts.push(
            `\nDiscussion: ${discussion.id} · Coordinator: ${discussion.leaderId} · Status: ${discussion.status} · Peer rounds: ${discussion.roundsUsed}/${discussion.maxRounds} · Turns: ${discussion.turnsUsed}/${discussion.maxTurns} · Result: ${discussion.resultMessageId ?? 'none'}${discussion.error ? '\n' + discussion.error : ''}\n`,
          );
        for (const message of room.messages) {
          const name =
            message.authorId === 'human'
              ? 'Human'
              : agentLabel(room, message.authorId, message.snapshotId);
          const snapshot = room.snapshots.find((s) => s.id === message.snapshotId);
          const binding = snapshot?.agents.find((a) => a.id === message.authorId);
          const instructions = snapshot
            ? `\n\nWorkspace instructions: ${snapshot.instructionRevision === undefined ? 'legacy revision unknown' : `revision ${snapshot.instructionRevision}`}.`
            : '';
          const provenance = messageInstructionProvenance(room, message);
          const instructionStatus = provenance
            ? `\n\nInstruction provenance: ${instructionProvenanceLabel(provenance)}. ${instructionProvenanceDetails(provenance).join(' ')} Original outcome: ${message.status}.`
            : '';
          const interjection =
            message.authorId === 'human' && message.type === 'interjection' && message.interjection
              ? `\n\nHuman interjection: priority ${message.interjection.priority}; dispatch policy ${message.interjection.dispatchPolicy}; work observed at recording: ${message.interjection.queuedJobIds.length} queued, ${message.interjection.runningJobIds.length} active. Existing work retains its frozen context; no response obligations were created.`
              : '';
          const contextNotes =
            instructions +
            instructionStatus +
            interjection +
            (snapshot?.memory
              ? `\n\nFrozen context summary: ${JSON.stringify(snapshot.memory)}.`
              : '') +
            (snapshot?.delivery
              ? `\n\nFrozen model context budget: ${JSON.stringify(snapshot.delivery)}. Character counts cover the application system/user strings, not provider tokenization or protocol overhead.`
              : '') +
            (snapshot?.collection
              ? `\n\nFrozen collection: ${JSON.stringify(snapshot.collection)}. Disagreement policy: preserve and identify conflicting claims; no semantic agreement is inferred.`
              : '') +
            (snapshot?.deletedMessageIds?.length
              ? `\n\nContext: ${snapshot.deletedMessageIds.length} source messages removed by thread deletion; historical context is redacted.`
              : '');
          const attempt = room.jobs.find((j) => j.messageId === message.id);
          const recipients =
            message.recipientIds
              .map(
                (id) =>
                  `${id === 'human' ? 'Human' : agentLabel(room, id, message.snapshotId)} (${id})`,
              )
              .join(', ') || 'room observers';
          const action = attempt?.agentAction;
          const thread = room.threads.find((t) => t.id === message.threadId);
          parts.push(
            `\n## ${name} · ${message.type} · ${message.status}\n\nMessage: ${message.id} · Thread: ${message.threadId}${thread ? `\n\nThread name: ${thread.title}` : ''}\n\nTo: ${recipients}\n\nReply to: ${message.replyTo ?? 'none'}${contextNotes}${attempt ? `\n\nAttempt: ${attempt.id} · ${attempt.kind}${attempt.previousJobId ? ` · follows ${attempt.previousJobId}` : ''}${attempt.error ? `\n\nAttempt error: ${attempt.error}` : ''}` : ''}${action ? `\n\nAction: ${action.kind} · Policy: ${action.policy} · Quorum: ${action.quorum}` : ''}${binding ? `\n\nProvider: ${binding.provider} · Model: ${binding.model}` : ''}${attempt?.providerRequestId ? `\n\nProvider request: ${attempt.providerRequestId}` : ''}${attempt?.usage ? `\n\nToken usage: ${JSON.stringify(attempt.usage)}` : ''}\n\n${message.body}\n`,
          );
        }
        res.end(parts.join(''));
        return;
      }
      throw new AppError(405, 'Method not supported.');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD')
      throw new AppError(405, 'Method not supported.');
    if (vite) {
      if (url.pathname === '/') {
        const template = await readFile(resolve('index.html'), 'utf8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(await vite.transformIndexHtml('/', template));
      } else {
        vite.middlewares(req, res, () => {
          res.writeHead(404);
          res.end('Not found.');
        });
      }
      return;
    }
    const root = resolve(options.clientDir);
    let path: string;
    try {
      path = resolve(
        root,
        `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
      );
    } catch {
      throw new AppError(400, 'Invalid path.');
    }
    if (!path.startsWith(root + sep)) throw new AppError(403, 'Path is not allowed.');
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
    };
    if (!types[extname(path)]) throw new AppError(404, 'File not found.');
    try {
      const content = await readFile(path);
      res.setHeader('Content-Type', `${types[extname(path)]}; charset=utf-8`);
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      throw new AppError(404, 'File not found. Build the client before starting.');
    }
  }

  const onChanged = (roomId: string) => {
    for (const client of clients) {
      if (!client.write(`data: ${JSON.stringify({ roomId })}\n\n`)) client.destroy();
    }
  };
  engine.on('changed', onChanged);
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': heartbeat\n\n');
  }, 15000);
  heartbeat.unref();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (address && typeof address !== 'string') port = address.port;
  return {
    server,
    port,
    close: async () => {
      clearInterval(heartbeat);
      engine.off('changed', onChanged);
      for (const client of clients) client.end();
      clients.clear();
      await vite?.close();
      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
    },
  };
}

async function body(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
    throw new AppError(415, 'Use application/json.');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > 64 * 1024) throw new AppError(413, 'Command is too large.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'Malformed JSON.');
  }
}
