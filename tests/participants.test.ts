import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { isAgentActive, type AgentSettingsInput, type Room } from '../src/shared/contracts.js';
import { ConversationEngine } from '../src/server/engine.js';
import { RoomStore } from '../src/server/store.js';
import { serve } from '../src/server/http.js';
import { SimulatedProvider } from '../src/server/providers.js';
import { command, ControlledProvider, until } from './helpers.js';

function fixture(participantCount = 3) {
  const store = new RoomStore(':memory:');
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false });
  const room = engine.createRoom({ title: 'Roster', participantCount });
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
function settings(room: Room, index: number, name: string): AgentSettingsInput {
  const agent = room.agents[index]!;
  return {
    agentId: agent.id,
    name,
    role: 'A new independent role',
    provider: 'simulated',
    model: 'simulation-v1',
  };
}

test('workspaces support one to eight independent identities; default rosters and strict bounds remain compatible', (t) => {
  const f = fixture();
  t.after(f.close);
  assert.equal(f.room.agents.length, 3);
  for (const count of [1, 2, 5, 8]) {
    const room = f.engine.createRoom({ title: 'Count ' + count, participantCount: count });
    assert.equal(room.agents.length, count);
    assert.equal(new Set(room.agents.map((a) => a.id)).size, count);
    assert.ok(room.agents.every((a) => isAgentActive(a) && a.provider === 'simulated'));
    assert.equal(room.agentRevisions?.length, count);
  }
  for (const participantCount of [0, 9, 1.5])
    assert.throws(() => f.engine.createRoom({ title: 'Invalid', participantCount }));
  const before = f.store.all().length;
  assert.throws(() =>
    f.engine.createRoom({ title: 'Forged', participantCount: 2, agents: [] } as Parameters<
      typeof f.engine.createRoom
    >[0]),
  );
  assert.equal(f.store.all().length, before);
});

test('adding duplicate names creates separate simulated identities; the cap includes inactive participants', (t) => {
  const f = fixture(7);
  t.after(f.close);
  const added = f.engine.addAgent(f.room.id, {
    name: f.room.agents[0]!.name,
    role: 'Independent instance',
  });
  assert.notEqual(added.id, f.room.agents[0]!.id);
  assert.equal(added.model, 'simulation-v1');
  assert.equal(f.provider.inputs.length, 0);
  f.engine.setAgentActive(f.room.id, added.id, { active: false });
  const before = f.store.get(f.room.id);
  assert.throws(
    () => f.engine.addAgent(f.room.id, { name: 'Ninth', role: 'Contributor' }),
    /at most 8/,
  );
  assert.throws(() =>
    f.engine.addAgent(f.room.id, { name: 'Forged', role: 'Contributor', id: 'human' } as Parameters<
      typeof f.engine.addAgent
    >[1]),
  );
  assert.deepEqual(f.store.get(f.room.id), before);
});

test('activation is reversible, retains history and usage, records every revision, and keeps one active participant', (t) => {
  const f = fixture(2);
  t.after(f.close);
  const agent = f.room.agents[1]!;
  f.engine.configureAgent(f.room.id, settings(f.room, 1, 'Uninvoked first revision'));
  f.engine.configureAgent(f.room.id, settings(f.room, 1, 'Uninvoked second revision'));
  f.engine.setAgentActive(f.room.id, agent.id, { active: false });
  let room = f.store.get(f.room.id);
  assert.equal(room.turnsUsed, 0);
  assert.deepEqual(
    room.agentRevisions
      ?.filter((r) => r.agent.id === agent.id)
      .map((r) => [r.agent.configRevision, r.agent.name, isAgentActive(r.agent)]),
    [
      [0, 'AI B', true],
      [1, 'Uninvoked first revision', true],
      [2, 'Uninvoked second revision', true],
      [3, 'Uninvoked second revision', false],
    ],
  );
  assert.throws(
    () => f.engine.setAgentActive(f.room.id, f.room.agents[0]!.id, { active: false }),
    /at least one/,
  );
  assert.throws(() => f.engine.setAgentActive(f.room.id, 'unknown', { active: true }), /Unknown/);
  assert.deepEqual(f.store.get(f.room.id), room);
  f.engine.setAgentActive(f.room.id, agent.id, { active: false });
  assert.equal(f.store.get(f.room.id).agentRevisions?.length, room.agentRevisions?.length);
  f.engine.setAgentActive(f.room.id, agent.id, { active: true });
  room = f.store.get(f.room.id);
  assert.equal(room.agents[1]!.id, agent.id);
  assert.equal(room.agents[1]!.configRevision, 4);
  assert.ok(isAgentActive(room.agents[1]!));
});

