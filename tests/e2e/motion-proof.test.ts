import { expect, test, type Locator, type Page } from '@playwright/test';
import { createTestPlayer } from '../helpers/local-supabase';

async function loginAndHarvest(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await page.getByRole('button', { name: 'Start tavern' }).click();
  await page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }).click();
  await page.getByRole('button', { name: 'Harvest crop' }).click();
  await expect(page.getByRole('status')).toContainText('Harvested 2 ingredients');
}

async function sceneProjection(scene: Locator) {
  await scene.scrollIntoViewIfNeeded();
  await expect.poll(async () => Number(await scene.getAttribute('data-scene-scale'))).toBeGreaterThan(0);
  await scene.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const bounds = await scene.boundingBox();
  if (!bounds) throw new Error('The crafting scene has no rendered bounds.');
  const scale = Number(await scene.getAttribute('data-scene-scale'));
  const offsetX = Number(await scene.getAttribute('data-scene-offset-x'));
  const offsetY = Number(await scene.getAttribute('data-scene-offset-y'));
  if (![scale, offsetX, offsetY].every(Number.isFinite)) throw new Error('The crafting scene has no usable projection.');
  return {
    scale,
    point(x: number, y: number) {
      return { x: bounds.x + offsetX + x * scale, y: bounds.y + offsetY + y * scale };
    }
  };
}

async function dragCircle(page: Page, clockwise: boolean, stepDelayMs = 14) {
  const scene = page.locator('[data-motion-proof="brewery"]');
  const projection = await sceneProjection(scene);
  const center = projection.point(836, 463);
  const radius = { x: 330 * projection.scale, y: 96 * projection.scale };
  const points = Array.from({ length: 22 }, (_, index) => {
    const angle = (clockwise ? 1 : -1) * Math.PI * 2 * index / 24;
    return { x: center.x + Math.cos(angle) * radius.x, y: center.y + Math.sin(angle) * radius.y };
  });
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.waitForTimeout(stepDelayMs);
    await page.mouse.move(point.x, point.y);
  }
  return scene;
}

async function dragPointerCircle(page: Page, pointerType: 'touch' | 'pen') {
  const scene = page.locator('[data-motion-proof="brewery"]');
  const projection = await sceneProjection(scene);
  const center = projection.point(836, 463);
  const radius = { x: 330 * projection.scale, y: 96 * projection.scale };
  const points = Array.from({ length: 25 }, (_, index) => {
    const angle = Math.PI * 2 * index / 24;
    return { clientX: center.x + Math.cos(angle) * radius.x, clientY: center.y + Math.sin(angle) * radius.y };
  });
  const pointerId = pointerType === 'touch' ? 41 : 42;
  await scene.dispatchEvent('pointerdown', { ...points[0], pointerId, pointerType, isPrimary: true, buttons: 1 });
  for (const point of points.slice(1)) {
    await page.waitForTimeout(14);
    await scene.dispatchEvent('pointermove', { ...point, pointerId, pointerType, isPrimary: true, buttons: 1 });
  }
  return { scene, pointerId, point: points.at(-1)! };
}

async function swipeBakeryPointer(
  page: Page,
  pointerType: 'touch' | 'pen',
  start: { x: number; y: number },
  end: { x: number; y: number },
  duplicateRelease = false
) {
  const scene = page.locator('[data-motion-proof="bakery"]');
  const projection = await sceneProjection(scene);
  const surface = scene.locator('.gesture-surface');
  const from = projection.point(start.x, start.y);
  const to = projection.point(end.x, end.y);
  const pointerId = pointerType === 'touch' ? 51 : 52;
  await surface.dispatchEvent('pointerdown', { clientX: from.x, clientY: from.y, pointerId, pointerType, isPrimary: true, buttons: 1 });
  await surface.dispatchEvent('pointermove', { clientX: to.x, clientY: to.y, pointerId, pointerType, isPrimary: true, buttons: 1 });
  await surface.dispatchEvent('pointerup', { clientX: to.x, clientY: to.y, pointerId, pointerType, isPrimary: true });
  if (duplicateRelease) {
    await surface.dispatchEvent('pointerup', { clientX: to.x, clientY: to.y, pointerId, pointerType, isPrimary: true });
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const report = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return { tag: element.tagName, className: element.className, left: bounds.left, right: bounds.right };
      })
      .filter((element) => element.left < -0.5 || element.right > window.innerWidth + 0.5)
      .slice(0, 8)
  }));
  expect(report.overflow, JSON.stringify(report)).toBeLessThanOrEqual(0);
}

