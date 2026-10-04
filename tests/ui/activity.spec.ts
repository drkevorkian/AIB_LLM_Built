import { randomUUID } from 'node:crypto';
import { test as baseTest, expect, type Page } from '@playwright/test';
import type { Room, RoomSummary } from '../../src/shared/contracts.js';
import { isolatedService } from './isolated-service.js';

// Queued work, slot occupancy, and reload selection must not depend on another file's rooms.
const test = baseTest.extend<{ queueService: Awaited<ReturnType<typeof isolatedService>> }>({
  queueService: async ({ browser }, use) => {
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
  context: async ({ browser, queueService }, use) => {
    const context = await browser.newContext({ baseURL: queueService.base });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});

async function createRoom(page: Page, participantCount = 3) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  const title = 'Queue inspection ' + randomUUID().slice(0, 8);
  await page.getByLabel('Workspace name').fill(title);
  await page.getByLabel('Shared objective').fill('PRIVATE OBJECTIVE');
  await page.getByLabel('Participant count').fill(String(participantCount));
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  const { token } = await (await page.request.get('/api/session')).json();
  const headers = { 'X-AIB-Token': token };
  const rooms: RoomSummary[] = await (await page.request.get('/api/rooms', { headers })).json();
  const id = rooms.find((room) => room.title === title)!.id;
  const record = async () =>
    (await (await page.request.get('/api/rooms/' + id, { headers })).json()) as Room;
  return { id, title, headers, record, room: await record() };
}
async function send(
  page: Page,
  f: Awaited<ReturnType<typeof createRoom>>,
  body: string,
  synthesis = false,
) {
  const response = await page.request.post(`/api/rooms/${f.id}/messages`, {
    headers: f.headers,
    data: {
      clientId: randomUUID(),
      body,
      type: 'question',
      recipientIds: [f.room.agents[1]!.id],
      synthesisAgentId: synthesis ? f.room.agents[0]!.id : null,
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { threadId: string };
}

test('paused queues expose durable order and prerequisites, navigate exact safe source threads, and survive reload', async ({
  page,
}) => {
  const f = await createRoom(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const first = await send(page, f, 'First held question', true);
  await send(page, f, 'Second held question');
  const unsafeTitle = '<img src=x onerror="window.queueInjected=true"> & source';
  expect(
    (
      await page.request.put(`/api/rooms/${f.id}/threads/${first.threadId}`, {
        headers: f.headers,
        data: { title: unsafeTitle },
      })
    ).ok(),
  ).toBe(true);
  await page.getByLabel('Message', { exact: true }).fill('Keep this draft while inspecting.');
  const b = page
    .locator('.agent-card')
    .filter({ has: page.getByRole('button', { name: 'Configure AI B', exact: true }) });
  await b.locator('.participant-queue > summary').click();
  await expect(b).toContainText('Queued generations (2)');
  const queued = b.locator('.queue-list > li');
  await expect(queued).toHaveCount(2);
  await expect(queued.nth(0)).toContainText('#1 · Answer');
  await expect(queued.nth(0)).toContainText('Workspace is paused');
  await expect(queued.nth(1)).toContainText('Earlier entry in this participant’s queue');
  await expect(queued.nth(0)).toContainText('simulated / simulation-v1');
  await expect(queued.nth(0)).toContainText('Response deadline');
  expect(await b.locator('img').count()).toBe(0);
  expect(await page.evaluate(() => 'queueInjected' in window)).toBe(false);
  const a = page
    .locator('.agent-card')
    .filter({ has: page.getByRole('button', { name: 'Configure AI A', exact: true }) });
  await a.locator('.participant-queue > summary').click();
  await expect(a).toContainText('Synthesis · Waiting for answers');
  await expect(a).toContainText('0 / 1 required completed answers · all');
  await expect(a).toContainText('AI B: queued');
  await expect(a).toContainText('This continuation has not been queued');
  const before = await f.record();
  await queued
    .nth(0)
    .getByRole('button', { name: 'Open thread: ' + unsafeTitle, exact: true })
    .click();
  await expect(page.locator('.message.question')).toHaveCount(1);
  await expect(page.locator('.message.question')).toContainText('First held question');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep this draft while inspecting.',
  );
  expect(await f.record()).toEqual(before);
  await page.reload();
  await expect(page.getByRole('heading', { name: f.title, exact: true, level: 1 })).toBeVisible();
  await b.locator('.participant-queue > summary').click();
  await expect(b).toContainText('Queued generations (2)');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.screenshot({ path: 'test-results/queue-inspection.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(b).toContainText('No queued generations.');
  await expect(b.locator('.queue-list > li')).toHaveCount(0);
  await a.locator('.participant-queue > summary').click();
  await expect(a).not.toContainText('Response prerequisites');
});

test('active requests hold participant queues and failed prerequisites clear only after an explicit retry', async ({
  page,
}) => {
  const f = await createRoom(page);
  const first = await send(page, f, '[simulate:slow] [simulate:fail] First attempt', true);
  await send(page, f, '[simulate:slow] Second attempt');
  const b = page
    .locator('.agent-card')
    .filter({ has: page.getByRole('button', { name: 'Configure AI B', exact: true }) });
  await b.locator('.participant-queue > summary').click();
  await expect(b).toContainText('Running · Answer');
  await expect(b).toContainText('Participant has an active request');
  const a = page
    .locator('.agent-card')
    .filter({ has: page.getByRole('button', { name: 'Configure AI A', exact: true }) });
  await a.locator('.participant-queue > summary').click();
  await expect(a).toContainText('Synthesis · Waiting for answers');
  await expect(a).toContainText('Synthesis · Unresolved responses', { timeout: 10000 });
  await expect(a).toContainText('AI B: failed');
  const current = await f.record();
  const job = current.jobs.find(
    (j) =>
      current.requests.find((r) => r.id === j.requestId)?.threadId === first.threadId &&
      j.status === 'failed',
  )!;
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(
    (
      await page.request.post(`/api/rooms/${f.id}/retry`, {
        headers: f.headers,
        data: { jobId: job.id },
      })
    ).ok(),
  ).toBe(true);
  await expect(a).toContainText('Synthesis · Waiting for answers');
  await expect(a).toContainText('AI B: queued');
  await expect(a).not.toContainText('Synthesis · Unresolved responses');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

test('failed inspection can recover and a delayed old-workspace snapshot cannot appear in a new workspace', async ({
  page,
}) => {
  const f = await createRoom(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await send(page, f, 'Old workspace queue');
  const b = page
    .locator('.agent-card')
    .filter({ has: page.getByRole('button', { name: 'Configure AI B', exact: true }) });
  await b.locator('.participant-queue > summary').click();
  await expect(b).toContainText('Queued generations (1)');
  const pattern = `**/api/rooms/${f.id}/activity`;
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"Fixture unavailable"}',
    }),
  );
  await b.getByRole('button', { name: 'Refresh queue details for AI B' }).click();
  await expect(b).toContainText('Queue details are unavailable');
  await expect(b.locator('.queue-thread')).toHaveCount(0);
  await page.unroute(pattern);
  await b.getByRole('button', { name: 'Refresh queue details for AI B' }).click();
  await expect(b).toContainText('Queued generations (1)');
  let entered = false;
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    entered = true;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await b.getByRole('button', { name: 'Refresh queue details for AI B' }).click();
    await expect.poll(() => entered).toBe(true);
    const next = await createRoom(page, 1);
    release();
    const a = page.locator('.agent-card');
    await expect(a).toHaveCount(1);
    await a.locator('.participant-queue > summary').click();
    await expect(a).toContainText('No queued generations.');
    await expect(a).not.toContainText('Old workspace queue');
    await expect(
      page.getByRole('heading', { name: next.title, exact: true, level: 1 }),
    ).toBeVisible();
  } finally {
    release();
    await page.unroute(pattern);
  }
});
