import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ConversationEngine } from '../src/server/engine.js';
import { RoomStore } from '../src/server/store.js';
import { serve } from '../src/server/http.js';
import { providerPrompt } from '../src/server/live-providers.js';
import { hasPendingWork, sendSchema, type SendInput } from '../src/shared/contracts.js';
import { command, ControlledProvider, until } from './helpers.js';

function setup(options: { concurrency?: number; maxTurns?: number; path?: string } = {}) {
  let time = Date.parse('2026-10-03T00:00:00Z');
  const now = () => new Date(time);
  const store = new RoomStore(options.path ?? ':memory:', now);
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, {
    now,
    concurrency: options.concurrency,
    autoSchedule: false,
  });
  const room = engine.createRoom({
    title: 'Collection fixture',
    objective: 'Original task',
    humanInstructions: 'Preserve disagreement λ🙂',
    maxTurns: options.maxTurns ?? 100,
  });
  const [a, b, c] = room.agents;
  return {
    store,
    provider,
    engine,
    room,
    a: a!,
    b: b!,
    c: c!,
    now,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
    record: () => store.get(room.id),
    close: () => {
      engine.close();
      store.close();
    },
  };
}
async function finish(f: ReturnType<typeof setup>, index: number) {
  const input = f.provider.inputs[index]!;
  const target = f
    .record()
    .jobs.findLast(
      (job) =>
        job.agentId === input.agent.id &&
        job.kind === input.kind &&
        job.snapshotId === input.snapshot.id,
    )!;
  f.provider.releases[index]!();
  await until(() => f.record().jobs.find((job) => job.id === target.id)?.status === 'completed');
  await until(() => {
    const participant = f.engine
      .activity(f.room.id)
      .participants.find((agent) => agent.agentId === input.agent.id)!;
    return !participant.running.some((job) => job.jobId === target.id) && !participant.finishing;
  });
}
async function lateSet(f: ReturnType<typeof setup>) {
  const sent = f.engine.send(
    f.room.id,
    command([f.b.id, f.c.id], { policy: 'any', synthesisAgentId: f.a.id }),
  );
  f.engine.pump();
  await finish(f, 0);
  f.engine.pump();
  await finish(f, 2);
  await finish(f, 1);
  return sent;
}

for (const remainingWork of ['continue', 'cancel'] as const) {
  test(`deadline collects the full window then freezes its minimum set; remaining work ${remainingWork}`, async (t) => {
    const f = setup();
    t.after(f.close);
    f.engine.send(
      f.room.id,
      command([f.b.id, f.c.id], {
        policy: 'deadline',
        minimumAnswers: 1,
        deadlineSeconds: 5,
        synthesisAgentId: f.a.id,
        remainingWork,
      }),
    );
    f.engine.pump();
    await finish(f, 0);
    assert.equal(f.record().requests[0]!.status, 'collecting');
    assert.equal(f.provider.inputs.length, 2);
    f.advance(4999);
    f.engine.pump();
    assert.equal(f.record().requests[0]!.status, 'collecting');
    f.advance(1);
    f.engine.pump();
    const request = f.record().requests[0]!;
    assert.equal(request.status, 'ready');
    assert.equal(request.collection!.reason, 'deadline');
    assert.equal(request.collection!.incomplete, true);
    assert.equal(f.provider.inputs[2]!.kind, 'synthesis');
    assert.deepEqual(f.provider.inputs[2]!.missingRespondents, ['AI C']);
    assert.equal(f.record().jobs[1]!.status, remainingWork === 'cancel' ? 'cancelled' : 'running');
    const frozen = structuredClone(f.provider.inputs[2]!.snapshot);
    if (remainingWork === 'continue') await finish(f, 1);
    assert.deepEqual(f.provider.inputs[2]!.snapshot, frozen);
    assert.deepEqual(f.record().requests[0]!.includedMessageIds, request.includedMessageIds);
  });
}

test('deadline waits even if every recipient has completed and blocks archive/settings before closure', async (t) => {
  const f = setup();
  t.after(f.close);
  f.engine.send(
    f.room.id,
    command([f.b.id], { policy: 'deadline', minimumAnswers: 1, deadlineSeconds: 5 }),
  );
  f.engine.pump();
  await finish(f, 0);
  assert.ok(hasPendingWork(f.record()));
  assert.throws(() => f.engine.setWorkspaceArchived(f.room.id, { archived: true }));
  assert.throws(() =>
    f.engine.configureWorkspace(f.room.id, {
      title: 'Changed',
      objective: '',
      humanInstructions: '',
      maxTurns: 100,
    }),
  );
  f.advance(5000);
  f.engine.pump();
  assert.equal(f.record().requests[0]!.status, 'ready');
  assert.equal(f.record().requests[0]!.collection!.incomplete, false);
});

