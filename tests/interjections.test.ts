import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InterjectionNotice } from '../src/client/InterjectionNotice.js';
import { sendSchema, type SendInput } from '../src/shared/contracts.js';
import { ConversationEngine } from '../src/server/engine.js';
import { serve } from '../src/server/http.js';
import { providerPrompt } from '../src/server/live-providers.js';
import { RoomStore } from '../src/server/store.js';
import { command, ControlledProvider, until } from './helpers.js';

function fixture() {
  const store = new RoomStore(':memory:');
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false, concurrency: 1 });
  const room = engine.createRoom({
    title: 'Human input',
    objective: 'Original task',
    humanInstructions: 'Retain evidence',
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
function interjection(recipientIds: string[], extra: Partial<SendInput> = {}): SendInput {
  return command(recipientIds, {
    type: 'interjection',
    body: 'Human update: retain uncertainty. λ🙂 <img src=x onerror="window.injected=true">',
    interjection: { priority: 'urgent', dispatchPolicy: 'pause' },
    ...extra,
  });
}

// Completion-gated workflows must not quietly adopt an interjection as a correction.
test('interjection commits immediately during active work and holds dispatch without rewriting a parallel response set', async (t) => {
  const f = fixture();
  t.after(f.close);
  const [a, b, c] = f.room.agents;
  const sent = f.engine.send(f.room.id, command([a!.id, b!.id], { synthesisAgentId: c!.id }));
  f.engine.pump();
  await until(() => f.provider.inputs.length === 1);
  const before = f.store.get(f.room.id);
  let observed = false;
  f.engine.once('changed', () => {
    const committed = f.store.get(f.room.id);
    observed =
      committed.status === 'paused' && committed.events.some((e) => e.type === 'human.interjected');
  });
  const input = interjection([b!.id], { threadId: sent.threadId });
  const result = f.engine.send(f.room.id, input);
  const after = f.store.get(f.room.id);
  assert.ok(observed);
  const note = after.messages.find((m) => m.id === result.messageId)!;
  assert.equal(note.authorId, 'human');
  assert.equal(note.requestId, null);
  assert.equal(note.snapshotId, null);
  assert.equal(note.body, input.body);
  assert.equal(note.threadId, sent.threadId);
  assert.deepEqual(note.interjection, {
    priority: 'urgent',
    dispatchPolicy: 'pause',
    queuedJobIds: before.jobs.filter((j) => j.status === 'queued').map((j) => j.id),
    runningJobIds: before.jobs.filter((j) => j.status === 'running').map((j) => j.id),
  });
  assert.deepEqual(after.jobs, before.jobs);
  assert.deepEqual(after.requests, before.requests);
  assert.deepEqual(after.snapshots, before.snapshots);
  assert.equal(after.turnsUsed, before.turnsUsed);
  assert.match(
    after.events.find((e) => e.type === 'human.interjected')!.detail,
    new RegExp(result.messageId),
  );
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  assert.equal(f.store.get(f.room.id).requests[0]!.status, 'collecting');
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  await until(() => f.provider.inputs.length === 2);
  f.provider.releases[1]!();
  await until(() => f.store.get(f.room.id).requests[0]!.status === 'ready');
  f.engine.pump();
  await until(() => f.provider.inputs.length === 3);
  assert.equal(f.provider.inputs[2]!.kind, 'synthesis');
  assert.ok(!f.provider.inputs[2]!.snapshot.messages.some((m) => m.id === note.id));
  assert.equal(f.provider.inputs[2]!.includedAnswers.length, 2);
  assert.equal(f.provider.inputs[2]!.snapshot.humanInstructions, 'Retain evidence');
});

test('record-only input and urgent labels neither reorder work nor create generation or turn obligations', (t) => {
  const f = fixture();
  t.after(f.close);
  const id = f.room.agents[0]!.id;
  f.engine.send(f.room.id, command([id], { body: 'First task' }));
  f.engine.send(f.room.id, command([id], { body: 'Second task' }));
  const before = f.store.get(f.room.id);
  const sent = f.engine.send(
    f.room.id,
    interjection([id], { interjection: { priority: 'urgent', dispatchPolicy: 'record_only' } }),
  );
  const after = f.store.get(f.room.id);
  assert.equal(after.status, 'running');
  assert.deepEqual(after.jobs, before.jobs);
  assert.deepEqual(after.requests, before.requests);
  assert.deepEqual(after.snapshots, before.snapshots);
  assert.equal(after.turnsUsed, 0);
  assert.equal(f.provider.inputs.length, 0);
  assert.equal(
    after.messages.find((m) => m.id === sent.messageId)!.interjection!.queuedJobIds.length,
    2,
  );
});

test('fresh questions include room-visible interjections across threads as attributed source, with current instructions', (t) => {
  const f = fixture();
  t.after(f.close);
  const id = f.room.agents[0]!.id;
  const old = f.engine.send(f.room.id, command([id]));
  const note = f.engine.send(
    f.room.id,
    interjection([id], { interjection: { priority: 'normal', dispatchPolicy: 'record_only' } }),
  );
  const fresh = f.engine.send(f.room.id, command([id], { body: 'New task' }));
  const room = f.store.get(f.room.id);
  assert.notEqual(note.threadId, fresh.threadId);
  const oldSnapshot = room.snapshots.find(
    (s) => s.id === room.requests.find((r) => r.id === old.requestId)!.snapshotId,
  )!;
  const freshSnapshot = room.snapshots.find(
    (s) => s.id === room.requests.find((r) => r.id === fresh.requestId)!.snapshotId,
  )!;
  assert.ok(!oldSnapshot.messages.some((m) => m.id === note.messageId));
  const source = freshSnapshot.messages.find((m) => m.id === note.messageId)!;
  assert.equal(source.type, 'interjection');
  assert.equal(source.authorId, 'human');
  assert.equal(source.body, interjection([id]).body);
  const prompt = JSON.parse(
    providerPrompt({
      agent: room.agents[0]!,
      snapshot: freshSnapshot,
      prompt: 'New task',
      kind: 'answer',
      includedAnswers: [],
      expectedRespondents: [],
      missingRespondents: [],
    }).user,
  );
  assert.equal(prompt.humanInstructions, 'Retain evidence');
  assert.ok(JSON.stringify(prompt).includes(source.body.replaceAll('"', '\\"')));
  assert.ok(!JSON.stringify(prompt).includes('dispatchPolicy'));
});

test('paused relay continuation retains original sources and proceeds only after explicit Resume', async (t) => {
  const f = fixture();
  t.after(f.close);
  const [a, b] = f.room.agents;
  const root = f.engine.send(f.room.id, command([a!.id], { relayOrder: [a!.id, b!.id] }));
  f.engine.pump();
  await until(() => f.provider.inputs.length === 1);
  const note = f.engine.send(f.room.id, interjection([a!.id], { threadId: root.threadId }));
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  assert.equal(f.store.get(f.room.id).relays[0]!.status, 'running');
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  await until(() => f.provider.inputs.length === 2);
  assert.ok(!f.provider.inputs[1]!.snapshot.messages.some((m) => m.id === note.messageId));
  assert.equal(
    f.provider.inputs[1]!.snapshot.messages.filter((m) => m.type === 'answer').length,
    1,
  );
});

test('discussion grants, peer obligations, and coordinator continuation retain their submitted context after input', async (t) => {
  const f = fixture();
  t.after(f.close);
  const [a, b] = f.room.agents;
  f.provider.actions[0] = {
    kind: 'ask',
    body: 'Review original task',
    recipientIds: [b!.id],
    policy: 'all',
    quorum: 1,
    replyTo: null,
  };
  const root = f.engine.send(
    f.room.id,
    command([a!.id], { discussion: { maxRounds: 1, maxTurns: 4 } }),
  );
  f.engine.pump();
  await until(() => f.provider.inputs.length === 1);
  const original = f.store.get(f.room.id).discussions[0]!;
  const note = f.engine.send(f.room.id, interjection([b!.id], { threadId: root.threadId }));
  assert.deepEqual(f.store.get(f.room.id).discussions[0], original);
  f.provider.releases[0]!();
  await until(() => f.store.get(f.room.id).jobs[0]!.status === 'completed');
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  await until(() => f.provider.inputs.length === 2);
  assert.ok(!f.provider.inputs[1]!.snapshot.messages.some((m) => m.id === note.messageId));
  f.provider.releases[1]!();
  await until(() => f.store.get(f.room.id).jobs[1]!.status === 'completed');
  f.engine.pump();
  await until(() => f.provider.inputs.length === 3);
  assert.equal(f.provider.inputs[2]!.kind, 'decision');
  assert.ok(!f.provider.inputs[2]!.snapshot.messages.some((m) => m.id === note.messageId));
  assert.deepEqual(f.provider.inputs[2]!.discussion!.allowedPeerIds, original.allowedPeerIds);
});

test('strict validation rejects forged interjection authority, invalid recipients, and response workflows atomically', (t) => {
  const f = fixture();
  t.after(f.close);
  const id = f.room.agents[0]!.id;
  const bad: unknown[] = [
    interjection([]),
    interjection([id, id]),
    interjection([randomUUID()]),
    interjection([id], { interjection: null }),
    interjection([id], { type: 'question' }),
    interjection([id], { synthesisAgentId: f.room.agents[1]!.id }),
    interjection([id], { relayOrder: [id] }),
    interjection([id], { discussion: { maxRounds: 1, maxTurns: 3 } }),
    interjection([id], { policy: 'any' }),
    interjection([id], { quorum: 2 }),
    interjection([id], { threadId: randomUUID() }),
    interjection([id], { replyTo: randomUUID() }),
    interjection([id], { body: ' '.repeat(10) }),
    interjection([id], { body: 'x'.repeat(12001) }),
    { ...interjection([id]), authorId: id },
    {
      ...interjection([id]),
      interjection: { priority: 'urgent', dispatchPolicy: 'cancel', queuedJobIds: [] },
    },
  ];
  const before = f.store.get(f.room.id);
  for (const input of bad) {
    assert.throws(() => f.engine.send(f.room.id, input as SendInput));
    assert.deepEqual(f.store.get(f.room.id), before);
  }
  f.engine.setAgentActive(f.room.id, id, { active: false });
  const inactive = f.store.get(f.room.id);
  assert.throws(() => f.engine.send(f.room.id, interjection([id])), /inactive/);
  assert.deepEqual(f.store.get(f.room.id), inactive);
});

test('replayed interjections do not pause resumed work again and changed commands conflict', (t) => {
  const f = fixture();
  t.after(f.close);
  const ids = f.room.agents.map((a) => a.id);
  const input = interjection([ids[0]!]);
  const sent = f.engine.send(f.room.id, input);
  f.engine.control(f.room.id, 'resume');
  const before = f.store.get(f.room.id);
  assert.deepEqual(f.engine.send(f.room.id, input), sent);
  assert.deepEqual(f.store.get(f.room.id), before);
  for (const patch of [
    { body: 'Changed' },
    { recipientIds: [ids[1]!] },
    { interjection: { priority: 'normal' as const, dispatchPolicy: 'pause' as const } },
    { interjection: { priority: 'urgent' as const, dispatchPolicy: 'record_only' as const } },
  ])
    assert.throws(() => f.engine.send(f.room.id, { ...input, ...patch }), /different content/);
  assert.deepEqual(f.store.get(f.room.id), before);
});

test('adding interjection fields preserves existing send hashes and legacy replay', (t) => {
  const f = fixture();
  t.after(f.close);
  const input = command([f.room.agents[0]!.id]);
  const canonical = sendSchema.parse(input);
  const previousCanonical = { ...canonical };
  delete (previousCanonical as Partial<typeof canonical>).relayOrder;
  delete (previousCanonical as Partial<typeof canonical>).discussion;
  delete (previousCanonical as Partial<typeof canonical>).interjection;
  const hash = createHash('sha256').update(JSON.stringify(previousCanonical)).digest('hex');
  const sent = f.engine.send(f.room.id, input);
  assert.equal(f.store.get(f.room.id).messages[0]!.commandHash, hash);
  const before = f.store.get(f.room.id);
  assert.deepEqual(f.engine.send(f.room.id, input), sent);
  assert.deepEqual(f.store.get(f.room.id), before);
});

test('failed storage commits roll back the human message, audit, pause, sequence, and notification together', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-interjection-fault-'));
  const path = join(directory, 'rooms.sqlite');
  const store = new RoomStore(path);
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false });
  const room = engine.createRoom({ title: 'Rollback' });
  const db = new DatabaseSync(path);
  t.after(() => {
    db.close();
    engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  engine.send(room.id, command([room.agents[0]!.id]));
  const before = store.get(room.id);
  db.exec(
    "CREATE TRIGGER reject_input BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT, 'fixture'); END;",
  );
  let changes = 0;
  engine.on('changed', () => {
    changes++;
  });
  const input = interjection([room.agents[0]!.id]);
  assert.throws(() => engine.send(room.id, input));
  assert.deepEqual(store.get(room.id), before);
  assert.equal(changes, 0);
  assert.equal(provider.inputs.length, 0);
  db.exec('DROP TRIGGER reject_input');
  engine.send(room.id, input);
  assert.equal(store.get(room.id).status, 'paused');
  assert.equal(changes, 1);
});

test('restart retains recorded input and paused queues without replaying or changing original snapshots', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-interjection-restart-'));
  const path = join(directory, 'rooms.sqlite');
  let store = new RoomStore(path);
  let provider = new ControlledProvider();
  let engine = new ConversationEngine(store, provider, { autoSchedule: false });
  t.after(() => {
    engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const room = engine.createRoom({ title: 'Restart' });
  engine.send(room.id, command([room.agents[0]!.id]));
  const input = interjection([room.agents[0]!.id]);
  const result = engine.send(room.id, input);
  const before = store.get(room.id);
  engine.close();
  store.close();
  store = new RoomStore(path);
  provider = new ControlledProvider();
  engine = new ConversationEngine(store, provider, { autoSchedule: false });
  const after = store.get(room.id);
  assert.equal(after.status, 'paused');
  assert.deepEqual(after.snapshots, before.snapshots);
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.events.slice(0, before.events.length), before.events);
  assert.ok(
    after.events.slice(before.events.length).every((event) => event.type === 'room.recovered'),
  );
  assert.equal(after.events.filter((event) => event.type === 'human.interjected').length, 1);
  assert.deepEqual(engine.send(room.id, input), result);
  assert.deepEqual(store.get(room.id), after);
  engine.pump();
  assert.equal(provider.inputs.length, 0);
});

test('deleting an interjection thread redacts copied sources, cancels affected work, and prevents replay', (t) => {
  const f = fixture();
  t.after(f.close);
  const id = f.room.agents[0]!.id;
  const input = interjection([id], {
    interjection: { priority: 'normal', dispatchPolicy: 'record_only' },
  });
  const note = f.engine.send(f.room.id, input);
  const sent = f.engine.send(f.room.id, command([id], { body: 'New task after input' }));
  f.engine.deleteThread(f.room.id, note.threadId);
  const room = f.store.get(f.room.id);
  assert.ok(!room.messages.some((m) => m.id === note.messageId));
  assert.equal(room.jobs.find((j) => j.requestId === sent.requestId)!.status, 'cancelled');
  assert.ok(room.snapshots.every((s) => !s.messages.some((m) => m.id === note.messageId)));
  assert.throws(() => f.engine.send(f.room.id, input), /deleted/);
  f.engine.deleteRoom(f.room.id);
  assert.throws(() => f.engine.send(f.room.id, interjection([id])), /not found/);
});

test('archive, Stop, shutdown, and unchanged wall-clock deadlines retain their control boundaries', (t) => {
  let now = new Date('2026-10-03T06:00:00Z');
  const store = new RoomStore(':memory:');
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false, now: () => now });
  t.after(() => {
    engine.close();
    store.close();
  });
  const room = engine.createRoom({ title: 'Controls' });
  const id = room.agents[0]!.id;
  engine.send(room.id, command([id], { deadlineSeconds: 5 }));
  const deadline = store.get(room.id).requests[0]!.deadlineAt;
  engine.send(room.id, interjection([id]));
  assert.equal(store.get(room.id).requests[0]!.deadlineAt, deadline);
  now = new Date('2026-10-03T06:00:06Z');
  engine.pump();
  assert.equal(store.get(room.id).requests[0]!.status, 'timed_out');
  engine.control(room.id, 'stop');
  let before = store.get(room.id);
  assert.throws(() => engine.send(room.id, interjection([id])), /Resume/);
  assert.deepEqual(store.get(room.id), before);
  engine.control(room.id, 'resume');
  engine.setWorkspaceArchived(room.id, { archived: true });
  before = store.get(room.id);
  assert.throws(() => engine.send(room.id, interjection([id])), /archived/);
  assert.deepEqual(store.get(room.id), before);
  engine.setWorkspaceArchived(room.id, { archived: false });
  engine.close();
  before = store.get(room.id);
  assert.throws(() => engine.send(room.id, interjection([id])), /shutting down/);
  assert.deepEqual(store.get(room.id), before);
});

