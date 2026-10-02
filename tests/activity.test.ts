import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { get } from 'node:http';
import { test } from 'node:test';
import { ConversationEngine } from '../src/server/engine.js';
import { serve } from '../src/server/http.js';
import { RoomStore } from '../src/server/store.js';
import type { ProviderAdapter, ProviderEvent } from '../src/server/providers.js';
import { command, ControlledProvider, until } from './helpers.js';

function fixture(options: { concurrency?: number; now?: () => Date } = {}) {
  const store = new RoomStore(':memory:', options.now);
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false, ...options });
  const room = engine.createRoom({ title: 'Activity', objective: 'PRIVATE OBJECTIVE' });
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

test('inspection preserves stored order, exact thread IDs, frozen bindings, and all durable state', (t) => {
  const f = fixture();
  t.after(f.close);
  f.engine.control(f.room.id, 'pause');
  const first = f.engine.send(f.room.id, command([f.b.id], { body: 'PRIVATE BODY ONE' }));
  const second = f.engine.send(f.room.id, command([f.b.id], { body: 'PRIVATE BODY TWO' }));
  f.engine.renameThread(f.room.id, first.threadId, { title: '<img src=x onerror=evil()> & queue' });
  f.engine.renameThread(f.room.id, second.threadId, { title: 'Other queue' });
  const before = f.store.get(f.room.id);
  const activity = f.engine.activity(f.room.id);
  const queue = activity.participants.find((p) => p.agentId === f.b.id)!.queued;
  assert.deepEqual(
    queue.map((job) => [job.position, job.threadId]),
    [
      [1, first.threadId],
      [2, second.threadId],
    ],
  );
  assert.equal(queue[0]!.threadTitle, '<img src=x onerror=evil()> & queue');
  assert.deepEqual(queue[0]!.blockers, ['workspace_paused']);
  assert.deepEqual(queue[1]!.blockers, ['workspace_paused', 'earlier_job']);
  assert.equal(queue[0]!.provider, 'simulated');
  assert.equal(queue[0]!.model, 'simulation-v1');
  assert.equal(queue[0]!.createdAt, before.jobs[0]!.createdAt);
  assert.equal(activity.roomRevision, before.revision);
  assert.ok(!JSON.stringify(activity).includes('PRIVATE'));
  f.engine.activity(f.room.id);
  assert.deepEqual(f.store.get(f.room.id), before);
  assert.equal(f.provider.inputs.length, 0);
});

test('running work holds its participant, completes in stored order, and broadcasts released capacity', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.engine.send(f.room.id, command([f.b.id]));
  const next = f.engine.send(f.room.id, command([f.b.id]));
  f.engine.pump();
  let activity = f.engine.activity(f.room.id);
  assert.deepEqual(activity.capacity, { inUse: 1, limit: 4 });
  const b = activity.participants.find((p) => p.agentId === f.b.id)!;
  assert.equal(b.running.length, 1);
  assert.equal(b.queued[0]!.threadId, next.threadId);
  assert.deepEqual(b.queued[0]!.blockers, ['participant_busy']);
  const observations: number[] = [];
  f.engine.on('changed', () => observations.push(f.engine.activity(f.room.id).capacity.inUse));
  f.provider.releases[0]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  assert.equal(observations.at(-1), 0);
  activity = f.engine.activity(f.room.id);
  assert.deepEqual(
    activity.participants.find((p) => p.agentId === f.b.id)!.queued[0]!.blockers,
    [],
  );
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 2);
  assert.equal(f.store.get(f.room.id).jobs[1]!.status, 'running');
});

test('global capacity includes other workspaces without exposing their records or identities', (t) => {
  const f = fixture({ concurrency: 1 });
  t.after(f.close);
  f.engine.send(f.room.id, command([f.a.id], { body: 'FOREIGN BODY' }));
  const other = f.engine.createRoom({ title: 'Other', objective: '' });
  f.engine.send(other.id, command([other.agents[0]!.id]));
  f.engine.pump();
  const activity = f.engine.activity(other.id);
  assert.deepEqual(activity.capacity, { inUse: 1, limit: 1 });
  assert.deepEqual(activity.participants[0]!.queued[0]!.blockers, ['service_capacity']);
  const text = JSON.stringify(activity);
  assert.ok(!text.includes(f.room.id));
  assert.ok(!text.includes(f.a.id));
  assert.ok(!text.includes('FOREIGN'));
});