test('deadline completion race excludes an event arriving at the boundary before pump', async (t) => {
  const f = setup();
  t.after(f.close);
  f.engine.send(f.room.id, command([f.b.id, f.c.id], { policy: 'deadline', deadlineSeconds: 5 }));
  f.engine.pump();
  await finish(f, 0);
  f.advance(5000);
  await finish(f, 1);
  assert.equal(f.record().requests[0]!.includedMessageIds.length, 1);
  assert.equal(f.record().jobs[1]!.status, 'completed');
});

test('default pause cancels an expired answer before completion can release synthesis', async (t) => {
  const f = setup();
  t.after(f.close);
  f.engine.send(f.room.id, command([f.b.id], { synthesisAgentId: f.a.id, deadlineSeconds: 5 }));
  f.engine.pump();
  f.advance(5000);
  f.provider.releases[0]!();
  await until(() => f.record().jobs[0]!.status === 'cancelled');
  assert.equal(f.record().status, 'paused');
  assert.equal(f.record().requests[0]!.status, 'timed_out');
  assert.equal(f.record().jobs.length, 1);
});

test('wait marks expiry once, retains snapshots and reservations, and never replays a request', async (t) => {
  const f = setup({ concurrency: 1 });
  t.after(f.close);
  f.engine.send(
    f.room.id,
    command([f.b.id, f.c.id], { onTimeout: 'wait', deadlineSeconds: 5, synthesisAgentId: f.a.id }),
  );
  f.engine.pump();
  const original = f.record().snapshots;
  f.engine.control(f.room.id, 'pause');
  f.advance(5000);
  f.engine.pump();
  const waited = f.record();
  assert.equal(waited.status, 'paused');
  assert.ok(waited.requests[0]!.waitingSince);
  assert.deepEqual(waited.snapshots, original);
  f.engine.pump();
  f.engine.pump();
  assert.deepEqual(f.record(), waited);
  assert.equal(f.provider.inputs.length, 1);
  assert.equal(
    f.engine.activity(f.room.id).participants.find((p) => p.agentId === f.a.id)!.prerequisites[0]!
      .deadlineAt,
    null,
  );
  f.engine.control(f.room.id, 'resume');
  await finish(f, 0);
  f.engine.pump();
  await finish(f, 1);
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 3);
  assert.equal(f.record().requests[0]!.status, 'ready');
});

test('wait preserves terminal failures for explicit retry, never counting partial or refused output', async (t) => {
  const f = setup();
  t.after(f.close);
  f.provider.endings[0] = 'fail';
  f.engine.send(f.room.id, command([f.b.id], { onTimeout: 'wait', deadlineSeconds: 5 }));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.record().requests[0]!.status === 'unresolved');
  f.advance(5000);
  f.engine.pump();
  assert.ok(f.record().requests[0]!.waitingSince);
  assert.equal(f.provider.inputs.length, 1);
  f.engine.retry(f.room.id, f.record().jobs[0]!.id);
  assert.equal(f.record().requests[0]!.waitingSince, undefined);
  f.engine.pump();
  await finish(f, 1);
  assert.equal(f.record().requests[0]!.includedMessageIds.length, 1);
});

