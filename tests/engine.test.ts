import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ZodError } from 'zod';
import { ConversationEngine } from '../src/server/engine.js';
import { RoomStore } from '../src/server/store.js';
import { command, ControlledProvider, until } from './helpers.js';

function setup(maxTurns = 100, options: { now?: () => Date; concurrency?: number } = {}) {
  const store = new RoomStore(':memory:', options.now);
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false, ...options });
  const room = engine.createRoom({ title: 'Test room', objective: 'Find the cause.', maxTurns });
  const [a, b, c] = room.agents;
  return {
    store,
    provider,
    engine,
    room,
    a: a!,
    b: b!,
    c: c!,
    close: () => {
      engine.close();
      store.close();
    },
  };
}

test('directed delivery invokes only recipients; duplicate provider names keep separate identities', async (t) => {
  const f = setup();
  t.after(f.close);
  assert.equal(f.a.model, f.b.model);
  assert.notEqual(f.a.id, f.b.id);
  f.engine.send(f.room.id, command([f.b.id]));
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  assert.equal(f.provider.inputs[0]!.agent.id, f.b.id);
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
  assert.equal(f.store.get(f.room.id).requests[0]!.status, 'ready');
});

test('parallel recipients share a frozen snapshot and synthesis waits for all', async (t) => {
  const f = setup();
  t.after(f.close);
  f.engine.send(f.room.id, command([f.b.id, f.c.id], { synthesisAgentId: f.a.id }));
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 2);
  assert.equal(f.provider.inputs[0]!.snapshot.id, f.provider.inputs[1]!.snapshot.id);
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
  f.engine.pump();
  assert.equal(f.store.get(f.room.id).requests[0]!.status, 'collecting');
  assert.equal(f.provider.inputs.length, 2);
  assert.deepEqual(f.provider.inputs[1]!.includedAnswers, []);
  assert.equal(f.provider.inputs[1]!.snapshot.messages.length, 1);
  f.provider.releases[1]!();
  await until(() => f.store.get(f.room.id).requests[0]!.status === 'ready');
  f.engine.pump();
  assert.equal(f.provider.inputs[2]!.kind, 'synthesis');
  assert.equal(f.provider.inputs[2]!.includedAnswers.length, 2);
  assert.equal(f.provider.inputs[2]!.snapshot.messages.length, 3);
  f.provider.releases[2]!();
  await until(() => f.store.get(f.room.id).jobs[2]!.status === 'completed');
});

test('any closes an immutable response set; late answers do not rewrite synthesis context', async (t) => {
  const f = setup();
  t.after(f.close);
  f.engine.send(f.room.id, command([f.b.id, f.c.id], { policy: 'any', synthesisAgentId: f.a.id }));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).requests[0]!.status === 'ready');
  const included = f.store.get(f.room.id).requests[0]!.includedMessageIds;
  f.engine.pump();
  assert.equal(f.provider.inputs[2]!.includedAnswers.length, 1);
  assert.deepEqual(f.provider.inputs[2]!.missingRespondents, ['AI C']);
  f.provider.releases[1]!();
  f.provider.releases[2]!();
  await until(() => f.store.get(f.room.id).jobs.every((j) => j.status === 'completed'));
  assert.deepEqual(f.store.get(f.room.id).requests[0]!.includedMessageIds, included);
  assert.equal(f.provider.inputs[2]!.snapshot.messages.length, 2);
});

test('a recipient queued after any closure still receives no sibling answers', async (t) => {
  const f = setup(100, { concurrency: 1 });
  t.after(f.close);
  f.engine.send(f.room.id, command([f.b.id, f.c.id], { policy: 'any' }));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
  f.engine.pump();
  assert.deepEqual(f.provider.inputs[1]!.includedAnswers, []);
  assert.equal(f.provider.inputs[1]!.snapshot.messages.length, 1);
});

