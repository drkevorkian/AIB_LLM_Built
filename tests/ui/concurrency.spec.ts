import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { test as baseTest, expect, type Page } from '@playwright/test';
import type { AppSettings, Room } from '../../src/shared/contracts.js';
import { isolatedService } from './isolated-service.js';

const test = baseTest.extend<{ capacityService: Awaited<ReturnType<typeof isolatedService>> }>({
  capacityService: async ({ browser }, use) => {
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
  context: async ({ browser, capacityService }, use) => {
    const context = await browser.newContext({ baseURL: capacityService.base });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});

async function fixture(page: Page, maxConcurrentRequests = 4) {
  await page.goto('/');
  const headers = {
    'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
  };
  const response = await page.request.post('/api/rooms', {
    headers,
    data: {
      title: 'Capacity ' + randomUUID().slice(0, 8),
      participantCount: 3,
      maxConcurrentRequests,
    },
  });
  expect(response.ok()).toBe(true);
  const room = (await response.json()) as Room;
  const record = async () =>
    (await (await page.request.get(`/api/rooms/${room.id}`, { headers })).json()) as Room;
  const settings = async () =>
    (await (await page.request.get('/api/settings', { headers })).json()) as AppSettings;
  const select = async (view: Page) => {
    await view.locator('.room-item').filter({ hasText: room.title }).click();
    await expect(
      view.getByRole('heading', { name: room.title, exact: true, level: 1 }),
    ).toBeVisible();
  };
  const send = async (recipientIds: string[]) => {
    const result = await page.request.post(`/api/rooms/${room.id}/messages`, {
      headers,
      data: {
        clientId: randomUUID(),
        body: 'Controlled local capacity fixture.',
        type: 'question',
        recipientIds,
      },
    });
    expect(result.ok()).toBe(true);
  };
  await select(page);
  return { room, headers, record, settings, select, send };
}
async function settingsPage(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true, level: 1 }),
  ).toBeVisible();
}
const card = (page: Page, name: string) =>
  page
    .locator('.agent-card')
    .filter({ has: page.getByRole('button', { name: 'Configure ' + name, exact: true }) });

