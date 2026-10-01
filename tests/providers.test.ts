import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { LiveProviders, providerBase, providerPrompt } from '../src/server/live-providers.js';
import type { ProviderEvent, ProviderInput } from '../src/server/providers.js';
import { ProviderError, ProviderRefusal } from '../src/server/providers.js';
import type { ProviderKind } from '../src/shared/contracts.js';
import { sse } from '../src/server/streaming.js';

function input(provider: ProviderKind): ProviderInput {
  const agent = {
    id: 'a',
    name: 'AI A',
    role: 'Architect',
    color: 'teal' as const,
    provider,
    model: 'test-model',
    maxOutputTokens: 256,
    timeoutSeconds: 5,
  };
  return {
    agent,
    snapshot: {
      id: 'snapshot',
      sequence: 1,
      objective: 'Find the cause',
      agents: [agent],
      messages: [{ id: 'm', authorId: 'human', type: 'question', body: 'Investigate.' }],
      createdAt: new Date().toISOString(),
    },
    prompt: 'Investigate.',
    kind: 'answer',
    includedAnswers: [],
    expectedRespondents: [],
    missingRespondents: [],
  };
}
function stream(text: string, type = 'text/event-stream'): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        // Deliberately split inside every multi-byte character and across CRLF boundaries.
        for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': type, 'x-request-id': 'http-request' } },
  );
}
const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const keys = {
  OPENAI_API_KEY: 'secret-openai',
  XAI_API_KEY: 'secret-xai',
  GEMINI_API_KEY: 'secret-gemini',
};
async function collect(provider: LiveProviders, request: ProviderInput): Promise<ProviderEvent[]> {
  const result: ProviderEvent[] = [];
  for await (const part of provider.generate(request, new AbortController().signal))
    result.push(part);
  return result;
}
const text = (events: ProviderEvent[]) =>
  events
    .filter((e) => e.type === 'delta')
    .map((e) => e.text)
    .join('');

test('SSE handles UTF-8, CRLF, comments, and multiline data with reader cleanup', async () => {
  const response = stream(': heartbeat\r\ndata: first €\r\ndata: second\r\n\r\ndata: last\n\n');
  const frames: string[] = [];
  for await (const frame of sse(response.body!)) frames.push(frame);
  assert.deepEqual(frames, ['first €\nsecond', 'last']);
  assert.equal(response.body!.locked, false);
});

test('OpenAI uses Responses streaming with frozen attributed input, no provider storage, and usage', async () => {
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(
      (options?.headers as Record<string, string>).Authorization,
      'Bearer secret-openai',
    );
    assert.equal(options?.redirect, 'error');
    const payload = JSON.parse(options?.body as string);
    assert.equal(payload.store, false);
    assert.equal(payload.stream, true);
    assert.equal(payload.max_output_tokens, 256);
    assert.equal(JSON.parse(payload.input).context[0].authorId, 'human');
    return stream(
      event({ type: 'response.created', response: { id: 'response-id' } }) +
        event({ type: 'response.output_text.delta', delta: 'Hello €' }) +
        event({
          type: 'response.completed',
          response: {
            id: 'response-id',
            status: 'completed',
            usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
          },
        }),
    );
  };
  const result = await collect(new LiveProviders(keys, fetcher), input('openai'));
  assert.equal(text(result), 'Hello €');
  assert.equal(result.at(-1)?.type, 'complete');
  assert.deepEqual(result.filter((e) => e.type === 'metadata').at(-1), {
    type: 'metadata',
    requestId: 'response-id',
    usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
  });
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('xAI chat chunks retain the response identity and read final usage before completing', async () => {
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(url, 'https://api.x.ai/v1/chat/completions');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer secret-xai');
    const body = JSON.parse(options?.body as string);
    assert.equal(body.stream_options.include_usage, true);
    return stream(
      event({
        id: 'chat-id',
        choices: [{ delta: { content: 'Grok answer' }, finish_reason: null }],
      }) +
        event({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
        event({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }) +
        'data: [DONE]\n\n',
    );
  };
  const result = await collect(new LiveProviders(keys, fetcher), input('xai'));
  assert.equal(text(result), 'Grok answer');
  assert.equal(result.at(-1)?.type, 'complete');
  assert.ok(result.some((e) => e.type === 'metadata' && e.usage?.totalTokens === 8));
});

test('Gemini uses header authentication, separates instructions, excludes thinking, and requires STOP', async () => {
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(
      url,
      'https://generativelanguage.googleapis.com/v1beta/models/test-model:streamGenerateContent?alt=sse',
    );
    assert.ok(!String(url).includes('secret'));
    assert.equal((options?.headers as Record<string, string>)['x-goog-api-key'], 'secret-gemini');
    const body = JSON.parse(options?.body as string);
    assert.equal(body.contents[0].role, 'user');
    assert.ok(body.systemInstruction.parts[0].text.includes('Architect'));
    return stream(
      event({
        responseId: 'gemini-id',
        candidates: [
          {
            content: {
              parts: [{ thought: true, text: 'private thinking' }, { text: 'Gemini answer' }],
            },
          },
        ],
      }) +
        event({
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 4, totalTokenCount: 11 },
        }),
    );
  };
  const result = await collect(new LiveProviders(keys, fetcher), input('gemini'));
  assert.equal(text(result), 'Gemini answer');
  assert.equal(result.at(-1)?.type, 'complete');
  assert.ok(result.some((e) => e.type === 'metadata' && e.usage?.totalTokens === 11));
});

