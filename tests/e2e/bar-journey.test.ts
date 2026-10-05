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

/**
 * The seeded roster is installed through immutable resident packages. Its
 * order and display names are package data, so these journeys interact with
 * the rendered package projection instead of treating pilot names as IDs.
 */
function barResidents(page: import('@playwright/test').Page) {
  return page.getByRole('group', { name: 'Scene characters' }).getByRole('button');
}

async function residentName(button: import('@playwright/test').Locator) {
  const label = await button.getAttribute('aria-label');
  const match = label?.match(/^Speak with (.+): \1$/);
  if (!match) throw new Error(`Unexpected Bar resident label: ${label ?? '(missing)'}`);
  return match[1];
}

test('the Bar puts present residents in the illustrated room and selects them without navigating', async ({ page }) => {
  const player = await createBrewedTavern('bar-uuid-roster');
  try {
    await signInAndOpenBar(page, player);
    const residents = barResidents(page);
    const first = residents.nth(0);
    const second = residents.nth(1);
    // The actors are present in SSR markup, but keyboard handlers intentionally
    // remain inert until the scaled scene has hydrated and aligned its targets.
    await expect(page.locator('[data-area-scene="bar"]')).toHaveAttribute('data-scene-ready', 'true');
    await expect(residents).toHaveCount(2);
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    const firstName = await residentName(first);
    const secondName = await residentName(second);
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await first.focus();
    await page.keyboard.press('ArrowRight');
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute('tabindex', '0');
    // Focus is a roving cursor only; it must not change the current guest.
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(second).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/\/bar\?npc=[^&]+$/);
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: secondName, exact: true })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(first).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: firstName, exact: true })).toBeVisible();
    await second.click();
    const actions = page.getByRole('tablist', { name: `Actions for ${secondName}` });
    await expect(actions.getByRole('tab', { name: 'Talk' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: `Talk with ${secondName}` })).toBeAttached();
    await expect(page.getByText('Choose your intent', { exact: true })).toBeVisible();
    await actions.getByRole('tab', { name: 'Serve' }).click();
    await expect(page.getByRole('heading', { name: 'Offer something' })).toBeVisible();
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
    const recipient = barResidents(page).nth(1);
    await expect(recipient).toBeVisible();
    const recipientName = await residentName(recipient);
    await recipient.click();
    const actions = page.getByRole('tablist', { name: `Actions for ${recipientName}` });
    await actions.getByRole('tab', { name: 'Serve' }).click();
    await page.route((url) => url.pathname === '/bar' && url.search === '?/serve', async (route) => {
      requests.push(route.request().postData() ?? '');
      if (requests.length === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: `Serve to ${recipientName}` }).click();
    await expect(page.getByRole('alert')).toContainText('serving outcome is unknown');
    await page.getByRole('button', { name: 'Retry the same serving' }).click();
    await expect(page.getByRole('status')).toContainText('Earned');
    expect(requests).toHaveLength(2);
    expect(Object.fromEntries(new URLSearchParams(requests[0]))).toEqual(Object.fromEntries(new URLSearchParams(requests[1])));

    const context = await browser.newContext();
    try {
      const other = await context.newPage();
      await signInAndOpenBar(other, player);
      const otherActions = other.getByRole('tablist', { name: /^Actions for / });
      await otherActions.getByRole('tab', { name: 'Serve' }).click();
      await expect(other.getByText('No hospitality is ready to serve.', { exact: true })).toBeVisible();
      await other.getByRole('link', { name: 'Keeper’s Journal' }).click();
      await expect(other.locator('.history-list li')).toHaveCount(1);
    } finally { await context.close(); }
    expect(errors).toEqual([]);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
