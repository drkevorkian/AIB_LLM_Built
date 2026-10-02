import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { BulkWorkspacePreview, Room } from '../src/shared/contracts.js';
import { ConversationEngine } from '../src/server/engine.js';
import { RoomStore } from '../src/server/store.js';
import { serve } from '../src/server/http.js';
import { command, ControlledProvider, until } from './helpers.js';

function fixture(path = ':memory:') {
  let now = Date.parse('2026-10-02T00:00:00Z');
  const store = new RoomStore(path);
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, {
    autoSchedule: false,
    now: () => new Date(now),
  });
  const rooms = [
    engine.createRoom({ title: 'Same name' }),
    engine.createRoom({ title: 'Same name' }),
    engine.createRoom({ title: 'Outside selection' }),
  ];
  const ids = rooms.slice(0, 2).map((room) => room.id);
  return {
    store,
    provider,
    engine,
    rooms,
    ids,
    advance: (ms: number) => {
      now += ms;
    },
    close: () => {
      engine.close();
      store.close();
    },
  };
}
function checkHistory(actual: Room, before: Room) {
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
    assert.deepEqual(actual[key], before[key], key);
}

test('bulk previews and cancellation are read-only, scoped, bounded metadata without source or provider calls', (t) => {
  const f = fixture();
  t.after(f.close);
  f.engine.send(
    f.ids[0]!,
    command([], { type: 'update', body: 'Private source must stay out of a preview' }),
  );
  const before = f.store.all();
  let changes = 0;
  f.engine.on('changed', () => changes++);
  const p = f.engine.previewWorkspaces({ action: 'delete', roomIds: f.ids });
  assert.deepEqual(
    p.targets.map((r) => r.id),
    f.ids,
  );
  assert.equal(p.targets[0]!.messages, 1);
  assert.equal(p.targets[0]!.threads, 1);
  assert.equal(p.targets[0]!.title, p.targets[1]!.title);
  assert.ok(!JSON.stringify(p).includes('Private source'));
  assert.equal(Date.parse(p.expiresAt), Date.parse('2026-10-02T00:05:00Z'));
  f.engine.cancelWorkspacePreview({ token: p.token });
  assert.throws(() => f.engine.confirmWorkspaces({ token: p.token }), /expired or unavailable/);
  f.engine.cancelWorkspacePreview({ token: p.token });
  assert.deepEqual(f.store.all(), before);
  assert.equal(changes, 0);
  assert.equal(f.provider.inputs.length, 0);
});

test('bulk selection rejects empty, duplicate, oversized, malformed, extra-field, and missing targets before mutation', (t) => {
  const f = fixture();
  t.after(f.close);
  const before = f.store.all();
  for (const input of [
    { action: 'delete', roomIds: [] },
    { action: 'delete', roomIds: [f.ids[0], f.ids[0]] },
    { action: 'delete', roomIds: Array.from({ length: 26 }, (_, i) => String(i)) },
    { action: 'run', roomIds: f.ids },
    { action: 'delete', roomIds: ['../rooms'] },
    { action: 'delete', roomIds: f.ids, all: true },
  ])
    assert.throws(() =>
      f.engine.previewWorkspaces(input as Parameters<typeof f.engine.previewWorkspaces>[0]),
    );
  assert.throws(
    () => f.engine.previewWorkspaces({ action: 'delete', roomIds: [f.ids[0]!, 'missing'] }),
    /Room not found/,
  );
  assert.deepEqual(f.store.all(), before);
  assert.equal(f.provider.inputs.length, 0);
});

test('bulk selection permits exactly 25 explicit identities without a wildcard or title-based scope', (t) => {
  const f = fixture();
  t.after(f.close);
  const rooms = Array.from({ length: 25 }, () => f.engine.createRoom({ title: 'Same name' }));
  const p = f.engine.previewWorkspaces({ action: 'archive', roomIds: rooms.map((r) => r.id) });
  f.engine.confirmWorkspaces({ token: p.token });
  assert.ok(rooms.every((room) => f.store.get(room.id).archivedAt));
  assert.ok(f.rooms.every((room) => !f.store.get(room.id).archivedAt));
});

