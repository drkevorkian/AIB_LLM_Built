import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ConversationEngine } from '../src/server/engine.js';
import { RoomStore } from '../src/server/store.js';
import { serve } from '../src/server/http.js';
import { archiveManifest } from '../src/server/artifacts.js';
import { LiveProviders, providerPrompt } from '../src/server/live-providers.js';
import type { ArtifactUploadInput, ArtifactVersion } from '../src/shared/contracts.js';
import { command, ControlledProvider, until } from './helpers.js';
import { zipFixture } from './artifact-fixtures.js';

function setup(path = ':memory:') {
  const store = new RoomStore(path);
  const provider = new ControlledProvider();
  const engine = new ConversationEngine(store, provider, { autoSchedule: false });
  const room = engine.createRoom({ title: 'Original artifacts', objective: 'Preserve sources' });
  const record = () => store.get(room.id);
  return {
    store,
    provider,
    engine,
    room,
    record,
    close: () => {
      engine.close();
      store.close();
    },
  };
}
function input(
  f: ReturnType<typeof setup>,
  bytes: Buffer = Buffer.from('Exact source λ🙂\r\n'),
  patch: Partial<ArtifactUploadInput> = {},
): ArtifactUploadInput {
  return {
    clientId: randomUUID(),
    expectedRevision: f.record().revision,
    filename: 'source.txt',
    mediaType: 'text/plain',
    base64: bytes.toString('base64'),
    ...patch,
  };
}
function upload(
  f: ReturnType<typeof setup>,
  text = 'Exact source λ🙂\r\n',
  patch: Partial<ArtifactUploadInput> = {},
) {
  return f.engine.uploadArtifact(f.room.id, input(f, Buffer.from(text), patch));
}
async function finish(f: ReturnType<typeof setup>, index: number) {
  await until(() => f.provider.inputs.length > index);
  const current = f.provider.inputs[index]!;
  const job = f
    .record()
    .jobs.find(
      (job) =>
        job.snapshotId === current.snapshot.id &&
        job.agentId === current.agent.id &&
        job.status === 'running',
    )!;
  f.provider.releases[index]!();
  await until(() => f.record().jobs.find((entry) => entry.id === job.id)!.status === 'completed');
  await until(
    () =>
      !f.engine
        .activity(f.room.id)
        .participants.find((p) => p.agentId === f.provider.inputs[index]!.agent.id)!.finishing,
  );
}
test('artifact bytes and raw SHA-256 stay exact, private, room-owned and independent of turns/providers', (t) => {
  const f = setup();
  t.after(f.close);
  const bytes = Buffer.from('\ufeff <svg onload="bad()"> λ🙂\r\n');
  const before = f.record();
  const version = f.engine.uploadArtifact(f.room.id, input(f, bytes));
  assert.equal(version.version, 1);
  assert.equal(version.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(f.engine.artifactOriginal(f.room.id, version.versionId).bytes, bytes);
  assert.equal(f.engine.artifactPreview(f.room.id, version.versionId).text, bytes.toString('utf8'));
  assert.equal(f.record().turnsUsed, before.turnsUsed);
  assert.deepEqual(f.record().jobs, before.jobs);
  assert.equal(f.provider.inputs.length, 0);
  assert.ok(!JSON.stringify(f.record()).includes(bytes.toString('base64')));
  version.filename = 'changed.txt';
  assert.equal(f.record().artifactVersions![0]!.filename, 'source.txt');
});

test('artifact versions append with fresh identities and retain every original; stale and foreign revisions roll back', (t) => {
  const f = setup();
  t.after(f.close);
  const first = upload(f, 'old');
  const stale = input(f, Buffer.from('new'), { artifactId: first.artifactId });
  const second = upload(f, 'new', { artifactId: first.artifactId });
  assert.equal(second.version, 2);
  assert.notEqual(first.versionId, second.versionId);
  assert.equal(f.engine.artifactOriginal(f.room.id, first.versionId).bytes.toString(), 'old');
  assert.equal(f.engine.artifactOriginal(f.room.id, second.versionId).bytes.toString(), 'new');
  const before = f.record();
  assert.throws(() => f.engine.uploadArtifact(f.room.id, stale), /Workspace changed/);
  assert.deepEqual(f.record(), before);
  const other = f.engine.createRoom({ title: 'Other' });
  assert.throws(
    () =>
      f.engine.uploadArtifact(other.id, {
        ...input(f),
        expectedRevision: other.revision,
        artifactId: first.artifactId,
      }),
    /not found/,
  );
  assert.equal(f.store.get(other.id).artifactVersions, undefined);
});

test('upload replay is inert; changed payloads and message/summary command UUID collisions do not write', (t) => {
  const f = setup();
  t.after(f.close);
  const raw = input(f);
  const saved = f.engine.uploadArtifact(f.room.id, raw);
  const before = f.record();
  assert.deepEqual(f.engine.uploadArtifact(f.room.id, raw), saved);
  assert.deepEqual(f.record(), before);
  assert.throws(
    () => f.engine.uploadArtifact(f.room.id, { ...raw, filename: 'other.txt' }),
    /different content/,
  );
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([], { clientId: raw.clientId, type: 'update', policy: 'no_reply' }),
      ),
    /artifact upload/,
  );
  const sent = f.engine.send(
    f.room.id,
    command([], { type: 'update', policy: 'no_reply', body: 'Original' }),
  );
  const message = f.record().messages.find((m) => m.id === sent.messageId)!;
  assert.throws(
    () =>
      f.engine.uploadArtifact(
        f.room.id,
        input(f, Buffer.from('collision'), { clientId: message.clientId! }),
      ),
    /other retained/,
  );
  const summary = f.engine.createContextSummary(f.room.id, {
    clientId: randomUUID(),
    expectedRevision: f.record().revision,
    threadId: sent.threadId,
    sourceIds: [sent.messageId],
    title: 'Review',
    overview: 'Original',
    disagreements: 'Unassessed',
    openQuestions: 'Unassessed',
  });
  assert.throws(
    () =>
      f.engine.uploadArtifact(
        f.room.id,
        input(f, Buffer.from('collision'), { clientId: summary.clientId }),
      ),
    /other retained/,
  );
  assert.throws(
    () =>
      f.engine.createContextSummary(f.room.id, {
        clientId: raw.clientId,
        expectedRevision: f.record().revision,
        threadId: sent.threadId,
        sourceIds: [sent.messageId],
        title: 'Review',
        overview: 'Original',
        disagreements: 'Unassessed',
        openQuestions: 'Unassessed',
      }),
    /artifact upload/,
  );
});

