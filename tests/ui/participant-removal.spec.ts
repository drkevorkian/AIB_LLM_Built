import { randomUUID } from 'node:crypto';
import { test as baseTest, expect, type Page, type Locator } from '@playwright/test';
import type { Room } from '../../src/shared/contracts.js';
import { isolatedService } from './isolated-service.js';

const test = baseTest.extend<{ removalService: Awaited<ReturnType<typeof isolatedService>> }>({
  removalService: async ({ browser }, use) => {
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
  context: async ({ browser, removalService }, use) => {
    const context = await browser.newContext({ baseURL: removalService.base });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});
async function fixture(page: Page, count = 3) {
  await page.goto('/');
  let headers = {
    'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
  };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { headers, data });
    expect(response.ok()).toBe(true);
    return response;
  };
  const room = (await (
    await post('/api/rooms', {
      title: 'Remove ' + randomUUID().slice(0, 8),
      participantCount: count,
    })
  ).json()) as Room;
  const name = 'Twin <img onerror=alert(1)>';
  for (const agent of room.agents.slice(0, 2))
    await post(`/api/rooms/${room.id}/agents`, {
      agentId: agent.id,
      name,
      role: 'Independent retained role',
      provider: 'simulated',
      model: 'simulation-v1',
    });
  const record = async () => {
    const response = await page.request.get('/api/rooms/' + room.id, { headers });
    expect(response.ok()).toBe(true);
    return (await response.json()) as Room;
  };
  const send = async (id: string, question = true) =>
    post(`/api/rooms/${room.id}/messages`, {
      clientId: randomUUID(),
      body: 'Keep original evidence and attribution.',
      type: question ? 'question' : 'update',
      recipientIds: question ? [id] : [],
      synthesisAgentId: null,
    });
  const select = async (view: Page) => {
    await view.locator('.room-item').filter({ hasText: room.title }).click();
    await expect(
      view.getByRole('heading', { name: room.title, level: 1, exact: true }),
    ).toBeVisible();
  };
  await select(page);
  return {
    room: await record(),
    name,
    post,
    record,
    send,
    select,
    headers: () => headers,
    reauthenticate: async () => {
      headers = {
        'X-AIB-Token': (await (await page.request.get('/api/session')).json()).token as string,
      };
    },
  };
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Settings', level: 1, exact: true }),
  ).toBeVisible();
}
const row = (page: Page, id: string) =>
  page.locator(`.settings-participant[data-agent-id="${id}"]`);
