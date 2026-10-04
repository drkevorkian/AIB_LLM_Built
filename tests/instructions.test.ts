import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  workspaceInstructionHistory,
  type ProviderKind,
  type Room,
} from '../src/shared/contracts.js';
import { ConversationEngine } from '../src/server/engine.js';
import { serve } from '../src/server/http.js';
import { LiveProviders, providerPrompt } from '../src/server/live-providers.js';
import type { ProviderInput } from '../src/server/providers.js';
import { RoomStore } from '../src/server/store.js';
import { command, ControlledProvider, until } from './helpers.js';

const originalInstructions = '\n  Keep independent evidence.\nPreserve disagreement. λ🙂  \n';
function fixture(instructions = originalInstructions) {
  const store = new RoomStore(':memory:');
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, {
    autoSchedule: false,
    now: () => new Date('2026-10-03T04:00:00Z'),
  });
  const room = engine.createRoom({
    title: 'Versioned instructions',
    objective: 'Original objective',
    humanInstructions: instructions,
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
function edit(
  f: ReturnType<typeof fixture>,
  humanInstructions: string,
  objective = f.room.objective,
) {
  f.engine.configureWorkspace(f.room.id, {
    title: f.room.title,
    objective,
    maxTurns: 100,
    humanInstructions,
    expectedInstructionRevision: f.store.get(f.room.id).instructionRevision ?? 0,
  });
}
function assertBinding(input: ProviderInput, instructions = originalInstructions, revision = 0) {
  assert.equal(input.snapshot.humanInstructions, instructions);
  assert.equal(input.snapshot.instructionRevision, revision);
  const prompt = JSON.parse(providerPrompt(input).user);
  assert.equal(prompt.humanInstructions, instructions);
  assert.equal(prompt.instructionRevision, revision);
}

test('creation records exact instruction text and a timed revision; read-only history never mutates rooms', (t) => {
  const f = fixture();
  t.after(f.close);
  assert.equal(f.room.humanInstructions, originalInstructions);
  assert.equal(f.room.instructionRevision, 0);
  assert.deepEqual(workspaceInstructionHistory(f.room), [
    {
      revision: 0,
      objective: f.room.objective,
      humanInstructions: originalInstructions,
      recordedAt: '2026-10-03T04:00:00.000Z',
      source: 'created',
    },
  ]);
  const before = f.store.get(f.room.id);
  workspaceInstructionHistory(before);
  f.engine.activity(f.room.id);
  assert.deepEqual(f.store.get(f.room.id), before);
  assert.equal(f.provider.inputs.length, 0);
  assert.equal(before.turnsUsed, 0);
});

test('objective/instruction edits append immutable versions while unrelated or identical saves do not', (t) => {
  const f = fixture();
  t.after(f.close);
  const initial = structuredClone(f.room.instructionRevisions);
  edit(f, originalInstructions);
  f.engine.configureWorkspace(f.room.id, {
    title: 'Renamed',
    objective: f.room.objective,
    maxTurns: 90,
    maxConcurrentRequests: 2,
  });
  assert.deepEqual(f.store.get(f.room.id).instructionRevisions, initial);
  edit(f, originalInstructions, 'Second objective');
  edit(f, 'Second instructions', 'Second objective');
  edit(f, '', 'Second objective');
  const room = f.store.get(f.room.id);
  assert.equal(room.instructionRevision, 3);
  assert.deepEqual(
    room.instructionRevisions!.map((entry) => [
      entry.revision,
      entry.objective,
      entry.humanInstructions,
    ]),
    [
      [0, f.room.objective, originalInstructions],
      [1, 'Second objective', originalInstructions],
      [2, 'Second objective', 'Second instructions'],
      [3, 'Second objective', ''],
    ],
  );
  assert.deepEqual(room.instructionRevisions![0], initial![0]);
  assert.equal(room.events.filter((event) => event.type === 'room.instructions').length, 3);
  assert.equal(room.turnsUsed, 0);
  assert.equal(room.maxConcurrentRequests, 2);
});

test('strict instruction commands reject oversized/type/forged history fields and revision bounds atomically', (t) => {
  const f = fixture();
  t.after(f.close);
  for (const invalid of ['x'.repeat(3001), 1, null, []]) {
    assert.throws(() =>
      f.engine.createRoom({ title: 'Invalid', humanInstructions: invalid as string }),
    );
    const before = f.store.get(f.room.id);
    assert.throws(() => edit(f, invalid as string));
    assert.deepEqual(f.store.get(f.room.id), before);
  }
  const body = { title: f.room.title, objective: '', maxTurns: 100, humanInstructions: 'Valid' };
  for (const expectedInstructionRevision of [-1, 0.1, '0', Number.MAX_SAFE_INTEGER + 1, null])
    assert.throws(() =>
      f.engine.configureWorkspace(f.room.id, { ...body, expectedInstructionRevision } as never),
    );
  for (const forged of [
    { instructionRevision: 42 },
    { instructionRevisions: [] },
    { recordedAt: 'fake' },
  ])
    assert.throws(() => f.engine.configureWorkspace(f.room.id, { ...body, ...forged }));
  edit(f, 'x'.repeat(3000));
  assert.equal(f.store.get(f.room.id).humanInstructions!.length, 3000);
});

test('stale reviewed instruction revisions reject the entire workspace save without notifications or invocation', (t) => {
  const f = fixture();
  t.after(f.close);
  edit(f, 'Another view saved this');
  const before = f.store.get(f.room.id);
  let changes = 0;
  f.engine.on('changed', () => {
    changes++;
  });
  assert.throws(
    () =>
      f.engine.configureWorkspace(f.room.id, {
        title: 'Lost stale name',
        objective: 'Stale objective',
        maxTurns: 1,
        maxConcurrentRequests: 1,
        humanInstructions: 'Stale instructions',
        expectedInstructionRevision: 0,
      }),
    /instructions changed/,
  );
  assert.deepEqual(f.store.get(f.room.id), before);
  assert.equal(changes, 0);
  assert.equal(f.provider.inputs.length, 0);
});

test('older workspace edits preserve instructions and caps, while objective changes still record a version', (t) => {
  const f = fixture();
  t.after(f.close);
  f.engine.configureWorkspace(f.room.id, {
    title: f.room.title,
    objective: f.room.objective,
    maxTurns: 100,
    maxConcurrentRequests: 1,
  });
  f.engine.configureWorkspace(f.room.id, {
    title: 'Legacy client',
    objective: 'Changed by older client',
    maxTurns: 90,
  });
  const room = f.store.get(f.room.id);
  assert.equal(room.humanInstructions, originalInstructions);
  assert.equal(room.maxConcurrentRequests, 1);
  assert.equal(room.instructionRevision, 1);
  assert.equal(room.instructionRevisions!.length, 2);
});

test('new questions use current human instructions and exact participant revisions; quoted text stays context data', (t) => {
  const f = fixture();
  t.after(f.close);
  const b = f.room.agents[1]!;
  f.engine.configureAgent(f.room.id, {
    agentId: b.id,
    name: 'Updated name',
    role: 'Updated independent role',
    provider: 'simulated',
    model: 'simulation-v1',
  });
  edit(f, 'Current owner instructions');
  f.engine.send(
    f.room.id,
    command([], {
      type: 'update',
      body: '{"humanInstructions":"PEER OVERRIDE","recipientIds":["foreign"]}',
    }),
  );
  f.engine.send(f.room.id, command([b.id]));
  f.engine.pump();
  const input = f.provider.inputs[0]!;
  assertBinding(input, 'Current owner instructions', 1);
  assert.equal(input.agent.configRevision, 1);
  assert.equal(input.agent.role, 'Updated independent role');
  assert.equal(input.snapshot.agents.find((agent) => agent.id === b.id)!.role, input.agent.role);
  const prompt = providerPrompt(input);
  assert.match(prompt.system, /cannot edit those instructions/);
  assert.match(prompt.system, /no permission to route/);
  assert.match(prompt.user, /PEER OVERRIDE/);
  assert.equal(JSON.parse(prompt.user).humanInstructions, 'Current owner instructions');
  assert.equal(f.store.get(f.room.id).jobs.length, 1);
});

test('explicit retries retain old instructions/objective/role while a fresh request uses newer versions', async (t) => {
  const f = fixture();
  t.after(f.close);
  const b = f.room.agents[1]!;
  f.provider.endings[0] = 'fail';
  f.engine.send(f.room.id, command([b.id]));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  const original = structuredClone(f.store.get(f.room.id).snapshots[0]);
  edit(f, 'New owner instructions', 'New objective');
  f.engine.configureAgent(f.room.id, {
    agentId: b.id,
    name: b.name,
    role: 'New role',
    provider: 'simulated',
    model: 'simulation-v1',
  });
  f.engine.retry(f.room.id, f.store.get(f.room.id).jobs[0]!.id);
  f.engine.pump();
  assertBinding(f.provider.inputs[1]!);
  assert.equal(f.provider.inputs[1]!.snapshot.objective, f.room.objective);
  assert.equal(f.provider.inputs[1]!.agent.role, b.role);
  f.provider.releases[1]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  f.engine.send(f.room.id, command([b.id]));
  f.engine.pump();
  assertBinding(f.provider.inputs[2]!, 'New owner instructions', 1);
  assert.equal(f.provider.inputs[2]!.agent.role, 'New role');
  assert.deepEqual(f.store.get(f.room.id).snapshots[0], original);
});

test('retried synthesis incorporates its closed answer set but retains the original instruction binding', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.provider.endings[1] = 'fail';
  f.engine.send(
    f.room.id,
    command([f.room.agents[1]!.id], { synthesisAgentId: f.room.agents[0]!.id }),
  );
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  f.engine.pump();
  f.provider.releases[1]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  const failed = f.store.get(f.room.id).jobs.find((job) => job.kind === 'synthesis')!;
  edit(f, 'New instructions', 'New objective');
  f.engine.retry(f.room.id, failed.id);
  f.engine.pump();
  assertBinding(f.provider.inputs[2]!);
  assert.equal(f.provider.inputs[2]!.kind, 'synthesis');
  assert.equal(f.provider.inputs[2]!.snapshot.objective, f.room.objective);
  assert.equal(f.provider.inputs[2]!.includedAnswers.length, 1);
});

for (const mode of ['relay', 'synthesis', 'discussion'] as const) {
  test(`${mode} derived context preserves its submitted instruction binding even with later persisted current settings`, async (t) => {
    const f = fixture();
    t.after(f.close);
    const [a, b, c] = f.room.agents;
    if (mode === 'discussion') {
      f.provider.actions[0] = {
        kind: 'ask',
        body: 'Peer evidence',
        recipientIds: [b!.id],
        policy: 'all',
        quorum: 1,
        replyTo: null,
      };
      f.provider.actions[2] = {
        kind: 'finish',
        body: 'Finished',
        recipientIds: [],
        policy: 'all',
        quorum: 1,
        replyTo: null,
      };
    }
    f.engine.send(
      f.room.id,
      command([mode === 'discussion' ? a!.id : b!.id], {
        ...(mode === 'relay' ? { relayOrder: [b!.id, c!.id] } : {}),
        ...(mode === 'synthesis' ? { synthesisAgentId: a!.id } : {}),
        ...(mode === 'discussion' ? { discussion: { maxRounds: 1, maxTurns: 4 } } : {}),
      }),
    );
    // Model a retained older workflow alongside a newer current record. Public edits
    // remain locked while pending; continuation must independently honor its own snapshot.
    f.store.mutate(f.room.id, (room) => {
      room.objective = 'Unrelated current objective';
      room.humanInstructions = 'UNRELATED CURRENT INSTRUCTIONS';
      room.instructionRevision = 1;
      room.instructionRevisions!.push({
        revision: 1,
        objective: room.objective,
        humanInstructions: room.humanInstructions,
        recordedAt: null,
        source: 'recovered',
      });
    });
    f.engine.pump();
    assertBinding(f.provider.inputs[0]!);
    f.provider.releases[0]!();
    await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
    f.engine.pump();
    assertBinding(f.provider.inputs[1]!);
    assert.equal(f.provider.inputs[1]!.snapshot.objective, f.room.objective);
    if (mode === 'discussion') {
      f.provider.releases[1]!();
      await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
      f.engine.pump();
      assertBinding(f.provider.inputs[2]!);
      assert.equal(f.provider.inputs[2]!.snapshot.objective, f.room.objective);
    }
  });
}

test('shared instructions count toward the 64,000-character context boundary without partial persistence or truncation', (t) => {
  const f = fixture('x'.repeat(3000));
  t.after(f.close);
  for (let i = 0; i < 5; i++)
    f.engine.send(f.room.id, command([], { type: 'update', body: 'u'.repeat(12000) }));
  const remaining = 64000 - 60000 - f.room.objective.length - 3000;
  const before = f.store.get(f.room.id);
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([f.room.agents[1]!.id], { body: 'q'.repeat(remaining + 1) }),
      ),
    /context limit/,
  );
  assert.deepEqual(f.store.get(f.room.id), before);
  assert.equal(f.provider.inputs.length, 0);
  f.engine.send(f.room.id, command([f.room.agents[1]!.id], { body: 'q'.repeat(remaining) }));
  const snapshot = f.store.get(f.room.id).snapshots.at(-1)!;
  assert.equal(
    snapshot.objective.length +
      snapshot.humanInstructions!.length +
      snapshot.messages.reduce((n, m) => n + m.body.length, 0),
    64000,
  );
});