test('same-agent work is serialized while other agents can run concurrently', async (t) => {
  const f = setup();
  t.after(f.close);
  f.engine.send(f.room.id, command([f.b.id]));
  f.engine.send(f.room.id, command([f.b.id]));
  f.engine.send(f.room.id, command([f.c.id]));
  f.engine.pump();
  assert.deepEqual(
    f.provider.inputs.map((i) => i.agent.id),
    [f.b.id, f.c.id],
  );
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 3);
  assert.equal(f.provider.inputs[2]!.agent.id, f.b.id);
});

test('pause drains in-flight replies and holds dependent synthesis until resume', async (t) => {
  const f = setup();
  t.after(f.close);
  f.engine.send(f.room.id, command([f.b.id], { synthesisAgentId: f.a.id }));
  f.engine.pump();
  f.engine.control(f.room.id, 'pause');
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).requests[0]!.status === 'ready');
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  assert.equal(f.store.get(f.room.id).jobs[1]!.status, 'queued');
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 2);
});

test('stop cancels queued and active work; late completion cannot restart it', async (t) => {
  const f = setup();
  t.after(f.close);
  f.engine.send(f.room.id, command([f.b.id, f.c.id], { synthesisAgentId: f.a.id }));
  f.engine.pump();
  f.engine.control(f.room.id, 'stop');
  f.provider.releases.forEach((release) => release());
  await new Promise((done) => setImmediate(done));
  f.engine.pump();
  const room = f.store.get(f.room.id);
  assert.equal(room.status, 'stopped');
  assert.ok(room.jobs.every((j) => j.status === 'cancelled'));
  assert.ok(
    room.messages.filter((m) => m.authorId !== 'human').every((m) => m.status === 'cancelled'),
  );
  assert.equal(room.requests[0]!.status, 'cancelled');
  assert.throws(() => f.engine.send(room.id, command([f.b.id])), /Resume/);
  f.engine.control(room.id, 'resume');
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 2);
});

test('updates, mentions, and quoted SEND TO text do not create jobs', (t) => {
  const f = setup();
  t.after(f.close);
  f.engine.send(
    f.room.id,
    command([f.a.id], { type: 'update', body: 'AI B: SEND TO: AI C. This is quoted content.' }),
  );
  f.engine.pump();
  assert.equal(f.store.get(f.room.id).jobs.length, 0);
  assert.equal(f.provider.inputs.length, 0);
});

test('idempotent send IDs return the same message and reject changed payloads', (t) => {
  const f = setup();
  t.after(f.close);
  const input = command([f.b.id]);
  const first = f.engine.send(f.room.id, input);
  const revision = f.store.get(f.room.id).revision;
  assert.deepEqual(f.engine.send(f.room.id, input), first);
  assert.equal(f.store.get(f.room.id).revision, revision);
  assert.equal(f.store.get(f.room.id).messages.length, 1);
  assert.throws(
    () => f.engine.send(f.room.id, { ...input, body: 'Different question.' }),
    /different content/,
  );
});

test('validation rejects impossible quorums, duplicate/unknown recipients, and forged authors', (t) => {
  const f = setup();
  t.after(f.close);
  assert.throws(
    () => f.engine.send(f.room.id, command([f.b.id], { policy: 'quorum', quorum: 2 })),
    /Quorum/,
  );
  assert.throws(() => f.engine.send(f.room.id, command([f.b.id, f.b.id])), /once/);
  assert.throws(() => f.engine.send(f.room.id, command(['unknown'])), /Unknown/);
  assert.throws(
    () => f.engine.send(f.room.id, { ...command([f.b.id]), authorId: f.c.id } as never),
    ZodError,
  );
  assert.equal(f.store.get(f.room.id).messages.length, 0);
});

test('reply IDs and thread IDs are scoped to the current room', (t) => {
  const f = setup();
  t.after(f.close);
  const first = f.engine.send(f.room.id, command([f.b.id]));
  const other = f.engine.createRoom({ title: 'Other', objective: '', maxTurns: 10 });
  assert.throws(
    () => f.engine.send(other.id, command([other.agents[0]!.id], { replyTo: first.messageId })),
    /not in this room/,
  );
  const second = f.engine.send(f.room.id, command([f.c.id]));
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([f.b.id], { replyTo: first.messageId, threadId: second.threadId }),
      ),
    /different thread/,
  );
});

