import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { ConversationEngine } from '../src/server/engine.js';
import { serve } from '../src/server/http.js';
import { RoomStore } from '../src/server/store.js';
import { LiveProviders } from '../src/server/live-providers.js';
import type { ProviderAdapter, ProviderEvent } from '../src/server/providers.js';
import type { ProviderKind } from '../src/shared/contracts.js';
import { command, ControlledProvider, until } from './helpers.js';

test('unsupported structured output fails once with redacted diagnostics and no greeting fallback', async (t) => {
  let calls = 0;
  const f = fixture(
    new LiveProviders({}, async () => {
      calls++;
      return new Response('secret-provider-error', { status: 400 });
    }),
  );
  t.after(f.close);
  const a = f.room.agents[0]!;
  f.engine.configureAgent(f.room.id, {
    agentId: a.id,
    name: a.name,
    role: a.role,
    provider: 'ollama',
    model: 'unsupported-fixture',
    baseUrl: 'http://127.0.0.1:11434',
  });
  const before = f.store.get(f.room.id);
  await assert.rejects(
    f.engine.testConnection(f.room.id, a.id, 'coordinator'),
    (e: unknown) =>
      e instanceof Error && /structured JSON output/.test(e.message) && !/secret/.test(e.message),
  );
  assert.equal(calls, 1);
  assert.deepEqual(f.store.get(f.room.id), before);
});

test('service shutdown aborts an in-flight coordinator check', async (t) => {
  const provider = new ControlledProvider();
  const f = fixture(provider);
  t.after(f.close);
  provider.actions[0] = finish;
  const checking = f.engine.testConnection(f.room.id, f.room.agents[0]!.id, 'coordinator');
  const rejected = assert.rejects(checking, /aborted/);
  f.engine.close();
  await rejected;
  assert.equal(provider.inputs.length, 1);
  assert.equal(f.store.get(f.room.id).turnsUsed, 0);
});

const finish = {
  kind: 'finish',
  body: 'Coordinator greeting.',
  recipientIds: [],
  policy: 'all',
  quorum: 1,
  replyTo: null,
};
function fixture(provider: ProviderAdapter = new ControlledProvider(), concurrency = 4) {
  const store = new RoomStore(':memory:');
  const engine = new ConversationEngine(store, provider, { autoSchedule: false, concurrency });
  const room = engine.createRoom({ title: 'Probe', objective: 'PRIVATE OBJECTIVE' });
  return {
    store,
    engine,
    room,
    close: () => {
      engine.close();
      store.close();
    },
  };
}

test('coordinator probe waits for completion, sends no history or objective, and leaves durable state unchanged', async (t) => {
  const provider = new ControlledProvider();
  const f = fixture(provider);
  t.after(f.close);
  f.engine.send(f.room.id, command([], { type: 'update', body: 'PRIVATE THREAD TEXT' }));
  const before = f.store.get(f.room.id);
  provider.actions[0] = finish;
  let settled = false;
  const checking = f.engine
    .testConnection(f.room.id, f.room.agents[0]!.id, 'coordinator')
    .finally(() => {
      settled = true;
    });
  await until(() => provider.inputs.length === 1);
  await new Promise((done) => setImmediate(done));
  assert.equal(settled, false, 'An action without provider completion is not proof of capability.');
  const input = provider.inputs[0]!;
  assert.equal(input.kind, 'decision');
  assert.deepEqual(input.snapshot.messages, []);
  assert.equal(input.snapshot.objective, '');
  assert.equal(input.snapshot.agents.length, 3);
  assert.deepEqual(input.discussion!.allowedPeerIds, []);
  assert.ok(!JSON.stringify(input).includes('PRIVATE'));
  provider.releases[0]!();
  const result = await checking;
  assert.equal(result.kind, 'coordinator');
  assert.equal(result.reply, finish.body);
  assert.equal(result.provider, 'simulated');
  assert.equal(result.model, 'simulation-v1');
  assert.equal(result.configRevision, 0);
  assert.ok(!Number.isNaN(Date.parse(result.testedAt)));
  assert.deepEqual(f.store.get(f.room.id), before);
});