for (const kind of ['greeting', 'coordinator'] as const) {
  test(`${kind} probes omit instruction text/revision/objective/history and cannot edit settings mid-probe`, async (t) => {
    const f = fixture();
    t.after(f.close);
    if (kind === 'coordinator')
      f.provider.actions[0] = {
        kind: 'finish',
        body: 'Hello',
        recipientIds: [],
        policy: 'all',
        quorum: 1,
        replyTo: null,
      };
    f.engine.send(f.room.id, command([], { type: 'update', body: 'PRIVATE HISTORY' }));
    const before = f.store.get(f.room.id);
    const probe = f.engine.testConnection(f.room.id, f.room.agents[0]!.id, kind);
    const input = f.provider.inputs[0]!;
    assert.equal(input.snapshot.objective, '');
    assert.deepEqual(input.snapshot.messages, []);
    assert.equal(input.snapshot.humanInstructions, undefined);
    assert.equal(input.snapshot.instructionRevision, undefined);
    const payload = JSON.parse(providerPrompt(input).user);
    assert.ok(!Object.hasOwn(payload, 'humanInstructions'));
    assert.ok(!Object.hasOwn(payload, 'instructionRevision'));
    assert.ok(!JSON.stringify(input).includes(originalInstructions));
    assert.ok(!JSON.stringify(input).includes('PRIVATE HISTORY'));
    assert.throws(() => edit(f, 'Blocked edit'), /pending work/);
    f.provider.releases[0]!();
    await probe;
    assert.deepEqual(f.store.get(f.room.id), before);
  });
}

