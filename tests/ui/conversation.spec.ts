import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import type { AgentAction } from '../../src/shared/contracts.js';

async function createRoom(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New room', exact: true }).click();
  const title = `Conversation ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Room name').fill(title);
  await page.getByLabel('Shared objective').fill('Investigate the delivery sequence.');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start a conversation.' })).toBeVisible();
  await expect(page.locator('.agent-card')).toHaveCount(3);
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: 'New room', exact: true }).click();
    await page.getByLabel('Room name').fill(title);
    await page.getByRole('button', { name: 'Create room', exact: true }).click();
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
