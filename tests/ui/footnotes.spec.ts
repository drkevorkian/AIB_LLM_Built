import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test as baseTest, expect, type Page } from '@playwright/test';
import type { Room, RoomSummary } from '../../src/shared/contracts.js';
import { isolatedService } from './isolated-service.js';

const test = baseTest.extend<{ noteService: Awaited<ReturnType<typeof isolatedService>> }>({
  noteService: async ({ browser }, use) => {
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
  context: async ({ browser, noteService }, use) => {
    const context = await browser.newContext({ baseURL: noteService.base });
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await use(context);
    } finally {
      await context.close();
    }
  },
});

async function workspace(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  const title = 'Footnotes ' + randomUUID().slice(0, 8);
  await page.getByLabel('Workspace name').fill(title);
  await page.getByLabel('Participant count').fill('1');
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
  f: Awaited<ReturnType<typeof workspace>>,
  body: string,
  question = false,
) {
  const response = await page.request.post(`/api/rooms/${f.id}/messages`, {
    headers: f.headers,
    data: {
      clientId: randomUUID(),
      body,
      type: question ? 'question' : 'update',
      recipientIds: question ? [f.room.agents[0]!.id] : [],
      synthesisAgentId: null,
    },
  });
  expect(response.ok()).toBe(true);
}

