import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type { Room, RoomSummary, SendInput } from '../src/shared/contracts.js';
import { searchThreads, searchWorkspaces } from '../src/client/search.js';
import { ConversationEngine } from '../src/server/engine.js';
import { RoomStore } from '../src/server/store.js';
import { serve } from '../src/server/http.js';
import { command, ControlledProvider, until } from './helpers.js';

function fixture() {
  const store = new RoomStore(':memory:');
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false });
  const room = engine.createRoom({ title: 'Organized workspace', objective: 'Preserve evidence' });
  return {
    store,
    provider,
    engine,
    room,
    close: () => {
      engine.close();
      store.close();
    },
  };
}

test('archive and restore preserve history and usage, retain one archive time, and never resume implicitly', async (t) => {
  const f = fixture();
  t.after(f.close);
  const result = f.engine.send(f.room.id, command([f.room.agents[0]!.id]));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
  const before = f.store.get(f.room.id);
  let changes = 0;
  f.engine.on('changed', () => {
    changes++;
  });
  const archived = f.engine.setWorkspaceArchived(f.room.id, { archived: true });
  assert.equal(archived.status, 'paused');
  assert.ok(archived.archivedAt);
  assert.equal(f.store.list()[0]!.archivedAt, archived.archivedAt);
  for (const key of [
    'agents',
    'agentRevisions',
    'threads',
    'messages',
    'requests',
    'jobs',
    'snapshots',
    'relays',
    'discussions',
    'turnsUsed',
    'maxTurns',
  ] as const)
    assert.deepEqual(archived[key], before[key], key);
  assert.equal(
    f.engine.setWorkspaceArchived(f.room.id, { archived: true }).archivedAt,
    archived.archivedAt,
  );
  assert.equal(f.store.get(f.room.id).events.filter((e) => e.type === 'room.archived').length, 1);
  const restored = f.engine.setWorkspaceArchived(f.room.id, { archived: false });
  assert.equal(restored.archivedAt, null);
  assert.equal(restored.status, 'paused');
  assert.equal(restored.threads[0]!.id, result.threadId);
  assert.equal(restored.turnsUsed, 1);
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  f.engine.send(f.room.id, command([f.room.agents[0]!.id], { threadId: result.threadId }));
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1, 'Restored paused work must wait for Resume');
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 2);
  f.provider.releases[1]!();
  await until(() => f.store.get(f.room.id).jobs[1]!.status === 'completed');
  assert.ok(changes >= 3);
  f.engine.setWorkspaceArchived(f.room.id, { archived: false });
  assert.equal(
    f.store.get(f.room.id).status,
    'running',
    'A no-op restore cannot pause an open room',
  );
});

test('queued, paused, and streaming obligations prevent archive atomically; Stop releases the lock', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.engine.send(f.room.id, command([f.room.agents[0]!.id]));
  let before = f.store.get(f.room.id);
  assert.throws(() => f.engine.setWorkspaceArchived(f.room.id, { archived: true }), /pending work/);
  assert.deepEqual(f.store.get(f.room.id), before);
  f.engine.control(f.room.id, 'pause');
  before = f.store.get(f.room.id);
  assert.throws(() => f.engine.setWorkspaceArchived(f.room.id, { archived: true }), /pending work/);
  assert.deepEqual(f.store.get(f.room.id), before);
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  await until(() =>
    f.store.get(f.room.id).messages.some((m) => m.status === 'streaming' && m.body),
  );
  before = f.store.get(f.room.id);
  assert.throws(() => f.engine.setWorkspaceArchived(f.room.id, { archived: true }), /pending work/);
  assert.deepEqual(f.store.get(f.room.id), before);
  f.engine.control(f.room.id, 'stop');
  assert.ok(f.engine.setWorkspaceArchived(f.room.id, { archived: true }).archivedAt);
  assert.equal(f.store.get(f.room.id).turnsUsed, 1);
});