test('Ollama makes a real loopback HTTP request, normalizes NDJSON and catalogs without API keys', async () => {
  const requests: unknown[] = [];
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined);
    if (req.url === '/api/tags') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ models: [{ name: 'local:test' }] }));
      return;
    }
    assert.equal(req.url, '/api/chat');
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(body);
      assert.equal(body.options.num_predict, 256);
      assert.equal(body.stream, true);
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(
        JSON.stringify({ message: { role: 'assistant', content: 'Local ' }, done: false }) + '\n',
      );
      res.end(
        JSON.stringify({
          message: { content: 'answer' },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 9,
          eval_count: 2,
        }) + '\n',
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const provider = new LiveProviders({});
    const request = input('ollama');
    request.agent.baseUrl = `http://127.0.0.1:${address.port}`;
    const result = await collect(provider, request);
    assert.equal(text(result), 'Local answer');
    assert.equal(result.at(-1)?.type, 'complete');
    assert.equal(requests.length, 1);
    assert.deepEqual(
      await provider.models('ollama', request.agent.baseUrl, new AbortController().signal),
      ['local:test'],
    );
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

for (const [provider, payload, pattern] of [
  [
    'openai',
    event({ type: 'response.output_text.delta', delta: 'partial' }),
    /confirmed completion/,
  ],
  ['openai', event({ type: 'response.incomplete' }), /incomplete/],
  [
    'xai',
    event({ choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }] }),
    /incomplete/,
  ],
  ['xai', 'data: [DONE]\n\n', /before a complete answer/],
  ['gemini', event({ candidates: [{ finishReason: 'MAX_TOKENS' }] }), /incomplete/],
  [
    'ollama',
    JSON.stringify({ message: { content: 'partial' }, done: false }) + '\n',
    /confirmed completion/,
  ],
] as const)
  test(`${provider} rejects incomplete protocol outcome ${pattern}`, async () => {
    const adapter = new LiveProviders(keys, async () =>
      stream(payload, provider === 'ollama' ? 'application/x-ndjson' : 'text/event-stream'),
    );
    await assert.rejects(collect(adapter, input(provider)), pattern);
  });

for (const [provider, payload] of [
  ['openai', event({ type: 'response.refusal.delta', delta: 'raw refusal' })],
  ['xai', event({ choices: [{ delta: { refusal: 'raw refusal' } }] })],
  ['gemini', event({ promptFeedback: { blockReason: 'SAFETY' } })],
] as const)
  test(`${provider} normalizes refusal without leaking raw response details`, async () => {
    await assert.rejects(
      collect(new LiveProviders(keys, async () => stream(payload)), input(provider)),
      ProviderRefusal,
    );
  });

