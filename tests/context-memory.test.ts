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
import { LiveProviders, providerPrompt } from '../src/server/live-providers.js';
import { contextCharacters, sourceHash } from '../src/server/context-memory.js';
import {
  contextSummarySchema,
  agentSettingsSchema,
  type Agent,
  type ContextPolicy,
  type ContextSummaryInput,
} from '../src/shared/contracts.js';
import { command, ControlledProvider, until } from './helpers.js';

function setup(path = ':memory:') {
  const store = new RoomStore(path);
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false });
  const room = engine.createRoom({
    title: 'Context fixture',
    objective: 'Original objective',
    humanInstructions: 'Exact instructions λ🙂',
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
    record: () => store.get(room.id),
    close: () => {
      engine.close();
      store.close();
    },
  };
}
function note(f: ReturnType<typeof setup>, body: string, threadId: string | null = null) {
  return f.engine.send(
    f.room.id,
    command([], { type: 'update', policy: 'no_reply', body, threadId }),
  );
}
function summaryInput(
  f: ReturnType<typeof setup>,
  sourceIds: string[],
  patch: Partial<ContextSummaryInput> = {},
): ContextSummaryInput {
  const room = f.record();
  return {
    clientId: randomUUID(),
    expectedRevision: room.revision,
    threadId: room.messages.find((message) => message.id === sourceIds[0])!.threadId,
    sourceIds,
    title: 'Reviewed design summary',
    overview: 'B retains the design; C replaces it.',
    disagreements: 'B: retain the design. C: replace the design. No agreement.',
    openQuestions: 'Which independent test distinguishes these claims?',
    ...patch,
  };
}
function policy(f: ReturnType<typeof setup>, agent: Agent, contextPolicy: ContextPolicy) {
  f.engine.configureAgent(f.room.id, {
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    provider: agent.provider,
    model: agent.model,
    contextPolicy,
  });
}
async function finish(f: ReturnType<typeof setup>, index: number) {
  f.provider.releases[index]!();
  await until(() =>
    f
      .record()
      .jobs.some(
        (job) =>
          job.snapshotId === f.provider.inputs[index]!.snapshot.id &&
          job.agentId === f.provider.inputs[index]!.agent.id &&
          job.status === 'completed',
      ),
  );
  await until(
    () =>
      !f.engine
        .activity(f.room.id)
        .participants.find(
          (participant) => participant.agentId === f.provider.inputs[index]!.agent.id,
        )!.finishing,
  );
}

test('reviewed summaries retain exact source hashes, attribution, disagreement/open-question notes and Unicode without generation', (t) => {
  const f = setup();
  t.after(f.close);
  const first = note(f, 'B: retain the design λ🙂. <img src=x onerror="globalThis.unsafe=1">');
  const second = note(f, 'C: replace the design. What remains unresolved?', first.threadId);
  const before = f.record();
  const input = summaryInput(f, [second.messageId, first.messageId]);
  const summary = f.engine.createContextSummary(f.room.id, input);
  const after = f.record();
  assert.equal(summary.sources[0]!.id, first.messageId);
  assert.equal(
    summary.sources[0]!.sha256,
    createHash('sha256').update(JSON.stringify(before.messages[0]!.body)).digest('hex'),
  );
  assert.equal(summary.sources[0]!.excerpt, before.messages[0]!.body);
  assert.equal(summary.disagreements, input.disagreements);
  assert.equal(summary.openQuestions, input.openQuestions);
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.jobs, before.jobs);
  assert.equal(after.turnsUsed, 0);
  assert.equal(f.provider.inputs.length, 0);
  summary.overview = 'Mutated returned record';
  assert.equal(f.record().contextSummaries![0]!.overview, input.overview);
  assert.equal(
    f.engine.contextSummarySource(f.room.id, summary.id, first.messageId).body,
    before.messages[0]!.body,
  );
});

test('summary UUID replay is inert and content changes, message UUID collision and stale reviews roll back', (t) => {
  const f = setup();
  t.after(f.close);
  const first = note(f, 'Original');
  const input = summaryInput(f, [first.messageId]);
  const saved = f.engine.createContextSummary(f.room.id, input);
  const after = f.record();
  assert.deepEqual(f.engine.createContextSummary(f.room.id, input), saved);
  assert.deepEqual(f.record(), after);
  assert.throws(
    () => f.engine.createContextSummary(f.room.id, { ...input, overview: 'Changed' }),
    /different content/,
  );
  assert.deepEqual(f.record(), after);
  assert.throws(
    () => f.engine.send(f.room.id, command([], { type: 'update', clientId: input.clientId })),
    /belongs to a context summary/,
  );
  assert.throws(
    () =>
      f.engine.createContextSummary(f.room.id, {
        ...input,
        clientId: after.messages[0]!.clientId!,
      }),
    /belongs to a message/,
  );
  assert.throws(
    () => f.engine.createContextSummary(f.room.id, { ...input, clientId: randomUUID() }),
    /Workspace changed/,
  );
  assert.deepEqual(f.record(), after);
});