test('bulk archive and restore preserve exact history and usage, remain paused, and leave already-matching targets unchanged', async (t) => {
  const f = fixture();
  t.after(f.close);
  const first = f.rooms[0]!;
  f.engine.send(first.id, command([first.agents[0]!.id]));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.store.get(first.id).jobs[0]!.status === 'completed');
  const before = f.ids.map((id) => f.store.get(id));
  const outside = f.store.get(f.rooms[2]!.id);
  const archive = f.engine.previewWorkspaces({ action: 'archive', roomIds: f.ids });
  f.engine.confirmWorkspaces({ token: archive.token });
  for (let i = 0; i < f.ids.length; i++) {
    const actual = f.store.get(f.ids[i]!);
    checkHistory(actual, before[i]!);
    assert.ok(actual.archivedAt);
    assert.equal(actual.status, 'paused');
  }
  const archived = f.ids.map((id) => f.store.get(id));
  const repeat = f.engine.previewWorkspaces({ action: 'archive', roomIds: f.ids });
  assert.ok(repeat.targets.every((r) => r.unchanged));
  f.engine.confirmWorkspaces({ token: repeat.token });
  assert.deepEqual(
    f.ids.map((id) => f.store.get(id)),
    archived,
  );
  const restore = f.engine.previewWorkspaces({
    action: 'restore',
    roomIds: [...f.ids, outside.id],
  });
  f.engine.confirmWorkspaces({ token: restore.token });
  assert.deepEqual(f.store.get(outside.id), outside);
  for (let i = 0; i < f.ids.length; i++) {
    const actual = f.store.get(f.ids[i]!);
    checkHistory(actual, before[i]!);
    assert.equal(actual.archivedAt, null);
    assert.equal(actual.status, 'paused');
  }
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
});

test('one pending workspace blocks the entire archive batch without cancelling, reserving, or partially archiving', (t) => {
  const f = fixture();
  t.after(f.close);
  const second = f.rooms[1]!;
  f.engine.send(second.id, command([second.agents[0]!.id]));
  const before = f.store.all();
  const p = f.engine.previewWorkspaces({ action: 'archive', roomIds: f.ids });
  assert.equal(p.targets[0]!.blockedReason, null);
  assert.match(p.targets[1]!.blockedReason!, /pending work/);
  assert.throws(() => f.engine.confirmWorkspaces({ token: p.token }), /pending work/);
  assert.deepEqual(f.store.all(), before);
  assert.equal(f.provider.inputs.length, 0);
  assert.throws(() => f.engine.confirmWorkspaces({ token: p.token }), /expired or unavailable/);
  f.engine.control(second.id, 'stop');
  const fresh = f.engine.previewWorkspaces({ action: 'archive', roomIds: f.ids });
  f.engine.confirmWorkspaces({ token: fresh.token });
  assert.ok(f.ids.every((id) => f.store.get(id).archivedAt));
});

test('changed selected revisions invalidate the whole preview, while unrelated changes do not expand or block the selection', (t) => {
  const f = fixture();
  t.after(f.close);
  const stale = f.engine.previewWorkspaces({ action: 'delete', roomIds: f.ids });
  f.engine.send(f.ids[1]!, command([], { type: 'update', body: 'New evidence after the preview' }));
  const before = f.store.all();
  assert.throws(() => f.engine.confirmWorkspaces({ token: stale.token }), /changed.*Preview/);
  assert.deepEqual(f.store.all(), before);
  const fresh = f.engine.previewWorkspaces({ action: 'archive', roomIds: f.ids });
  f.engine.send(f.rooms[2]!.id, command([], { type: 'update', body: 'Outside the exact scope' }));
  const outside = f.store.get(f.rooms[2]!.id);
  f.engine.confirmWorkspaces({ token: fresh.token });
  assert.deepEqual(f.store.get(outside.id), outside);
});