test('quorum closes only after the required distinct answers', async (t) => {
  const f = setup();
  t.after(f.close);
  f.engine.send(f.room.id, command([f.a.id, f.b.id, f.c.id], { policy: 'quorum', quorum: 2 }));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
  assert.equal(f.store.get(f.room.id).requests[0]!.status, 'collecting');
  f.provider.releases[1]!();
  await until(() => f.store.get(f.room.id).requests[0]!.status === 'ready');
  assert.equal(f.store.get(f.room.id).requests[0]!.includedMessageIds.length, 2);
});

test('deadlines survive clock advancement and pause an incomplete round', (t) => {
  let ms = Date.parse('2026-10-01T00:00:00Z');
  const f = setup(100, { now: () => new Date(ms) });
  t.after(f.close);
  f.engine.send(f.room.id, command([f.b.id], { deadlineSeconds: 5 }));
  ms += 6000;
  f.engine.pump();
  const room = f.store.get(f.room.id);
  assert.equal(room.status, 'paused');
  assert.equal(room.requests[0]!.status, 'timed_out');
  assert.equal(room.jobs[0]!.status, 'cancelled');
  assert.equal(f.provider.inputs.length, 0);
});

for (const ending of ['fail', 'empty', 'partial', 'refuse'] as const) {
  test(`${ending} cannot satisfy a response obligation or trigger synthesis`, async (t) => {
    const f = setup();
    t.after(f.close);
    f.provider.endings = [ending];
    f.engine.send(f.room.id, command([f.b.id], { synthesisAgentId: f.a.id }));
    f.engine.pump();
    f.provider.releases[0]!();
    await until(() => f.store.get(f.room.id).requests[0]!.status === 'unresolved');
    const room = f.store.get(f.room.id);
    assert.equal(room.jobs[0]!.status, ending === 'refuse' ? 'refused' : 'failed');
    assert.equal(room.jobs.length, 1);
    assert.equal(room.requests[0]!.includedMessageIds.length, 0);
  });
}

test('explicit retry retains the original failure and rejects duplicate retries', async (t) => {
  const f = setup();
  t.after(f.close);
  f.provider.endings = ['fail', 'complete'];
  f.engine.send(f.room.id, command([f.b.id]));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).requests[0]!.status === 'unresolved');
  const failed = f.store.get(f.room.id).jobs[0]!;
  f.engine.retry(f.room.id, failed.id);
  assert.throws(() => f.engine.retry(f.room.id, failed.id), /newer attempt/);
  f.engine.pump();
  f.provider.releases[1]!();
  await until(() => f.store.get(f.room.id).requests[0]!.status === 'ready');
  assert.equal(f.store.get(f.room.id).jobs[0]!.status, 'failed');
  assert.equal(f.store.get(f.room.id).jobs[1]!.previousJobId, failed.id);
});

test('parallel turns and future synthesis are reserved before dispatch', (t) => {
  const f = setup(2);
  t.after(f.close);
  assert.throws(
    () => f.engine.send(f.room.id, command([f.b.id, f.c.id], { synthesisAgentId: f.a.id })),
    /turn budget/,
  );
  f.engine.send(f.room.id, command([f.b.id, f.c.id]));
  assert.throws(() => f.engine.send(f.room.id, command([f.a.id])), /turn budget/);
  assert.equal(f.store.get(f.room.id).messages.length, 1);
});