test('completed transport cleanup still occupies a slot until it actually finishes', async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const provider: ProviderAdapter = {
    id: 'cleanup-fixture',
    capabilities: { streaming: true, cancellation: true, remote: false },
    async *generate(): AsyncIterable<ProviderEvent> {
      try {
        yield { type: 'delta', text: 'Completed answer.' };
        yield { type: 'complete' };
      } finally {
        await gate;
      }
    },
  };
  const store = new RoomStore(':memory:');
  const engine = new ConversationEngine(store, provider, { autoSchedule: false, concurrency: 1 });
  t.after(() => {
    release();
    engine.close();
    store.close();
  });
  const room = engine.createRoom({ title: 'Cleanup', objective: '' });
  engine.send(room.id, command([room.agents[0]!.id]));
  engine.send(room.id, command([room.agents[0]!.id]));
  engine.pump();
  await until(() => store.get(room.id).jobs[0]!.status === 'completed');
  const activity = engine.activity(room.id);
  assert.equal(activity.participants[0]!.running.length, 0);
  assert.equal(activity.participants[0]!.finishing, true);
  assert.deepEqual(activity.participants[0]!.queued[0]!.blockers, [
    'participant_busy',
    'service_capacity',
  ]);
  release();
  await until(() => engine.activity(room.id).capacity.inUse === 0);
  assert.equal(engine.activity(room.id).participants[0]!.finishing, false);
});

test('connection checks are transient occupancy, hold queued work, and broadcast both boundaries', async (t) => {
  const f = fixture();
  t.after(f.close);
  const observations: number[] = [];
  f.engine.on('changed', () => observations.push(f.engine.activity(f.room.id).capacity.inUse));
  const before = f.store.get(f.room.id);
  const checking = f.engine.testConnection(f.room.id, f.b.id);
  assert.equal(f.engine.activity(f.room.id).participants[1]!.checkingConnection, true);
  assert.deepEqual(f.store.get(f.room.id), before);
  f.engine.send(f.room.id, command([f.b.id]));
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  assert.deepEqual(f.engine.activity(f.room.id).participants[1]!.queued[0]!.blockers, [
    'connection_check',
  ]);
  f.provider.releases[0]!();
  await checking;
  assert.equal(f.engine.activity(f.room.id).participants[1]!.checkingConnection, false);
  assert.equal(observations[0], 1);
  assert.equal(observations.at(-1), 0);
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 2);
});

for (const policy of ['all', 'any', 'quorum'] as const) {
  test(`${policy} synthesis prerequisites use eligible latest responses and disappear only on actual queue creation`, async (t) => {
    let now = new Date('2026-10-01T12:00:00Z');
    const f = fixture({ now: () => now });
    t.after(f.close);
    f.engine.send(
      f.room.id,
      command([f.b.id, f.c.id], {
        policy,
        quorum: 2,
        synthesisAgentId: f.a.id,
        deadlineSeconds: 5,
      }),
    );
    let a = f.engine.activity(f.room.id).participants[0]!;
    assert.equal(a.queued.length, 0);
    assert.equal(a.prerequisites[0]!.required, policy === 'any' ? 1 : 2);
    assert.equal(a.prerequisites[0]!.received, 0);
    f.engine.pump();
    f.engine.control(f.room.id, 'pause');
    f.provider.releases[0]!();
    await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
    if (policy !== 'any') {
      a = f.engine.activity(f.room.id).participants[0]!;
      assert.equal(a.prerequisites[0]!.received, 1);
      assert.deepEqual(
        a.prerequisites[0]!.respondents.map((r) => r.status),
        ['completed', 'running'],
      );
      f.provider.releases[1]!();
    }
    await until(() => f.store.get(f.room.id).requests[0]!.status === 'ready');
    now = new Date('2026-10-01T12:00:10Z');
    a = f.engine.activity(f.room.id).participants[0]!;
    assert.equal(a.prerequisites.length, 0);
    assert.equal(a.queued[0]!.kind, 'synthesis');
    assert.equal(
      a.queued[0]!.deadlineAt,
      null,
      'A closed response set deadline does not block queued synthesis or late answers.',
    );
    assert.deepEqual(a.queued[0]!.blockers, ['workspace_paused']);
    f.engine.control(f.room.id, 'resume');
    f.engine.pump();
    assert.ok(f.provider.inputs.some((input) => input.kind === 'synthesis'));
  });
}