test('strict filenames, canonical base64, size and media validation reject before room changes', (t) => {
  const f = setup();
  t.after(f.close);
  for (const filename of [
    '../secret',
    'C:\\file.txt',
    'name/part',
    'CON.txt',
    'lpt1',
    'name.',
    'name ',
    'bad\nname',
    'bad\u202ename',
    'a'.repeat(121),
    '..',
  ]) {
    const before = f.record();
    assert.throws(() => f.engine.uploadArtifact(f.room.id, input(f, undefined, { filename })));
    assert.deepEqual(f.record(), before);
  }
  for (const base64 of ['Zg', 'Zg==\n', 'Zg===', 'Zg==junk', '!!!!'])
    assert.throws(() => f.engine.uploadArtifact(f.room.id, { ...input(f), base64 }), /canonical/);
  assert.throws(
    () => f.engine.uploadArtifact(f.room.id, input(f, Buffer.alloc(512 * 1024 + 1))),
    /Invalid|512/,
  );
  for (const mediaType of [
    'image/png',
    'image/jpeg',
    'application/pdf',
    'application/json',
    'application/zip',
  ] as const)
    assert.throws(() =>
      f.engine.uploadArtifact(
        f.room.id,
        input(f, Buffer.from('<script>bad()</script>'), { mediaType }),
      ),
    );
  assert.throws(() =>
    f.engine.uploadArtifact(f.room.id, {
      ...input(f),
      mediaType: 'text/html',
    } as unknown as ArtifactUploadInput),
  );
  assert.throws(() =>
    f.engine.uploadArtifact(f.room.id, { ...input(f), sha256: 'forged' } as ArtifactUploadInput),
  );
  assert.equal(f.record().artifactVersions, undefined);
});

test('valid UTF-8 is exact, invalid controls/encoding fail, long previews disclose omission and empty originals persist', (t) => {
  const f = setup();
  t.after(f.close);
  const blank = f.engine.uploadArtifact(f.room.id, input(f, Buffer.alloc(0)));
  assert.equal(f.engine.artifactOriginal(f.room.id, blank.versionId).bytes.length, 0);
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([0]), Buffer.from('bad\u007ftext')])
    assert.throws(() => f.engine.uploadArtifact(f.room.id, input(f, bytes)));
  const long = upload(f, 'a'.repeat(15999) + '🙂' + 'tail');
  const preview = f.engine.artifactPreview(f.room.id, long.versionId);
  assert.equal(preview.truncated, true);
  assert.equal(preview.text, 'a'.repeat(15999));
  assert.equal(
    f.engine.artifactOriginal(f.room.id, long.versionId).bytes.toString(),
    'a'.repeat(15999) + '🙂tail',
  );
});