for (const mode of ['relay', 'discussion'] as const) {
  test(`a failed ${mode} still blocks archiving until its obligations are stopped`, async (t) => {
    const f = fixture();
    t.after(f.close);
    f.provider.endings[0] = 'fail';
    const a = f.room.agents[0]!.id;
    const extra: Partial<SendInput> =
      mode === 'relay'
        ? { relayOrder: [a, f.room.agents[1]!.id] }
        : { discussion: { maxRounds: 2, maxTurns: 5 } };
    f.engine.send(f.room.id, command([a], extra));
    f.engine.pump();
    f.provider.releases[0]!();
    await until(() => f.store.get(f.room.id).jobs[0]!.status === 'failed');
    const before = f.store.get(f.room.id);
    assert.throws(
      () => f.engine.setWorkspaceArchived(f.room.id, { archived: true }),
      /pending work/,
    );
    assert.deepEqual(f.store.get(f.room.id), before);
    f.engine.control(f.room.id, 'stop');
    assert.ok(f.engine.setWorkspaceArchived(f.room.id, { archived: true }).archivedAt);
  });
}

test('workspace probes prevent archive but a probe in another workspace does not', async (t) => {
  const f = fixture();
  t.after(f.close);
  const checking = f.engine.testConnection(f.room.id, f.room.agents[1]!.id);
  const before = f.store.get(f.room.id);
  assert.throws(() => f.engine.setWorkspaceArchived(f.room.id, { archived: true }), /pending work/);
  assert.deepEqual(f.store.get(f.room.id), before);
  const other = f.engine.createRoom({ title: 'Other workspace' });
  assert.ok(f.engine.setWorkspaceArchived(other.id, { archived: true }).archivedAt);
  f.provider.releases[0]!();
  await checking;
  assert.ok(f.engine.setWorkspaceArchived(f.room.id, { archived: true }).archivedAt);
});

test('archived commands reject edits, sends, retries, controls, and probes without mutating or invoking', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.provider.endings[0] = 'fail';
  const input = command([f.room.agents[0]!.id]);
  const sent = f.engine.send(f.room.id, input);
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'failed');
  f.engine.setWorkspaceArchived(f.room.id, { archived: true });
  const before = f.store.get(f.room.id);
  const agent = before.agents[0]!;
  const commands = [
    () => f.engine.send(f.room.id, command([agent.id])),
    () => f.engine.send(f.room.id, input),
    () => f.engine.send(f.room.id, command([], { type: 'update' })),
    () => f.engine.control(f.room.id, 'resume'),
    () => f.engine.control(f.room.id, 'pause'),
    () => f.engine.control(f.room.id, 'stop'),
    () => f.engine.retry(f.room.id, before.jobs[0]!.id),
    () => f.engine.stopDiscussion(f.room.id, 'unknown'),
    () =>
      f.engine.configureWorkspace(f.room.id, {
        title: 'Forged edit',
        objective: '',
        maxTurns: 100,
      }),
    () =>
      f.engine.configureAgent(f.room.id, {
        agentId: agent.id,
        name: agent.name,
        role: agent.role,
        provider: agent.provider,
        model: agent.model,
      }),
    () => f.engine.addAgent(f.room.id, { name: 'New', role: 'New role' }),
    () => f.engine.setAgentActive(f.room.id, agent.id, { active: false }),
    () => f.engine.renameThread(f.room.id, sent.threadId, { title: 'Edited' }),
    () => f.engine.deleteThread(f.room.id, sent.threadId),
  ];
  for (const action of commands) {
    assert.throws(action, /Restore this archived workspace/);
    assert.deepEqual(f.store.get(f.room.id), before);
  }
  await assert.rejects(
    f.engine.testConnection(f.room.id, agent.id),
    /Restore this archived workspace/,
  );
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  assert.deepEqual(f.store.get(f.room.id), before);
});