test('summary schemas reject forged controls, duplicates, empty notes, excessive source counts and wrong workspace/thread sources atomically', (t) => {
  const f = setup();
  t.after(f.close);
  const first = note(f, 'Source');
  const other = note(f, 'Other thread');
  const input = summaryInput(f, [first.messageId]);
  for (const patch of [
    { overview: '' },
    { disagreements: '' },
    { openQuestions: '' },
    { sourceIds: [] },
    { sourceIds: [first.messageId, first.messageId] },
    { sourceIds: Array.from({ length: 51 }, () => randomUUID()) },
    { recipientIds: [f.a.id] },
    { sources: [] },
  ])
    assert.equal(contextSummarySchema.safeParse({ ...input, ...patch }).success, false);
  const before = f.record();
  for (const ids of [[other.messageId], [randomUUID()]])
    assert.throws(
      () => f.engine.createContextSummary(f.room.id, { ...input, sourceIds: ids }),
      /completed original messages/,
    );
  assert.deepEqual(f.record(), before);
  const foreign = f.engine.createRoom({ title: 'Foreign' });
  assert.throws(
    () =>
      f.engine.createContextSummary(foreign.id, { ...input, expectedRevision: foreign.revision }),
    /Summary thread not found/,
  );
  assert.deepEqual(f.record(), before);
});

test('partial, failed and refused provider text cannot become summary evidence', async (t) => {
  const f = setup();
  t.after(f.close);
  f.provider.endings[0] = 'fail';
  const sent = f.engine.send(f.room.id, command([f.b.id]));
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.record().jobs[0]!.status === 'failed');
  const message = f
    .record()
    .messages.find((record) => record.id === f.record().jobs[0]!.messageId)!;
  assert.throws(
    () => f.engine.createContextSummary(f.room.id, summaryInput(f, [message.id])),
    /completed original/,
  );
  const before = f.record();
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([], {
          type: 'update',
          threadId: sent.threadId,
          context: { summaryId: randomUUID(), sourceIds: [] },
        }),
      ),
    /selected only for questions/,
  );
  assert.deepEqual(f.record(), before);
});

test('summary save uses one SQLite transaction and rolls back on a real write fault', (t) => {
  const f = setup();
  t.after(f.close);
  const first = note(f, 'Original');
  const input = summaryInput(f, [first.messageId]);
  const before = f.record();
  const db = (f.store as unknown as { db: DatabaseSync }).db;
  db.exec(
    "CREATE TRIGGER reject_summary BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT, 'fixture'); END;",
  );
  assert.throws(() => f.engine.createContextSummary(f.room.id, input));
  assert.deepEqual(f.record(), before);
  db.exec('DROP TRIGGER reject_summary;');
  assert.equal(f.engine.createContextSummary(f.room.id, input).sources.length, 1);
});

test('summary compaction allows explicitly reviewed large history, retains every original and rejects oversized source expansion atomically', (t) => {
  const f = setup();
  t.after(f.close);
  const ids: string[] = [];
  let threadId: string | null = null;
  for (let i = 0; i < 6; i++) {
    const sent = note(f, `${i} λ🙂 ` + 'x'.repeat(11900), threadId);
    threadId = sent.threadId;
    ids.push(sent.messageId);
  }
  const originals = f.record().messages;
  assert.throws(() => f.engine.send(f.room.id, command([f.b.id], { threadId })), /context limit/);
  const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, ids));
  assert.equal(summary.sources.length, 6);
  assert.ok(summary.sources.every((source) => source.truncated));
  f.engine.send(
    f.room.id,
    command([f.b.id], { threadId, context: { summaryId: summary.id, sourceIds: [] } }),
  );
  assert.deepEqual(f.record().messages.slice(0, 6), originals);
  const snapshot = f.record().snapshots.at(-1)!;
  assert.equal(snapshot.memory!.sources.length, 6);
  assert.equal(snapshot.messages.length, 1);
  for (const original of originals)
    assert.equal(
      f.engine.contextSummarySource(f.room.id, summary.id, original.id).body,
      original.body,
    );
  const before = f.record();
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([f.c.id], { threadId, context: { summaryId: summary.id, sourceIds: ids } }),
      ),
    /context limit/,
  );
  assert.deepEqual(f.record(), before);
});

test('an explicit summary and checked originals freeze sibling-independent inputs and current instructions', async (t) => {
  const f = setup();
  t.after(f.close);
  const first = note(f, 'Full B source ' + 'λ🙂'.repeat(400));
  const second = note(f, 'C disagrees: replace it.', first.threadId);
  const summary = f.engine.createContextSummary(
    f.room.id,
    summaryInput(f, [first.messageId, second.messageId]),
  );
  const sent = f.engine.send(
    f.room.id,
    command([f.b.id, f.c.id], {
      threadId: first.threadId,
      context: { summaryId: summary.id, sourceIds: [first.messageId] },
    }),
  );
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 2);
  const [b, c] = f.provider.inputs;
  assert.deepEqual(b!.snapshot, c!.snapshot);
  assert.equal(
    b!.snapshot.messages.find((message) => message.id === first.messageId)!.body,
    f.record().messages[0]!.body,
  );
  assert.equal(
    b!.snapshot.messages.some((message) => message.id === second.messageId),
    false,
  );
  assert.equal(b!.snapshot.humanInstructions, 'Exact instructions λ🙂');
  const prompt = providerPrompt(b!);
  const envelope = JSON.parse(prompt.user);
  assert.equal(envelope.contextSummary.disagreements, summary.disagreements);
  assert.equal(envelope.contextSummary.openQuestions, summary.openQuestions);
  assert.ok(prompt.system.includes('Ask the human to retrieve original sources'));
  await finish(f, 0);
  assert.equal(
    c!.snapshot.messages.some((message) => message.body.includes('independent answer')),
    false,
  );
  assert.equal(
    f.record().requests.find((request) => request.id === sent.requestId)!.status,
    'collecting',
  );
  await finish(f, 1);
});

