import { randomUUID } from 'node:crypto';
import { test as baseTest, expect, type Page } from '@playwright/test';
import type { Room, RoomSummary } from '../../src/shared/contracts.js';
import { isolatedService } from './isolated-service.js';

const test = baseTest.extend<{ instructionService: Awaited<ReturnType<typeof isolatedService>> }>({
  instructionService: async ({ browser }, use) => {
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
  context: async ({ browser, instructionService }, use) => {
    const context = await browser.newContext({ baseURL: instructionService.base });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});
const initialInstructions =
  '\n  Preserve independent evidence. λ🙂\n<img src=x onerror="window.instructionInjected=true">\n' +
  'LongWord'.repeat(60) +
  '\n';

async function fixture(page: Page, ui = false) {
  await page.goto('/');
  let headers = {
    'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
  };
  const title = 'Instructions ' + randomUUID().slice(0, 8);
  let room: Room;
  if (ui) {
    await page.getByRole('button', { name: 'New workspace', exact: true }).click();
    await page.getByLabel('Workspace name', { exact: true }).fill(title);
    await page.getByLabel('Shared objective', { exact: true }).fill('Original objective');
    await page.getByLabel('Workspace instructions', { exact: true }).fill(initialInstructions);
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
    const rooms = (await (
      await page.request.get('/api/rooms', { headers })
    ).json()) as RoomSummary[];
    const id = rooms.find((entry) => entry.title === title)!.id;
    room = (await (await page.request.get(`/api/rooms/${id}`, { headers })).json()) as Room;
  } else {
    const result = await page.request.post('/api/rooms', {
      headers,
      data: { title, objective: 'Original objective', humanInstructions: initialInstructions },
    });
    expect(result.ok()).toBe(true);
    room = (await result.json()) as Room;
  }
  const record = async () =>
    (await (await page.request.get(`/api/rooms/${room.id}`, { headers })).json()) as Room;
  const select = async (view: Page) => {
    await view.locator('.room-item').filter({ hasText: title }).click();
    await expect(view.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  };
  const send = async (body = 'Independent evidence, please.') => {
    const result = await page.request.post(`/api/rooms/${room.id}/messages`, {
      headers,
      data: {
        clientId: randomUUID(),
        body,
        type: 'question',
        recipientIds: [room.agents[1]!.id],
      },
    });
    expect(result.ok()).toBe(true);
  };
  const refresh = async () => {
    headers = {
      'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
    };
  };
  await select(page);
  return { room, record, select, send, refresh, headers: () => headers };
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true, level: 1 }),
  ).toBeVisible();
}
const history = (page: Page) => page.locator('.instruction-history');

test('creation/editing retains exact instruction revisions, safe readable history, drafts, narrow themes, and restart persistence', async ({
  page,
  instructionService,
}) => {
  const f = await fixture(page, true);
  expect((await f.record()).humanInstructions).toBe(initialInstructions);
  await page.getByLabel('Message', { exact: true }).fill('Preserve the unsent instruction draft.');
  await settings(page);
  const input = page.getByLabel('Workspace instructions', { exact: true });
  await expect(input).toHaveValue(initialInstructions);
  const disclosure = history(page).locator('summary');
  await disclosure.focus();
  await page.keyboard.press('Enter');
  expect(
    await history(page)
      .getByLabel('Workspace instructions revision 0', { exact: true })
      .textContent(),
  ).toBe(initialInstructions);
  const edited = '\nNew owner instructions. Keep disagreements.\n';
  await input.fill(edited);
  await page.getByLabel('Shared objective', { exact: true }).fill('Revised objective');
  await page.getByRole('button', { name: 'Save workspace', exact: true }).click();
  await expect.poll(async () => (await f.record()).instructionRevision).toBe(1);
  await expect(history(page).locator('li')).toHaveCount(2);
  expect(
    await history(page)
      .getByLabel('Workspace instructions revision 0', { exact: true })
      .textContent(),
  ).toBe(initialInstructions);
  expect(
    await history(page)
      .getByLabel('Workspace instructions revision 1', { exact: true })
      .textContent(),
  ).toBe(edited);
  expect(await history(page).locator('img,script,iframe,a').count()).toBe(0);
  expect(await page.evaluate(() => 'instructionInjected' in window)).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Preserve the unsent instruction draft.',
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await instructionService.restart();
  await f.refresh();
  await page.reload();
  await f.select(page);
  await settings(page);
  await expect(input).toHaveValue(edited);
  await history(page).locator('summary').click();
  await expect(history(page).locator('li')).toHaveCount(2);
  expect(
    await history(page)
      .getByLabel('Workspace instructions revision 0', { exact: true })
      .textContent(),
  ).toBe(initialInstructions);
  await input.fill('');
  await page.getByRole('button', { name: 'Save workspace', exact: true }).click();
  await expect.poll(async () => (await f.record()).instructionRevision).toBe(2);
  expect((await f.record()).instructionRevisions![2]!.humanInstructions).toBe('');
});