test('ZIP stored/deflated Unicode member previews retain verified provenance and never materialize files', (t) => {
  const f = setup();
  t.after(f.close);
  const bytes = zipFixture([
    { name: 'dir/source.txt', body: Buffer.from('exact source') },
    { name: 'λ.txt', body: Buffer.from('λ🙂'), method: 8 },
  ]);
  const version = f.engine.uploadArtifact(
    f.room.id,
    input(f, bytes, { filename: 'sources.zip', mediaType: 'application/zip' }),
  );
  const preview = f.engine.artifactPreview(f.room.id, version.versionId);
  assert.deepEqual(
    preview.entries?.map((v) => v.filename),
    ['dir/source.txt', 'λ.txt'],
  );
  assert.equal(
    preview.entries?.[1]!.sha256,
    createHash('sha256').update(Buffer.from('λ🙂')).digest('hex'),
  );
  assert.equal(preview.text, undefined);
  assert.deepEqual(f.engine.artifactOriginal(f.room.id, version.versionId).bytes, bytes);
  assert.throws(
    () =>
      f.engine.uploadArtifact(
        f.room.id,
        input(f, bytes, { filename: 'disguised.bin', mediaType: 'application/octet-stream' }),
      ),
    /ZIP bytes/,
  );
});

test('ZIP unsafe/duplicate paths, symlinks, encrypted/streaming methods, checksum mismatch and nested archives fail atomically', (t) => {
  const f = setup();
  t.after(f.close);
  const body = Buffer.from('original');
  const invalid = [
    zipFixture([{ name: '../outside', body }]),
    zipFixture([{ name: '/absolute', body }]),
    zipFixture([{ name: 'C:\\outside', body }]),
    zipFixture([{ name: 'dir//file', body }]),
    zipFixture([
      { name: 'a.txt', body },
      { name: 'A.txt', body },
    ]),
    zipFixture([{ name: 'link', body, attributes: 0xa000 * 65536 }]),
    zipFixture([{ name: 'secret', body, flags: 1 }]),
    zipFixture([{ name: 'stream', body, flags: 8 }]),
    zipFixture([{ name: 'unsupported', body, method: 12 }]),
    zipFixture([{ name: 'nested.zip', body: zipFixture([{ name: 'inner', body }]) }]),
    zipFixture([{ name: 'nested.bin', body: Buffer.from([0x1f, 0x8b, 0, 0]) }]),
  ];
  const badCrc = zipFixture([{ name: 'original', body }]);
  badCrc[38] = badCrc[38]! ^ 1;
  invalid.push(badCrc);
  for (const bytes of invalid) {
    const before = f.record();
    assert.throws(() =>
      f.engine.uploadArtifact(
        f.room.id,
        input(f, bytes, { filename: 'unsafe.zip', mediaType: 'application/zip' }),
      ),
    );
    assert.deepEqual(f.record(), before);
  }
});

test('ZIP count/ratio/inflated limits and local/central overlap or disagreement are rejected', () => {
  assert.throws(() =>
    archiveManifest(
      zipFixture(
        Array.from({ length: 33 }, (_, i) => ({ name: `${i}.txt`, body: Buffer.alloc(0) })),
      ),
    ),
  );
  assert.throws(() =>
    archiveManifest(zipFixture([{ name: 'bomb', body: Buffer.alloc(512 * 1024, 65), method: 8 }])),
  );
  assert.throws(() =>
    archiveManifest(zipFixture([{ name: 'large', body: Buffer.alloc(512 * 1024 + 1) }])),
  );
  const overlap = zipFixture([
    { name: 'one', body: Buffer.from('first') },
    { name: 'two', body: Buffer.from('second') },
  ]);
  const directory = overlap.readUInt32LE(overlap.length - 6);
  overlap.writeUInt32LE(0, directory + 49 + 42);
  assert.throws(() => archiveManifest(overlap));
  const mismatch = zipFixture([{ name: 'one', body: Buffer.from('first') }]);
  mismatch.writeUInt16LE(8, 8);
  assert.throws(() => archiveManifest(mismatch));
  const extra = Buffer.concat([
    Buffer.from('exe'),
    zipFixture([{ name: 'file', body: Buffer.from('original') }]),
  ]);
  assert.throws(() => archiveManifest(extra));
});

