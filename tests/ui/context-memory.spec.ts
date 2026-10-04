import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test as baseTest, expect, type Page } from '@playwright/test';
import type {
  ContextSummary,
  Room,
  SendResult,
  SummaryContext,
} from '../../src/shared/contracts.js';
import { isolatedService } from './isolated-service.js';

const test = baseTest.extend<{ memoryService: Awaited<ReturnType<typeof isolatedService>> }>({
  memoryService: async ({ browser }, use) => {
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
  context: async ({ browser, memoryService }, use) => {
    const context = await browser.newContext({ baseURL: memoryService.base });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});
interface Envelope {
  context: { id: string; body: string }[];
  contextSummary?: SummaryContext;
  omittedContextMessageIds?: string[];
  currentRequest: string;
}
async function fixture(page: Page, long = false) {
  const calls: { user: Envelope; system: string; agentId: string }[] = [];
  let bId = '';
  let cId = '';
  const bBody =
    'B: retain the design λ🙂. SECRET_ORIGINAL_CONTEXT. ' +
    (long ? 'Evidence '.repeat(1100) : 'Original evidence. '.repeat(60)) +
    'Tail evidence Ω🙂';
  const cBody =
    'C: replace the design. What evidence settles this? <img src=x onerror="window.contextInjected=true">';
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      const user = JSON.parse(payload.messages[1].content) as Envelope;
      const system = payload.messages[0].content as string;
      const agentId = system.includes(`participant ID is ${bId}.`) ? bId : cId;
      calls.push({ user, system, agentId });
      const body =
        user.currentRequest === 'Seed independent designs.'
          ? agentId === bId
            ? bBody
            : cBody
          : `Fixture reply ${agentId === bId ? 'B' : 'C'}: original claims stay attributable.`;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: body } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture unavailable');
  await page.goto('/');
  let headers = {
    'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
  };
  const created = await page.request.post('/api/rooms', {
    headers,
    data: {
      title: 'Memory ' + randomUUID().slice(0, 8),
      objective: 'Original design task',
      humanInstructions: 'Preserve independent claims λ🙂',
    },
  });
  expect(created.ok()).toBe(true);
  const room = (await created.json()) as Room;
  bId = room.agents[1]!.id;
  cId = room.agents[2]!.id;
  for (const agent of room.agents.slice(1))
    expect(
      (
        await page.request.post(`/api/rooms/${room.id}/agents`, {
          headers,
          data: {
            agentId: agent.id,
            name: agent.name,
            role: agent.role,
            provider: 'openai-compatible',
            model: 'context-protocol-fixture',
            baseUrl: `http://127.0.0.1:${address.port}`,
            maxOutputTokens: 4096,
            timeoutSeconds: 30,
          },
        })
      ).ok(),
    ).toBe(true);
  const seedResponse = await page.request.post(`/api/rooms/${room.id}/messages`, {
    headers,
    data: {
      clientId: randomUUID(),
      body: 'Seed independent designs.',
      type: 'question',
      recipientIds: room.agents.slice(1).map((agent) => agent.id),
    },
  });
  expect(seedResponse.ok()).toBe(true);
  const seed = (await seedResponse.json()) as SendResult;
  const record = async () =>
    (await (await page.request.get(`/api/rooms/${room.id}`, { headers })).json()) as Room;
  await expect
    .poll(async () => (await record()).jobs.filter((job) => job.status === 'completed').length)
    .toBe(2);
  await page.reload();
  await page.locator('.room-item').filter({ hasText: room.title }).click();
  await expect(
    page.getByRole('heading', { name: room.title, level: 1, exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Threads', exact: true })
    .locator('.thread-entry')
    .filter({ hasText: 'Seed independent designs.' })
    .locator('button')
    .first()
    .click();
  const seeded = (await record()).messages.filter((message) => message.type === 'answer');
  const sources = room.agents.slice(1).map((agent) => {
    const source = seeded.find((message) => message.authorId === agent.id);
    if (!source) throw new Error('Expected native fixture answer is missing');
    return source;
  });
  const createSummary = async (title = 'Stored summary') => {
    const current = await record();
    const response = await page.request.post(`/api/rooms/${room.id}/context-summaries`, {
      headers,
      data: {
        clientId: randomUUID(),
        expectedRevision: current.revision,
        threadId: seed.threadId,
        sourceIds: sources.map((source) => source.id),
        title,
        overview: 'The original design remains disputed.',
        disagreements: 'AI B retains the design; AI C replaces it. No agreement is assumed.',
        openQuestions: 'Which independent test decides between the claims?',
      },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()) as ContextSummary;
  };
  const refreshHeaders = async () => {
    headers = {
      'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
    };
  };
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  };
  return {
    room,
    seed,
    headers: () => headers,
    record,
    sources,
    createSummary,
    calls,
    bBody,
    cBody,
    close,
    refreshHeaders,
  };
}
async function form(
  page: Page,
  f: Awaited<ReturnType<typeof fixture>>,
  title = 'Reviewed summary λ🙂',
) {
  const panel = page.locator('.context-memory-panel');
  await panel.locator(':scope > summary').click();
  await panel.getByRole('button', { name: 'Create context summary', exact: true }).click();
  await panel.getByLabel('Summary title', { exact: true }).fill(title);
  for (const source of f.sources)
    await panel.getByLabel(`Summarize source #${source.sequence}`, { exact: true }).check();
  await panel
    .getByLabel('Summary overview', { exact: true })
    .fill('B and C retain separate, conflicting claims λ🙂.');
  await panel
    .getByLabel('Disagreements to preserve', { exact: true })
    .fill('AI B retains; AI C replaces. <svg onload="window.contextInjected=true">');
  await panel
    .getByLabel('Open questions to preserve', { exact: true })
    .fill('What independent evidence settles this?');
  return panel;
}

test('reviewed source summaries preserve disputes and drafts, retrieve exact originals safely, and fit narrow light/dark layouts', async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  try {
    await page.getByLabel('Message', { exact: true }).fill('Local composer draft');
    const observer = await context.newPage();
    await observer.goto('/');
    await observer.locator('.room-item').filter({ hasText: f.room.title }).click();
    await observer.getByLabel('Message', { exact: true }).fill('Other view draft');
    const panel = await form(page, f);
    await panel.getByRole('button', { name: 'Save context summary', exact: true }).click();
    await expect.poll(async () => (await f.record()).contextSummaries?.length ?? 0).toBe(1);
    expect(f.calls).toHaveLength(2);
    expect((await f.record()).turnsUsed).toBe(2);
    await panel.getByText('Reviewed summary λ🙂 · 2 sources', { exact: true }).click();
    await panel.getByText('Summary source ledger and originals', { exact: true }).click();
    await expect(panel.getByRole('note', { name: 'Frozen context summary' })).toContainText(
      'AI B retains; AI C replaces.',
    );
    await panel
      .getByRole('button', { name: `Retrieve original #${f.sources[0]!.sequence}`, exact: true })
      .click();
    const region = panel.getByRole('region', {
      name: `Original source #${f.sources[0]!.sequence}`,
    });
    await expect(region.locator('pre')).toHaveText(f.bBody);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await region
      .getByRole('button', { name: `Copy original #${f.sources[0]!.sequence}`, exact: true })
      .click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(f.bBody);
    expect(
      await page.evaluate(
        () => (window as unknown as { contextInjected?: boolean }).contextInjected,
      ),
    ).toBeUndefined();
    expect(f.calls).toHaveLength(2);
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Local composer draft');
    await expect(observer.getByLabel('Message', { exact: true })).toHaveValue('Other view draft');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.reload();
    await expect(page.getByLabel('Question context summary')).toContainText('Reviewed summary λ🙂');
  } finally {
    await f.close();
  }
});

test('explicit original inclusion reaches independent native requests, frozen inspection and per-thread local delivery cursors', async ({
  page,
}) => {
  const f = await fixture(page);
  try {
    const summary = await f.createSummary();
    await expect(page.getByLabel('Question context summary')).toContainText(summary.title);
    await page.getByLabel('Question context summary').selectOption(summary.id);
    await page.locator('.summary-choice > details > summary').click();
    await page.getByLabel(`Include original #${f.sources[0]!.sequence}`, { exact: true }).check();
    await page.locator('.synthesis-option input').uncheck();
    await page
      .getByLabel('Message', { exact: true })
      .fill('The summary is insufficient; compare the original evidence.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => f.calls.length).toBe(4);
    await expect
      .poll(async () => (await f.record()).jobs.filter((job) => job.status === 'completed').length)
      .toBe(4);
    expect(f.calls[2]!.user.contextSummary?.retrievedSourceIds).toEqual([f.sources[0]!.id]);
    expect(f.calls[2]!.user.context.find((message) => message.id === f.sources[0]!.id)?.body).toBe(
      f.bBody,
    );
    expect(f.calls[2]!.user.context.some((message) => message.id === f.sources[1]!.id)).toBe(false);
    expect(f.calls[3]!.user.context).toEqual(f.calls[2]!.user.context);
    const answer = page.locator('.message.answer').filter({ hasText: 'Fixture reply B:' });
    await answer.getByRole('button', { name: 'Inspect context', exact: true }).click();
    await expect(
      page.getByRole('dialog').getByRole('note', { name: 'Frozen context summary' }),
    ).toContainText(summary.disagreements);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const card = page.locator('.agent-card').filter({ hasText: 'AI B' });
    await card.getByText('Inspect supplied context', { exact: true }).click();
    await expect(card).toContainText('1 retrieved originals');
    await expect(card).toContainText('do not prove remote receipt');
    const before = (await f.record()).contextCursors;
    await page.reload();
    expect((await f.record()).contextCursors).toEqual(before);
  } finally {
    await f.close();
  }
});

test('reviewed model budgets expose exact omissions and clear when the model changes without altering earlier history', async ({
  page,
}) => {
  const f = await fixture(page, true);
  try {
    const before = await f.record();
    await page.getByRole('button', { name: 'Configure AI B', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Use a reviewed context budget for this model').check();
    await dialog.getByLabel('Model context text budget (characters)').fill('7000');
    await dialog.getByLabel('Context overflow rule').selectOption('trim_oldest');
    await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Settings saved');
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.locator('.synthesis-option input').uncheck();
    await page
      .getByLabel('Message', { exact: true })
      .fill('Follow up with the current protected task.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => f.calls.length).toBe(4);
    await expect
      .poll(async () => (await f.record()).jobs.filter((job) => job.status === 'completed').length)
      .toBe(4);
    expect(
      f.calls.slice(2).find((call) => call.agentId === f.room.agents[1]!.id)!.user
        .omittedContextMessageIds,
    ).toContain(f.sources[0]!.id);
    expect(
      f.calls
        .slice(2)
        .find((call) => call.agentId === f.room.agents[2]!.id)!
        .user.context.some((message) => message.id === f.sources[0]!.id),
    ).toBe(true);
    expect((await f.record()).messages.slice(0, 3)).toEqual(before.messages);
    await page
      .locator('.message.answer')
      .filter({ hasText: 'Fixture reply B:' })
      .getByRole('button', { name: 'Inspect context', exact: true })
      .click();
    const budget = page
      .getByRole('dialog')
      .getByRole('note', { name: 'Frozen model context budget' });
    await expect(budget).toContainText('/ 7000');
    await expect(budget).toContainText('original history messages omitted');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Configure AI B', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Model ID', { exact: true })
      .fill('another-context-model');
    await expect(
      page.getByRole('dialog').getByLabel('Use a reviewed context budget for this model'),
    ).not.toBeChecked();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    expect((await f.record()).agents[1]!.contextPolicy?.maxCharacters).toBe(7000);
  } finally {
    await f.close();
  }
});

test('stale summary reviews and lost acknowledgements require explicit refresh, preserve edits and save only the reviewed records', async ({
  page,
}) => {
  const f = await fixture(page);
  try {
    await page.getByLabel('Message', { exact: true }).fill('Composer draft stays');
    const panel = await form(page, f, 'Stale review');
    expect(
      (
        await page.request.post(`/api/rooms/${f.room.id}/messages`, {
          headers: f.headers(),
          data: {
            clientId: randomUUID(),
            body: 'Another view changed the workspace.',
            type: 'update',
            recipientIds: [],
          },
        })
      ).ok(),
    ).toBe(true);
    await panel.getByRole('button', { name: 'Save context summary', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('Workspace changed');
    await expect(panel.getByLabel('Summary overview')).toHaveValue(
      'B and C retain separate, conflicting claims λ🙂.',
    );
    await panel.getByRole('button', { name: 'Refresh summary review', exact: true }).click();
    await panel.getByRole('button', { name: 'Save context summary', exact: true }).click();
    await expect.poll(async () => (await f.record()).contextSummaries?.length ?? 0).toBe(1);
    await expect(panel.getByText('Stale review · 2 sources', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Create context summary', exact: true }).click();
    await panel.getByLabel('Summary title').fill('Lost acknowledgement');
    for (const source of f.sources)
      await panel.getByLabel(`Summarize source #${source.sequence}`, { exact: true }).check();
    await panel.getByLabel('Summary overview').fill('Preserve both claims.');
    await panel.getByLabel('Disagreements to preserve').fill('B retains; C replaces.');
    await panel.getByLabel('Open questions to preserve').fill('Which evidence settles it?');
    await page.route('**/api/rooms/*/context-summaries', async (route) => {
      await route.fetch();
      await route.abort('failed');
    });
    await panel.getByRole('button', { name: 'Save context summary', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('may have been saved');
    await expect(
      panel.getByRole('button', { name: 'Save context summary', exact: true }),
    ).toBeDisabled();
    await panel.getByRole('button', { name: 'Refresh summary review', exact: true }).click();
    await page.unroute('**/api/rooms/*/context-summaries');
    await expect.poll(async () => (await f.record()).contextSummaries?.length ?? 0).toBe(2);
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Composer draft stays');
    expect(f.calls).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test('restart retains cursors and summaries; source deletion redacts frozen memory and blocks stale selection while keeping drafts', async ({
  page,
  memoryService,
}) => {
  const f = await fixture(page);
  try {
    const summary = await f.createSummary();
    const followup = await page.request.post(`/api/rooms/${f.room.id}/messages`, {
      headers: f.headers(),
      data: {
        clientId: randomUUID(),
        body: 'Independent new thread',
        type: 'question',
        recipientIds: f.room.agents.slice(1).map((agent) => agent.id),
        context: { summaryId: summary.id, sourceIds: [] },
      },
    });
    expect(followup.ok()).toBe(true);
    await expect
      .poll(async () => (await f.record()).jobs.filter((job) => job.status === 'completed').length)
      .toBe(4);
    const before = await f.record();
    await memoryService.restart();
    await f.refreshHeaders();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: f.room.title, exact: true, level: 1 }),
    ).toBeVisible();
    expect((await f.record()).contextCursors).toEqual(before.contextCursors);
    expect((await f.record()).contextSummaries).toEqual(before.contextSummaries);
    expect(f.calls).toHaveLength(4);
    await page.getByLabel('Question context summary').selectOption(summary.id);
    await page.getByLabel('Message', { exact: true }).fill('Draft survives source deletion');
    expect(
      (
        await page.request.delete(`/api/rooms/${f.room.id}/threads/${f.seed.threadId}`, {
          headers: f.headers(),
        })
      ).ok(),
    ).toBe(true);
    await expect(
      page.getByText('The selected summary is unavailable.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Draft survives source deletion',
    );
    expect(JSON.stringify(await f.record())).not.toContain('SECRET_ORIGINAL_CONTEXT');
    await page
      .locator('.message.answer')
      .filter({ hasText: 'Fixture reply B:' })
      .getByRole('button', { name: 'Inspect context', exact: true })
      .click();
    await expect(
      page.getByRole('dialog').getByRole('note', { name: 'Frozen context summary' }),
    ).toContainText('invalidated and redacted');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByLabel('Question context summary').selectOption('');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    expect(f.calls).toHaveLength(4);
  } finally {
    await f.close();
  }
});
