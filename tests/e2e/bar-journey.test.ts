import { expect, test } from '@playwright/test';
import { createBrewedTavern } from '../helpers/brewed-tavern';

test('a lost serving response retries the frozen command and persists into a new browser session', async ({ page, browser }) => {
  const player = await createBrewedTavern('bar-retry');
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (cause) => errors.push(cause.message));
  try {
    await page.goto('/login');
    await page.getByLabel('Email').fill(player.email);
    await page.getByLabel('Password').fill(player.password);
    await page.getByRole('button', { name: 'Open the ledger' }).click();
    await expect(page).toHaveURL(/\/garden$/);
    await page.getByRole('link', { name: 'Bar', exact: true }).click();
    await page.getByRole('button', { name: 'Torvin Ashbeard Dwarven Merchant' }).click();
    await expect(page.getByRole('heading', { name: 'Torvin Ashbeard', exact: true })).toBeVisible();
    await page.route((url) => url.pathname === '/bar' && url.search === '?/serve', async (route) => {
      requests.push(route.request().postData() ?? '');
      if (requests.length === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'Serve to Torvin Ashbeard' }).click();
    await expect(page.getByRole('alert')).toContainText('serving outcome is unknown');
    await expect(page.getByRole('radio', { name: 'Ambrosial Draught Resplendent' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Lira Nightwind Elven Ranger' })).toBeDisabled();
    await page.getByRole('button', { name: 'Retry the same serving' }).click();
    await expect(page.getByRole('status')).toContainText('Earned 40 gold');
    expect(requests).toHaveLength(2);
    expect(Object.fromEntries(new URLSearchParams(requests[0])))
      .toEqual(Object.fromEntries(new URLSearchParams(requests[1])));
    const context = await browser.newContext();
    try {
      const other = await context.newPage();
      await other.goto('/login');
      await other.getByLabel('Email').fill(player.email);
      await other.getByLabel('Password').fill(player.password);
      await other.getByRole('button', { name: 'Open the ledger' }).click();
      await expect(other).toHaveURL(/\/garden$/);
      await other.goto('/bar');
      await expect(other.getByLabel('Tavern gold')).toContainText('40 gold');
      await expect(other.getByRole('heading', { name: 'No hospitality ready to serve' })).toBeVisible();
      await expect(other.locator('.serving-history li')).toHaveCount(1);
      await other.getByRole('button', { name: 'Torvin Ashbeard Dwarven Merchant' }).click();
      await expect(other.getByText('28 / 100', { exact: true })).toBeVisible();
      await expect(other.getByText('Where their story began')).toBeVisible();
    } finally { await context.close(); }
    expect(errors).toEqual([]);
  } finally { await player.admin.auth.admin.deleteUser(player.userId); }
});

test('a stale bar refreshes after a competing pour without a duplicate payment', async ({ page }) => {
  const player = await createBrewedTavern('bar-stale');
  try {
    await page.goto('/login');
    await page.getByLabel('Email').fill(player.email);
    await page.getByLabel('Password').fill(player.password);
    await page.getByRole('button', { name: 'Open the ledger' }).click();
    await expect(page).toHaveURL(/\/garden$/);
    await page.getByRole('link', { name: 'Bar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Serve to Lira Nightwind' })).toBeEnabled();
    const served = await player.client.rpc('serve_beverage', {
      p_save_id: player.saveId, p_patron_key: 'torvin', p_beverage_id: player.brew.beverageId,
      p_action_id: crypto.randomUUID(), p_expected_revision: 3
    });
    expect(served.error).toBeNull();
    await page.getByRole('button', { name: 'Serve to Lira Nightwind' }).click();
    await expect(page.getByRole('alert')).toContainText('Tavern state changed');
    await expect(page.getByLabel('Tavern gold')).toContainText('40 gold');
    await expect(page.locator('.serving-history li')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'No hospitality ready to serve' })).toBeVisible();
  } finally { await player.admin.auth.admin.deleteUser(player.userId); }
});
