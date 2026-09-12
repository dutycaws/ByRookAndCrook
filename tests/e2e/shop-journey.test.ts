import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createTestPlayer } from '../helpers/local-supabase';

async function loginAndCreate(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await page.getByRole('button', { name: 'Start tavern' }).click();
  await expect(page.getByRole('heading', { name: 'Hex garden' })).toBeVisible();
}

async function fundPlayer(page: Page, saveId: string, gold = 500) {
  execFileSync('docker', [
    'exec', 'supabase_db_by-rook-and-crook', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-c', `update public.tavern_saves set gold=${gold} where id='${saveId}'::uuid`
  ]);
  await page.reload();
}

test('the Shop is reachable from Garden and filters Elara’s catalog without changing game rules', async ({ page }) => {
  const player = await createTestPlayer('shop-navigation');
  try {
    await loginAndCreate(page, player.email, player.password);
    await page.getByRole('link', { name: 'Shop', exact: true }).click();
    await expect(page).toHaveURL(/\/shop$/);
    await expect(page.getByRole('heading', { name: "Elara's garden shop" })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Elara Greenbloom' })).toBeVisible();
    await expect(page.getByText('Garden capacity', { exact: true })).toBeVisible();

    const allGoods = page.locator('[data-good-category]');
    const allCount = await allGoods.count();
    expect(allCount).toBeGreaterThan(3);
    await page.getByRole('radio', { name: 'Seeds' }).check();
    expect(await page.locator('[data-good-category="seeds"]').count()).toBeGreaterThan(0);
    await expect(page.locator('[data-good-category="garden"], [data-good-category="apiary"]')).toHaveCount(0);
    await page.getByRole('radio', { name: 'Apiary' }).check();
    await expect(page.locator('[data-good-category="apiary"]')).not.toHaveCount(0);
    await page.locator('[data-good-category="apiary"]').first().getByRole('button', { name: 'View details' }).click();
    await expect(page.getByText('Selected good', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview purchase' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to goods' }).click();
    await expect(page.getByText('Selected good', { exact: true })).toBeHidden();
    await page.getByRole('radio', { name: 'Seeds' }).check();
    await expect(page.getByText('Selected good', { exact: true })).toBeHidden();

    await page.goto('/garden');
    await expect(page.getByRole('heading', { name: 'Hex garden' })).toBeVisible();
    await expect(page.locator('[data-contextual-action]')).toHaveCount(0);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('Shop purchase and expansion use previews, preserve retry ids, and update the existing garden contracts', async ({ page }) => {
  const player = await createTestPlayer('shop-purchase');
  const actionIds: string[] = [];
  let loseFirstCommit = true;
  try {
    await loginAndCreate(page, player.email, player.password);
    const snapshot = await player.client.rpc('get_tavern_snapshot');
    expect(snapshot.error).toBeNull();
    const state = snapshot.data as unknown as { save: { id: string } };
    await page.goto('/shop');
    await fundPlayer(page, state.save.id);

    const seed = page.locator('[data-good-category="seeds"]').first();
    await seed.getByRole('button', { name: 'View details' }).click();
    await page.getByLabel('Quantity').fill('2');
    await page.getByRole('button', { name: 'Preview purchase' }).click();
    const dialog = page.locator('dialog.shop-preview');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'Purchase summary' })).toContainText('Quantity2');
    await expect(dialog).toContainText('Resulting inventory');

    await page.route((url) => url.pathname === '/shop' && url.search === '?/command', async (route) => {
      const body = new URLSearchParams(route.request().postData() ?? '');
      actionIds.push(body.get('actionId') ?? '');
      if (loseFirstCommit) {
        loseFirstCommit = false;
        await route.fetch();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await dialog.getByRole('button', { name: /^Buy — / }).click();
    await expect(page.getByRole('alert')).toContainText('outcome is unknown');
    await dialog.getByRole('button', { name: /Retry buy supplies/i }).click();
    await expect(dialog.getByRole('heading', { name: 'Purchase complete' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Buy another' })).toBeFocused();
    expect(actionIds).toHaveLength(2);
    expect(actionIds[0]).not.toBe('');
    expect(actionIds[1]).toBe(actionIds[0]);

    await dialog.getByRole('button', { name: 'Continue shopping' }).click();
    await page.getByRole('button', { name: /Expand to 16 plots/ }).click();
    await expect(dialog).toContainText('Garden expansion');
    await dialog.getByRole('button', { name: 'Expand garden' }).click();
    await expect(dialog).toBeHidden();
    await page.goto('/garden');
    await expect(page.locator('[data-garden-cell]')).toHaveCount(16);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('Shop keeps unavailable details inspectable and reconciles affordable and stock-correction flows', async ({ page }) => {
  const player = await createTestPlayer('shop-unavailable');
  try {
    await loginAndCreate(page, player.email, player.password);
    const snapshot = await player.client.rpc('get_tavern_snapshot');
    const state = snapshot.data as unknown as { save: { id: string } };
    await page.goto('/shop');
    await fundPlayer(page, state.save.id, 0);

    const firstGood = page.locator('[data-good-category]').first();
    await firstGood.getByRole('button', { name: 'View details' }).click();
    await page.getByRole('button', { name: 'Preview purchase' }).click();
    const dialog = page.locator('dialog.shop-preview');
    await expect(dialog.getByRole('alert')).toContainText(/Need \d+ more gold/);
    await dialog.getByRole('button', { name: 'View affordable goods' }).click();
    await expect(page.getByText('Showing goods you can afford.', { exact: false })).toBeVisible();
    await expect(page.getByText('Selected good', { exact: true })).toBeHidden();

    await fundPlayer(page, state.save.id, 500);
    execFileSync('docker', [
      'exec', 'supabase_db_by-rook-and-crook', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', `update public.garden_shop_stock set remaining_quantity=1 where save_id='${state.save.id}'::uuid`
    ]);
    await page.reload();
    await page.locator('[data-good-category="seeds"]').first().getByRole('button', { name: 'View details' }).click();
    await page.getByLabel('Quantity').fill('2');
    await page.getByRole('button', { name: 'Preview purchase' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Only 1 left');
    await dialog.getByRole('button', { name: 'Correct quantity' }).click();
    await expect(page.getByLabel('Quantity')).toHaveValue('1');
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('Shop remains usable when its illustrative assets fail and at a mobile width', async ({ page }) => {
  const player = await createTestPlayer('shop-assets');
  try {
    await page.route('**/assets/scenes/shop-environment.webp', (route) => route.abort('failed'));
    await page.route('**/assets/scenes/shop/elara-merchant.webp', (route) => route.abort('failed'));
    await page.route('**/assets/scenes/shop/elara-portrait.webp', (route) => route.abort('failed'));
    await loginAndCreate(page, player.email, player.password);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/shop');
    await expect(page.getByRole('heading', { name: "Elara's garden shop" })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Garden' })).toBeVisible();
    await expect(page.locator('[data-good-category]').first().getByRole('button', { name: 'View details' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
