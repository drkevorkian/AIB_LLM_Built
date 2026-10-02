import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { isolatedService } from './isolated-service.js';
import {
  defaultAppSettings,
  type AgentAction,
  type AppSettings,
  type Room,
  type RoomSummary,
} from '../../src/shared/contracts.js';

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4318' });
  try {
    const { token } = (await (await request.get('/api/session')).json()) as { token: string };
    expect(
      (
        await request.put('/api/settings', {
          headers: { 'X-AIB-Token': token },
          data: defaultAppSettings,
        })
      ).ok(),
    ).toBe(true);
  } finally {
    await request.dispose();
  }
});

async function createRoom(page: Page, participantCount = 3) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  const title = `Conversation ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Workspace name').fill(title);
  await page.getByLabel('Shared objective').fill('Investigate the delivery sequence.');
  await page.getByLabel('Participant count').fill(String(participantCount));
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start a conversation.' })).toBeVisible();
  await expect(page.locator('.agent-card')).toHaveCount(participantCount);
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
  return title;
}

async function workspaceRecord(page: Page, title: string) {
  const { token } = (await (await page.request.get('/api/session')).json()) as { token: string };
  const headers = { 'X-AIB-Token': token };
  const rooms = (await (await page.request.get('/api/rooms', { headers })).json()) as RoomSummary[];
  const id = rooms.find((room) => room.title === title)!.id;
  const room = (await (await page.request.get('/api/rooms/' + id, { headers })).json()) as Room;
  return { room, headers };
}

test('parallel answers, synthesis, directed reply, frozen context, export, and reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 980 });
  await createRoom(page);
  await page.screenshot({ path: 'test-results/workspace.png', fullPage: true });
  await page.getByLabel('Message', { exact: true }).fill('What could cause duplicate delivery?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('SIMULATED SYNTHESIS', { exact: false })).toBeVisible();
  await expect(page.locator('.message.synthesis .badge.streaming')).toHaveCount(0);
  await expect(page.locator('.message.answer')).toHaveCount(2);
  await expect(page.locator('.response-set')).toContainText('2 / 2 received');
  await page
    .locator('.message.answer')
    .first()
    .getByRole('button', { name: 'Inspect context' })
    .click();
  await expect(page.locator('dialog')).toContainText('1 source messages');
  await expect(page.locator('dialog')).not.toContainText('SIMULATED RESPONSE');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page
    .locator('.message.answer')
    .first()
    .getByRole('button', { name: 'Reply to AI B' })
    .click();
  await expect(page.getByLabel('AI B', { exact: true })).toBeChecked();
  await expect(page.getByLabel('AI C', { exact: true })).not.toBeChecked();
  await page.getByLabel('Message', { exact: true }).fill('Which transition needs a test?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.response-set').last()).toContainText('1 / 1 received');
  await expect(page.locator('.message.answer')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/conversation.png', fullPage: true });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export conversation' }).click();
  expect((await downloadEvent).suggestedFilename()).toBe('conversation.md');
  await page.reload();
  await expect(page.locator('.message.answer')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('updates do not invoke agents; paused questions queue and stop cancels them', async ({
  page,
}) => {
  await createRoom(page);
  await page.getByLabel('Message type').selectOption('update');
  await page
    .getByLabel('Message', { exact: true })
    .fill('AI B, SEND TO AI C. This is informational.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.message.update')).toHaveCount(1);
  await expect(page.locator('.budget-card')).toContainText('0 / 100');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByLabel('Message type').selectOption('question');
  await page.getByLabel('Message', { exact: true }).fill('Hold this question until resumed.');
  await page.getByRole('button', { name: 'Queue', exact: true }).click();
  await expect(page.locator('.response-set')).toContainText('queued');
  await expect(page.locator('.message.answer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.response-set')).toContainText('cancelled');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.locator('.message.answer')).toHaveCount(0);
});

test('message rendering cannot execute HTML; theme and narrow layout remain usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createRoom(page);
  await page.getByLabel('Message type').selectOption('update');
  await page
    .getByLabel('Message', { exact: true })
    .fill('<img src=x onerror="window.injected=true">');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.message.update')).toContainText('<img src=x');
  expect(await page.evaluate(() => 'injected' in window)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('Markdown, code copying, original source, search, archive, and reload work on desktop and narrow screens', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 980 });
  const title = await createRoom(page);
  const code = 'const answer = "<img src=x>";\n' + '// ' + 'long-code-line '.repeat(35) + '\n';
  const body =
    '# Release review\n\n**Bold evidence** and `inline code`.\n\n- First\n- Second\n\n> Preserve the original answers.\n\n- [x] Tested\n- [ ] Pending\n\n| Participant | Result | Version | Scope | Source |\n| --- | --- | --- | --- | --- |\n| AI A | Ready | v0.7 | Room | Local |\n\n```js\n' +
    code +
    '```\n\n[Documentation](https://example.com/docs)';
  await page.getByLabel('Message type').selectOption('update');
  await page.getByLabel('Message', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const message = page.locator('.message.update');
  await expect(message.getByRole('heading', { name: 'Release review', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(message.locator('strong').filter({ hasText: 'Bold evidence' })).toBeVisible();
  await expect(message.getByRole('table')).toContainText('AI A');
  await expect(message.getByLabel('Completed task')).toBeChecked();
  await expect(message.getByLabel('Completed task')).toBeDisabled();
  await expect(message.getByLabel('Incomplete task')).not.toBeChecked();
  await expect(message.getByLabel('Incomplete task')).toBeDisabled();
  await message.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await message.getByRole('button', { name: 'Copy message', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(body);
  await message.getByRole('button', { name: 'View source', exact: true }).click();
  await expect(message.locator('.message-source')).toHaveText(body);
  await expect(message.getByRole('table')).toHaveCount(0);
  await expect(message.getByRole('button', { name: 'Copy code', exact: true })).toHaveCount(0);
  await message.getByRole('button', { name: 'View formatted', exact: true }).click();
  await expect(message.getByRole('table')).toBeVisible();
  await page.screenshot({ path: 'test-results/markdown.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await message.locator('pre').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await message.locator('pre').focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => message.locator('pre').evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  const table = message.getByRole('region', { name: 'Message table', exact: true });
  expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await table.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: 'test-results/markdown-mobile.png', fullPage: true });
  await page.getByLabel('Search threads', { exact: true }).fill('**Bold evidence**');
  await expect(page.locator('.thread-entry')).toHaveCount(1);
  const { room, headers } = await workspaceRecord(page, title);
  const before = JSON.stringify(room.messages);
  const exported = await page.request.get(`/api/rooms/${room.id}/export`, { headers });
  expect(exported.ok()).toBe(true);
  expect(await exported.text()).toContain(body);
  expect(
    (
      await page.request.put(`/api/rooms/${room.id}/archive`, { headers, data: { archived: true } })
    ).ok(),
  ).toBe(true);
  await expect(page.locator('.archived-notice')).toBeVisible();
  await expect(message.getByRole('button', { name: 'Copy message', exact: true })).toBeEnabled();
  await message.getByRole('button', { name: 'View source', exact: true }).click();
  await expect(message.locator('.message-source')).toHaveText(body);
  await page.reload();
  await page.getByLabel('Workspace view').selectOption('archived');
  await page.getByRole('button', { name: title + ' Archived', exact: true }).click();
  await expect(page.locator('.archived-notice')).toBeVisible();
  await expect(message.getByRole('table')).toBeVisible();
  await message.getByRole('button', { name: 'Copy message', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(body);
  const after = (await (
    await page.request.get(`/api/rooms/${room.id}`, { headers })
  ).json()) as Room;
  expect(JSON.stringify(after.messages)).toBe(before);
  expect(after.turnsUsed).toBe(0);
});

test('Markdown links and HTML cannot execute, load remote images, or submit local commands', async ({
  page,
}) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('evil.example')) external.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await createRoom(page);
  const body =
    '# Safety check\n\n[Allowed](https://example.com/docs) [Blocked](javascript:window.injected=true) [Entity](jav&#x61;script:alert%281%29) [Internal](/api/session) [Credentials](https://user:password@example.com/)\n\n![tracking](https://evil.example/pixel)\n\n<img src="https://evil.example/pixel" onerror="window.injected=true">\n\n<svg onload="window.injected=true"></svg>\n\n<iframe srcdoc="<script>window.injected=true</script>"></iframe>\n\n<form action="/api/settings"><input name="token"></form>';
  await page.getByLabel('Message type').selectOption('update');
  await page.getByLabel('Message', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const message = page.locator('.message.update .message-body');
  await expect(message.getByRole('link')).toHaveCount(1);
  await expect(message.getByRole('link', { name: 'Allowed' })).toHaveAttribute(
    'href',
    'https://example.com/docs',
  );
  await expect(message.getByRole('link', { name: 'Allowed' })).toHaveAttribute('target', '_blank');
  await expect(message.getByRole('link', { name: 'Allowed' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  await expect(message.getByRole('link', { name: 'Allowed' })).toHaveAttribute(
    'referrerpolicy',
    'no-referrer',
  );
  for (const label of ['Blocked', 'Entity', 'Internal', 'Credentials']) {
    await expect(message.getByText(label, { exact: true })).toHaveAttribute(
      'class',
      'blocked-link',
    );
  }
  const location = page.url();
  await message.getByText('Blocked', { exact: true }).click();
  expect(page.url()).toBe(location);
  await expect(message.locator('img, script, svg, iframe, form, input, style')).toHaveCount(0);
  await expect(message).toContainText('[Image: tracking — not loaded]');
  await expect(message).toContainText('<img src=');
  expect(await page.evaluate(() => 'injected' in window)).toBe(false);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  await expect(page.locator('.budget-card')).toContainText('0 / 100');
});

test('clipboard rejection and missing clipboard API expose selectable source and permit a later copy', async ({
  page,
}) => {
  await createRoom(page);
  const body = '**Manual copy**\n\n```txt\nKeep this source.\n```';
  await page.getByLabel('Message type').selectOption('update');
  await page.getByLabel('Message', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const message = page.locator('.message.update');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Fixture secret must not be exposed');
        },
      },
    }),
  );
  await message.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(message.locator('.code-block').getByRole('status')).toHaveText(
    'Clipboard unavailable. Select the text to copy.',
  );
  await expect(message.locator('pre')).toHaveText('Keep this source.\n');
  await message.getByRole('button', { name: 'Copy message', exact: true }).click();
  await expect(message.locator('.message-source')).toHaveText(body);
  await expect(message.locator('.message-actions').getByRole('status')).toHaveText(
    'Clipboard unavailable. Select the text to copy.',
  );
  expect(
    await message.locator('.message-source').evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    }),
  ).toBe(body);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }),
  );
  await message.getByRole('button', { name: 'Copy message', exact: true }).click();
  await expect(message.locator('.message-actions').getByRole('status')).toHaveText(
    'Clipboard unavailable. Select the text to copy.',
  );
  await expect(message).not.toContainText('Fixture secret');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          sessionStorage.setItem('copiedFixture', value);
        },
      },
    }),
  );
  await message.getByRole('button', { name: 'Copy message', exact: true }).click();
  await expect(message.locator('.message-actions').getByRole('status')).toHaveText('Text copied.');
  expect(await page.evaluate(() => sessionStorage.getItem('copiedFixture'))).toBe(body);
  await expect(message.getByRole('button', { name: 'Copy message', exact: true })).toBeEnabled();
});

