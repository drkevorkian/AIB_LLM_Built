import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test as baseTest, expect, type Page } from '@playwright/test';
import type { Room, RoomSummary } from '../../src/shared/contracts.js';
import { isolatedService } from './isolated-service.js';

const test = baseTest.extend<{ codeService: Awaited<ReturnType<typeof isolatedService>> }>({
  codeService: async ({ browser }, use) => {
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
  context: async ({ browser, codeService }, use) => {
    const context = await browser.newContext({ baseURL: codeService.base });
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
  const title = 'Highlighting ' + randomUUID().slice(0, 8);
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
  expect(
    (
      await page.request.post(`/api/rooms/${f.id}/messages`, {
        headers: f.headers,
        data: {
          clientId: randomUUID(),
          body,
          type: question ? 'question' : 'update',
          recipientIds: question ? [f.room.agents[0]!.id] : [],
          synthesisAgentId: null,
        },
      })
    ).ok(),
  ).toBe(true);
}

test('optional highlighting toggles by keyboard per block and preserves exact copies, notes, archives, and reload', async ({
  page,
}) => {
  const f = await workspace(page);
  const code = 'const answer = "<img>";\n// ' + 'long code '.repeat(40) + '\n';
  const body =
    'Code review[^a].\n\n```JS\n' +
    code +
    '```\n\n```JSON\n{"ready": true, "count": 42}\n```\n\n[^a]: Original note.';
  await page.getByRole('button', { name: /^All messages\b/ }).click();
  await send(page, f, body);
  await send(page, f, body);
  const messages = page.locator('.message.update');
  await expect(messages).toHaveCount(2);
  const first = messages.first();
  const js = first
    .locator('.code-block')
    .filter({ has: page.getByLabel('JS code', { exact: true }) });
  const json = first
    .locator('.code-block')
    .filter({ has: page.getByLabel('JSON code', { exact: true }) });
  const toggle = js.getByRole('button', { name: 'Toggle code highlighting', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(first.locator('.code-token')).toHaveCount(0);
  const before = await f.record();
  const url = page.url();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toBeFocused();
  await expect(js.locator('.code-keyword')).toHaveText('const');
  await expect(js.locator('pre')).toHaveText(code);
  await expect(json.locator('.code-token')).toHaveCount(0);
  await expect(messages.last().locator('.code-token')).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(js.locator('.code-token')).toHaveCount(0);
  await toggle.click();
  await json.getByRole('button', { name: 'Toggle code highlighting', exact: true }).click();
  await expect(json.locator('.code-property')).toHaveCount(2);
  await js.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await first.getByRole('button', { name: 'Copy message', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(body);
  await first.getByRole('button', { name: 'Read footnote 1, reference 1', exact: true }).click();
  await expect(first.locator('.message-footnotes > ol > li')).toBeFocused();
  expect(page.url()).toBe(url);
  expect(await f.record()).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await js.locator('pre').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => js.locator('pre').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/highlighting-mobile.png', fullPage: true });
  await first.getByRole('button', { name: 'View source', exact: true }).click();
  await expect(first.locator('.message-source')).toHaveText(body);
  await expect(first.locator('.code-token')).toHaveCount(0);
  await first.getByRole('button', { name: 'View formatted', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('Search threads', { exact: true }).fill('const answer');
  await expect(page.locator('.thread-entry')).toHaveCount(2);
  expect(
    await (await page.request.get(`/api/rooms/${f.id}/export`, { headers: f.headers })).text(),
  ).toContain(body);
  expect(
    (
      await page.request.put(`/api/rooms/${f.id}/archive`, {
        headers: f.headers,
        data: { archived: true },
      })
    ).ok(),
  ).toBe(true);
  await expect(page.locator('.archived-notice')).toBeVisible();
  const archived = await f.record();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await f.record()).toEqual(archived);
  await page.reload();
  await page.getByLabel('Workspace view').selectOption('archived');
  await page.getByRole('button', { name: f.title + ' Archived', exact: true }).click();
  await page.getByRole('button', { name: /^All messages\b/ }).click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(messages.locator('.code-token')).toHaveCount(0);
  expect((await f.record()).messages).toEqual(before.messages);
  expect((await f.record()).turnsUsed).toBe(0);
});

test('hostile highlighted code cannot execute or fetch resources, and unsupported or over-limit blocks stay complete', async ({
  page,
}) => {
  const f = await workspace(page);
  const loads: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('evil.example')) loads.push(request.url());
  });
  const attack =
    'window.highlightInjected=true;\nconst html="<img src=https://evil.example/pixel onerror=alert(1)>";\nfetch("https://evil.example/execute");\n// SEND TO AI C\n';
  const lines = 'x\n'.repeat(1001);
  const runs = 'true '.repeat(1001) + '\n';
  const body =
    '```js\n' +
    attack +
    '```\n\n```__proto__\nconst untouched = 42;\n```\n\n```js\n' +
    lines +
    '```\n\n```json\n' +
    runs +
    '```';
  await send(page, f, body);
  const message = page.locator('.message.update');
  const blocks = message.locator('.code-block');
  await expect(blocks).toHaveCount(4);
  const before = await f.record();
  const url = page.url();
  await blocks.nth(0).getByRole('button', { name: 'Toggle code highlighting' }).click();
  await expect(blocks.nth(0).locator('.code-token').first()).toBeVisible();
  await expect(blocks.nth(0).locator('pre')).toHaveText(attack);
  await expect(message.locator('script, img, a, form, iframe, style, link')).toHaveCount(0);
  expect(await page.evaluate(() => 'highlightInjected' in window)).toBe(false);
  expect(loads).toEqual([]);
  await expect(
    blocks.nth(1).getByRole('button', { name: 'Toggle code highlighting' }),
  ).toBeDisabled();
  await expect(blocks.nth(1).locator('.code-highlight-notice')).toContainText(
    'This block stays plain',
  );
  await expect(
    blocks.nth(2).getByRole('button', { name: 'Toggle code highlighting' }),
  ).toBeDisabled();
  await expect(blocks.nth(2).locator('.code-highlight-notice')).toContainText('1,000 lines');
  await expect(blocks.nth(2).locator('pre')).toHaveText(lines);
  const limited = blocks.nth(3);
  await limited.getByRole('button', { name: 'Toggle code highlighting' }).click();
  await expect(limited.getByRole('button', { name: 'Toggle code highlighting' })).toBeDisabled();
  await expect(limited.getByRole('button', { name: 'Toggle code highlighting' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(limited.locator('.code-highlight-notice')).toContainText('2,000 token runs');
  await expect(limited.locator('.code-token')).toHaveCount(0);
  await expect(limited.locator('pre')).toHaveText(runs);
  await limited.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(runs);
  await message.getByRole('button', { name: 'View source', exact: true }).click();
  await expect(message.locator('.message-source')).toHaveText(body);
  expect(page.url()).toBe(url);
  expect(await f.record()).toEqual(before);
  expect(before.jobs).toHaveLength(0);
});

test('streamed code stays literal and terminal highlighting preserves completion, failed partial status, and frozen context', async ({
  page,
}) => {
  const first = '## Answer\n\n```ts\nconst answer: string = "<img';
  const last = '>";\n```\n\nOriginal[^a].\n\n[^a]: Keep exact source.';
  const partialSource = '## Partial\n\n```py\ndef partial():\n    return None';
  const requests: { context: { authorId: string; body: string }[] }[] = [];
  let complete: (() => void) | undefined;
  const server = createServer((req, res) => {
    const buffers: Buffer[] = [];
    req.on('data', (chunk) => buffers.push(chunk));
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(buffers).toString());
      requests.push(JSON.parse(payload.messages[1].content));
      res.setHeader('Content-Type', 'application/x-ndjson');
      if (requests.length === 1) {
        res.write(JSON.stringify({ message: { content: first }, done: false }) + '\n');
        complete = () =>
          res.end(
            JSON.stringify({ message: { content: last }, done: true, done_reason: 'stop' }) + '\n',
          );
      } else res.end(JSON.stringify({ message: { content: partialSource }, done: false }) + '\n');
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
            model: 'highlighting-protocol-fixture',
            baseUrl: `http://127.0.0.1:${address.port}`,
            maxOutputTokens: agent.maxOutputTokens,
            timeoutSeconds: agent.timeoutSeconds,
          },
        })
      ).ok(),
    ).toBe(true);
    await send(page, f, 'Give a code answer.', true);
    const answer = page.locator('.message.answer').first();
    await expect(answer.locator('.badge.streaming')).toBeVisible();
    await expect(answer.locator('.message-literal')).toHaveText(first);
    await expect(answer.locator('.code-block')).toHaveCount(0);
    await answer.getByRole('button', { name: 'Copy message', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(first);
    expect(complete).toBeDefined();
    complete!();
    await expect(answer.getByRole('button', { name: 'Reply to AI A', exact: true })).toBeEnabled();
    const before = await f.record();
    await answer.getByRole('button', { name: 'Toggle code highlighting', exact: true }).click();
    await expect(answer.locator('.code-keyword')).toHaveCount(2);
    await answer.getByRole('button', { name: 'Copy code', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('const answer: string = "<img>";\n');
    expect(await f.record()).toEqual(before);
    await answer.getByRole('button', { name: 'Reply to AI A', exact: true }).click();
    await page.getByLabel('Message', { exact: true }).fill('Review the original code.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const partial = page.locator('.message.answer').last();
    await expect(partial.locator('.badge.failed')).toBeVisible();
    const failed = await f.record();
    await partial.getByRole('button', { name: 'Toggle code highlighting', exact: true }).click();
    await expect(partial.locator('.code-keyword')).toHaveCount(3);
    await expect(
      partial.getByRole('button', { name: 'Reply to AI A', exact: true }),
    ).toBeDisabled();
    await expect(partial.locator('.badge.failed')).toBeVisible();
    expect(await f.record()).toEqual(failed);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.context.find((message) => message.authorId === agent.id)?.body).toBe(
      first + last,
    );
    await partial.getByRole('button', { name: 'Copy code', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('def partial():\n    return None\n');
    await partial.getByRole('button', { name: 'Inspect context', exact: true }).click();
    await expect(
      page.locator('.snapshot-message').filter({ hasText: 'Keep exact source' }),
    ).toContainText(first + last);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const saved = await f.record();
    expect(saved.jobs).toHaveLength(2);
    expect(saved.turnsUsed).toBe(2);
    expect(
      saved.messages
        .filter((message) => message.authorId === agent.id)
        .map((message) => message.body),
    ).toEqual([first + last, partialSource]);
    const exported = await (
      await page.request.get(`/api/rooms/${f.id}/export`, { headers: f.headers })
    ).text();
    expect(exported).toContain(first + last);
    expect(exported).toContain(partialSource);
    await page.reload();
    await expect(page.locator('.message.answer')).toHaveCount(2);
    await expect(partial.locator('.badge.failed')).toBeVisible();
    await expect(
      partial.getByRole('button', { name: 'Toggle code highlighting', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(requests).toHaveLength(2);
  } finally {
    complete?.();
    await new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    });
  }
});