/** Synthetic loopback NDJSON; requests remain open until explicitly released. No model runs. */
async function heldProvider(page: Page, f: Awaited<ReturnType<typeof fixture>>) {
  const responses: ServerResponse[] = [];
  const server = createServer((req, res) => {
    req.resume();
    if (req.url !== '/api/chat' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    responses.push(res);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(
      JSON.stringify({
        message: { role: 'assistant', content: 'Held synthetic answer.' },
        done: false,
      }) + '\n',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable');
  try {
    for (const agent of f.room.agents) {
      const result = await page.request.post(`/api/rooms/${f.room.id}/agents`, {
        headers: f.headers,
        data: {
          agentId: agent.id,
          name: agent.name,
          role: agent.role,
          provider: 'ollama',
          model: 'capacity-fixture',
          baseUrl: `http://127.0.0.1:${address.port}`,
        },
      });
      expect(result.ok()).toBe(true);
    }
  } catch (error) {
    server.closeAllConnections();
    server.close();
    throw error;
  }
  return {
    responses,
    finish: (index: number) =>
      responses[index]!.end(JSON.stringify({ done: true, done_reason: 'stop' }) + '\n'),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

test('provider/workspace settings validate bounds, preserve defaults and drafts, and persist across restart in narrow themes', async ({
  page,
  capacityService,
}) => {
  const f = await fixture(page);
  await page.getByLabel('Message', { exact: true }).fill('Keep the capacity settings draft.');
  await settingsPage(page);
  await page.getByLabel('Simulation request limit', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Save provider limits', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Provider request limits saved.');
  await page.getByLabel('Workspace request limit', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Save workspace', exact: true }).click();
  await expect.poll(async () => (await f.record()).maxConcurrentRequests).toBe(2);
  await page.getByLabel('Default workspace turn limit', { exact: true }).fill('45');
  const latest = await f.settings();
  expect(
    (
      await page.request.put('/api/settings/provider-limits', {
        headers: f.headers,
        data: { ...latest.providerConcurrency, simulated: 2, ollama: 1 },
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole('button', { name: 'Save defaults', exact: true }).click();
  await expect.poll(async () => (await f.settings()).defaultMaxTurns).toBe(45);
  expect((await f.settings()).providerConcurrency.ollama).toBe(1);
  await page.getByRole('button', { name: 'Restore defaults', exact: true }).click();
  await page.getByRole('button', { name: 'Save defaults', exact: true }).click();
  await expect.poll(async () => (await f.settings()).defaultMaxTurns).toBe(100);
  expect((await f.settings()).providerConcurrency.simulated).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep the capacity settings draft.',
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await capacityService.restart();
  await page.reload();
  await f.select(page);
  await settingsPage(page);
  await expect(page.getByLabel('Simulation request limit', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('Ollama request limit', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Workspace request limit', { exact: true })).toHaveValue('2');
});

test('workspace quota explains queue holds and blocks settings edits while work is pending', async ({
  page,
}) => {
  const f = await fixture(page, 1);
  const provider = await heldProvider(page, f);
  try {
    await f.send(f.room.agents.map((agent) => agent.id));
    await expect.poll(() => provider.responses.length).toBe(1);
    const b = card(page, 'AI B');
    await b.locator('.participant-queue > summary').click();
    await expect(b).toContainText('Workspace request limit is full');
    await expect(b).toContainText('1 / 1 workspace slots occupied');
    await expect(b).toContainText('1 / 4 provider slots occupied');
    expect((await f.record()).turnsUsed).toBe(1);
    await page.getByLabel('Message', { exact: true }).fill('Held queue draft.');
    await settingsPage(page);
    await page.getByLabel('Workspace request limit', { exact: true }).fill('3');
    await expect(page.getByRole('button', { name: 'Save workspace', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Held queue draft.');
    provider.finish(0);
    await expect.poll(() => provider.responses.length).toBe(2);
    await expect(card(page, 'AI B')).toContainText('Running · Answer');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect
      .poll(async () =>
        (await f.record()).jobs.every((job) => !['queued', 'running'].includes(job.status)),
      )
      .toBe(true);
    expect((await f.record()).turnsUsed).toBe(2);
  } finally {
    await provider.close();
  }
});

test('provider quota includes another workspace probe and follows capacity edits from another view', async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  const provider = await heldProvider(page, f);
  const other = await page.request.post('/api/rooms', {
    headers: f.headers,
    data: { title: 'Probe source' },
  });
  const probeRoom = (await other.json()) as Room;
  const binding = (await f.record()).agents[0]!;
  expect(
    (
      await page.request.post(`/api/rooms/${probeRoom.id}/agents`, {
        headers: f.headers,
        data: {
          agentId: probeRoom.agents[0]!.id,
          name: 'Probe fixture',
          role: 'Greeting only',
          provider: binding.provider,
          model: binding.model,
          baseUrl: binding.baseUrl,
        },
      })
    ).ok(),
  ).toBe(true);
  const settings = await f.settings();
  expect(
    (
      await page.request.put('/api/settings/provider-limits', {
        headers: f.headers,
        data: { ...settings.providerConcurrency, ollama: 1 },
      })
    ).ok(),
  ).toBe(true);
  const check = page.request.post(`/api/rooms/${probeRoom.id}/connection-test`, {
    headers: f.headers,
    data: { agentId: probeRoom.agents[0]!.id, kind: 'greeting' },
  });
  try {
    await expect.poll(() => provider.responses.length).toBe(1);
    await f.send([f.room.agents[1]!.id, f.room.agents[2]!.id]);
    const b = card(page, 'AI B');
    await b.locator('.participant-queue > summary').click();
    await expect(b).toContainText('Provider request limit is full');
    await expect(b).toContainText('0 / 4 workspace slots occupied');
    await expect(b).toContainText('1 / 1 provider slots occupied');
    await expect(b).not.toContainText('Probe source');
    const view = await context.newPage();
    await view.goto('/');
    await f.select(view);
    await settingsPage(view);
    await view.getByLabel('Ollama request limit', { exact: true }).fill('2');
    await view.getByRole('button', { name: 'Save provider limits', exact: true }).click();
    await expect.poll(() => provider.responses.length).toBe(2);
    await expect(b).toContainText('Running · Answer');
    const c = card(page, 'AI C');
    await c.locator('.participant-queue > summary').click();
    await expect(c).toContainText('Provider request limit is full');
    await expect(c).toContainText('2 / 2 provider slots occupied');
    provider.finish(0);
    expect((await check).ok()).toBe(true);
    await expect.poll(() => provider.responses.length).toBe(3);
    await expect(c).toContainText('Running · Answer');
    const retained = (await (
      await page.request.get(`/api/rooms/${probeRoom.id}`, { headers: f.headers })
    ).json()) as Room;
    expect(retained.turnsUsed).toBe(0);
    expect(retained.messages).toHaveLength(0);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await view.close();
  } finally {
    await provider.close();
    await check.catch(() => undefined);
  }
});

test('native bounds and failed provider saves retain the form and policy until an explicit successful save', async ({
  page,
}) => {
  const f = await fixture(page);
  await settingsPage(page);
  const input = page.getByLabel('Simulation request limit', { exact: true });
  const button = page.getByRole('button', { name: 'Save provider limits', exact: true });
  await input.fill('0');
  await expect(input).toHaveValue('0');
  await expect(button).toBeEnabled();
  expect(await input.evaluate((node: HTMLInputElement) => node.validity.valid)).toBe(false);
  await button.click();
  await expect(input).toHaveValue('0');
  expect(await input.evaluate((node: HTMLInputElement) => node.validity.valid)).toBe(false);
  expect((await f.settings()).providerConcurrency.simulated).toBe(4);
  await input.fill('1');
  await page.route('**/api/settings/provider-limits', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Fixture write unavailable.' }),
    }),
  );
  await button.click();
  await expect(page.getByRole('alert')).toContainText('Fixture write unavailable.');
  await expect(input).toHaveValue('1');
  expect((await f.settings()).providerConcurrency.simulated).toBe(4);
  await page.unroute('**/api/settings/provider-limits');
  await button.click();
  await expect(page.getByRole('status')).toContainText('Provider request limits saved.');
  expect((await f.settings()).providerConcurrency.simulated).toBe(1);
});
