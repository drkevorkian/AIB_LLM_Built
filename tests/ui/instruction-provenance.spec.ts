import { randomUUID } from 'node:crypto';
import { test as baseTest, expect, type Page } from '@playwright/test';
import type { Room } from '../../src/shared/contracts.js';
import { isolatedService } from './isolated-service.js';

const test = baseTest.extend<{ provenanceService: Awaited<ReturnType<typeof isolatedService>> }>({
  provenanceService: async ({ browser }, use) => {
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
  context: async ({ browser, provenanceService }, use) => {
    const context = await browser.newContext({ baseURL: provenanceService.base });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});
const originalInstructions = '\nKeep the original evidence. λ🙂\n';
const revisedInstructions = '\nRevised owner instructions. Keep disagreements.\n';
const note = (view: Page) =>
  view.getByRole('note', { name: 'Instruction provenance', exact: true });
async function fixture(page: Page) {
  await page.goto('/');
  let headers = {
    'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
  };
  const response = await page.request.post('/api/rooms', {
    headers,
    data: {
      title: 'Provenance ' + randomUUID().slice(0, 8),
      objective: 'Independent evidence',
      humanInstructions: originalInstructions,
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
      view.getByRole('heading', { name: room.title, exact: true, level: 1 }),
    ).toBeVisible();
    await view.getByRole('button', { name: /^All messages/ }).click();
  };
  const send = async (
    body = 'Independent evidence, please.',
    ending: 'completed' | 'failed' = 'completed',
  ) => {
    const at = (await record()).jobs.length;
    const result = await page.request.post(`/api/rooms/${room.id}/messages`, {
      headers,
      data: { clientId: randomUUID(), body, type: 'question', recipientIds: [room.agents[1]!.id] },
    });
    expect(result.ok()).toBe(true);
    await expect
      .poll(async () => (await record()).jobs[at]?.status, { timeout: 10000 })
      .toBe(ending);
    await page.getByRole('button', { name: /^All messages/ }).click();
    await expect(page.locator('.message.answer')).toHaveCount(at + 1);
  };
  const instructions = async (text: string) => {
    const current = await record();
    expect(
      (
        await page.request.put(`/api/rooms/${room.id}/settings`, {
          headers,
          data: {
            title: current.title,
            objective: current.objective,
            maxTurns: current.maxTurns,
            humanInstructions: text,
            expectedInstructionRevision: current.instructionRevision ?? 0,
          },
        })
      ).ok(),
    ).toBe(true);
  };
  const configure = async (name: string, role: string) => {
    const b = (await record()).agents[1]!;
    expect(
      (
        await page.request.post(`/api/rooms/${room.id}/agents`, {
          headers,
          data: {
            agentId: b.id,
            name,
            role,
            provider: b.provider,
            model: b.model,
            maxOutputTokens: 1024,
            timeoutSeconds: 60,
          },
        })
      ).ok(),
    ).toBe(true);
  };
  const refresh = async () => {
    headers = {
      'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
    };
  };
  await select(page);
  return { room, record, select, send, instructions, configure, refresh, headers: () => headers };
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true, level: 1 }),
  ).toBeVisible();
}

