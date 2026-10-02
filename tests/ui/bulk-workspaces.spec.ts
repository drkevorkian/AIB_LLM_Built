import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test as baseTest, expect, type Page, type Locator } from '@playwright/test';
import type { Room, RoomSummary } from '../../src/shared/contracts.js';
import { isolatedService } from './isolated-service.js';

const test = baseTest.extend<{ bulkService: Awaited<ReturnType<typeof isolatedService>> }>({
  bulkService: async ({ browser }, use) => {
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
  context: async ({ browser, bulkService }, use) => {
    const context = await browser.newContext({ baseURL: bulkService.base });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});
async function fixture(page: Page) {
  await page.goto('/');
  let headers = {
    'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
  };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { headers, data });
    expect(response.ok()).toBe(true);
    return response;
  };
  const group = 'Batch ' + randomUUID().slice(0, 8);
  const title = group + ' [a+b] <img onerror=alert(1)>';
  const create = async (name: string) =>
    (await (await post('/api/rooms', { title: name, participantCount: 1 })).json()) as Room;
  const rooms = [await create(title), await create(title)];
  const outside = await create('Keep ' + group);
  const all = async () =>
    (await (await page.request.get('/api/rooms', { headers })).json()) as RoomSummary[];
  const record = async (id: string) =>
    (await (await page.request.get('/api/rooms/' + id, { headers })).json()) as Room;
  const send = async (room: Room, body: string, question = false) =>
    post('/api/rooms/' + room.id + '/messages', {
      clientId: randomUUID(),
      body,
      type: question ? 'question' : 'update',
      recipientIds: question ? [room.agents[0]!.id] : [],
      synthesisAgentId: null,
    });
  await page.locator('.room-item').filter({ hasText: outside.title }).click();
  await expect(
    page.getByRole('heading', { name: outside.title, exact: true, level: 1 }),
  ).toBeVisible();
  return {
    group,
    rooms,
    outside,
    post,
    send,
    all,
    record,
    headers: () => headers,
    reauthenticate: async () => {
      headers = {
        'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
      };
    },
  };
}
async function manager(page: Page) {
  await page.getByRole('button', { name: 'Manage workspaces', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage workspaces', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
const choice = (dialog: Locator, room: Pick<Room, 'id' | 'title'>) =>
  dialog.getByRole('checkbox', {
    name: `Select workspace ${room.title} (${room.id})`,
    exact: true,
  });
async function pick(dialog: Locator, rooms: Pick<Room, 'id' | 'title'>[], action: string) {
  for (const room of rooms) await choice(dialog, room).check();
  await dialog.getByLabel('Bulk action', { exact: true }).selectOption(action);
  await dialog.getByRole('button', { name: 'Preview selected workspaces', exact: true }).click();
  await expect(dialog.locator('.bulk-preview li')).toHaveCount(rooms.length);
}

test('bulk archive and restore use exact identities, clear filtered selections, preserve drafts and history, support keyboard cancellation, and persist across restart', async ({
  page,
  bulkService,
}) => {
  const f = await fixture(page);
  for (const room of f.rooms)
    await f.send(room, 'Original code\n\n```js\nconst value = "<img>";\n```');
  await page
    .getByLabel('Message', { exact: true })
    .fill('Retain this draft during batch operations.');
  const before = await Promise.all(f.rooms.map((r) => f.record(r.id)));
  let d = await manager(page);
  await d.getByLabel('Search managed workspaces', { exact: true }).fill('[a+b]');
  await choice(d, f.rooms[0]!).focus();
  await page.keyboard.press('Space');
  await expect(choice(d, f.rooms[0]!)).toBeChecked();
  await d.getByLabel('Managed workspace view', { exact: true }).selectOption('active');
  await expect(choice(d, f.rooms[0]!)).not.toBeChecked();
  const cancelResponse = page.waitForResponse((r) =>
    r.url().endsWith('/api/workspaces/bulk/preview-cancel'),
  );
  await pick(d, f.rooms, 'archive');
  await expect(d.locator('.bulk-preview li').first()).toContainText('1 threads · 1 messages');
  await expect(d.locator('img,script')).toHaveCount(0);
  await expect(d.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await cancelResponse;
  await expect(d).toHaveCount(0);
  expect(await Promise.all(f.rooms.map((r) => f.record(r.id)))).toEqual(before);
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Retain this draft during batch operations.',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  d = await manager(page);
  await pick(d, f.rooms, 'archive');
  expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/bulk-workspaces-mobile.png', fullPage: true });
  await d.getByRole('button', { name: 'Archive selected workspaces', exact: true }).click();
  await expect(d).toHaveCount(0);
  for (let i = 0; i < f.rooms.length; i++) {
    const archived = await f.record(f.rooms[i]!.id);
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.status).toBe('paused');
    expect(archived.messages).toEqual(before[i]!.messages);
    expect(archived.turnsUsed).toBe(0);
  }
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Retain this draft during batch operations.',
  );
  d = await manager(page);
  await d.getByLabel('Managed workspace view', { exact: true }).selectOption('archived');
  await pick(d, f.rooms, 'restore');
  await d.getByRole('button', { name: 'Restore selected workspaces', exact: true }).click();
  await expect(d).toHaveCount(0);
  const restored = await Promise.all(f.rooms.map((r) => f.record(r.id)));
  expect(restored.every((r) => !r.archivedAt && r.status === 'paused' && r.jobs.length === 0)).toBe(
    true,
  );
  expect((await f.record(f.outside.id)).status).toBe('running');
  await bulkService.restart();
  await f.reauthenticate();
  expect(await Promise.all(f.rooms.map((r) => f.record(r.id)))).toEqual(restored);
  await page.reload();
  await expect(page.locator('.room-item')).toHaveCount(4);
});

test('stale bulk previews cannot delete changed workspaces and one pending target blocks the full archive until a new review', async ({
  page,
}) => {
  const f = await fixture(page);
  const d = await manager(page);
  await pick(d, f.rooms, 'delete');
  await f.send(f.rooms[1]!, 'Evidence added in another view after preview.');
  const before = await Promise.all(f.rooms.map((r) => f.record(r.id)));
  await d.getByRole('button', { name: 'Delete selected workspaces', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('changed. Preview');
  expect(await Promise.all(f.rooms.map((r) => f.record(r.id)))).toEqual(before);
  await f.post('/api/rooms/' + f.rooms[1]!.id + '/control', { action: 'pause' });
  await f.send(f.rooms[1]!, 'Queued while paused.', true);
  await d.getByLabel('Bulk action', { exact: true }).selectOption('archive');
  await d.getByRole('button', { name: 'Preview selected workspaces', exact: true }).click();
  await expect(
    d.getByRole('button', { name: 'Archive selected workspaces', exact: true }),
  ).toBeDisabled();
  await expect(d.locator('.bulk-preview li').last()).toContainText('Finish or stop pending work');
  expect((await f.record(f.rooms[0]!.id)).archivedAt).toBeNull();
  await f.post('/api/rooms/' + f.rooms[1]!.id + '/control', { action: 'stop' });
  await d.getByRole('button', { name: 'Back to selection', exact: true }).click();
  await d.getByRole('button', { name: 'Preview selected workspaces', exact: true }).click();
  await d.getByRole('button', { name: 'Archive selected workspaces', exact: true }).click();
  await expect(d).toHaveCount(0);
  expect((await f.record(f.rooms[1]!.id)).turnsUsed).toBe(0);
  expect((await f.record(f.rooms[1]!.id)).jobs[0]!.status).toBe('cancelled');
});

test('bulk deletion aborts a real fixture stream, reconciles another view, preserves unselected drafts, and keeps final deletion empty after restart', async ({
  page,
  context,
  bulkService,
}) => {
  let calls = 0;
  let disconnected = false;
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls++;
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(
        JSON.stringify({
          message: { content: 'Held bulk-deletion fixture answer.' },
          done: false,
        }) + '\n',
      );
      res.on('close', () => {
        disconnected = true;
      });
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const other = await context.newPage();
  try {
    const f = await fixture(page);
    const first = f.rooms[0]!;
    const agent = first.agents[0]!;
    await f.post('/api/rooms/' + first.id + '/agents', {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      provider: 'ollama',
      model: 'bulk-deletion-protocol-fixture',
      baseUrl: `http://127.0.0.1:${address.port}`,
    });
    await f.post('/api/rooms/' + f.rooms[1]!.id + '/control', { action: 'pause' });
    await f.send(f.rooms[1]!, 'Keep queued until deletion.', true);
    await f.send(first, 'Start the held stream.', true);
    await expect
      .poll(async () => (await f.record(first.id)).messages.at(-1)?.body)
      .toBe('Held bulk-deletion fixture answer.');
    await page.getByLabel('Message', { exact: true }).fill('Unselected draft remains.');
    const outside = await f.record(f.outside.id);
    await other.goto('/');
    await other.locator('.room-item').filter({ hasText: first.title }).first().click();
    await expect(
      other.getByRole('heading', { name: first.title, exact: true, level: 1 }),
    ).toBeVisible();
    let d = await manager(page);
    await pick(d, f.rooms, 'delete');
    await expect(d).toContainText('1 running jobs');
    await expect(d).toContainText('1 queued jobs');
    await d.getByRole('button', { name: 'Delete selected workspaces', exact: true }).click();
    await expect(d).toHaveCount(0);
    await expect.poll(() => disconnected).toBe(true);
    expect(calls).toBe(1);
    expect(await f.record(f.outside.id)).toEqual(outside);
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Unselected draft remains.',
    );
    await expect(
      other.getByRole('heading', { name: first.title, exact: true, level: 1 }),
    ).toHaveCount(0);
    await expect
      .poll(async () => (await f.all()).some((r) => f.rooms.some((target) => target.id === r.id)))
      .toBe(false);
    const remaining = await f.all();
    d = await manager(page);
    await pick(d, remaining, 'delete');
    await d.getByRole('button', { name: 'Delete selected workspaces', exact: true }).click();
    await expect(d).toHaveCount(0);
    await expect(page.getByText('No workspaces yet.', { exact: true })).toBeVisible();
    await other.close();
    await bulkService.restart();
    await f.reauthenticate();
    await page.reload();
    expect(await f.all()).toEqual([]);
    await expect(page.getByText('No workspaces yet.', { exact: true })).toBeVisible();
    expect(calls).toBe(1);
  } finally {
    if (!other.isClosed()) await other.close();
    await new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    });
  }
});

test('a lost bulk confirmation response requires inspection and never automatically repeats the operation', async ({
  page,
}) => {
  const f = await fixture(page);
  let confirmations = 0;
  await page.route('**/api/workspaces/bulk/confirm', async (route) => {
    confirmations++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('failed');
  });
  const d = await manager(page);
  await pick(d, f.rooms, 'archive');
  await d.getByRole('button', { name: 'Archive selected workspaces', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('operation may have completed');
  await expect(
    d.getByRole('button', { name: 'Preview selected workspaces', exact: true }),
  ).toBeDisabled();
  expect(confirmations).toBe(1);
  expect(
    (await Promise.all(f.rooms.map((r) => f.record(r.id)))).every(
      (r) => r.archivedAt && r.status === 'paused',
    ),
  ).toBe(true);
  await d.getByRole('button', { name: 'Close and refresh workspaces', exact: true }).click();
  await expect(d).toHaveCount(0);
  await expect(page.locator('.room-item')).toHaveCount(2);
  expect(confirmations).toBe(1);
});