test('a selected workspace deleted after preview rejects the batch without touching the surviving selection', (t) => {
  const f = fixture();
  t.after(f.close);
  const p = f.engine.previewWorkspaces({ action: 'delete', roomIds: f.ids });
  f.engine.deleteRoom(f.ids[1]!);
  const before = f.store.get(f.ids[0]!);
  assert.throws(() => f.engine.confirmWorkspaces({ token: p.token }), /Room not found/);
  assert.deepEqual(f.store.get(before.id), before);
});

test('preview expiration, one-time confirmation, and bounded preview eviction require a fresh review', (t) => {
  const f = fixture();
  t.after(f.close);
  const expired = f.engine.previewWorkspaces({ action: 'delete', roomIds: f.ids });
  f.advance(5 * 60 * 1000);
  assert.throws(
    () => f.engine.confirmWorkspaces({ token: expired.token }),
    /expired or unavailable/,
  );
  const oldest = f.engine.previewWorkspaces({ action: 'delete', roomIds: f.ids });
  for (let i = 0; i < 50; i++) f.engine.previewWorkspaces({ action: 'archive', roomIds: f.ids });
  assert.throws(
    () => f.engine.confirmWorkspaces({ token: oldest.token }),
    /expired or unavailable/,
  );
  const p = f.engine.previewWorkspaces({ action: 'archive', roomIds: f.ids });
  f.engine.confirmWorkspaces({ token: p.token });
  const before = f.store.all();
  assert.throws(() => f.engine.confirmWorkspaces({ token: p.token }), /expired or unavailable/);
  assert.deepEqual(f.store.all(), before);
});

test('editing returned preview fields cannot change the server-bound action or identities', (t) => {
  const f = fixture();
  t.after(f.close);
  const p = f.engine.previewWorkspaces({ action: 'archive', roomIds: f.ids });
  p.action = 'delete';
  p.targets[0]!.id = f.rooms[2]!.id;
  p.targets[0]!.revision = 999;
  const result = f.engine.confirmWorkspaces({ token: p.token });
  assert.deepEqual(result, { action: 'archive', roomIds: f.ids });
  assert.ok(f.ids.every((id) => f.store.get(id).archivedAt));
  assert.equal(f.store.get(f.rooms[2]!.id).archivedAt, null);
});

test('connection probes invalidate previews without changing room revisions, and a fresh probe blocks archive', async (t) => {
  const f = fixture();
  t.after(f.close);
  const first = f.rooms[0]!;
  const before = f.store.all();
  const stale = f.engine.previewWorkspaces({ action: 'delete', roomIds: f.ids });
  const check = f.engine.testConnection(first.id, first.agents[0]!.id);
  await until(() => f.provider.inputs.length === 1);
  assert.deepEqual(f.store.all(), before);
  assert.throws(() => f.engine.confirmWorkspaces({ token: stale.token }), /activity changed/);
  const blocked = f.engine.previewWorkspaces({ action: 'archive', roomIds: f.ids });
  assert.equal(blocked.targets[0]!.probes, 1);
  assert.throws(() => f.engine.confirmWorkspaces({ token: blocked.token }), /pending work/);
  const ending = f.engine.previewWorkspaces({ action: 'delete', roomIds: f.ids });
  f.provider.releases[0]!();
  await check;
  const replacement = f.engine.testConnection(first.id, first.agents[0]!.id);
  await until(() => f.provider.inputs.length === 2);
  assert.throws(() => f.engine.confirmWorkspaces({ token: ending.token }), /activity changed/);
  f.provider.releases[1]!();
  await replacement;
  assert.deepEqual(f.store.all(), before);
});

