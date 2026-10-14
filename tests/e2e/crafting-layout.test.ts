import { expect, test, type Page } from '@playwright/test';
import { createTestPlayer } from '../helpers/local-supabase';

async function loginAndHarvest(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await page.getByRole('button', { name: 'Start tavern' }).click();
  const fennel = page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i });
  await expect(page.locator('main[data-hydrated="true"]')).toBeVisible();
  await fennel.click();
  await expect(fennel).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-workflow-choice="harvest"]').click();
  await expect(page.getByRole('status')).toContainText(/Harvested \d+ ingredients?/);
}

async function stableOverflow(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return document.documentElement.scrollWidth - window.innerWidth;
  });
}

test('the shared crafting layout preserves scene-first semantics at every target viewport', async ({ page }) => {
  test.setTimeout(75_000);
  const player = await createTestPlayer('crafting-framework');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await loginAndHarvest(page, player.email, player.password);
    for (const route of ['garden', 'bakery', 'brewery']) {
      await page.goto(`/${route}`);
      const layout = page.locator('.card-workflow-frame');
      await expect(layout).toBeVisible();
      await expect(layout.locator(`[data-area-scene="${route}"]`)).toBeVisible();
      await expect(layout.locator('h1')).toBeVisible();
      for (const viewport of [{ width: 1672, height: 941 }, { width: 1440, height: 900 },
        { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        expect(await stableOverflow(page)).toBeLessThanOrEqual(0);
        await expect(layout.locator('.workflow-scene')).toBeVisible();
        if (route === 'garden') {
          const plot = layout.locator('.hex-cell').first();
          const target = await plot.boundingBox();
          expect(target!.width).toBeGreaterThanOrEqual(44);
          expect(target!.height).toBeGreaterThanOrEqual(44);
        }
      }
    }
    await page.goto('/garden');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('[data-area-scene="garden"]')).toHaveAttribute('data-reduced-motion', 'true');
    await expect(page.locator('[data-scene-layer="garden bees and leaves"]')).toHaveCSS('animation-name', 'none');
    expect(errors).toEqual([]);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
