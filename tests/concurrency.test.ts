import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  defaultAppSettings,
  defaultProviderConcurrency,
  providerConcurrencySchema,
  type ProviderConcurrency,
  type ProviderKind,
  type Room,
} from '../src/shared/contracts.js';
import { ConversationEngine } from '../src/server/engine.js';
import { serve } from '../src/server/http.js';
import type { ProviderAdapter, ProviderEvent } from '../src/server/providers.js';
import { RoomStore } from '../src/server/store.js';
import { command, ControlledProvider, until } from './helpers.js';

function fixture(workspaceLimit = 4, provider = new ControlledProvider()) {
  const store = new RoomStore(':memory:');
  const engine = new ConversationEngine(store, provider, { autoSchedule: false });
  const room = engine.createRoom({
    title: 'Scoped capacity',
    maxConcurrentRequests: workspaceLimit,
  });
  return {
    store,
    engine,
    room,
    provider,
    close: () => {
      engine.close();
      store.close();
    },
  };
}
function limits(engine: ConversationEngine, patch: Partial<ProviderConcurrency>) {
  return engine.saveProviderConcurrency({ ...engine.settings().providerConcurrency, ...patch });
}
function binding(engine: ConversationEngine, room: Room, index: number, provider: ProviderKind) {
  const agent = room.agents[index]!;
  engine.configureAgent(room.id, {
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    provider,
    model: 'fixture-model',
    baseUrl: '',
  });
}
function queued(engine: ConversationEngine, room: Room, index: number) {
  return engine.activity(room.id).participants[index]!.queued[0]!;
}

test('scoped limits strictly require whole numbers 1–4 and a complete provider map', (t) => {
  const f = fixture();
  t.after(f.close);
  for (const provider of Object.keys(defaultProviderConcurrency) as ProviderKind[]) {
    for (const invalid of [0, 5, -1, 1.5, '1', null, NaN]) {
      const before = f.engine.settings();
      assert.throws(() =>
        f.engine.saveProviderConcurrency({
          ...before.providerConcurrency,
          [provider]: invalid,
        } as ProviderConcurrency),
      );
      assert.deepEqual(f.engine.settings(), before);
    }
    assert.equal(
      providerConcurrencySchema.parse({ ...defaultProviderConcurrency, [provider]: 1 })[provider],
      1,
    );
  }
  const { simulated: _omitted, ...missing } = defaultProviderConcurrency;
  for (const invalid of [missing, { ...defaultProviderConcurrency, extra: 1 }, null, []])
    assert.throws(() => f.engine.saveProviderConcurrency(invalid as ProviderConcurrency));
  for (const invalid of [0, 5, 1.5, '1', null]) {
    const before = f.store.get(f.room.id);
    assert.throws(() =>
      f.engine.createRoom({ title: 'Invalid', maxConcurrentRequests: invalid as number }),
    );
    assert.throws(() =>
      f.engine.configureWorkspace(f.room.id, {
        title: f.room.title,
        objective: '',
        maxTurns: 100,
        maxConcurrentRequests: invalid as number,
      }),
    );
    assert.deepEqual(f.store.get(f.room.id), before);
  }
});