for (const [label, action] of Object.entries({
  ask: { ...finish, kind: 'ask', recipientIds: ['foreign-peer'] },
  empty: { ...finish, body: ' ' },
  oversized: { ...finish, body: 'x'.repeat(20001) },
  extra: { ...finish, command: 'secret-tool-instruction' },
  recipients: { ...finish, recipientIds: ['foreign-peer'] },
  policy: { ...finish, policy: 'any' },
  quorum: { ...finish, quorum: 2 },
  reply: { ...finish, replyTo: 'foreign-message' },
})) {
  test(
    'coordinator probe rejects ' +
      label +
      ' without repair, dispatch, state changes, or raw action disclosure',
    async (t) => {
      const provider = new ControlledProvider();
      const f = fixture(provider);
      t.after(f.close);
      const before = f.store.get(f.room.id);
      provider.actions[0] = action;
      const checking = f.engine.testConnection(f.room.id, f.room.agents[0]!.id, 'coordinator');
      const rejected = assert.rejects(
        checking,
        (e: unknown) =>
          e instanceof Error &&
          /valid finish action/.test(e.message) &&
          !/secret-tool|foreign-/.test(e.message),
      );
      provider.releases[0]!();
      await rejected;
      assert.equal(provider.inputs.length, 1);
      assert.deepEqual(f.store.get(f.room.id), before);
    },
  );
}

for (const ending of ['partial', 'refuse', 'fail', 'empty'] as const) {
  test(
    'coordinator probe fails on ' + ending + ' and permits only a new explicit probe',
    async (t) => {
      const provider = new ControlledProvider();
      const f = fixture(provider);
      t.after(f.close);
      if (ending !== 'empty') provider.actions[0] = finish;
      provider.endings[0] = ending;
      const before = f.store.get(f.room.id);
      const checking = f.engine.testConnection(f.room.id, f.room.agents[0]!.id, 'coordinator');
      const rejected = assert.rejects(checking);
      provider.releases[0]!();
      await rejected;
      assert.equal(provider.inputs.length, 1);
      assert.deepEqual(f.store.get(f.room.id), before);
      provider.actions[1] = finish;
      const retry = f.engine.testConnection(f.room.id, f.room.agents[0]!.id, 'coordinator');
      provider.releases[1]!();
      assert.equal((await retry).kind, 'coordinator');
    },
  );
}

test('coordinator probes reject plain text and duplicate actions and redact unexpected provider errors', async (t) => {
  for (const events of [
    [{ type: 'delta', text: 'secret-text' }, { type: 'complete' }],
    [{ type: 'action', action: finish }, { type: 'action', action: finish }, { type: 'complete' }],
    [],
  ] as ProviderEvent[][]) {
    let calls = 0;
    const provider: ProviderAdapter = {
      id: 'adversarial',
      capabilities: { streaming: true, cancellation: true, remote: false },
      async *generate() {
        calls++;
        for (const event of events) yield event;
        throw new Error('secret-network-detail');
      },
    };
    const f = fixture(provider);
    t.after(f.close);
    const before = f.store.get(f.room.id);
    await assert.rejects(
      f.engine.testConnection(f.room.id, f.room.agents[0]!.id, 'coordinator'),
      (e: unknown) => e instanceof Error && !/secret/.test(e.message),
    );
    assert.equal(calls, 1);
    assert.deepEqual(f.store.get(f.room.id), before);
  }
});

test('coordinator probes serialize with greeting checks and queued work, and hold roster/archive locks', async (t) => {
  const provider = new ControlledProvider();
  const f = fixture(provider, 1);
  t.after(f.close);
  const a = f.room.agents[0]!;
  const other = f.engine.createRoom({ title: 'Other' });
  provider.actions[0] = finish;
  const checking = f.engine.testConnection(f.room.id, a.id, 'coordinator');
  await assert.rejects(f.engine.testConnection(f.room.id, a.id), /busy/);
  await assert.rejects(
    f.engine.testConnection(other.id, other.agents[0]!.id, 'coordinator'),
    /busy/,
  );
  assert.throws(() => f.engine.addAgent(f.room.id, { name: 'New', role: 'Peer' }), /pending work/);
  assert.throws(() => f.engine.setAgentActive(f.room.id, a.id, { active: false }), /pending work/);
  assert.throws(
    () =>
      f.engine.configureWorkspace(f.room.id, { title: 'Changed', objective: '', maxTurns: 100 }),
    /pending work/,
  );
  assert.throws(() => f.engine.setWorkspaceArchived(f.room.id, { archived: true }), /pending work/);
  f.engine.send(f.room.id, command([a.id]));
  f.engine.pump();
  assert.equal(provider.inputs.length, 1);
  assert.equal(f.store.get(f.room.id).turnsUsed, 0);
  provider.releases[0]!();
  await checking;
  f.engine.pump();
  await until(() => provider.inputs.length === 2);
  assert.equal(f.store.get(f.room.id).turnsUsed, 1);
  provider.releases[1]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
});