async function review(page: Page, id: string) {
  await row(page, id)
    .getByRole('button', { name: /^Remove / })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Remove participant?', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function confirm(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Remove participant permanently', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

function history(room: Room) {
  return {
    messages: room.messages,
    snapshots: room.snapshots,
    jobs: room.jobs,
    requests: room.requests,
    threads: room.threads,
    turnsUsed: room.turnsUsed,
  };
}

test('confirmed removal preserves exact attribution/history, supports keyboard cancellation and narrow themes, frees a slot, and persists after restart', async ({
  page,
  removalService,
}) => {
  const f = await fixture(page);
  const b = f.room.agents[1]!;
  await f.send(b.id);
  await expect
    .poll(async () => (await f.record()).jobs[0]!.status, { timeout: 10000 })
    .toBe('completed');
  await page.getByLabel('Message', { exact: true }).fill('Preserve the unsent removal draft.');
  await settings(page);
  await expect(row(page, b.id).getByRole('button', { name: /^Remove / })).toBeEnabled();
  const before = await f.record();
  let d = await review(page, b.id);
  await expect(d).toContainText(`Participant ID: ${b.id}`);
  await expect(d).toContainText(f.room.id);
  await expect(d).toContainText('1 authored messages');
  await expect(d.locator('img,script')).toHaveCount(0);
  await expect(d.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  expect(await f.record()).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  d = await review(page, b.id);
  expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/participant-removal-mobile.png', fullPage: true });
  await confirm(d);
  await expect(row(page, b.id)).toHaveCount(0);
  await expect(page.locator('.settings-participant')).toHaveCount(2);
  const removed = await f.record();
  expect(history(removed)).toEqual(history(before));
  expect(removed.agents[1]!.removedAt).toBeTruthy();
  await page.getByText('Removed participants (1)', { exact: true }).click();
  const saved = page.locator(`.removed-participant[data-agent-id="${b.id}"]`);
  await expect(saved).toContainText(b.id);
  await expect(saved.getByRole('button')).toHaveCount(0);
  await saved.getByText('Configuration history (3)', { exact: true }).click();
  await expect(saved).toContainText('Revision 2 · Removed');
  await expect(saved).toContainText('Revision 0 · Active · AI B');
  await page.getByRole('button', { name: 'Add participant', exact: true }).click();
  await page.getByLabel('New participant name', { exact: true }).fill(f.name);
  await page
    .getByLabel('New participant role', { exact: true })
    .fill('A distinct replacement identity.');
  await page.getByRole('button', { name: 'Create participant', exact: true }).click();
  await expect(page.locator('.settings-participant')).toHaveCount(3);
  const after = await f.record();
  const added = after.agents.at(-1)!;
  expect(added.id).not.toBe(b.id);
  expect(added.rosterNumber).toBe(4);
  await expect(row(page, added.id)).toContainText(f.name + ' · #4');
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Preserve the unsent removal draft.',
  );
  const answer = page.locator('.message.answer').first();
  await expect(answer).toContainText(f.name + ' · #2');
  await expect(answer.getByRole('button', { name: /^Reply to / })).toBeDisabled();
  await removalService.restart();
  await f.reauthenticate();
  const recovered = await f.record();
  expect(history(recovered)).toEqual(history(after));
  expect(recovered.agentRevisions).toEqual(after.agentRevisions);
  expect(recovered.agents).toEqual(after.agents);
  await page.reload();
  await settings(page);
  await expect(page.locator('.settings-participant')).toHaveCount(3);
  await page.getByText('Removed participants (1)', { exact: true }).click();
  await expect(page.locator('.removed-participant')).toHaveCount(1);
});

test('removal from another view clears the exact reply/recipient while retaining drafts and keeps a same-named replacement unselected', async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  const b = f.room.agents[1]!;
  await f.send(b.id);
  await expect
    .poll(async () => (await f.record()).jobs[0]!.status, { timeout: 10000 })
    .toBe('completed');
  const reply = page
    .locator('.message.answer')
    .getByRole('button', { name: `Reply to ${f.name} · #2`, exact: true });
  await expect(reply).toBeEnabled();
  await reply.click();
  await page
    .getByLabel('Message', { exact: true })
    .fill('Preserve this draft across a removed identity.');
  const other = await context.newPage();
  try {
    await other.goto('/');
    await f.select(other);
    await settings(other);
    await confirm(await review(other, b.id));
    await expect(page.locator('.reply-indicator')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: f.name + ' · #2', exact: true })).toHaveCount(
      0,
    );
    await expect(reply).toHaveCount(0);
    await expect(
      page.locator('.message.answer').getByRole('button', { name: /^Reply to / }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Preserve this draft across a removed identity.',
    );
    await other.getByRole('button', { name: 'Add participant', exact: true }).click();
    await other.getByLabel('New participant name', { exact: true }).fill(f.name);
    await other.getByLabel('New participant role', { exact: true }).fill('Distinct replacement.');
    await other.getByRole('button', { name: 'Create participant', exact: true }).click();
    const newChoice = page.getByRole('checkbox', { name: f.name + ' · #4', exact: true });
    await expect(newChoice).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    const added = (await f.record()).agents.at(-1)!;
    await newChoice.check();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect
      .poll(async () => (await f.record()).jobs.at(-1)!.status, { timeout: 10000 })
      .toBe('completed');
    const after = await f.record();
    expect(after.jobs.at(-1)!.agentId).toBe(added.id);
    expect(after.requests.at(-1)!.recipientIds).toEqual([added.id]);
    expect(
      after.messages.find((m) => m.id === after.requests.at(-1)!.messageId)!.replyTo,
    ).toBeNull();
    expect(after.turnsUsed).toBe(2);
  } finally {
    await other.close();
  }
});