test('missing credentials never invoke the network or fall back to simulation; errors stay redacted', async () => {
  let calls = 0;
  const adapter = new LiveProviders({}, async () => {
    calls++;
    throw new Error('secret-network-detail');
  });
  await assert.rejects(collect(adapter, input('openai')), /OPENAI_API_KEY/);
  assert.equal(calls, 0);
  assert.ok(!JSON.stringify(adapter.connections()).includes('secret'));
  const failed = new LiveProviders(
    keys,
    async () => new Response('secret-openai sensitive server error', { status: 429 }),
  );
  await assert.rejects(
    collect(failed, input('openai')),
    (e) =>
      e instanceof ProviderError && /429/.test(e.message) && !/secret|sensitive/.test(e.message),
  );
  await assert.rejects(
    collect(
      new LiveProviders(keys, async () => {
        throw new Error('secret-openai');
      }),
      input('openai'),
    ),
    (e) => e instanceof ProviderError && !e.message.includes('secret'),
  );
});

test('custom connections require secure explicit endpoints and reject redirect credential forwarding', async () => {
  for (const url of [
    'http://remote.example/v1',
    'https://user:secret@example.test/v1',
    'https://example.test/v1?key=secret',
    'file:///etc/passwd',
  ])
    assert.throws(
      () => providerBase({ provider: 'openai-compatible', baseUrl: url }),
      ProviderError,
    );
  assert.equal(
    providerBase({ provider: 'openai-compatible', baseUrl: 'http://localhost:9000/v1/' }),
    'http://localhost:9000/v1',
  );
  assert.throws(
    () => providerBase({ provider: 'openai', baseUrl: 'https://other.example' }),
    /official endpoint/,
  );
  assert.throws(
    () => providerBase({ provider: 'ollama', baseUrl: 'https://remote.example' }),
    /localhost/,
  );
});

test('provider cancellation aborts the actual pending network request without an automatic replay', async () => {
  const abort = new AbortController();
  let calls = 0;
  const adapter = new LiveProviders(keys, async (_url, options) => {
    calls++;
    return new Promise<Response>((_done, reject) =>
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), {
        once: true,
      }),
    );
  });
  const work = (async () => {
    for await (const _event of adapter.generate(input('openai'), abort.signal)) {
      /* consume */
    }
  })();
  abort.abort();
  await assert.rejects(work, ProviderError);
  assert.equal(calls, 1);
});

test('relay and synthesis instructions retain source attribution and distinguish missing responses', () => {
  const request = input('openai');
  request.kind = 'synthesis';
  request.missingRespondents = ['AI B'];
  request.relay = { step: 2, total: 4 };
  const prompt = providerPrompt(request);
  assert.match(prompt.system, /relay step 3 of 4/);
  assert.match(prompt.system, /Preserve material disagreement/);
  assert.deepEqual(JSON.parse(prompt.user).missingRespondents, ['AI B']);
  assert.equal(JSON.parse(prompt.user).context[0].authorId, 'human');
});