test('queued and running work block roster changes atomically; stop permits editing without changing old snapshots', async (t) => {
  const f = fixture();
  t.after(f.close);
  const b = f.room.agents[1]!;
  f.engine.control(f.room.id, 'pause');
  f.engine.send(f.room.id, command([b.id]));
  const queued = f.store.get(f.room.id);
  for (const edit of [
    () => f.engine.addAgent(f.room.id, { name: 'New', role: 'Contributor' }),
    () => f.engine.setAgentActive(f.room.id, b.id, { active: false }),
    () => f.engine.configureAgent(f.room.id, settings(f.room, 1, 'Changed')),
  ])
    assert.throws(edit, /pending work/);
  assert.deepEqual(f.store.get(f.room.id), queued);
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  await until(() => f.provider.inputs.length === 1);
  assert.throws(() => f.engine.setAgentActive(f.room.id, b.id, { active: false }), /pending work/);
  f.engine.control(f.room.id, 'stop');
  f.engine.setAgentActive(f.room.id, b.id, { active: false });
  f.engine.addAgent(f.room.id, { name: 'Added', role: 'Contributor' });
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'cancelled');
  assert.equal(f.store.get(f.room.id).turnsUsed, 1);
  assert.ok(isAgentActive(f.provider.inputs[0]!.snapshot.agents[1]!));
  assert.equal(f.provider.inputs[0]!.snapshot.agents.length, 3);
});

for (const mode of ['relay', 'discussion'] as const)
  test(`a blocked ${mode} retains its frozen roster until explicitly stopped`, async (t) => {
    const f = fixture();
    t.after(f.close);
    const a = f.room.agents[0]!.id;
    f.provider.endings[0] = 'fail';
    f.engine.send(
      f.room.id,
      command(
        [a],
        mode === 'relay'
          ? { relayOrder: [a, f.room.agents[1]!.id] }
          : { discussion: { maxRounds: 2, maxTurns: 5 } },
      ),
    );
    f.engine.pump();
    f.provider.releases[0]!();
    await until(() => f.store.get(f.room.id).jobs[0]!.status === 'failed');
    const before = f.store.get(f.room.id);
    assert.throws(() => f.engine.setAgentActive(f.room.id, a, { active: false }), /pending work/);
    assert.throws(
      () => f.engine.addAgent(f.room.id, { name: 'New', role: 'Contributor' }),
      /pending work/,
    );
    assert.deepEqual(f.store.get(f.room.id), before);
    f.engine.control(f.room.id, 'stop');
    f.engine.setAgentActive(f.room.id, a, { active: false });
  });

test('any participant connection probe blocks roster edits; inactive connection checks never invoke a provider', async (t) => {
  const f = fixture();
  t.after(f.close);
  const a = f.room.agents[0]!.id;
  const b = f.room.agents[1]!.id;
  const probe = f.engine.testConnection(f.room.id, a);
  const before = f.store.get(f.room.id);
  assert.throws(
    () => f.engine.configureAgent(f.room.id, settings(f.room, 1, 'Changed')),
    /pending work/,
  );
  assert.throws(() => f.engine.setAgentActive(f.room.id, b, { active: false }), /pending work/);
  assert.throws(
    () => f.engine.addAgent(f.room.id, { name: 'New', role: 'Contributor' }),
    /pending work/,
  );
  assert.deepEqual(f.store.get(f.room.id), before);
  f.provider.releases[0]!();
  await probe;
  f.engine.setAgentActive(f.room.id, b, { active: false });
  await assert.rejects(f.engine.testConnection(f.room.id, b), /Reactivate/);
  assert.equal(f.provider.inputs.length, 1);
});

