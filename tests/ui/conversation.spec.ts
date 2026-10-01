import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import {
  defaultAppSettings,
  type AgentAction,
  type AppSettings,
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
      .locator('.message-actions > span')
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
  await expect(page.locator('.message.update')).toHaveCount(2);
  await page.getByRole('button', { name: 'All messages' }).click();
  await page.getByLabel('Message type').selectOption('question');
  await page
    .getByLabel('Message', { exact: true })
    .fill('Consult after deleting the earlier discussion.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
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
    await expect(page.getByRole('status')).toContainText('Defaults saved.');
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
