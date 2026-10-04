import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test as baseTest, expect, type Page } from '@playwright/test';
import type { ArtifactContext, Room } from '../../src/shared/contracts.js';
import { zipFixture } from '../artifact-fixtures.js';
import { isolatedService } from './isolated-service.js';

const test = baseTest.extend<{ artifactService: Awaited<ReturnType<typeof isolatedService>> }>({
  artifactService: async ({ browser }, use) => {
    const bootstrap = await browser.newPage();
    const service = await isolatedService(bootstrap);
    try {
      await service.ready();
      await use(service);
    } finally {
      await service.close();
      await bootstrap.close();
    }
  },
  context: async ({ browser, artifactService }, use) => {
    const context = await browser.newContext({
      baseURL: artifactService.base,
      viewport: { width: 1440, height: 1000 },
    });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});

async function fixture(page: Page, native = false) {
  const calls: { selectedArtifacts?: ArtifactContext[]; currentRequest: string }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      calls.push(JSON.parse(JSON.parse(Buffer.concat(chunks).toString()).messages[1].content));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Artifact fixture response: preserve original evidence.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Artifact fixture port unavailable');
  await page.goto('/');
  let headers = {
    'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
  };
  const created = await page.request.post('/api/rooms', {
    headers,
    data: { title: 'Artifacts ' + randomUUID().slice(0, 8), objective: 'Preserve original files' },
  });
  expect(created.ok()).toBe(true);
  const room = (await created.json()) as Room;
  if (native)
    for (const agent of room.agents.slice(1)) {
      const response = await page.request.post(`/api/rooms/${room.id}/agents`, {
        headers,
        data: {
          agentId: agent.id,
          name: agent.name,
          role: agent.role,
          provider: 'openai-compatible',
          model: 'artifact-protocol-fixture',
          baseUrl: `http://127.0.0.1:${address.port}`,
          maxOutputTokens: 4096,
          timeoutSeconds: 30,
        },
      });
      expect(response.ok()).toBe(true);
    }
  await page.reload();
  await page.locator('.room-item').filter({ hasText: room.title }).click();
  await expect(
    page.getByRole('heading', { name: room.title, level: 1, exact: true }),
  ).toBeVisible();
  const record = async () =>
    (await (await page.request.get(`/api/rooms/${room.id}`, { headers })).json()) as Room;
  const openPanel = async () => {
    const panel = page.locator('.artifact-panel');
    if (!(await panel.evaluate((element) => (element as HTMLDetailsElement).open)))
      await panel.locator(':scope > summary').click();
    return panel;
  };
  const upload = async (
    bytes: Buffer,
    name = 'original.txt',
    mimeType = 'text/plain',
    artifactId = '',
  ) => {
    const before = (await record()).artifactVersions?.length ?? 0;
    const panel = await openPanel();
    await panel
      .getByLabel('Artifact file', { exact: true })
      .setInputFiles({ name, mimeType, buffer: bytes });
    await panel.getByLabel('Artifact version target', { exact: true }).selectOption(artifactId);
    await expect(panel.getByLabel('Artifact version target', { exact: true })).toHaveValue(
      artifactId,
    );
    await expect(panel.getByLabel('Artifact format', { exact: true })).toHaveValue(mimeType);
    await panel.getByRole('button', { name: 'Upload artifact version', exact: true }).click();
    await expect.poll(async () => (await record()).artifactVersions?.length ?? 0).toBe(before + 1);
    await expect(
      panel.getByRole('button', { name: 'Upload artifact version', exact: true }),
    ).toBeDisabled();
    return (await record()).artifactVersions!.at(-1)!;
  };
  return {
    room,
    calls,
    record,
    openPanel,
    upload,
    headers: () => headers,
    refreshHeaders: async () => {
      headers = {
        'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
      };
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
    },
  };
}
async function chooseTheme(page: Page, id: string) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption(id);
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', id);
}
async function palette(page: Page, id: 'ghost-white' | 'blizzard-blue') {
  const light = id === 'ghost-white';
  const expected = {
    background: light ? 'rgb(248, 248, 255)' : 'rgb(0, 0, 0)',
    text: light ? 'rgb(0, 0, 0)' : 'rgb(172, 229, 238)',
    line: light ? 'rgb(172, 229, 238)' : 'rgb(248, 248, 255)',
  };
  const actual = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const editor = getComputedStyle(document.querySelector('textarea[aria-label="Message"]')!);
    return { background: body.backgroundColor, text: body.color, line: editor.borderTopColor };
  });
  expect(actual).toEqual(expected);
}