test('reply targets covered by a summary retain their exact original body automatically', (t) => {
  const f = setup();
  t.after(f.close);
  const source = note(f, 'Exact target body ' + 'x'.repeat(800));
  const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId]));
  f.engine.send(
    f.room.id,
    command([f.b.id], {
      replyTo: source.messageId,
      context: { summaryId: summary.id, sourceIds: [] },
    }),
  );
  const snapshot = f.record().snapshots.at(-1)!;
  assert.deepEqual(snapshot.memory!.retrievedSourceIds, [source.messageId]);
  assert.equal(snapshot.messages[0]!.body, f.record().messages[0]!.body);
});

test('summary/source selection rejects foreign grants and preserves exact send UUID hashes', (t) => {
  const f = setup();
  t.after(f.close);
  const source = note(f, 'Original');
  const outside = note(f, 'Not selected');
  const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId]));
  const before = f.record();
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([f.b.id], { context: { summaryId: summary.id, sourceIds: [outside.messageId] } }),
      ),
    /must belong/,
  );
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([f.b.id], { context: { summaryId: randomUUID(), sourceIds: [] } }),
      ),
    /not found/,
  );
  assert.deepEqual(f.record(), before);
  const input = command([f.b.id], { context: { summaryId: summary.id, sourceIds: [] } });
  const result = f.engine.send(f.room.id, input);
  const after = f.record();
  assert.deepEqual(f.engine.send(f.room.id, input), result);
  assert.deepEqual(f.record(), after);
  assert.throws(
    () =>
      f.engine.send(f.room.id, {
        ...input,
        context: { summaryId: summary.id, sourceIds: [source.messageId] },
      }),
    /different content/,
  );
});

test('delivery cursors advance only at actual local dispatch and distinguish exact source bodies, summary references and originals', async (t) => {
  const f = setup();
  t.after(f.close);
  const source = note(f, 'Source');
  const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId]));
  f.engine.control(f.room.id, 'pause');
  const input = command([f.b.id], {
    threadId: source.threadId,
    context: { summaryId: summary.id, sourceIds: [] },
  });
  f.engine.send(f.room.id, input);
  f.engine.pump();
  assert.equal(f.record().contextCursors, undefined);
  f.engine.control(f.room.id, 'resume');
  f.engine.pump();
  const first = f.record();
  assert.equal(first.contextCursors!.length, 1);
  assert.equal(first.contextDeliveryNumber, 1);
  const cursor = first.contextCursors![0]!;
  assert.equal(cursor.agentId, f.b.id);
  assert.deepEqual(cursor.summarySourceIds, [source.messageId]);
  assert.deepEqual(cursor.retrievedSourceIds, []);
  assert.deepEqual(
    cursor.messageIds,
    f.provider.inputs[0]!.snapshot.messages.map((message) => message.id),
  );
  f.engine.send(f.room.id, input);
  assert.equal(f.record().contextDeliveryNumber, 1);
  await finish(f, 0);
  f.engine.send(f.room.id, command([f.b.id], { threadId: source.threadId }));
  f.engine.pump();
  assert.equal(f.record().contextCursors!.length, 1);
  assert.equal(f.record().contextDeliveryNumber, 2);
  assert.ok(
    f.provider.inputs[1]!.snapshot.messages.some((message) => message.id === source.messageId),
    'cursors must not suppress previously supplied history',
  );
  await finish(f, 1);
});

test('model-specific reject budgets block before provider invocation, turn use and cursor advancement', (t) => {
  const f = setup();
  t.after(f.close);
  policy(f, f.b, { maxCharacters: 4096, overflow: 'reject' });
  const source = note(f, 'Old history ' + 'x'.repeat(6000));
  f.engine.send(f.room.id, command([f.b.id], { threadId: source.threadId }));
  f.engine.pump();
  const room = f.record();
  assert.equal(room.jobs[0]!.status, 'failed');
  assert.match(room.jobs[0]!.error!, /No provider invocation or turn was consumed/);
  assert.equal(room.jobs[0]!.attemptId, null);
  assert.equal(room.turnsUsed, 0);
  assert.equal(f.provider.inputs.length, 0);
  assert.equal(room.contextDeliveryNumber, undefined);
});

