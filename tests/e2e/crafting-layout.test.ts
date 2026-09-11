import { expect, test, type Page } from '@playwright/test';
import { createTestPlayer } from '../helpers/local-supabase';

async function loginAndHarvest(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await page.getByRole('button', { name: 'Start tavern' }).click();
  await page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }).click();
  const harvestButton = page.getByRole('button', { name: 'Harvest crop' });
  await expect(harvestButton).toBeEnabled();
  await harvestButton.click();
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
    for (const route of ['garden', 'brewery', 'bakery'] as const) {
      await page.goto(`/${route}`);
      const layout = page.locator(`[data-crafting-layout="${route}"]`);
      await expect(layout).toBeVisible();
      await expect(layout.locator('[data-contextual-action]')).toBeVisible();
      await expect(layout.locator('[data-scene-rail="inspector"]')).toBeVisible();
      const retiredPlaceholders = route === 'garden'
        ? /adjust heat|skim foam|vent steam|helper chat|draw card/i
        : /water|fertiliz|adjust heat|skim foam|vent steam|helper chat|draw card/i;
      await expect(page.getByRole('button', { name: retiredPlaceholders })).toHaveCount(0);
      await expect(page.getByText(/daily tasks|tavern level|reputation|\bXP\b/i)).toHaveCount(0);

      for (const viewport of [
        { width: 1672, height: 941 },
        { width: 1440, height: 900 },
        { width: 768, height: 1024 },
        { width: 390, height: 844 }
      ]) {
        await page.setViewportSize(viewport);
        await expect(layout).toBeVisible();
        expect(await stableOverflow(page)).toBeLessThanOrEqual(0);
        const scene = await layout.locator('.crafting-scene').boundingBox();
        const action = await layout.locator('.crafting-action').boundingBox();
        expect(scene && action).toBeTruthy();
        if (viewport.width <= 1000) expect(action!.y).toBeGreaterThanOrEqual(scene!.y + scene!.height - 1);
        if (viewport.width <= 620) {
          await expect(layout.locator('.desktop-status')).toBeHidden();
          await expect(layout.locator('.mobile-status')).toBeVisible();
        } else {
          await expect(layout.locator('.desktop-status')).toBeVisible();
        }

        if (route === 'garden') {
          const geometry = await layout.locator('.plot-node').evaluateAll((nodes) => nodes.map((node) => {
            const plot = node.getBoundingClientRect();
            const hit = node.querySelector('.hex-cell')!.getBoundingClientRect();
            const art = node.querySelector('.plot-base')!.getBoundingClientRect();
            const scene = node.closest('[data-area-scene]')!.getBoundingClientRect();
            return {
              hitWidth: hit.width,
              hitHeight: hit.height,
              centerDelta: Math.hypot((hit.left + hit.width / 2) - (art.left + art.width / 2), (hit.top + hit.height / 2) - (art.top + art.height / 2)),
              withinScene: hit.left >= scene.left - 1 && hit.right <= scene.right + 1 && hit.top >= scene.top - 1 && hit.bottom <= scene.bottom + 1,
              sameOrigin: Math.abs(plot.left - hit.left) <= 1 && Math.abs(plot.top - hit.top) <= 1
            };
          }));
          expect(geometry).toHaveLength(12);
          for (const plot of geometry) {
            expect(plot.hitWidth).toBeGreaterThanOrEqual(44);
            expect(plot.hitHeight).toBeGreaterThanOrEqual(44);
            expect(plot.centerDelta).toBeLessThanOrEqual(1);
            expect(plot.withinScene).toBe(true);
            expect(plot.sameOrigin).toBe(true);
          }
        }
      }
    }

    await page.goto('/garden');
    await page.setViewportSize({ width: 390, height: 844 });
    const selectedPlot = page.getByRole('button', { name: /^c1,/i });
    const anotherPlot = page.getByRole('button', { name: /^c4,/i });
    await expect.poll(async () => (await anotherPlot.boundingBox())?.width ?? 0).toBeLessThan(100);
    const beforeSelection = await anotherPlot.boundingBox();
    await anotherPlot.click();
    await expect(anotherPlot).toHaveAttribute('aria-pressed', 'true');
    const afterSelection = await anotherPlot.boundingBox();
    for (const edge of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(afterSelection![edge] - beforeSelection![edge])).toBeLessThanOrEqual(0.5);
    }
    await selectedPlot.focus();
    await expect(selectedPlot).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(selectedPlot).toHaveAttribute('aria-pressed', 'true');
    const target = await selectedPlot.boundingBox();
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(target!.height).toBeGreaterThanOrEqual(44);
    if (await page.evaluate(() => navigator.maxTouchPoints > 0)) {
      const touchHarvestable = page.getByRole('button', { name: /ready to harvest/i }).first();
      await touchHarvestable.tap();
      await expect(touchHarvestable).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Harvest crop' }).tap();
      await expect(page.getByRole('status')).toContainText(/Harvested \d ingredients?/);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('[data-area-scene="garden"]')).toHaveAttribute('data-reduced-motion', 'true');
    await expect(page.locator('[data-scene-layer="garden bees and leaves"]')).toHaveCSS('animation-name', 'none');
    expect(errors).toEqual([]);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