for (const kind of ['openai', 'xai', 'gemini', 'ollama', 'openai-compatible'] as const)
  test(`${kind} requests native structured actions and keeps partial routing JSON out of the transcript`, async () => {
    const request = input(kind);
    if (kind === 'openai-compatible') request.agent.baseUrl = 'https://models.example/v1';
    request.kind = 'decision';
    request.discussion = {
      id: 'discussion',
      allowedPeerIds: ['b', 'c'],
      roundsUsed: 0,
      maxRounds: 3,
      turnsRemaining: 11,
    };
    const action = {
      kind: 'ask',
      body: 'Review the failure cases.',
      recipientIds: ['b', 'c'],
      policy: 'all',
      quorum: 1,
      replyTo: null,
    };
    const raw = JSON.stringify(action);
    const fetcher: typeof fetch = async (_url, options) => {
      const body = JSON.parse(options?.body as string);
      const schema =
        kind === 'openai'
          ? body.text.format.schema
          : kind === 'gemini'
            ? body.generationConfig.responseFormat.text.schema
            : kind === 'ollama'
              ? body.format
              : body.response_format.json_schema.schema;
      assert.deepEqual(schema.required, [
        'kind',
        'body',
        'recipientIds',
        'policy',
        'quorum',
        'replyTo',
      ]);
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.properties.recipientIds.items.enum, ['b', 'c']);
      assert.equal(body.tools, undefined);
      if (kind === 'openai')
        return stream(
          event({ type: 'response.output_text.delta', delta: raw.slice(0, 15) }) +
            event({ type: 'response.output_text.delta', delta: raw.slice(15) }) +
            event({
              type: 'response.completed',
              response: { id: 'decision-id', status: 'completed' },
            }),
        );
      if (kind === 'gemini')
        return stream(
          event({ candidates: [{ content: { parts: [{ text: raw }] }, finishReason: 'STOP' }] }),
        );
      if (kind === 'ollama')
        return stream(
          JSON.stringify({ message: { content: raw.slice(0, 15) }, done: false }) +
            '\n' +
            JSON.stringify({
              message: { content: raw.slice(15) },
              done: true,
              done_reason: 'stop',
            }) +
            '\n',
          'application/x-ndjson',
        );
      return stream(
        event({ choices: [{ delta: { content: raw }, finish_reason: 'stop' }] }) +
          'data: [DONE]\n\n',
      );
    };
    const events = await collect(new LiveProviders(keys, fetcher), request);
    assert.equal(text(events), '', 'Action JSON must never be displayed as answer text.');
    assert.deepEqual(
      events.filter((e) => e.type === 'action'),
      [{ type: 'action', action }],
    );
    assert.equal(events.at(-1)?.type, 'complete');
  });

test('only a confirmed, completed malformed action is eligible for correction; truncation is a provider failure', async () => {
  const { AgentActionError } = await import('../src/server/providers.js');
  const request = input('openai');
  request.kind = 'decision';
  request.discussion = {
    id: 'd',
    allowedPeerIds: ['b'],
    roundsUsed: 0,
    maxRounds: 1,
    turnsRemaining: 3,
  };
  await assert.rejects(
    collect(
      new LiveProviders(keys, async () =>
        stream(
          event({ type: 'response.output_text.delta', delta: 'not JSON' }) +
            event({ type: 'response.completed', response: { status: 'completed' } }),
        ),
      ),
      request,
    ),
    AgentActionError,
  );
  const valid = JSON.stringify({
    kind: 'finish',
    body: 'Final.',
    recipientIds: [],
    policy: 'all',
    quorum: 1,
    replyTo: null,
  });
  await assert.rejects(
    collect(
      new LiveProviders(keys, async () =>
        stream(event({ type: 'response.output_text.delta', delta: valid })),
      ),
      request,
    ),
    (error: unknown) => error instanceof ProviderError && !(error instanceof AgentActionError),
  );
});

test('a server rejecting structured output produces one explicit failure without a plain-text or simulated fallback', async () => {
  const request = input('openai-compatible');
  request.agent.baseUrl = 'https://models.example/v1';
  request.kind = 'decision';
  request.discussion = {
    id: 'd',
    allowedPeerIds: ['b'],
    roundsUsed: 0,
    maxRounds: 1,
    turnsRemaining: 3,
  };
  let calls = 0;
  await assert.rejects(
    collect(
      new LiveProviders({}, async () => {
        calls += 1;
        return new Response('{"error":"private details"}', { status: 400 });
      }),
      request,
    ),
    ProviderError,
  );
  assert.equal(calls, 1);
  const prompt = providerPrompt(request);
  assert.ok(prompt.system.includes('bounded discussion'));
  assert.deepEqual(JSON.parse(prompt.user).discussion.allowedPeerIds, ['b']);
});