test('reviewed oldest-history omissions fit the complete application envelope while protecting task, instructions and exact reply', (t) => {
  const f = setup();
  t.after(f.close);
  policy(f, f.b, { maxCharacters: 5800, overflow: 'trim_oldest' });
  const first = note(f, 'Old unprotected ' + 'x'.repeat(7000));
  const target = note(f, 'Exact reply λ🙂', first.threadId);
  const sent = f.engine.send(
    f.room.id,
    command([f.b.id], {
      threadId: first.threadId,
      replyTo: target.messageId,
      body: 'Current protected task',
    }),
  );
  const base = f.record().snapshots[0]!;
  f.engine.pump();
  const input = f.provider.inputs[0]!;
  assert.ok(input);
  assert.ok(contextCharacters(input) <= 5800);
  assert.equal(input.snapshot.delivery!.measuredCharacters, contextCharacters(input));
  assert.deepEqual(input.snapshot.delivery!.omittedMessageIds, [first.messageId]);
  assert.ok(input.snapshot.messages.some((message) => message.id === target.messageId));
  assert.ok(input.snapshot.messages.some((message) => message.id === sent.messageId));
  assert.equal(input.snapshot.humanInstructions, 'Exact instructions λ🙂');
  assert.deepEqual(
    f.record().snapshots.find((snapshot) => snapshot.id === base.id),
    base,
  );
  assert.equal(
    f.record().messages.find((message) => message.id === first.messageId)!.body.length,
    7016,
  );
  const prompt = providerPrompt(input);
  assert.ok(prompt.system.includes('omitted the history message IDs'));
  assert.deepEqual(JSON.parse(prompt.user).omittedContextMessageIds, [first.messageId]);
});

test('each frozen recipient model has its own budget and one failure cannot alter a sibling binding or consume its turn', (t) => {
  const f = setup();
  t.after(f.close);
  policy(f, f.b, { maxCharacters: 4096, overflow: 'reject' });
  policy(f, f.c, { maxCharacters: 5800, overflow: 'trim_oldest' });
  const source = note(f, 'Older source ' + 'x'.repeat(7000));
  f.engine.send(f.room.id, command([f.b.id, f.c.id], { threadId: source.threadId }));
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 1);
  assert.equal(f.provider.inputs[0]!.agent.id, f.c.id);
  assert.equal(f.record().jobs[0]!.status, 'failed');
  assert.equal(f.record().jobs[1]!.status, 'running');
  assert.equal(f.record().turnsUsed, 1);
  assert.equal(f.record().contextCursors![0]!.agentId, f.c.id);
});

test('retrieved originals and disagreement/open-question notes are protected and cannot be trimmed to force a budget pass', (t) => {
  const f = setup();
  t.after(f.close);
  policy(f, f.b, { maxCharacters: 4096, overflow: 'trim_oldest' });
  const source = note(f, 'Conflicting original ' + 'x'.repeat(8000));
  const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId]));
  f.engine.send(
    f.room.id,
    command([f.b.id], { context: { summaryId: summary.id, sourceIds: [source.messageId] } }),
  );
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 0);
  assert.equal(f.record().turnsUsed, 0);
  assert.match(f.record().jobs[0]!.error!, /Protected instructions/);
  assert.equal(f.record().snapshots[0]!.memory!.disagreements, summary.disagreements);
  assert.equal(f.record().snapshots[0]!.memory!.openQuestions, summary.openQuestions);
});

test('context policy validation, legacy preservation and provider/model/endpoint changes keep review bound to the exact model', (t) => {
  const f = setup();
  t.after(f.close);
  const input = {
    agentId: f.b.id,
    name: f.b.name,
    role: f.b.role,
    provider: f.b.provider,
    model: f.b.model,
  };
  for (const contextPolicy of [
    { maxCharacters: 4095, overflow: 'reject' },
    { maxCharacters: 262145, overflow: 'reject' },
    { maxCharacters: 4096, overflow: 'silent' },
    { maxCharacters: 4096, overflow: 'reject', provider: 'openai' },
  ])
    assert.equal(agentSettingsSchema.safeParse({ ...input, contextPolicy }).success, false);
  policy(f, f.b, { maxCharacters: 5800, overflow: 'trim_oldest' });
  f.engine.configureAgent(f.room.id, { ...input, name: 'Renamed' });
  assert.equal(f.record().agents[1]!.contextPolicy!.maxCharacters, 5800);
  f.engine.configureAgent(f.room.id, { ...input, model: 'different-model' });
  assert.equal(f.record().agents[1]!.contextPolicy, undefined);
  f.engine.configureAgent(f.room.id, {
    ...input,
    contextPolicy: { maxCharacters: 6000, overflow: 'reject' },
  });
  f.engine.configureAgent(f.room.id, { ...input, contextPolicy: null });
  assert.equal(f.record().agents[1]!.contextPolicy, undefined);
  assert.ok(
    f
      .record()
      .agentRevisions!.some((revision) => revision.agent.contextPolicy?.maxCharacters === 5800),
  );
});

test('explicit retry preserves the fitted context, original model budget, summary and omissions after later settings and summaries', async (t) => {
  const f = setup();
  t.after(f.close);
  policy(f, f.b, { maxCharacters: 7000, overflow: 'trim_oldest' });
  const long = note(f, 'Old unprotected ' + 'x'.repeat(8000));
  const short = note(f, 'Original source', long.threadId);
  const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, [short.messageId]));
  f.provider.endings[0] = 'fail';
  const sent = f.engine.send(
    f.room.id,
    command([f.b.id], {
      threadId: short.threadId,
      context: { summaryId: summary.id, sourceIds: [] },
    }),
  );
  f.engine.pump();
  f.provider.releases[0]!();
  await until(() => f.record().jobs[0]!.status === 'failed');
  await until(() => !f.engine.activity(f.room.id).participants[1]!.finishing);
  const original = f.provider.inputs[0]!.snapshot;
  policy(f, f.b, { maxCharacters: 20000, overflow: 'reject' });
  f.engine.createContextSummary(
    f.room.id,
    summaryInput(f, [short.messageId], { overview: 'New summary must not replace old context' }),
  );
  f.engine.retry(f.room.id, f.record().jobs[0]!.id);
  f.engine.pump();
  const retried = f.provider.inputs[1]!;
  assert.equal(retried.agent.contextPolicy!.maxCharacters, 7000);
  assert.deepEqual(retried.snapshot.messages, original.messages);
  assert.deepEqual(retried.snapshot.memory, original.memory);
  assert.deepEqual(
    retried.snapshot.delivery!.omittedMessageIds,
    original.delivery!.omittedMessageIds,
  );
  assert.equal(
    f.record().requests.find((request) => request.id === sent.requestId)!.snapshotId,
    f.record().snapshots[0]!.id,
  );
  await finish(f, 1);
});