test('restoring a failed request preserves its original retry binding and waits for explicit resume', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.provider.endings[0] = 'fail';
  f.engine.send(f.room.id, command([f.room.agents[0]!.id]));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'failed');
  const original = f.provider.inputs[0]!;
  const failed = f.store.get(f.room.id).jobs[0]!;
  f.engine.configureAgent(f.room.id, {
    agentId: original.agent.id,
    name: 'New name',
    role: 'Changed role',
    model: 'simulation-v2',
    provider: 'simulated',
  });
  f.engine.setWorkspaceArchived(f.room.id, { archived: true });
  f.engine.setWorkspaceArchived(f.room.id, { archived: false });
  f.engine.retry(f.room.id, failed.id);
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  const retried = f.provider.inputs[1]!;
  assert.deepEqual(retried.agent, original.agent);
  assert.deepEqual(retried.snapshot, original.snapshot);
  f.provider.releases[1]!();
  await until(() => f.store.get(f.room.id).jobs[1]!.status === 'completed');
});

test('archive flags and thread names survive disk restart while legacy rooms remain open', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-archive-'));
  const path = join(directory, 'rooms.sqlite');
  let store = new RoomStore(path);
  let engine = new ConversationEngine(store, new ControlledProvider(), { autoSchedule: false });
  try {
    const legacy = engine.createRoom({ title: 'Legacy' });
    store.mutate(legacy.id, (room) => {
      delete room.archivedAt;
    });
    const room = engine.createRoom({ title: 'Persisted archive' });
    const sent = engine.send(room.id, command([], { type: 'update', body: 'Keep me for export' }));
    engine.renameThread(room.id, sent.threadId, { title: 'Retained thread name' });
    const archived = engine.setWorkspaceArchived(room.id, { archived: true });
    engine.close();
    store.close();
    store = new RoomStore(path);
    engine = new ConversationEngine(store, new ControlledProvider(), { autoSchedule: false });
    const recovered = store.get(room.id);
    assert.equal(recovered.archivedAt, archived.archivedAt);
    assert.equal(recovered.status, 'paused');
    assert.equal(recovered.threads[0]!.title, 'Retained thread name');
    assert.deepEqual(recovered.messages, archived.messages);
    assert.deepEqual(recovered.snapshots, archived.snapshots);
    assert.equal(store.list().find((r) => r.id === legacy.id)!.archivedAt, null);
    engine.send(legacy.id, command([], { type: 'update' }));
    engine.setWorkspaceArchived(room.id, { archived: false });
    engine.close();
    store.close();
    store = new RoomStore(path);
    engine = new ConversationEngine(store, new ControlledProvider(), { autoSchedule: false });
    assert.equal(store.get(room.id).archivedAt, null);
    assert.equal(store.get(room.id).status, 'paused');
  } finally {
    engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('scheduler and recovery refuse an archived legacy room even with a stale running flag and queued work', (t) => {
  const f = fixture();
  let recovered: ConversationEngine | null = null;
  t.after(() => {
    recovered?.close();
    f.close();
  });
  f.engine.send(f.room.id, command([f.room.agents[0]!.id]));
  f.store.mutate(f.room.id, (room) => {
    room.archivedAt = new Date().toISOString();
    room.status = 'running';
  });
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 0);
  assert.equal(f.store.get(f.room.id).turnsUsed, 0);
  f.engine.close();
  recovered = new ConversationEngine(f.store, f.provider, { autoSchedule: false });
  assert.equal(f.store.get(f.room.id).status, 'paused');
  recovered.pump();
  assert.equal(f.provider.inputs.length, 0);
  recovered.setWorkspaceArchived(f.room.id, { archived: false });
  recovered.pump();
  assert.equal(f.provider.inputs.length, 0);
  assert.equal(f.store.get(f.room.id).jobs[0]!.status, 'queued');
});

test('renaming a streaming thread changes only its label, retains bindings and links, and validates scope atomically', async (t) => {
  const f = fixture();
  t.after(f.close);
  const result = f.engine.send(f.room.id, command([f.room.agents[0]!.id]));
  f.engine.pump();
  await until(() =>
    f.store.get(f.room.id).messages.some((m) => m.status === 'streaming' && m.body),
  );
  const before = f.store.get(f.room.id);
  let changed = false;
  f.engine.on('changed', () => {
    changed = true;
  });
  const after = f.engine.renameThread(f.room.id, result.threadId, { title: '  Evidence review  ' });
  assert.equal(after.threads[0]!.title, 'Evidence review');
  assert.equal(after.threads[0]!.id, result.threadId);
  for (const key of [
    'messages',
    'requests',
    'jobs',
    'snapshots',
    'agents',
    'turnsUsed',
    'status',
  ] as const)
    assert.deepEqual(after[key], before[key], key);
  assert.ok(changed);
  for (const raw of [
    { title: '' },
    { title: ' '.repeat(4) },
    { title: 'x'.repeat(101) },
    { title: 'Fake', threadId: 'another' },
  ]) {
    assert.throws(() => f.engine.renameThread(f.room.id, result.threadId, raw));
    assert.deepEqual(f.store.get(f.room.id), after);
  }
  const other = f.engine.createRoom({ title: 'Scoped' });
  const otherBefore = f.store.get(other.id);
  assert.throws(
    () => f.engine.renameThread(other.id, result.threadId, { title: 'Wrong workspace' }),
    /Thread not found/,
  );
  assert.deepEqual(f.store.get(other.id), otherBefore);
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
  const answer = f.store.get(f.room.id).messages.at(-1)!;
  f.engine.send(
    f.room.id,
    command([f.room.agents[0]!.id], { threadId: result.threadId, replyTo: answer.id }),
  );
  assert.equal(f.store.get(f.room.id).messages.at(-1)!.replyTo, answer.id);
});

test('archive and thread-name HTTP commands enforce token, origin, strict bodies, scope, and export provenance', async (t) => {
  const f = fixture();
  t.after(f.close);
  const sent = f.engine.send(
    f.room.id,
    command([], { type: 'update', body: 'Archive export content' }),
  );
  const app = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const { token } = (await (await fetch(base + '/api/session')).json()) as { token: string };
    const headers = { 'X-AIB-Token': token, 'Content-Type': 'application/json' };
    const archive = `${base}/api/rooms/${f.room.id}/archive`;
    const thread = `${base}/api/rooms/${f.room.id}/threads/${sent.threadId}`;
    const put = (url: string, body: unknown, extra = {}) =>
      fetch(url, { method: 'PUT', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    for (const [url, body] of [
      [archive, { archived: true }],
      [thread, { title: 'HTTP name' }],
    ] as const) {
      assert.equal((await fetch(url, { method: 'PUT', body: JSON.stringify(body) })).status, 401);
      assert.equal((await put(url, body, { Origin: 'https://evil.example' })).status, 403);
    }
    assert.equal((await put(archive, { archived: 'true' })).status, 400);
    assert.equal((await put(archive, { archived: true, status: 'running' })).status, 400);
    assert.equal((await put(thread, { title: 'HTTP name', body: 'forged history' })).status, 400);
    assert.equal((await put(thread, { title: 'HTTP name' })).status, 200);
    const other = f.engine.createRoom({ title: 'Other' });
    assert.equal(
      (await put(`${base}/api/rooms/${other.id}/threads/${sent.threadId}`, { title: 'Foreign' }))
        .status,
      404,
    );
    assert.equal((await put(`${base}/api/rooms/missing/archive`, { archived: true })).status, 404);
    assert.equal((await fetch(archive, { headers })).status, 405);
    assert.equal((await fetch(thread, { method: 'POST', headers })).status, 405);
    const response = await put(archive, { archived: true });
    assert.equal(response.status, 200);
    const archived = (await response.json()) as Room;
    assert.ok(archived.archivedAt);
    const list = (await (await fetch(base + '/api/rooms', { headers })).json()) as RoomSummary[];
    assert.equal(list.find((r) => r.id === f.room.id)!.archivedAt, archived.archivedAt);
    assert.equal((await put(thread, { title: 'Blocked name' })).status, 409);
    const exported = await (
      await fetch(`${base}/api/rooms/${f.room.id}/export`, { headers })
    ).text();
    assert.ok(exported.includes('Workspace archived: ' + archived.archivedAt));
    assert.ok(exported.includes('Thread: ' + sent.threadId));
    assert.ok(exported.includes('Thread name: HTTP name'));
    assert.ok(exported.includes('Archive export content'));
    assert.equal((await put(archive, { archived: false })).status, 200);
    assert.equal(f.store.get(f.room.id).status, 'paused');
  } finally {
    await app.close();
  }
});

test('workspace search matches names and objectives literally and separates active, archived, and legacy records', (t) => {
  const f = fixture();
  t.after(f.close);
  const archived = f.engine.createRoom({ title: 'Delivery [a+b]', objective: 'ARCHIVE evidence' });
  f.engine.setWorkspaceArchived(archived.id, { archived: true });
  f.store.mutate(f.room.id, (room) => {
    delete room.archivedAt;
  });
  const rooms = f.store.list();
  assert.deepEqual(
    searchWorkspaces(rooms, ' preserve EVIDENCE ', 'active').map((r) => r.id),
    [f.room.id],
  );
  assert.deepEqual(
    searchWorkspaces(rooms, '[a+b]', 'archived').map((r) => r.id),
    [archived.id],
  );
  assert.equal(searchWorkspaces(rooms, '.*', 'all').length, 0);
  assert.equal(searchWorkspaces(rooms, '', 'all').length, 2);
  assert.equal(searchWorkspaces(rooms, 'evidence', 'all').length, 2);
  assert.equal(searchWorkspaces(rooms, 'archive', 'active').length, 0);
});

test('thread search matches visible message bodies and names, caps previews, and cannot return foreign or deleted sources', (t) => {
  const f = fixture();
  t.after(f.close);
  const one = f.engine.send(
    f.room.id,
    command([], {
      type: 'update',
      body: 'x'.repeat(300) + ' Needle <script>literal text</script> ' + 'x'.repeat(300),
    }),
  );
  const two = f.engine.send(f.room.id, command([], { type: 'update', body: 'Other body' }));
  f.engine.renameThread(f.room.id, two.threadId, { title: 'Needle in name' });
  const room = f.store.get(f.room.id);
  const matches = searchThreads(room, ' NEEDLE ');
  assert.equal(matches.length, 2);
  assert.ok(matches[0]!.snippet!.includes('Needle'));
  assert.ok(matches[0]!.snippet!.length <= 110);
  assert.equal(matches[1]!.snippet, null);
  assert.equal(searchThreads(room, '<script>').length, 1);
  assert.equal(searchThreads(room, '.*').length, 0);
  const foreign = {
    ...room.messages[0]!,
    id: 'foreign',
    threadId: 'unknown',
    body: 'Foreign-only evidence',
  };
  assert.equal(
    searchThreads({ ...room, messages: [...room.messages, foreign] }, 'Foreign-only').length,
    0,
  );
  f.engine.deleteThread(f.room.id, one.threadId);
  assert.equal(searchThreads(f.store.get(f.room.id), '<script>').length, 0);
  assert.equal(searchThreads(f.store.get(f.room.id), 'needle').length, 1);
});

test('an archived workspace can be deleted without restoring or affecting another workspace', (t) => {
  const f = fixture();
  t.after(f.close);
  const other = f.engine.createRoom({ title: 'Keep open' });
  f.engine.setWorkspaceArchived(f.room.id, { archived: true });
  f.engine.deleteRoom(f.room.id);
  assert.throws(() => f.store.get(f.room.id), /Room not found/);
  assert.equal(f.store.get(other.id).status, 'running');
  assert.equal(f.store.list().length, 1);
});