test('failed-answer retries show their frozen instructions and roles while new questions use current revisions', async ({
  page,
}) => {
  const f = await fixture(page);
  await f.send('[simulate:fail] Keep original context.');
  await expect.poll(async () => (await f.record()).jobs[0]!.status).toBe('failed');
  const original = await f.record();
  const b = original.agents[1]!;
  await settings(page);
  await page.getByLabel('Workspace instructions', { exact: true }).fill('New shared instructions.');
  await page.getByRole('button', { name: 'Save workspace', exact: true }).click();
  await expect.poll(async () => (await f.record()).instructionRevision).toBe(1);
  expect(
    (
      await page.request.post(`/api/rooms/${f.room.id}/agents`, {
        headers: f.headers(),
        data: {
          agentId: b.id,
          name: b.name,
          role: 'New independent role',
          provider: b.provider,
          model: b.model,
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post(`/api/rooms/${f.room.id}/retry`, {
        headers: f.headers(),
        data: { jobId: original.jobs[0]!.id },
      })
    ).ok(),
  ).toBe(true);
  await expect.poll(async () => (await f.record()).jobs[1]!.status).toBe('failed');
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await page.getByRole('button', { name: /^All messages/ }).click();
  await page
    .locator('.message.answer')
    .last()
    .getByRole('button', { name: 'Inspect context', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  expect(
    await dialog.getByLabel('Frozen workspace instructions', { exact: true }).textContent(),
  ).toBe(initialInstructions);
  await expect(dialog).toContainText('Revision 0');
  await dialog.getByText('Participant roles at invocation', { exact: true }).click();
  await expect(dialog).toContainText(b.role);
  await expect(dialog).not.toContainText('New independent role');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await f.send();
  await expect
    .poll(async () => (await f.record()).jobs[2]!.status, { timeout: 10000 })
    .toBe('completed');
  await page
    .locator('.message.answer')
    .last()
    .getByRole('button', { name: 'Inspect context', exact: true })
    .click();
  await expect(dialog.getByLabel('Frozen workspace instructions', { exact: true })).toHaveText(
    'New shared instructions.',
  );
  await expect(dialog).toContainText('Revision 1');
  await dialog.getByText('Participant roles at invocation', { exact: true }).click();
  await expect(dialog).toContainText('New independent role');
  const current = await f.record();
  expect(current.snapshots[0]).toEqual(original.snapshots[0]);
  expect(current.turnsUsed).toBe(3);
});

test('pending/archived instructions stay locked while history remains readable and restoration does not resume work', async ({
  page,
}) => {
  const f = await fixture(page);
  expect(
    (
      await page.request.post(`/api/rooms/${f.room.id}/control`, {
        headers: f.headers(),
        data: { action: 'pause' },
      })
    ).ok(),
  ).toBe(true);
  await f.send();
  await settings(page);
  const input = page.getByLabel('Workspace instructions', { exact: true });
  await input.fill('Reviewed after Stop.');
  await expect(page.getByRole('button', { name: 'Save workspace', exact: true })).toBeDisabled();
  expect((await f.record()).instructionRevision).toBe(0);
  expect(
    (
      await page.request.post(`/api/rooms/${f.room.id}/control`, {
        headers: f.headers(),
        data: { action: 'stop' },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.put(`/api/rooms/${f.room.id}/archive`, {
        headers: f.headers(),
        data: { archived: true },
      })
    ).ok(),
  ).toBe(true);
  await expect(input).toBeDisabled();
  await history(page).locator('summary').click();
  await expect(history(page)).toContainText('Revision 0');
  expect(
    await history(page)
      .getByLabel('Workspace instructions revision 0', { exact: true })
      .textContent(),
  ).toBe(initialInstructions);
  expect(
    (
      await page.request.put(`/api/rooms/${f.room.id}/archive`, {
        headers: f.headers(),
        data: { archived: false },
      })
    ).ok(),
  ).toBe(true);
  await expect(input).toBeEnabled();
  await page.getByRole('button', { name: 'Save workspace', exact: true }).click();
  await expect.poll(async () => (await f.record()).instructionRevision).toBe(1);
  const saved = await f.record();
  expect(saved.status).toBe('paused');
  expect(saved.turnsUsed).toBe(0);
  expect(saved.jobs[0]!.status).toBe('cancelled');
  expect(saved.humanInstructions).toBe('Reviewed after Stop.');
});

test('another view advances instructions without clearing drafts; stale saves require explicit refreshed review', async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  await page.getByLabel('Message', { exact: true }).fill('Keep the cross-view instruction draft.');
  await settings(page);
  const input = page.getByLabel('Workspace instructions', { exact: true });
  await input.fill('Stale unsaved instructions');
  const view = await context.newPage();
  await view.goto('/');
  await f.select(view);
  await settings(view);
  const otherInput = view.getByLabel('Workspace instructions', { exact: true });
  await otherInput.fill('Saved by the second view');
  await view.getByRole('button', { name: 'Save workspace', exact: true }).click();
  await expect.poll(async () => (await f.record()).instructionRevision).toBe(1);
  await expect(history(page).locator('summary')).toContainText('(2)');
  await expect(input).toHaveValue('Stale unsaved instructions');
  await page.getByRole('button', { name: 'Save workspace', exact: true }).click();
  await expect(page.locator('.workspace-settings-form').getByRole('alert')).toContainText(
    'Workspace instructions changed. Reopen Settings',
  );
  expect((await f.record()).instructionRevision).toBe(1);
  expect((await f.record()).humanInstructions).toBe('Saved by the second view');
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep the cross-view instruction draft.',
  );
  await settings(page);
  await expect(input).toHaveValue('Saved by the second view');
  await input.fill('Saved after refreshed review');
  await page.getByRole('button', { name: 'Save workspace', exact: true }).click();
  await expect.poll(async () => (await f.record()).instructionRevision).toBe(2);
  await expect(otherInput).toHaveValue('Saved after refreshed review');
  await expect(history(view).locator('summary')).toContainText('(3)');
  await view.close();
});