test('a mid-batch SQLite update failure rolls back all archive changes, timestamps, and audit events', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-bulk-update-'));
  const path = join(directory, 'room.sqlite');
  const f = fixture(path);
  t.after(() => {
    f.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const db = new DatabaseSync(path);
  assert.match(f.ids[1]!, /^[a-f0-9-]+$/);
  db.exec(
    `CREATE TRIGGER fail_batch BEFORE UPDATE ON rooms WHEN OLD.id = '${f.ids[1]}' BEGIN SELECT RAISE(ABORT, 'Fixture update failure'); END`,
  );
  db.close();
  const before = f.store.all();
  const p = f.engine.previewWorkspaces({ action: 'archive', roomIds: f.ids });
  assert.throws(() => f.engine.confirmWorkspaces({ token: p.token }), /Fixture update failure/);
  assert.deepEqual(f.store.all(), before);
  assert.equal(f.provider.inputs.length, 0);
});

test('bulk deletion commits all targets before aborting active streams and probes, retaining unrelated queued work and ignoring late events', async (t) => {
  const f = fixture();
  t.after(f.close);
  for (const room of f.rooms.slice(0, 2)) f.engine.send(room.id, command([room.agents[0]!.id]));
  f.engine.pump();
  await until(() =>
    f.ids.every((id) =>
      f.store.get(id).messages.some((m) => m.body.includes('independent answer')),
    ),
  );
  f.engine.send(f.ids[0]!, command([f.rooms[0]!.agents[1]!.id]));
  const check = f.engine.testConnection(f.ids[1]!, f.rooms[1]!.agents[1]!.id);
  const rejection = assert.rejects(check, /cancelled|aborted/i);
  await until(() => f.provider.inputs.length === 3);
  f.engine.control(f.rooms[2]!.id, 'pause');
  f.engine.send(f.rooms[2]!.id, command([f.rooms[2]!.agents[0]!.id]));
  const outside = f.store.get(f.rooms[2]!.id);
  const p = f.engine.previewWorkspaces({ action: 'delete', roomIds: f.ids });
  assert.equal(
    p.targets.reduce((sum, r) => sum + r.running, 0),
    2,
  );
  assert.equal(
    p.targets.reduce((sum, r) => sum + r.probes, 0),
    1,
  );
  let notifications = 0;
  f.engine.on('changed', () => {
    assert.ok(f.store.all().every((r) => !f.ids.includes(r.id)));
    notifications++;
  });
  f.engine.confirmWorkspaces({ token: p.token });
  await rejection;
  for (const release of f.provider.releases) release();
  await new Promise((done) => setTimeout(done, 10));
  f.engine.pump();
  assert.deepEqual(f.store.all(), [outside]);
  assert.ok(notifications >= 2);
  assert.equal(f.provider.inputs.length, 3);
  assert.equal(f.engine.activity(outside.id).capacity.inUse, 0);
});

test('a mid-batch SQLite write failure rolls back every deletion and does not abort an active transport', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-bulk-fault-'));
  const path = join(directory, 'room.sqlite');
  const f = fixture(path);
  t.after(() => {
    f.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const first = f.rooms[0]!;
  f.engine.send(first.id, command([first.agents[0]!.id]));
  f.engine.pump();
  await until(() =>
    f.store.get(first.id).messages.some((m) => m.body.includes('independent answer')),
  );
  const db = new DatabaseSync(path);
  assert.match(f.ids[1]!, /^[a-f0-9-]+$/);
  db.exec(
    `CREATE TRIGGER fail_batch BEFORE DELETE ON rooms WHEN OLD.id = '${f.ids[1]}' BEGIN SELECT RAISE(ABORT, 'Fixture write failure'); END`,
  );
  db.close();
  const before = f.store.all();
  const p = f.engine.previewWorkspaces({ action: 'delete', roomIds: f.ids });
  assert.throws(() => f.engine.confirmWorkspaces({ token: p.token }), /Fixture write failure/);
  assert.deepEqual(f.store.all(), before);
  assert.equal(f.engine.activity(first.id).capacity.inUse, 1);
  f.provider.releases[0]!();
  await until(() => f.store.get(first.id).jobs[0]!.status === 'completed');
});

test('bulk archive and deletion persist across disk restart while previews do not and an empty initialized service stays empty', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-bulk-restart-'));
  const path = join(directory, 'room.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const f = fixture(path);
  assert.equal(f.store.initialize(), true);
  const p = f.engine.previewWorkspaces({ action: 'archive', roomIds: f.ids });
  f.engine.confirmWorkspaces({ token: p.token });
  const old = f.engine.previewWorkspaces({ action: 'delete', roomIds: f.ids });
  f.close();
  const store = new RoomStore(path);
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false });
  assert.ok(f.ids.every((id) => store.get(id).archivedAt));
  assert.ok(f.ids.every((id) => store.get(id).status === 'paused'));
  assert.throws(() => engine.confirmWorkspaces({ token: old.token }), /expired or unavailable/);
  const removal = engine.previewWorkspaces({
    action: 'delete',
    roomIds: store.list().map((r) => r.id),
  });
  engine.confirmWorkspaces({ token: removal.token });
  engine.close();
  store.close();
  const reopened = new RoomStore(path);
  assert.equal(reopened.initialize(), false);
  assert.deepEqual(reopened.all(), []);
  reopened.close();
});