test('synthesis includes exact collected originals and rejects an undersized synthesizer budget without changing closure or completed answers', async (t) => {
  const f = setup();
  t.after(f.close);
  policy(f, f.a, { maxCharacters: 4096, overflow: 'trim_oldest' });
  f.provider.answers[0] = 'B retained design ' + 'x'.repeat(5000);
  f.provider.answers[1] = 'C replaces design ' + 'y'.repeat(5000);
  f.engine.send(f.room.id, command([f.b.id, f.c.id], { synthesisAgentId: f.a.id }));
  f.engine.pump();
  await finish(f, 0);
  await finish(f, 1);
  const before = f.record().requests[0]!;
  f.engine.pump();
  assert.equal(f.provider.inputs.length, 2);
  assert.equal(f.record().jobs[2]!.status, 'failed');
  assert.equal(f.record().turnsUsed, 2);
  assert.deepEqual(f.record().requests[0], before);
  assert.ok(
    f
      .record()
      .messages.filter((message) => message.type === 'answer')
      .every((message) => message.status === 'complete'),
  );
});

test('summaries keep accepted coordinator decision links and inherit across relay, peer and synthesis contexts', async (t) => {
  const f = setup();
  t.after(f.close);
  const source = note(f, 'Reviewed source');
  const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId]));
  f.provider.actions[0] = {
    kind: 'ask',
    body: 'Independent reviews',
    recipientIds: [f.b.id, f.c.id],
    policy: 'all',
    quorum: 1,
    replyTo: null,
  };
  f.provider.actions[3] = {
    kind: 'finish',
    body: 'Final decision preserving disagreement',
    recipientIds: [],
    policy: 'all',
    quorum: 1,
    replyTo: null,
  };
  const sent = f.engine.send(
    f.room.id,
    command([f.a.id], {
      threadId: source.threadId,
      discussion: { maxRounds: 1, maxTurns: 4 },
      context: { summaryId: summary.id, sourceIds: [] },
    }),
  );
  f.engine.pump();
  await finish(f, 0);
  f.engine.pump();
  await finish(f, 1);
  await finish(f, 2);
  f.engine.pump();
  await finish(f, 3);
  assert.ok(f.provider.inputs.every((input) => input.snapshot.memory!.id === summary.id));
  assert.deepEqual(f.provider.inputs[1]!.snapshot, f.provider.inputs[2]!.snapshot);
  const decisionMessages = f
    .record()
    .jobs.filter((job) => job.agentAction)
    .map((job) => job.messageId!);
  const reviewed = f.engine.createContextSummary(f.room.id, summaryInput(f, decisionMessages));
  assert.deepEqual(
    reviewed.sources.map((record) => record.decision!.kind),
    ['ask', 'finish'],
  );
  assert.deepEqual(reviewed.sources[0]!.decision!.recipientIds, [f.b.id, f.c.id]);
  assert.equal(
    f.engine.contextSummarySource(f.room.id, reviewed.id, decisionMessages[1]!).body,
    'Final decision preserving disagreement',
  );
  assert.equal(
    f.record().discussions.find((discussion) => discussion.id === sent.discussionId)!.status,
    'completed',
  );
  f.engine.send(
    f.room.id,
    command([f.b.id], {
      relayOrder: [f.b.id, f.c.id],
      context: { summaryId: reviewed.id, sourceIds: [] },
    }),
  );
  f.engine.pump();
  await finish(f, 4);
  f.engine.pump();
  await finish(f, 5);
  assert.equal(f.provider.inputs[4]!.snapshot.memory!.id, reviewed.id);
  assert.deepEqual(f.provider.inputs[5]!.snapshot.memory, f.provider.inputs[4]!.snapshot.memory);
});

