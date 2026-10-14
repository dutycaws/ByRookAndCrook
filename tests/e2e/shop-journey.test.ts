import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createTestPlayer, getLocalTestDatabaseContainer } from '../helpers/local-supabase';

async function loginAndCreate(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await page.getByRole('button', { name: 'Start tavern' }).click();
  await expect(page.getByRole('group', { name: /Illustrated tavern courtyard with \d+ selectable garden plots/i })).toBeVisible();
}

async function fundPlayer(page: Page, saveId: string, gold = 500) {
  execFileSync('docker', ['exec', getLocalTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `update public.tavern_saves set gold=${gold} where id='${saveId}'::uuid`]);
  await page.reload();
}

function updateStock(saveId: string, quantity: number, itemKey?: string) {
  const itemClause = itemKey ? ` and item_key='${itemKey}'` : '';
  execFileSync('docker', ['exec', getLocalTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `update public.garden_shop_stock set remaining_quantity=${quantity},restock_day=2 where save_id='${saveId}'::uuid${itemClause}`]);
}

async function saveIdFor(player: Awaited<ReturnType<typeof createTestPlayer>>) {
  const snapshot = await player.client.rpc('get_tavern_snapshot');
  expect(snapshot.error).toBeNull();
  return (snapshot.data as unknown as { save: { id: string } }).save.id;
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function openFundedShop(page: Page, player: Awaited<ReturnType<typeof createTestPlayer>>, gold = 500) {
  await loginAndCreate(page, player.email, player.password);
  const saveId = await saveIdFor(player);
  await page.goto('/shop');
  await fundPlayer(page, saveId, gold);
  return saveId;
}

test('Shop keeps Elara visible through category, hand, inspection, and back navigation', async ({ page }) => {
  const player = await createTestPlayer('shop-ember-opening');
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFundedShop(page, player);
    const market = page.locator('[data-shop-market]');
    const scene = page.locator('[data-shop-scene]');
    await expect(market).toHaveAttribute('data-shop-stage', 'categories');
    await expect(scene).toHaveAttribute('data-shop-scene-persistent', 'true');
    await expect(scene.locator('[data-scene-actor="shop-elara"]')).toHaveAttribute('aria-label', 'Elara Greenbloom');
    await page.getByRole('button', { name: 'Seeds', exact: true }).click();
    const hops = page.getByRole('button', { name: 'Hops seed', exact: true });
    await expect(hops).toBeVisible();
    await page.getByRole('button', { name: 'Hops seed', exact: true }).click();
    const inspection = page.locator('.workflow-inspection');
    await expect(inspection.getByRole('heading', { name: 'Hops seed' })).toBeVisible();
    await expect(inspection.getByRole('button', { name: 'Hops seed.', exact: false })).toBeEnabled();
    await expect(scene).toBeVisible();
    await noHorizontalOverflow(page);
    await inspection.getByRole('button', { name: /Choose another/ }).click();
    await expect(hops).toBeVisible();
    await page.getByRole('button', { name: 'All categories' }).click();
    await expect(page.getByRole('button', { name: 'Seeds', exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('Shop purchases a social seed and uses Potion of Forgetfulness on a physical social copy', async ({ page }) => {
  test.setTimeout(60_000);
  const player = await createTestPlayer('shop-issue39-acquisitions');
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFundedShop(page, player);
    const snapshot = await player.client.rpc('get_tavern_snapshot');
    expect(snapshot.error).toBeNull();
    const revision = (snapshot.data as unknown as { save: { revision: number } }).save.revision;
    const opened = await (player.client.rpc as any)('daily_deck_open', {
      p_expected_revision: revision
    });
    expect(opened.error).toBeNull();
    await page.goto('/shop');
    await expect(page.locator('[data-shop-ready]')).toHaveAttribute('data-shop-ready', 'true');

    await page.getByRole('button', { name: 'Seeds', exact: true }).click();
    // The rendered catalog label is Charm Bloom seed; the card copy names its Charm effect.
    const socialSeed = page.getByRole('button', { name: 'Charm Bloom seed', exact: true });
    await expect(socialSeed).toBeVisible();
    await socialSeed.click();
    const seedInspection = page.locator('.workflow-inspection');
    await expect(seedInspection).toContainText("schedule one Charm social copy for tomorrow's deck");
    await seedInspection.getByRole('button', { name: 'Charm Bloom seed.', exact: false }).click();
    const acquisition = page.getByRole('dialog', { name: 'Charm Bloom seed' });
    await expect(acquisition).toContainText('1 acquired');
    await acquisition.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue shopping', exact: true }).click();
    await page.getByRole('button', { name: 'All categories' }).click();

    await page.getByRole('button', { name: 'Provisions', exact: true }).click();
    const purchase = page.locator('[data-forgetfulness-purchase]');
    await expect(purchase).toBeVisible();
    await purchase.getByRole('button', { name: 'Buy · 12 gold' }).click();
    await expect(page.getByText('Potion of Forgetfulness purchased for 12 gold.')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-shop-ready]')).toHaveAttribute('data-shop-ready', 'true');
    await page.getByRole('button', { name: 'Provisions', exact: true }).click();

    const usePotion = page.locator('[data-forgetfulness-use]');
    await expect(usePotion).toContainText('Potion of Forgetfulness · 1 held');
    const selectedCopy = await usePotion.getByRole('combobox', { name: 'Choose a social copy to remove tomorrow' }).inputValue();
    await usePotion.getByRole('button', { name: 'Schedule removal tomorrow' }).click();
    await expect(page.getByText(/copy will leave tomorrow's deck/)).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-shop-ready]')).toHaveAttribute('data-shop-ready', 'true');
    await page.getByRole('button', { name: 'Provisions', exact: true }).click();
    await expect(page.locator('[data-forgetfulness-use]')).toContainText('Potion of Forgetfulness · 0 held');
    await expect(page.locator(`[data-forgetfulness-use] option[value="${selectedCopy}"]`)).toHaveCount(0);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('Shop previews automatically and ignores late obsolete previews', async ({ page }) => {
  const player = await createTestPlayer('shop-art6-preview');
  try {
    await openFundedShop(page, player);
    await page.getByRole('button', { name: 'Browse Seeds', exact: true }).click();
    const detail = page.locator('[data-shop-detail]');
    let releaseSlowPreview!: () => void;
    let markSlowPreviewStarted!: () => void;
    const slowPreview = new Promise<void>((resolve) => { releaseSlowPreview = resolve; });
    const slowPreviewStarted = new Promise<void>((resolve) => { markSlowPreviewStarted = resolve; });
    await page.route((url) => url.pathname === '/shop' && url.search === '?/preview', async (route) => {
      const body = new URLSearchParams(route.request().postData() ?? '');
      const payload = JSON.parse(body.get('payload') ?? '{}') as { itemKey?: string };
      if (payload.itemKey !== 'seed_hops') return route.continue();
      const response = await route.fetch();
      markSlowPreviewStarted();
      await slowPreview;
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Select Hops seed' }).click();
    await slowPreviewStarted;
    await detail.getByRole('button', { name: 'Back to goods' }).click();
    await page.getByRole('button', { name: 'Select Chamomile seed' }).click();
    await expect(detail.getByRole('heading', { name: 'Chamomile seed' })).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Buy for 2 gold' })).toBeEnabled();
    releaseSlowPreview();
    await expect(detail.getByRole('heading', { name: 'Chamomile seed' })).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Buy for 2 gold' })).toBeEnabled();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('Shop retry keeps its action identity and receipt Escape does not close the underlying detail', async ({ page }) => {
  const player = await createTestPlayer('shop-art6-receipt');
  const actionIds: string[] = [];
  let loseFirstCommit = true;
  try {
    await openFundedShop(page, player);
    await page.getByRole('button', { name: 'Browse Seeds', exact: true }).click();
    await page.getByRole('button', { name: 'Select Hops seed' }).click();
    const quantity = page.getByLabel('Quantity');
    await quantity.fill('2');
    await quantity.blur();
    await expect(page.getByRole('button', { name: 'Buy for 4 gold' })).toBeEnabled();
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
    await page.getByRole('button', { name: 'Buy for 4 gold' }).click();
    await expect(page.getByRole('alert')).toContainText('outcome is unknown');
    await expect(page.getByRole('button', { name: 'Back to goods' })).toBeDisabled();
    await page.getByRole('link', { name: 'Garden', exact: true }).click();
    await expect(page).toHaveURL(/\/shop$/);
    await page.getByRole('button', { name: 'Retry · Buy for 4 gold' }).click();
    const receipt = page.locator('[data-shop-receipt]');
    await expect(receipt.getByRole('heading', { name: 'Purchase complete' })).toBeVisible();
    await expect(receipt).toContainText('2 × Hops seed');
    await expect(receipt.getByRole('button', { name: 'Buy another' })).toBeFocused();
    expect(actionIds).toHaveLength(2);
    expect(actionIds[0]).not.toBe('');
    expect(actionIds[1]).toBe(actionIds[0]);
    await page.keyboard.press('Escape');
    await expect(receipt).toBeVisible();
    await expect(page.locator('[data-shop-detail]')).toBeVisible();
    await receipt.getByRole('button', { name: 'Buy another' }).click();
    await expect(page.locator('[data-shop-detail]').getByRole('heading', { name: 'Hops seed' })).toBeVisible();
    await expect(quantity).toHaveValue('1');
    await page.getByRole('button', { name: 'Buy for 2 gold' }).click();
    await expect(receipt.getByRole('heading', { name: 'Purchase complete' })).toBeVisible();
    expect(actionIds[2]).not.toBe(actionIds[0]);
    await receipt.getByRole('button', { name: 'Continue shopping' }).click();
    await expect(page.locator('[data-shop-market]')).toHaveAttribute('data-shop-stage', 'items');
    await expect(page.getByRole('button', { name: 'Select Hops seed' })).toBeVisible();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('Shop keeps insufficient, excess-quantity, and sold-out states in the expanded detail surface', async ({ page }) => {
  const player = await createTestPlayer('shop-art6-unavailable');
  try {
    const saveId = await openFundedShop(page, player, 0);
    await page.getByRole('button', { name: 'Browse Seeds', exact: true }).click();
    const detail = page.locator('[data-shop-detail]');
    await page.getByRole('button', { name: 'Select Hops seed' }).click();
    await expect(detail.getByRole('alert')).toContainText('Not enough gold');
    await expect(detail.getByRole('alert')).toContainText('Need 2 more gold');
    await expect(detail.getByRole('button', { name: 'Buy for 2 gold' })).toBeDisabled();
    await detail.getByRole('button', { name: 'View affordable goods' }).click();
    await expect(page.locator('[data-shop-market]')).toHaveAttribute('data-shop-stage', 'items');
    await expect(page.getByText('Showing goods you can afford.', { exact: false })).toBeVisible();
    await fundPlayer(page, saveId, 500);
    updateStock(saveId, 1);
    await page.reload();
    await page.getByRole('button', { name: 'Browse Seeds', exact: true }).click();
    await page.getByRole('button', { name: 'Select Hops seed' }).click();
    const quantity = page.getByLabel('Quantity');
    await quantity.fill('2');
    await quantity.blur();
    await expect(detail.getByRole('alert')).toContainText('Only 1 left');
    await detail.getByRole('button', { name: 'Use available quantity' }).click();
    await expect(quantity).toHaveValue('1');
    await expect(detail.getByRole('button', { name: 'Buy for 2 gold' })).toBeEnabled();
    updateStock(saveId, 0, 'seed_hops');
    await page.reload();
    await page.getByRole('button', { name: 'Browse Seeds', exact: true }).click();
    const soldOutTile = page.locator('[data-good-key="seed_hops"]');
    await expect(soldOutTile).toContainText('Sold out');
    await soldOutTile.getByRole('button', { name: 'Select Hops seed' }).click();
    await expect(detail.getByRole('alert')).toContainText('Out of stock');
    await expect(detail.getByRole('button', { name: 'Buy for 2 gold' })).toBeDisabled();
    await expect(detail.getByRole('button', { name: 'Back to goods' })).toBeVisible();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('Garden expansion is a garden-care card with a real capacity receipt', async ({ page }) => {
  const player = await createTestPlayer('shop-ember-expansion');
  try {
    const saveId = await openFundedShop(page, player, 0);
    await page.getByRole('button', { name: 'Browse Garden care', exact: true }).click();
    await page.getByRole('button', { name: 'Select garden expansion to 16 plots' }).click();
    const detail = page.locator('[data-shop-detail]');
    await expect(detail.getByRole('heading', { name: 'Expand to 16 plots' })).toBeVisible();
    await expect(detail.getByRole('alert')).toContainText('Need 60 more gold');
    await detail.getByRole('button', { name: 'Back to goods' }).click();
    await expect(page.getByRole('button', { name: 'Select garden expansion to 16 plots' })).toBeFocused();
    await fundPlayer(page, saveId, 500);
    await page.getByRole('button', { name: 'Browse Garden care', exact: true }).click();
    await page.getByRole('button', { name: 'Select garden expansion to 16 plots' }).click();
    await detail.getByRole('button', { name: 'Expand to 16 plots for 60 gold' }).click();
    const receipt = page.locator('[data-shop-receipt]');
    await expect(receipt.getByRole('heading', { name: 'Garden expanded' })).toBeVisible();
    await receipt.getByRole('button', { name: 'Continue shopping' }).click();
    await page.getByRole('button', { name: 'Select garden expansion to 24 plots' }).click();
    await detail.getByRole('button', { name: 'Expand to 24 plots for 180 gold' }).click();
    await expect(receipt.getByRole('heading', { name: 'Garden expanded' })).toBeVisible();
    await expect(receipt.getByLabel('Quantity')).toHaveCount(0);
    await receipt.getByRole('button', { name: 'Continue shopping' }).click();
    await expect(page.getByRole('button', { name: /Select garden expansion/ })).toHaveCount(0);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('Shop survives asset failures and remains reachable at 1440, 768, and 390 pixels with reduced motion', async ({ page }) => {
  const player = await createTestPlayer('shop-art6-responsive');
  try {
    await page.route('**/*.webp', (route) => route.abort('failed'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFundedShop(page, player);
    await expect(page.getByRole('button', { name: 'Seeds', exact: true })).toBeVisible();
    await expect(page.locator('[data-shop-scene] [data-scene-actor="shop-elara"]')).toBeVisible();
    await noHorizontalOverflow(page);
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.getByRole('button', { name: 'Seeds', exact: true })).toBeInViewport();
    await expect(page.locator('[data-shop-scene] [data-scene-actor="shop-elara"]')).toBeVisible();
    await noHorizontalOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Seeds', exact: true })).toBeInViewport();
    await expect(page.locator('[data-shop-scene] [data-scene-actor="shop-elara"]')).toBeVisible();
    await noHorizontalOverflow(page);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