test('legacy settings and workspace payloads default to four; omitted fields preserve saved limits after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-capacity-'));
  const path = join(directory, 'rooms.sqlite');
  let store = new RoomStore(path);
  let engine = new ConversationEngine(store, new ControlledProvider(), { autoSchedule: false });
  const room = engine.createRoom({ title: 'Legacy' });
  engine.close();
  store.close();
  const db = new DatabaseSync(path);
  const { providerConcurrency: _limits, ...legacySettings } = defaultAppSettings;
  delete room.maxConcurrentRequests;
  db.prepare('UPDATE rooms SET payload = ? WHERE id = ?').run(JSON.stringify(room), room.id);
  db.prepare('UPDATE settings SET payload = ?').run(JSON.stringify(legacySettings));
  db.close();
  try {
    store = new RoomStore(path);
    engine = new ConversationEngine(store, new ControlledProvider(), { autoSchedule: false });
    assert.deepEqual(engine.settings().providerConcurrency, defaultProviderConcurrency);
    assert.deepEqual(engine.activity(room.id).workspaceCapacity, { inUse: 0, limit: 4 });
    limits(engine, { simulated: 1, ollama: 2 });
    engine.configureWorkspace(room.id, {
      title: 'Saved',
      objective: '',
      maxTurns: 100,
      maxConcurrentRequests: 2,
    });
    engine.saveSettings({ ...legacySettings, defaultMaxTurns: 42 });
    engine.configureWorkspace(room.id, { title: 'Legacy edit', objective: '', maxTurns: 90 });
    engine.close();
    store.close();
    store = new RoomStore(path);
    engine = new ConversationEngine(store, new ControlledProvider(), { autoSchedule: false });
    assert.equal(engine.settings().providerConcurrency.simulated, 1);
    assert.equal(engine.settings().providerConcurrency.ollama, 2);
    assert.equal(engine.settings().defaultMaxTurns, 42);
    assert.equal(store.get(room.id).maxConcurrentRequests, 2);
    const check = new DatabaseSync(path);
    assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 2);
    assert.equal(store.get(room.id).schemaVersion, 1);
    check.close();
  } finally {
    engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('workspace limits hold without claims or revision churn and eligible other workspaces still start', (t) => {
  const f = fixture(1);
  t.after(f.close);
  f.engine.send(f.room.id, command(f.room.agents.map((a) => a.id)));
  const other = f.engine.createRoom({ title: 'Eligible' });
  f.engine.send(other.id, command([other.agents[0]!.id]));
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 2);
  assert.deepEqual(f.engine.activity(f.room.id).workspaceCapacity, { inUse: 1, limit: 1 });
  assert.ok(queued(f.engine, f.room, 1).blockers.includes('workspace_capacity'));
  const held = f.store.get(f.room.id);
  assert.equal(held.turnsUsed, 1);
  assert.equal(held.jobs[1]!.attemptId, null);
  f.engine.pump();
  f.engine.pump();
  f.engine.activity(f.room.id);
  assert.deepEqual(f.store.get(f.room.id), held);
  assert.equal(f.store.get(other.id).jobs[0]!.status, 'running');
});

test('provider limits span workspaces and endpoints while other provider kinds remain eligible', (t) => {
  const f = fixture();
  t.after(f.close);
  limits(f.engine, { 'openai-compatible': 1 });
  binding(f.engine, f.room, 0, 'openai-compatible');
  binding(f.engine, f.room, 1, 'openai-compatible');
  const b = f.room.agents[1]!;
  f.engine.configureAgent(f.room.id, {
    agentId: b.id,
    name: b.name,
    role: b.role,
    provider: 'openai-compatible',
    model: 'different-model',
    baseUrl: 'http://localhost:9876/v1',
  });
  const other = f.engine.createRoom({
    title: 'Other private workspace',
    objective: 'FOREIGN SECRET',
  });
  binding(f.engine, other, 0, 'openai-compatible');
  f.engine.send(f.room.id, command(f.room.agents.map((a) => a.id)));
  f.engine.send(other.id, command([other.agents[0]!.id, other.agents[1]!.id]));
  f.engine.pump();
  assert.deepEqual(
    f.provider.inputs.map((input) => input.agent.provider),
    ['openai-compatible', 'simulated', 'simulated'],
  );
  assert.ok(queued(f.engine, f.room, 1).blockers.includes('provider_capacity'));
  assert.ok(queued(f.engine, other, 0).blockers.includes('provider_capacity'));
  const activity = f.engine.activity(other.id);
  assert.deepEqual(
    activity.providerCapacity.find((entry) => entry.provider === 'openai-compatible'),
    { provider: 'openai-compatible', inUse: 1, limit: 1 },
  );
  const text = JSON.stringify(activity);
  assert.ok(!text.includes(f.room.id));
  assert.ok(!text.includes(f.room.agents[0]!.id));
  assert.ok(!text.includes('9876'));
  assert.ok(!text.includes('FOREIGN SECRET'));
});

test('raising a provider limit admits only already authorized queued work on the next pump', (t) => {
  const f = fixture();
  t.after(f.close);
  limits(f.engine, { simulated: 1 });
  f.engine.send(f.room.id, command(f.room.agents.map((a) => a.id)));
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  const before = f.store.get(f.room.id);
  limits(f.engine, { simulated: 3 });
  assert.deepEqual(f.store.get(f.room.id), before);
  assert.equal(f.provider.inputs.length, 1);
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 3);
  assert.equal(f.store.get(f.room.id).turnsUsed, 3);
  assert.deepEqual(f.store.get(f.room.id).snapshots, before.snapshots);
});

test('lowering a provider limit drains active requests without cancellation, retry, or turn refunds', async (t) => {
  const f = fixture();
  t.after(f.close);
  limits(f.engine, { simulated: 2 });
  f.engine.send(f.room.id, command(f.room.agents.map((a) => a.id)));
  f.engine.pump();
  limits(f.engine, { simulated: 1 });
  assert.deepEqual(f.engine.activity(f.room.id).providerCapacity[0], {
    provider: 'simulated',
    inUse: 2,
    limit: 1,
  });
  f.provider.releases[0]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 1);
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 2);
  assert.equal(f.store.get(f.room.id).jobs[1]!.status, 'running');
  f.provider.releases[1]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 3);
  assert.equal(f.store.get(f.room.id).turnsUsed, 3);
});