test('text grants reach siblings identically, have no sibling channel, and never follow newer artifact versions', async (t) => {
  const f = setup();
  t.after(f.close);
  const original = upload(f, 'Original evidence <svg onload="bad()"> λ🙂');
  const sent = f.engine.send(
    f.room.id,
    command(
      f.room.agents.slice(1).map((a) => a.id),
      { artifactVersionIds: [original.versionId] },
    ),
  );
  const before = f.record();
  const snapshot = before.snapshots.find(
    (s) => s.id === before.requests.find((r) => r.id === sent.requestId)!.snapshotId,
  )!;
  assert.equal(snapshot.artifacts![0]!.text, 'Original evidence <svg onload="bad()"> λ🙂');
  assert.equal(before.messages[0]!.artifactReferences![0]!.sha256, original.sha256);
  upload(f, 'New evidence', { artifactId: original.artifactId });
  await f.engine.pump();
  await until(() => f.provider.inputs.length === 2);
  assert.deepEqual(
    f.provider.inputs[0]!.snapshot.artifacts,
    f.provider.inputs[1]!.snapshot.artifacts,
  );
  assert.equal(f.provider.inputs[0]!.snapshot.artifacts![0]!.versionId, original.versionId);
  const envelope = providerPrompt(f.provider.inputs[0]!);
  assert.ok(!envelope.system.includes('Original evidence'));
  assert.equal(JSON.parse(envelope.user).selectedArtifacts[0].text, snapshot.artifacts![0]!.text);
  assert.equal(
    f.provider.inputs[1]!.snapshot.messages.some((m) => m.type === 'answer'),
    false,
  );
});

test('upload/preview alone and prior grants never authorize a later provider request', async (t) => {
  const f = setup();
  t.after(f.close);
  const version = upload(f);
  f.engine.artifactPreview(f.room.id, version.versionId);
  assert.equal(f.provider.inputs.length, 0);
  f.engine.send(
    f.room.id,
    command([f.room.agents[1]!.id], { artifactVersionIds: [version.versionId] }),
  );
  await f.engine.pump();
  await until(() => f.provider.inputs.length === 1);
  await finish(f, 0);
  f.engine.send(
    f.room.id,
    command([f.room.agents[2]!.id], { body: 'Separate question without selection' }),
  );
  await f.engine.pump();
  await until(() => f.provider.inputs.length === 2);
  assert.equal(f.provider.inputs[1]!.snapshot.artifacts, undefined);
  assert.equal(JSON.parse(providerPrompt(f.provider.inputs[1]!).user).selectedArtifacts, undefined);
});

test('foreign, duplicate, unsupported binary, oversized text and update grants reject without a message or turn', (t) => {
  const f = setup();
  t.after(f.close);
  const version = upload(f);
  const other = f.engine.createRoom({ title: 'Foreign' });
  const binary = f.engine.uploadArtifact(
    f.room.id,
    input(f, Buffer.from([0, 1, 2]), {
      filename: 'original.bin',
      mediaType: 'application/octet-stream',
    }),
  );
  const long = upload(f, 'a'.repeat(16001));
  const before = f.record();
  assert.throws(
    () =>
      f.engine.send(
        other.id,
        command([other.agents[1]!.id], { artifactVersionIds: [version.versionId] }),
      ),
    /not found/,
  );
  assert.throws(() =>
    f.engine.send(
      f.room.id,
      command([f.room.agents[1]!.id], {
        artifactVersionIds: [version.versionId, version.versionId],
      }),
    ),
  );
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([f.room.agents[1]!.id], { artifactVersionIds: [binary.versionId] }),
      ),
    /Only explicitly/,
  );
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([f.room.agents[1]!.id], { artifactVersionIds: [long.versionId] }),
      ),
    /16,000/,
  );
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([], {
          type: 'update',
          policy: 'no_reply',
          artifactVersionIds: [version.versionId],
        }),
      ),
    /human question/,
  );
  assert.deepEqual(f.record(), before);
  assert.equal(f.provider.inputs.length, 0);
});

test('configured context limits cannot trim selected artifacts, and rejection does not invoke or consume a turn', async (t) => {
  const f = setup();
  t.after(f.close);
  const version = upload(f, 'Protected full artifact '.repeat(400));
  const agent = f.room.agents[1]!;
  f.engine.configureAgent(f.room.id, {
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    provider: agent.provider,
    model: agent.model,
    contextPolicy: { maxCharacters: 4096, overflow: 'trim_oldest' },
  });
  f.engine.send(f.room.id, command([agent.id], { artifactVersionIds: [version.versionId] }));
  await f.engine.pump();
  await until(() => f.record().jobs[0]!.status === 'failed');
  assert.match(f.record().jobs[0]!.error!, /Protected/);
  assert.equal(f.record().turnsUsed, 0);
  assert.equal(f.provider.inputs.length, 0);
  assert.equal(f.record().contextCursors, undefined);
});