test('inactive identities are rejected for direct, relay, synthesis, and coordinator routing; discussion grants contain active peers only', async (t) => {
  const f = fixture();
  t.after(f.close);
  const [a, b, c] = f.room.agents;
  f.engine.setAgentActive(f.room.id, b!.id, { active: false });
  const before = f.store.get(f.room.id);
  for (const input of [
    command([b!.id]),
    command([a!.id], { synthesisAgentId: b!.id }),
    command([a!.id], { relayOrder: [a!.id, b!.id] }),
    command([b!.id], { discussion: { maxRounds: 2, maxTurns: 5 } }),
  ])
    assert.throws(() => f.engine.send(f.room.id, input), /inactive/);
  assert.deepEqual(f.store.get(f.room.id), before);
  f.provider.actions[0] = {
    kind: 'ask',
    body: 'Ask the inactive peer.',
    recipientIds: [b!.id],
    policy: 'all',
    quorum: 1,
    replyTo: null,
  };
  f.engine.send(f.room.id, command([a!.id], { discussion: { maxRounds: 2, maxTurns: 5 } }));
  f.engine.pump();
  assert.deepEqual(f.provider.inputs[0]!.discussion?.allowedPeerIds, [c!.id]);
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs.length === 2);
  assert.ok(f.store.get(f.room.id).jobs.every((j) => j.agentId === a!.id && j.kind === 'decision'));
});

test('inactive failed attempts cannot reserve or invoke retries; reactivation retains the original provider binding', async (t) => {
  const f = fixture();
  t.after(f.close);
  const b = f.room.agents[1]!;
  f.provider.endings[0] = 'fail';
  f.engine.send(f.room.id, command([b.id]));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'failed');
  const jobId = f.store.get(f.room.id).jobs[0]!.id;
  f.engine.setAgentActive(f.room.id, b.id, { active: false });
  f.engine.configureAgent(f.room.id, settings(f.room, 1, 'New name'));
  const before = f.store.get(f.room.id);
  assert.throws(() => f.engine.retry(f.room.id, jobId), /Reactivate/);
  assert.deepEqual(f.store.get(f.room.id), before);
  assert.equal(f.provider.inputs.length, 1);
  f.engine.setAgentActive(f.room.id, b.id, { active: true });
  f.engine.retry(f.room.id, jobId);
  f.engine.pump();
  assert.equal(f.provider.inputs[1]!.agent.name, 'AI B');
  f.provider.releases[1]!();
  await until(() => f.store.get(f.room.id).jobs[1]!.status === 'completed');
});

test('eight participants share independent frozen context and honor the global concurrency limit', async (t) => {
  const f = fixture(8);
  t.after(f.close);
  f.engine.send(f.room.id, command(f.room.agents.map((a) => a.id)));
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 4);
  for (let index = 0; index < 8; index++) {
    assert.equal(f.provider.inputs[index]!.snapshot.messages.length, 1);
    assert.equal(f.provider.inputs[index]!.includedAnswers.length, 0);
    f.provider.releases[index]!();
    await until(() => f.store.get(f.room.id).jobs[index]!.status === 'completed');
    f.engine.pump();
  }
  assert.equal(new Set(f.provider.inputs.map((i) => i.agent.id)).size, 8);
  assert.equal(f.store.get(f.room.id).requests[0]!.includedMessageIds.length, 8);
});

test('a single-participant simulated coordinator finishes without dispatching an empty peer request', async (t) => {
  const f = fixture(1);
  t.after(f.close);
  f.engine.send(
    f.room.id,
    command([f.room.agents[0]!.id], { discussion: { maxRounds: 2, maxTurns: 5 } }),
  );
  f.engine.pump();
  const events = [];
  for await (const event of new SimulatedProvider().generate(
    f.provider.inputs[0]!,
    new AbortController().signal,
  ))
    events.push(event);
  assert.equal(events[0]!.type, 'action');
  if (events[0]!.type === 'action')
    assert.equal((events[0]!.action as { kind: string }).kind, 'finish');
});

test('dispatch refuses inactive identities in legacy queued records without consuming a turn or invoking a provider', (t) => {
  const f = fixture();
  t.after(f.close);
  const b = f.room.agents[1]!.id;
  f.engine.send(f.room.id, command([b]));
  f.store.mutate(f.room.id, (room) => {
    room.agents[1]!.active = false;
  });
  let changes = 0;
  f.engine.on('changed', () => {
    changes++;
  });
  f.engine.pump();
  const room = f.store.get(f.room.id);
  assert.equal(room.jobs[0]!.status, 'cancelled');
  assert.equal(room.requests[0]!.status, 'unresolved');
  assert.equal(room.turnsUsed, 0);
  assert.equal(f.provider.inputs.length, 0);
  assert.ok(changes > 0);
});