test('inactive, foreign, archived, and shut-down coordinator probes never invoke a model', async (t) => {
  const provider = new ControlledProvider();
  const f = fixture(provider);
  t.after(f.close);
  const a = f.room.agents[0]!.id;
  const other = f.engine.createRoom({ title: 'Other' });
  await assert.rejects(
    f.engine.testConnection(f.room.id, other.agents[0]!.id, 'coordinator'),
    /Unknown/,
  );
  f.engine.setAgentActive(f.room.id, a, { active: false });
  await assert.rejects(f.engine.testConnection(f.room.id, a, 'coordinator'), /Reactivate/);
  f.engine.setAgentActive(f.room.id, a, { active: true });
  f.engine.setWorkspaceArchived(f.room.id, { archived: true });
  await assert.rejects(f.engine.testConnection(f.room.id, a, 'coordinator'), /Restore/);
  f.engine.close();
  await assert.rejects(
    f.engine.testConnection(other.id, other.agents[0]!.id, 'coordinator'),
    /shutting down/,
  );
  assert.equal(provider.inputs.length, 0);
});

test('workspace deletion aborts coordinator probes, releases capacity, and rejects late completion', async (t) => {
  const provider = new ControlledProvider();
  const f = fixture(provider, 1);
  t.after(f.close);
  const other = f.engine.createRoom({ title: 'Keep' });
  const unchanged = f.store.get(other.id);
  provider.actions[0] = finish;
  const checking = f.engine.testConnection(f.room.id, f.room.agents[0]!.id, 'coordinator');
  const rejected = assert.rejects(checking, /aborted/);
  f.engine.deleteRoom(f.room.id);
  await rejected;
  provider.actions[1] = finish;
  const next = f.engine.testConnection(other.id, other.agents[0]!.id, 'coordinator');
  provider.releases[1]!();
  await next;
  assert.deepEqual(f.store.get(other.id), unchanged);
  assert.throws(() => f.store.get(f.room.id), /not found/);
});

test('coordinator probe respects a shorter saved timeout without retry or durable changes', async (t) => {
  const provider = new ControlledProvider();
  const f = fixture(provider);
  t.after(f.close);
  const a = f.room.agents[0]!;
  f.engine.configureAgent(f.room.id, {
    agentId: a.id,
    name: a.name,
    role: a.role,
    provider: a.provider,
    model: a.model,
    timeoutSeconds: 5,
  });
  const before = f.store.get(f.room.id);
  provider.actions[0] = finish;
  await assert.rejects(f.engine.testConnection(f.room.id, a.id, 'coordinator'), /timed out/);
  assert.equal(provider.inputs.length, 1);
  assert.deepEqual(f.store.get(f.room.id), before);
  provider.actions[1] = finish;
  const retry = f.engine.testConnection(f.room.id, a.id, 'coordinator');
  provider.releases[1]!();
  await retry;
});