test('pending and archived edits remain locked, and Stop/edit never resumes work or changes its frozen snapshots', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.engine.control(f.room.id, 'pause');
  f.engine.send(f.room.id, command([f.room.agents[1]!.id]));
  assert.throws(() => edit(f, 'Blocked'), /pending work/);
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  assert.throws(() => edit(f, 'Blocked'), /pending work/);
  const snapshot = structuredClone(f.store.get(f.room.id).snapshots[0]);
  f.engine.control(f.room.id, 'stop');
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  edit(f, 'Stopped edit');
  assert.equal(f.store.get(f.room.id).status, 'stopped');
  assert.deepEqual(f.store.get(f.room.id).snapshots[0], snapshot);
  f.engine.setWorkspaceArchived(f.room.id, { archived: true });
  assert.throws(() => edit(f, 'Archived edit'), /archived/i);
  assert.equal(f.provider.inputs.length, 1);
});

test('legacy current settings recover with unknown time; old snapshots stay unknown and new history survives restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-instructions-legacy-'));
  const path = join(directory, 'rooms.sqlite');
  let store = new RoomStore(path);
  let provider = new ControlledProvider();
  let engine = new ConversationEngine(store, provider, { autoSchedule: false });
  const room = engine.createRoom({ title: 'Legacy', objective: 'Known current objective' });
  engine.send(room.id, command([room.agents[1]!.id]));
  engine.close();
  store.close();
  const db = new DatabaseSync(path);
  const legacy = JSON.parse(
    db.prepare('SELECT payload FROM rooms').get()!.payload as string,
  ) as Room;
  delete legacy.humanInstructions;
  delete legacy.instructionRevision;
  delete legacy.instructionRevisions;
  for (const snapshot of legacy.snapshots) {
    delete snapshot.humanInstructions;
    delete snapshot.instructionRevision;
  }
  db.prepare('UPDATE rooms SET payload = ?').run(JSON.stringify(legacy));
  db.close();
  try {
    store = new RoomStore(path);
    provider = new ControlledProvider();
    engine = new ConversationEngine(store, provider, { autoSchedule: false });
    const before = store.get(room.id);
    const recovered = workspaceInstructionHistory(before);
    assert.equal(recovered[0]!.recordedAt, null);
    assert.equal(recovered[0]!.source, 'recovered');
    assert.deepEqual(store.get(room.id), before);
    engine.control(room.id, 'stop');
    engine.configureWorkspace(room.id, {
      title: room.title,
      objective: room.objective,
      maxTurns: 100,
      humanInstructions: 'New recorded instructions',
      expectedInstructionRevision: 0,
    });
    assert.equal(store.get(room.id).instructionRevisions![0]!.recordedAt, null);
    engine.close();
    store.close();
    store = new RoomStore(path);
    engine = new ConversationEngine(store, provider, { autoSchedule: false });
    const saved = store.get(room.id);
    assert.equal(saved.humanInstructions, 'New recorded instructions');
    assert.equal(saved.instructionRevisions!.length, 2);
    assert.equal(saved.snapshots[0]!.humanInstructions, undefined);
    assert.equal(saved.snapshots[0]!.instructionRevision, undefined);
    const check = new DatabaseSync(path);
    assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 3);
    check.close();
    assert.equal(saved.schemaVersion, 1);
  } finally {
    engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite failure rolls back instruction text/history/audit/revisions and emits no successful change', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-instructions-rollback-'));
  const path = join(directory, 'rooms.sqlite');
  const store = new RoomStore(path);
  const engine = new ConversationEngine(store, new ControlledProvider(), { autoSchedule: false });
  const room = engine.createRoom({ title: 'Rollback', humanInstructions: originalInstructions });
  const db = new DatabaseSync(path);
  t.after(() => {
    db.close();
    engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  db.exec(
    "CREATE TRIGGER reject_instruction BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT, 'fixture'); END;",
  );
  let changes = 0;
  engine.on('changed', () => {
    changes++;
  });
  assert.throws(() =>
    engine.configureWorkspace(room.id, {
      title: 'Lost',
      objective: 'Lost',
      maxTurns: 20,
      humanInstructions: 'Lost',
      expectedInstructionRevision: 0,
    }),
  );
  assert.deepEqual(store.get(room.id), room);
  assert.equal(changes, 0);
});

