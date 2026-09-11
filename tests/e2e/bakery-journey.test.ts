import { expect, test, type Page } from '@playwright/test';
import { createTestPlayer } from '../helpers/local-supabase';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await expect(page).toHaveURL(/\/garden$/, { timeout: 15_000 });
}

test('harvested ingredients become persistent food through the reload-safe bakery', async ({ page }) => {
  test.setTimeout(60_000);
  const player = await createTestPlayer('bakery-journey');
  const errors: string[] = [];
  page.on('pageerror', (cause) => errors.push(cause.message));
  try {
    await login(page, player.email, player.password);
    await page.getByRole('button', { name: 'Start tavern' }).click();
    await page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }).click();
    await page.getByRole('button', { name: 'Harvest crop' }).click();
    await expect(page.getByRole('status')).toContainText('Harvested 2 ingredients');

    await page.getByRole('link', { name: 'Bakery', exact: true }).click();
    await expect(page).toHaveURL(/\/bakery$/);
    await expect(page.getByRole('heading', { name: 'Mix an herb loaf' })).toBeVisible();
    await expect(page.getByText('Legendary · 2 units · Bake +4')).toBeVisible();
    await page.getByRole('button', { name: 'Begin today’s loaf' }).click();

    await expect(page.getByRole('heading', { name: 'Fold the dough' })).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-motion-proof="bakery"]')).toHaveAttribute('data-bakery-phase', 'folding');
    await expect(page.locator('.stage-heading > strong')).toHaveText('0/6');
    for (let count = 1; count <= 6; count += 1) {
      await page.getByRole('button', { name: 'Fold dough with keyboard' }).click();
      if (count < 6) await expect(page.locator('.stage-heading > strong')).toHaveText(`${count}/6`);
    }
    await expect(page.getByRole('heading', { name: 'Score the loaf' })).toBeVisible();
    await page.reload();
    await expect(page.locator('.stage-heading > strong')).toHaveText('0/3');
    for (let count = 1; count <= 3; count += 1) {
      await page.getByRole('button', { name: 'Score loaf with keyboard' }).click();
      if (count < 3) await expect(page.locator('.stage-heading > strong')).toHaveText(`${count}/3`);
    }
    await expect(page.getByRole('heading', { name: 'The loaf is ready to bake' })).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-motion-proof="bakery"]')).toHaveAttribute('data-bakery-phase', 'ready');
    await expect(page.locator('.oven-peel')).toBeVisible();
    const ovenButton = page.getByRole('button', { name: 'Put loaf in oven' });
    await expect(ovenButton).toBeEnabled();
    await ovenButton.click();
    await expect(page.getByRole('heading', { name: 'Watch the crust' })).toBeVisible();
    await expect(page.locator('[data-motion-proof="bakery"]')).toHaveAttribute('data-bakery-phase', 'baking');

    const snapshot = await player.client.rpc('get_tavern_snapshot');
    expect(snapshot.error).toBeNull();
    const sessionId = (snapshot.data as unknown as { bakery: { activeSession: { id: string } } })
      .bakery.activeSession.id;
    expect((await player.admin.from('bake_sessions').update({
      oven_started_at: new Date(Date.now() - 30_000).toISOString()
    }).eq('id', sessionId)).error).toBeNull();

    await page.reload();
    await expect(page.getByText('Ideal window')).toBeVisible();
    await expect(page.locator('[data-motion-proof="bakery"]')).toHaveAttribute('data-loaf-appearance', 'ideal');
    await page.getByRole('button', { name: 'Take out bread' }).click();
    await expect(page.getByRole('heading', { name: 'Resplendent Hearth Loaf' })).toBeVisible();
    await expect(page.locator('[data-motion-proof="bakery"]')).toHaveAttribute('data-bakery-phase', 'result');
    await expect(page.getByText('Intent card earned · exceptional')).toBeVisible();
    await expect(page.getByText('Insight', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Begin today’s loaf' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close tavern for today' })).toBeVisible();

    await page.route('**/assets/scenes/bakery-environment.webp', (route) => route.abort());
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Resplendent Hearth Loaf' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Bakery environment artwork could not be loaded' })).toBeVisible();
    await page.getByRole('link', { name: 'Offer food at the bar' }).click();
    await expect(page.getByRole('radio', { name: 'Resplendent Hearth Loaf Resplendent' })).toBeChecked();
    const intentCards = page.getByRole('group', { name: 'Choose your intent' });
    await expect(intentCards).toContainText('Insight');
    await expect(page.getByLabel('Offer hospitality')).toContainText('Food · Resplendent Hearth Loaf');
    await expect(intentCards.getByRole('button', { name: /Plain No added intent/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Offer hospitality')).toHaveValue('');
    await page.getByRole('button', { name: 'Serve to Lira Nightwind' }).click();
    await expect(page.getByRole('status')).toContainText('Earned');
    await expect(page.getByRole('heading', { name: 'No hospitality ready to serve' })).toBeVisible();
    await expect(intentCards).toContainText('Insight');
    expect(errors).toEqual([]);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('the bakery exposes a no-craft close and restores the allocation next day', async ({ page }) => {
  const player = await createTestPlayer('bakery-rest');
  try {
    await login(page, player.email, player.password);
    await page.getByRole('button', { name: 'Start tavern' }).click();
    await page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }).click();
    await page.getByRole('button', { name: 'Harvest crop' }).click();
    await expect(page.getByRole('status')).toContainText('Harvested 2 ingredients');
    await page.getByRole('link', { name: 'Bakery', exact: true }).click();
    await page.getByRole('button', { name: 'Rest without crafting' }).click();
    await expect(page.getByText('Tavern day 2 · Daily craft')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mix an herb loaf' })).toBeVisible();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('overbaked bread remains immediately removable and completion retries exactly once', async ({ page }) => {
  test.setTimeout(60_000);
  const player = await createTestPlayer('bakery-overbake-retry');
  const ovenRequests: string[] = [];
  const completionRequests: string[] = [];
  try {
    await login(page, player.email, player.password);
    await page.getByRole('button', { name: 'Start tavern' }).click();
    await page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }).click();
    await page.getByRole('button', { name: 'Harvest crop' }).click();
    await expect(page.getByRole('status')).toContainText('Harvested 2 ingredients');
    await page.getByRole('link', { name: 'Bakery', exact: true }).click();
    await page.getByRole('button', { name: 'Begin today’s loaf' }).click();
    for (let count = 1; count <= 6; count += 1) {
      await page.getByRole('button', { name: 'Fold dough with keyboard' }).click();
      if (count < 6) await expect(page.locator('.stage-heading > strong')).toHaveText(`${count}/6`);
    }
    await expect(page.getByRole('heading', { name: 'Score the loaf' })).toBeVisible();
    for (let count = 1; count <= 3; count += 1) {
      await page.getByRole('button', { name: 'Score loaf with keyboard' }).click();
      if (count < 3) await expect(page.locator('.stage-heading > strong')).toHaveText(`${count}/3`);
    }
    await expect(page.getByRole('heading', { name: 'The loaf is ready to bake' })).toBeVisible();
    await page.route((url) => url.pathname === '/bakery' && url.search === '?/oven', async (route) => {
      ovenRequests.push(route.request().postData() ?? '');
      if (ovenRequests.length === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'Put loaf in oven' }).click();
    await expect(page.getByRole('alert')).toContainText('response was lost');
    await page.getByRole('button', { name: 'Retry putting loaf in oven' }).click();
    await expect(page.locator('[data-motion-proof="bakery"]')).toHaveAttribute('data-bakery-phase', 'baking');
    expect(ovenRequests).toHaveLength(2);
    expect(Object.fromEntries(new URLSearchParams(ovenRequests[1])))
      .toEqual(Object.fromEntries(new URLSearchParams(ovenRequests[0])));

    const snapshot = await player.client.rpc('get_tavern_snapshot');
    expect(snapshot.error).toBeNull();
    const state = snapshot.data as unknown as {
      save: { id: string };
      bakery: { activeSession: { id: string } };
    };
    expect((await player.admin.from('bake_sessions').update({
      oven_started_at: new Date(Date.now() - 50_000).toISOString()
    }).eq('id', state.bakery.activeSession.id)).error).toBeNull();

    await page.reload();
    const scene = page.locator('[data-motion-proof="bakery"]');
    await expect(scene).toHaveAttribute('data-bakery-phase', 'baking');
    await expect(scene).toHaveAttribute('data-loaf-appearance', 'overbaked');
    await expect(page.getByText('Overbaking')).toBeVisible();

    await page.route((url) => url.pathname === '/bakery' && url.search === '?/complete', async (route) => {
      completionRequests.push(route.request().postData() ?? '');
      if (completionRequests.length === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort('failed');
      } else await route.continue();
    });

    const firstRemoval = page.waitForRequest((request) => request.url().endsWith('/bakery?/complete'));
    await page.getByRole('button', { name: 'Take out bread' }).click();
    await firstRemoval;
    await expect(page.getByRole('alert')).toContainText('response was lost');
    await expect(scene.locator('.phase-banner')).toContainText('Ledger interrupted');
    await page.getByRole('button', { name: 'Retry taking out bread' }).click();
    await expect(scene).toHaveAttribute('data-bakery-phase', 'result');

    expect(completionRequests).toHaveLength(2);
    expect(Object.fromEntries(new URLSearchParams(completionRequests[1])))
      .toEqual(Object.fromEntries(new URLSearchParams(completionRequests[0])));
    const foods = await player.admin.from('foods').select('id').eq('save_id', state.save.id);
    expect(foods.error).toBeNull();
    expect(foods.data).toHaveLength(1);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('lost fold and score responses replay the exact frozen gesture', async ({ page }) => {
  test.setTimeout(60_000);
  const player = await createTestPlayer('bakery-retry');
  const foldRequests: string[] = [];
  const scoreRequests: string[] = [];
  try {
    await login(page, player.email, player.password);
    await page.getByRole('button', { name: 'Start tavern' }).click();
    await page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }).click();
    await page.getByRole('button', { name: 'Harvest crop' }).click();
    await expect(page.getByRole('status')).toContainText('Harvested 2 ingredients');
    await page.getByRole('link', { name: 'Bakery', exact: true }).click();
    await page.getByRole('button', { name: 'Begin today’s loaf' }).click();

    await page.route((url) => url.pathname === '/bakery' && url.search === '?/fold', async (route) => {
      foldRequests.push(route.request().postData() ?? '');
      if (foldRequests.length === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'Fold dough with keyboard' }).click();
    await expect(page.getByRole('alert')).toContainText('response was lost');
    await page.getByRole('button', { name: 'Retry fold' }).click();
    await expect(page.locator('.stage-heading > strong')).toHaveText('1/6');
    expect(foldRequests).toHaveLength(2);
    expect(Object.fromEntries(new URLSearchParams(foldRequests[1])))
      .toEqual(Object.fromEntries(new URLSearchParams(foldRequests[0])));

    for (let count = 2; count <= 6; count += 1) {
      await page.getByRole('button', { name: 'Fold dough with keyboard' }).click();
      if (count < 6) await expect(page.locator('.stage-heading > strong')).toHaveText(`${count}/6`);
    }
    await expect(page.getByRole('heading', { name: 'Score the loaf' })).toBeVisible();
    await page.route((url) => url.pathname === '/bakery' && url.search === '?/score', async (route) => {
      scoreRequests.push(route.request().postData() ?? '');
      if (scoreRequests.length === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'Score loaf with keyboard' }).click();
    await expect(page.getByRole('alert')).toContainText('response was lost');
    await page.getByRole('button', { name: 'Retry score' }).click();
    await expect(page.locator('.stage-heading > strong')).toHaveText('1/3');
    expect(scoreRequests).toHaveLength(2);
    expect(Object.fromEntries(new URLSearchParams(scoreRequests[1])))
      .toEqual(Object.fromEntries(new URLSearchParams(scoreRequests[0])));

    const snapshot = await player.client.rpc('get_tavern_snapshot');
    const active = (snapshot.data as unknown as {
      bakery: { activeSession: { foldCount: number; scoreCount: number } }
    }).bakery.activeSession;
    expect(active).toEqual(expect.objectContaining({ foldCount: 6, scoreCount: 1 }));
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