for (const kind of ['openai', 'xai', 'gemini', 'ollama', 'openai-compatible'] as ProviderKind[]) {
  test(
    kind + ' coordinator probe uses its native structured envelope with a valid empty-peer schema',
    async (t) => {
      let calls = 0;
      const adapter = new LiveProviders(
        {
          OPENAI_API_KEY: 'synthetic-key',
          XAI_API_KEY: 'synthetic-key',
          GEMINI_API_KEY: 'synthetic-key',
        },
        async (_url, options) => {
          calls++;
          const payload = JSON.parse(options!.body as string);
          const schema =
            kind === 'openai'
              ? payload.text.format.schema
              : kind === 'gemini'
                ? payload.generationConfig.responseFormat.text.schema
                : kind === 'ollama'
                  ? payload.format
                  : payload.response_format.json_schema.schema;
          assert.deepEqual(schema.properties.recipientIds.items, { type: 'string' });
          const user =
            kind === 'openai'
              ? payload.input
              : kind === 'gemini'
                ? payload.contents[0].parts[0].text
                : payload.messages[1].content;
          const context = JSON.parse(user);
          assert.equal(context.objective, '');
          assert.deepEqual(context.context, []);
          assert.deepEqual(context.discussion.allowedPeerIds, []);
          const raw = JSON.stringify(finish);
          const sse = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n';
          const body =
            kind === 'openai'
              ? sse({ type: 'response.output_text.delta', delta: raw }) +
                sse({ type: 'response.completed', response: { status: 'completed' } })
              : kind === 'gemini'
                ? sse({
                    candidates: [{ content: { parts: [{ text: raw }] }, finishReason: 'STOP' }],
                  })
                : kind === 'ollama'
                  ? JSON.stringify({ message: { content: raw }, done: true, done_reason: 'stop' }) +
                    '\n'
                  : sse({ choices: [{ delta: { content: raw }, finish_reason: 'stop' }] }) +
                    'data: [DONE]\n\n';
          return new Response(body, {
            headers: {
              'Content-Type': kind === 'ollama' ? 'application/x-ndjson' : 'text/event-stream',
            },
          });
        },
      );
      const f = fixture(adapter);
      t.after(f.close);
      const a = f.room.agents[0]!;
      f.engine.configureAgent(f.room.id, {
        agentId: a.id,
        name: a.name,
        role: a.role,
        provider: kind,
        model: 'fixture-model',
        baseUrl: kind === 'ollama' || kind === 'openai-compatible' ? 'http://127.0.0.1:11434' : '',
      });
      const before = f.store.get(f.room.id);
      const result = await f.engine.testConnection(f.room.id, a.id, 'coordinator');
      assert.equal(result.provider, kind);
      assert.equal(result.model, 'fixture-model');
      assert.equal(result.configRevision, 1);
      assert.equal(calls, 1);
      assert.deepEqual(f.store.get(f.room.id), before);
      assert.ok(!JSON.stringify(result).includes('synthetic-key'));
    },
  );
}

test('coordinator HTTP checks validate mode, local session, origin, and participant scope before any invocation', async (t) => {
  const provider = new ControlledProvider();
  const f = fixture(provider);
  t.after(f.close);
  const app = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  t.after(() => app.close());
  const base = 'http://127.0.0.1:' + app.port;
  const { token } = (await (await fetch(base + '/api/session')).json()) as { token: string };
  const headers = { 'X-AIB-Token': token, 'Content-Type': 'application/json' };
  const url = base + '/api/rooms/' + f.room.id + '/connection-test';
  const input = { agentId: f.room.agents[0]!.id, kind: 'coordinator' };
  const post = (data: unknown, customHeaders: Record<string, string> = headers) =>
    fetch(url, {
      method: 'POST',
      headers: customHeaders,
      body: JSON.stringify(data),
    });
  assert.equal((await post(input, { 'Content-Type': 'application/json' })).status, 401);
  assert.equal((await post(input, { ...headers, Origin: 'https://evil.example' })).status, 403);
  for (const data of [
    { ...input, kind: 'unknown' },
    { ...input, command: 'send' },
    { ...input, agentId: 'foreign' },
  ])
    assert.equal((await post(data)).status, 400);
  assert.equal(provider.inputs.length, 0);
  provider.actions[0] = finish;
  const response = post(input);
  await until(() => provider.releases.length === 1);
  provider.releases[0]!();
  const result = await response;
  assert.equal(result.status, 200);
  assert.equal((await result.json()).kind, 'coordinator');
  const greeting = post({ agentId: input.agentId });
  await until(() => provider.releases.length === 2);
  provider.releases[1]!();
  assert.equal((await (await greeting).json()).kind, 'greeting');
});
