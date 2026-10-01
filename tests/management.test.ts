import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { defaultAppSettings, type AppSettings } from '../src/shared/contracts.js';
import { ConversationEngine } from '../src/server/engine.js';
import { RoomStore } from '../src/server/store.js';
import { serve } from '../src/server/http.js';
import type { ProviderAdapter, ProviderEvent, ProviderInput } from '../src/server/providers.js';
import { command, ControlledProvider, until } from './helpers.js';

function fixture(maxTurns = 30) {
  const store = new RoomStore(':memory:');
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false });
  const room = engine.createRoom({
    title: 'Managed workspace',
    objective: 'Original objective',
    maxTurns,
  });
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

test('v1 databases migrate without losing rooms; defaults and empty-workspace initialization survive restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-settings-'));
  const path = join(directory, 'rooms.sqlite');
  const original = fixture();
  const legacy = new DatabaseSync(path);
  legacy.exec(
    'CREATE TABLE rooms (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL) STRICT; PRAGMA user_version = 1;',
  );
  legacy
    .prepare('INSERT INTO rooms VALUES (?, ?, ?)')
    .run(original.room.id, 0, JSON.stringify(original.room));
  legacy.close();
  original.close();
  let store = new RoomStore(path);
  try {
    assert.equal(store.get(original.room.id).title, 'Managed workspace');
    assert.deepEqual(store.settings(), defaultAppSettings);
    const settings: AppSettings = {
      defaultMaxTurns: 48,
      defaultDeadlineSeconds: 65,
      defaultPolicy: 'any',
      defaultSynthesis: false,
      defaultDiscussionRounds: 2,
      defaultDiscussionTurns: 9,
    };
    store.saveSettings(settings);
    assert.equal(store.initialize(), true);
    assert.equal(store.initialize(), false);
    assert.throws(() => store.saveSettings({ ...settings, defaultMaxTurns: 0 }));
    assert.throws(() =>
      store.saveSettings({ ...settings, apiKey: 'must-not-be-saved' } as AppSettings),
    );
    assert.deepEqual(store.settings(), settings);
    store.delete(original.room.id);
    store.close();
    store = new RoomStore(path);
    assert.deepEqual(store.settings(), settings);
    assert.deepEqual(store.list(), []);
    assert.equal(store.initialize(), false, 'A deleted final workspace must not be re-seeded');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('workspace settings reject pending work and reduced used budgets, preserving historical objectives', async () => {
  const f = fixture();
  try {
    f.engine.send(f.room.id, command(f.room.agents.map((a) => a.id)));
    const input = { title: 'Renamed workspace', objective: 'Revised objective', maxTurns: 10 };
    assert.throws(() => f.engine.configureWorkspace(f.room.id, input), /pending work/);
    assert.equal(f.store.get(f.room.id).title, f.room.title);
    f.engine.pump();
    await until(() => f.provider.releases.length === 3);
    f.provider.releases.forEach((release) => release());
    await until(() => f.store.get(f.room.id).jobs.every((j) => j.status === 'completed'));
    assert.throws(
      () => f.engine.configureWorkspace(f.room.id, { ...input, maxTurns: 2 }),
      /turn budget/,
    );
    assert.equal(f.store.get(f.room.id).maxTurns, 30);
    f.engine.configureWorkspace(f.room.id, input);
    const saved = f.store.get(f.room.id);
    assert.equal(saved.title, input.title);
    assert.equal(saved.objective, input.objective);
    assert.equal(saved.snapshots[0]!.objective, 'Original objective');
    assert.equal(saved.turnsUsed, 3);
    const next = f.engine.send(f.room.id, command([f.room.agents[0]!.id]));
    assert.equal(
      f.store
        .get(f.room.id)
        .snapshots.find(
          (s) =>
            s.id ===
            f.store.get(f.room.id).requests.find((r) => r.id === next.requestId)!.snapshotId,
        )!.objective,
      input.objective,
    );
  } finally {
    f.close();
  }
});

test('deleting a streaming thread cascades its work, prevents replay, keeps unrelated work and consumed turns', async () => {
  const f = fixture(5);
  try {
    const input = command(
      f.room.agents.slice(1).map((a) => a.id),
      { body: 'Delete this unique thread', synthesisAgentId: f.room.agents[0]!.id },
    );
    const removed = f.engine.send(f.room.id, input);
    const kept = f.engine.send(
      f.room.id,
      command([f.room.agents[0]!.id], { body: 'Keep this separate thread' }),
    );
    f.engine.pump();
    await until(() => f.provider.releases.length === 3);
    const next = f.engine.deleteThread(f.room.id, removed.threadId);
    assert.equal(next.turnsUsed, 3);
    assert.equal(next.status, 'running');
    assert.equal(next.threads.length, 1);
    assert.equal(next.threads[0]!.id, kept.threadId);
    assert.equal(next.requests.length, 1);
    assert.equal(next.jobs.length, 1);
    assert.ok(!JSON.stringify(next).includes(input.body));
    assert.throws(() => f.engine.send(f.room.id, input), /message was deleted/);
    assert.throws(
      () =>
        f.engine.send(f.room.id, command([f.room.agents[0]!.id], { threadId: removed.threadId })),
      /Unknown thread/,
    );
    f.provider.releases.forEach((release) => release());
    await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
    f.engine.pump();
    assert.equal(f.provider.inputs.length, 3, 'Deleted synthesis must never start');
    f.engine.send(f.room.id, command([f.room.agents[1]!.id, f.room.agents[2]!.id]));
    assert.equal(f.store.get(f.room.id).jobs.filter((j) => j.status === 'queued').length, 2);
  } finally {
    f.close();
  }
});

test('thread deletion is scoped and atomic; missing threads do not modify either workspace', () => {
  const f = fixture();
  try {
    const other = f.engine.createRoom({ title: 'Other workspace', objective: '', maxTurns: 20 });
    const source = f.engine.send(other.id, command([other.agents[0]!.id]));
    const before = f.store.get(f.room.id);
    assert.throws(() => f.engine.deleteThread(f.room.id, source.threadId), /Thread not found/);
    assert.deepEqual(f.store.get(f.room.id), before);
    assert.equal(f.store.get(other.id).threads.length, 1);
  } finally {
    f.close();
  }
});

for (const mode of ['relay', 'discussion'] as const) {
  test(`deleting an unstarted ${mode} releases its entire reservation without resuming a paused workspace`, () => {
    const f = fixture(12);
    try {
      f.engine.control(f.room.id, 'pause');
      const sent = f.engine.send(
        f.room.id,
        command(
          [f.room.agents[0]!.id],
          mode === 'relay'
            ? { relayOrder: Array.from({ length: 12 }, () => f.room.agents[0]!.id) }
            : { discussion: { maxRounds: 3, maxTurns: 12 } },
        ),
      );
      const deleted = f.engine.deleteThread(f.room.id, sent.threadId);
      assert.equal(deleted.status, 'paused');
      assert.equal(deleted.turnsUsed, 0);
      for (const records of [
        deleted.threads,
        deleted.messages,
        deleted.requests,
        deleted.jobs,
        deleted.snapshots,
        deleted.relays,
        deleted.discussions,
      ])
        assert.equal(records.length, 0);
      f.engine.send(
        f.room.id,
        command([f.room.agents[0]!.id], { discussion: { maxRounds: 3, maxTurns: 12 } }),
      );
      f.engine.pump();
      assert.equal(f.provider.inputs.length, 0);
    } finally {
      f.close();
    }
  });
}

test('deleting a shared update redacts context copies and cancels dependent work while preserving independent work', async () => {
  const f = fixture();
  try {
    const independent = f.engine.send(
      f.room.id,
      command([f.room.agents[2]!.id], { body: 'Independent request made before the update' }),
    );
    const update = f.engine.send(
      f.room.id,
      command([], { type: 'update', body: 'Unique shared source to remove 93751' }),
    );
    const normal = f.engine.send(f.room.id, command([f.room.agents[1]!.id]));
    const relay = f.engine.send(
      f.room.id,
      command([f.room.agents[0]!.id], { relayOrder: f.room.agents.map((a) => a.id) }),
    );
    const discussion = f.engine.send(
      f.room.id,
      command([f.room.agents[0]!.id], { discussion: { maxRounds: 3, maxTurns: 12 } }),
    );
    f.engine.pump();
    await until(() => f.provider.inputs.length === 3);
    const next = f.engine.deleteThread(f.room.id, update.threadId);
    assert.equal(next.requests.find((r) => r.id === independent.requestId)!.status, 'collecting');
    assert.equal(next.requests.find((r) => r.id === normal.requestId)!.status, 'cancelled');
    assert.equal(next.relays.find((r) => r.messageId === relay.messageId)!.status, 'cancelled');
    assert.equal(
      next.discussions.find((d) => d.id === discussion.discussionId)!.status,
      'cancelled',
    );
    assert.ok(!JSON.stringify(next).includes('Unique shared source to remove 93751'));
    assert.ok(next.snapshots.some((s) => s.deletedMessageIds?.includes(update.messageId)));
    f.provider.releases.forEach((release) => release());
    await until(
      () =>
        f.store.get(f.room.id).requests.find((r) => r.id === independent.requestId)!.status ===
        'ready',
    );
    f.engine.pump();
    assert.equal(f.provider.inputs.length, 3);
    const fresh = f.engine.send(
      f.room.id,
      command([f.room.agents[1]!.id], { body: 'Fresh request after deletion' }),
    );
    assert.ok(
      !f.store
        .get(f.room.id)
        .snapshots.find(
          (s) =>
            s.id ===
            f.store.get(f.room.id).requests.find((r) => r.id === fresh.requestId)!.snapshotId,
        )!.deletedMessageIds,
    );
  } finally {
    f.close();
  }
});

test('completed answers remain inspectable after source redaction, but a failed synthesis cannot retry deleted context', async () => {
  const f = fixture();
  try {
    const shared = f.engine.send(
      f.room.id,
      command([], { type: 'update', body: 'Sensitive update to remove from snapshots 45209' }),
    );
    f.provider.endings[1] = 'fail';
    const request = f.engine.send(
      f.room.id,
      command([f.room.agents[1]!.id], { synthesisAgentId: f.room.agents[0]!.id }),
    );
    f.engine.pump();
    await until(() => f.provider.releases.length === 1);
    f.provider.releases[0]!();
    await until(
      () =>
        f.store.get(f.room.id).requests.find((r) => r.id === request.requestId)!.status === 'ready',
    );
    f.engine.pump();
    await until(() => f.provider.releases.length === 2);
    f.provider.releases[1]!();
    await until(() =>
      f.store.get(f.room.id).jobs.some((j) => j.kind === 'synthesis' && j.status === 'failed'),
    );
    const failed = f.store.get(f.room.id).jobs.find((j) => j.kind === 'synthesis')!;
    const next = f.engine.deleteThread(f.room.id, shared.threadId);
    assert.equal(
      next.messages.filter((m) => m.type === 'answer' && m.status === 'complete').length,
      1,
    );
    assert.equal(next.requests[0]!.status, 'ready');
    assert.ok(!JSON.stringify(next).includes('Sensitive update to remove from snapshots 45209'));
    assert.throws(() => f.engine.retry(f.room.id, failed.id), /deleted context/);
  } finally {
    f.close();
  }
});

class SlowToAbortProvider implements ProviderAdapter {
  readonly id = 'late-fixture';
  readonly capabilities = { streaming: true, cancellation: true, remote: false };
  signals: AbortSignal[] = [];
  releases: (() => void)[] = [];
  async *generate(_input: ProviderInput, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    this.signals.push(signal);
    yield { type: 'delta', text: 'Before deletion.' };
    await new Promise<void>((done) => this.releases.push(done));
    yield { type: 'metadata', requestId: 'late-request', usage: { outputTokens: 2 } };
    yield { type: 'delta', text: 'LATE TEXT THAT MUST NOT RETURN' };
    yield { type: 'complete' };
  }
}

for (const scope of ['workspace', 'thread'] as const) {
  test(`deleting a ${scope} aborts its request, ignores late events, and frees dispatch capacity before transport cleanup`, async () => {
    const store = new RoomStore(':memory:');
    const provider = new SlowToAbortProvider();
    const engine = new ConversationEngine(store, provider, { autoSchedule: false, concurrency: 1 });
    try {
      const room = engine.createRoom({ title: 'Delete active', objective: '', maxTurns: 10 });
      const other = engine.createRoom({ title: 'Keep active', objective: '', maxTurns: 10 });
      const sent = engine.send(room.id, command([room.agents[0]!.id]));
      engine.pump();
      await until(() => provider.releases.length === 1);
      if (scope === 'workspace') engine.deleteRoom(room.id);
      else engine.deleteThread(room.id, sent.threadId);
      assert.equal(provider.signals[0]!.aborted, true);
      engine.send(other.id, command([other.agents[0]!.id]));
      engine.pump();
      await until(() => provider.releases.length === 2);
      provider.releases.forEach((release) => release());
      await until(() => store.get(other.id).jobs[0]!.status === 'completed');
      if (scope === 'workspace') assert.throws(() => store.get(room.id), /not found/);
      else {
        assert.equal(store.get(room.id).messages.length, 0);
        assert.equal(store.get(room.id).jobs.length, 0);
      }
    } finally {
      engine.close();
      store.close();
    }
  });
}

test('workspace deletion aborts a connection probe without touching another workspace', async () => {
  const f = fixture();
  try {
    const other = f.engine.createRoom({ title: 'Keep workspace', objective: '', maxTurns: 10 });
    const probe = f.engine.testConnection(f.room.id, f.room.agents[0]!.id);
    const rejected = assert.rejects(probe, /abort/i);
    await until(() => f.provider.releases.length === 1);
    f.engine.deleteRoom(f.room.id);
    await rejected;
    assert.deepEqual(
      f.store.list().map((r) => r.id),
      [other.id],
    );
    assert.throws(() => f.engine.deleteRoom(f.room.id), /not found/);
  } finally {
    f.close();
  }
});

test('thread deletion and minimal replay tombstones survive recovery, and sequence numbers are never reused', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-delete-recovery-'));
  const path = join(directory, 'rooms.sqlite');
  let store = new RoomStore(path);
  let engine = new ConversationEngine(store, new ControlledProvider(), { autoSchedule: false });
  try {
    const room = engine.createRoom({ title: 'Deletion recovery', objective: '', maxTurns: 10 });
    const oldInput = command([], { type: 'update', body: 'Deleted last thread' });
    const last = engine.send(room.id, oldInput);
    const sequence = store.get(room.id).messages[0]!.sequence;
    engine.deleteThread(room.id, last.threadId);
    engine.close();
    store.close();
    store = new RoomStore(path);
    engine = new ConversationEngine(store, new ControlledProvider(), { autoSchedule: false });
    assert.equal(store.get(room.id).threads.length, 0);
    assert.throws(() => engine.send(room.id, oldInput), /message was deleted/);
    engine.send(room.id, command([], { type: 'update', body: 'New thread' }));
    assert.ok(store.get(room.id).messages[0]!.sequence > sequence);
    engine.deleteRoom(room.id);
    engine.close();
    store.close();
    store = new RoomStore(path);
    engine = new ConversationEngine(store, new ControlledProvider(), { autoSchedule: false });
    assert.deepEqual(store.list(), []);
  } finally {
    engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('settings and deletion HTTP endpoints enforce sessions, origins, strict validation, and workspace/thread scope', async () => {
  const f = fixture();
  const app = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    const { token } = (await (await fetch(`${base}/api/session`)).json()) as { token: string };
    const headers = { 'X-AIB-Token': token, 'Content-Type': 'application/json' };
    const settingsUrl = `${base}/api/settings`;
    assert.equal((await fetch(settingsUrl)).status, 401);
    assert.equal((await fetch(`${base}/api/rooms/${f.room.id}`, { method: 'DELETE' })).status, 401);
    assert.equal(
      (
        await fetch(`${base}/api/rooms/${f.room.id}`, {
          method: 'DELETE',
          headers: { ...headers, Origin: 'https://evil.example' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(settingsUrl, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ ...defaultAppSettings, key: 'forbidden' }),
        })
      ).status,
      400,
    );
    assert.deepEqual(await (await fetch(settingsUrl, { headers })).json(), defaultAppSettings);
    const saved = { ...defaultAppSettings, defaultMaxTurns: 52 };
    assert.deepEqual(
      await (
        await fetch(settingsUrl, { method: 'PUT', headers, body: JSON.stringify(saved) })
      ).json(),
      saved,
    );
    const workspaceUrl = `${base}/api/rooms/${f.room.id}`;
    assert.equal(
      (
        await fetch(`${workspaceUrl}/settings`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ title: 'Edited via HTTP', objective: '', maxTurns: 10 }),
        })
      ).status,
      200,
    );
    const thread = f.engine.send(f.room.id, command([f.room.agents[0]!.id]));
    const threadUrl = `${workspaceUrl}/threads/${thread.threadId}`;
    assert.equal((await fetch(threadUrl, { method: 'DELETE' })).status, 401);
    assert.equal(
      (await fetch(`${workspaceUrl}/threads/missing`, { method: 'DELETE', headers })).status,
      404,
    );
    assert.equal((await fetch(threadUrl, { method: 'DELETE', headers })).status, 200);
    assert.equal((await fetch(threadUrl, { method: 'DELETE', headers })).status, 404);
    assert.equal((await fetch(workspaceUrl, { method: 'DELETE', headers })).status, 200);
    assert.equal((await fetch(workspaceUrl, { headers })).status, 404);
    assert.equal((await fetch(`${workspaceUrl}/export`, { headers })).status, 404);
    assert.deepEqual(await (await fetch(`${base}/api/rooms`, { headers })).json(), []);
  } finally {
    await app.close();
    f.close();
  }
});