test('a failed formatting module preserves readable source, copying, and conversation controls', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/assets/MarkdownText-*.js', (route) => route.abort());
  await createRoom(page);
  const source =
    '# Still readable\n\n```js\nconst value = "<img>";\n```\n\nOriginal[^a].\n\n[^a]: Exact footnote source.';
  await page.getByLabel('Message type').selectOption('update');
  await page.getByLabel('Message', { exact: true }).fill(source);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const message = page.locator('.message.update');
  await expect(message.locator('.formatting-notice')).toHaveText(
    'Formatted view unavailable. Original text is shown.',
  );
  await expect(message.locator('.message-literal')).toHaveText(source);
  await expect(message.locator('img')).toHaveCount(0);
  await expect(message.locator('.footnote-control')).toHaveCount(0);
  await message.getByRole('button', { name: 'Copy message', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  await page.getByLabel('Message', { exact: true }).fill('A second update remains usable.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.message.update')).toHaveCount(2);
  await expect(page.locator('.message.update').last()).toContainText(
    'A second update remains usable.',
  );
  await expect(page.locator('.budget-card')).toContainText('0 / 100');
});

test('a delayed post-send refresh preserves the next draft and keeps consecutive messages in the accepted thread', async ({
  page,
}) => {
  const title = await createRoom(page);
  const { room, headers } = await workspaceRecord(page, title);
  const roomUrl = new RegExp('/api/rooms/' + room.id + '$');
  let release!: () => void;
  let gate = new Promise<void>((done) => {
    release = done;
  });
  await page.route(roomUrl, async (route) => {
    if (route.request().method() === 'GET') await gate;
    await route.continue();
  });
  try {
    await page.getByLabel('Message type').selectOption('update');
    await page.getByLabel('Message', { exact: true }).fill('First accepted update.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
    await page
      .getByLabel('Message', { exact: true })
      .fill('Draft typed while the history refresh waits.');
    await expect(page.locator('.send-button')).toBeDisabled();
    const accepted = (await (
      await page.request.get(`/api/rooms/${room.id}`, { headers })
    ).json()) as Room;
    expect(accepted.messages).toHaveLength(1);
    release();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Draft typed while the history refresh waits.',
    );
    await expect(
      page.getByRole('heading', { name: accepted.threads[0]!.title, exact: true, level: 1 }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.message.update')).toHaveCount(2);
    const final = (await (
      await page.request.get(`/api/rooms/${room.id}`, { headers })
    ).json()) as Room;
    expect(final.threads).toHaveLength(1);
    expect(final.messages.map((message) => message.threadId)).toEqual([
      accepted.threads[0]!.id,
      accepted.threads[0]!.id,
    ]);
    expect(final.messages[1]!.body).toBe('Draft typed while the history refresh waits.');
    expect(final.turnsUsed).toBe(0);

    await page.getByRole('button', { name: /^All messages(?: \d+)?$/ }).click();
    await page.getByLabel('Message', { exact: true }).fill('Another retained thread.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.thread-entry')).toHaveCount(2);
    await expect(page.locator('.send-button')).toHaveText('Send');
    gate = new Promise<void>((done) => {
      release = done;
    });
    await page
      .getByLabel('Message', { exact: true })
      .fill('An acknowledged update before changing threads.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
    await expect(page.locator('.send-button')).toHaveText('Updating…');
    await page
      .locator('.thread-entry')
      .filter({ hasText: accepted.threads[0]!.title })
      .locator('button')
      .first()
      .click();
    await page.getByLabel('Message', { exact: true }).fill('Draft for the chosen earlier thread.');
    release();
    await expect(page.locator('.send-button')).toBeEnabled();
    await expect(
      page.getByRole('heading', { name: accepted.threads[0]!.title, exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Draft for the chosen earlier thread.',
    );
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.message.update')).toHaveCount(3);
    const selected = (await (
      await page.request.get(`/api/rooms/${room.id}`, { headers })
    ).json()) as Room;
    expect(selected.messages).toHaveLength(5);
    expect(selected.messages.at(-1)!.threadId).toBe(accepted.threads[0]!.id);
    await expect(page.locator('.send-button')).toHaveText('Send');
    await page.getByRole('button', { name: /^All messages(?: \d+)?$/ }).click();
    gate = new Promise<void>((done) => {
      release = done;
    });
    await page.getByLabel('Message', { exact: true }).fill('New thread from All messages.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.send-button')).toHaveText('Updating…');
    // Choosing the already-selected null thread is still an explicit human choice.
    await page.getByRole('button', { name: /^All messages(?: \d+)?$/ }).click();
    await page.getByLabel('Message', { exact: true }).fill('Draft for All messages.');
    release();
    await expect(page.locator('.send-button')).toBeEnabled();
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
    await expect(page.locator('.message.update')).toHaveCount(6);
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Draft for All messages.',
    );
    const all = (await (
      await page.request.get(`/api/rooms/${room.id}`, { headers })
    ).json()) as Room;
    expect(all.threads).toHaveLength(3);
    expect(all.messages).toHaveLength(6);
    let releaseAcknowledgement!: () => void;
    const acknowledgement = new Promise<void>((done) => {
      releaseAcknowledgement = done;
    });
    const messageUrl = new RegExp('/api/rooms/' + room.id + '/messages$');
    await page.route(messageUrl, async (route) => {
      const response = await route.fetch();
      await acknowledgement;
      await route.fulfill({ response });
    });
    try {
      await page
        .getByLabel('Message', { exact: true })
        .fill('Navigation before send acknowledgment.');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(page.locator('.send-button')).toHaveText('Sending…');
      await page.getByRole('button', { name: /^All messages(?: \d+)?$/ }).click();
      releaseAcknowledgement();
      await expect(page.locator('.send-button')).toHaveText('Send');
      await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
      await expect(page.locator('.message.update')).toHaveCount(7);
    } finally {
      releaseAcknowledgement();
      if (!page.isClosed()) await page.unroute(messageUrl);
    }
  } finally {
    release();
    if (!page.isClosed()) await page.unroute(roomUrl);
  }
});

test('split Markdown streams, completed answers, and failed partial code retain their exact provider source', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { createServer } = await import('node:http');
  const requests: { context: { authorId: string; body: string }[] }[] = [];
  const first = '## Final answer\n\n```js\nconsole.log("<img';
  const last =
    ' src=x>");\n```\n\n[Documentation](https://example.com/docs)\n\n![tracking](https://evil.example/pixel)';
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
      } else {
        res.end(
          JSON.stringify({
            message: { content: '## Partial result\n\n```txt\nNo confirmed completion.' },
            done: false,
          }) + '\n',
        );
      }
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  try {
    const title = await createRoom(page, 1);
    const { room, headers } = await workspaceRecord(page, title);
    const agent = room.agents[0]!;
    expect(
      (
        await page.request.post(`/api/rooms/${room.id}/agents`, {
          headers,
          data: {
            agentId: agent.id,
            name: agent.name,
            role: agent.role,
            provider: 'ollama',
            model: 'markdown-fixture',
            baseUrl: `http://127.0.0.1:${address.port}`,
            maxOutputTokens: agent.maxOutputTokens,
            timeoutSeconds: agent.timeoutSeconds,
          },
        })
      ).ok(),
    ).toBe(true);
    await page.getByLabel('Message', { exact: true }).fill('Give a formatted answer with code.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const answer = page.locator('.message.answer').first();
    await expect(answer.locator('.badge.streaming')).toBeVisible();
    await expect(answer.locator('.message-literal')).toHaveText(first);
    await expect(answer.locator('pre')).toHaveCount(0);
    await answer.getByRole('button', { name: 'Copy message', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(first);
    expect(complete).toBeDefined();
    complete!();
    await expect(answer.locator('.badge.streaming')).toHaveCount(0);
    await expect(answer.getByRole('heading', { name: 'Final answer', level: 4 })).toBeVisible();
    await expect(answer.locator('pre')).toHaveText('console.log("<img src=x>");\n');
    await expect(answer.locator('img')).toHaveCount(0);
    await expect(answer.getByRole('button', { name: 'Copy message', exact: true })).toHaveText(
      'Copy message',
    );
    await answer.getByRole('button', { name: 'Copy message', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(first + last);
    await answer.getByRole('button', { name: 'Reply to AI A', exact: true }).click();
    await page.getByLabel('Message', { exact: true }).fill('Review the exact original response.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const partial = page.locator('.message.answer').last();
    await expect(partial.locator('.badge.failed')).toBeVisible();
    await expect(partial.locator('pre')).toHaveText('No confirmed completion.\n');
    await partial.getByRole('button', { name: 'Copy code', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('No confirmed completion.\n');
    expect(requests).toHaveLength(2);
    expect(requests[1]!.context.find((message) => message.authorId === agent.id)?.body).toBe(
      first + last,
    );
    await partial.getByRole('button', { name: 'Inspect context', exact: true }).click();
    await expect(
      page.locator('.snapshot-message').filter({ hasText: 'Final answer' }),
    ).toContainText(first + last);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    const saved = (await (
      await page.request.get(`/api/rooms/${room.id}`, { headers })
    ).json()) as Room;
    expect(saved.turnsUsed).toBe(2);
    expect(saved.jobs).toHaveLength(2);
    await page.reload();
    await expect(page.locator('.message.answer')).toHaveCount(2);
    await expect(partial.locator('pre')).toHaveText('No confirmed completion.\n');
  } finally {
    complete?.();
    await new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    });
  }
});

test('configure local models, test the connection, run a real HTTP relay, and direct a follow-up', async ({
  page,
}) => {
  const { createServer } = await import('node:http');
  const requests: { model: string; sourceCount: number; relay: boolean }[] = [];
  const server = createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({ models: ['model-a', 'model-b', 'model-c'].map((name) => ({ name })) }),
      );
      return;
    }
    const buffers: Buffer[] = [];
    req.on('data', (chunk) => buffers.push(chunk));
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(buffers).toString());
      const context = JSON.parse(payload.messages[1].content);
      requests.push({
        model: payload.model,
        sourceCount: context.context.length,
        relay: payload.messages[0].content.includes('relay step'),
      });
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(
        JSON.stringify({
          message: { content: `LIVE PROTOCOL FIXTURE ${payload.model}. ` },
          done: false,
        }) + '\n',
      );
      setTimeout(
        () =>
          res.end(
            JSON.stringify({
              message: { content: `Read ${context.context.length} attributed source messages.` },
              done: true,
              done_reason: 'stop',
              prompt_eval_count: 20,
              eval_count: 8,
            }) + '\n',
          ),
        30,
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  try {
    await page.setViewportSize({ width: 1440, height: 980 });
    await createRoom(page);
    for (const [agent, model] of [
      ['AI A', 'model-a'],
      ['AI B', 'model-b'],
      ['AI C', 'model-c'],
    ]) {
      await page.getByRole('button', { name: `Configure ${agent}`, exact: true }).click();
      await page.getByLabel('Provider', { exact: true }).selectOption('ollama');
      await page.getByLabel('Server URL', { exact: true }).fill(`http://127.0.0.1:${address.port}`);
      await page.getByRole('button', { name: 'Load available models', exact: true }).click();
      await expect(page.locator('dialog')).toContainText('3 model IDs loaded');
      await page.getByLabel('Model ID', { exact: true }).fill(model!);
      await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      await expect(page.locator('dialog')).toContainText('Settings saved');
      if (agent === 'AI A') {
        await page.getByRole('button', { name: 'Test connection', exact: true }).click();
        await expect(page.locator('dialog')).toContainText(
          'Connection succeeded: LIVE PROTOCOL FIXTURE model-a',
        );
        expect(requests.at(-1)?.sourceCount).toBe(0);
      }
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    }
    await page.getByLabel('Message type').selectOption('relay');
    await expect(page.getByLabel('Relay step 1', { exact: true })).toBeVisible();
    await page
      .getByLabel('Message', { exact: true })
      .fill('Find a robust way for models to exchange answers.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByLabel('Relay progress')).toContainText('4 / 4 complete');
    await expect(page.locator('.message.answer')).toHaveCount(4);
    await expect(page.locator('.message.answer')).not.toContainText(['SIMULATED']);
    const relayRequests = requests.filter((r) => r.relay);
    expect(relayRequests.map((r) => r.model)).toEqual(['model-a', 'model-c', 'model-b', 'model-a']);
    expect(relayRequests.map((r) => r.sourceCount)).toEqual([1, 2, 3, 4]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.locator('.message-scroll').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: 'test-results/live-relay.png', fullPage: true });
    await page
      .locator('.message.answer')
      .nth(1)
      .getByRole('button', { name: 'Reply to AI C' })
      .click();
    await expect(page.getByLabel('Message type')).toHaveValue('question');
    await expect(page.getByLabel('AI C', { exact: true })).toBeChecked();
    await expect(page.getByLabel('AI A', { exact: true })).not.toBeChecked();
    await page.getByLabel('Message', { exact: true }).fill('Review that specific handoff.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.message.answer')).toHaveCount(5);
    await expect(page.locator('.response-set').last()).toContainText('1 / 1 received');
    expect(requests.at(-1)?.model).toBe('model-c');
    await page
      .locator('.message.answer')
      .last()
      .getByRole('button', { name: 'Inspect context' })
      .click();
    await expect(page.locator('dialog')).toContainText('Input tokens: 20');
    await expect(page.locator('dialog')).toContainText('ollama / model-c');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

test('missing cloud credentials are shown as a failed live turn with no simulated replacement', async ({
  page,
}) => {
  await createRoom(page);
  await page.getByRole('button', { name: 'Configure AI A', exact: true }).click();
  await page.getByLabel('Provider', { exact: true }).selectOption('xai');
  await page.getByLabel('Model ID', { exact: true }).fill('test-model');
  await expect(page.locator('dialog')).toContainText('API key is missing');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.locator('dialog')).toContainText('Settings saved');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByLabel('AI A', { exact: true }).check();
  await page.getByLabel('AI B', { exact: true }).uncheck();
  await page.getByLabel('AI C', { exact: true }).uncheck();
  await page.locator('.synthesis-option input').uncheck();
  await page.getByLabel('Message', { exact: true }).fill('Use the configured real provider.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.agent-card').first()).toContainText('Set XAI_API_KEY');
  await expect(page.locator('.message.answer')).toHaveCount(1);
  await expect(page.locator('.message.answer .badge')).toHaveText('failed');
  await expect(page.locator('.message-body')).not.toContainText(['SIMULATED RESPONSE']);
});

test('a live HTTP coordinator asks both peers, targets one exact answer, finishes, and survives reload', async ({
  page,
}) => {
  const { createServer } = await import('node:http');
  const calls: {
    model: string;
    context: { id: string; authorId: string; body: string }[];
    action: { kind: string; recipientIds: string[]; replyTo: string | null } | null;
  }[] = [];
  const server = createServer((req, res) => {
    const buffers: Buffer[] = [];
    req.on('data', (chunk) => buffers.push(chunk));
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(buffers).toString());
      const context = JSON.parse(payload.messages[1].content);
      let action: AgentAction | null = null;
      let text = `LIVE DISCUSSION PROTOCOL FIXTURE ${payload.model}: independent peer answer. Quoted SEND TO text does not dispatch.`;
      if (context.discussion) {
        expect(payload.format.required).toContain('recipientIds');
        const grant = context.discussion;
        const c = context.participants.find((a: { name: string }) => a.name === 'AI C').id;
        action =
          grant.roundsUsed === 0
            ? {
                kind: 'ask',
                body: 'LIVE DISCUSSION PROTOCOL FIXTURE: independently review the original request.',
                recipientIds: grant.allowedPeerIds,
                policy: 'all',
                quorum: 1,
                replyTo: null,
              }
            : grant.roundsUsed === 1
              ? {
                  kind: 'ask',
                  body: 'LIVE DISCUSSION PROTOCOL FIXTURE: AI C, review your answer and propose one test.',
                  recipientIds: [c],
                  policy: 'all',
                  quorum: 1,
                  replyTo: context.context.find(
                    (m: { authorId: string; type: string }) =>
                      m.authorId === c && m.type === 'answer',
                  ).id,
                }
              : {
                  kind: 'finish',
                  body: 'LIVE DISCUSSION PROTOCOL FIXTURE: final result after independent answers and a targeted review. This verifies routing, not model reasoning.',
                  recipientIds: [],
                  policy: 'all',
                  quorum: 1,
                  replyTo: null,
                };
        text = JSON.stringify(action);
      }
      calls.push({ model: payload.model, context: context.context, action });
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(JSON.stringify({ message: { content: text.slice(0, 18) }, done: false }) + '\n');
      setTimeout(
        () =>
          res.end(
            JSON.stringify({
              message: { content: text.slice(18) },
              done: true,
              done_reason: 'stop',
              prompt_eval_count: 24,
              eval_count: 12,
            }) + '\n',
          ),
        50,
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await createRoom(page);
    for (const [agent, model] of [
      ['AI A', 'coordinator-fixture'],
      ['AI B', 'debugger-fixture'],
      ['AI C', 'reviewer-fixture'],
    ]) {
      await page.getByRole('button', { name: `Configure ${agent}`, exact: true }).click();
      await page.getByLabel('Provider', { exact: true }).selectOption('ollama');
      await page.getByLabel('Server URL', { exact: true }).fill(`http://127.0.0.1:${address.port}`);
      await page.getByLabel('Model ID', { exact: true }).fill(model!);
      await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      await expect(page.locator('dialog')).toContainText('Settings saved');
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    }
    await page.getByLabel('Message type').selectOption('discussion');
    await expect(page.getByLabel('Discussion coordinator').locator('option:checked')).toHaveText(
      'AI A',
    );
    await page.getByLabel('Maximum peer rounds').fill('3');
    await page.getByLabel('Discussion turn allowance').fill('8');
    await page
      .getByLabel('Message', { exact: true })
      .fill('Investigate model-to-model delivery and review the proposed test.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByLabel('Discussion progress')).toContainText('completed');
    await expect(page.getByLabel('Discussion progress')).toContainText('2 / 3 peer rounds');
    await expect(page.getByLabel('Discussion progress')).toContainText('6 / 8 turns used');
    expect(calls).toHaveLength(6);
    expect(calls[0]!.model).toBe('coordinator-fixture');
    expect(
      calls
        .slice(1, 3)
        .map((c) => c.model)
        .sort(),
    ).toEqual(['debugger-fixture', 'reviewer-fixture']);
    expect(calls.slice(3).map((c) => c.model)).toEqual([
      'coordinator-fixture',
      'reviewer-fixture',
      'coordinator-fixture',
    ]);
    expect(calls[1]!.context).toEqual(calls[2]!.context);
    expect(calls[3]!.action!.recipientIds).toHaveLength(1);
    expect(calls[3]!.action!.replyTo).toBe(
      calls[3]!.context.find((m) => m.body.includes('reviewer-fixture'))!.id,
    );
    await expect(page.locator('.message-body')).not.toContainText(['"recipientIds"']);
    const followUp = page.locator('.message.question').last();
    await expect(followUp.locator('.address-line')).toContainText('To AI C');
    const cSequence = await page
      .locator('.message.answer')
      .filter({ hasText: 'reviewer-fixture' })
      .first()
      .locator('.message-sequence')
      .innerText();
    await expect(followUp.locator('.address-line')).toContainText(`replying to ${cSequence}`);
    await followUp.getByRole('button', { name: 'Inspect context' }).click();
    await expect(page.locator('dialog')).toContainText('Coordinator chose ask');
    await expect(page.locator('dialog')).toContainText('Input tokens: 24');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.locator('.message-scroll').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: 'test-results/live-discussion.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'test-results/mobile-discussion.png', fullPage: true });
    await page.reload();
    await expect(page.getByLabel('Discussion progress')).toContainText('6 / 8 turns used');
    expect(errors).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

test('a discussion can be stopped from its card while the room remains usable', async ({
  page,
}) => {
  await createRoom(page);
  await page.getByLabel('Message type').selectOption('discussion');
  await page.getByLabel('Message', { exact: true }).fill('Wait for human review. [simulate:slow]');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Stop discussion', exact: true }).click();
  await expect(page.getByLabel('Discussion progress')).toContainText('cancelled');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByLabel('Message type').selectOption('update');
  await page
    .getByLabel('Message', { exact: true })
    .fill('Continue independently after stopping that discussion.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.message.update')).toHaveCount(1);
});

test('switching rooms hides the old composer until the selected room loads', async ({ page }) => {
  await createRoom(page);
  await page.getByLabel('Message', { exact: true }).fill('Draft belonging to the previous room.');
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const roomUrl = /\/api\/rooms\/[a-zA-Z0-9_-]+$/;
  await page.route(roomUrl, async (route) => {
    if (route.request().method() === 'GET') await gate;
    await route.continue();
  });
  try {
    const title = `Delayed room ${randomUUID().slice(0, 8)}`;
    await page.getByRole('button', { name: 'New workspace', exact: true }).click();
    await page.getByLabel('Workspace name').fill(title);
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page.locator('dialog')).toHaveCount(0);
    await expect(page.getByText('Opening room…', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Message', { exact: true })).toHaveCount(0);
    release();
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
    await page.getByLabel('Message', { exact: true }).fill('Draft belonging to the selected room.');
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Draft belonging to the selected room.',
    );
  } finally {
    release();
    await page.unroute(roomUrl);
  }
});

test('settings persist, preserve open drafts, configure the workspace and participants, and seed new defaults', async ({
  page,
}, testInfo) => {
  page.setDefaultTimeout(5000);
  const { token } = (await (await page.request.get('/api/session')).json()) as { token: string };
  const headers = { 'X-AIB-Token': token };
  const original = (await (
    await page.request.get('/api/settings', { headers })
  ).json()) as AppSettings;
  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await createRoom(page);
    await page
      .getByLabel('Message', { exact: true })
      .fill('Keep this draft while opening Settings.');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/#settings$/);
    await page.getByLabel('Theme', { exact: true }).selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByLabel('Default workspace turn limit').fill('47');
    await page.getByLabel('Default response deadline (seconds)').fill('35');
    await page.getByLabel('Default response policy').selectOption('any');
    await page.getByLabel('Default synthesis').selectOption('false');
    await page.getByLabel('Default discussion peer rounds').fill('2');
    await page.getByLabel('Default discussion turn allowance').fill('8');
    await page.getByRole('button', { name: 'Save defaults', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Defaults saved.');
    await page.getByRole('button', { name: 'Back to conversation' }).click();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Keep this draft while opening Settings.',
    );
    await expect(page.getByLabel('Response deadline in seconds')).toHaveValue(
      String(original.defaultDeadlineSeconds),
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const renamed = `Configured workspace ${randomUUID().slice(0, 8)}`;
    await page.getByLabel('Workspace name', { exact: true }).fill(renamed);
    await page
      .getByLabel('Shared objective', { exact: true })
      .fill('Review evidence and resolve the remaining questions.');
    await page.getByLabel('Workspace turn limit', { exact: true }).fill('80');
    await page.getByRole('button', { name: 'Save workspace', exact: true }).click();
    await expect(page.locator('.workspace-settings-form')).toContainText(
      'Workspace settings saved.',
    );
    await page
      .getByRole('button', { name: 'Configure AI A', exact: true })
      .filter({ visible: true })
      .click();
    await page.getByLabel('Participant name').fill('Coordinator');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.locator('dialog')).toContainText('Settings saved.');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel('Default workspace turn limit')).toHaveValue('47');
    await expect(page.getByLabel('Workspace name', { exact: true })).toHaveValue(renamed);
    await expect(
      page
        .getByRole('button', { name: 'Configure Coordinator', exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByLabel('Theme', { exact: true }).selectOption('dark');
    await page.screenshot({
      path: 'test-results/settings.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page
        .getByRole('button', { name: 'Configure Coordinator', exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: 'test-results/settings-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Back to conversation' }).click();
    await page.getByRole('button', { name: 'New workspace', exact: true }).click();
    await expect(page.getByLabel('Turn limit', { exact: true })).toHaveValue('47');
    const fresh = `Default workspace ${randomUUID().slice(0, 8)}`;
    await page.getByLabel('Workspace name', { exact: true }).fill(fresh);
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page.getByRole('heading', { name: fresh, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByLabel('Response policy')).toHaveValue('any');
    await expect(page.getByLabel('Response deadline in seconds')).toHaveValue('35');
    await expect(page.getByLabel('AI A synthesizes')).not.toBeChecked();
    await page.getByLabel('Message type').selectOption('discussion');
    await expect(page.getByLabel('Maximum peer rounds', { exact: true })).toHaveValue('2');
    await expect(page.getByLabel('Discussion turn allowance', { exact: true })).toHaveValue('8');
  } finally {
    testInfo.setTimeout(testInfo.timeout + 5000);
    expect((await page.request.put('/api/settings', { headers, data: original })).ok()).toBe(true);
  }
});

test('thread deletion confirms the target, cancels an active discussion, preserves another thread, and survives reload', async ({
  page,
}) => {
  const title = await createRoom(page);
  await page.getByLabel('Message type').selectOption('update');
  await page.getByLabel('Message', { exact: true }).fill('Keep this separate update thread.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.message.update')).toHaveCount(1);
  await page.getByRole('button', { name: 'All messages' }).click();
  await page.getByLabel('Message type').selectOption('discussion');
  const body = '[simulate:slow] Delete this active discussion.';
  await page.getByLabel('Message', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.message.answer .badge.streaming')).toHaveCount(1);
  const deleteThread = page.getByRole('button', { name: `Delete thread ${body}`, exact: true });
  await deleteThread.click();
  await expect(page.getByRole('dialog', { name: 'Delete thread?' })).toContainText(body);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(deleteThread).toBeVisible();
  await deleteThread.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete thread', exact: true })
    .click();
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(deleteThread).toHaveCount(0);
  await expect(page.locator('.thread-entry')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: title, level: 1, exact: true })).toBeVisible();
  await expect(page.locator('.message.update')).toContainText('Keep this separate update thread.');
  await expect(page.locator('.message.answer')).toHaveCount(0);
  await expect(page.locator('.budget-card')).toContainText('1 / 100');
  await page.reload();
  await expect(page.locator('.thread-entry')).toHaveCount(1);
  await expect(page.locator('.message.answer')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: title, level: 1, exact: true })).toBeVisible();
  const { token } = (await (await page.request.get('/api/session')).json()) as { token: string };
  const rooms = (await (
    await page.request.get('/api/rooms', { headers: { 'X-AIB-Token': token } })
  ).json()) as { id: string; title: string }[];
  const exported = await (
    await page.request.get(`/api/rooms/${rooms.find((r) => r.title === title)!.id}/export`, {
      headers: { 'X-AIB-Token': token },
    })
  ).text();
  expect(exported).not.toContain(body);
  await page.getByLabel('Message type').selectOption('update');
  await page.getByLabel('Message', { exact: true }).fill('Continue after deleting that thread.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'All messages' }).click();
  await expect(page.locator('.message.update')).toHaveCount(2);
  await page.getByLabel('Message type').selectOption('question');
  await page
    .getByLabel('Message', { exact: true })
    .fill('Consult after deleting the earlier discussion.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  // Streamed simulation can outlast the default five-second assertion under CI load.
  // Wait for this exact request's authoritative completion before deleting its context.
  await expect
    .poll(
      async () => {
        const { room } = await workspaceRecord(page, title);
        const request = room.requests.find(
          (r) =>
            room.messages.find((m) => m.id === r.messageId)?.body ===
            'Consult after deleting the earlier discussion.',
        );
        return room.jobs.find((job) => job.requestId === request?.id && job.kind === 'synthesis')
          ?.status;
      },
      { timeout: 10000 },
    )
    .toBe('completed');
  await expect(
    page.locator('.message.synthesis').getByRole('button', { name: 'Reply to AI A', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Delete thread Keep this separate update thread.', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete thread', exact: true })
    .click();
  await expect(page.locator('dialog')).toHaveCount(0);
  await page
    .locator('.message.answer')
    .first()
    .getByRole('button', { name: 'Inspect context' })
    .click();
  await expect(page.getByRole('dialog')).toContainText(
    '1 source message was removed by thread deletion',
  );
  await expect(page.getByRole('dialog')).not.toContainText('Keep this separate update thread.');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const redactedExport = await (
    await page.request.get(`/api/rooms/${rooms.find((r) => r.title === title)!.id}/export`, {
      headers: { 'X-AIB-Token': token },
    })
  ).text();
  expect(redactedExport).toContain('historical context is redacted');
  expect(redactedExport).not.toContain('Keep this separate update thread.');
});

test('workspace deletion works from Settings and updates another open view without losing the remaining workspace', async ({
  page,
  context,
}) => {
  const kept = await createRoom(page);
  const deleted = await createRoom(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const second = await context.newPage();
  second.on('pageerror', (e) => errors.push(e.message));
  try {
    await second.goto('/');
    await expect(
      second.getByRole('heading', { name: deleted, exact: true, level: 1 }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Delete workspace', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Delete workspace?' })).toContainText(deleted);
    await page.screenshot({ path: 'test-results/delete-workspace.png', fullPage: true });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      page.getByRole('button', { name: `Delete workspace ${deleted}`, exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Delete workspace', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete workspace', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: `Delete workspace ${deleted}`, exact: true }),
    ).toHaveCount(0);
    await expect(second.getByRole('heading', { name: kept, exact: true, level: 1 })).toBeVisible();
    await expect(second.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to conversation' }).click();
    await expect(page.getByRole('heading', { name: kept, exact: true, level: 1 })).toBeVisible();
    await page.getByLabel('Message type').selectOption('update');
    await page.getByLabel('Message', { exact: true }).fill('The remaining workspace is usable.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(second.locator('.message.update')).toContainText(
      'The remaining workspace is usable.',
    );
    expect(errors).toEqual([]);
  } finally {
    await second.close();
  }
});

test('deleting the final workspace leaves an empty app across a service restart and permits creating a new workspace', async ({
  page,
}) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { spawn } = await import('node:child_process');
  const { createServer } = await import('node:net');
  const directory = await mkdtemp(join(tmpdir(), 'aib-ui-empty-'));
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, '127.0.0.1', done));
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable');
  const port = address.port;
  await new Promise<void>((done) => socket.close(() => done()));
  const base = `http://127.0.0.1:${port}`;
  function start() {
    return spawn(process.execPath, ['dist/server/server/main.js'], {
      env: {
        ...process.env,
        AIB_PORT: String(port),
        AIB_DATA_DIR: directory,
        OPENAI_API_KEY: '',
        XAI_API_KEY: '',
        GEMINI_API_KEY: '',
        AIB_COMPATIBLE_API_KEY: '',
      },
      stdio: 'ignore',
    });
  }
  async function ready() {
    await expect
      .poll(
        async () => {
          try {
            return (await page.request.get(`${base}/api/session`)).status();
          } catch {
            return 0;
          }
        },
        { timeout: 10000 },
      )
      .toBe(200);
  }
  let service = start();
  async function stop() {
    if (service.exitCode !== null || service.signalCode !== null) return;
    const done = new Promise<void>((resolve) => service.once('exit', () => resolve()));
    service.kill('SIGTERM');
    await done;
  }
  try {
    await ready();
    await page.goto(base);
    await expect(
      page.getByRole('heading', { name: 'The first conversation', exact: true, level: 1 }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Delete workspace The first conversation', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete workspace', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'No workspaces yet.' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'No workspaces yet.' })).toBeVisible();
    await stop();
    service = start();
    await ready();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'No workspaces yet.' })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Default workspace turn limit').fill('23');
    await page.getByRole('button', { name: 'Save defaults', exact: true }).click();
    await expect(
      page.getByRole('main', { name: 'Settings', exact: true }).getByRole('status'),
    ).toContainText('Defaults saved.');
    await page.getByRole('button', { name: 'Back to conversation' }).click();
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page.getByLabel('Turn limit', { exact: true })).toHaveValue('23');
    await page.getByLabel('Workspace name', { exact: true }).fill('A fresh workspace');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Create workspace', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'A fresh workspace', exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel('Response policy')).toHaveValue(defaultAppSettings.defaultPolicy);
    await expect(page.locator('.budget-card')).toContainText('0 / 23');
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('one and two participant workspaces send, synthesize, relay, and finish a coordinator discussion', async ({
  page,
}) => {
  test.setTimeout(45000);
  await createRoom(page, 2);
  await page.getByLabel('Message', { exact: true }).fill('Compare two participant perspectives.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('SIMULATED SYNTHESIS', { exact: false })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator('.message.synthesis .badge.streaming')).toHaveCount(0);
  await expect(page.locator('.message.answer')).toHaveCount(1);
  await createRoom(page, 1);
  await expect(page.getByLabel('AI A', { exact: true })).toBeChecked();
  await expect(page.getByLabel('No separate synthesizer')).toBeDisabled();
  await page.getByLabel('Message', { exact: true }).fill('Answer from this single participant.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.message.answer')).toHaveCount(1);
  await expect(page.locator('.message.answer .badge.streaming')).toHaveCount(0);
  await page.getByLabel('Message type').selectOption('relay');
  await expect(page.getByLabel('Relay step 1').locator('option')).toHaveCount(1);
  await expect(page.getByLabel('Relay step 1').locator('option')).toHaveText('AI A');
  await expect(page.locator('.relay-editor select')).toHaveCount(1);
  await page.getByLabel('Message', { exact: true }).fill('Run a single hop.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Relay progress')).toContainText('completed', { timeout: 12000 });
  await page.getByLabel('Message type').selectOption('discussion');
  await page
    .getByLabel('Message', { exact: true })
    .fill('Finish without asking nonexistent peers.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('SIMULATED DISCUSSION RESULT', { exact: false })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByLabel('Discussion progress')).toContainText('completed');
  await expect(page.locator('.message.synthesis')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Deactivate AI A', exact: true })).toBeDisabled();
});

test('larger rosters preserve drafts, remove inactive recipients, clamp quorum, keep added participants optional, and retain activation history', async ({
  page,
}) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await createRoom(page, 5);
  await page.getByLabel('AI A synthesizes').uncheck();
  await page.getByLabel('Response policy').selectOption('quorum');
  await page.getByLabel('Required answers').fill('4');
  await page.getByLabel('Message', { exact: true }).fill('Keep this draft during roster changes.');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Add participant', exact: true }).click();
  await page.getByLabel('New participant name').fill('Added reviewer');
  await page.getByLabel('New participant role').fill('Provide another independent viewpoint.');
  await page.getByRole('button', { name: 'Create participant', exact: true }).click();
  await expect(page.locator('.settings-participant')).toHaveCount(6);
  await expect(page.getByRole('status')).toContainText('Participant added in simulation.');
  await page.getByRole('button', { name: 'Deactivate AI B', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reactivate AI B', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep this draft during roster changes.',
  );
  await expect(page.getByLabel('AI B', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('AI C', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Added reviewer', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Required answers')).toHaveValue('3');
  await expect(page.locator('.composer')).toContainText('Participants changed.');
  await expect(page.locator('.agent-card')).toHaveCount(5);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Deactivate AI C', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add participant', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await expect(page.locator('.response-set')).toContainText('3 / 3 received', { timeout: 15000 });
  await expect(page.locator('.message.answer')).toHaveCount(3);
  await expect(page.locator('.message.synthesis')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Reactivate AI B', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Deactivate AI B', exact: true })).toBeEnabled();
  const history = page
    .locator('.settings-participant')
    .filter({ has: page.getByRole('button', { name: 'Configure AI B', exact: true }) });
  await history.locator('summary').click();
  await expect(history).toContainText('Revision 1 · Inactive');
  await expect(history).toContainText('Revision 2 · Active');
  await page.reload();
  await expect(page.locator('.settings-participant')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Deactivate AI B', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Add participant', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/roster-mobile.png', fullPage: true });
});

test('renamed and deactivated participants retain historical labels, directed reply identity, and exported attribution', async ({
  page,
}) => {
  test.setTimeout(45000);
  const title = await createRoom(page);
  await page.getByLabel('AI C', { exact: true }).uncheck();
  await page.getByLabel('AI A synthesizes').uncheck();
  await page
    .getByLabel('Message', { exact: true })
    .fill('Save an answer with its original author.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('article', { name: 'AI B answer', exact: true })).toBeVisible();
  await expect(page.locator('.message.answer .badge.streaming')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Configure AI B', exact: true }).click();
  await page.getByLabel('Participant name').fill('Renamed reviewer');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.locator('dialog')).toContainText('Settings saved.');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Deactivate Renamed reviewer', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Reactivate Renamed reviewer', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  const original = page.getByRole('article', { name: 'AI B answer', exact: true });
  await expect(original).toBeVisible();
  await expect(
    original.getByRole('button', { name: 'Reply to Renamed reviewer', exact: true }),
  ).toBeDisabled();
  await original.getByRole('button', { name: 'Inspect context' }).click();
  await expect(page.locator('dialog')).toContainText('AI B');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Manage inactive participants', exact: true }).click();
  await page.getByRole('button', { name: 'Reactivate Renamed reviewer', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Deactivate Renamed reviewer', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await original.getByRole('button', { name: 'Reply to Renamed reviewer', exact: true }).click();
  await expect(page.getByLabel('Renamed reviewer', { exact: true })).toBeChecked();
  await page
    .getByLabel('Message', { exact: true })
    .fill('Follow up to the same stable participant.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByRole('article', { name: 'Renamed reviewer answer', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.message.answer .badge.streaming')).toHaveCount(0);
  await expect(original).toBeVisible();
  const { token } = (await (await page.request.get('/api/session')).json()) as { token: string };
  const rooms = (await (
    await page.request.get('/api/rooms', { headers: { 'X-AIB-Token': token } })
  ).json()) as { id: string; title: string }[];
  const room = rooms.find((r) => r.title === title)!;
  const exported = await (
    await page.request.get('/api/rooms/' + room.id + '/export', {
      headers: { 'X-AIB-Token': token },
    })
  ).text();
  expect(exported).toContain('## AI B · answer');
  expect(exported).toContain('## Renamed reviewer · answer');
  await page.reload();
  await expect(page.getByRole('article', { name: 'AI B answer', exact: true })).toBeVisible();
});

test('roster changes in another open view clear unavailable reply targets while preserving drafts and explicit selection', async ({
  page,
  context,
}) => {
  test.setTimeout(30000);
  const title = await createRoom(page);
  await page.getByLabel('AI C', { exact: true }).uncheck();
  await page.getByLabel('AI A synthesizes').uncheck();
  await page.getByLabel('Message', { exact: true }).fill('Establish a reply target.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.message.answer .badge.streaming')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reply to AI B', exact: true }).click();
  await page
    .getByLabel('Message', { exact: true })
    .fill('Preserve this draft across another view.');
  const other = await context.newPage();
  try {
    await other.goto('/');
    await other.getByRole('button', { name: title + ' Open conversation', exact: true }).click();
    await other.getByRole('button', { name: 'Settings', exact: true }).click();
    await other.getByRole('button', { name: 'Deactivate AI B', exact: true }).click();
    await expect(page.getByLabel('AI B', { exact: true })).toHaveCount(0);
    await expect(page.locator('.reply-indicator')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Preserve this draft across another view.',
    );
    await other.getByRole('button', { name: 'Reactivate AI B', exact: true }).click();
    await expect(page.getByLabel('AI B', { exact: true })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await page.getByLabel('AI B', { exact: true }).check();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.message.answer')).toHaveCount(2);
    await expect(page.locator('.message.answer .badge.streaming')).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test('duplicate participant names have distinct selectable labels and route only to the chosen identity', async ({
  page,
}) => {
  test.setTimeout(30000);
  const title = await createRoom(page, 1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Add participant', exact: true }).click();
  await page.getByLabel('New participant name').fill('AI A');
  await page.getByLabel('New participant role').fill('Second instance with independent context.');
  await page.getByRole('button', { name: 'Create participant', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Configure AI A · #2', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await page.getByLabel('AI A · #1', { exact: true }).uncheck();
  await page.getByLabel('AI A · #2', { exact: true }).check();
  await page.getByLabel('AI A · #1 synthesizes').uncheck();
  await page.getByLabel('Message', { exact: true }).fill('Ask only the second instance.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('article', { name: 'AI A · #2 answer', exact: true })).toBeVisible();
  await expect(page.locator('.message.answer .badge.streaming')).toHaveCount(0);
  await expect(page.locator('.message.answer')).toHaveCount(1);
  const { token } = (await (await page.request.get('/api/session')).json()) as { token: string };
  const headers = { 'X-AIB-Token': token };
  const rooms = (await (await page.request.get('/api/rooms', { headers })).json()) as {
    id: string;
    title: string;
  }[];
  const roomId = rooms.find((room) => room.title === title)!.id;
  const room = (await (await page.request.get('/api/rooms/' + roomId, { headers })).json()) as {
    agents: { id: string }[];
    jobs: { agentId: string }[];
    turnsUsed: number;
  };
  expect(room.jobs.map((job) => job.agentId)).toEqual([room.agents[1]!.id]);
  expect(room.turnsUsed).toBe(1);
});

test('workspace search matches titles and objectives, separates archives, and keeps the selected draft', async ({
  page,
}) => {
  const firstTitle = await createRoom(page, 1);
  const first = await workspaceRecord(page, firstTitle);
  const group = 'Search ' + randomUUID().slice(0, 8);
  const firstName = group + ' alpha';
  expect(
    (
      await page.request.put('/api/rooms/' + first.room.id + '/settings', {
        headers: first.headers,
        data: { title: firstName, objective: 'Laser COOLANT [a+b]', maxTurns: 100 },
      })
    ).ok(),
  ).toBe(true);
  const secondTitle = await createRoom(page, 1);
  const second = await workspaceRecord(page, secondTitle);
  const secondName = group + ' beta';
  expect(
    (
      await page.request.put('/api/rooms/' + second.room.id + '/settings', {
        headers: second.headers,
        data: { title: secondName, objective: 'Different objective', maxTurns: 100 },
      })
    ).ok(),
  ).toBe(true);
  await expect(
    page.getByRole('heading', { name: secondName, exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByLabel('Message', { exact: true }).fill('Keep this workspace search draft');
  await page.getByLabel('Search workspaces').fill(group.toUpperCase());
  await expect(page.locator('.room-item')).toHaveCount(2);
  await page.getByLabel('Search workspaces').fill(' coolant ');
  await expect(page.locator('.room-item')).toHaveCount(1);
  await expect(page.locator('.room-item')).toContainText(firstName);
  await expect(
    page.getByRole('heading', { name: secondName, exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep this workspace search draft',
  );
  await page.getByLabel('Search workspaces').fill('[a+b]');
  await expect(page.locator('.room-item')).toHaveCount(1);
  await page.getByLabel('Search workspaces').fill('.*');
  await expect(page.getByText('No matching workspaces.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear workspace search' }).click();
  await page.getByLabel('Search workspaces').fill(group);
  expect(
    (
      await page.request.put('/api/rooms/' + first.room.id + '/archive', {
        headers: first.headers,
        data: { archived: true },
      })
    ).ok(),
  ).toBe(true);
  await expect(page.locator('.room-item')).toHaveCount(1);
  await expect(page.locator('.room-item')).toContainText(secondName);
  await page.getByLabel('Workspace view').selectOption('archived');
  await expect(page.locator('.room-item')).toHaveCount(1);
  await expect(page.locator('.room-item')).toContainText(firstName);
  await page.getByLabel('Workspace view').selectOption('all');
  await expect(page.locator('.room-item')).toHaveCount(2);
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep this workspace search draft',
  );
});

test('thread names and message bodies are searchable with safe snippets, preserved drafts, and deletion reconciliation', async ({
  page,
}) => {
  const title = await createRoom(page, 1);
  const needle = 'Needle' + randomUUID().slice(0, 8);
  await page.getByLabel('Message type').selectOption('update');
  await page
    .getByLabel('Message', { exact: true })
    .fill('Original thread ' + 'x'.repeat(200) + ' ' + needle + ' payload');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.thread-entry')).toHaveCount(1);
  await page.getByRole('button', { name: /^All messages/ }).click();
  await page
    .getByLabel('Message', { exact: true })
    .fill('Other thread ' + 'y'.repeat(150) + ' [a+b] <img src=x onerror="window.__searchXss=1">');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.thread-entry')).toHaveCount(2);
  const { room, headers } = await workspaceRecord(page, title);
  const originalName = room.threads[0]!.title;
  await page
    .locator('.thread-entry')
    .filter({ hasText: originalName })
    .locator('button')
    .first()
    .click();
  await page.getByLabel('Message', { exact: true }).fill('Unsent rename draft');
  await page.getByRole('button', { name: 'Rename thread ' + originalName, exact: true }).click();
  await page.getByLabel('Thread name').fill('Cancelled name');
  await page
    .getByRole('dialog', { name: 'Rename thread', exact: true })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  expect((await workspaceRecord(page, title)).room.threads[0]!.title).toBe(originalName);
  await page.getByRole('button', { name: 'Rename thread ' + originalName, exact: true }).click();
  const renamed = 'Evidence review ' + needle;
  await page.getByLabel('Thread name').fill(renamed);
  await page.getByRole('button', { name: 'Save thread name', exact: true }).click();
  await expect(page.getByRole('heading', { name: renamed, exact: true, level: 1 })).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Unsent rename draft');
  await page.getByLabel('Search threads').fill(needle.toUpperCase());
  await expect(page.locator('.thread-entry')).toHaveCount(1);
  await expect(page.locator('.search-snippet')).toContainText(needle);
  await page.getByLabel('Search threads').fill('[a+b]');
  await expect(page.locator('.thread-entry')).toHaveCount(1);
  await expect(page.locator('.search-snippet')).toContainText('<img');
  expect(
    await page.evaluate(() => (window as Window & { __searchXss?: number }).__searchXss),
  ).toBeUndefined();
  await expect(page.locator('.search-snippet img')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: renamed, exact: true, level: 1 })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/search-mobile.png', fullPage: true });
  expect(
    (
      await page.request.delete('/api/rooms/' + room.id + '/threads/' + room.threads[1]!.id, {
        headers,
      })
    ).ok(),
  ).toBe(true);
  await expect(page.getByText('No matching threads.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Unsent rename draft');
  await page.getByRole('button', { name: 'Clear thread search' }).click();
  await expect(page.locator('.thread-entry')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.thread-label')).toContainText(renamed);
});

test('archive confirmation retains history and drafts, disables work, supports export and reload, and restores paused', async ({
  page,
}) => {
  const title = await createRoom(page);
  await page.getByLabel('AI A synthesizes').uncheck();
  await page.getByLabel('AI B', { exact: true }).uncheck();
  await page.getByLabel('AI C', { exact: true }).uncheck();
  await page.getByLabel('AI A', { exact: true }).check();
  await page
    .getByLabel('Message', { exact: true })
    .fill('Retain this answer through archive and restore');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const answer = page.getByRole('article', { name: 'AI A answer', exact: true });
  await expect(answer.getByRole('button', { name: 'Reply to AI A', exact: true })).toBeEnabled();
  await page.getByLabel('Message', { exact: true }).fill('Archive draft stays here');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Archive workspace', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Archive workspace?', exact: true });
  await expect(confirm).toContainText(title);
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await workspaceRecord(page, title)).room.archivedAt).toBeNull();
  await page.getByRole('button', { name: 'Archive workspace', exact: true }).click();
  await confirm.getByRole('button', { name: 'Archive workspace', exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Archived workspace', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Workspace view')).toHaveValue('archived');
  await expect(page.getByLabel('Workspace name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add participant', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Deactivate AI B', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Configure AI A', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Configure AI A', exact: true });
  await expect(settings.getByRole('button', { name: 'Save settings', exact: true })).toBeDisabled();
  await expect(
    settings.getByRole('button', { name: 'Test connection', exact: true }),
  ).toBeDisabled();
  await expect(
    settings.getByRole('button', { name: 'Test coordinator', exact: true }),
  ).toBeDisabled();
  await settings.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Archive draft stays here');
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled();
  await expect(answer.getByRole('button', { name: 'Reply to AI A', exact: true })).toBeDisabled();
  await answer.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Retain this answer');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export conversation', exact: true }).click();
  const path = await (await download).path();
  const { readFile } = await import('node:fs/promises');
  const transcript = await readFile(path!, 'utf8');
  expect(transcript).toContain('Workspace archived:');
  expect(transcript).toContain('Retain this answer');
  expect((await workspaceRecord(page, title)).room.turnsUsed).toBe(1);
  await page.screenshot({ path: 'test-results/archived-workspace.png', fullPage: true });
  await page.reload();
  await page.getByLabel('Workspace view').selectOption('archived');
  await page.getByLabel('Search workspaces').fill(title);
  await page.locator('.room-item').filter({ hasText: title }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await expect(answer).toBeVisible();
  await page.getByRole('button', { name: 'Restore workspace', exact: true }).click();
  const restore = page.getByRole('dialog', { name: 'Restore workspace?', exact: true });
  await restore.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await workspaceRecord(page, title)).room.archivedAt).toBeTruthy();
  await page.getByRole('button', { name: 'Restore workspace', exact: true }).click();
  await restore.getByRole('button', { name: 'Restore workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  expect((await workspaceRecord(page, title)).room.status).toBe('paused');
  expect((await workspaceRecord(page, title)).room.turnsUsed).toBe(1);
});

test('archiving in another view respects pending work and preserves a read-only draft until explicit restore', async ({
  page,
}) => {
  const title = await createRoom(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  await page.getByLabel('Message', { exact: true }).fill('Queue this pending request');
  await page.getByRole('button', { name: 'Queue', exact: true }).click();
  await expect(page.locator('.thread-entry')).toHaveCount(1);
  await page.getByLabel('Message', { exact: true }).fill('Cross-view archive draft');
  const second = await page.context().newPage();
  try {
    await second.goto('/');
    await expect(second.getByRole('heading', { level: 1 })).not.toContainText('Opening room');
    await second.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(
      second.getByRole('button', { name: 'Archive workspace', exact: true }),
    ).toBeDisabled();
    await second.getByRole('button', { name: 'Back to conversation', exact: true }).click();
    await second.getByRole('button', { name: 'Stop', exact: true }).click();
    await second.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(
      second.getByRole('button', { name: 'Archive workspace', exact: true }),
    ).toBeEnabled();
    await second.getByRole('button', { name: 'Archive workspace', exact: true }).click();
    await second
      .getByRole('dialog', { name: 'Archive workspace?', exact: true })
      .getByRole('button', { name: 'Archive workspace', exact: true })
      .click();
    await expect(page.locator('.archived-notice')).toBeVisible();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Cross-view archive draft',
    );
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    expect((await workspaceRecord(page, title)).room.turnsUsed).toBe(0);
    await page.getByLabel('Search threads').fill('pending');
    await expect(page.locator('.thread-entry')).toHaveCount(1);
    await second.getByRole('button', { name: 'Restore workspace', exact: true }).click();
    await second
      .getByRole('dialog', { name: 'Restore workspace?', exact: true })
      .getByRole('button', { name: 'Restore workspace', exact: true })
      .click();
    await expect(page.locator('.archived-notice')).not.toBeVisible();
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Cross-view archive draft',
    );
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
    const record = (await workspaceRecord(page, title)).room;
    expect(record.jobs.every((job) => job.status === 'cancelled')).toBe(true);
    expect(record.turnsUsed).toBe(0);
  } finally {
    await second.close();
  }
});

test('a service with only archived workspaces reopens its retained history after restart without reseeding or invoking', async ({
  page,
}) => {
  const service = await isolatedService(page);
  try {
    await service.ready();
    await page.goto(service.base);
    await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
    await page.getByLabel('Message type').selectOption('update');
    await page.getByLabel('Message', { exact: true }).fill('Restart archive evidence');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.thread-entry')).toHaveCount(1);
    const { token } = (await (await page.request.get(service.base + '/api/session')).json()) as {
      token: string;
    };
    const headers = { 'X-AIB-Token': token };
    const rooms = (await (
      await page.request.get(service.base + '/api/rooms', { headers })
    ).json()) as RoomSummary[];
    expect(rooms).toHaveLength(1);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Archive workspace', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Archive workspace?', exact: true })
      .getByRole('button', { name: 'Archive workspace', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Archived workspace', exact: true }),
    ).toBeVisible();
    await page.goto('about:blank');
    await service.restart();
    await page.goto(service.base);
    await expect(page.getByLabel('Workspace view')).toHaveValue('archived');
    await expect(page.locator('.room-item')).toHaveCount(1);
    await expect(page.locator('.archived-notice')).toBeVisible();
    await expect(page.getByRole('article', { name: 'You update', exact: true })).toContainText(
      'Restart archive evidence',
    );
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    const fresh = (await (await page.request.get(service.base + '/api/session')).json()) as {
      token: string;
    };
    const recovered = (await (
      await page.request.get(service.base + '/api/rooms', {
        headers: { 'X-AIB-Token': fresh.token },
      })
    ).json()) as RoomSummary[];
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.id).toBe(rooms[0]!.id);
    await page.getByRole('button', { name: 'Restore workspace', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Restore workspace?', exact: true })
      .getByRole('button', { name: 'Restore workspace', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Workspace view')).toHaveValue('active');
    const record = (await (
      await page.request.get(service.base + '/api/rooms/' + rooms[0]!.id, {
        headers: { 'X-AIB-Token': fresh.token },
      })
    ).json()) as Room;
    expect(record.turnsUsed).toBe(0);
    expect(record.jobs).toHaveLength(0);
    expect(record.status).toBe('paused');
  } finally {
    await page.goto('about:blank');
    await service.close();
  }
});
