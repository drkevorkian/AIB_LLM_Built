import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  agentLabel,
  isAgentActive,
  isAgentRemoved,
  hasPendingWork,
  type Room,
} from '../src/shared/contracts.js';
import { ConversationEngine } from '../src/server/engine.js';
import { serve } from '../src/server/http.js';
import { RoomStore } from '../src/server/store.js';
import type { ProviderEvent, ProviderInput } from '../src/server/providers.js';
import { command, ControlledProvider, until } from './helpers.js';

function fixture(
  count = 3,
  provider = new ControlledProvider(),
  path = ':memory:',
  now?: () => Date,
) {
  const store = new RoomStore(path);
  const engine = new ConversationEngine(store, provider, { autoSchedule: false, now });
  const room = engine.createRoom({ title: 'Removal', participantCount: count });
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
function remove(
  f: ReturnType<typeof fixture>,
  id: string,
  revision = f.store.get(f.room.id).revision,
) {
  return f.engine.removeAgent(f.room.id, id, { expectedRevision: revision });
}
function configure(
  f: ReturnType<typeof fixture>,
  id: string,
  name: string,
  role = 'Independent role',
) {
  f.engine.configureAgent(f.room.id, {
    agentId: id,
    name,
    role,
    provider: 'simulated',
    model: 'simulation-v1',
  });
}
function retained(room: Room) {
  return {
    messages: room.messages,
    snapshots: room.snapshots,
    threads: room.threads,
    requests: room.requests,
    jobs: room.jobs,
    relays: room.relays,
    discussions: room.discussions,
    turnsUsed: room.turnsUsed,
    maxTurns: room.maxTurns,
    status: room.status,
  };
}

test('removal retires an exact identity, records a full revision, retains original provenance and usage, and excludes its settings from fresh context', async (t) => {
  let clock = Date.parse('2026-10-03T00:00:00Z');
  const f = fixture(2, undefined, ':memory:', () => new Date(clock++));
  t.after(f.close);
  const [a, b] = f.room.agents;
  const other = f.engine.createRoom({ title: 'Untouched', participantCount: 1 });
  const otherBefore = f.store.get(other.id);
  const sent = f.engine.send(f.room.id, command([b!.id]));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  configure(f, b!.id, 'Renamed <img onerror=alert(1)>', 'An unused private role fixture');
  const before = f.store.get(f.room.id);
  const notices: string[] = [];
  f.engine.on('changed', (id: string) => notices.push(id));
  const after = remove(f, b!.id);
  const retired = after.agents.find((agent) => agent.id === b!.id)!;
  assert.ok(isAgentRemoved(retired));
  assert.equal(retired.active, false);
  assert.equal(isAgentActive(retired), false);
  assert.equal(retired.configRevision, 2);
  assert.equal(retired.rosterNumber, 2);
  assert.deepEqual(retained(after), retained(before));
  assert.deepEqual(after.agentRevisions!.slice(0, -1), before.agentRevisions);
  assert.deepEqual(after.agentRevisions!.at(-1)!.agent, retired);
  assert.equal(after.agentRevisions!.at(-1)!.recordedAt, retired.removedAt);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.events.at(-1)!.type, 'agent.removed');
  assert.deepEqual(notices, [f.room.id]);
  assert.equal(f.provider.inputs.length, 1);
  assert.deepEqual(f.store.get(other.id), otherBefore);
  f.engine.send(f.room.id, command([a!.id], { threadId: sent.threadId }));
  f.engine.pump();
  const fresh = f.provider.inputs[1]!;
  assert.deepEqual(
    fresh.snapshot.agents.map((agent) => agent.id),
    [a!.id],
  );
  const oldAnswer = fresh.snapshot.messages.find((m) => m.authorId === b!.id)!;
  assert.equal(oldAnswer.authorName, 'AI B');
  assert.equal(oldAnswer.body, before.messages.find((m) => m.authorId === b!.id)!.body);
  f.provider.releases[1]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  const app = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const { token } = (await (await fetch(base + '/api/session')).json()) as { token: string };
    const transcript = await (
      await fetch(`${base}/api/rooms/${f.room.id}/export`, { headers: { 'X-AIB-Token': token } })
    ).text();
    assert.match(transcript, /## AI B · answer/);
    assert.ok(transcript.includes(oldAnswer.body));
    assert.ok(!transcript.includes('An unused private role fixture'));
  } finally {
    await app.close();
  }
});