test('exact frozen artifact retry survives a newer upload', async (t) => {
  const f = setup();
  t.after(f.close);
  const version = upload(f, 'Exact original');
  f.engine.send(
    f.room.id,
    command([f.room.agents[1]!.id], { artifactVersionIds: [version.versionId] }),
  );
  f.provider.endings[0] = 'fail';
  await f.engine.pump();
  await until(() => f.provider.inputs.length === 1);
  f.provider.releases[0]!();
  await until(() => f.record().jobs[0]!.status === 'failed');
  await until(() => !f.engine.activity(f.room.id).participants[1]!.finishing);
  upload(f, 'New revision', { artifactId: version.artifactId });
  const previous = f.record().jobs[0]!;
  f.engine.retry(f.room.id, previous.id);
  await f.engine.pump();
  await until(() => f.provider.inputs.length === 2);
  assert.deepEqual(
    f.provider.inputs[1]!.snapshot.artifacts,
    f.provider.inputs[0]!.snapshot.artifacts,
  );
});

test('disk restart retains exact originals/versions and frozen paused work; whole-workspace deletion cascades private bytes', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-artifact-'));
  const path = join(directory, 'room.sqlite');
  let f = setup(path);
  let closed = false;
  t.after(() => {
    if (!closed) f.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const bytes = Buffer.from('Exact original λ🙂\r\n');
  const version = f.engine.uploadArtifact(f.room.id, input(f, bytes));
  f.engine.control(f.room.id, 'pause');
  f.engine.send(
    f.room.id,
    command([f.room.agents[1]!.id], { artifactVersionIds: [version.versionId] }),
  );
  const before = f.record();
  const id = f.room.id;
  f.close();
  const store = new RoomStore(path),
    provider = new ControlledProvider(),
    engine = new ConversationEngine(store, provider, { autoSchedule: false });
  try {
    assert.deepEqual(engine.artifactOriginal(id, version.versionId).bytes, bytes);
    assert.deepEqual(store.get(id).artifactVersions, before.artifactVersions);
    assert.deepEqual(store.get(id).snapshots, before.snapshots);
    await engine.pump();
    assert.equal(provider.inputs.length, 0);
    engine.deleteRoom(id);
    assert.throws(() => engine.artifactOriginal(id, version.versionId), /not found/);
  } finally {
    engine.close();
    store.close();
    closed = true;
  }
  const inspect = new DatabaseSync(path);
  try {
    assert.equal(inspect.prepare('SELECT count(*) AS n FROM artifact_bytes').get()!.n, 0);
    assert.equal(inspect.prepare('PRAGMA user_version').get()!.user_version, 3);
  } finally {
    inspect.close();
  }
});

test('SQLite bytes or metadata write faults roll back both rows and room state, and corrupt/foreign reads fail closed', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-artifact-fault-')),
    path = join(directory, 'room.sqlite');
  const f = setup(path);
  t.after(() => {
    f.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const inspector = new DatabaseSync(path);
  try {
    inspector.exec(
      "CREATE TRIGGER fail_artifact BEFORE INSERT ON artifact_bytes BEGIN SELECT RAISE(ABORT, 'Fixture byte write failure'); END;",
    );
    const before = f.record();
    assert.throws(() => upload(f), /Fixture byte/);
    assert.deepEqual(f.record(), before);
    assert.equal(inspector.prepare('SELECT count(*) AS n FROM artifact_bytes').get()!.n, 0);
    inspector.exec('DROP TRIGGER fail_artifact');
    inspector.exec(
      "CREATE TRIGGER fail_metadata BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT, 'Fixture metadata write failure'); END;",
    );
    assert.throws(() => upload(f), /Fixture metadata/);
    assert.deepEqual(f.record(), before);
    assert.equal(inspector.prepare('SELECT count(*) AS n FROM artifact_bytes').get()!.n, 0);
    inspector.exec('DROP TRIGGER fail_metadata');
    const version = upload(f);
    const other = f.engine.createRoom({ title: 'Other' });
    assert.throws(() => f.engine.artifactOriginal(other.id, version.versionId), /not found/);
    inspector
      .prepare('UPDATE artifact_bytes SET bytes=? WHERE version_id=?')
      .run(Buffer.from('changed'), version.versionId);
    assert.throws(() => f.engine.artifactPreview(f.room.id, version.versionId), /integrity/);
    assert.throws(
      () =>
        f.engine.send(
          f.room.id,
          command([f.room.agents[1]!.id], { artifactVersionIds: [version.versionId] }),
        ),
      /integrity/,
    );
    assert.equal(f.record().messages.length, 0);
  } finally {
    inspector.close();
  }
});

test('HTTP artifact routes enforce local token/origin/method/scope and return inert exact downloads and safe previews', async (t) => {
  const f = setup();
  t.after(f.close);
  const service = await serve(f.engine, { port: 0, clientDir: resolve('dist/client') });
  t.after(() => service.close());
  const base = `http://127.0.0.1:${service.port}`;
  const token = (await (await fetch(base + '/api/session')).json()).token as string;
  const headers = { 'X-AIB-Token': token, 'Content-Type': 'application/json' };
  const raw = input(f, Buffer.from('<script>unsafe()</script> λ🙂\r\n'));
  assert.equal(
    (
      await fetch(base + `/api/rooms/${f.room.id}/artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(raw),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + `/api/rooms/${f.room.id}/artifacts`, {
        method: 'POST',
        headers: { ...headers, Origin: 'https://foreign.invalid' },
        body: JSON.stringify(raw),
      })
    ).status,
    403,
  );
  const response = await fetch(base + `/api/rooms/${f.room.id}/artifacts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(raw),
  });
  assert.equal(response.status, 201);
  const version = (await response.json()) as ArtifactVersion;
  const url = base + `/api/rooms/${f.room.id}/artifacts/${version.versionId}`;
  const download = await fetch(url + '/original', { headers });
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.match(download.headers.get('content-disposition')!, /^attachment;/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from(raw.base64, 'base64'));
  const preview = await (await fetch(url + '/preview', { headers })).json();
  assert.equal(preview.text, Buffer.from(raw.base64, 'base64').toString());
  assert.equal((await fetch(url + '/preview')).status, 401);
  assert.equal(
    (await fetch(url + '/original', { method: 'POST', headers, body: '{}' })).status,
    405,
  );
  const other = f.engine.createRoom({ title: 'Other' });
  assert.equal(
    (
      await fetch(base + `/api/rooms/${other.id}/artifacts/${version.versionId}/original`, {
        headers,
      })
    ).status,
    404,
  );
});

test('ZIP rejects alternate paths, ZIP64 and malformed extras, trailing deflate data and disguised nested formats', () => {
  const body = Buffer.from('Exact content');
  for (const extra of [
    Buffer.from([1, 0, 0, 0]),
    Buffer.from([0x75, 0x70, 0, 0]),
    Buffer.from([0x55, 0x54, 9, 0, 0]),
    Buffer.from([0]),
  ])
    assert.throws(() => archiveManifest(zipFixture([{ name: 'safe.txt', body, extra }])));
  assert.throws(() =>
    archiveManifest(
      zipFixture([
        {
          name: 'safe.txt',
          body,
          method: 8,
          packed: Buffer.concat([deflateRawSync(body), Buffer.from('extra')]),
        },
      ]),
    ),
  );
  const tar = Buffer.alloc(512);
  tar.write('ustar', 257);
  for (const nested of [tar, Buffer.from('BZh9'), Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0])])
    assert.throws(() => archiveManifest(zipFixture([{ name: 'disguised.bin', body: nested }])));
  assert.throws(() => archiveManifest(zipFixture([{ name: 'safe', body, flags: 0x802 }])));
  assert.equal(
    archiveManifest(
      zipFixture([{ name: 'safe.txt', body, extra: Buffer.from([0x55, 0x54, 1, 0, 0]) }]),
    )[0]!.byteSize,
    body.length,
  );
});

test('ZIP total inflated bytes are bounded independently of individual sizes and ratios', () => {
  const block = Buffer.from(Array.from({ length: 8192 }, (_, i) => (i * 17 + (i >>> 8)) & 255));
  const body = Buffer.concat(Array.from({ length: 64 }, () => block));
  assert.ok(deflateRawSync(body).length > body.length / 100);
  assert.throws(
    () =>
      archiveManifest(
        zipFixture(Array.from({ length: 9 }, (_, i) => ({ name: `${i}.txt`, body, method: 8 }))),
      ),
    /4 MiB/,
  );
});

test('workspace version count and total original bytes are atomic limits, while exact replay at capacity is inert', (t) => {
  const f = setup();
  t.after(f.close);
  let last!: ArtifactUploadInput;
  for (let i = 0; i < 40; i++) {
    last = input(f, Buffer.from(String(i)));
    f.engine.uploadArtifact(f.room.id, last);
  }
  const full = f.record();
  assert.throws(() => upload(f), /40 versions/);
  f.engine.uploadArtifact(f.room.id, last);
  assert.deepEqual(f.record(), full);
  const g = setup();
  t.after(g.close);
  for (let i = 0; i < 16; i++)
    g.engine.uploadArtifact(
      g.room.id,
      input(g, Buffer.alloc(512 * 1024, i), {
        filename: 'bytes.bin',
        mediaType: 'application/octet-stream',
      }),
    );
  const limit = g.record();
  assert.throws(
    () =>
      g.engine.uploadArtifact(
        g.room.id,
        input(g, Buffer.from([1]), {
          filename: 'bytes.bin',
          mediaType: 'application/octet-stream',
        }),
      ),
    /8 MiB/,
  );
  assert.deepEqual(g.record(), limit);
});

test('schema 2 upgrades without changing existing records and a newer schema is rejected without mutation', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-artifact-upgrade-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'room.sqlite');
  const f = setup(path);
  const id = f.room.id,
    before = f.record();
  f.close();
  const old = new DatabaseSync(path);
  old.exec('DROP TABLE artifact_bytes; PRAGMA user_version=2;');
  old.close();
  const upgraded = new RoomStore(path);
  assert.deepEqual(upgraded.get(id), before);
  upgraded.close();
  const future = new DatabaseSync(path);
  future.exec('PRAGMA user_version=4;');
  future.close();
  assert.throws(() => new RoomStore(path), /newer/);
  const inspect = new DatabaseSync(path);
  assert.equal(inspect.prepare('PRAGMA user_version').get()!.user_version, 4);
  assert.equal(
    JSON.parse(String(inspect.prepare('SELECT payload FROM rooms WHERE id=?').get(id)!.payload)).id,
    id,
  );
  inspect.close();
});