test('SQLite recovery retains queues, pauses work, and never auto-replays interrupted attempts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-recovery-'));
  const path = join(directory, 'rooms.sqlite');
  const firstStore = new RoomStore(path);
  const provider = new ControlledProvider();
  const first = new ConversationEngine(firstStore, provider, { autoSchedule: false });
  const room = first.createRoom({ title: 'Persistent', objective: '', maxTurns: 20 });
  first.send(room.id, command([room.agents[1]!.id]));
  first.pump();
  first.send(room.id, command([room.agents[2]!.id]));
  first.close();
  firstStore.close();
  const secondStore = new RoomStore(path);
  const secondProvider = new ControlledProvider();
  const second = new ConversationEngine(secondStore, secondProvider, { autoSchedule: false });
  try {
    const restored = secondStore.get(room.id);
    assert.equal(restored.status, 'paused');
    assert.equal(restored.jobs[0]!.status, 'interrupted');
    assert.equal(restored.jobs[1]!.status, 'queued');
    second.pump();
    assert.equal(secondProvider.inputs.length, 0);
    second.control(room.id, 'resume');
    second.pump();
    assert.equal(secondProvider.inputs.length, 1);
    second.retry(room.id, restored.jobs[0]!.id);
    second.pump();
    assert.equal(secondProvider.inputs.length, 2);
    secondProvider.releases.forEach((release) => release());
    await until(() => secondStore.get(room.id).requests.every((r) => r.status === 'ready'));
  } finally {
    second.close();
    secondStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a second application cannot acquire the same database writer lease', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-lease-'));
  const path = join(directory, 'rooms.sqlite');
  const store = new RoomStore(path);
  try {
    assert.throws(() => new RoomStore(path), /another application/);
  } finally {
    store.close();
  }
  const reopened = new RoomStore(path);
  reopened.close();
  rmSync(directory, { recursive: true, force: true });
});

test('automatic relay preserves A-C-B-A order, exact reply links, and cumulative frozen context', async (t) => {
  const f = setup();
  t.after(f.close);
  const order = [f.a.id, f.c.id, f.b.id, f.a.id];
  f.engine.send(f.room.id, command([f.a.id], { relayOrder: order }));
  for (let i = 0; i < order.length; i++) {
    f.engine.pump();
    assert.equal(f.provider.inputs.length, i + 1);
    const invocation = f.provider.inputs[i]!;
    assert.equal(invocation.agent.id, order[i]);
    assert.deepEqual(invocation.relay, { step: i, total: 4 });
    assert.equal(invocation.snapshot.messages.length, i + 1);
    assert.equal(invocation.prompt, 'Investigate duplicate delivery.');
    f.provider.releases[i]!();
    await until(() => f.store.get(f.room.id).relays[0]!.completedSteps === i + 1);
  }
  const final = f.store.get(f.room.id);
  assert.equal(final.relays[0]!.status, 'completed');
  assert.equal(final.turnsUsed, 4);
  assert.equal(final.requests.length, 4);
  const answers = final.messages.filter((m) => m.type === 'answer');
  assert.deepEqual(
    answers.map((m) => m.authorId),
    order,
  );
  for (let i = 1; i < answers.length; i++) {
    assert.equal(answers[i]!.replyTo, answers[i - 1]!.id);
    assert.deepEqual(answers[i - 1]!.recipientIds, [order[i]!, 'human']);
  }
  assert.deepEqual(answers.at(-1)!.recipientIds, ['human']);
});

test('relay failures block the next hop; an explicit retry advances only once and retains the failure', async (t) => {
  const f = setup();
  t.after(f.close);
  f.provider.endings = ['fail', 'complete', 'complete'];
  f.engine.send(f.room.id, command([f.a.id], { relayOrder: [f.a.id, f.b.id] }));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).relays[0]!.status === 'blocked');
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  f.engine.retry(f.room.id, f.store.get(f.room.id).jobs[0]!.id);
  f.engine.pump();
  f.provider.releases[1]!();
  await until(() => f.store.get(f.room.id).relays[0]!.completedSteps === 1);
  f.engine.pump();
  assert.equal(f.provider.inputs[2]!.agent.id, f.b.id);
  assert.equal(f.provider.inputs[2]!.snapshot.messages.length, 2);
  assert.ok(!f.provider.inputs[2]!.snapshot.messages.some((m) => m.body.endsWith('answer 0.')));
  f.provider.releases[2]!();
  await until(() => f.store.get(f.room.id).relays[0]!.status === 'completed');
  const final = f.store.get(f.room.id);
  assert.equal(final.jobs[0]!.status, 'failed');
  assert.equal(final.jobs.length, 3);
  assert.equal(final.requests.length, 2);
});

