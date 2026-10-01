import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  Agent,
  AgentSettingsInput,
  ContextSnapshot,
  CreateRoomInput,
  Job,
  Message,
  Request,
  Room,
  SendInput,
  SendResult,
  ProviderStatus,
} from '../shared/contracts.js';
import { agentSettingsSchema, createRoomSchema, sendSchema } from '../shared/contracts.js';
import { AppError } from './errors.js';
import type { ProviderAdapter, ProviderInput } from './providers.js';
import { ProviderRefusal } from './providers.js';
import { RoomStore } from './store.js';

interface EngineOptions {
  now?: () => Date;
  id?: () => string;
  autoSchedule?: boolean;
  concurrency?: number;
}
const terminal = new Set(['completed', 'failed', 'refused', 'cancelled', 'interrupted']);

export class ConversationEngine extends EventEmitter {
  private now: () => Date;
  private id: () => string;
  private active = new Map<string, { roomId: string; agentId: string; abort: AbortController }>();
  private connectionChecks = new Map<string, AbortController>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private concurrency: number;

  constructor(
    readonly store: RoomStore,
    private provider: ProviderAdapter,
    options: EngineOptions = {},
  ) {
    super();
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? randomUUID;
    this.concurrency = options.concurrency ?? 4;
    this.recover();
    if (options.autoSchedule !== false) {
      this.timer = setInterval(() => this.pump(), 100);
      this.timer.unref();
    }
  }

  createRoom(raw: CreateRoomInput): Room {
    const input = createRoomSchema.parse(raw);
    const createdAt = this.timestamp();
    const definitions = [
      ['AI A', 'Architect · define boundaries and synthesize evidence', 'teal'],
      ['AI B', 'Debugger · examine transitions and failure cases', 'amber'],
      ['AI C', 'Reviewer · check assumptions and user-visible behavior', 'violet'],
    ] as const;
    const agents: Agent[] = definitions.map(([name, role, color]) => ({
      id: this.id(),
      name,
      role,
      color,
      provider: 'simulated',
      model: 'simulation-v1',
    }));
    const room: Room = {
      schemaVersion: 1,
      id: this.id(),
      title: input.title,
      objective: input.objective,
      status: 'running',
      revision: 0,
      createdAt,
      updatedAt: createdAt,
      maxTurns: input.maxTurns,
      turnsUsed: 0,
      agents,
      threads: [],
      messages: [],
      requests: [],
      jobs: [],
      snapshots: [],
      events: [],
      relays: [],
    };
    this.audit(room, 'room.created', 'Room created with three simulated participants.');
    this.store.create(room);
    this.changed(room.id);
    return room;
  }

  connections(): ProviderStatus[] {
    return this.provider.connections?.() ?? [];
  }

  async models(provider: string, baseUrl: string): Promise<string[]> {
    if (!this.provider.models) throw new AppError(400, 'Model discovery is unavailable.');
    try {
      return await this.provider.models(provider, baseUrl, AbortSignal.timeout(15000));
    } catch (error) {
      throw new AppError(400, error instanceof Error ? error.message : 'Model discovery failed.');
    }
  }

  configureAgent(roomId: string, raw: AgentSettingsInput): void {
    const input = agentSettingsSchema.parse(raw);
    this.store.mutate(roomId, (room) => {
      const agent = room.agents.find((a) => a.id === input.agentId);
      if (!agent) throw new AppError(400, 'Unknown participant.');
      if (
        room.jobs.some((j) => j.status === 'queued' || j.status === 'running') ||
        this.connectionChecks.has(input.agentId) ||
        room.relays.some((r) => ['running', 'blocked'].includes(r.status))
      )
        throw new AppError(
          409,
          'Finish or stop pending work before editing participants. Existing context snapshots retain their original settings.',
        );
      const next: Agent = { ...agent, ...input, configRevision: (agent.configRevision ?? 0) + 1 };
      delete (next as Agent & { agentId?: string }).agentId;
      try {
        this.provider.validateAgent?.(next);
      } catch (error) {
        throw new AppError(
          400,
          error instanceof Error ? error.message : 'Invalid connection settings.',
        );
      }
      Object.assign(agent, next);
      this.audit(
        room,
        'agent.configured',
        `${agent.name}: ${agent.provider} / ${agent.model}, configuration ${agent.configRevision}.`,
      );
    });
    this.changed(roomId);
  }