for (const ending of ['fail', 'refuse', 'partial'] as const) {
  test(`${ending} cannot satisfy a synthesis prerequisite or become a numbered queue entry`, async (t) => {
    const f = fixture();
    t.after(f.close);
    f.provider.endings[0] = ending;
    f.engine.send(f.room.id, command([f.b.id], { synthesisAgentId: f.a.id }));
    f.engine.pump();
    f.provider.releases[0]!();
    await until(() => f.store.get(f.room.id).requests[0]!.status === 'unresolved');
    const a = f.engine.activity(f.room.id).participants[0]!;
    assert.equal(a.queued.length, 0);
    assert.equal(a.prerequisites[0]!.received, 0);
    assert.equal(a.prerequisites[0]!.status, 'unresolved');
    assert.equal(a.prerequisites[0]!.deadlineAt, null);
    assert.equal(
      a.prerequisites[0]!.respondents[0]!.status,
      ending === 'refuse' ? 'refused' : 'failed',
    );
  });
}

test('coordinator peer barriers report failures, preserve exact policy, and clear after explicit retry', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.provider.actions[0] = {
    kind: 'ask',
    body: 'Review this.',
    recipientIds: [f.b.id, f.c.id],
    policy: 'all',
    quorum: 1,
    replyTo: null,
  };
  f.engine.send(f.room.id, command([f.a.id], { discussion: { maxRounds: 2, maxTurns: 8 } }));
  f.engine.pump();
  f.engine.control(f.room.id, 'pause');
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).discussions[0]!.status === 'waiting');
  let a = f.engine.activity(f.room.id).participants[0]!;
  assert.equal(a.queued.length, 0);
  assert.equal(a.prerequisites[0]!.kind, 'coordinator');
  assert.equal(a.prerequisites[0]!.required, 2);
  assert.deepEqual(
    a.prerequisites[0]!.respondents.map((r) => r.status),
    ['queued', 'queued'],
  );
  f.provider.endings[1] = 'fail';
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  f.provider.releases[1]!();
  f.provider.releases[2]!();
  await until(() => f.store.get(f.room.id).discussions[0]!.status === 'blocked');
  a = f.engine.activity(f.room.id).participants[0]!;
  assert.equal(a.prerequisites[0]!.status, 'unresolved');
  assert.equal(a.prerequisites[0]!.received, 1);
  const failed = f.store.get(f.room.id).jobs.find((j) => j.status === 'failed')!;
  f.engine.control(f.room.id, 'pause');
  f.engine.retry(f.room.id, failed.id);
  assert.equal(
    f.engine.activity(f.room.id).participants[0]!.prerequisites[0]!.respondents[0]!.status,
    'queued',
  );
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  f.provider.releases[3]!();
  await until(() => f.store.get(f.room.id).discussions[0]!.status === 'running');
  a = f.engine.activity(f.room.id).participants[0]!;
  assert.equal(a.prerequisites.length, 0);
  assert.equal(a.queued[0]!.kind, 'decision');
});

test('elapsed deadlines are explained without inspection expiring, dispatching, or consuming turns', (t) => {
  let now = new Date('2026-10-01T12:00:00Z');
  const f = fixture({ now: () => now });
  t.after(f.close);
  f.engine.send(f.room.id, command([f.b.id], { deadlineSeconds: 5 }));
  now = new Date('2026-10-01T12:00:06Z');
  const before = f.store.get(f.room.id);
  assert.deepEqual(f.engine.activity(f.room.id).participants[1]!.queued[0]!.blockers, [
    'deadline_elapsed',
  ]);
  assert.deepEqual(f.store.get(f.room.id), before);
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 0);
  assert.equal(f.engine.activity(f.room.id).participants[1]!.queued.length, 0);
  assert.equal(f.store.get(f.room.id).turnsUsed, 0);
});

test('retry queue bindings and prerequisite attribution retain the original saved configuration', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.provider.endings[0] = 'fail';
  f.engine.send(f.room.id, command([f.b.id], { synthesisAgentId: f.a.id }));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  const failed = f.store.get(f.room.id).jobs[0]!;
  f.engine.configureAgent(f.room.id, {
    agentId: f.b.id,
    name: 'Renamed participant',
    role: f.b.role,
    provider: 'simulated',
    model: 'new-simulation',
  });
  f.engine.control(f.room.id, 'pause');
  f.engine.retry(f.room.id, failed.id);
  const activity = f.engine.activity(f.room.id);
  assert.equal(activity.participants[1]!.queued[0]!.model, 'simulation-v1');
  assert.equal(activity.participants[0]!.prerequisites[0]!.respondents[0]!.name, 'AI B');
  assert.equal(f.store.get(f.room.id).agents[1]!.model, 'new-simulation');
});