for (const kind of ['greeting', 'coordinator'] as const) {
  test(`${kind} probes consume workspace and provider capacity without conversation history or turns`, async (t) => {
    const f = fixture(1);
    t.after(f.close);
    limits(f.engine, { simulated: 1 });
    if (kind === 'coordinator')
      f.provider.actions[0] = {
        kind: 'finish',
        body: 'Hello',
        recipientIds: [],
        policy: 'all',
        quorum: 1,
        replyTo: null,
      };
    const probe = f.engine.testConnection(f.room.id, f.room.agents[0]!.id, kind);
    const other = f.engine.createRoom({ title: 'Other' });
    binding(f.engine, other, 1, 'openai');
    const before = f.store.get(f.room.id);
    await assert.rejects(
      f.engine.testConnection(f.room.id, f.room.agents[1]!.id),
      /Workspace request limit/,
    );
    await assert.rejects(
      f.engine.testConnection(other.id, other.agents[0]!.id),
      /Provider request limit/,
    );
    assert.deepEqual(f.store.get(f.room.id), before);
    f.engine.send(f.room.id, command([f.room.agents[1]!.id]));
    f.engine.send(other.id, command([other.agents[0]!.id, other.agents[1]!.id]));
    f.engine.pump();
    assert.equal(f.provider.inputs.length, 2);
    assert.equal(f.provider.inputs[1]!.agent.provider, 'openai');
    assert.ok(queued(f.engine, f.room, 1).blockers.includes('workspace_capacity'));
    assert.ok(queued(f.engine, other, 0).blockers.includes('provider_capacity'));
    assert.equal(f.store.get(f.room.id).turnsUsed, 0);
    f.provider.releases[0]!();
    await probe;
    assert.deepEqual(f.engine.activity(f.room.id).workspaceCapacity, { inUse: 0, limit: 1 });
    f.engine.pump();
    assert.equal(f.provider.inputs.length, 3);
  });
}

test('generation occupancy blocks probes of another participant under both scoped limits', async (t) => {
  const f = fixture(1);
  t.after(f.close);
  limits(f.engine, { simulated: 1 });
  f.engine.send(f.room.id, command([f.room.agents[0]!.id]));
  f.engine.pump();
  const other = f.engine.createRoom({ title: 'Other' });
  await assert.rejects(
    f.engine.testConnection(f.room.id, f.room.agents[1]!.id),
    /Workspace request limit/,
  );
  await assert.rejects(
    f.engine.testConnection(other.id, other.agents[0]!.id, 'coordinator'),
    /Provider request limit/,
  );
  assert.equal(f.provider.inputs.length, 1);
});

for (const ending of ['fail', 'refuse', 'empty'] as const) {
  test(`a ${ending} probe releases scoped capacity and admits a queued generation`, async (t) => {
    const f = fixture(1);
    t.after(f.close);
    limits(f.engine, { simulated: 1 });
    f.provider.endings[0] = ending;
    const rejection = assert.rejects(f.engine.testConnection(f.room.id, f.room.agents[0]!.id));
    f.engine.send(f.room.id, command([f.room.agents[1]!.id]));
    f.engine.pump();
    assert.equal(f.provider.inputs.length, 1);
    f.provider.releases[0]!();
    await rejection;
    f.engine.pump();
    assert.equal(f.provider.inputs.length, 2);
    assert.equal(f.store.get(f.room.id).turnsUsed, 1);
  });
}

test('retried jobs retain their frozen provider quota after the current participant changes provider', async (t) => {
  const f = fixture();
  t.after(f.close);
  limits(f.engine, { simulated: 1 });
  f.provider.endings[0] = 'fail';
  f.engine.send(f.room.id, command([f.room.agents[0]!.id]));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  binding(f.engine, f.room, 0, 'openai');
  const other = f.engine.createRoom({ title: 'Occupy original provider' });
  f.engine.send(other.id, command([other.agents[0]!.id]));
  f.engine.pump();
  f.engine.retry(f.room.id, f.store.get(f.room.id).jobs[0]!.id);
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 2);
  assert.equal(queued(f.engine, f.room, 0).provider, 'simulated');
  assert.ok(queued(f.engine, f.room, 0).blockers.includes('provider_capacity'));
  limits(f.engine, { simulated: 2 });
  f.engine.pump();
  assert.equal(f.provider.inputs[2]!.agent.provider, 'simulated');
  assert.equal(f.store.get(f.room.id).agents[0]!.provider, 'openai');
});

