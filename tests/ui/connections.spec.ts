import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Room, RoomSummary } from '../../src/shared/contracts.js';

async function createRoom(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  const title = 'Coordinator check ' + randomUUID().slice(0, 8);
  await page.getByLabel('Workspace name').fill(title);
  await page.getByLabel('Shared objective').fill('PRIVATE OBJECTIVE');
  await page.getByLabel('Participant count').fill('1');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  const { token } = await (await page.request.get('/api/session')).json();
  const headers = { 'X-AIB-Token': token };
  const rooms: RoomSummary[] = await (await page.request.get('/api/rooms', { headers })).json();
  const id = rooms.find((r) => r.title === title)!.id;
  return async () =>
    (await (await page.request.get('/api/rooms/' + id, { headers })).json()) as Room;
}

test('simulation coordinator checks are labeled, preserve state, require saved settings, and fit narrow screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const record = await createRoom(page);
  const before = await record();
  await page.getByRole('button', { name: 'Configure AI A', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Configure AI A', exact: true });
  const check = dialog.getByRole('button', { name: 'Test coordinator', exact: true });
  await expect(check).toBeEnabled();
  await check.click();
  await expect(dialog.getByRole('status')).toContainText(
    'Simulated coordinator check passed: simulated / simulation-v1',
  );
  await expect(dialog.getByRole('status')).toContainText('configuration 0');
  expect(await record()).toEqual(before);
  await expect(dialog).toContainText('may incur provider charges');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await dialog.getByLabel('Model ID', { exact: true }).fill('changed-simulation');
  await expect(check).toBeDisabled();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Settings saved');
  await check.click();
  await expect(dialog.getByRole('status')).toContainText('changed-simulation · configuration 1');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Configure AI A', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveCount(0);
});

test('a greeting can pass while the coordinator check fails; a new explicit structured probe can pass without conversation work', async ({
  page,
}) => {
  let pass = false;
  const calls: {
    structured: boolean;
    context: { objective: string; context: unknown[]; discussion?: { allowedPeerIds: string[] } };
    items?: { type: string; enum?: string[] };
  }[] = [];
  const server = createServer((req, res) => {
    const buffers: Buffer[] = [];
    req.on('data', (chunk) => buffers.push(chunk));
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(buffers).toString());
      const context = JSON.parse(payload.messages[1].content);
      const structured = Boolean(payload.format);
      calls.push({ structured, context, items: payload.format?.properties.recipientIds.items });
      const content = structured
        ? JSON.stringify({
            kind: pass ? 'finish' : 'ask',
            body: pass ? 'Fixture ready.' : 'PRIVATE ACTION BODY',
            recipientIds: [],
            policy: 'all',
            quorum: 1,
            replyTo: null,
          })
        : 'FIXTURE GREETING';
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.end(JSON.stringify({ message: { content }, done: true, done_reason: 'stop' }) + '\n');
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address.');
  try {
    const record = await createRoom(page);
    await page.getByRole('button', { name: 'Configure AI A', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Configure AI A', exact: true });
    await dialog.getByLabel('Provider', { exact: true }).selectOption('ollama');
    await dialog.getByLabel('Server URL').fill('http://127.0.0.1:' + address.port);
    await dialog.getByLabel('Model ID', { exact: true }).fill('coordinator-fixture');
    const check = dialog.getByRole('button', { name: 'Test coordinator', exact: true });
    await expect(check).toBeDisabled();
    await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Settings saved');
    const before = await record();
    await dialog.getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText(
      'Connection succeeded: FIXTURE GREETING',
    );
    await check.click();
    await expect(dialog.getByRole('alert')).toContainText('valid finish action');
    await expect(dialog).not.toContainText('PRIVATE ACTION BODY');
    expect(calls).toHaveLength(2);
    expect(await record()).toEqual(before);
    pass = true;
    await check.click();
    await expect(dialog.getByRole('status')).toContainText(
      'Coordinator check passed: ollama / coordinator-fixture · configuration 1',
    );
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.structured)).toEqual([false, true, true]);
    for (const call of calls) {
      expect(call.context.objective).toBe('');
      expect(call.context.context).toEqual([]);
      if (call.structured) {
        expect(call.items).toEqual({ type: 'string' });
        expect(call.context.discussion!.allowedPeerIds).toEqual([]);
      }
    }
    expect(await record()).toEqual(before);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
