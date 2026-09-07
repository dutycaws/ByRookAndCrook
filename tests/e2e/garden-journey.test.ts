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