test('instruction HTTP edits/export retain authenticated scope, strict revisions, exact history, and frozen references', async (t) => {
  const f = fixture();
  const app = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  t.after(async () => {
    await app.close();
    f.close();
  });
  const base = `http://127.0.0.1:${app.port}`;
  const url = base + `/api/rooms/${f.room.id}/settings`;
  const { token } = (await (await fetch(base + '/api/session')).json()) as { token: string };
  const headers = { 'X-AIB-Token': token, 'Content-Type': 'application/json' };
  const body = JSON.stringify({
    title: f.room.title,
    objective: f.room.objective,
    maxTurns: 100,
    humanInstructions: '<img src=x onerror=evil()>\n```\nExact new instructions',
    expectedInstructionRevision: 0,
  });
  assert.equal((await fetch(url, { method: 'PUT', body })).status, 401);
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
  assert.equal((await fetch(url, { headers })).status, 405);
  const host = await new Promise<number | undefined>((done, reject) => {
    get(url, { headers: { ...headers, Host: 'evil.example' } }, (res) => {
      res.resume();
      res.on('end', () => done(res.statusCode));
    }).on('error', reject);
  });
  assert.equal(host, 403);
  f.engine.send(f.room.id, command([f.room.agents[1]!.id], { body: 'Old recorded message' }));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.engine.activity(f.room.id).capacity.inUse === 0);
  const other = f.engine.createRoom({
    title: 'Other',
    humanInstructions: 'Unchanged foreign instructions',
  });
  const response = await fetch(url, { method: 'PUT', headers, body });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).instructionRevision, 1);
  assert.equal((await fetch(url, { method: 'PUT', headers, body })).status, 409);
  assert.equal(
    (
      await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          ...JSON.parse(body),
          expectedInstructionRevision: 1,
          instructionRevisions: [],
        }),
      })
    ).status,
    400,
  );
  assert.equal(f.store.get(other.id).humanInstructions, 'Unchanged foreign instructions');
  const exported = await fetch(base + `/api/rooms/${f.room.id}/export`, { headers });
  const text = await exported.text();
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get('cache-control'), 'no-store');
  assert.match(text, /Workspace instruction revisions/);
  assert.match(text, /Workspace instructions: revision 0/);
  const history = JSON.parse(
    /## Workspace instruction revisions\s+```json\n([\s\S]*?)\n```/.exec(text)![1]!,
  );
  assert.equal(history[0].humanInstructions, originalInstructions);
  assert.equal(history[1].humanInstructions, JSON.parse(body).humanInstructions);
  assert.ok(!text.includes('Unchanged foreign instructions'));
  assert.ok(!text.includes(token));
});

