import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Room, SendInput } from '../src/shared/contracts.js';
import { ConversationEngine } from '../src/server/engine.js';
import { RoomStore } from '../src/server/store.js';
import { ControlledProvider } from './helpers.js';

test('pre-discussion room records and v0.1/v0.2 send hashes remain readable and duplicate-resistant', () => {
  const store = new RoomStore(':memory:');
  let nextId = 0;
  const engine = new ConversationEngine(store, new ControlledProvider(), {
    autoSchedule: false,
    id: () => `participant_${nextId++}`,
  });
  try {
    const room = engine.createRoom({ title: 'Compatibility', objective: '', maxTurns: 100 });
    const direct: SendInput = {
      clientId: '00000000-0000-4000-8000-000000000001',
      body: 'Legacy delivery.',
      type: 'question',
      recipientIds: ['participant_0'],
      policy: 'all',
      quorum: 1,
      synthesisAgentId: null,
      threadId: null,
      replyTo: null,
      deadlineSeconds: 120,
    };
    const relay: SendInput = {
      ...direct,
      clientId: '00000000-0000-4000-8000-000000000002',
      relayOrder: ['participant_0', 'participant_1'],
    };
    const first = engine.send(room.id, direct);
    const second = engine.send(room.id, relay);
    // Golden hashes of the normalized commands under the published v0.1/v0.2 contracts.
    assert.equal(
      store.get(room.id).messages[0]!.commandHash,
      '9848401f73b1e02905961f95cf9eff0a6a18a4fea73de3554ca668791e8aa1e4',
    );
    assert.equal(
      store.get(room.id).messages[1]!.commandHash,
      '40d73a66ed05c9cc199ebe0bb79fecbad4c26378fcb39c4c47c5b0960ee46830',
    );
    store.mutate(room.id, (legacy) => {
      delete (legacy as Partial<Room>).discussions;
    });
    assert.deepEqual(store.get(room.id).discussions, []);
    assert.deepEqual(engine.send(room.id, direct), first);
    assert.deepEqual(engine.send(room.id, relay), second);
    assert.equal(store.get(room.id).messages.length, 2);
    assert.equal(store.get(room.id).jobs.length, 2);
  } finally {
    engine.close();
    store.close();
  }
});