test('another view supersedes old responses while drafts, source/copy/export, frozen inspection, and fresh-current responses remain exact', async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  await f.send();
  const original = await f.record();
  const output = original.messages.find((m) => m.authorId === f.room.agents[1]!.id)!;
  const first = page.locator('.message.answer').first();
  await expect(
    first.getByRole('note', { name: 'Instruction provenance', exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel('Message', { exact: true })
    .fill('Preserve this draft across instruction changes.');
  const other = await context.newPage();
  try {
    await other.goto('/');
    await f.select(other);
    await settings(other);
    await other.getByLabel('Workspace instructions', { exact: true }).fill(revisedInstructions);
    await other.getByRole('button', { name: 'Save workspace', exact: true }).click();
    await expect.poll(async () => (await f.record()).instructionRevision).toBe(1);
    await expect(
      first.getByRole('note', { name: 'Instruction provenance', exact: true }),
    ).toContainText('revision 0 was superseded by revision 1');
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Preserve this draft across instruction changes.',
    );
    await first.getByRole('button', { name: 'Inspect context', exact: true }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('note', { name: 'Instruction provenance', exact: true }),
    ).toContainText('Stale instructions');
    expect(
      await dialog.getByLabel('Frozen workspace instructions', { exact: true }).textContent(),
    ).toBe(originalInstructions);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await first.getByRole('button', { name: 'View source', exact: true }).click();
    expect(await first.locator('.message-source').textContent()).toBe(output.body);
    await first.getByRole('button', { name: 'Copy message', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(output.body);
    const exported = await page.request.get(`/api/rooms/${f.room.id}/export`, {
      headers: f.headers(),
    });
    expect(exported.ok()).toBe(true);
    const markdown = await exported.text();
    expect(markdown).toContain('Instruction provenance: Stale instructions');
    expect(markdown).toContain('Original outcome: complete');
    expect(markdown).toContain(output.body);
    await f.send('Fresh question with current instructions.');
    const latest = page.locator('.message.answer').last();
    await expect(
      latest.getByRole('note', { name: 'Instruction provenance', exact: true }),
    ).toHaveCount(0);
    await latest.getByRole('button', { name: 'Inspect context', exact: true }).click();
    await expect(
      dialog.getByRole('note', { name: 'Instruction provenance', exact: true }),
    ).toContainText('Instructions current');
    expect(
      await dialog.getByLabel('Frozen workspace instructions', { exact: true }).textContent(),
    ).toBe(revisedInstructions);
    const current = await f.record();
    expect(current.messages.find((m) => m.id === output.id)).toEqual(output);
    expect(current.snapshots[0]).toEqual(original.snapshots[0]);
    expect(current.turnsUsed).toBe(2);
  } finally {
    await other.close();
  }
});

test('connection/name edits stay current while role changes and a later exact role restoration leave old output visibly superseded', async ({
  page,
}) => {
  const f = await fixture(page);
  await f.send();
  const original = await f.record();
  const b = original.agents[1]!;
  const first = page.locator('.message.answer').first();
  await f.configure('Renamed participant', b.role);
  await expect.poll(async () => (await f.record()).agents[1]!.configRevision).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Configure Renamed participant', exact: true }),
  ).toBeVisible();
  await first.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await expect(note(page)).toContainText('Instructions current');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(
    first.getByRole('note', { name: 'Instruction provenance', exact: true }),
  ).toHaveCount(0);
  await f.configure(
    'Renamed participant',
    'Revised role <img src=x onerror="window.roleInjected=true">',
  );
  await expect(
    first.getByRole('note', { name: 'Instruction provenance', exact: true }),
  ).toContainText('recorded participant role differs');
  expect(
    await first
      .getByRole('note', { name: 'Instruction provenance', exact: true })
      .locator('img,script,iframe,a')
      .count(),
  ).toBe(0);
  expect(await page.evaluate(() => 'roleInjected' in window)).toBe(false);
  await f.configure('Renamed participant', b.role);
  await expect(
    first.getByRole('note', { name: 'Instruction provenance', exact: true }),
  ).toContainText('current role text matches again');
  expect((await f.record()).instructionRevision).toBe(0);
  await f.send('Fresh role revision.');
  await expect(
    page
      .locator('.message.answer')
      .last()
      .getByRole('note', { name: 'Instruction provenance', exact: true }),
  ).toHaveCount(0);
  const after = await f.record();
  expect(after.snapshots[0]).toEqual(original.snapshots[0]);
  expect(after.messages.find((m) => m.authorId === b.id)?.body).toBe(
    original.messages.find((m) => m.authorId === b.id)!.body,
  );
});

test('failed retries warn about their original superseded instructions, retain failure status and frozen roles, and do not label fresh output stale', async ({
  page,
}) => {
  const f = await fixture(page);
  await f.send('[simulate:fail] Preserve original attempt.', 'failed');
  const original = await f.record();
  const first = page.locator('.message.answer').first();
  await expect(first.locator('.badge.failed')).toBeVisible();
  await f.instructions(revisedInstructions);
  await f.configure(f.room.agents[1]!.name, 'New independent role');
  const warning = page.getByRole('note', { name: 'Retry instruction context', exact: true });
  await expect(warning).toContainText('Stale instructions');
  await expect(warning).toContainText('Retry keeps these recorded instructions');
  await page.getByRole('button', { name: 'Retry this attempt', exact: true }).click();
  await expect
    .poll(async () => (await f.record()).jobs[1]?.status, { timeout: 10000 })
    .toBe('failed');
  await expect(page.locator('.message.answer')).toHaveCount(2);
  await expect(first.locator('.badge.failed')).toBeVisible();
  const retry = page.locator('.message.answer').last();
  await expect(retry.locator('.badge.failed')).toBeVisible();
  await expect(
    retry.getByRole('note', { name: 'Instruction provenance', exact: true }),
  ).toContainText('Stale instructions');
  await retry.getByRole('button', { name: 'Inspect context', exact: true }).click();
  const dialog = page.getByRole('dialog');
  expect(
    await dialog.getByLabel('Frozen workspace instructions', { exact: true }).textContent(),
  ).toBe(originalInstructions);
  await dialog.getByText('Participant roles at invocation', { exact: true }).click();
  await expect(dialog).toContainText(original.agents[1]!.role);
  await expect(dialog).not.toContainText('New independent role');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await f.send('Fresh current request.');
  await expect(
    page
      .locator('.message.answer')
      .last()
      .getByRole('note', { name: 'Instruction provenance', exact: true }),
  ).toHaveCount(0);
  const current = await f.record();
  expect(current.snapshots[0]).toEqual(original.snapshots[0]);
  expect(current.jobs[1]!.snapshotId).toBe(original.jobs[0]!.snapshotId);
  expect(current.turnsUsed).toBe(3);
});

test('archived stale notices remain readable in narrow themes and after restart; legacy response fixtures disclose unknown provenance without backfilling', async ({
  page,
  provenanceService,
}) => {
  const f = await fixture(page);
  await f.send();
  await f.instructions(revisedInstructions);
  const first = page.locator('.message.answer').first();
  await expect(
    first.getByRole('note', { name: 'Instruction provenance', exact: true }),
  ).toContainText('Stale instructions');
  expect(
    (
      await page.request.put(`/api/rooms/${f.room.id}/archive`, {
        headers: f.headers(),
        data: { archived: true },
      })
    ).ok(),
  ).toBe(true);
  await expect(first.getByRole('button', { name: /^Reply to/ })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['light', 'dark']) {
    await settings(page);
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
    await expect(
      first.getByRole('note', { name: 'Instruction provenance', exact: true }),
    ).toContainText('Stale instructions');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const archived = await f.record();
  await provenanceService.restart();
  await f.refresh();
  await page.reload();
  await f.select(page);
  await expect(
    first.getByRole('note', { name: 'Instruction provenance', exact: true }),
  ).toContainText('Stale instructions');
  expect((await f.record()).snapshots).toEqual(archived.snapshots);
  // Model a legacy service response at the read boundary; it cannot mutate the actual store.
  await page.route(`**/api/rooms/${f.room.id}`, async (route) => {
    const response = await route.fetch();
    const room = (await response.json()) as Room;
    room.snapshots.forEach((snapshot) => {
      delete snapshot.humanInstructions;
      delete snapshot.instructionRevision;
    });
    await route.fulfill({ response, json: room });
  });
  await page.reload();
  await f.select(page);
  await expect(
    first.getByRole('note', { name: 'Instruction provenance', exact: true }),
  ).toContainText('Instruction provenance unknown');
  await expect(
    first.getByRole('note', { name: 'Instruction provenance', exact: true }),
  ).not.toContainText('Stale instructions');
  await first.getByRole('button', { name: 'Inspect context', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(
    'Legacy snapshot: workspace instruction text and revision were not recorded.',
  );
  await expect(dialog).not.toContainText(revisedInstructions.trim());
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await first.getByRole('button', { name: 'Copy message', exact: true }).click();
  const output = archived.messages.find((m) => m.authorId === archived.agents[1]!.id)!;
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(output.body);
  const after = await f.record();
  expect(after.snapshots).toEqual(archived.snapshots);
  expect(after.messages).toEqual(archived.messages);
  expect(after.turnsUsed).toBe(1);
});