test('bulk HTTP commands enforce sessions, Host, Origin, methods, strict bodies, scope, and explicit token-bound confirmation', async (t) => {
  const f = fixture();
  t.after(f.close);
  const app = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const { token } = await (await fetch(base + '/api/session')).json();
    const headers = { 'X-AIB-Token': token, 'Content-Type': 'application/json' };
    const url = (name: string) => base + '/api/workspaces/bulk/' + name;
    const post = (name: string, data: unknown, extra = {}) =>
      fetch(url(name), {
        method: 'POST',
        headers: { ...headers, ...extra },
        body: JSON.stringify(data),
      });
    const before = f.store.all();
    for (const name of ['preview', 'confirm', 'preview-cancel']) {
      assert.equal((await fetch(url(name), { method: 'POST', body: '{}' })).status, 401);
      assert.equal((await post(name, {}, { Origin: 'https://evil.example' })).status, 403);
      const foreignHost = await new Promise<number>((done, reject) => {
        const req = request(
          url(name),
          { method: 'POST', headers: { ...headers, Host: 'evil.example' } },
          (res) => {
            res.resume();
            res.on('end', () => done(res.statusCode!));
          },
        );
        req.on('error', reject);
        req.end('{}');
      });
      assert.equal(foreignHost, 403);
      assert.equal((await fetch(url(name), { headers })).status, 405);
      assert.equal((await post(name, {})).status, 400);
    }
    assert.equal(
      (await post('preview', { action: 'delete', roomIds: f.ids, all: true })).status,
      400,
    );
    assert.equal(
      (await post('preview', { action: 'delete', roomIds: [f.ids[0], f.ids[0]] })).status,
      400,
    );
    assert.equal((await post('preview', { action: 'delete', roomIds: ['missing'] })).status, 404);
    const response = await post('preview', { action: 'archive', roomIds: f.ids });
    assert.equal(response.status, 200);
    const p = (await response.json()) as BulkWorkspacePreview;
    assert.deepEqual(f.store.all(), before);
    assert.equal(
      (await post('confirm', { token: p.token, action: 'delete', roomIds: [f.rooms[2]!.id] }))
        .status,
      400,
    );
    assert.equal((await post('confirm', { token: randomUUID() })).status, 409);
    assert.equal((await post('confirm', { token: p.token })).status, 200);
    assert.equal((await post('confirm', { token: p.token })).status, 409);
    const cancelled = (await (
      await post('preview', { action: 'delete', roomIds: f.ids })
    ).json()) as BulkWorkspacePreview;
    assert.equal((await post('preview-cancel', { token: cancelled.token })).status, 200);
    assert.equal((await post('confirm', { token: cancelled.token })).status, 409);
    assert.equal(f.provider.inputs.length, 0);
    assert.equal(f.store.all().length, 3);
  } finally {
    await app.close();
  }
});

test('shutdown invalidates previews and rejects new bulk work without changing stored history', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const p = f.engine.previewWorkspaces({ action: 'delete', roomIds: f.ids });
  f.engine.close();
  const before = f.store.all();
  assert.throws(() => f.engine.confirmWorkspaces({ token: p.token }), /shutting down/);
  assert.throws(
    () => f.engine.previewWorkspaces({ action: 'delete', roomIds: f.ids }),
    /shutting down/,
  );
  assert.deepEqual(f.store.all(), before);
});
