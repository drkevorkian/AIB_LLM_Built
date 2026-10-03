import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { test as baseTest, expect, type Page } from '@playwright/test';
import type { Room } from '../../src/shared/contracts.js';
import { isolatedService } from './isolated-service.js';

const test = baseTest.extend<{ collectionService: Awaited<ReturnType<typeof isolatedService>> }>({
  collectionService: async ({ browser }, use) => {
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
  context: async ({ browser, collectionService }, use) => {
    const context = await browser.newContext({ baseURL: collectionService.base });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});
async function fixture(page: Page) {
  const calls: {
    response: ServerResponse;
    user: {
      includedAnswers: { body: string }[];
      context: { body: string }[];
      collection?: { reason: string; incomplete: boolean };
      humanInstructions?: string;
    };
    system: string;
  }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      const index = calls.length;
      calls.push({
        response,
        user: JSON.parse(payload.messages[1].content),
        system: payload.messages[0].content,
      });
      response.setHeader('Content-Type', 'text/event-stream');
      response.write(
        `data: ${JSON.stringify({ id: 'fixture-' + index, choices: [{ delta: { content: index === 0 ? 'B: retain the design λ🙂.' : index === 1 ? 'C: replace the design. <img src=x onerror="window.collectionInjected=true">' : `SYNTHESIS ${index}: preserve both conflicting claims.` } }] })}\n\n`,
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address unavailable');
  await page.goto('/');
  const headers = {
    'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
  };
  const created = await page.request.post('/api/rooms', {
    headers,
    data: {
      title: 'Collection ' + randomUUID().slice(0, 8),
      objective: 'Original task',
      humanInstructions: 'Preserve disagreement λ🙂',
    },
  });
  expect(created.ok()).toBe(true);
  const room = (await created.json()) as Room;
  for (const agent of room.agents)
    expect(
      (
        await page.request.put(`/api/rooms/${room.id}/agents`, {
          headers,
          data: {
            agentId: agent.id,
            name: agent.name,
            role: agent.role,
            provider: 'openai-compatible',
            model: 'collection-fixture',
            baseUrl: `http://127.0.0.1:${address.port}`,
            maxOutputTokens: 4096,
            timeoutSeconds: 30,
          },
        })
      ).ok(),
    ).toBe(true);
  await page.reload();
  await page.locator('.room-item').filter({ hasText: room.title }).click();
  await expect(
    page.getByRole('heading', { name: room.title, exact: true, level: 1 }),
  ).toBeVisible();
  const record = async () =>
    (await (await page.request.get(`/api/rooms/${room.id}`, { headers })).json()) as Room;
  const release = (index: number) =>
    calls[index]!.response.end(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    );
  const compose = async (
    policy: 'all' | 'any' | 'quorum' | 'deadline',
    onTimeout: 'pause' | 'wait' | 'incomplete' = 'pause',
    remainingWork: 'continue' | 'cancel' = 'continue',
  ) => {
    await page.getByLabel('Response policy', { exact: true }).selectOption(policy);
    await page.getByLabel('Timeout outcome').selectOption(onTimeout);
    await page.getByLabel('Remaining recipient work').selectOption(remainingWork);
    await page.getByLabel('Response deadline in seconds').fill('5');
    await page.getByLabel('Message', { exact: true }).fill('Compare the designs.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => calls.length).toBe(2);
  };
  const close = async () => {
    for (const call of calls) call.response.end();
    server.closeAllConnections();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  };
  return { room, headers, calls, record, release, compose, close };
}
const sets = (page: Page) => page.getByLabel('Response set', { exact: true });
async function finish(page: Page, f: Awaited<ReturnType<typeof fixture>>, index: number) {
  f.release(index);
  await expect.poll(async () => (await f.record()).jobs[index]!.status).toBe('completed');
  await expect(
    page
      .locator('.message')
      .filter({ hasText: `SYNTHESIS ${index}:` })
      .locator('.badge.streaming'),
  ).toHaveCount(0);
}

test('deadline controls are keyboard accessible, retain drafts across views, fit both themes, and wait for their window', async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  try {
    await page.getByLabel('Response policy', { exact: true }).focus();
    await page.getByLabel('Response policy', { exact: true }).selectOption('deadline');
    await expect(page.getByLabel('Minimum completed answers')).toHaveValue('1');
    await page.getByLabel('Message', { exact: true }).fill('Draft kept across settings');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Draft kept across settings',
    );
    const observer = await context.newPage();
    await observer.goto('/');
    await observer.locator('.room-item').filter({ hasText: f.room.title }).click();
    await observer.getByLabel('Message', { exact: true }).fill('Observer draft');
    await page.setViewportSize({ width: 390, height: 844 });
    await f.compose('deadline');
    await finish(page, f, 0);
    await expect(sets(page).first()).toContainText('collecting');
    await expect.poll(() => f.calls.length).toBe(2);
    await expect.poll(() => f.calls.length, { timeout: 10000 }).toBe(3);
    expect(f.calls[2]!.user.collection?.reason).toBe('deadline');
    expect(f.calls[2]!.user.includedAnswers).toHaveLength(1);
    await finish(page, f, 2);
    await finish(page, f, 1);
    await expect(observer.getByLabel('Message', { exact: true })).toHaveValue('Observer draft');
    await expect(sets(page).first()).toContainText('AI C (running at closure)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.reload();
    await expect(sets(page).first()).toContainText('deadline');
  } finally {
    await f.close();
  }
});

test('incomplete timeout labels and exports missing outcomes without including partial answers or executing source', async ({
  page,
}) => {
  const f = await fixture(page);
  try {
    await f.compose('all', 'incomplete');
    await finish(page, f, 0);
    await expect.poll(() => f.calls.length, { timeout: 10000 }).toBe(3);
    const record = await f.record();
    expect(record.jobs[1]!.status).toBe('cancelled');
    expect(record.status).toBe('running');
    expect(f.calls[2]!.user.collection?.incomplete).toBe(true);
    expect(f.calls[2]!.user.includedAnswers).toHaveLength(1);
    expect(f.calls[2]!.user.context.some((message) => message.body.includes('C: replace'))).toBe(
      false,
    );
    await finish(page, f, 2);
    await expect(sets(page).first()).toContainText('Incomplete answer set');
    const synthesis = page.locator('.message.synthesis').first();
    await synthesis.getByRole('button', { name: 'Inspect context', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('note', { name: 'Frozen synthesis collection' })).toContainText(
      'AI C (cancelled at closure)',
    );
    await expect(dialog).toContainText('preserve conflicting claims');
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as { collectionInjected?: boolean }).collectionInjected,
      ),
    ).toBeUndefined();
    const exported = await page.request.get(`/api/rooms/${f.room.id}/export`, {
      headers: f.headers,
    });
    expect(await exported.text()).toContain('incomplete_timeout');
    expect(f.calls).toHaveLength(3);
  } finally {
    await f.close();
  }
});

test('explicit wait survives expiry, keeps paused dispatch held, and completes once after resume without retry', async ({
  page,
}) => {
  const f = await fixture(page);
  try {
    await f.compose('all', 'wait');
    expect(
      (
        await page.request.post(`/api/rooms/${f.room.id}/control`, {
          headers: f.headers,
          data: { action: 'pause' },
        })
      ).ok(),
    ).toBe(true);
    await expect(sets(page).first()).toContainText('Deadline passed', { timeout: 10000 });
    expect(f.calls).toHaveLength(2);
    await finish(page, f, 0);
    await finish(page, f, 1);
    await expect
      .poll(
        async () =>
          (await f.record()).jobs.filter(
            (job) => job.kind === 'synthesis' && job.status === 'queued',
          ).length,
      )
      .toBe(1);
    expect(f.calls).toHaveLength(2);
    await page.reload();
    await expect(sets(page).first()).toContainText('2 / 2 received');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect.poll(() => f.calls.length).toBe(3);
    await finish(page, f, 2);
    expect(f.calls).toHaveLength(3);
  } finally {
    await f.close();
  }
});

test('remaining-work cancellation after any closure preserves the partial message and cannot start a late synthesis revision', async ({
  page,
}) => {
  const f = await fixture(page);
  try {
    await f.compose('any', 'pause', 'cancel');
    await finish(page, f, 0);
    await expect.poll(() => f.calls.length).toBe(3);
    await finish(page, f, 2);
    expect((await f.record()).jobs[1]!.status).toBe('cancelled');
    await expect(page.locator('.message.answer').filter({ hasText: 'C: replace' })).toContainText(
      'cancelled',
    );
    await expect(page.getByRole('button', { name: 'Request updated synthesis' })).toHaveCount(0);
    await expect(sets(page).first()).toContainText('cancelled after closure');
  } finally {
    await f.close();
  }
});

test('late answers allow one reviewed synthesis revision; lost acknowledgement requires refresh and preserves drafts and original output', async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  try {
    await f.compose('any');
    await finish(page, f, 0);
    await expect.poll(() => f.calls.length).toBe(3);
    await finish(page, f, 2);
    const before = await f.record();
    await finish(page, f, 1);
    const observer = await context.newPage();
    await observer.goto('/');
    await observer.locator('.room-item').filter({ hasText: f.room.title }).click();
    await observer.getByLabel('Message', { exact: true }).fill('Keep this draft');
    await page.getByLabel('Message', { exact: true }).fill('Local draft');
    await page.route('**/api/rooms/*/updated-synthesis', async (route) => {
      await route.fetch();
      await route.abort('failed');
    });
    await page.getByRole('button', { name: 'Request updated synthesis', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('may have completed');
    await expect(
      page.getByRole('button', { name: 'Request updated synthesis', exact: true }).first(),
    ).toBeDisabled();
    await expect.poll(() => f.calls.length).toBe(4);
    await finish(page, f, 3);
    await page.getByRole('button', { name: 'Refresh response sets', exact: true }).click();
    await page.unroute('**/api/rooms/*/updated-synthesis');
    const after = await f.record();
    expect(after.requests[0]).toEqual(before.requests[0]);
    expect(after.messages.find((message) => message.id === before.jobs[2]!.messageId)).toEqual(
      before.messages.find((message) => message.id === before.jobs[2]!.messageId),
    );
    expect(f.calls[3]!.user.includedAnswers).toHaveLength(2);
    expect(f.calls[3]!.user.collection?.reason).toBe('updated_synthesis');
    expect(f.calls[3]!.user.humanInstructions).toBe('Preserve disagreement λ🙂');
    await expect(page.locator('.message.synthesis')).toHaveCount(2);
    await expect(sets(page)).toHaveCount(2);
    await expect(sets(page).last()).toContainText('Separate synthesis');
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Local draft');
    await expect(observer.getByLabel('Message', { exact: true })).toHaveValue('Keep this draft');
    await page.reload();
    await expect(page.locator('.message.synthesis')).toHaveCount(2);
    expect(f.calls).toHaveLength(4);
  } finally {
    await f.close();
  }
});