test('defensive archive, inactive, and exhausted-limit holds remain explanations rather than authority', (t) => {
  const f = fixture();
  t.after(f.close);
  f.engine.send(f.room.id, command([f.a.id], { discussion: { maxRounds: 1, maxTurns: 2 } }));
  f.store.mutate(f.room.id, (room) => {
    room.archivedAt = new Date().toISOString();
    room.status = 'stopped';
    room.agents[0]!.active = false;
    room.turnsUsed = room.maxTurns;
    room.discussions[0]!.status = 'cancelled';
    room.discussions[0]!.turnsUsed = 2;
  });
  const before = f.store.get(f.room.id);
  assert.deepEqual(f.engine.activity(f.room.id).participants[0]!.queued[0]!.blockers, [
    'workspace_archived',
    'workspace_stopped',
    'participant_inactive',
    'turn_limit',
    'discussion_closed',
    'discussion_turn_limit',
  ]);
  assert.deepEqual(f.store.get(f.room.id), before);
  assert.equal(f.provider.inputs.length, 0);
});

test('disk recovery keeps queued order, labels interrupted prerequisites, and never replays on inspection', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-activity-'));
  const path = join(directory, 'rooms.sqlite');
  let store = new RoomStore(path);
  let provider = new ControlledProvider();
  let engine = new ConversationEngine(store, provider, { autoSchedule: false });
  t.after(() => {
    engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const room = engine.createRoom({ title: 'Recovery', objective: '' });
  engine.send(room.id, command([room.agents[1]!.id], { synthesisAgentId: room.agents[0]!.id }));
  const second = engine.send(room.id, command([room.agents[1]!.id]));
  engine.pump();
  engine.close();
  await new Promise((done) => setImmediate(done));
  store.close();
  store = new RoomStore(path);
  provider = new ControlledProvider();
  engine = new ConversationEngine(store, provider, { autoSchedule: false });
  const before = store.get(room.id);
  const activity = engine.activity(room.id);
  assert.equal(activity.participants[1]!.running.length, 0);
  assert.equal(activity.participants[1]!.queued[0]!.threadId, second.threadId);
  assert.deepEqual(activity.participants[1]!.queued[0]!.blockers, ['workspace_paused']);
  assert.equal(activity.participants[0]!.prerequisites[0]!.respondents[0]!.status, 'interrupted');
  assert.deepEqual(store.get(room.id), before);
  assert.equal(provider.inputs.length, 0);
});

test('deletion removes queue source data; archived and empty history remain inspectable', (t) => {
  const f = fixture();
  t.after(f.close);
  const source = f.engine.send(
    f.room.id,
    command([f.b.id], { synthesisAgentId: f.a.id, body: 'Delete this source' }),
  );
  f.engine.deleteThread(f.room.id, source.threadId);
  let activity = f.engine.activity(f.room.id);
  assert.ok(!JSON.stringify(activity).includes(source.threadId));
  assert.ok(
    activity.participants.every(
      (p) => !p.queued.length && !p.running.length && !p.prerequisites.length,
    ),
  );
  f.engine.setAgentActive(f.room.id, f.c.id, { active: false });
  f.engine.setWorkspaceArchived(f.room.id, { archived: true });
  const before = f.store.get(f.room.id);
  activity = f.engine.activity(f.room.id);
  assert.equal(activity.participants.length, 3);
  assert.deepEqual(f.store.get(f.room.id), before);
  f.engine.deleteRoom(f.room.id);
  assert.throws(() => f.engine.activity(f.room.id), /not found/);
});

test('activity HTTP reads enforce session, host, origin, scope, methods, and expose the current release', async (t) => {
  const f = fixture();
  t.after(f.close);
  const app = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}`;
  const session = (await (await fetch(`${base}/api/session`)).json()) as {
    token: string;
    version: string;
  };
  assert.equal(session.version, JSON.parse(readFileSync('package.json', 'utf8')).version);
  const headers = { 'X-AIB-Token': session.token };
  const url = `${base}/api/rooms/${f.room.id}/activity`;
  assert.equal((await fetch(url)).status, 401);
  const invalidHostStatus = await new Promise<number | undefined>((done, reject) => {
    get(url, { headers: { ...headers, Host: 'evil.example' } }, (response) => {
      response.resume();
      response.on('end', () => done(response.statusCode));
    }).on('error', reject);
  });
  assert.equal(invalidHostStatus, 403);
  assert.equal(
    (await fetch(url, { headers: { ...headers, Origin: 'https://evil.example' } })).status,
    403,
  );
  assert.equal(
    (await fetch(url, { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status,
    403,
  );
  assert.equal((await fetch(`${base}/api/rooms/foreign/activity`, { headers })).status, 404);
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 405);
  const before = f.store.get(f.room.id);
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).roomId, f.room.id);
  assert.deepEqual(f.store.get(f.room.id), before);
  assert.equal(f.provider.inputs.length, 0);
});