test('corruption after queueing blocks invocation and corruption after failure blocks frozen retry before reservation', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aib-artifact-corruption-'));
  const path = join(directory, 'room.sqlite');
  const f = setup(path);
  const first = upload(f, 'Exact original');
  f.engine.send(
    f.room.id,
    command([f.room.agents[1]!.id], { artifactVersionIds: [first.versionId] }),
  );
  const inspect = new DatabaseSync(path);
  t.after(() => {
    inspect.close();
    f.close();
    rmSync(directory, { recursive: true, force: true });
  });
  inspect
    .prepare('UPDATE artifact_bytes SET bytes=? WHERE version_id=?')
    .run(Buffer.from('Changed bytes'), first.versionId);
  await f.engine.pump();
  await until(() => f.record().jobs[0]!.status === 'failed');
  assert.match(f.record().jobs[0]!.error!, /integrity/);
  assert.equal(f.record().turnsUsed, 0);
  assert.equal(f.provider.inputs.length, 0);
  assert.equal(f.record().contextCursors, undefined);
  assert.ok(f.record().events.some((event) => event.type === 'artifact.context.blocked'));
  const before = f.record();
  assert.throws(() => f.engine.retry(f.room.id, before.jobs[0]!.id), /integrity/);
  assert.deepEqual(f.record(), before);
});