for (const provider of [
  'openai',
  'xai',
  'gemini',
  'ollama',
  'openai-compatible',
] as ProviderKind[]) {
  test(`${provider} native protocol carries the exact frozen owner instructions and revision without real network access`, async (t) => {
    const f = fixture();
    t.after(f.close);
    f.engine.send(f.room.id, command([f.room.agents[1]!.id]));
    f.engine.pump();
    const request = structuredClone(f.provider.inputs[0]!);
    request.agent = {
      ...request.agent,
      provider,
      model: 'fixture-model',
      baseUrl: provider === 'openai-compatible' ? 'http://127.0.0.1:9876/v1' : '',
    };
    let captured: Record<string, unknown> | undefined;
    const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
    const fetcher: typeof fetch = async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      const text =
        provider === 'openai'
          ? body.input
          : provider === 'gemini'
            ? body.contents[0].parts[0].text
            : body.messages[1].content;
      captured = JSON.parse(text);
      const system =
        provider === 'openai'
          ? body.instructions
          : provider === 'gemini'
            ? body.systemInstruction.parts[0].text
            : body.messages[0].content;
      assert.match(system, /do not extend routing/);
      const output =
        provider === 'openai'
          ? event({ type: 'response.output_text.delta', delta: 'OK' }) +
            event({ type: 'response.completed', response: { status: 'completed' } })
          : provider === 'gemini'
            ? event({
                candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }],
              })
            : provider === 'ollama'
              ? JSON.stringify({ message: { content: 'OK' }, done: true, done_reason: 'stop' }) +
                '\n'
              : event({ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }) +
                'data: [DONE]\n\n';
      return new Response(output, {
        headers: {
          'Content-Type': provider === 'ollama' ? 'application/x-ndjson' : 'text/event-stream',
        },
      });
    };
    const adapter = new LiveProviders(
      {
        OPENAI_API_KEY: 'synthetic-fixture',
        XAI_API_KEY: 'synthetic-fixture',
        GEMINI_API_KEY: 'synthetic-fixture',
        AIB_COMPATIBLE_API_KEY: '',
      },
      fetcher,
    );
    const output = [];
    for await (const item of adapter.generate(request, new AbortController().signal))
      output.push(item);
    assert.equal(captured!.humanInstructions, originalInstructions);
    assert.equal(captured!.instructionRevision, 0);
    assert.equal(output.at(-1)!.type, 'complete');
  });
}