for (const ending of ['fail', 'refuse', 'partial', 'empty'] as const) {
  test(`incomplete timeout preserves completed answers and missing ${ending} outcome`, async (t) => {
    const f = setup();
    t.after(f.close);
    f.provider.endings[1] = ending;
    f.provider.answers[0] = 'B says retain the existing design.';
    f.provider.answers[1] = 'C says replace the design.';
    f.engine.send(
      f.room.id,
      command([f.b.id, f.c.id], {
        onTimeout: 'incomplete',
        minimumAnswers: 1,
        synthesisAgentId: f.a.id,
        deadlineSeconds: 5,
      }),
    );
    f.engine.pump();
    await finish(f, 0);
    f.provider.releases[1]!();
    await until(() => ['failed', 'refused'].includes(f.record().jobs[1]!.status));
    f.advance(5000);
    f.engine.pump();
    assert.equal(f.record().requests[0]!.collection!.reason, 'incomplete_timeout');
    assert.equal(f.record().status, 'running');
    assert.equal(f.provider.inputs[2]!.includedAnswers.length, 1);
    assert.equal(f.provider.inputs[2]!.snapshot.messages.length, 2);
    assert.equal(
      f.provider.inputs[2]!.collection!.missingRespondents[0]!.status,
      ending === 'refuse' ? 'refused' : 'failed',
    );
    const envelope = providerPrompt(f.provider.inputs[2]!);
    assert.ok(envelope.system.includes('attribute conflicting claims'));
    assert.ok(envelope.system.includes('label the synthesis incomplete'));
    const user = JSON.parse(envelope.user);
    assert.deepEqual(user.collection, f.provider.inputs[2]!.snapshot.collection);
    assert.ok(!user.context.some((message: { body: string }) => message.body.includes('C says')));
  });
}

test('incomplete timeout cancels unfinished work but below-minimum or empty sets still pause', async (t) => {
  const f = setup();
  t.after(f.close);
  f.engine.send(
    f.room.id,
    command([f.b.id, f.c.id], {
      onTimeout: 'incomplete',
      minimumAnswers: 2,
      synthesisAgentId: f.a.id,
      deadlineSeconds: 5,
    }),
  );
  f.engine.pump();
  await finish(f, 0);
  f.advance(5000);
  f.engine.pump();
  assert.equal(f.record().requests[0]!.status, 'timed_out');
  assert.equal(f.record().status, 'paused');
  assert.equal(f.record().jobs.length, 2);
  const g = setup();
  t.after(g.close);
  g.engine.send(g.room.id, command([g.b.id], { onTimeout: 'incomplete', deadlineSeconds: 5 }));
  g.engine.pump();
  g.advance(5000);
  g.engine.pump();
  assert.equal(g.record().requests[0]!.status, 'timed_out');
  assert.equal(g.record().requests[0]!.includedMessageIds.length, 0);
});

for (const policy of ['any', 'quorum'] as const) {
  test(`${policy} cancel policy cancels queued and active remaining recipients without cancelling unrelated work`, async (t) => {
    const f = setup({ concurrency: policy === 'any' ? 1 : 4 });
    t.after(f.close);
    f.engine.send(
      f.room.id,
      command([f.b.id, f.c.id], { policy, quorum: 1, remainingWork: 'cancel' }),
    );
    f.engine.send(f.room.id, command([f.c.id], { body: 'Unrelated task' }));
    f.engine.pump();
    await finish(f, 0);
    assert.equal(f.record().jobs[1]!.status, 'cancelled');
    assert.ok(['queued', 'running'].includes(f.record().jobs[2]!.status));
    assert.equal(f.record().requests[0]!.includedMessageIds.length, 1);
    f.engine.pump();
    assert.ok(
      f.provider.inputs.every(
        (input) =>
          input.prompt !== 'Investigate duplicate delivery.' ||
          input.agent.id !== f.c.id ||
          policy === 'quorum',
      ),
    );
    assert.equal(f.record().requests[0]!.collection!.missingRespondents[0]!.status, 'cancelled');
  });
}

test('strict collection controls reject impossible minima, forged fields, and workflow mixing atomically', (t) => {
  const f = setup();
  t.after(f.close);
  const before = f.record();
  const extras: Partial<SendInput>[] = [
    { minimumAnswers: 2 },
    { minimumAnswers: 0 },
    { policy: 'no_reply' },
    { policy: 'any', minimumAnswers: 2 },
    { policy: 'quorum', quorum: 1, minimumAnswers: 2 },
    { type: 'update', onTimeout: 'wait' },
    { relayOrder: [f.b.id], remainingWork: 'cancel' },
    { discussion: { maxRounds: 1, maxTurns: 5 }, onTimeout: 'wait' },
    { policy: 'deadline', minimumAnswers: 8 },
  ];
  for (const extra of extras) {
    assert.throws(() => f.engine.send(f.room.id, command([f.b.id], extra)));
    assert.deepEqual(f.record(), before);
  }
  assert.throws(() =>
    sendSchema.parse({ ...command([f.b.id]), collection: { incomplete: false } }),
  );
  f.engine.send(f.room.id, command([], { type: 'update', policy: 'no_reply' }));
  assert.equal(f.record().jobs.length, 0);
  assert.equal(f.record().requests.length, 0);
});