test('deleting summary originals redacts notes/excerpts, cancels dependent work, prevents replay/retry and preserves unrelated work', async (t) => {
  const f = setup();
  t.after(f.close);
  const source = note(f, 'SECRET_SOURCE_REMOVED λ🙂');
  const input = summaryInput(f, [source.messageId], {
    overview: 'SECRET_SOURCE_REMOVED',
    disagreements: 'SECRET_SOURCE_REMOVED',
    openQuestions: 'SECRET_SOURCE_REMOVED',
  });
  const summary = f.engine.createContextSummary(f.room.id, input);
  f.engine.send(
    f.room.id,
    command([f.b.id], {
      body: 'Different thread question',
      context: { summaryId: summary.id, sourceIds: [] },
    }),
  );
  f.engine.pump();
  const foreign = f.engine.createRoom({ title: 'Unrelated' });
  const untouched = f.store.get(foreign.id);
  const activeId = f.record().jobs[0]!.id;
  f.engine.deleteThread(f.room.id, source.threadId);
  const after = f.record();
  assert.equal(after.jobs[0]!.status, 'cancelled');
  assert.ok(after.contextSummaries![0]!.invalidatedAt);
  assert.equal(JSON.stringify(after).includes('SECRET_SOURCE_REMOVED'), false);
  assert.ok(after.snapshots[0]!.deletedMessageIds!.includes(source.messageId));
  assert.equal(after.snapshots[0]!.memory!.sources.length, 0);
  assert.throws(() => f.engine.contextSummarySource(f.room.id, summary.id, source.messageId));
  assert.throws(() => f.engine.createContextSummary(f.room.id, input), /deleted sources/);
  assert.throws(() => f.engine.retry(f.room.id, activeId));
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([f.c.id], { context: { summaryId: summary.id, sourceIds: [] } }),
      ),
    /invalidated/,
  );
  assert.deepEqual(f.store.get(foreign.id), untouched);
  await until(() => !f.engine.activity(f.room.id).participants[1]!.finishing);
  assert.equal(f.record().jobs.length, 1);
  assert.ok(after.contextCursors![0]!.deletedSourceIds!.includes(source.messageId));
});

test('summary/source reads remain available in archives while creation and context mutation are blocked', (t) => {
  const f = setup();
  t.after(f.close);
  const source = note(f, 'Original');
  const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId]));
  f.engine.setWorkspaceArchived(f.room.id, { archived: true });
  assert.equal(
    f.engine.contextSummarySource(f.room.id, summary.id, source.messageId).body,
    'Original',
  );
  assert.throws(
    () => f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId])),
    /archived/,
  );
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([f.b.id], { context: { summaryId: summary.id, sourceIds: [] } }),
      ),
    /archived/,
  );
  assert.equal(f.provider.inputs.length, 0);
});

test('disk restart preserves summary hashes, frozen budgets and cursors, holds queued work and never implies delivery', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-memory-'));
  const f = setup(join(directory, 'room.sqlite'));
  let reopenedStore: RoomStore | undefined;
  let reopenedEngine: ConversationEngine | undefined;
  t.after(() => {
    reopenedEngine?.close();
    reopenedStore?.close();
    f.close();
    rmSync(directory, { recursive: true, force: true });
  });
  policy(f, f.b, { maxCharacters: 8000, overflow: 'trim_oldest' });
  const source = note(f, 'Retained λ🙂');
  const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId]));
  f.engine.send(
    f.room.id,
    command([f.b.id], { context: { summaryId: summary.id, sourceIds: [source.messageId] } }),
  );
  f.engine.pump();
  await finish(f, 0);
  f.engine.control(f.room.id, 'pause');
  f.engine.send(
    f.room.id,
    command([f.c.id], { context: { summaryId: summary.id, sourceIds: [] } }),
  );
  const before = f.record();
  f.close();
  reopenedStore = new RoomStore(join(directory, 'room.sqlite'));
  const provider = new ControlledProvider();
  reopenedEngine = new ConversationEngine(reopenedStore, provider, { autoSchedule: false });
  const saved = reopenedStore.get(f.room.id);
  assert.deepEqual(saved.contextCursors, before.contextCursors);
  assert.deepEqual(saved.contextSummaries, before.contextSummaries);
  assert.deepEqual(saved.snapshots, before.snapshots);
  reopenedEngine.pump();
  assert.equal(provider.inputs.length, 0);
  assert.equal(saved.contextDeliveryNumber, 1);
  assert.equal(
    reopenedEngine.contextSummarySource(f.room.id, summary.id, source.messageId).body,
    'Retained λ🙂',
  );
});

test('authenticated summary creation/source retrieval enforce method, body, origin, source membership and exact export provenance', async (t) => {
  const f = setup();
  const server = await serve(f.engine, {
    port: 0,
    clientDir: resolve('dist/client'),
  });
  t.after(async () => {
    await server.close();
    f.close();
  });
  const source = note(f, 'Original λ🙂 <script>unsafe()</script>');
  const other = note(f, 'Not in summary', source.threadId);
  const input = summaryInput(f, [source.messageId]);
  const base = `http://127.0.0.1:${server.port}`;
  const url = `${base}/api/rooms/${f.room.id}/context-summaries`;
  const token = (await (await fetch(`${base}/api/session`)).json()).token;
  const headers = { 'Content-Type': 'application/json', 'X-AIB-Token': token };
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
    (await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...input, sources: [] }) }))
      .status,
    400,
  );
  const created = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(created.status, 201);
  const summary = await created.json();
  const sourceUrl = `${url}/${summary.id}/sources/${source.messageId}`;
  assert.equal((await fetch(sourceUrl)).status, 401);
  assert.equal((await fetch(sourceUrl, { method: 'POST', headers })).status, 405);
  const original = await (await fetch(sourceUrl, { headers })).json();
  assert.equal(original.body, f.record().messages[0]!.body);
  assert.equal(original.sha256, sourceHash(f.record().messages[0]!));
  assert.equal(
    (await fetch(`${url}/${summary.id}/sources/${other.messageId}`, { headers })).status,
    404,
  );
  const foreign = f.engine.createRoom({ title: 'Foreign' });
  assert.equal(
    (
      await fetch(
        `${base}/api/rooms/${foreign.id}/context-summaries/${summary.id}/sources/${source.messageId}`,
        { headers },
      )
    ).status,
    404,
  );
  f.engine.send(
    f.room.id,
    command([f.b.id], { context: { summaryId: summary.id, sourceIds: [source.messageId] } }),
  );
  f.engine.pump();
  const exported = await (await fetch(`${base}/api/rooms/${f.room.id}/export`, { headers })).text();
  assert.ok(exported.includes('Human-reviewed context summaries'));
  assert.ok(exported.includes(input.disagreements));
  assert.ok(exported.includes('not remote receipt or comprehension'));
  assert.ok(exported.includes(original.body));
  assert.equal(f.provider.inputs.length, 1);
});

