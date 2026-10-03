import { randomUUID } from 'node:crypto';
import { test as baseTest, expect, type Page } from '@playwright/test';
import type { Room } from '../../src/shared/contracts.js';
import { isolatedService } from './isolated-service.js';

const test = baseTest.extend<{ interjectionService: Awaited<ReturnType<typeof isolatedService>> }>({
  interjectionService: async ({ browser }, use) => {
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
  context: async ({ browser, interjectionService }, use) => {
    const context = await browser.newContext({ baseURL: interjectionService.base });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});
const body =
  'Human interjection λ🙂: retain disagreement. <img src=x onerror="window.interjectionInjected=true">';
const cards = (page: Page) => page.locator('.message.interjection');
async function fixture(page: Page) {
  await page.goto('/');
  let headers = {
    'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
  };
  const response = await page.request.post('/api/rooms', {
    headers,
    data: {
      title: 'Interjection ' + randomUUID().slice(0, 8),
      objective: 'Original task',
      maxConcurrentRequests: 1,
    },
  });
  expect(response.ok()).toBe(true);
  const room = (await response.json()) as Room;
  const record = async () =>
    (await (await page.request.get(`/api/rooms/${room.id}`, { headers })).json()) as Room;
  const select = async (view: Page) => {
    await view.getByLabel('Workspace view', { exact: true }).selectOption('all');
    await view.locator('.room-item').filter({ hasText: room.title }).click();
    await expect(
      view.getByRole('heading', { name: room.title, level: 1, exact: true }),
    ).toBeVisible();
    await view.getByRole('button', { name: /^All messages/ }).click();
  };
  const control = async (action: 'pause' | 'resume' | 'stop') => {
    expect(
      (
        await page.request.post(`/api/rooms/${room.id}/control`, { headers, data: { action } })
      ).ok(),
    ).toBe(true);
  };
  const refresh = async () => {
    headers = {
      'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
    };
  };
  await select(page);
  return { room, record, select, control, refresh, headers: () => headers };
}
async function compose(page: Page, text = body) {
  await page.getByLabel('Message type', { exact: true }).selectOption('interjection');
  await expect(page.getByRole('note', { name: 'Interjection policy explanation' })).toContainText(
    'Resume continues the original work',
  );
  await page.getByLabel('Message', { exact: true }).fill(text);
}

test('active-work recording pauses dispatch, preserves another view draft, and keeps original context readable', async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  const observer = await context.newPage();
  await observer.goto('/');
  await f.select(observer);
  await observer.getByLabel('Message', { exact: true }).fill('Keep the observer draft.');
  await compose(page);
  await page.getByLabel('Interjection priority', { exact: true }).selectOption('urgent');
  const sent = await page.request.post(`/api/rooms/${f.room.id}/messages`, {
    headers: f.headers(),
    data: {
      clientId: randomUUID(),
      type: 'question',
      body: '[simulate:slow] Original frozen request',
      recipientIds: [f.room.agents[0]!.id, f.room.agents[1]!.id],
    },
  });
  expect(sent.ok()).toBe(true);
  await expect.poll(async () => (await f.record()).jobs[0]?.status).toBe('running');
  const before = await f.record();
  await page.getByRole('button', { name: 'Record interjection', exact: true }).click();
  await expect.poll(async () => (await f.record()).status).toBe('paused');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(observer)).toHaveCount(1);
  await expect(cards(page).getByRole('note', { name: 'Human interjection record' })).toContainText(
    'Urgent priority',
  );
  await expect(observer.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep the observer draft.',
  );
  const recorded = await f.record();
  const note = recorded.messages.find((m) => m.type === 'interjection')!;
  expect(recorded.snapshots).toEqual(before.snapshots);
  expect(recorded.requests).toEqual(before.requests);
  expect(recorded.jobs).toHaveLength(2);
  expect(note.interjection?.queuedJobIds).toHaveLength(1);
  expect(note.interjection?.runningJobIds).toHaveLength(1);
  await cards(page).getByRole('button', { name: 'View source', exact: true }).click();
  expect(await cards(page).locator('.message-source').textContent()).toBe(body);
  await cards(page).getByRole('button', { name: 'Copy message', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(body);
  expect(await page.evaluate(() => 'interjectionInjected' in window)).toBe(false);
  await expect
    .poll(async () => (await f.record()).jobs[0]?.status, { timeout: 10000 })
    .toBe('completed');
  expect((await f.record()).jobs[1]?.status).toBe('queued');
  await page.getByRole('button', { name: /^All messages/ }).click();
  const answer = page.locator('.message.answer').first();
  await answer.getByRole('button', { name: 'Inspect context', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Original frozen request');
  await expect(dialog).not.toContainText(body);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(async () => (await f.record()).jobs[1]?.status).toBe('running');
  expect((await f.record()).snapshots.every((s) => !s.messages.some((m) => m.id === note.id))).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(observer.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep the observer draft.',
  );
});

test('a lost acknowledgement retains the draft, replay is safe after Resume, and record-only never creates work', async ({
  page,
}) => {
  const f = await fixture(page);
  await compose(page);
  await page.route('**/api/rooms/*/messages', async (route) => {
    await route.fetch();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Record interjection', exact: true }).click();
  await expect
    .poll(async () => (await f.record()).messages.filter((m) => m.type === 'interjection').length)
    .toBe(1);
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(body);
  await expect(
    page.getByRole('button', { name: 'Record interjection', exact: true }),
  ).toBeEnabled();
  await page.unroute('**/api/rooms/*/messages');
  await f.control('resume');
  await expect.poll(async () => (await f.record()).status).toBe('running');
  await page.getByRole('button', { name: 'Record interjection', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  expect((await f.record()).status).toBe('running');
  expect((await f.record()).events.filter((e) => e.type === 'human.interjected')).toHaveLength(1);
  await compose(page, 'Second human input');
  await page
    .getByLabel('Interjection dispatch policy', { exact: true })
    .selectOption('record_only');
  await page.getByLabel('Interjection priority', { exact: true }).selectOption('urgent');
  await page.getByRole('button', { name: 'Record interjection', exact: true }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(
    cards(page).last().getByRole('note', { name: 'Human interjection record' }),
  ).toContainText('Recorded without changing dispatch');
  const room = await f.record();
  expect(room.status).toBe('running');
  expect(room.jobs).toHaveLength(0);
  expect(room.requests).toHaveLength(0);
  expect(room.turnsUsed).toBe(0);
});

test('recorded controls remain readable in archived narrow themes and survive a real service restart', async ({
  page,
  interjectionService,
}) => {
  const f = await fixture(page);
  await compose(page, body + ' LongWord'.repeat(50));
  await page.getByRole('button', { name: 'Record interjection', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(cards(page)).toHaveCount(1);
  const before = await f.record();
  const exported = await page.request.get(`/api/rooms/${f.room.id}/export`, {
    headers: f.headers(),
  });
  expect(await exported.text()).toContain(
    'Human interjection: priority normal; dispatch policy pause',
  );
  expect(
    (
      await page.request.put(`/api/rooms/${f.room.id}/archive`, {
        headers: f.headers(),
        data: { archived: true },
      })
    ).ok(),
  ).toBe(true);
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
    await expect(
      cards(page).getByRole('note', { name: 'Human interjection record' }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await cards(page).getByRole('button', { name: 'Inspect context', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog').getByRole('note', { name: 'Human interjection record' }),
  ).toContainText('recording time');
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await interjectionService.restart();
  await f.refresh();
  await page.reload();
  await f.select(page);
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  expect((await f.record()).messages).toEqual(before.messages);
  expect((await f.record()).snapshots).toEqual(before.snapshots);
  expect((await f.record()).events.filter((e) => e.type === 'human.interjected')).toHaveLength(1);
});
