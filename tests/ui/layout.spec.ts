import { test as baseTest, expect, type Page, type Locator } from '@playwright/test';
import type { Room } from '../../src/shared/contracts.js';
import { isolatedService } from './isolated-service.js';

const test = baseTest.extend<{ layoutService: Awaited<ReturnType<typeof isolatedService>> }>({
  layoutService: async ({ browser }, use) => {
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
  context: async ({ browser, layoutService }, use) => {
    const context = await browser.newContext({
      baseURL: layoutService.base,
      viewport: { width: 1440, height: 1000 },
    });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});

const navigation = (page: Page) =>
  page.getByRole('separator', { name: 'Resize workspace navigation' });
const activity = (page: Page) => page.getByRole('separator', { name: 'Resize participant panel' });
const value = async (separator: Locator) => Number(await separator.getAttribute('aria-valuenow'));
const saved = (page: Page) => page.evaluate(() => localStorage.getItem('aib-panel-layout'));

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
  const { token } = await (await page.request.get('/api/session')).json();
  const headers = { 'X-AIB-Token': token };
  const [summary] = await (await page.request.get('/api/rooms', { headers })).json();
  const record = async () =>
    (await (await page.request.get('/api/rooms/' + summary.id, { headers })).json()) as Room;
  return record;
}

async function expectContained(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  const stop = await page.getByRole('button', { name: 'Stop', exact: true }).boundingBox();
  expect(stop).not.toBeNull();
  expect(stop!.x).toBeGreaterThanOrEqual(0);
  expect(stop!.x + stop!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test('keyboard dividers expose bounds, persist widths, reset in Settings, and preserve drafts and records', async ({
  page,
}) => {
  const record = await open(page);
  const original = await record();
  const left = navigation(page);
  const right = activity(page);
  await expect(left).toHaveAttribute('aria-controls', 'workspace-navigation');
  await expect(right).toHaveAttribute('aria-orientation', 'vertical');
  await page.getByLabel('Message', { exact: true }).fill('Keep this unsubmitted layout draft.');
  await left.focus();
  await left.press('ArrowRight');
  await expect(left).toBeFocused();
  await expect(left).toHaveAttribute('aria-valuenow', '248');
  await left.press('Shift+ArrowRight');
  await expect(left).toHaveAttribute('aria-valuenow', '298');
  await left.press('ArrowLeft');
  await expect(left).toHaveAttribute('aria-valuetext', '288 pixels wide');
  await right.press('ArrowLeft');
  await expect(right).toHaveAttribute('aria-valuenow', '302');
  await right.press('Shift+ArrowRight');
  await expect(right).toHaveAttribute('aria-valuenow', '252');
  await right.press('Home');
  await expect(right).toHaveAttribute('aria-valuenow', '230');
  await right.press('ArrowRight');
  await expect(right).toHaveAttribute('aria-valuenow', '230');
  await left.press('End');
  await expect(left).toHaveAttribute('aria-valuenow', '420');
  await left.press('ArrowRight');
  await expect(left).toHaveAttribute('aria-valuenow', '420');
  await left.press('Home');
  await expect(left).toHaveAttribute('aria-valuenow', '180');
  await left.press('Shift+ArrowRight');
  expect(JSON.parse((await saved(page))!)).toEqual({ version: 1, navigation: 230, activity: 230 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('separator')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to conversation' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep this unsubmitted layout draft.',
  );
  await page.reload();
  await expect(left).toHaveAttribute('aria-valuenow', '230');
  await expect(right).toHaveAttribute('aria-valuenow', '230');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Reset panel widths' }).click();
  expect(await saved(page)).toBeNull();
  await page.getByRole('button', { name: 'Back to conversation' }).click();
  await expect(left).toHaveAttribute('aria-valuenow', '238');
  await expect(right).toHaveAttribute('aria-valuenow', '292');
  expect(await record()).toEqual(original);
  await expectContained(page);
  await page.screenshot({ path: 'test-results/resizable-desktop.png', fullPage: true });
});

test('pointer capture commits a completed drag and rolls back Escape, cancellation, and breakpoint transitions', async ({
  page,
}) => {
  await open(page);
  const left = navigation(page);
  const right = activity(page);
  const box = (await left.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 150);
  await expect(left).toHaveAttribute('aria-valuenow', '318');
  expect(await saved(page)).toBeNull();
  await page.mouse.up();
  const committed = await saved(page);
  expect(JSON.parse(committed!)).toEqual({ version: 1, navigation: 318, activity: 292 });
  const rightBox = (await right.boundingBox())!;
  await page.mouse.move(rightBox.x + 4, rightBox.y + 50);
  await page.mouse.down();
  await page.mouse.move(rightBox.x - 70, rightBox.y + 80);
  await expect(right).toHaveAttribute('aria-valuenow', '366');
  await right.press('Escape');
  await page.mouse.up();
  await expect(right).toHaveAttribute('aria-valuenow', '292');
  expect(await saved(page)).toBe(committed);
  await page.mouse.move(rightBox.x + 4, rightBox.y + 50);
  await page.mouse.down();
  await page.mouse.move(rightBox.x - 40, rightBox.y + 70);
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await settings.focus();
  await settings.press('Enter');
  await expect(page.getByRole('separator')).toHaveCount(0);
  await page.mouse.up();
  expect(await saved(page)).toBe(committed);
  await page.getByRole('button', { name: 'Back to conversation' }).click();
  await expect(right).toHaveAttribute('aria-valuenow', '292');
  await page.mouse.move(rightBox.x + 4, rightBox.y + 50);
  await page.mouse.down();
  await page.mouse.move(rightBox.x - 40, rightBox.y + 70);
  await right.dispatchEvent('pointercancel');
  await page.mouse.up();
  await expect(right).toHaveAttribute('aria-valuenow', '292');
  expect(await saved(page)).toBe(committed);
  await page.mouse.move(rightBox.x + 4, rightBox.y + 50);
  await page.mouse.down();
  await page.mouse.move(rightBox.x - 50, rightBox.y + 70);
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.mouse.up();
  await expect(page.getByRole('separator')).toHaveCount(0);
  expect(await saved(page)).toBe(committed);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(right).toHaveAttribute('aria-valuenow', '292');
  await page.reload();
  await expect(left).toHaveAttribute('aria-valuenow', '318');
  await expectContained(page);
});

test('wide preferences fit smaller desktops, survive narrow layouts, and keep Stop in both themes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await open(page);
  await navigation(page).press('End');
  await activity(page).press('End');
  const preference = await saved(page);
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'Toggle theme' }).click();
    for (const width of [1800, 1180, 1001, 1000, 701, 700, 390, 340]) {
      await page.setViewportSize({ width, height: 1000 });
      await expectContained(page);
      if (width > 1000) {
        await expect(navigation(page)).toBeVisible();
        await expect
          .poll(async () => (await page.locator('.conversation').boundingBox())!.width)
          .toBeGreaterThanOrEqual(400);
        expect(await value(navigation(page))).toBeLessThanOrEqual(
          Number(await navigation(page).getAttribute('aria-valuemax')),
        );
        expect(await value(activity(page))).toBeLessThanOrEqual(
          Number(await activity(page).getAttribute('aria-valuemax')),
        );
      } else {
        await expect(page.getByRole('separator')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Hide navigation' })).toBeVisible();
        expect((await page.locator('.sidebar').boundingBox())!.width).toBe(
          width <= 700 ? width : 205,
        );
      }
      await expectContained(page);
      expect(await saved(page)).toBe(preference);
    }
  }
  await page.setViewportSize({ width: 1800, height: 1000 });
  await expect(navigation(page)).toHaveAttribute('aria-valuenow', '420');
  await expect(activity(page)).toHaveAttribute('aria-valuenow', '480');
  await page.setViewportSize({ width: 1001, height: 1000 });
  await expectContained(page);
  const before = await value(navigation(page));
  await navigation(page).press('ArrowLeft');
  await expect(navigation(page)).toHaveAttribute('aria-valuenow', String(before - 10));
  await expectContained(page);
});

test('narrow disclosures retain a draft and active response status while both Stop controls remain operable', async ({
  page,
}) => {
  const record = await open(page);
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.getByLabel('Message', { exact: true }).fill('Draft survives collapsed panels.');
  const hideNavigation = page.getByRole('button', { name: 'Hide navigation' });
  await hideNavigation.focus();
  await hideNavigation.press('Enter');
  await expect(page.getByRole('button', { name: 'Show navigation' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Hide participants' }).press('Space');
  await expect(page.locator('.activity-panel')).toBeHidden();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Draft survives collapsed panels.',
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Settings' })).toBeVisible();
  await expectContainedSettings(page);
  await page.getByRole('button', { name: 'Back to conversation' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Draft survives collapsed panels.',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Message type').selectOption('discussion');
  await page.getByLabel('Message', { exact: true }).fill('Wait for review. [simulate:slow]');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.room-state')).toContainText('1 generating');
  await expect(page.getByLabel('Discussion progress')).toContainText('running');
  await expectContained(page);
  await page.getByRole('button', { name: 'Stop discussion', exact: true }).click();
  await expect(page.getByLabel('Discussion progress')).toContainText('cancelled');
  expect((await record()).status).toBe('running');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.room-state')).toContainText('stopped');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Show navigation' }).click();
  await page.getByRole('button', { name: 'Show participants' }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.activity-panel')).toBeVisible();
  await page.getByLabel('Message', { exact: true }).fill('Retained on desktop too.');
  await page.getByRole('button', { name: 'Hide navigation' }).click();
  await page.getByRole('button', { name: 'Hide participants' }).click();
  await page.screenshot({ path: 'test-results/collapsed-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.activity-panel')).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Retained on desktop too.');
  await page.setViewportSize({ width: 900, height: 1000 });
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.activity-panel')).toBeHidden();
});

async function expectContainedSettings(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await page.getByRole('main', { name: 'Settings' }).boundingBox())!.width).toBe(
    page.viewportSize()!.width,
  );
}

test('invalid or inaccessible width storage falls back safely and reports unsaved user changes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  for (const raw of [
    'broken JSON',
    'null',
    '[]',
    '{"version":2,"navigation":238,"activity":292}',
    '{"version":1,"navigation":-1,"activity":292}',
    '{"version":1,"navigation":"<script>","activity":292}',
    '{"version":1,"navigation":238,"activity":292,"extra":true}',
  ]) {
    await page.evaluate((value) => localStorage.setItem('aib-panel-layout', value), raw);
    await page.reload();
    await expect(navigation(page)).toHaveAttribute('aria-valuenow', '238');
    await expect(activity(page)).toHaveAttribute('aria-valuenow', '292');
  }
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'aib-panel-layout') throw new DOMException('Blocked', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'aib-panel-layout') throw new DOMException('Quota', 'QuotaExceededError');
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (key === 'aib-panel-layout') throw new DOMException('Blocked', 'SecurityError');
      return remove.call(this, key);
    };
  });
  await page.reload();
  await expect(navigation(page)).toHaveAttribute('aria-valuenow', '238');
  await navigation(page).press('ArrowRight');
  await expect(navigation(page)).toHaveAttribute('aria-valuenow', '248');
  await expect(page.getByRole('status')).toContainText('browser storage is unavailable');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Reset panel widths' }).click();
  await page.getByRole('button', { name: 'Back to conversation' }).click();
  await expect(navigation(page)).toHaveAttribute('aria-valuenow', '238');
  await expect(page.getByRole('status')).toContainText('browser storage is unavailable');
  await expectContained(page);
  expect(errors).toEqual([]);
});