  async testConnection(roomId: string, agentId: string): Promise<{ reply: string }> {
    if (this.closed) throw new AppError(409, 'Service is shutting down.');
    const room = this.store.get(roomId);
    const agent = room.agents.find((a) => a.id === agentId);
    if (!agent) throw new AppError(400, 'Unknown participant.');
    if (
      this.connectionChecks.has(agentId) ||
      [...this.active.values()].some((t) => t.agentId === agentId) ||
      this.active.size + this.connectionChecks.size >= this.concurrency
    )
      throw new AppError(409, 'This participant is busy. Wait for its current request to finish.');
    const abort = new AbortController();
    this.connectionChecks.set(agentId, abort);
    const snapshot = this.snapshot({ ...room, objective: '' }, []);
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]);
    let text = '';
    try {
      for await (const event of this.provider.generate(
        {
          agent,
          snapshot,
          prompt:
            'Reply with a short greeting identifying your participant name. This is a connection test.',
          kind: 'answer',
          includedAnswers: [],
          expectedRespondents: [],
          missingRespondents: [],
        },
        signal,
      )) {
        signal.throwIfAborted();
        if (event.type === 'refused')
          throw new ProviderRefusal('Provider refused the connection test.');
        if (event.type === 'delta') {
          text += event.text;
          if (text.length > 20000) throw new Error('Connection test output exceeds the limit.');
        }
        if (event.type === 'complete' && text.trim()) return { reply: text.slice(0, 300) };
      }
      throw new Error('Connection test did not produce a completed answer.');
    } catch (error) {
      throw new AppError(400, error instanceof Error ? error.message : 'Connection test failed.');
    } finally {
      this.connectionChecks.delete(agentId);
    }
  }

  send(roomId: string, raw: SendInput): SendResult {
    const input = sendSchema.parse(raw);
    const { relayOrder, ...legacyCommand } = input;
    const commandHash = createHash('sha256')
      .update(JSON.stringify(relayOrder.length ? input : legacyCommand))
      .digest('hex');
    const previous = this.store.get(roomId).messages.find((m) => m.clientId === input.clientId);
    if (previous) {
      if (previous.commandHash !== commandHash)
        throw new AppError(409, 'Send ID already used for different content.');
      return { messageId: previous.id, threadId: previous.threadId, requestId: previous.requestId };
    }
    const result = this.store.mutate(roomId, (room) => {
      if (room.status === 'stopped')
        throw new AppError(409, 'Resume this room before sending new messages.');
      if (new Set(input.recipientIds).size !== input.recipientIds.length)
        throw new AppError(400, 'Select each recipient once.');
      const agentIds = new Set(room.agents.map((a) => a.id));
      if (input.recipientIds.some((id) => !agentIds.has(id)))
        throw new AppError(400, 'Unknown recipient.');
      if (input.synthesisAgentId && !agentIds.has(input.synthesisAgentId))
        throw new AppError(400, 'Unknown synthesis agent.');
      if (input.type === 'question' && !input.recipientIds.length)
        throw new AppError(400, 'A question needs at least one recipient.');
      if (input.relayOrder.length) {
        if (
          input.type !== 'question' ||
          input.synthesisAgentId ||
          input.policy !== 'all' ||
          input.recipientIds.length !== 1 ||
          input.recipientIds[0] !== input.relayOrder[0]
        )
          throw new AppError(
            400,
            'A relay is a question addressed to its first participant, without parallel collection or synthesis.',
          );
        if (input.relayOrder.some((id) => !agentIds.has(id)))
          throw new AppError(400, 'Unknown relay participant.');
      }
      if (input.type === 'update' && input.synthesisAgentId)
        throw new AppError(400, 'Updates cannot schedule synthesis.');
      if (input.synthesisAgentId && input.recipientIds.includes(input.synthesisAgentId))
        throw new AppError(400, 'Choose a separate synthesis agent.');
      if (input.policy === 'quorum' && input.quorum > input.recipientIds.length)
        throw new AppError(400, 'Quorum exceeds the recipient count.');
      const reply = input.replyTo ? room.messages.find((m) => m.id === input.replyTo) : null;
      if (input.replyTo && !reply) throw new AppError(400, 'Reply target is not in this room.');
      if (reply && input.threadId && reply.threadId !== input.threadId)
        throw new AppError(400, 'Reply target belongs to a different thread.');
      let threadId = reply?.threadId ?? input.threadId;
      if (threadId && !room.threads.some((t) => t.id === threadId))
        throw new AppError(400, 'Unknown thread.');
      if (!threadId) {
        threadId = this.id();
        room.threads.push({
          id: threadId,
          title: input.body.replace(/\s+/g, ' ').slice(0, 68),
          createdAt: this.timestamp(),
        });
      }
      const needed =
        input.type === 'question'
          ? input.relayOrder.length || input.recipientIds.length + (input.synthesisAgentId ? 1 : 0)
          : 0;
      this.reserve(room, needed);
      const requestId = input.type === 'question' ? this.id() : null;
      const message: Message = {
        id: this.id(),
        sequence: room.messages.length + 1,
        threadId,
        authorId: 'human',
        recipientIds: input.recipientIds,
        visibility: 'room',
        type: input.type,
        body: input.body,
        status: 'complete',
        replyTo: input.replyTo,
        requestId,
        snapshotId: null,
        createdAt: this.timestamp(),
        clientId: input.clientId,
        commandHash,
      };
      room.messages.push(message);
      if (requestId) {
        const relevant = room.messages.filter(
          (m) => m.status === 'complete' && (m.threadId === threadId || m.type === 'update'),
        );
        const snapshot = this.snapshot(room, relevant);
        room.snapshots.push(snapshot);
        message.snapshotId = snapshot.id;
        const request: Request = {
          id: requestId,
          messageId: message.id,
          threadId,
          recipientIds: input.recipientIds,
          policy: input.policy,
          quorum: input.quorum,
          synthesisAgentId: input.synthesisAgentId,
          snapshotId: snapshot.id,
          status: 'collecting',
          includedMessageIds: [],
          createdAt: this.timestamp(),
          deadlineAt: new Date(this.now().getTime() + input.deadlineSeconds * 1000).toISOString(),
          closedAt: null,
        };
        room.requests.push(request);
        if (input.relayOrder.length) {
          const relayId = this.id();
          request.relayId = relayId;
          request.relayStep = 0;
          room.relays.push({
            id: relayId,
            messageId: message.id,
            threadId,
            order: input.relayOrder,
            requestIds: [request.id],
            completedSteps: 0,
            status: 'running',
            deadlineSeconds: input.deadlineSeconds,
            error: null,
          });
          this.audit(
            room,
            'relay.started',
            `Reserved ${input.relayOrder.length} sequential turns; each hop requires a completed answer.`,
          );
        }
        for (const agentId of input.recipientIds)
          room.jobs.push(this.job(request, agentId, 'answer', snapshot.id));
      }
      this.audit(
        room,
        'message.sent',
        `${input.type} delivered to ${input.recipientIds.length} selected participants.`,
      );
      return { messageId: message.id, threadId, requestId };
    });
    this.changed(roomId);
    return result;
  }

  control(roomId: string, action: 'pause' | 'resume' | 'stop'): void {
    this.store.mutate(roomId, (room) => {
      room.status = action === 'resume' ? 'running' : action === 'pause' ? 'paused' : 'stopped';
      if (action === 'stop') {
        for (const relay of room.relays)
          if (relay.status === 'running' || relay.status === 'blocked') relay.status = 'cancelled';
        for (const request of room.requests) {
          if (request.status === 'collecting') {
            request.status = 'cancelled';
            request.closedAt = this.timestamp();
          }
        }
        for (const job of room.jobs) this.cancelJob(room, job);
      }
      this.audit(
        room,
        `room.${action}`,
        action === 'pause'
          ? 'New dispatches paused; active work may finish.'
          : `Room ${action} requested by the human.`,
      );
    });
    if (action === 'stop') {
      for (const task of this.active.values()) if (task.roomId === roomId) task.abort.abort();
    }
    this.changed(roomId);
  }

  retry(roomId: string, jobId: string): void {
    this.store.mutate(roomId, (room) => {
      const previous = room.jobs.find((j) => j.id === jobId);
      if (!previous || !['failed', 'interrupted'].includes(previous.status))
        throw new AppError(400, 'Only failed or interrupted work can be retried.');
      const request = room.requests.find((r) => r.id === previous.requestId)!;
      if (
        room.status === 'stopped' ||
        request.status === 'cancelled' ||
        request.status === 'timed_out'
      )
        throw new AppError(409, 'Create a new question for cancelled or expired work.');
      if (previous.kind === 'answer' && request.status === 'ready')
        throw new AppError(409, 'This response set is closed. Ask a follow-up instead.');
      const chain = room.jobs.filter(
        (j) =>
          j.requestId === request.id && j.agentId === previous.agentId && j.kind === previous.kind,
      );
      if (chain.at(-1)?.id !== previous.id)
        throw new AppError(409, 'A newer attempt already exists.');
      if (chain.length >= 3) throw new AppError(409, 'Retry limit reached; create a new question.');
      this.reserve(
        room,
        1 +
          (previous.kind === 'answer' && request.status === 'unresolved' && request.synthesisAgentId
            ? 1
            : 0),
      );
      if (previous.kind === 'synthesis') {
        const original = room.snapshots.find((s) => s.id === request.snapshotId)!;
        const included = request.includedMessageIds.map((id) =>
          room.messages.find((m) => m.id === id)!,
        );
        const snapshot = this.snapshot(room, [...original.messages, ...included]);
        room.snapshots.push(snapshot);
        room.jobs.push({
          ...this.job(request, previous.agentId, previous.kind, snapshot.id),
          previousJobId: previous.id,
        });
      } else {
        room.jobs.push({
          ...this.job(request, previous.agentId, previous.kind, previous.snapshotId),
          previousJobId: previous.id,
        });
      }
      if (previous.kind === 'answer') {
        request.status = 'collecting';
        request.closedAt = null;
        request.deadlineAt = new Date(this.now().getTime() + 120000).toISOString();
        const relay = room.relays.find((r) => r.id === request.relayId);
        if (relay) {
          relay.status = 'running';
          relay.error = null;
        }
      }
      this.audit(room, 'job.retry', `Explicit retry of ${previous.id}; previous attempt retained.`);
    });
    this.changed(roomId);
  }

  /** Dispatch is synchronous up to persisted claims; generation proceeds independently. */
  pump(): void {
    if (this.closed) return;
    for (const initial of this.store.all()) {
      this.expire(initial.id);
      const room = this.store.get(initial.id);
      if (room.status !== 'running') continue;
      for (const job of room.jobs) {
        if (this.active.size + this.connectionChecks.size >= this.concurrency) return;
        if (
          job.status !== 'queued' ||
          this.connectionChecks.has(job.agentId) ||
          [...this.active.values()].some((t) => t.agentId === job.agentId)
        )
          continue;
        this.start(room.id, job.id);
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const task of this.active.values()) task.abort.abort();
    for (const abort of this.connectionChecks.values()) abort.abort();
    // Preserve unfinished work for explicit recovery; never auto-replay a running invocation.
    this.recover();
    this.removeAllListeners();
  }

  private start(roomId: string, jobId: string): void {
    const abort = new AbortController();
    let input: ProviderInput | null = null;
    let claimedAgentId = '';
    this.store.mutate(roomId, (room) => {
      const job = room.jobs.find((j) => j.id === jobId)!;
      if (room.status !== 'running' || job.status !== 'queued') return;
      const request = room.requests.find((r) => r.id === job.requestId)!;
      if (room.turnsUsed >= room.maxTurns) {
        room.status = 'paused';
        this.audit(room, 'budget.exhausted', 'Turn limit reached.');
        return;
      }
      const snapshot = room.snapshots.find((s) => s.id === job.snapshotId)!;
      const agent = snapshot.agents.find((a) => a.id === job.agentId)!;
      const relay = room.relays.find((r) => r.id === request.relayId);
      const prompt = room.messages.find(
        (m) => m.id === (relay?.messageId ?? request.messageId),
      )!.body;
      job.status = 'running';
      job.startedAt = this.timestamp();
      job.attemptId = this.id();
      job.messageId = this.id();
      room.turnsUsed += 1;
      room.messages.push({
        id: job.messageId,
        sequence: room.messages.length + 1,
        threadId: request.threadId,
        authorId: job.agentId,
        recipientIds: ['human'],
        visibility: 'room',
        type: job.kind,
        body: '',
        status: 'streaming',
        replyTo: request.messageId,
        requestId: request.id,
        snapshotId: snapshot.id,
        createdAt: this.timestamp(),
      });
      const includedAnswers = (job.kind === 'synthesis' ? request.includedMessageIds : []).map(
        (id) => {
          const message = room.messages.find((m) => m.id === id)!;
          return {
            author: room.agents.find((a) => a.id === message.authorId)!.name,
            body: message.body,
          };
        },
      );
      const includedAuthorIds = new Set(
        request.includedMessageIds.map((id) => room.messages.find((m) => m.id === id)!.authorId),
      );
      const expectedRespondents = request.recipientIds.map(
        (id) => room.agents.find((a) => a.id === id)!.name,
      );
      const missingRespondents =
        job.kind === 'synthesis'
          ? request.recipientIds
              .filter((id) => !includedAuthorIds.has(id))
              .map((id) => room.agents.find((a) => a.id === id)!.name)
          : [];
      input = {
        agent,
        snapshot,
        prompt,
        kind: job.kind,
        includedAnswers,
        expectedRespondents,
        missingRespondents,
        ...(relay ? { relay: { step: request.relayStep!, total: relay.order.length } } : {}),
      };
      claimedAgentId = agent.id;
    });
    if (!input) return;
    this.active.set(jobId, { roomId, agentId: claimedAgentId, abort });
    this.changed(roomId);
    void this.generate(roomId, jobId, input, abort.signal);
  }

  private async generate(
    roomId: string,
    jobId: string,
    input: ProviderInput,
    signal: AbortSignal,
  ): Promise<void> {
    let completed = false;
    try {
      for await (const event of this.provider.generate(input, signal)) {
        if (this.closed || signal.aborted) break;
        if (event.type === 'refused') throw new ProviderRefusal(event.reason);
        if (event.type === 'metadata') {
          this.store.mutate(roomId, (room) => {
            const job = room.jobs.find((j) => j.id === jobId)!;
            if (job.status !== 'running') return;
            if (event.requestId) job.providerRequestId = event.requestId;
            if (event.usage) job.usage = event.usage;
          });
        } else if (event.type === 'delta') {
          this.store.mutate(roomId, (room) => {
            const job = room.jobs.find((j) => j.id === jobId)!;
            if (job.status !== 'running') return;
            const message = room.messages.find((m) => m.id === job.messageId)!;
            if (message.body.length + event.text.length > 20000)
              throw new Error('Provider output exceeds the 20,000-character limit.');
            message.body += event.text;
          });
          this.changed(roomId);
        } else if (event.type === 'complete') {
          this.store.mutate(roomId, (room) => {
            const job = room.jobs.find((j) => j.id === jobId)!;
            if (job.status !== 'running') return;
            const message = room.messages.find((m) => m.id === job.messageId)!;
            if (!message.body.trim()) throw new Error('Provider returned an empty answer.');
            message.status = 'complete';
            job.status = 'completed';
            job.endedAt = this.timestamp();
            this.collect(room, job.requestId);
          });
          completed = true;
          this.changed(roomId);
          break;
        }
      }
      if (!completed && !signal.aborted && !this.closed)
        throw new Error('Stream ended without a completion event.');
    } catch (error) {
      if (!this.closed && !signal.aborted) {
        this.store.mutate(roomId, (room) => {
          const job = room.jobs.find((j) => j.id === jobId)!;
          if (job.status !== 'running') return;
          job.status = error instanceof ProviderRefusal ? 'refused' : 'failed';
          job.endedAt = this.timestamp();
          // Live adapters expose only application-authored, redacted error messages.
          job.error = error instanceof Error ? error.message.slice(0, 300) : 'Provider failed.';
          room.messages.find((m) => m.id === job.messageId)!.status =
            error instanceof ProviderRefusal ? 'refused' : 'failed';
          this.collect(room, job.requestId);
          this.audit(room, 'job.failed', `Attempt ${job.attemptId} failed.`);
        });
        this.changed(roomId);
      }
    } finally {
      this.active.delete(jobId);
    }
  }

  private collect(room: Room, requestId: string): void {
    const request = room.requests.find((r) => r.id === requestId)!;
    if (request.status !== 'collecting') return;
    const latest = request.recipientIds.map((id) =>
      room.jobs
        .filter((j) => j.requestId === requestId && j.agentId === id && j.kind === 'answer')
        .at(-1)!,
    );
    const completed = latest.filter((j) => j.status === 'completed');
    const target =
      request.policy === 'all' ? latest.length : request.policy === 'any' ? 1 : request.quorum;
    if (completed.length >= target) {
      request.status = 'ready';
      request.closedAt = this.timestamp();
      request.includedMessageIds = completed.map((j) => j.messageId!);
      if (request.relayId) this.advanceRelay(room, request);
      if (request.synthesisAgentId) {
        const original = room.snapshots.find((s) => s.id === request.snapshotId)!;
        const included = request.includedMessageIds.map((id) =>
          room.messages.find((m) => m.id === id)!,
        );
        try {
          const snapshot = this.snapshot(room, [...original.messages, ...included]);
          room.snapshots.push(snapshot);
          room.jobs.push(this.job(request, request.synthesisAgentId, 'synthesis', snapshot.id));
        } catch (error) {
          if (!(error instanceof AppError) || error.status !== 413) throw error;
          const failed = this.job(request, request.synthesisAgentId, 'synthesis', original.id);
          failed.status = 'failed';
          failed.error =
            'Synthesis context exceeds the initial 64,000-character limit. Individual answers are preserved.';
          failed.endedAt = this.timestamp();
          room.jobs.push(failed);
          this.audit(room, 'synthesis.blocked', failed.error);
        }
      }
      this.audit(
        room,
        'request.ready',
        `Collected ${completed.length}/${latest.length} answers under ${request.policy}.`,
      );
    } else if (latest.every((j) => terminal.has(j.status))) {
      request.status = 'unresolved';
      request.closedAt = this.timestamp();
      const relay = room.relays.find((r) => r.id === request.relayId);
      if (relay) {
        relay.status = 'blocked';
        relay.error =
          latest.find((j) => j.error)?.error ??
          'Relay requires a completed answer before advancing.';
      }
      this.audit(room, 'request.unresolved', 'Required eligible answers were not received.');
    }
  }

  /** Completion and scheduling of the next exact-message hop commit atomically. */
  private advanceRelay(room: Room, request: Request): void {
    const relay = room.relays.find((r) => r.id === request.relayId)!;
    if (relay.status !== 'running' || request.relayStep !== relay.completedSteps) return;
    relay.completedSteps += 1;
    if (relay.completedSteps === relay.order.length) {
      relay.status = 'completed';
      relay.error = null;
      this.audit(
        room,
        'relay.completed',
        `${relay.completedSteps} completed relay turns; final answer delivered to the human.`,
      );
      return;
    }
    const source = room.messages.find((m) => m.id === request.includedMessageIds[0])!;
    const original = room.snapshots.find((s) => s.id === request.snapshotId)!;
    const nextAgent = relay.order[relay.completedSteps]!;
    try {
      const snapshot = this.snapshot(room, [...original.messages, source]);
      snapshot.agents = structuredClone(original.agents);
      room.snapshots.push(snapshot);
      const next: Request = {
        ...request,
        id: this.id(),
        messageId: source.id,
        snapshotId: snapshot.id,
        recipientIds: [nextAgent],
        status: 'collecting',
        includedMessageIds: [],
        createdAt: this.timestamp(),
        deadlineAt: new Date(this.now().getTime() + relay.deadlineSeconds * 1000).toISOString(),
        closedAt: null,
        relayStep: relay.completedSteps,
      };
      source.recipientIds = [nextAgent, 'human'];
      room.requests.push(next);
      relay.requestIds.push(next.id);
      room.jobs.push(this.job(next, nextAgent, 'answer', snapshot.id));
      this.audit(
        room,
        'relay.advanced',
        `Step ${relay.completedSteps + 1}/${relay.order.length} queued for ${nextAgent}; replies to message ${source.id}.`,
      );
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 413) throw error;
      relay.status = 'blocked';
      relay.error =
        'Relay context exceeds the 64,000-character limit. Completed answers are preserved. Stop the relay and start a shorter thread.';
      this.audit(room, 'relay.blocked', relay.error);
    }
  }

  private expire(roomId: string): void {
    const expired = this.store
      .get(roomId)
      .requests.filter(
        (r) => r.status === 'collecting' && Date.parse(r.deadlineAt) <= this.now().getTime(),
      );
    if (!expired.length) return;
    const ids = new Set(expired.map((r) => r.id));
    const cancelled: string[] = [];
    this.store.mutate(roomId, (room) => {
      room.status = 'paused';
      for (const request of room.requests) {
        if (!ids.has(request.id)) continue;
        request.status = 'timed_out';
        request.closedAt = this.timestamp();
        const relay = room.relays.find((r) => r.id === request.relayId);
        if (relay) {
          relay.status = 'cancelled';
          relay.error = 'Relay cancelled after its response deadline.';
        }
        request.includedMessageIds = room.jobs
          .filter(
            (j) => j.requestId === request.id && j.kind === 'answer' && j.status === 'completed',
          )
          .map((j) => j.messageId!);
      }
      for (const job of room.jobs) {
        if (ids.has(job.requestId) && this.cancelJob(room, job)) cancelled.push(job.id);
      }
      this.audit(
        room,
        'request.timeout',
        'Deadline reached; incomplete response set preserved and room paused.',
      );
    });
    for (const id of cancelled) this.active.get(id)?.abort.abort();
    this.changed(roomId);
  }

  private recover(): void {
    for (const initial of this.store.all()) {
      if (
        !initial.jobs.some((j) => j.status === 'running' || j.status === 'queued') &&
        !initial.relays.some((r) => r.status === 'running' || r.status === 'blocked')
      )
        continue;
      this.store.mutate(initial.id, (room) => {
        room.status = 'paused';
        for (const job of room.jobs) {
          if (job.status !== 'running') continue;
          job.status = 'interrupted';
          job.error = 'Service stopped during this attempt. Retry explicitly; it was not replayed.';
          job.endedAt = this.timestamp();
          if (job.messageId)
            room.messages.find((m) => m.id === job.messageId)!.status = 'interrupted';
        }
        for (const request of room.requests) this.collect(room, request.id);
        this.audit(
          room,
          'room.recovered',
          'Unfinished room paused for review. Queued work retained; interrupted work requires explicit retry.',
        );
      });
    }
  }

  private cancelJob(room: Room, job: Job): boolean {
    if (job.status !== 'queued' && job.status !== 'running') return false;
    job.status = 'cancelled';
    job.endedAt = this.timestamp();
    if (job.messageId) room.messages.find((m) => m.id === job.messageId)!.status = 'cancelled';
    return true;
  }

  private reserve(room: Room, needed: number): void {
    const reserved =
      room.jobs.filter((j) => j.status === 'queued').length +
      room.requests.filter((r) => r.status === 'collecting' && r.synthesisAgentId).length +
      room.relays
        .filter((r) => r.status === 'running' || r.status === 'blocked')
        .reduce((n, r) => n + r.order.length - r.requestIds.length, 0);
    if (room.turnsUsed + reserved + needed > room.maxTurns)
      throw new AppError(
        409,
        'This request exceeds the remaining turn budget. Create a new room or ask fewer agents.',
      );
  }

  private snapshot(
    room: Room,
    messages: Pick<Message, 'id' | 'authorId' | 'type' | 'body'>[],
  ): ContextSnapshot {
    if (messages.reduce((n, m) => n + m.body.length, room.objective.length) > 64000)
      throw new AppError(
        413,
        'This thread exceeds the initial context limit. Start a new thread or room; no history was silently removed.',
      );
    return {
      id: this.id(),
      sequence: room.messages.length,
      objective: room.objective,
      agents: structuredClone(room.agents),
      messages: messages.map(({ id, authorId, type, body }) => ({ id, authorId, type, body })),
      createdAt: this.timestamp(),
    };
  }

  private job(request: Request, agentId: string, kind: Job['kind'], snapshotId: string): Job {
    return {
      id: this.id(),
      requestId: request.id,
      agentId,
      kind,
      snapshotId,
      status: 'queued',
      attemptId: null,
      messageId: null,
      error: null,
      previousJobId: null,
      createdAt: this.timestamp(),
      startedAt: null,
      endedAt: null,
    };
  }

  private audit(room: Room, type: string, detail: string): void {
    room.events.push({ id: this.id(), type, detail, createdAt: this.timestamp() });
  }
  private timestamp(): string {
    return this.now().toISOString();
  }
  private changed(roomId: string): void {
    this.emit('changed', roomId);
  }
}