test('legacy UUID replay still matches the original canonical hash', (t) => {
  const f = setup();
  t.after(f.close);
  const input = command([f.b.id]);
  const sent = f.engine.send(f.room.id, input);
  const canonical = sendSchema.parse(input);
  delete (canonical as Partial<typeof canonical>).minimumAnswers;
  delete (canonical as Partial<typeof canonical>).onTimeout;
  delete (canonical as Partial<typeof canonical>).remainingWork;
  delete (canonical as Partial<typeof canonical>).relayOrder;
  delete (canonical as Partial<typeof canonical>).discussion;
  delete (canonical as Partial<typeof canonical>).interjection;
  const oldHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  f.store.mutate(f.room.id, (room) => {
    room.messages[0]!.commandHash = oldHash;
    delete room.requests[0]!.onTimeout;
    delete room.requests[0]!.minimumAnswers;
    delete room.requests[0]!.remainingWork;
  });
  const before = f.record();
  assert.deepEqual(f.engine.send(f.room.id, input), sent);
  assert.deepEqual(f.record(), before);
  assert.throws(() => f.engine.send(f.room.id, { ...input, remainingWork: 'cancel' }));
});

test('updated synthesis preserves old sources, closures, output and original bindings; replay consumes no extra turn', async (t) => {
  const f = setup();
  t.after(f.close);
  f.provider.answers[0] = 'B: a duplicate delivery proves the race is present.';
  f.provider.answers[1] = 'C: the trace excludes a duplicate; the race is unresolved.';
  const sent = await lateSet(f);
  const before = f.record();
  const originalSet = structuredClone(before.requests[0]!);
  f.engine.configureWorkspace(f.room.id, {
    title: before.title,
    objective: 'Changed objective',
    humanInstructions: 'Changed instructions',
    maxTurns: 100,
  });
  const input = {
    clientId: randomUUID(),
    requestId: sent.requestId!,
    expectedRevision: f.record().revision,
  };
  const result = f.engine.updatedSynthesis(f.room.id, input);
  const after = f.record();
  assert.deepEqual(after.requests[0], originalSet);
  assert.deepEqual(after.messages.slice(0, before.messages.length), before.messages);
  assert.equal(after.requests[1]!.includedMessageIds.length, 2);
  assert.equal(after.requests[1]!.synthesisRevisionOf, sent.requestId);
  assert.deepEqual(f.engine.updatedSynthesis(f.room.id, input), result);
  assert.deepEqual(f.record(), after);
  f.engine.pump();
  const provider = f.provider.inputs[3]!;
  assert.equal(provider.prompt, 'Investigate duplicate delivery.');
  assert.equal(provider.snapshot.objective, 'Original task');
  assert.equal(provider.snapshot.humanInstructions, 'Preserve disagreement λ🙂');
  assert.equal(provider.includedAnswers.length, 2);
  assert.equal(provider.snapshot.messages.length, 3);
  assert.equal(provider.collection!.reason, 'updated_synthesis');
  const envelope = providerPrompt(provider);
  const data = JSON.parse(envelope.user);
  assert.deepEqual(
    data.includedAnswers.map((answer: { body: string }) => answer.body),
    f.provider.answers.slice(0, 2),
  );
  assert.ok(envelope.system.includes('attribute conflicting claims to their original authors'));
  assert.throws(
    () =>
      f.engine.updatedSynthesis(f.room.id, {
        ...input,
        clientId: randomUUID(),
        expectedRevision: f.record().revision,
      }),
    /already includes/,
  );
  assert.equal(
    provider.snapshot.messages.some((message) => message.type === 'synthesis'),
    false,
  );
  await finish(f, 3);
  assert.throws(
    () =>
      f.engine.updatedSynthesis(f.room.id, {
        ...input,
        clientId: randomUUID(),
        requestId: result.requestId!,
        expectedRevision: f.record().revision,
      }),
    /No new eligible/,
  );
  assert.throws(
    () => f.engine.updatedSynthesis(f.room.id, { ...input, expectedRevision: 0 }),
    /different content/,
  );
});

