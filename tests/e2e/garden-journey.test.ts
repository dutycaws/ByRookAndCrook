import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createTestPlayer } from '../helpers/local-supabase';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await expect(page).toHaveURL(/\/garden$/);
}

async function openKeeperMenu(page: Page) {
  await page.getByLabel('Keeper menu').click();
}

async function openPantry(page: Page) {
  await openKeeperMenu(page);
  await page.getByRole('link', { name: 'Open pantry', exact: true }).click();
}

async function openGardenActions(page: Page) {
  const actions = page.getByRole('button', { name: 'Actions', exact: true });
  await actions.click();
  if (page.viewportSize()?.width && page.viewportSize()!.width <= 620) {
    await expect(page.locator('dialog[open]')).toBeVisible();
  } else {
    await expect(actions).toHaveAttribute('aria-expanded', 'true');
  }
}

async function closeMobileGardenActions(page: Page) {
  if (page.viewportSize()?.width && page.viewportSize()!.width <= 620) {
    await page.getByRole('button', { name: 'Close actions' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  }
}

async function selectPlot(page: Page, plot: Locator) {
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await plot.tap(); else await plot.click();
  await expect(plot).toHaveAttribute('aria-pressed', 'true');
}

test('harvest persists across routes, reloads, and browser sessions', async ({ page, browser }) => {
  const player = await createTestPlayer('journey');
  let secondContext: BrowserContext | undefined;

  try {
    await login(page, player.email, player.password);
    await page.getByRole('button', { name: 'Start tavern' }).click();
    await expect(page.getByRole('heading', { name: 'Hex garden' })).toBeVisible();

    const hexGeometry = await page.locator('.hex-cell').evaluateAll((cells) => {
      const byKey = new Map(
        cells.map((cell) => [cell.getAttribute('data-layout-key'), cell.getBoundingClientRect()])
      );
      const c1 = byKey.get('c1')!;
      const c2 = byKey.get('c2')!;
      const c4 = byKey.get('c4')!;
      return {
        sameRowGap: c2.left - c1.right,
        diagonalTopDelta: Math.abs(c4.top - (c2.top + c2.height * 0.75)),
        diagonalXDelta: Math.abs(c4.left + c4.width / 2 - c2.left)
      };
    });
    expect(Math.abs(hexGeometry.sameRowGap)).toBeLessThanOrEqual(1);
    expect(hexGeometry.diagonalTopDelta).toBeLessThanOrEqual(1);
    expect(hexGeometry.diagonalXDelta).toBeLessThanOrEqual(1);

    await selectPlot(page, page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }));
    await openGardenActions(page);
    await page.getByRole('button', { name: 'Harvest crop' }).click();
    await expect(page.locator('[data-harvest-effect]')).toHaveCount(1);
    await expect(page.getByRole('status')).toContainText('Harvested 1 ingredient');
    await expect(page.getByRole('button', { name: /c1, empty garden plot/i })).toBeVisible();
    await expect(page.locator('[data-harvest-effect]')).toHaveCount(0);

    await closeMobileGardenActions(page);
    await openPantry(page);
    await expect(page.getByRole('heading', { name: 'Fennel' })).toBeVisible();
    await expect(page.getByText('Legendary · 1 unit')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Fennel' })).toBeVisible();

    secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await login(secondPage, player.email, player.password);
    await secondPage.goto('/ingredients');
    await expect(secondPage.getByText('Legendary · 1 unit')).toBeVisible();

    await openKeeperMenu(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await secondPage.reload();
    await expect(secondPage.getByRole('heading', { name: 'Fennel' })).toBeVisible();

    await login(page, player.email, player.password);
    await page.goto('/garden');
    await selectPlot(page, page.getByRole('button', { name: /c1, empty garden plot/i }));
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
    await selectPlot(page, page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }));
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

    await openGardenActions(page);
    await page.getByRole('button', { name: 'Harvest crop' }).click();
    await expect(page.getByRole('alert')).toContainText('outcome is unknown');
    await expect(page.locator('[data-harvest-effect]')).toHaveCount(0);
    await expect(page.locator('img[src*="garden-crop-fennel-stage-3"]')).toBeVisible();
    await page.getByRole('button', { name: 'Retry harvest' }).click();
    await expect(page.getByRole('status')).toContainText('Harvested 1 ingredient');

    expect(submittedActionIds).toHaveLength(2);
    expect(submittedActionIds[0]).not.toBe('');
    expect(submittedActionIds[1]).toBe(submittedActionIds[0]);

    await closeMobileGardenActions(page);
    await openPantry(page);
    await expect(page.getByText('Legendary · 1 unit')).toBeVisible();
    await expect(page.getByText('1 batch')).toBeVisible();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('garden artwork failures keep all plot controls and live details usable', async ({ page }) => {
  const player = await createTestPlayer('garden-assets');
  try {
    await page.route('**/assets/scenes/garden-environment.webp', (route) => route.abort('failed'));
    await page.route('**/assets/scenes/garden/garden-plot-base.webp', (route) => route.abort('failed'));
    await page.route('**/assets/scenes/garden/garden-beehive.webp', (route) => route.abort('failed'));
    await page.route('**/assets/scenes/garden/garden-crop-fennel-stage-3.webp', (route) => route.abort('failed'));
    await login(page, player.email, player.password);
    await page.getByRole('button', { name: 'Start tavern' }).click();

    await expect(page.getByRole('img', { name: 'garden environment artwork could not be loaded' })).toBeVisible();
    await expect(page.locator('[data-plot-fallback]')).toHaveCount(12);
    await expect(page.locator('[data-hive-fallback]')).toBeVisible();
    await expect(page.locator('[data-crop-fallback="fennel"]')).toBeVisible();
    await expect(page.locator('.hex-cell')).toHaveCount(12);
    await selectPlot(page, page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }));
    await expect(page.getByRole('heading', { name: 'Fennel' })).toBeVisible();
    await openGardenActions(page);
    await expect(page.getByRole('button', { name: 'Harvest crop' })).toBeEnabled();
    await expect(page.locator('[data-scene-layer="garden foreground foliage"]')).toHaveCSS('pointer-events', 'none');
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('garden ambient and harvest motion suspend without changing authoritative results', async ({ page }) => {
  const player = await createTestPlayer('garden-motion');
  try {
    await login(page, player.email, player.password);
    await page.getByRole('button', { name: 'Start tavern' }).click();
    const scene = page.locator('[data-area-scene="garden"]');
    const atmosphere = page.locator('[data-scene-layer="garden bees and leaves"]');
    await expect(atmosphere).toHaveCSS('animation-play-state', 'running');

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(scene).toHaveAttribute('data-scene-visible', 'false');
    await expect(atmosphere).toHaveCSS('animation-play-state', 'paused');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(scene).toHaveAttribute('data-scene-visible', 'true');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await selectPlot(page, page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }));
    await openGardenActions(page);
    await page.getByRole('button', { name: 'Harvest crop' }).click();
    const effect = page.locator('[data-harvest-effect]');
    await expect(effect).toHaveCount(1);
    await expect(effect).toHaveCSS('animation-name', 'none');
    await expect(effect).toHaveCSS('opacity', '0');
    await expect(page.getByRole('status')).toContainText('Harvested 1 ingredient');
    await expect(page.getByRole('button', { name: /c1, empty garden plot/i })).toBeVisible();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('a harvested ingredient becomes a persistent brew, intent card, and completed tavern day', async ({ page }) => {
  test.setTimeout(60_000);
  const player = await createTestPlayer('brew-journey');
  const pageErrors: string[] = [];
  page.on('pageerror', (cause) => pageErrors.push(cause.message));

  try {
    await login(page, player.email, player.password);
    await page.getByRole('button', { name: 'Start tavern' }).click();
    await expect(page.getByRole('heading', { name: 'Hex garden' })).toBeVisible();
    await selectPlot(page, page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }));
    await expect(page.getByRole('heading', { name: 'Fennel' })).toBeVisible();
    await openGardenActions(page);
    await page.getByRole('button', { name: 'Harvest crop' }).click();
    await expect(page.getByRole('status')).toContainText('Harvested 1 ingredient');

    await closeMobileGardenActions(page);
    await page.getByRole('link', { name: 'Brewery', exact: true }).click();
    await expect(page.getByRole('heading', { name: "Prepare today's infusion" })).toBeVisible();
    await expect(page.getByText('Legendary · 1 unit · Brew +2')).toBeVisible();
    await page.getByRole('button', { name: 'Begin guided brew' }).click();
    await expect(page.getByRole('heading', { name: 'Stir the wort' })).toBeVisible();
    await expect(page.getByText('Target: 15 RPM · one beat per second')).toBeVisible();
    const beat = page.getByRole('button', { name: 'Stir on the beat' });
    await beat.focus();
    await beat.press('ArrowRight');
    await expect(page.locator('[data-motion-proof="brewery"]')).toHaveAttribute('data-input-kind', 'keyboard');

    const snapshotResult = await player.client.rpc('get_tavern_snapshot');
    expect(snapshotResult.error).toBeNull();
    const snapshot = snapshotResult.data as unknown as {
      brewery: { activeSession: { id: string } | null };
    };
    expect(snapshot.brewery.activeSession).not.toBeNull();

    const backdated = await player.admin
      .from('brew_sessions')
      .update({ started_at: new Date(Date.now() - 18_000).toISOString() })
      .eq('id', snapshot.brewery.activeSession!.id);
    expect(backdated.error).toBeNull();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Bottle this brew' })).toBeEnabled();
    await page.getByRole('button', { name: 'Bottle this brew' }).click();

    await expect(page.getByText('Honest Mead', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Honest Mead bottled at 4 of 7 quality');
    const completedResult = await player.client.rpc('get_tavern_snapshot');
    expect(completedResult.error).toBeNull();
    const completedSnapshot = completedResult.data as unknown as {
      brewery: { intentCards: Array<{ cardKey: string; tier: string }> };
    };
    expect(completedSnapshot.brewery.intentCards).toContainEqual(
      expect.objectContaining({ cardKey: 'charm', tier: 'fine' })
    );
    await expect(page.getByRole('link', { name: 'Visit the garden' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rest and begin next day' })).toBeVisible();

    await page.reload();
    await expect(page.getByText('Honest Mead', { exact: true }).first()).toBeVisible();
    await openPantry(page);
    await expect(page.getByRole('heading', { name: 'Your pantry is waiting' })).toBeVisible();

    await page.getByRole('link', { name: 'Brewery', exact: true }).click();
    await page.getByRole('link', { name: /Serve it at the bar/ }).click();
    await expect(page.locator('.tavern-scene')).toBeVisible();
    await page.getByRole('button', { name: 'Serve to Lira Nightwind' }).click();
    await expect(page.getByRole('status')).toContainText('Earned 12 gold');
    await expect(page.getByLabel('Tavern gold')).toContainText('12 gold');
    await expect(page.getByRole('heading', { name: 'No hospitality ready to serve' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Tavern gold')).toContainText('12 gold');
    await expect(page.getByText('Relationship +3 · Story 0', { exact: false })).toBeVisible();
    await page.getByRole('link', { name: 'Brewery', exact: true }).click();
    await page.getByRole('button', { name: 'Rest and begin next day' }).click();
    await expect(page.getByText('Tavern day 2 · Daily craft')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The ingredient shelf is empty' })).toBeVisible();
    await expect(page.getByText('Honest Mead')).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