test('relay pause holds the next hop; stop cancels it and resume never recreates cancelled hops', async (t) => {
  const f = setup();
  t.after(f.close);
  f.engine.send(f.room.id, command([f.a.id], { relayOrder: [f.a.id, f.c.id, f.b.id] }));
  f.engine.pump();
  f.engine.control(f.room.id, 'pause');
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).relays[0]!.completedSteps === 1);
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  assert.equal(f.store.get(f.room.id).jobs[1]!.status, 'queued');
  f.engine.control(f.room.id, 'stop');
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  assert.equal(f.store.get(f.room.id).relays[0]!.status, 'cancelled');
});

test('a relay reserves every future hop and rejects forged, mixed, or oversized orders atomically', (t) => {
  const f = setup(4);
  t.after(f.close);
  for (const extra of [
    { relayOrder: ['unknown'] },
    { relayOrder: [f.b.id] },
    { relayOrder: [f.a.id], synthesisAgentId: f.c.id },
    { relayOrder: [f.a.id], type: 'update' as const },
    { relayOrder: Array(13).fill(f.a.id) },
  ])
    assert.throws(() => f.engine.send(f.room.id, command([f.a.id], extra)));
  assert.equal(f.store.get(f.room.id).messages.length, 0);
  f.engine.send(f.room.id, command([f.a.id], { relayOrder: [f.a.id, f.c.id, f.b.id, f.a.id] }));
  assert.throws(() => f.engine.send(f.room.id, command([f.b.id])), /turn budget/);
  f.engine.control(f.room.id, 'stop');
  f.engine.control(f.room.id, 'resume');
  f.engine.send(f.room.id, command([f.b.id]));
});

test('relay timeout cancels its future hops and preserves partial output', async (t) => {
  let milliseconds = 0;
  const f = setup(10, { now: () => new Date(milliseconds) });
  t.after(f.close);
  f.engine.send(f.room.id, command([f.a.id], { relayOrder: [f.a.id, f.b.id], deadlineSeconds: 5 }));
  f.engine.pump();
  await until(() => f.store.get(f.room.id).messages[1]!.body.length > 0);
  milliseconds = 6000;
  f.engine.pump();
  const final = f.store.get(f.room.id);
  assert.equal(final.status, 'paused');
  assert.equal(final.relays[0]!.status, 'cancelled');
  assert.equal(final.relays[0]!.completedSteps, 0);
  assert.ok(final.messages[1]!.body);
  assert.equal(final.messages[1]!.status, 'cancelled');
});

test('relay restart keeps the queued next hop and does not replay its completed predecessor', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-relay-recovery-'));
  const path = join(directory, 'rooms.sqlite');
  const store = new RoomStore(path);
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false });
  const room = engine.createRoom({ title: 'Relay recovery', objective: '', maxTurns: 20 });
  const a = room.agents[0]!.id;
  const b = room.agents[1]!.id;
  engine.send(room.id, command([a], { relayOrder: [a, b] }));
  engine.pump();
  provider.releases[0]!();
  await until(() => store.get(room.id).jobs.length === 2);
  engine.close();
  store.close();
  const restoredStore = new RoomStore(path);
  const restoredProvider = new ControlledProvider();
  const restored = new ConversationEngine(restoredStore, restoredProvider, { autoSchedule: false });
  try {
    restored.pump();
    assert.equal(restoredProvider.inputs.length, 0);
    assert.equal(restoredStore.get(room.id).relays[0]!.completedSteps, 1);
    restored.control(room.id, 'resume');
    restored.pump();
    assert.equal(restoredProvider.inputs[0]!.agent.id, b);
    restoredProvider.releases[0]!();
    await until(() => restoredStore.get(room.id).relays[0]!.status === 'completed');
    assert.equal(restoredStore.get(room.id).turnsUsed, 2);
  } finally {
    restored.close();
    restoredStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('participant settings are versioned, validated, persisted, and frozen for existing invocations', async (t) => {
  const f = setup();
  t.after(f.close);
  const settings = {
    agentId: f.b.id,
    name: 'Grok reviewer',
    role: 'Review carefully',
    provider: 'xai' as const,
    model: 'grok-model',
    baseUrl: '',
    maxOutputTokens: 512,
    timeoutSeconds: 30,
  };
  f.engine.configureAgent(f.room.id, settings);
  assert.equal(f.store.get(f.room.id).agents[1]!.configRevision, 1);
  const first = f.engine.send(f.room.id, command([f.b.id]));
  assert.throws(
    () => f.engine.configureAgent(f.room.id, { ...settings, model: 'new-model' }),
    /pending work/,
  );
  f.engine.pump();
  assert.equal(f.provider.inputs[0]!.agent.model, 'grok-model');
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).requests[0]!.status === 'ready');
  f.engine.configureAgent(f.room.id, { ...settings, model: 'new-model' });
  const final = f.store.get(f.room.id);
  assert.equal(final.agents[1]!.model, 'new-model');
  assert.equal(final.agents[1]!.configRevision, 2);
  assert.equal(
    final.snapshots.find(
      (s) => s.id === final.requests.find((r) => r.id === first.requestId)!.snapshotId,
    )!.agents[1]!.model,
    'grok-model',
  );
  assert.throws(
    () => f.engine.configureAgent(f.room.id, { ...settings, agentId: 'unknown' }),
    /Unknown participant/,
  );
});