test('removal frees a current roster slot while inactive identities still count and old IDs/numbers are never reused', (t) => {
  const f = fixture(8);
  t.after(f.close);
  const old = f.room.agents[0]!;
  f.engine.setAgentActive(f.room.id, old.id, { active: false });
  assert.throws(
    () => f.engine.addAgent(f.room.id, { name: 'Too many', role: 'Role' }),
    /at most 8/,
  );
  remove(f, old.id);
  const added = f.engine.addAgent(f.room.id, {
    name: old.name,
    role: 'Replacement is a new identity',
  });
  assert.notEqual(added.id, old.id);
  assert.equal(added.rosterNumber, 9);
  assert.equal(added.provider, 'simulated');
  assert.equal(added.configRevision, 0);
  const current = f.store.get(f.room.id);
  assert.equal(current.agents.filter((a) => !isAgentRemoved(a)).length, 8);
  assert.equal(current.agents.length, 9);
  assert.throws(
    () => f.engine.addAgent(f.room.id, { name: 'Ninth current', role: 'Role' }),
    /at most 8/,
  );
  assert.deepEqual(f.store.get(f.room.id), current);
  assert.equal(f.provider.inputs.length, 0);
});

test('removal rejects the last active identity, unknown/cross-workspace IDs, malformed confirmations, and stale revisions without mutation', (t) => {
  const f = fixture(2);
  t.after(f.close);
  const [a, b] = f.room.agents;
  f.engine.setAgentActive(f.room.id, b!.id, { active: false });
  let before = f.store.get(f.room.id);
  assert.throws(() => remove(f, a!.id), /at least one active/);
  assert.throws(() => remove(f, 'missing'), /Unknown/);
  const other = f.engine.createRoom({ title: 'Other', participantCount: 1 });
  const otherBefore = f.store.get(other.id);
  assert.throws(
    () => f.engine.removeAgent(other.id, b!.id, { expectedRevision: other.revision }),
    /Unknown/,
  );
  assert.deepEqual(f.store.get(other.id), otherBefore);
  for (const input of [
    {},
    { expectedRevision: -1 },
    { expectedRevision: 0.5 },
    { expectedRevision: '1' },
    { expectedRevision: Infinity },
    { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { expectedRevision: before.revision, active: false },
    { expectedRevision: before.revision, removedAt: 'forged' },
  ])
    assert.throws(() =>
      f.engine.removeAgent(f.room.id, b!.id, input as Parameters<typeof f.engine.removeAgent>[2]),
    );
  assert.deepEqual(f.store.get(f.room.id), before);
  configure(f, b!.id, 'Changed after review');
  assert.throws(() => remove(f, b!.id, before.revision), /Workspace changed/);
  before = f.store.get(f.room.id);
  f.engine.send(f.room.id, command([], { type: 'update', body: 'Changed retained history' }));
  assert.throws(() => remove(f, b!.id, before.revision), /Workspace changed/);
  f.store.mutate(f.room.id, (room) => {
    for (const agent of room.agents) agent.active = false;
  });
  before = f.store.get(f.room.id);
  assert.throws(() => remove(f, b!.id), /at least one active/);
  assert.deepEqual(f.store.get(f.room.id), before);
  assert.equal(f.provider.inputs.length, 0);
});

test('queued/running work in any participant blocks removal without cancellation; stopped work permits a fresh removal after cleanup', async (t) => {
  const f = fixture();
  t.after(f.close);
  const [a, b] = f.room.agents;
  f.engine.control(f.room.id, 'pause');
  f.engine.send(f.room.id, command([b!.id]));
  const queued = f.store.get(f.room.id);
  assert.throws(() => remove(f, a!.id), /pending work/);
  assert.deepEqual(f.store.get(f.room.id), queued);
  assert.equal(f.provider.inputs.length, 0);
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  await until(() => f.provider.inputs.length === 1);
  const running = f.store.get(f.room.id);
  assert.throws(() => remove(f, a!.id), /pending work/);
  assert.deepEqual(f.store.get(f.room.id), running);
  f.engine.control(f.room.id, 'stop');
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  const stopped = f.store.get(f.room.id);
  const after = remove(f, b!.id);
  assert.deepEqual(retained(after), retained(stopped));
  assert.equal(after.turnsUsed, 1);
  assert.equal(after.status, 'stopped');
  assert.equal(f.provider.inputs.length, 1);
});

for (const mode of ['relay', 'discussion'] as const)
  test(`blocked ${mode} obligations prevent removal until an explicit Stop`, async (t) => {
    const f = fixture();
    t.after(f.close);
    const [a, b, c] = f.room.agents;
    f.provider.endings[0] = 'fail';
    f.engine.send(
      f.room.id,
      command(
        [a!.id],
        mode === 'relay'
          ? { relayOrder: [a!.id, b!.id] }
          : { discussion: { maxRounds: 2, maxTurns: 5 } },
      ),
    );
    f.engine.pump();
    f.provider.releases[0]!();
    await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
    const blocked = f.store.get(f.room.id);
    assert.ok(hasPendingWork(blocked));
    assert.throws(() => remove(f, c!.id), /pending work/);
    assert.deepEqual(f.store.get(f.room.id), blocked);
    f.engine.control(f.room.id, 'stop');
    const stopped = f.store.get(f.room.id);
    const after = remove(f, c!.id);
    assert.deepEqual(retained(after), retained(stopped));
    assert.equal(f.provider.inputs.length, 1);
  });

test('any workspace probe blocks removal; retired records reject configuration, activation, repeat removal, and both connection-test kinds', async (t) => {
  const f = fixture(2);
  t.after(f.close);
  const [a, b] = f.room.agents;
  const probe = f.engine.testConnection(f.room.id, a!.id);
  const probing = f.store.get(f.room.id);
  assert.throws(() => remove(f, b!.id), /pending work/);
  assert.deepEqual(f.store.get(f.room.id), probing);
  f.provider.releases[0]!();
  await probe;
  const after = remove(f, b!.id);
  for (const active of [true, false])
    assert.throws(() => f.engine.setAgentActive(f.room.id, b!.id, { active }), /Removed/);
  assert.throws(() => configure(f, b!.id, 'Resurrect'), /removed/);
  assert.throws(() => remove(f, b!.id), /already removed/);
  for (const kind of ['greeting', 'coordinator'] as const)
    await assert.rejects(f.engine.testConnection(f.room.id, b!.id, kind), /Removed/);
  assert.deepEqual(f.store.get(f.room.id), after);
  assert.equal(f.provider.inputs.length, 1);
});

test('a terminal request still closing its transport blocks removal until the slot is actually released', async (t) => {
  let releaseClose!: () => void;
  const closing = new Promise<void>((resolve) => {
    releaseClose = resolve;
  });
  class ClosingProvider extends ControlledProvider {
    override async *generate(
      input: ProviderInput,
      signal: AbortSignal,
    ): AsyncIterable<ProviderEvent> {
      try {
        yield* super.generate(input, signal);
      } finally {
        await closing;
      }
    }
  }
  const f = fixture(2, new ClosingProvider());
  t.after(() => {
    releaseClose();
    f.close();
  });
  f.engine.send(f.room.id, command([f.room.agents[0]!.id]));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
  const before = f.store.get(f.room.id);
  assert.equal(hasPendingWork(before), false);
  assert.throws(() => remove(f, f.room.agents[1]!.id), /request cleanup/);
  assert.deepEqual(f.store.get(f.room.id), before);
  releaseClose();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  assert.ok(isAgentRemoved(remove(f, f.room.agents[1]!.id).agents[1]!));
});

test('retired identities cannot be recipients, synthesizers, relay steps, coordinators, or peers even if a stale record marks them active', async (t) => {
  const f = fixture();
  t.after(f.close);
  const [a, b, c] = f.room.agents;
  remove(f, c!.id);
  f.store.mutate(f.room.id, (room) => {
    room.agents[2]!.active = true;
  });
  const before = f.store.get(f.room.id);
  assert.equal(isAgentActive(before.agents[2]!), false);
  for (const input of [
    command([c!.id]),
    command([a!.id], { synthesisAgentId: c!.id }),
    command([a!.id], { relayOrder: [a!.id, c!.id] }),
    command([c!.id], { discussion: { maxRounds: 1, maxTurns: 5 } }),
  ])
    assert.throws(() => f.engine.send(f.room.id, input), /inactive/);
  assert.deepEqual(f.store.get(f.room.id), before);
  f.provider.actions[0] = {
    kind: 'finish',
    body: 'Done',
    recipientIds: [],
    policy: 'all',
    quorum: 1,
    replyTo: null,
  };
  f.engine.send(f.room.id, command([a!.id], { discussion: { maxRounds: 1, maxTurns: 5 } }));
  f.engine.pump();
  assert.deepEqual(f.provider.inputs[0]!.discussion!.allowedPeerIds, [b!.id]);
  assert.deepEqual(
    f.provider.inputs[0]!.snapshot.agents.map((a) => a.id),
    [a!.id, b!.id],
  );
  f.provider.releases[0]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
});

test('a removed identity in stale queued data is cancelled defensively before any invocation or turn use', (t) => {
  const f = fixture();
  t.after(f.close);
  const [, , c] = f.room.agents;
  f.engine.send(f.room.id, command([c!.id]));
  f.store.mutate(f.room.id, (room) => {
    room.agents[2]!.removedAt = '2026-10-02T00:00:00.000Z';
    room.agents[2]!.active = true;
  });
  f.engine.pump();
  assert.equal(f.store.get(f.room.id).jobs[0]!.status, 'cancelled');
  assert.equal(f.store.get(f.room.id).turnsUsed, 0);
  assert.equal(f.provider.inputs.length, 0);
});

for (const required of ['recipient', 'synthesizer'] as const)
  test(`failed retries requiring a removed ${required} never reserve turns or bind to a replacement identity`, async (t) => {
    const f = fixture();
    t.after(f.close);
    const [a, b] = f.room.agents;
    f.provider.endings[0] = 'fail';
    f.engine.send(
      f.room.id,
      command([b!.id], required === 'synthesizer' ? { synthesisAgentId: a!.id } : {}),
    );
    f.engine.pump();
    f.provider.releases[0]!();
    await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
    const id = required === 'recipient' ? b!.id : a!.id;
    remove(f, id);
    const replacement = f.engine.addAgent(f.room.id, {
      name: required === 'recipient' ? b!.name : a!.name,
      role: 'New identity',
    });
    assert.notEqual(replacement.id, id);
    const before = f.store.get(f.room.id);
    assert.throws(() => f.engine.retry(f.room.id, before.jobs[0]!.id), /removed participant/);
    assert.deepEqual(f.store.get(f.room.id), before);
    assert.equal(f.provider.inputs.length, 1);
  });

test('removing an observer allows an otherwise eligible retry with its unchanged original roster and bindings', async (t) => {
  const f = fixture();
  t.after(f.close);
  const [, b, c] = f.room.agents;
  f.provider.endings[0] = 'fail';
  f.engine.send(f.room.id, command([b!.id]));
  f.engine.pump();
  const original = structuredClone(f.provider.inputs[0]!);
  f.provider.releases[0]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  remove(f, c!.id);
  configure(f, b!.id, 'A newer unused binding');
  f.engine.retry(f.room.id, f.store.get(f.room.id).jobs[0]!.id);
  f.engine.pump();
  assert.deepEqual(f.provider.inputs[1]!.agent, original.agent);
  assert.deepEqual(f.provider.inputs[1]!.snapshot, original.snapshot);
  assert.ok(
    f.provider.inputs[1]!.snapshot.agents.some((a) => a.id === c!.id && !isAgentRemoved(a)),
  );
  f.provider.releases[1]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
});

test('SQLite write failure rolls back removal time, activation, revisions, history, and audit together', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-removal-fault-'));
  const path = join(directory, 'rooms.sqlite');
  const f = fixture(2, new ControlledProvider(), path);
  t.after(() => {
    f.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const before = f.store.get(f.room.id);
  const fault = new DatabaseSync(path);
  try {
    fault.exec(
      "CREATE TRIGGER fail_removal BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT, 'removal write fault'); END;",
    );
  } finally {
    fault.close();
  }
  assert.throws(() => remove(f, before.agents[1]!.id), /removal write fault/);
  assert.deepEqual(f.store.get(f.room.id), before);
  assert.equal(f.provider.inputs.length, 0);
});

test('legacy ordinals and removal persist across disk restart without rewriting original snapshots or reusing duplicate-name numbers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-removal-disk-'));
  const path = join(directory, 'rooms.sqlite');
  let f = fixture(3, new ControlledProvider(), path);
  try {
    const [a, b] = f.room.agents;
    configure(f, a!.id, 'Twin');
    configure(f, b!.id, 'Twin');
    f.engine.send(f.room.id, command([b!.id]));
    f.engine.pump();
    f.provider.releases[0]!();
    await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
    f.store.mutate(f.room.id, (room) => {
      for (const agent of room.agents) {
        delete agent.rosterNumber;
        delete agent.active;
      }
      for (const snapshot of room.snapshots)
        for (const agent of snapshot.agents) delete agent.rosterNumber;
      for (const revision of room.agentRevisions!) delete revision.agent.rosterNumber;
    });
    const legacy = f.store.get(f.room.id);
    assert.equal(agentLabel(legacy, b!.id, legacy.snapshots[0]!.id), 'Twin · #2');
    remove(f, a!.id);
    const removed = f.store.get(f.room.id);
    assert.deepEqual(removed.snapshots, legacy.snapshots);
    f.close();
    const store = new RoomStore(path);
    const provider = new ControlledProvider();
    const engine = new ConversationEngine(store, provider, { autoSchedule: false });
    f = {
      store,
      provider,
      engine,
      room: removed,
      close: () => {
        engine.close();
        store.close();
      },
    };
    const recovered = store.get(removed.id);
    assert.ok(isAgentRemoved(recovered.agents[0]!));
    assert.deepEqual(recovered.snapshots, legacy.snapshots);
    assert.throws(() => engine.setAgentActive(removed.id, a!.id, { active: true }), /Removed/);
    const added = engine.addAgent(removed.id, { name: 'Twin', role: 'Independent twin' });
    const next = store.get(removed.id);
    assert.equal(added.rosterNumber, 4);
    assert.equal(agentLabel(next, b!.id), 'Twin · #2');
    assert.equal(agentLabel(next, added.id), 'Twin · #4');
    engine.send(removed.id, command([b!.id]));
    const snapshot = store.get(removed.id).snapshots.at(-1)!;
    assert.equal(snapshot.agents.length, 3);
    assert.equal(agentLabel(store.get(removed.id), b!.id, snapshot.id), 'Twin · #2');
    assert.equal(agentLabel(store.get(removed.id), added.id, snapshot.id), 'Twin · #4');
    assert.equal(agentLabel(store.get(removed.id), a!.id, legacy.snapshots[0]!.id), 'Twin · #1');
    assert.equal(provider.inputs.length, 0);
  } finally {
    f.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('generated identities cannot reuse a retained removed ID', () => {
  const store = new RoomStore(':memory:');
  let forced: string | null = null;
  const engine = new ConversationEngine(store, new ControlledProvider(), {
    autoSchedule: false,
    id: () => forced ?? randomUUID(),
  });
  try {
    const room = engine.createRoom({ title: 'Unique', participantCount: 2 });
    engine.removeAgent(room.id, room.agents[1]!.id, { expectedRevision: room.revision });
    forced = room.agents[1]!.id;
    const before = store.get(room.id);
    assert.throws(() => engine.addAgent(room.id, { name: 'Reuse', role: 'No' }), /already exists/);
    assert.deepEqual(store.get(room.id), before);
  } finally {
    engine.close();
    store.close();
  }
});

test('removal HTTP requires a reviewed revision, exact scope, authenticated safe origins/Host, and supported methods; replay stays read-only', async (t) => {
  const f = fixture(2);
  t.after(f.close);
  const app = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const { token } = (await (await fetch(base + '/api/session')).json()) as { token: string };
    const headers = { 'X-AIB-Token': token, 'Content-Type': 'application/json' };
    const target = `${base}/api/rooms/${f.room.id}/participants/${f.room.agents[1]!.id}`;
    const body = { expectedRevision: f.room.revision };
    const del = (url = target, input: unknown = body, extra = {}) =>
      fetch(url, {
        method: 'DELETE',
        headers: { ...headers, ...extra },
        body: JSON.stringify(input),
      });
    const before = f.store.get(f.room.id);
    assert.equal(
      (await fetch(target, { method: 'DELETE', body: JSON.stringify(body) })).status,
      401,
    );
    assert.equal((await del(target, body, { Origin: 'https://foreign.example' })).status, 403);
    assert.equal((await del(target, body, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    const wrongHost = await new Promise<number>((resolve, reject) => {
      const req = request(
        target,
        {
          method: 'DELETE',
          headers: {
            ...headers,
            Host: 'foreign.example',
            'Content-Length': Buffer.byteLength(JSON.stringify(body)),
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode!));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
    assert.equal(wrongHost, 403);
    for (const input of [
      {},
      { expectedRevision: '0' },
      { expectedRevision: 0, agentId: f.room.agents[0]!.id },
      { expectedRevision: 0, removedAt: 'forged' },
    ])
      assert.equal((await del(target, input)).status, 400);
    for (const method of ['GET', 'PATCH', 'POST'])
      assert.equal((await fetch(target, { method, headers })).status, 405);
    const other = f.engine.createRoom({ title: 'Other', participantCount: 1 });
    const otherBefore = f.store.get(other.id);
    assert.equal(
      (
        await del(`${base}/api/rooms/${other.id}/participants/${f.room.agents[1]!.id}`, {
          expectedRevision: other.revision,
        })
      ).status,
      400,
    );
    assert.equal(
      (await del(`${base}/api/rooms/missing/participants/${f.room.agents[1]!.id}`)).status,
      404,
    );
    assert.deepEqual(f.store.get(f.room.id), before);
    const response = await del();
    assert.equal(response.status, 200);
    const after = (await response.json()) as Room;
    assert.ok(isAgentRemoved(after.agents[1]!));
    assert.equal((await del()).status, 409);
    assert.deepEqual(f.store.get(f.room.id), after);
    assert.deepEqual(f.store.get(other.id), otherBefore);
    assert.equal(f.provider.inputs.length, 0);
    const activity = (await (
      await fetch(`${base}/api/rooms/${f.room.id}/activity`, { headers })
    ).json()) as { participants: { agentId: string }[] };
    assert.deepEqual(
      activity.participants.map((a) => a.agentId),
      [f.room.agents[0]!.id],
    );
  } finally {
    await app.close();
  }
});

test('archives and service shutdown reject removal without changing retained records', (t) => {
  const f = fixture(2);
  t.after(f.close);
  f.engine.setWorkspaceArchived(f.room.id, { archived: true });
  const archived = f.store.get(f.room.id);
  assert.throws(() => remove(f, f.room.agents[1]!.id), /Restore/);
  assert.deepEqual(f.store.get(f.room.id), archived);
  f.engine.setWorkspaceArchived(f.room.id, { archived: false });
  f.engine.close();
  const closed = f.store.get(f.room.id);
  assert.throws(() => remove(f, f.room.agents[1]!.id), /shutting down/);
  assert.deepEqual(f.store.get(f.room.id), closed);
});