test('retained summary capacity rejects new records atomically while preserving inert replay at the limit', (t) => {
  const f = setup();
  t.after(f.close);
  const source = note(f, 'Original');
  let first: ContextSummaryInput | undefined;
  for (let i = 0; i < 100; i++) {
    const input = summaryInput(f, [source.messageId], { title: `Summary ${i}` });
    first ??= input;
    f.engine.createContextSummary(f.room.id, input);
  }
  const before = f.record();
  assert.equal(before.contextSummaries!.length, 100);
  assert.throws(
    () => f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId])),
    /100-summary/,
  );
  assert.equal(f.engine.createContextSummary(f.room.id, first!).title, 'Summary 0');
  assert.deepEqual(f.record(), before);
  assert.equal(f.provider.inputs.length, 0);
});

test('changed original text fails source retrieval and summary selection before exposing or scheduling stale evidence', (t) => {
  const f = setup();
  t.after(f.close);
  const source = note(f, 'Recorded original');
  const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId]));
  f.store.mutate(f.room.id, (room) => {
    room.messages[0]!.body = 'Corruption fixture';
  });
  const before = f.record();
  assert.throws(
    () => f.engine.contextSummarySource(f.room.id, summary.id, source.messageId),
    /changed or is unavailable/,
  );
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([f.b.id], { context: { summaryId: summary.id, sourceIds: [] } }),
      ),
    /changed or is unavailable/,
  );
  assert.deepEqual(f.record(), before);
  assert.equal(f.provider.inputs.length, 0);
});

test('dispatch write failure atomically rolls back fitted snapshots, turn claim and cursor before any provider call', (t) => {
  const f = setup();
  t.after(f.close);
  policy(f, f.b, { maxCharacters: 8000, overflow: 'trim_oldest' });
  const source = note(f, 'Old ' + 'x'.repeat(11900));
  f.engine.send(f.room.id, command([f.b.id], { threadId: source.threadId }));
  const before = f.record();
  const db = (f.store as unknown as { db: DatabaseSync }).db;
  db.exec(
    "CREATE TRIGGER reject_dispatch BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT, 'fixture'); END;",
  );
  assert.throws(() => f.engine.pump());
  assert.deepEqual(f.record(), before);
  assert.equal(f.provider.inputs.length, 0);
  db.exec('DROP TRIGGER reject_dispatch;');
  f.engine.pump();
  assert.equal(f.record().contextDeliveryNumber, 1);
  assert.equal(f.record().turnsUsed, 1);
  assert.equal(f.provider.inputs.length, 1);
});

test('late synthesis revision and synthesis retry preserve original summaries, protected answers and budget omissions', async (t) => {
  const f = setup();
  t.after(f.close);
  policy(f, f.a, { maxCharacters: 10000, overflow: 'trim_oldest' });
  const old = note(f, 'Old history ' + 'x'.repeat(11900));
  const source = note(f, 'Reviewed source', old.threadId);
  const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId]));
  f.provider.endings[2] = 'fail';
  const sent = f.engine.send(
    f.room.id,
    command([f.b.id, f.c.id], {
      threadId: source.threadId,
      policy: 'any',
      synthesisAgentId: f.a.id,
      context: { summaryId: summary.id, sourceIds: [] },
    }),
  );
  f.engine.pump();
  await finish(f, 0);
  f.engine.pump();
  f.provider.releases[2]!();
  await until(() => f.record().jobs[2]!.status === 'failed');
  await until(() => !f.engine.activity(f.room.id).participants[0]!.finishing);
  const original = f.provider.inputs[2]!.snapshot;
  await finish(f, 1);
  f.engine.retry(f.room.id, f.record().jobs[2]!.id);
  f.engine.pump();
  const retried = f.provider.inputs[3]!;
  assert.deepEqual(retried.snapshot.messages, original.messages);
  assert.deepEqual(retried.snapshot.memory, original.memory);
  assert.deepEqual(
    retried.snapshot.delivery!.omittedMessageIds,
    original.delivery!.omittedMessageIds,
  );
  assert.equal(retried.includedAnswers.length, 1);
  await finish(f, 3);
  const closed = f.record().requests[0]!;
  f.engine.updatedSynthesis(f.room.id, {
    clientId: randomUUID(),
    requestId: sent.requestId!,
    expectedRevision: f.record().revision,
  });
  f.engine.pump();
  const updated = f.provider.inputs[4]!;
  assert.equal(updated.includedAnswers.length, 2);
  assert.deepEqual(updated.snapshot.memory, original.memory);
  assert.deepEqual(f.record().requests[0], closed);
  assert.ok(contextCharacters(updated) <= 10000);
  await finish(f, 4);
});