test('an interrupted relay hop requires explicit retry and keeps its original context after restart', async () => {
  const f = setup();
  let restored: ConversationEngine | undefined;
  try {
    f.engine.send(f.room.id, command([f.a.id], { relayOrder: [f.a.id, f.c.id, f.b.id] }));
    f.engine.pump();
    f.provider.releases[0]!();
    await until(() => f.store.get(f.room.id).relays[0]!.completedSteps === 1);
    f.engine.pump();
    await until(() => f.store.get(f.room.id).messages[2]!.body.length > 0);
    f.engine.close();
    const prior = f.store.get(f.room.id);
    assert.equal(prior.jobs[1]!.status, 'interrupted');
    assert.equal(prior.relays[0]!.status, 'blocked');
    const provider = new ControlledProvider();
    restored = new ConversationEngine(f.store, provider, { autoSchedule: false });
    restored.control(f.room.id, 'resume');
    restored.pump();
    assert.equal(provider.inputs.length, 0);
    restored.retry(f.room.id, prior.jobs[1]!.id);
    restored.pump();
    assert.equal(provider.inputs[0]!.agent.id, f.c.id);
    assert.equal(provider.inputs[0]!.snapshot.messages.length, 2);
    provider.releases[0]!();
    await until(() => f.store.get(f.room.id).relays[0]!.completedSteps === 2);
    restored.pump();
    provider.releases[1]!();
    await until(() => f.store.get(f.room.id).relays[0]!.status === 'completed');
    assert.deepEqual(
      provider.inputs.map((i) => i.agent.id),
      [f.c.id, f.b.id],
    );
    assert.equal(f.store.get(f.room.id).turnsUsed, 4);
  } finally {
    restored?.close();
    f.close();
  }
});

test('connection checks serialize with participant work and do not consume a room turn', async (t) => {
  const f = setup();
  t.after(f.close);
  const check = f.engine.testConnection(f.room.id, f.a.id);
  await assert.rejects(f.engine.testConnection(f.room.id, f.a.id), /busy/);
  f.engine.send(f.room.id, command([f.a.id, f.b.id]));
  f.engine.pump();
  assert.deepEqual(
    f.provider.inputs.map((i) => i.agent.id),
    [f.a.id, f.b.id],
  );
  f.provider.releases[0]!();
  assert.ok((await check).reply);
  assert.equal(f.store.get(f.room.id).turnsUsed, 1);
  f.engine.pump();
  assert.equal(f.provider.inputs[2]!.agent.id, f.a.id);
  f.provider.releases[1]!();
  f.provider.releases[2]!();
  await until(() => f.store.get(f.room.id).requests[0]!.status === 'ready');
  assert.equal(f.store.get(f.room.id).turnsUsed, 2);
});