test('HTTP interjections require authenticated strict commands and export exact human sources with policy metadata', async (t) => {
  const f = fixture();
  const app = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  t.after(async () => {
    await app.close();
    f.close();
  });
  const base = `http://127.0.0.1:${app.port}`;
  const url = `${base}/api/rooms/${f.room.id}/messages`;
  const input = interjection([f.room.agents[0]!.id]);
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    ).status,
    401,
  );
  const { token } = (await (await fetch(`${base}/api/session`)).json()) as { token: string };
  const headers = { 'X-AIB-Token': token, 'Content-Type': 'application/json' };
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
        body: JSON.stringify({ ...input, priority: 'forged' }),
      })
    ).status,
    400,
  );
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(
    await (await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) })).json(),
    await response.json(),
  );
  const exported = await fetch(`${base}/api/rooms/${f.room.id}/export`, { headers });
  const text = await exported.text();
  assert.equal(exported.headers.get('cache-control'), 'no-store');
  assert.ok(text.includes(input.body));
  assert.match(text, /Human interjection: priority urgent; dispatch policy pause/);
  assert.equal(f.provider.inputs.length, 0);
  assert.equal(
    f.store.get(f.room.id).events.filter((e) => e.type === 'human.interjected').length,
    1,
  );
});

test('interjection presentation is an inert recording-time notice and cannot acquire authority from model prose', (t) => {
  const f = fixture();
  t.after(f.close);
  const sent = f.engine.send(f.room.id, interjection([f.room.agents[0]!.id]));
  const message = f.store.get(f.room.id).messages.find((m) => m.id === sent.messageId)!;
  const before = f.store.get(f.room.id);
  const html = renderToStaticMarkup(createElement(InterjectionNotice, { message }));
  assert.match(html, /Urgent priority/);
  assert.match(html, /when recorded/);
  assert.match(html, /keep their original context/);
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('aria-live'));
  assert.equal(
    renderToStaticMarkup(
      createElement(InterjectionNotice, {
        message: { ...message, authorId: f.room.agents[0]!.id },
      }),
    ),
    '',
  );
  assert.deepEqual(f.store.get(f.room.id), before);
  assert.equal(f.provider.inputs.length, 0);
});