test('deleting a granting thread cancels work and removes copied text while retaining independently owned originals', async (t) => {
  const f = setup();
  t.after(f.close);
  const version = upload(f, 'PRIVATE_GRANT_TEXT');
  const sent = f.engine.send(
    f.room.id,
    command([f.room.agents[1]!.id], { artifactVersionIds: [version.versionId] }),
  );
  await f.engine.pump();
  await until(() => f.provider.inputs.length === 1);
  const deletedJobId = f.record().jobs[0]!.id;
  const untouched = f.engine.createRoom({ title: 'Unrelated' });
  f.engine.deleteThread(f.room.id, sent.threadId);
  assert.equal(JSON.stringify(f.record()).includes('PRIVATE_GRANT_TEXT'), false);
  assert.equal(
    f.engine.artifactOriginal(f.room.id, version.versionId).bytes.toString(),
    'PRIVATE_GRANT_TEXT',
  );
  assert.deepEqual(f.store.get(untouched.id), untouched);
  assert.equal(f.record().jobs.length, 0);
  assert.equal(f.record().contextCursors?.length ?? 0, 0);
  assert.throws(() => f.engine.retry(f.room.id, deletedJobId), /Only failed or interrupted/);
});

test('selection count and shared context bound reject atomically without truncating artifact originals', (t) => {
  const f = setup();
  t.after(f.close);
  const versions = Array.from({ length: 5 }, () => upload(f, 'x'.repeat(16000)));
  const before = f.record();
  assert.throws(() =>
    f.engine.send(
      f.room.id,
      command([f.room.agents[1]!.id], { artifactVersionIds: versions.map((v) => v.versionId) }),
    ),
  );
  assert.throws(
    () =>
      f.engine.send(
        f.room.id,
        command([f.room.agents[1]!.id], {
          body: 'y'.repeat(12000),
          artifactVersionIds: versions.slice(0, 4).map((v) => v.versionId),
        }),
      ),
    /context/,
  );
  assert.deepEqual(f.record(), before);
  assert.equal(f.engine.artifactOriginal(f.room.id, versions[0]!.versionId).bytes.length, 16000);
});

