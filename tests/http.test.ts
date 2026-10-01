import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { get } from 'node:http';
import { test } from 'node:test';
import { ConversationEngine } from '../src/server/engine.js';
import { serve } from '../src/server/http.js';
import { RoomStore } from '../src/server/store.js';
import { command, ControlledProvider, until } from './helpers.js';

test('local HTTP boundary enforces token, host, origin, strict commands, and safe output', async () => {
  const store = new RoomStore(':memory:');
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false });
  const room = engine.createRoom({ title: 'HTTP test', objective: '', maxTurns: 100 });
  const app = await serve(engine, { port: 0, clientDir: resolve('dist/client') });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    assert.equal((await fetch(`${base}/api/rooms`)).status, 401);
    assert.equal(
      (await fetch(`${base}/api/rooms`, { headers: { 'X-AIB-Token': 'é'.repeat(64) } })).status,
      401,
    );
    assert.equal(
      (await fetch(`${base}/api/session`, { headers: { Origin: 'https://evil.example' } })).status,
      403,
    );
    const invalidHostStatus = await new Promise<number | undefined>((done, reject) => {
      get(`${base}/api/session`, { headers: { Host: 'evil.example' } }, (response) => {
        response.resume();
        response.on('end', () => done(response.statusCode));
      }).on('error', reject);
    });
    assert.equal(invalidHostStatus, 403);
    assert.equal(
      (await fetch(`${base}/api/session`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status,
      403,
    );
    const session = await fetch(`${base}/api/session`);
    assert.equal(session.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(!session.headers.has('access-control-allow-origin'));
    assert.ok(!session.headers.get('content-security-policy')!.includes('unsafe-inline'));
    const { token } = (await session.json()) as { token: string };
    const headers = { 'X-AIB-Token': token, 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${base}/api/rooms`, { headers })).status, 200);
    const sendUrl = `${base}/api/rooms/${room.id}/messages`;
    assert.equal(
      (await fetch(sendUrl, { method: 'POST', headers: { 'X-AIB-Token': token }, body: '{}' }))
        .status,
      415,
    );
    assert.equal(
      (
        await fetch(sendUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...command([room.agents[0]!.id]), authorId: 'agent_b' }),
        })
      ).status,
      400,
    );
    assert.equal((await fetch(sendUrl, { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal(
      (
        await fetch(sendUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ padding: 'x'.repeat(70000) }),
        })
      ).status,
      413,
    );
    const input = command([room.agents[1]!.id], { body: '<script>alert(1)</script>' });
    const first = await fetch(sendUrl, { method: 'POST', headers, body: JSON.stringify(input) });
    const repeat = await fetch(sendUrl, { method: 'POST', headers, body: JSON.stringify(input) });
    assert.deepEqual(await first.json(), await repeat.json());
    assert.equal(store.get(room.id).messages.length, 1);
    const discussionResponse = await fetch(sendUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(
        command([room.agents[0]!.id], { discussion: { maxRounds: 3, maxTurns: 12 } }),
      ),
    });
    assert.equal(discussionResponse.status, 201);
    const { discussionId } = (await discussionResponse.json()) as { discussionId: string };
    const stopUrl = `${base}/api/rooms/${room.id}/discussion-stop`;
    assert.equal(
      (
        await fetch(stopUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discussionId }),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(stopUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ discussionId, authorId: 'human' }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(stopUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ discussionId: 'unknown' }),
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(stopUrl, { method: 'POST', headers, body: JSON.stringify({ discussionId }) }))
        .status,
      200,
    );
    assert.equal(store.get(room.id).status, 'running');
    assert.equal(store.get(room.id).discussions[0]!.status, 'cancelled');
    assert.equal(
      store.get(room.id).jobs[0]!.status,
      'queued',
      'Stopping a discussion must retain unrelated obligations.',
    );
    provider.actions[1] = {
      kind: 'finish',
      body: 'Exported coordinator result.',
      recipientIds: [],
      policy: 'all',
      quorum: 1,
      replyTo: null,
    };
    const completedDiscussion = engine.send(
      room.id,
      command([room.agents[0]!.id], { discussion: { maxRounds: 1, maxTurns: 2 } }),
    );
    engine.pump();
    provider.releases.forEach((release) => release());
    await until(
      () =>
        store.get(room.id).discussions.find((d) => d.id === completedDiscussion.discussionId)!
          .status === 'completed',
    );
    const exported = await fetch(`${base}/api/rooms/${room.id}/export`, { headers });
    assert.match(exported.headers.get('content-type')!, /text\/markdown/);
    const text = await exported.text();
    assert.ok(text.includes('Simulation transcript'));
    assert.ok(text.includes(`Discussion: ${discussionId}`));
    assert.ok(text.includes('Peer rounds: 0/3'));
    assert.ok(text.includes('To: Human (human)'));
    assert.ok(text.includes('Action: finish · Policy: all · Quorum: 1'));
    assert.ok(text.includes('Attempt: '));
    assert.ok(!text.includes(token));
    assert.equal((await fetch(`${base}/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/..%2F..%2Fpackage.json`)).status, 403);
  } finally {
    engine.close();
    await app.close();
    store.close();
  }
});
