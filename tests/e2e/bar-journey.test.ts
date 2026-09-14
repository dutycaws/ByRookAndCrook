import { expect, test } from '@playwright/test';
import { createBrewedTavern } from '../helpers/brewed-tavern';

async function signInAndOpenBar(page: import('@playwright/test').Page, player: Awaited<ReturnType<typeof createBrewedTavern>>) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(player.email);
  await page.getByLabel('Password').fill(player.password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await expect(page).toHaveURL(/\/garden$/);
  await page.getByRole('link', { name: 'Bar', exact: true }).click();
  await expect(page).toHaveURL(/\/bar$/);
}

test('the Bar puts present residents in the illustrated room and selects them without navigating', async ({ page }) => {
  const player = await createBrewedTavern('bar-uuid-roster');
  try {
    await signInAndOpenBar(page, player);
    const room = page.locator('[data-scene-composition="bar"]');
    const lira = room.getByRole('button', { name: /Speak with Lira Nightwind/ });
    const torvin = room.getByRole('button', { name: /Speak with Torvin Ashbeard/ });
    // The actors are present in SSR markup, but keyboard handlers intentionally
    // remain inert until the scaled scene has hydrated and aligned its targets.
    await expect(page.locator('[data-area-scene="bar"]')).toHaveAttribute('data-scene-ready', 'true');
    await expect(lira).toBeVisible();
    await expect(torvin).toBeVisible();
    await expect(lira).toHaveAttribute('aria-pressed', 'true');
    await lira.focus();
    await page.keyboard.press('ArrowRight');
    await expect(torvin).toBeFocused();
    await expect(torvin).toHaveAttribute('tabindex', '0');
    // Focus is a roving cursor only; it must not change the current guest.
    await expect(lira).toHaveAttribute('aria-pressed', 'true');
    await expect(torvin).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/\/bar$/);
    await expect(page.getByRole('heading', { name: 'Torvin Ashbeard', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(lira).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Lira Nightwind', exact: true })).toBeVisible();
    await torvin.click();
    await expect(page.getByRole('heading', { name: 'Serve food or drink' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Talk with Torvin Ashbeard' })).toBeAttached();
    await expect(page.getByText('Choose your intent', { exact: true })).toBeVisible();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('a lost UUID serving response retries the frozen resident and item command exactly once', async ({ page, browser }) => {
  const player = await createBrewedTavern('bar-uuid-retry');
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (cause) => errors.push(cause.message));
  try {
    await signInAndOpenBar(page, player);
    await page.locator('[data-scene-composition="bar"]').getByRole('button', { name: /Speak with Torvin Ashbeard/ }).click();
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
    await page.getByRole('button', { name: 'Retry the same serving' }).click();
    await expect(page.getByRole('status')).toContainText('Earned');
    expect(requests).toHaveLength(2);
    expect(Object.fromEntries(new URLSearchParams(requests[0]))).toEqual(Object.fromEntries(new URLSearchParams(requests[1])));

    const context = await browser.newContext();
    try {
      const other = await context.newPage();
      await signInAndOpenBar(other, player);
      await expect(other.getByRole('heading', { name: 'No hospitality ready to serve' })).toBeVisible();
      await expect(other.locator('.serving-history li')).toHaveCount(1);
    } finally { await context.close(); }
    expect(errors).toEqual([]);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