test('legacy configurations backfill only known revisions; new history and inactive identities persist across restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-roster-'));
  const path = join(directory, 'rooms.sqlite');
  let store = new RoomStore(path);
  let engine = new ConversationEngine(store, new ControlledProvider(), { autoSchedule: false });
  try {
    const room = engine.createRoom({ title: 'Persisted' });
    engine.send(room.id, command([room.agents[1]!.id]));
    engine.control(room.id, 'stop');
    engine.configureAgent(room.id, settings(room, 1, 'Unused missing legacy revision'));
    engine.configureAgent(room.id, settings(room, 1, 'Current legacy name'));
    store.mutate(room.id, (legacy) => {
      delete legacy.agentRevisions;
      for (const agent of legacy.agents) delete agent.active;
      for (const snapshot of legacy.snapshots)
        for (const agent of snapshot.agents) delete agent.active;
    });
    const legacy = store.get(room.id);
    assert.ok(legacy.agents.every(isAgentActive));
    assert.deepEqual(
      legacy.agentRevisions
        ?.filter((r) => r.agent.id === room.agents[1]!.id)
        .map((r) => [r.agent.configRevision, r.recordedAt]),
      [
        [0, null],
        [2, null],
      ],
    );
    engine.setAgentActive(room.id, room.agents[1]!.id, { active: false });
    const saved = store.get(room.id);
    engine.close();
    store.close();
    store = new RoomStore(path);
    engine = new ConversationEngine(store, new ControlledProvider(), { autoSchedule: false });
    assert.deepEqual(store.get(room.id).agentRevisions, saved.agentRevisions);
    assert.equal(store.get(room.id).agents[1]!.active, false);
    assert.equal(store.get(room.id).agents[1]!.id, room.agents[1]!.id);
  } finally {
    engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('renaming preserves old author and recipient attribution in fresh context and Markdown exports', async (t) => {
  const f = fixture();
  t.after(f.close);
  const b = f.room.agents[1]!.id;
  const first = f.engine.send(f.room.id, command([b]));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
  f.engine.configureAgent(f.room.id, settings(f.room, 1, 'Renamed reviewer'));
  f.engine.send(f.room.id, command([b], { threadId: first.threadId, body: 'A new follow-up.' }));
  f.engine.pump();
  assert.equal(f.provider.inputs[1]!.agent.name, 'Renamed reviewer');
  assert.equal(
    f.provider.inputs[1]!.snapshot.messages.find((m) => m.authorId === b)!.authorName,
    'AI B',
  );
  f.provider.releases[1]!();
  await until(() => f.store.get(f.room.id).jobs[1]!.status === 'completed');
  const app = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const { token } = (await (await fetch(base + '/api/session')).json()) as { token: string };
    const text = await (
      await fetch(`${base}/api/rooms/${f.room.id}/export`, { headers: { 'X-AIB-Token': token } })
    ).text();
    assert.match(text, /## AI B · answer/);
    assert.match(text, /## Renamed reviewer · answer/);
    assert.match(text, /To: AI B \(/);
    assert.match(text, /To: Renamed reviewer \(/);
  } finally {
    await app.close();
  }
});

test('participant HTTP commands enforce authentication, origin, strict fields, limits, and workspace scope', async (t) => {
  const f = fixture();
  t.after(f.close);
  const app = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const { token } = (await (await fetch(base + '/api/session')).json()) as { token: string };
    const headers = { 'X-AIB-Token': token, 'Content-Type': 'application/json' };
    const url = `${base}/api/rooms/${f.room.id}/participants`;
    const input = { name: 'HTTP participant', role: 'Independent contributor' };
    const send = (target: string, method: string, body: unknown, extra = {}) =>
      fetch(target, { method, headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify(input) })).status, 401);
    assert.equal((await send(url, 'POST', input, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await send(url, 'POST', { ...input, id: 'human' })).status, 400);
    assert.equal((await send(url, 'POST', { ...input, apiKey: 'must-not-be-saved' })).status, 400);
    const added = await send(url, 'POST', input);
    assert.equal(added.status, 201);
    const next = (await added.json()) as Room;
    const agent = next.agents.at(-1)!;
    assert.equal(agent.name, input.name);
    assert.equal(next.agents.length, 4);
    const target = `${url}/${agent.id}`;
    assert.equal((await send(target, 'PUT', { active: 'false' })).status, 400);
    assert.equal((await send(target, 'PUT', { active: false, model: 'forged' })).status, 400);
    assert.equal((await send(target, 'PUT', { active: false })).status, 200);
    const other = f.engine.createRoom({ title: 'Other workspace', participantCount: 1 });
    const otherBefore = f.store.get(other.id);
    assert.equal(
      (
        await send(`${base}/api/rooms/${other.id}/participants/${agent.id}`, 'PUT', {
          active: true,
        })
      ).status,
      400,
    );
    assert.deepEqual(f.store.get(other.id), otherBefore);
    assert.equal(
      (await send(`${base}/api/rooms`, 'POST', { title: 'Too many', participantCount: 9 })).status,
      400,
    );
    assert.equal(
      (await send(`${base}/api/rooms`, 'POST', { title: 'Single', participantCount: 1 })).status,
      201,
    );
    assert.equal((await send(`${base}/api/rooms/missing/participants`, 'POST', input)).status, 404);
    const beforeRemoval = f.store.get(f.room.id);
    assert.equal((await fetch(target, { method: 'DELETE', headers })).status, 400);
    assert.deepEqual(f.store.get(f.room.id), beforeRemoval);
  } finally {
    await app.close();
  }
});

test('synthesis retries preserve the failed attempt model, objective, roster, and historical answer labels after edits', async (t) => {
  const f = fixture();
  t.after(f.close);
  const [a, b, c] = f.room.agents;
  f.provider.endings[1] = 'fail';
  f.engine.send(f.room.id, command([b!.id], { synthesisAgentId: a!.id }));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs.length === 2);
  f.engine.pump();
  f.provider.releases[1]!();
  await until(() => f.store.get(f.room.id).jobs[1]!.status === 'failed');
  const failed = f.store.get(f.room.id).jobs[1]!;
  const original = f.provider.inputs[1]!;
  f.engine.configureAgent(f.room.id, {
    ...settings(f.room, 0, 'New synthesizer'),
    model: 'new-model',
  });
  f.engine.configureAgent(f.room.id, settings(f.room, 1, 'Renamed contributor'));
  f.engine.configureWorkspace(f.room.id, {
    title: 'Edited workspace',
    objective: 'A changed objective',
    maxTurns: 100,
  });
  f.engine.setAgentActive(f.room.id, c!.id, { active: false });
  f.engine.addAgent(f.room.id, { name: 'Added later', role: 'New role' });
  f.engine.retry(f.room.id, failed.id);
  f.engine.pump();
  const retried = f.provider.inputs[2]!;
  assert.deepEqual(retried.agent, original.agent);
  assert.deepEqual(retried.snapshot.agents, original.snapshot.agents);
  assert.equal(retried.snapshot.objective, original.snapshot.objective);
  assert.deepEqual(retried.snapshot.messages, original.snapshot.messages);
  assert.equal(retried.includedAnswers[0]!.author, 'AI B');
  f.provider.releases[2]!();
  await until(() => f.store.get(f.room.id).jobs[2]!.status === 'completed');
});

test('duplicate friendly names remain distinct in synthesis and source attribution', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.engine.configureAgent(f.room.id, settings(f.room, 0, 'Duplicate'));
  f.engine.configureAgent(f.room.id, settings(f.room, 1, 'Duplicate'));
  const [a, b, c] = f.room.agents;
  const sent = f.engine.send(f.room.id, command([a!.id, b!.id], { synthesisAgentId: c!.id }));
  f.engine.pump();
  f.provider.releases[0]!();
  f.provider.releases[1]!();
  await until(() => f.store.get(f.room.id).jobs.length === 3);
  f.engine.pump();
  const input = f.provider.inputs[2]!;
  assert.deepEqual(
    input.includedAnswers.map((a) => a.author),
    ['Duplicate · #1', 'Duplicate · #2'],
  );
  assert.deepEqual(input.expectedRespondents, ['Duplicate · #1', 'Duplicate · #2']);
  assert.deepEqual(
    input.snapshot.messages.filter((m) => m.type === 'answer').map((m) => m.authorName),
    ['Duplicate · #1', 'Duplicate · #2'],
  );
  f.provider.releases[2]!();
  await until(() => f.store.get(f.room.id).jobs[2]!.status === 'completed');
  f.engine.configureAgent(f.room.id, settings(f.room, 1, 'Now distinct'));
  f.engine.send(
    f.room.id,
    command([c!.id], { threadId: sent.threadId, body: 'Review the earlier authors.' }),
  );
  f.engine.pump();
  assert.deepEqual(
    f.provider.inputs[3]!.snapshot.messages.filter((m) => m.type === 'answer').map(
      (m) => m.authorName,
    ),
    ['Duplicate · #1', 'Duplicate · #2'],
  );
  f.provider.releases[3]!();
});
