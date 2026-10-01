import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

async function createRoom(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New room', exact: true }).click();
  await page.getByLabel('Room name').fill(`Conversation ${randomUUID().slice(0, 8)}`);
  await page.getByLabel('Shared objective').fill('Investigate the delivery sequence.');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
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