test('stale review requires reopening, pending work disables removal without cancelling it, and the last active participant stays protected', async ({
  page,
}) => {
  const f = await fixture(page);
  const [a, b, c] = f.room.agents;
  await settings(page);
  let d = await review(page, b!.id);
  await f.post(`/api/rooms/${f.room.id}/agents`, {
    agentId: b!.id,
    name: 'Changed after review',
    role: 'Still retained',
    provider: 'simulated',
    model: 'simulation-v1',
  });
  const changed = await f.record();
  await d.getByRole('button', { name: 'Remove participant permanently', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('Workspace changed');
  await expect(
    d.getByRole('button', { name: 'Remove participant permanently', exact: true }),
  ).toBeDisabled();
  expect(await f.record()).toEqual(changed);
  await d.getByRole('button', { name: 'Close and refresh participants', exact: true }).click();
  await f.post(`/api/rooms/${f.room.id}/control`, { action: 'pause' });
  await f.send(b!.id);
  await expect(row(page, b!.id).getByRole('button', { name: /^Remove / })).toBeDisabled();
  const queued = await f.record();
  const rejected = await page.request.delete(`/api/rooms/${f.room.id}/participants/${b!.id}`, {
    headers: f.headers(),
    data: { expectedRevision: queued.revision },
  });
  expect(rejected.status()).toBe(409);
  expect(await f.record()).toEqual(queued);
  expect(queued.jobs[0]!.status).toBe('queued');
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await settings(page);
  await confirm(await review(page, b!.id));
  await expect(row(page, b!.id)).toHaveCount(0);
  const deactivate = await page.request.put(`/api/rooms/${f.room.id}/participants/${c!.id}`, {
    headers: f.headers(),
    data: { active: false },
  });
  expect(deactivate.ok()).toBe(true);
  await expect(row(page, a!.id).getByRole('button', { name: /^Remove / })).toBeDisabled();
  await expect(row(page, c!.id).getByRole('button', { name: /^Remove / })).toBeEnabled();
  d = await review(page, c!.id);
  await confirm(d);
  await expect(page.locator('.settings-participant')).toHaveCount(1);
  await expect(row(page, a!.id).getByRole('button', { name: /^Remove / })).toBeDisabled();
  const after = await f.record();
  expect(after.turnsUsed).toBe(0);
  expect(after.jobs[0]!.status).toBe('cancelled');
  expect(after.agents.filter((a) => !a.removedAt).length).toBe(1);
});

test('in-flight removal holds cancellation and a lost successful response requires inspection without an automatic repeat', async ({
  page,
}) => {
  const f = await fixture(page, 2);
  await settings(page);
  let releaseResponse!: () => void;
  let markCommitted!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const committed = new Promise<void>((resolve) => {
    markCommitted = resolve;
  });
  let confirmations = 0;
  await page.route('**/api/rooms/*/participants/*', async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.continue();
      return;
    }
    confirmations++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    markCommitted();
    await held;
    await route.abort('failed');
  });
  try {
    const d = await review(page, f.room.agents[1]!.id);
    await d.getByRole('button', { name: 'Remove participant permanently', exact: true }).click();
    await committed;
    await expect(d.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(d).toBeVisible();
    await d.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(d).toBeVisible();
    releaseResponse();
    await expect(d.getByRole('alert')).toContainText('Removal may have completed');
    await expect(
      d.getByRole('button', { name: 'Remove participant permanently', exact: true }),
    ).toBeDisabled();
    expect((await f.record()).agents[1]!.removedAt).toBeTruthy();
    await d.getByRole('button', { name: 'Close and refresh participants', exact: true }).click();
    await expect(page.locator('.settings-participant')).toHaveCount(1);
    await expect(page.getByText('Removed participants (1)', { exact: true })).toBeVisible();
    expect(confirmations).toBe(1);
  } finally {
    releaseResponse();
  }
});
