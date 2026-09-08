import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createTestPlayer } from '../helpers/local-supabase';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await expect(page).toHaveURL(/\/garden$/);
}

test('harvest persists across routes, reloads, and browser sessions', async ({ page, browser }) => {
  const player = await createTestPlayer('journey');
  let secondContext: BrowserContext | undefined;

  try {
    await login(page, player.email, player.password);
    await page.getByRole('button', { name: 'Start tavern' }).click();
    await expect(page.getByRole('heading', { name: 'Hex garden' })).toBeVisible();

    await page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }).click();
    await expect(page.getByText('🍯 +1 from a neighboring hive')).toBeVisible();
    await page.getByRole('button', { name: 'Harvest crop' }).click();
    await expect(page.getByRole('status')).toContainText('Harvested 2 ingredients');

    await page.getByRole('link', { name: /View ingredients/ }).click();
    await expect(page.getByRole('heading', { name: 'Fennel' })).toBeVisible();
    await expect(page.getByText('Legendary · 2 units')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Fennel' })).toBeVisible();

    secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await login(secondPage, player.email, player.password);
    await secondPage.goto('/ingredients');
    await expect(secondPage.getByText('Legendary · 2 units')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await secondPage.reload();
    await expect(secondPage.getByRole('heading', { name: 'Fennel' })).toBeVisible();

    await login(page, player.email, player.password);
    await page.goto('/garden');
    await page.getByRole('button', { name: /c1, empty garden plot/i }).click();
    await expect(page.getByRole('heading', { name: 'Open soil' })).toBeVisible();
  } finally {
    await secondContext?.close();
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('a dropped harvest response retries the same action exactly once', async ({ page }) => {
  const player = await createTestPlayer('lost-response');
  const submittedActionIds: string[] = [];
  let dropNextResponse = true;

  try {
    await login(page, player.email, player.password);
    await page.getByRole('button', { name: 'Start tavern' }).click();
    await expect(page.getByRole('heading', { name: 'Hex garden' })).toBeVisible();
    await page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }).click();
    await expect(page.getByRole('heading', { name: 'Fennel' })).toBeVisible();

    await page.route(
      (url) => url.pathname === '/garden' && url.search === '?/harvest',
      async (route) => {
        const payload = new URLSearchParams(route.request().postData() ?? '');
        submittedActionIds.push(payload.get('actionId') ?? '');

        if (dropNextResponse) {
          dropNextResponse = false;
          await route.fetch();
          await route.abort('failed');
          return;
        }

        await route.continue();
      }
    );

    await page.getByRole('button', { name: 'Harvest crop' }).click();
    await expect(page.getByRole('alert')).toContainText('outcome is unknown');
    await page.getByRole('button', { name: 'Retry harvest' }).click();
    await expect(page.getByRole('status')).toContainText('Harvested 2 ingredients');

    expect(submittedActionIds).toHaveLength(2);
    expect(submittedActionIds[0]).not.toBe('');
    expect(submittedActionIds[1]).toBe(submittedActionIds[0]);

    await page.getByRole('link', { name: /View ingredients/ }).click();
    await expect(page.getByText('Legendary · 2 units')).toBeVisible();
    await expect(page.getByText('1 batch')).toBeVisible();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('a harvested ingredient becomes a persistent brew, social card, and completed tavern day', async ({ page }) => {
  test.setTimeout(45_000);
  const player = await createTestPlayer('brew-journey');
  const pageErrors: string[] = [];
  page.on('pageerror', (cause) => pageErrors.push(cause.message));

  try {
    await login(page, player.email, player.password);
    await page.getByRole('button', { name: 'Start tavern' }).click();
    await expect(page.getByRole('heading', { name: 'Hex garden' })).toBeVisible();
    await page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }).click();
    await page.getByRole('button', { name: 'Harvest crop' }).click();
    await expect(page.getByRole('status')).toContainText('Harvested 2 ingredients');

    await page.getByRole('link', { name: 'Brewery', exact: true }).click();
    await expect(page.getByRole('heading', { name: "Prepare today's infusion" })).toBeVisible();
    await expect(page.getByText('Legendary · 2 units · Brew +2')).toBeVisible();
    await page.getByRole('button', { name: 'Begin 30-second brew' }).click();
    await expect(page.getByRole('heading', { name: 'Stir the wort' })).toBeVisible();
    await expect(page.locator('.brew-progress-heading strong')).not.toHaveText('30s');

    const slider = page.getByLabel('Stirring speed');
    await slider.press('End');
    await expect(page.locator('.zone-readout strong')).toHaveText('Too fast');
    await slider.press('Home');
    await expect(page.locator('.zone-readout strong')).toHaveText('Too slow');
    await slider.evaluate((control) => {
      const input = control as HTMLInputElement;
      input.value = '50';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('.zone-readout strong')).toHaveText('Perfect');

    const snapshotResult = await player.client.rpc('get_tavern_snapshot');
    expect(snapshotResult.error).toBeNull();
    const snapshot = snapshotResult.data as unknown as {
      brewery: { activeSession: { id: string } | null };
    };
    expect(snapshot.brewery.activeSession).not.toBeNull();

    const backdated = await player.admin
      .from('brew_sessions')
      .update({ started_at: new Date(Date.now() - 31_000).toISOString() })
      .eq('id', snapshot.brewery.activeSession!.id);
    expect(backdated.error).toBeNull();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Bottle this brew' })).toBeEnabled();
    await page.getByRole('button', { name: 'Bottle this brew' }).click();

    await expect(page.getByRole('heading', { name: 'Honest Mead' })).toBeVisible();
    await expect(page.getByText('Decent', { exact: true })).toBeVisible();
    await expect(page.getByText('Social card earned · fine')).toBeVisible();
    await expect(page.getByText('Relationship +5 · Gold ×1.2')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Honest Mead' })).toBeVisible();
    await page.getByRole('link', { name: 'Ingredients', exact: true }).click();
    await expect(page.getByText('Legendary · 1 unit')).toBeVisible();

    await page.getByRole('link', { name: 'Brewery', exact: true }).click();
    await page.getByRole('link', { name: 'Serve a drink at the bar' }).click();
    await expect(page.getByRole('heading', { name: 'The bar', exact: true })).toBeVisible();
    await page.getByLabel('Social card').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Serve to Lira Nightwind' }).click();
    await expect(page.getByRole('status')).toContainText('Earned 14 gold');
    await expect(page.getByLabel('Tavern gold')).toContainText('14 gold');
    await expect(page.getByRole('heading', { name: 'No drinks ready to serve' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Tavern gold')).toContainText('14 gold');
    await expect(page.getByText('Relationship +8 · Story 0', { exact: false })).toBeVisible();
    await page.getByRole('link', { name: 'Brewery', exact: true }).click();
    await page.getByRole('button', { name: 'Rest and begin next day' }).click();
    await expect(page.getByText('Tavern day 2 · Daily craft')).toBeVisible();
    await expect(page.getByRole('heading', { name: "Prepare today's infusion" })).toBeVisible();
    await expect(page.getByText('Honest Mead')).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