test('uploads retain exact downloadable bytes, safe text/ZIP/metadata previews and drafts without provider calls', async ({
  page,
}) => {
  const f = await fixture(page);
  try {
    const bytes = Buffer.from('\ufeff<script>window.artifactInjected=true</script> λ🙂\r\n');
    await page.getByLabel('Message', { exact: true }).fill('Retain this artifact draft.');
    const version = await f.upload(bytes);
    expect(version.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const source = page.locator(`[data-version-id="${version.versionId}"]`);
    await source.locator(':scope > summary').click();
    await source.getByRole('button', { name: 'Preview version 1', exact: true }).click();
    await expect(source.getByRole('region')).toContainText(bytes.toString('utf8'));
    expect(
      await page.evaluate(
        () => (window as Window & { artifactInjected?: boolean }).artifactInjected,
      ),
    ).toBeUndefined();
    await source
      .getByRole('button', { name: 'Copy artifact text original.txt version 1', exact: true })
      .click();
    await expect(source.getByRole('status')).toContainText('Text copied.');
    const promised = page.waitForEvent('download');
    await source.getByRole('button', { name: 'Download original version 1', exact: true }).click();
    const downloaded = await promised;
    expect(downloaded.suggestedFilename()).toBe('original.txt');
    expect(await readFile((await downloaded.path())!)).toEqual(bytes);
    const zip = await f.upload(
      zipFixture([{ name: 'folder/evidence.txt', body: Buffer.from('member λ🙂'), method: 8 }]),
      'archive.zip',
      'application/zip',
    );
    const archive = page.locator(`[data-version-id="${zip.versionId}"]`);
    await archive.locator(':scope > summary').click();
    await archive.getByRole('button', { name: 'Preview version 1', exact: true }).click();
    await expect(archive.getByRole('region')).toContainText('folder/evidence.txt');
    const pdf = await f.upload(
      Buffer.from('%PDF-1.4\nfixture metadata\n%%EOF'),
      'source.pdf',
      'application/pdf',
    );
    const meta = page.locator(`[data-version-id="${pdf.versionId}"]`);
    await meta.locator(':scope > summary').click();
    await meta.getByRole('button', { name: 'Preview version 1', exact: true }).click();
    await expect(meta.getByRole('region')).toContainText('Metadata preview only');
    await page.locator('.artifact-choice > summary').click();
    await expect(
      page.getByLabel(`Include artifact source.pdf version 1 ${pdf.versionId}`, { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel(`Include artifact archive.zip version 1 ${zip.versionId}`, { exact: true }),
    ).toBeDisabled();
    await chooseTheme(page, 'ghost-white');
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Retain this artifact draft.',
    );
    expect((await f.record()).turnsUsed).toBe(0);
    expect((await f.record()).jobs).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test('explicit old-version grants reach independent native requests and frozen inspection; new questions need new selection', async ({
  page,
}) => {
  const f = await fixture(page, true);
  try {
    const first = await f.upload(Buffer.from('Original granted evidence λ🙂\r\n'));
    await f.upload(
      Buffer.from('Newer version must stay excluded'),
      'original.txt',
      'text/plain',
      first.artifactId,
    );
    await page.locator('.artifact-choice > summary').click();
    await page
      .getByLabel(`Include artifact original.txt version 1 ${first.versionId}`, { exact: true })
      .check();
    await page.locator('.synthesis-option input').uncheck();
    await expect(page.locator('.artifact-choice')).toContainText(
      'openai-compatible / artifact-protocol-fixture',
    );
    await page.getByLabel('Message', { exact: true }).fill('Compare the exact selected version.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => f.calls.length).toBe(2);
    await expect
      .poll(async () => (await f.record()).jobs.filter((job) => job.status === 'completed').length)
      .toBe(2);
    expect(f.calls[0]!.selectedArtifacts).toEqual(f.calls[1]!.selectedArtifacts);
    expect(f.calls[0]!.selectedArtifacts![0]!.versionId).toBe(first.versionId);
    expect(f.calls[0]!.selectedArtifacts![0]!.text).toBe('Original granted evidence λ🙂\r\n');
    const answer = page
      .locator('.message.answer')
      .filter({ hasText: 'Artifact fixture response' })
      .first();
    await answer.getByRole('button', { name: 'Inspect context', exact: true }).click();
    const frozen = page.getByRole('dialog').locator('.frozen-artifacts');
    await frozen.locator(':scope > summary').click();
    await expect(frozen).toContainText(first.sha256);
    await frozen.getByText('Exact frozen text original.txt v1', { exact: true }).click();
    await expect(frozen.locator('pre')).toHaveText('Original granted evidence λ🙂\r\n');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(
      page.getByLabel(`Include artifact original.txt version 1 ${first.versionId}`, {
        exact: true,
      }),
    ).not.toBeChecked();
    await page
      .getByLabel('Message', { exact: true })
      .fill('A later question without an artifact grant.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => f.calls.length).toBe(4);
    expect(f.calls[2]!.selectedArtifacts).toBeUndefined();
    expect(f.calls[3]!.selectedArtifacts).toBeUndefined();
  } finally {
    await f.close();
  }
});

test('stale and lost upload acknowledgements retain file drafts and require explicit refresh without POST replay', async ({
  page,
}) => {
  const f = await fixture(page);
  try {
    const panel = await f.openPanel();
    await panel.getByLabel('Artifact file', { exact: true }).setInputFiles({
      name: 'draft.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Saved once λ🙂'),
    });
    await panel.getByLabel('Original filename', { exact: true }).fill('reviewed.txt');
    const update = await page.request.post(`/api/rooms/${f.room.id}/messages`, {
      headers: f.headers(),
      data: {
        clientId: randomUUID(),
        body: 'Advance the reviewed room revision.',
        type: 'update',
        policy: 'no_reply',
        recipientIds: [],
      },
    });
    expect(update.ok()).toBe(true);
    await panel.getByRole('button', { name: 'Upload artifact version', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('Workspace changed');
    await expect(panel.getByLabel('Original filename', { exact: true })).toHaveValue(
      'reviewed.txt',
    );
    expect((await f.record()).artifactVersions ?? []).toHaveLength(0);
    await panel.getByRole('button', { name: 'Refresh artifact review', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'Upload artifact version', exact: true }),
    ).toBeEnabled();
    let writes = 0;
    await page.route(`**/api/rooms/${f.room.id}/artifacts`, async (route) => {
      writes++;
      await route.fetch();
      await route.abort('failed');
    });
    await panel.getByRole('button', { name: 'Upload artifact version', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('may have been saved');
    await expect.poll(async () => (await f.record()).artifactVersions?.length).toBe(1);
    await expect(
      panel.getByRole('button', { name: 'Upload artifact version', exact: true }),
    ).toBeDisabled();
    await panel.getByRole('button', { name: 'Refresh artifact review', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'Refresh artifact review', exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole('button', { name: 'Upload artifact version', exact: true }),
    ).toBeDisabled();
    expect(writes).toBe(1);
    expect((await f.record()).artifactVersions).toHaveLength(1);
    await page.unroute(`**/api/rooms/${f.room.id}/artifacts`);
    await panel.getByLabel('Artifact file', { exact: true }).setInputFiles({
      name: 'draft.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Saved once λ🙂'),
    });
    await expect(
      panel.getByRole('button', { name: 'Upload artifact version', exact: true }),
    ).toBeEnabled();
    await panel.getByRole('button', { name: 'Cancel upload', exact: true }).click();
    expect((await f.record()).turnsUsed).toBe(0);
  } finally {
    await f.close();
  }
});

test('restart and archive keep originals read-only; whole-workspace deletion removes bytes and preserves another workspace', async ({
  page,
  artifactService,
}) => {
  const f = await fixture(page);
  try {
    const bytes = Buffer.from('Persisted exact original λ🙂\r\n');
    const version = await f.upload(bytes);
    const saved = await f.record();
    await artifactService.restart();
    await f.refreshHeaders();
    await page.reload();
    await page.locator('.room-item').filter({ hasText: f.room.title }).click();
    expect((await f.record()).artifactVersions).toEqual(saved.artifactVersions);
    const url = `/api/rooms/${f.room.id}/artifacts/${version.versionId}/original`;
    expect(await (await page.request.get(url, { headers: f.headers() })).body()).toEqual(bytes);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Archive workspace', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Archive workspace?', exact: true })
      .getByRole('button', { name: 'Archive workspace', exact: true })
      .click();
    await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
    const panel = await f.openPanel();
    await expect(panel.getByLabel('Artifact file', { exact: true })).toBeDisabled();
    await expect(panel).toContainText('read-only');
    const source = page.locator(`[data-version-id="${version.versionId}"]`);
    await source.locator(':scope > summary').click();
    await source.getByRole('button', { name: 'Preview version 1', exact: true }).click();
    await expect(source.getByRole('region')).toContainText('Persisted exact original');
    const otherResponse = await page.request.post('/api/rooms', {
      headers: f.headers(),
      data: { title: 'Retained other workspace' },
    });
    const other = (await otherResponse.json()) as Room;
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Delete workspace', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete workspace?', exact: true })
      .getByRole('button', { name: 'Delete workspace', exact: true })
      .click();
    await expect
      .poll(async () => (await page.request.get(url, { headers: f.headers() })).status())
      .toBe(404);
    expect((await page.request.get(`/api/rooms/${other.id}`, { headers: f.headers() })).ok()).toBe(
      true,
    );
    expect(f.calls).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test('thread deletion redacts message grants and frozen copies while workspace originals remain explicitly selectable', async ({
  page,
}) => {
  const f = await fixture(page, true);
  try {
    const version = await f.upload(Buffer.from('PRIVATE_ARTIFACT_GRANT λ🙂'));
    await page.locator('.artifact-choice > summary').click();
    await page
      .getByLabel(`Include artifact original.txt version 1 ${version.versionId}`, { exact: true })
      .check();
    await page.locator('.synthesis-option input').uncheck();
    const body = 'Delete this granting thread.';
    await page.getByLabel('Message', { exact: true }).fill(body);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect
      .poll(async () => (await f.record()).jobs.filter((job) => job.status === 'completed').length)
      .toBe(2);
    await page.getByLabel('Message', { exact: true }).fill('Retain a separate composer draft.');
    await page.getByRole('button', { name: `Delete thread ${body}`, exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete thread?', exact: true })
      .getByRole('button', { name: 'Delete thread', exact: true })
      .click();
    await expect.poll(async () => (await f.record()).messages.length).toBe(0);
    expect(JSON.stringify(await f.record())).not.toContain('PRIVATE_ARTIFACT_GRANT');
    expect((await f.record()).artifactVersions).toHaveLength(1);
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Retain a separate composer draft.',
    );
    await expect(
      page.getByLabel(`Include artifact original.txt version 1 ${version.versionId}`, {
        exact: true,
      }),
    ).toBeEnabled();
    const bytes = await (
      await page.request.get(`/api/rooms/${f.room.id}/artifacts/${version.versionId}/original`, {
        headers: f.headers(),
      })
    ).body();
    expect(bytes.toString()).toBe('PRIVATE_ARTIFACT_GRANT λ🙂');
    expect(f.calls).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test('opposite themes use exact colors, persist independently, and retain drafts and records through settings and toggles', async ({
  page,
}) => {
  const f = await fixture(page);
  try {
    const before = await f.record();
    await page.getByLabel('Message', { exact: true }).fill('Theme draft stays unchanged.');
    await chooseTheme(page, 'ghost-white');
    await palette(page, 'ghost-white');
    await expect(page.getByRole('button', { name: 'Toggle theme', exact: true })).toHaveText(
      'Blizzard Blue',
    );
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'blizzard-blue');
    await palette(page, 'blizzard-blue');
    await expect(page.getByRole('button', { name: 'Toggle theme', exact: true })).toHaveText(
      'Ghost White',
    );
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Theme draft stays unchanged.',
    );
    expect(await f.record()).toEqual(before);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'blizzard-blue');
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
    await palette(page, 'ghost-white');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ghost-white');
    expect(await f.record()).toEqual(before);
  } finally {
    await f.close();
  }
});

test('both opposite themes keep narrow artifact forms, selection and controls contained without changing original bytes', async ({
  page,
}) => {
  const f = await fixture(page);
  try {
    const version = await f.upload(
      Buffer.from('<svg onload="window.narrowInjected=true"> λ🙂'),
      'narrow-source.txt',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    for (const id of ['ghost-white', 'blizzard-blue'] as const) {
      await chooseTheme(page, id);
      await palette(page, id);
      await f.openPanel();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      const stop = await page.getByRole('button', { name: 'Stop', exact: true }).boundingBox();
      expect(stop).not.toBeNull();
      expect(stop!.x).toBeGreaterThanOrEqual(0);
      expect(stop!.x + stop!.width).toBeLessThanOrEqual(390);
      await page.getByLabel('Message', { exact: true }).fill('Narrow draft survives both themes.');
      expect((await f.record()).artifactVersions![0]!.sha256).toBe(version.sha256);
    }
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Narrow draft survives both themes.',
    );
    expect((await f.record()).turnsUsed).toBe(0);
  } finally {
    await f.close();
  }
});

test('invalid or denied theme storage falls back safely and a chosen opposite theme stays usable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      return key === 'aib-theme' ? 'unsupported-theme' : read.call(this, key);
    };
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'aib-theme') throw new DOMException('Fixture storage denied', 'SecurityError');
      write.call(this, key, value);
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const f = await fixture(page);
  try {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await chooseTheme(page, 'ghost-white');
    await palette(page, 'ghost-white');
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
    await palette(page, 'blizzard-blue');
    await expect(page.getByRole('alert')).toContainText('Browser storage is unavailable');
    expect(errors).toEqual([]);
    expect((await f.record()).turnsUsed).toBe(0);
  } finally {
    await f.close();
  }
});