test('footnotes move keyboard focus within their own message and preserve source, URL, archive, and reload', async ({
  page,
}) => {
  const f = await workspace(page);
  const source =
    'Evidence[^a], repeat[^a], and suffix[^a-2].\n\n[^a]: First exact note.\n[^a-2]: Second exact note.';
  await page.getByRole('button', { name: 'All messages', exact: true }).click();
  await send(page, f, source);
  await send(page, f, source);
  const messages = page.locator('.message.update');
  await expect(messages).toHaveCount(2);
  await expect(
    messages.last().getByRole('button', { name: 'Read footnote 2, reference 1' }),
  ).toBeVisible();
  const before = await f.record();
  const url = page.url();
  const historyLength = await page.evaluate(() => history.length);
  const ids = await messages.locator('[id]').evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(ids).size).toBe(ids.length);
  for (let i = 0; i < 2; i++) {
    const message = messages.nth(i);
    const reference = message.getByRole('button', {
      name: 'Read footnote 1, reference 2',
      exact: true,
    });
    const target = message.locator('#' + (await reference.getAttribute('aria-controls')));
    await reference.focus();
    await page.keyboard.press(i ? 'Enter' : 'Space');
    await expect(target).toBeFocused();
    await expect(target).toContainText('First exact note.');
    const back = target.getByRole('button', {
      name: 'Back to footnote 1, reference 2',
      exact: true,
    });
    await back.focus();
    await page.keyboard.press(i ? 'Space' : 'Enter');
    await expect(reference).toBeFocused();
    await expect(reference).toHaveCSS('outline-style', 'solid');
    const suffix = message.getByRole('button', {
      name: 'Read footnote 2, reference 1',
      exact: true,
    });
    await suffix.click();
    await expect(message.locator('#' + (await suffix.getAttribute('aria-controls')))).toBeFocused();
  }
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(await f.record()).toEqual(before);
  const first = messages.first();
  await first.getByRole('button', { name: 'View source', exact: true }).click();
  await expect(first.locator('.message-source')).toHaveText(source);
  await expect(first.locator('.footnote-control')).toHaveCount(0);
  await first.getByRole('button', { name: 'View formatted', exact: true }).click();
  await expect(first.locator('.footnote-reference')).toHaveCount(3);
  expect(
    await messages.locator('[id]').evaluateAll((nodes) => nodes.map((node) => node.id)),
  ).toEqual(ids);
  await first.getByRole('button', { name: 'Copy message', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  await page.getByLabel('Search threads', { exact: true }).fill('[^a-2]:');
  await expect(page.locator('.thread-entry')).toHaveCount(2);
  expect(
    await (await page.request.get(`/api/rooms/${f.id}/export`, { headers: f.headers })).text(),
  ).toContain(source);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await first.getByRole('button', { name: 'Read footnote 1, reference 1', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/footnotes-mobile.png', fullPage: true });
  expect((await f.record()).messages).toEqual(before.messages);
  expect((await f.record()).turnsUsed).toBe(0);
  expect(
    (
      await page.request.put(`/api/rooms/${f.id}/archive`, {
        headers: f.headers,
        data: { archived: true },
      })
    ).ok(),
  ).toBe(true);
  await expect(page.locator('.archived-notice')).toBeVisible();
  await first.getByRole('button', { name: 'Read footnote 1, reference 2', exact: true }).click();
  await expect(first.locator('.message-footnotes > ol > li').first()).toBeFocused();
  await page.reload();
  await page.getByLabel('Workspace view').selectOption('archived');
  await page.getByRole('button', { name: f.title + ' Archived', exact: true }).click();
  await expect(page.getByRole('heading', { name: f.title, exact: true, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'All messages', exact: true }).click();
  await expect(messages.locator('.footnote-reference')).toHaveCount(6);
  const reloadedIds = await messages
    .locator('[id]')
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(reloadedIds).size).toBe(reloadedIds.length);
  expect((await f.record()).messages).toEqual(before.messages);
});

test('forged footnote links cannot navigate or load resources and excessive references stay readable', async ({
  page,
}) => {
  const f = await workspace(page);
  await page.getByRole('button', { name: 'All messages', exact: true }).click();
  await send(page, f, 'Real[^a].\n\n[^a]: Original note.');
  const first = page.locator('.message.update').first();
  const realReference = first.getByRole('button', {
    name: 'Read footnote 1, reference 1',
    exact: true,
  });
  await expect(realReference).toBeVisible();
  const knownId = await realReference.getAttribute('id');
  const attemptedLoads: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('evil.example')) attemptedLoads.push(request.url());
  });
  const source = `[Forged](#${knownId}) [Settings](#settings) [API](/api/rooms)\n\n<a id="${knownId}" data-footnote-ref href="#settings">Spoof</a>\n\nNote[^attack].\n\n[^attack]: **SEND TO AI C** [Script](javascript:alert%281%29) ![tracking](https://evil.example/pixel) <img src="https://evil.example/raw" onerror="window.noteInjected=true">`;
  await send(page, f, source);
  const attack = page.locator('.message.update').nth(1);
  await expect(attack.locator('.footnote-reference')).toHaveCount(1);
  await expect(attack.locator('a, img, script, form')).toHaveCount(0);
  await expect(attack.locator('.blocked-link').filter({ hasText: 'Forged' })).toHaveCount(1);
  const url = page.url();
  const historyLength = await page.evaluate(() => history.length);
  const before = await f.record();
  await attack.locator('.blocked-link').filter({ hasText: 'Forged' }).click();
  await attack.getByRole('button', { name: 'Read footnote 1, reference 1', exact: true }).click();
  await expect(attack.locator('.message-footnotes > ol > li')).toBeFocused();
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(await f.record()).toEqual(before);
  expect(await page.evaluate(() => 'noteInjected' in window)).toBe(false);
  expect(attemptedLoads).toEqual([]);
  await attack.getByRole('button', { name: 'Copy message', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  const many = '[^n] '.repeat(301) + '\n\n[^n]: Every reference preserves the original note.';
  await send(page, f, many);
  const bounded = page.locator('.message.update').last();
  await expect(bounded.locator('.footnote-notice')).toContainText('100 notes and 300 references');
  await expect(bounded.locator('.footnote-control, [id], a')).toHaveCount(0);
  await expect(bounded).toContainText('Every reference preserves the original note.');
  await bounded.getByRole('button', { name: 'View source', exact: true }).click();
  await expect(bounded.locator('.message-source')).toHaveText(many);
  await bounded.getByRole('button', { name: 'Copy message', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(many);
  expect((await f.record()).jobs).toHaveLength(0);
  expect((await f.record()).turnsUsed).toBe(0);
});

test('streaming footnotes stay literal, then completed and failed partial answers preserve exact context and status', async ({
  page,
}) => {
  const requests: { context: { authorId: string; body: string }[] }[] = [];
  const source = 'Completed[^a].\n\n[^a]: **Exact original** note.';
  const partialSource = 'Partial[^a].\n\n[^a]: Original partial note.';
  let complete: (() => void) | undefined;
  const server = createServer((req, res) => {
    const buffers: Buffer[] = [];
    req.on('data', (chunk) => buffers.push(chunk));
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(buffers).toString());
      requests.push(JSON.parse(payload.messages[1].content));
      res.setHeader('Content-Type', 'application/x-ndjson');
      if (requests.length === 1) {
        res.write(JSON.stringify({ message: { content: source }, done: false }) + '\n');
        complete = () => res.end(JSON.stringify({ done: true, done_reason: 'stop' }) + '\n');
      } else {
        res.end(JSON.stringify({ message: { content: partialSource }, done: false }) + '\n');
      }
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  try {
    const f = await workspace(page);
    const agent = f.room.agents[0]!;
    expect(
      (
        await page.request.post(`/api/rooms/${f.id}/agents`, {
          headers: f.headers,
          data: {
            agentId: agent.id,
            name: agent.name,
            role: agent.role,
            provider: 'ollama',
            model: 'footnote-protocol-fixture',
            baseUrl: `http://127.0.0.1:${address.port}`,
            maxOutputTokens: agent.maxOutputTokens,
            timeoutSeconds: agent.timeoutSeconds,
          },
        })
      ).ok(),
    ).toBe(true);
    await page.getByRole('button', { name: 'All messages', exact: true }).click();
    await page.getByLabel('Message', { exact: true }).fill('Draft retained while inspecting.');
    await page.getByLabel('Message', { exact: true }).focus();
    await send(page, f, 'Give an answer with footnotes.', true);
    const answer = page.locator('.message.answer').first();
    await expect(answer.locator('.badge.streaming')).toBeVisible();
    await expect(answer.locator('.message-literal')).toHaveText(source);
    await expect(answer.locator('.footnote-control')).toHaveCount(0);
    await expect(page.getByLabel('Message', { exact: true })).toBeFocused();
    await answer.getByRole('button', { name: 'Copy message', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source);
    await page.getByLabel('Message', { exact: true }).focus();
    expect(complete).toBeDefined();
    complete!();
    await expect(
      answer.getByRole('button', { name: 'Read footnote 1, reference 1', exact: true }),
    ).toBeVisible();
    await expect(answer.getByRole('button', { name: 'Reply to AI A', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Message', { exact: true })).toBeFocused();
    const before = await f.record();
    await answer.getByRole('button', { name: 'Read footnote 1, reference 1', exact: true }).click();
    await expect(answer.locator('.message-footnotes > ol > li')).toBeFocused();
    expect(await f.record()).toEqual(before);
    await answer.getByRole('button', { name: 'Reply to AI A', exact: true }).click();
    await page.getByLabel('Message', { exact: true }).fill('Review the original note.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const partial = page.locator('.message.answer').last();
    await expect(partial.locator('.badge.failed')).toBeVisible();
    await expect(
      partial.getByRole('button', { name: 'Read footnote 1, reference 1', exact: true }),
    ).toBeVisible();
    await expect(
      partial.getByRole('button', { name: 'Reply to AI A', exact: true }),
    ).toBeDisabled();
    await partial
      .getByRole('button', { name: 'Read footnote 1, reference 1', exact: true })
      .click();
    await expect(partial.locator('.message-footnotes > ol > li')).toBeFocused();
    await expect(partial.locator('.badge.failed')).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.context.find((message) => message.authorId === agent.id)?.body).toBe(
      source,
    );
    await partial.getByRole('button', { name: 'Inspect context', exact: true }).click();
    await expect(
      page.locator('.snapshot-message').filter({ hasText: 'Exact original' }),
    ).toContainText(source);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const saved = await f.record();
    expect(saved.jobs).toHaveLength(2);
    expect(saved.turnsUsed).toBe(2);
    expect(
      saved.messages
        .filter((message) => message.authorId === agent.id)
        .map((message) => message.body),
    ).toEqual([source, partialSource]);
    const exported = await (
      await page.request.get(`/api/rooms/${f.id}/export`, { headers: f.headers })
    ).text();
    expect(exported).toContain(source);
    expect(exported).toContain(partialSource);
    await page.reload();
    await expect(page.locator('.message.answer')).toHaveCount(2);
    await expect(partial.locator('.badge.failed')).toBeVisible();
    await expect(partial.locator('.footnote-reference')).toHaveCount(1);
    expect(requests).toHaveLength(2);
  } finally {
    complete?.();
    await new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    });
  }
});