test('updated synthesis rejects stale reviews, unknown scope, removed synthesizers and budget exhaustion without mutation', async (t) => {
  const f = setup({ maxTurns: 3 });
  t.after(f.close);
  const sent = await lateSet(f);
  const before = f.record();
  for (const [requestId, revision] of [
    [sent.requestId!, 0],
    ['foreign_request', before.revision],
    [sent.requestId!, before.revision],
  ] as const) {
    assert.throws(() =>
      f.engine.updatedSynthesis(f.room.id, {
        clientId: randomUUID(),
        requestId,
        expectedRevision: revision,
      }),
    );
    assert.deepEqual(f.record(), before);
  }
  const g = setup();
  t.after(g.close);
  const other = await lateSet(g);
  g.engine.removeAgent(g.room.id, g.a.id, { expectedRevision: g.record().revision });
  const removed = g.record();
  assert.throws(
    () =>
      g.engine.updatedSynthesis(g.room.id, {
        clientId: randomUUID(),
        requestId: other.requestId!,
        expectedRevision: removed.revision,
      }),
    /unavailable/,
  );
  assert.deepEqual(g.record(), removed);
});

test('updated synthesis transaction rolls back on a forced SQLite write failure', async (t) => {
  const f = setup();
  t.after(f.close);
  const sent = await lateSet(f);
  const before = f.record();
  const db = (f.store as unknown as { db: DatabaseSync }).db;
  db.exec(
    "CREATE TRIGGER reject_revision BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT, 'fixture'); END;",
  );
  assert.throws(() =>
    f.engine.updatedSynthesis(f.room.id, {
      clientId: randomUUID(),
      requestId: sent.requestId!,
      expectedRevision: before.revision,
    }),
  );
  assert.deepEqual(f.record(), before);
  db.exec('DROP TRIGGER reject_revision;');
});

test('deadline, explicit wait and synthesis revisions persist through disk restart without automatic dispatch', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-collection-'));
  const f = setup({ path: join(directory, 'rooms.sqlite') });
  let reopenedStore: RoomStore | undefined;
  let reopenedEngine: ConversationEngine | undefined;
  t.after(() => {
    reopenedEngine?.close();
    reopenedStore?.close();
    f.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const sent = await lateSet(f);
  const result = f.engine.updatedSynthesis(f.room.id, {
    clientId: randomUUID(),
    requestId: sent.requestId!,
    expectedRevision: f.record().revision,
  });
  f.engine.send(
    f.room.id,
    command([f.b.id], { policy: 'deadline', onTimeout: 'wait', deadlineSeconds: 5 }),
  );
  f.advance(5000);
  f.engine.pump();
  const before = f.record();
  f.close();
  const store = new RoomStore(join(directory, 'rooms.sqlite'), f.now);
  reopenedStore = store;
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false, now: f.now });
  reopenedEngine = engine;
  const saved = store.get(f.room.id);
  assert.equal(saved.status, 'paused');
  assert.deepEqual(
    saved.requests.find((request) => request.id === result.requestId)!.collection,
    before.requests[1]!.collection,
  );
  assert.ok(saved.requests.at(-1)!.waitingSince);
  engine.pump();
  assert.equal(provider.inputs.length, 0);
  engine.deleteThread(f.room.id, sent.threadId);
  assert.equal(
    store.get(f.room.id).requests.some((request) => request.id === result.requestId),
    false,
  );
});

test('updated-synthesis HTTP endpoint enforces session, origin, strict scope and exports frozen closure facts', async (t) => {
  const f = setup();
  t.after(f.close);
  const sent = await lateSet(f);
  const app = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}`;
  const { token } = (await (await fetch(base + '/api/session')).json()) as { token: string };
  const headers = { 'X-AIB-Token': token, 'Content-Type': 'application/json' };
  const url = `${base}/api/rooms/${f.room.id}/updated-synthesis`;
  const input = {
    clientId: randomUUID(),
    requestId: sent.requestId!,
    expectedRevision: f.record().revision,
  };
  assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify(input) })).status, 401);
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { ...headers, Origin: 'https://evil.example' },
        body: JSON.stringify(input),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...input, includedMessageIds: [] }),
      })
    ).status,
    400,
  );
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(response.status, 201);
  const duplicate = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) });
  assert.deepEqual(await duplicate.json(), await response.json());
  const exported = await (await fetch(`${base}/api/rooms/${f.room.id}/export`, { headers })).text();
  assert.ok(exported.includes('Frozen collection:'));
  assert.ok(exported.includes('preserve_and_identify'));
});