test('relay and coordinator peer continuations retain the root grant after newer uploads', async (t) => {
  const f = setup();
  t.after(f.close);
  const [a, b, c] = f.room.agents;
  const version = upload(f, 'Original root evidence');
  f.engine.send(
    f.room.id,
    command([b!.id], { relayOrder: [b!.id, c!.id], artifactVersionIds: [version.versionId] }),
  );
  await f.engine.pump();
  await finish(f, 0);
  upload(f, 'Newer version must stay excluded', { artifactId: version.artifactId });
  await f.engine.pump();
  await finish(f, 1);
  assert.deepEqual(
    f.provider.inputs[1]!.snapshot.artifacts,
    f.provider.inputs[0]!.snapshot.artifacts,
  );
  f.provider.actions[2] = {
    kind: 'ask',
    body: 'Compare evidence',
    recipientIds: [b!.id, c!.id],
    policy: 'all',
    quorum: 1,
    replyTo: null,
  };
  f.provider.actions[5] = {
    kind: 'finish',
    body: 'Retain disagreement',
    recipientIds: [],
    policy: 'all',
    quorum: 1,
    replyTo: null,
  };
  f.engine.send(
    f.room.id,
    command([a!.id], {
      discussion: { maxRounds: 1, maxTurns: 4 },
      artifactVersionIds: [version.versionId],
    }),
  );
  await f.engine.pump();
  await finish(f, 2);
  upload(f, 'Third revision excluded', { artifactId: version.artifactId });
  await f.engine.pump();
  await finish(f, 3);
  await finish(f, 4);
  await f.engine.pump();
  await finish(f, 5);
  for (const input of f.provider.inputs)
    assert.equal(input.snapshot.artifacts![0]!.versionId, version.versionId);
  assert.deepEqual(f.provider.inputs[3]!.snapshot, f.provider.inputs[4]!.snapshot);
});

test('synthesis retry and explicit late revision retain exact root artifact versions', async (t) => {
  const f = setup();
  t.after(f.close);
  const [a, b, c] = f.room.agents;
  const version = upload(f, 'Original synthesis source');
  f.provider.endings[2] = 'fail';
  const sent = f.engine.send(
    f.room.id,
    command([b!.id, c!.id], {
      policy: 'any',
      synthesisAgentId: a!.id,
      artifactVersionIds: [version.versionId],
    }),
  );
  await f.engine.pump();
  await finish(f, 0);
  await f.engine.pump();
  await until(() => f.provider.inputs.length === 3);
  f.provider.releases[2]!();
  await until(() => f.record().jobs[2]!.status === 'failed');
  await until(() => !f.engine.activity(f.room.id).participants[0]!.finishing);
  const original = f.provider.inputs[2]!.snapshot.artifacts;
  upload(f, 'Newest unselected evidence', { artifactId: version.artifactId });
  await finish(f, 1);
  f.engine.retry(f.room.id, f.record().jobs[2]!.id);
  await f.engine.pump();
  await finish(f, 3);
  assert.deepEqual(f.provider.inputs[3]!.snapshot.artifacts, original);
  f.engine.updatedSynthesis(f.room.id, {
    clientId: randomUUID(),
    requestId: sent.requestId!,
    expectedRevision: f.record().revision,
  });
  await f.engine.pump();
  await finish(f, 4);
  assert.deepEqual(f.provider.inputs[4]!.snapshot.artifacts, original);
  assert.equal(f.provider.inputs[4]!.includedAnswers.length, 2);
});

for (const provider of ['openai', 'xai', 'gemini', 'ollama', 'openai-compatible'] as const) {
  test(`${provider} carries exact granted text and provenance as user evidence in its native envelope`, async (t) => {
    const f = setup();
    t.after(f.close);
    const version = upload(f, 'Untrusted <script>grant()</script> λ🙂\r\n');
    f.engine.send(
      f.room.id,
      command([f.room.agents[1]!.id], { artifactVersionIds: [version.versionId] }),
    );
    await f.engine.pump();
    await until(() => f.provider.inputs.length === 1);
    const input = structuredClone(f.provider.inputs[0]!);
    input.agent = {
      ...input.agent,
      provider,
      model: 'artifact-fixture',
      baseUrl: provider === 'openai-compatible' ? 'http://127.0.0.1:9876/v1' : '',
    };
    let calls = 0;
    const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    const fetcher: typeof fetch = async (_url, options) => {
      calls++;
      const body = JSON.parse(options!.body as string);
      const user =
        provider === 'openai'
          ? body.input
          : provider === 'gemini'
            ? body.contents[0].parts[0].text
            : body.messages[1].content;
      const system =
        provider === 'openai'
          ? body.instructions
          : provider === 'gemini'
            ? body.systemInstruction.parts[0].text
            : body.messages[0].content;
      assert.deepEqual(JSON.parse(user).selectedArtifacts, input.snapshot.artifacts);
      assert.ok(!system.includes('grant()'));
      assert.match(system, /untrusted user data/);
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
    for await (const item of adapter.generate(input, new AbortController().signal))
      events.push(item);
    assert.equal(calls, 1);
    assert.equal(events.at(-1)!.type, 'complete');
  });
}