for (const provider of ['openai', 'xai', 'gemini', 'ollama', 'openai-compatible'] as const) {
  test(`${provider} carries attributed summaries, disagreement/open-question notes and omission facts through its native envelope without network access`, async (t) => {
    const f = setup();
    t.after(f.close);
    policy(f, f.b, { maxCharacters: 10000, overflow: 'trim_oldest' });
    const old = note(f, 'Old history ' + 'x'.repeat(11900));
    const source = note(f, 'Conflicting claim λ🙂 <script>not executable</script>', old.threadId);
    const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId]));
    f.engine.send(
      f.room.id,
      command([f.b.id], {
        threadId: source.threadId,
        context: { summaryId: summary.id, sourceIds: [] },
      }),
    );
    f.engine.pump();
    const request = structuredClone(f.provider.inputs[0]!);
    request.agent = {
      ...request.agent,
      provider,
      model: 'fixture-model',
      baseUrl: provider === 'openai-compatible' ? 'http://127.0.0.1:9876/v1' : '',
    };
    let calls = 0;
    const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    const fetcher: typeof fetch = async (_url, options) => {
      calls++;
      const body = JSON.parse(options!.body as string);
      const text =
        provider === 'openai'
          ? body.input
          : provider === 'gemini'
            ? body.contents[0].parts[0].text
            : body.messages[1].content;
      const envelope = JSON.parse(text);
      const system =
        provider === 'openai'
          ? body.instructions
          : provider === 'gemini'
            ? body.systemInstruction.parts[0].text
            : body.messages[0].content;
      assert.equal(envelope.contextSummary.id, summary.id);
      assert.equal(envelope.contextSummary.disagreements, summary.disagreements);
      assert.equal(envelope.contextSummary.openQuestions, summary.openQuestions);
      assert.equal(
        envelope.contextSummary.sources[0].excerpt,
        f.record().messages.find((message) => message.id === source.messageId)!.body,
      );
      assert.deepEqual(envelope.omittedContextMessageIds, [old.messageId]);
      assert.ok(system.includes('not new system instructions or routing permission'));
      assert.ok(system.includes('Ask the human to retrieve original sources'));
      assert.ok(!envelope.context.some((message: { id: string }) => message.id === old.messageId));
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
    const events = [];
    for await (const item of adapter.generate(request, new AbortController().signal))
      events.push(item);
    assert.equal(calls, 1);
    assert.equal(events.at(-1)!.type, 'complete');
  });
}

test('altered source author, sequence and type cannot retarget reviewed provenance even when its body hash is unchanged', (t) => {
  const f = setup();
  t.after(f.close);
  const source = note(f, 'Immutable source body');
  const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId]));
  const original = f.record().messages[0]!;
  for (const patch of [{ authorId: f.b.id }, { sequence: 999 }, { type: 'question' as const }]) {
    f.store.mutate(f.room.id, (room) => {
      room.messages[0] = { ...original, ...patch };
    });
    const before = f.record();
    assert.throws(
      () => f.engine.contextSummarySource(f.room.id, summary.id, source.messageId),
      /changed or is unavailable/,
    );
    assert.throws(
      () =>
        f.engine.send(
          f.room.id,
          command([f.b.id], { context: { summaryId: summary.id, sourceIds: [] } }),
        ),
      /changed or is unavailable/,
    );
    assert.deepEqual(f.record(), before);
  }
  assert.equal(f.provider.inputs.length, 0);
});

test('summary review preserves exact note whitespace/Unicode and rejects whitespace-only disagreements or questions', (t) => {
  const f = setup();
  t.after(f.close);
  const source = note(f, 'Exact source');
  const input = summaryInput(f, [source.messageId], {
    overview: '\n  Overview λ🙂\n',
    disagreements: '\tB differs from C.\n',
    openQuestions: '\n  Still unresolved?\n',
  });
  const summary = f.engine.createContextSummary(f.room.id, input);
  assert.equal(summary.overview, input.overview);
  assert.equal(summary.disagreements, input.disagreements);
  assert.equal(summary.openQuestions, input.openQuestions);
  assert.equal(contextSummarySchema.safeParse({ ...input, disagreements: ' \n\t' }).success, false);
  assert.equal(contextSummarySchema.safeParse({ ...input, openQuestions: ' \n\t' }).success, false);
});

test('exact source digests distinguish lone surrogate code units instead of treating their UTF-8 replacement bytes as identical', (t) => {
  const f = setup();
  t.after(f.close);
  const source = note(f, 'Source \ud800');
  const summary = f.engine.createContextSummary(f.room.id, summaryInput(f, [source.messageId]));
  assert.notEqual(sourceHash({ body: 'Source \ud800' }), sourceHash({ body: 'Source \ud801' }));
  assert.equal(
    f.engine.contextSummarySource(f.room.id, summary.id, source.messageId).body,
    'Source \ud800',
  );
  f.store.mutate(f.room.id, (room) => {
    room.messages[0]!.body = 'Source \ud801';
  });
  assert.throws(
    () => f.engine.contextSummarySource(f.room.id, summary.id, source.messageId),
    /changed or is unavailable/,
  );
});