test('a held earlier job cannot be bypassed by a later job for the same participant with another binding', async (t) => {
  const f = fixture();
  t.after(f.close);
  limits(f.engine, { simulated: 1 });
  f.provider.endings[0] = 'fail';
  f.engine.send(f.room.id, command([f.room.agents[0]!.id]));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  binding(f.engine, f.room, 0, 'openai');
  f.engine.retry(f.room.id, f.store.get(f.room.id).jobs[0]!.id);
  f.engine.send(f.room.id, command([f.room.agents[0]!.id]));
  const other = f.engine.createRoom({ title: 'Occupancy' });
  f.engine.send(other.id, command([other.agents[0]!.id]));
  // Dispatch the other room first through a probe, without rearranging stored order.
  const probe = f.engine.testConnection(other.id, other.agents[1]!.id);
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 2);
  assert.deepEqual(
    f.engine.activity(f.room.id).participants[0]!.queued.map((job) => job.provider),
    ['simulated', 'openai'],
  );
  f.provider.releases[1]!();
  await probe;
});

for (const mode of ['complete', 'stop', 'thread-delete', 'workspace-delete'] as const) {
  test(`${mode} preserves scoped cleanup accounting and deletion's immediate release contract`, async (t) => {
    let cleanup!: () => void;
    const gate = new Promise<void>((done) => {
      cleanup = done;
    });
    let calls = 0;
    const provider: ProviderAdapter = {
      id: 'scoped-cleanup-fixture',
      capabilities: { streaming: true, cancellation: true, remote: false },
      async *generate(_input, signal): AsyncIterable<ProviderEvent> {
        const first = calls++ === 0;
        try {
          yield { type: 'delta', text: 'Initial answer' };
          if (first && mode !== 'complete') {
            await new Promise<void>((done) => {
              if (signal.aborted) done();
              else signal.addEventListener('abort', () => done(), { once: true });
            });
            yield { type: 'delta', text: 'LATE FORBIDDEN TEXT' };
          }
          yield { type: 'complete' };
        } finally {
          if (first) await gate;
        }
      },
    };
    const store = new RoomStore(':memory:');
    const engine = new ConversationEngine(store, provider, { autoSchedule: false });
    t.after(() => {
      cleanup();
      engine.close();
      store.close();
    });
    const room = engine.createRoom({ title: 'Cleanup', maxConcurrentRequests: 1 });
    const other = engine.createRoom({ title: 'Other', maxConcurrentRequests: 1 });
    limits(engine, { simulated: 1 });
    const sent = engine.send(room.id, command([room.agents[0]!.id]));
    engine.pump();
    await until(() => store.get(room.id).messages.length === 2);
    if (mode === 'complete') await until(() => store.get(room.id).jobs[0]!.status === 'completed');
    if (mode === 'stop') engine.control(room.id, 'stop');
    if (mode === 'thread-delete') engine.deleteThread(room.id, sent.threadId);
    if (mode === 'workspace-delete') engine.deleteRoom(room.id);
    const target = mode === 'thread-delete' ? room : other;
    engine.send(target.id, command([target.agents[1]!.id]));
    engine.pump();
    if (mode.endsWith('delete')) assert.equal(calls, 2);
    else {
      assert.equal(calls, 1);
      assert.ok(queued(engine, target, 1).blockers.includes('provider_capacity'));
      assert.deepEqual(engine.activity(room.id).workspaceCapacity, { inUse: 1, limit: 1 });
    }
    cleanup();
    await until(() => engine.activity(target.id).capacity.inUse === 0);
    engine.pump();
    await until(() => store.get(target.id).jobs.at(-1)!.status === 'completed');
    assert.ok(!JSON.stringify(store.all()).includes('LATE FORBIDDEN TEXT'));
  });
}