test('the Brewery guide keeps pointer, keyboard, persistence, and reduced-motion scoring aligned', async ({ page }) => {
  test.setTimeout(90_000);
  const player = await createTestPlayer('brew-motion-proof');
  try {
    await loginAndHarvest(page, player.email, player.password);
    await page.getByRole('link', { name: 'Brewery', exact: true }).click();
    let scene = page.locator('[data-motion-proof="brewery"]');
    await expect(scene).toHaveAttribute('data-brew-phase', 'setup');
    await page.getByRole('button', { name: 'Begin guided brew' }).click();

    await expect(scene).toBeVisible();
    await expect(scene).toHaveAttribute('data-brew-phase', 'active');
    await expect(scene).toHaveAttribute('data-stir-phase', 'countdown');
    await expect(scene.locator('img')).toHaveCount(7);
    await expect(scene.locator('.stir-guide')).toBeVisible();
    await expect(scene.locator('.brazier-fire')).toHaveClass(/heated/);
    await expect(scene.locator('.steam')).toHaveClass(/heated/);
    await expect(scene).toHaveAttribute('data-stir-phase', 'scored', { timeout: 4_000 });

    const initialPaddle = await scene.locator('.paddle').getAttribute('style');
    await dragCircle(page, true, 160);
    await expect(scene).toHaveAttribute('data-input-kind', 'pointer');
    await expect(scene).toHaveAttribute('data-direction', 'clockwise');
    await expect(scene).toHaveAttribute('data-pointer-type', 'mouse');
    expect(await scene.locator('.paddle').getAttribute('style')).not.toBe(initialPaddle);
    await expect.poll(async () =>
      Number(await scene.getAttribute('data-perfect-ticks'))
      + Number(await scene.getAttribute('data-good-ticks'))
    ).toBeGreaterThan(0);
    await page.mouse.up();
    await page.waitForTimeout(600);
    await expect(scene).toHaveAttribute('data-performance', 'catch-guide');

    const positiveBeforeHide =
      Number(await scene.getAttribute('data-perfect-ticks')) + Number(await scene.getAttribute('data-good-ticks'));
    const ticksBeforeHide = Number(await scene.getAttribute('data-total-ticks'));
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(async () => Number(await scene.getAttribute('data-total-ticks'))).toBeGreaterThanOrEqual(ticksBeforeHide);
    expect(
      Number(await scene.getAttribute('data-perfect-ticks')) + Number(await scene.getAttribute('data-good-ticks'))
    ).toBe(positiveBeforeHide);

    await page.reload();
    scene = page.locator('[data-motion-proof="brewery"]');
    await expect(scene).toHaveAttribute('data-input-kind', 'pointer');
    expect(
      Number(await scene.getAttribute('data-perfect-ticks')) + Number(await scene.getAttribute('data-good-ticks'))
    ).toBe(positiveBeforeHide);

    const snapshotResult = await player.client.rpc('get_tavern_snapshot');
    const activeSession = (snapshotResult.data as unknown as {
      brewery: { activeSession: { id: string; startedAt: string } | null }
    }).brewery.activeSession;
    expect(activeSession).not.toBeNull();

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(scene).toHaveAttribute('data-reduced-motion', 'true');
    const setNow = async (now: number) => {
      await page.evaluate((value) => {
        const scope = globalThis as typeof globalThis & { __guidedNow?: number; __realDateNow?: () => number };
        scope.__realDateNow ??= Date.now.bind(Date);
        scope.__guidedNow = value;
        Date.now = () => scope.__guidedNow!;
      }, now);
    };
    const startedAt = Date.parse(activeSession!.startedAt);
    const guideStartedAt = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) => candidate.startsWith('by-rook-and-crook:brew:guide-v2:'));
      if (!key) throw new Error('The guided-stir state was not persisted.');
      const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as { guideStartedAt?: number };
      if (!Number.isFinite(stored.guideStartedAt)) throw new Error('The persisted guide has no start time.');
      return stored.guideStartedAt!;
    });
    await setNow(guideStartedAt + 8_000);
    await page.waitForTimeout(80);
    await expect.poll(async () => Number(await scene.getAttribute('data-total-ticks'))).toBeGreaterThanOrEqual(20);
    const discreteGuide = Number(await scene.getAttribute('data-guide-angle'));
    await setNow(guideStartedAt + 8_500);
    await page.waitForTimeout(80);
    expect(Number(await scene.getAttribute('data-guide-angle'))).toBeCloseTo(discreteGuide);
    await setNow(guideStartedAt + 9_000);
    await expect.poll(async () => {
      const nextGuide = Number(await scene.getAttribute('data-guide-angle'));
      return Math.abs(Math.atan2(Math.sin(nextGuide - discreteGuide), Math.cos(nextGuide - discreteGuide)));
    }).toBeCloseTo(Math.PI / 2);
    await expect(scene.locator('.brazier-fire')).toHaveCSS('animation-name', 'none');
    await expect(scene.locator('.steam')).toHaveCSS('animation-name', 'none');

    const backdated = await player.admin
      .from('brew_sessions')
      .update({ started_at: new Date(Date.now() - 18_000).toISOString() })
      .eq('id', activeSession!.id);
    expect(backdated.error).toBeNull();
    await setNow(startedAt + 17_000);
    await expect(scene).toHaveAttribute('data-total-ticks', '60');
    await expect(page.getByRole('button', { name: 'Bottle this brew' })).toBeEnabled();
    await page.getByRole('button', { name: 'Bottle this brew' }).click();
    await expect(scene).toHaveAttribute('data-brew-phase', 'result');

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('the Brewery keyboard rhythm path can earn the same 60-tick maximum', async ({ page }) => {
  test.setTimeout(45_000);
  const player = await createTestPlayer('brew-keyboard-proof');
  try {
    await loginAndHarvest(page, player.email, player.password);
    await page.getByRole('link', { name: 'Brewery', exact: true }).click();
    await page.getByRole('button', { name: 'Begin guided brew' }).click();
    const scene = page.locator('[data-motion-proof="brewery"]');
    await expect(scene).toHaveAttribute('data-brew-phase', 'active');
    const snapshot = await player.client.rpc('get_tavern_snapshot');
    const session = (snapshot.data as unknown as {
      brewery: { activeSession: { id: string; startedAt: string } | null }
    }).brewery.activeSession;
    expect(session).not.toBeNull();
    const startedAt = Date.parse(session!.startedAt);
    const setNow = async (now: number) => {
      await page.evaluate((value) => {
        const scope = globalThis as typeof globalThis & { __guidedNow?: number };
        scope.__guidedNow = value;
        Date.now = () => scope.__guidedNow!;
      }, now);
    };

    await setNow(startedAt + 2_000);
    await expect(scene).toHaveAttribute('data-stir-phase', 'scored');
    const beat = page.getByRole('button', { name: 'Stir on the beat' });
    await beat.focus();
    await beat.press('ArrowRight');
    await expect(scene).toHaveAttribute('data-input-kind', 'keyboard');
    for (let index = 0; index < 15; index += 1) {
      await setNow(startedAt + 2_500 + index * 1_000);
      await beat.press('Space');
    }
    await setNow(startedAt + 17_000);
    await expect(scene).toHaveAttribute('data-perfect-ticks', '60');
    await expect(scene).toHaveAttribute('data-good-ticks', '0');
    await expect(scene).toHaveAttribute('data-total-ticks', '60');

    expect((await player.admin.from('brew_sessions').update({
      started_at: new Date(Date.now() - 18_000).toISOString()
    }).eq('id', session!.id)).error).toBeNull();
    await page.getByRole('button', { name: 'Bottle this brew' }).click();
    await expect(page.getByRole('heading', { name: 'Ambrosial Draught' })).toBeVisible();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('the Bakery scene preserves pointer, touch, pen, keyboard, cancellation, and confirmed grooves', async ({ page }) => {
  test.setTimeout(60_000);
  const player = await createTestPlayer('bake-motion-proof');
  try {
    await loginAndHarvest(page, player.email, player.password);
    await page.getByRole('link', { name: 'Bakery', exact: true }).click();
    await page.getByRole('button', { name: 'Begin today’s loaf' }).click();

    let scene = page.locator('[data-motion-proof="bakery"]');
    await expect(scene).toHaveAttribute('data-bakery-phase', 'folding');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    let projection = await sceneProjection(scene);
    let point = projection.point(702, 649);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await expect(scene).toHaveAttribute('data-transient', 'active');
    await scene.locator('.gesture-surface').dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
    await expect(scene).toHaveAttribute('data-transient', 'idle');
    await expect(page.locator('.stage-heading > strong')).toHaveText('0/6');

    point = projection.point(652, 649);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    point = projection.point(1104, 649);
    await page.mouse.move(point.x, point.y, { steps: 8 });
    await expect(scene).toHaveAttribute('data-transient', 'active');
    await page.mouse.up();
    await expect(page.locator('.stage-heading > strong')).toHaveText('1/6');

    await swipeBakeryPointer(page, 'touch', { x: 652, y: 649 }, { x: 1104, y: 649 }, true);
    await expect(page.locator('.stage-heading > strong')).toHaveText('2/6');
    await page.waitForTimeout(300);
    await expect(page.locator('.stage-heading > strong')).toHaveText('2/6');

    await swipeBakeryPointer(page, 'pen', { x: 652, y: 649 }, { x: 1104, y: 649 }, true);
    await expect(page.locator('.stage-heading > strong')).toHaveText('3/6');

    for (let count = 4; count <= 6; count += 1) {
      await page.getByRole('button', { name: 'Fold dough with keyboard' }).click();
      if (count < 6) await expect(page.locator('.stage-heading > strong')).toHaveText(`${count}/6`);
    }

    scene = page.locator('[data-motion-proof="bakery"]');
    await expect(scene).toHaveAttribute('data-bakery-phase', 'scoring');
    projection = await sceneProjection(scene);
    const scoreRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/bakery' && url.search === '?/score') scoreRequests.push(request.postData() ?? '');
    });
    const scoreSurface = scene.locator('.gesture-surface');

    point = projection.point(760, 620);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator('.stage-heading > strong')).toHaveText('0/3');
    expect(scoreRequests).toHaveLength(0);

    const jitterEnd = projection.point(830, 620);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(jitterEnd.x, jitterEnd.y);
    await page.mouse.up();
    await expect(page.locator('.stage-heading > strong')).toHaveText('0/3');
    expect(scoreRequests).toHaveLength(0);

    const outside = projection.point(220, 620);
    await page.mouse.move(outside.x, outside.y);
    await page.mouse.down();
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
    await expect(page.locator('.stage-heading > strong')).toHaveText('0/3');
    expect(scoreRequests).toHaveLength(0);

    await scoreSurface.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.stage-heading > strong')).toHaveText('1/3');
    await scoreSurface.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.stage-heading > strong')).toHaveText('2/3');
    await expect.poll(() => scoreRequests.length).toBe(2);
    await page.waitForLoadState('networkidle');

    scene = page.locator('[data-motion-proof="bakery"]');
    projection = await sceneProjection(scene);
    point = projection.point(652, 621);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    point = projection.point(1020, 574);
    await page.mouse.move(point.x, point.y, { steps: 8 });
    await page.mouse.up();
    await expect(scene).toHaveAttribute('data-bakery-phase', 'ready');
    expect(scoreRequests).toHaveLength(3);
    await expect(scene.locator('.oven-peel')).toBeVisible();
    await expect(scene.locator('.loaf.pale')).toBeVisible();
    await expect(scene.locator('.oven-foreground')).toHaveCSS('z-index', '8');
    await expect(scene.locator('.oven-peel')).toHaveCSS('z-index', '9');
    await expect(scene.locator('.loaf-stack')).toHaveCSS('z-index', '9');

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(scene.locator('.oven-foreground')).toHaveCSS('z-index', '8');
    await expect(scene.locator('.oven-peel')).toHaveCSS('z-index', '9');
    await expect(scene.locator('.loaf-stack')).toHaveCSS('z-index', '9');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(scene).toHaveAttribute('data-reduced-motion', 'true');
    await page.getByRole('button', { name: 'Put loaf in oven' }).click();
    await expect(scene).toHaveAttribute('data-bakery-phase', 'baking');
    await expect(scene.locator('.oven-foreground')).toHaveCSS('z-index', '8');
    await expect(scene.locator('.oven-peel')).toHaveCSS('z-index', '9');
    await expect(scene.locator('.loaf-stack')).toHaveCSS('z-index', '9');
    await expect(scene.locator('.oven-embers')).toHaveCSS('animation-name', 'none');
    await expect(scene.locator('.oven-steam')).toHaveCSS('animation-name', 'none');
    const staticLoafRise = await scene.locator('.loaf-stack').evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--rise')
    );
    await page.waitForTimeout(350);
    expect(await scene.locator('.loaf-stack').evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--rise')
    )).toBe(staticLoafRise);
    await expect(scene).toBeVisible();
    await expectNoHorizontalOverflow(page);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