test('pending, probing, and archived workspaces cannot edit their caps; shutdown cannot dispatch held work', async (t) => {
  const f = fixture(1);
  t.after(f.close);
  const input = { title: f.room.title, objective: '', maxTurns: 100, maxConcurrentRequests: 2 };
  const probe = f.engine.testConnection(f.room.id, f.room.agents[0]!.id);
  assert.throws(() => f.engine.configureWorkspace(f.room.id, input), /pending work/);
  f.provider.releases[0]!();
  await probe;
  f.engine.send(f.room.id, command(f.room.agents.map((a) => a.id)));
  assert.throws(() => f.engine.configureWorkspace(f.room.id, input), /pending work/);
  f.engine.pump();
  assert.throws(() => f.engine.configureWorkspace(f.room.id, input), /pending work/);
  f.engine.control(f.room.id, 'stop');
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  f.engine.setWorkspaceArchived(f.room.id, { archived: true });
  assert.throws(() => f.engine.configureWorkspace(f.room.id, input), /archived/i);
  f.engine.setWorkspaceArchived(f.room.id, { archived: false });
  f.engine.configureWorkspace(f.room.id, input);
  f.engine.control(f.room.id, 'resume');
  f.engine.send(f.room.id, command([f.room.agents[1]!.id]));
  f.engine.close();
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 2);
});

test('failed SQLite writes preserve scoped policy and do not broadcast successful edits', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-capacity-rollback-'));
  const path = join(directory, 'rooms.sqlite');
  const store = new RoomStore(path);
  const engine = new ConversationEngine(store, new ControlledProvider(), { autoSchedule: false });
  const room = engine.createRoom({ title: 'Rollback', maxConcurrentRequests: 2 });
  const db = new DatabaseSync(path);
  t.after(() => {
    db.close();
    engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  db.exec(
    "CREATE TRIGGER reject_settings BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'fixture'); END; CREATE TRIGGER reject_room BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT, 'fixture'); END;",
  );
  let events = 0;
  engine.on('changed', () => {
    events++;
  });
  const before = engine.settings();
  assert.throws(() => limits(engine, { simulated: 1 }));
  assert.deepEqual(engine.settings(), before);
  assert.throws(() =>
    engine.configureWorkspace(room.id, {
      title: room.title,
      objective: '',
      maxTurns: 100,
      maxConcurrentRequests: 1,
    }),
  );
  assert.deepEqual(store.get(room.id), room);
  assert.equal(events, 0);
});

test('scoped policy HTTP writes enforce authentication, Host, Origin, method, body, and workspace scope', async (t) => {
  const f = fixture();
  const app = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  t.after(async () => {
    await app.close();
    f.close();
  });
  const base = `http://127.0.0.1:${app.port}`;
  const url = base + '/api/settings/provider-limits';
  assert.equal((await fetch(url, { method: 'PUT' })).status, 401);
  const { token } = (await (await fetch(base + '/api/session')).json()) as { token: string };
  const headers = { 'X-AIB-Token': token, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ ...defaultProviderConcurrency, simulated: 1 });
  assert.equal((await fetch(url, { headers })).status, 405);
  assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 405);
  assert.equal(
    (
      await fetch(url, {
        method: 'PUT',
        headers: { ...headers, Origin: 'https://evil.example' },
        body,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' },
        body,
      })
    ).status,
    403,
  );
  const hostStatus = await new Promise<number | undefined>((done, reject) => {
    get(url, { headers: { ...headers, Host: 'evil.example' } }, (res) => {
      res.resume();
      res.on('end', () => done(res.statusCode));
    }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal(
    (await fetch(url, { method: 'PUT', headers: { 'X-AIB-Token': token }, body })).status,
    415,
  );
  for (const invalid of [
    '{',
    '{}',
    JSON.stringify({ ...defaultProviderConcurrency, simulated: 0 }),
    JSON.stringify({ ...defaultProviderConcurrency, extra: 2 }),
  ])
    assert.equal((await fetch(url, { method: 'PUT', headers, body: invalid })).status, 400);
  assert.equal(
    (
      await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ padding: 'x'.repeat(70000) }),
      })
    ).status,
    413,
  );
  const saved = await fetch(url, { method: 'PUT', headers, body });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('cache-control'), 'no-store');
  assert.equal((await saved.json()).providerConcurrency.simulated, 1);
  const other = f.engine.createRoom({ title: 'Unchanged workspace' });
  const workspaceUrl = base + `/api/rooms/${f.room.id}/settings`;
  const input = { title: f.room.title, objective: '', maxTurns: 100, maxConcurrentRequests: 2 };
  assert.equal(
    (await fetch(workspaceUrl, { method: 'PUT', headers, body: JSON.stringify(input) })).status,
    200,
  );
  assert.equal(f.store.get(f.room.id).maxConcurrentRequests, 2);
  assert.equal(f.store.get(other.id).maxConcurrentRequests, 4);
  assert.equal(
    (
      await fetch(workspaceUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ...input, maxConcurrentRequests: 5 }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(base + '/api/rooms/missing/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify(input),
      })
    ).status,
    404,
  );
  assert.equal(f.engine.settings().defaultMaxTurns, defaultAppSettings.defaultMaxTurns);
});
