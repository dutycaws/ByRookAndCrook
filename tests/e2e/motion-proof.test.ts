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

async function dragCircle(page: Page, clockwise: boolean) {
  const scene = page.locator('[data-motion-proof="brewery"]');
  const projection = await sceneProjection(scene);
  const center = projection.point(836, 463);
  const radius = { x: 330 * projection.scale, y: 96 * projection.scale };
  const points = Array.from({ length: 25 }, (_, index) => {
    const angle = (clockwise ? 1 : -1) * Math.PI * 2 * index / 24;
    return { x: center.x + Math.cos(angle) * radius.x, y: center.y + Math.sin(angle) * radius.y };
  });
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(14);
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

test('the Brewery proof uses circular motion, bounded reversal, decay, assisted input, and reduced motion', async ({ page }) => {
  test.setTimeout(60_000);
  const player = await createTestPlayer('brew-motion-proof');
  try {
    await loginAndHarvest(page, player.email, player.password);
    await page.getByRole('link', { name: 'Brewery', exact: true }).click();
    let scene = page.locator('[data-motion-proof="brewery"]');
    await expect(scene).toHaveAttribute('data-brew-phase', 'setup');
    await page.getByRole('button', { name: 'Begin 30-second brew' }).click();

    await expect(scene).toBeVisible();
    await expect(scene).toHaveAttribute('data-brew-phase', 'active');
    await expect(scene.locator('img')).toHaveCount(7);
    await expect(scene.locator('.brazier-fire')).toHaveClass(/heated/);
    await expect(scene.locator('.steam')).toHaveClass(/heated/);
    await dragCircle(page, true);
    await expect.poll(async () => Number(await scene.getAttribute('data-speed'))).toBeGreaterThan(10);
    await expect(scene).toHaveAttribute('data-pointer-type', 'mouse');
    await page.getByRole('radio', { name: /Assisted control/ }).evaluate((control: HTMLInputElement) => control.click());
    await expect(scene).toHaveAttribute('data-input-mode', 'assisted');
    await expect(scene).toHaveAttribute('data-pointer-type', 'none');
    await page.mouse.up();
    await page.getByRole('radio', { name: /Physical stirring/ }).check();
    await dragCircle(page, true);
    await expect.poll(async () => Number(await scene.getAttribute('data-speed'))).toBeGreaterThan(10);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(scene).toHaveAttribute('data-speed', '0');
    const hiddenTicks = Number(await page.locator('.brew-panel').getAttribute('data-brew-sample-ticks'));
    await page.waitForTimeout(350);
    await expect(page.locator('.brew-panel')).toHaveAttribute('data-brew-sample-ticks', String(hiddenTicks));
    await page.mouse.up();
    await page.reload();
    scene = page.locator('[data-motion-proof="brewery"]');
    await expect(scene).toHaveAttribute('data-speed', '0');

    await dragCircle(page, false);
    await expect.poll(async () => Number(await scene.getAttribute('data-speed'))).toBeGreaterThan(10);
    expect(Number(await scene.getAttribute('data-speed'))).toBeLessThanOrEqual(100);
    await page.mouse.up();
    await expect.poll(async () => Number(await scene.getAttribute('data-speed')), { timeout: 1_200 }).toBe(0);

    await page.getByRole('radio', { name: /Assisted control/ }).check();
    await expect(scene).toHaveAttribute('data-input-mode', 'assisted');
    const slider = page.getByLabel('Stirring speed');
    await slider.evaluate((control) => {
      const input = control as HTMLInputElement;
      input.value = '50';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(scene).toHaveAttribute('data-speed', '50');
    await expect(page.locator('.zone-readout strong')).toHaveText('Perfect');

    await page.getByRole('radio', { name: /Physical stirring/ }).check();
    await expect(scene).toHaveAttribute('data-speed', '0');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(scene).toHaveAttribute('data-reduced-motion', 'true');
    const staticFireStyle = await scene.locator('.brazier-fire').getAttribute('style');
    const staticWortStyle = await scene.locator('.wort').getAttribute('style');
    const staticImmersionStyle = await scene.locator('.immersion-shadow').getAttribute('style');
    const staticPaddleStyle = await scene.locator('.paddle').getAttribute('style');
    const staticSteamStyle = await scene.locator('.steam').getAttribute('style');
    await expect(scene.locator('.brazier-fire')).toHaveCSS('animation-name', 'none');
    await expect(scene.locator('.steam')).toHaveCSS('animation-name', 'none');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(scene).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const touch = await dragPointerCircle(page, 'touch');
    await expect.poll(async () => Number(await scene.getAttribute('data-speed'))).toBeGreaterThan(10);
    await expect(scene).toHaveAttribute('data-pointer-type', 'touch');
    await expect(scene.locator('.brazier-fire')).toHaveAttribute('style', staticFireStyle!);
    await expect(scene.locator('.wort')).toHaveAttribute('style', staticWortStyle!);
    await expect(scene.locator('.immersion-shadow')).toHaveAttribute('style', staticImmersionStyle!);
    await expect(scene.locator('.paddle')).toHaveAttribute('style', staticPaddleStyle!);
    await expect(scene.locator('.steam')).toHaveAttribute('style', staticSteamStyle!);
    await touch.scene.dispatchEvent('pointerup', { ...touch.point, pointerId: touch.pointerId, pointerType: 'touch', isPrimary: true });

    const snapshotResult = await player.client.rpc('get_tavern_snapshot');
    const activeSession = (snapshotResult.data as unknown as { brewery: { activeSession: { id: string } | null } }).brewery.activeSession;
    expect(activeSession).not.toBeNull();
    const backdated = await player.admin
      .from('brew_sessions')
      .update({ started_at: new Date(Date.now() - 31_000).toISOString() })
      .eq('id', activeSession!.id);
    expect(backdated.error).toBeNull();
    await page.evaluate(() => {
      const currentTime = Date.now.bind(Date);
      Date.now = () => currentTime() + 31_000;
    });
    await expect(page.getByRole('button', { name: 'Bottle this brew' })).toBeEnabled();
    await expect(scene).toHaveAttribute('data-brew-phase', 'ready');

    const completionPayloads: URLSearchParams[] = [];
    let dropCompletion = true;
    await page.route(
      (url) => url.pathname === '/brewery' && url.search === '?/complete',
      async (route) => {
        completionPayloads.push(new URLSearchParams(route.request().postData() ?? ''));
        if (dropCompletion) {
          dropCompletion = false;
          await route.fetch();
          await route.abort('failed');
          return;
        }
        await route.continue();
      }
    );
    await page.getByRole('button', { name: 'Bottle this brew' }).click();
    await expect(page.getByRole('alert')).toContainText('response was lost');
    await expect(scene.locator('.phase-banner')).toContainText('Ledger interrupted');
    await page.getByRole('button', { name: 'Bottle this brew' }).click();
    await expect(scene).toHaveAttribute('data-brew-phase', 'result');
    await expect(scene.locator('.brazier-fire')).not.toHaveClass(/heated/);
    expect(completionPayloads).toHaveLength(2);
    expect(completionPayloads[0].get('actionId')).toBe(completionPayloads[1].get('actionId'));
    expect(completionPayloads[0].get('totalTicks')).toBe(completionPayloads[1].get('totalTicks'));
    expect(Number(completionPayloads[0].get('totalTicks'))).toBeGreaterThan(0);

    await page.route('**/assets/scenes/brewery-environment.webp', (route) => route.abort());
    await page.reload();
    await expect(page.getByRole('img', { name: 'Brewery environment artwork could not be loaded' })).toBeVisible();
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

    for (let count = 3; count <= 6; count += 1) {
      await page.getByRole('button', { name: 'Fold dough with keyboard' }).click();
      if (count < 6) await expect(page.locator('.stage-heading > strong')).toHaveText(`${count}/6`);
    }

    scene = page.locator('[data-motion-proof="bakery"]');
    await expect(scene).toHaveAttribute('data-bakery-phase', 'scoring');
    projection = await sceneProjection(scene);
    point = projection.point(652, 621);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    point = projection.point(1020, 574);
    await page.mouse.move(point.x, point.y, { steps: 8 });
    await expect(scene.locator('.scoring-tool')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('.stage-heading > strong')).toHaveText('1/3');
    await expect(scene.locator('.groove')).toHaveCount(1);

    await swipeBakeryPointer(page, 'pen', { x: 652, y: 621 }, { x: 1020, y: 574 }, true);
    await expect(page.locator('.stage-heading > strong')).toHaveText('2/3');
    await expect(scene.locator('.groove')).toHaveCount(2);

    await page.getByRole('button', { name: 'Score loaf with keyboard' }).click();
    await expect(scene).toHaveAttribute('data-bakery-phase', 'ready');
    await expect(scene.locator('.oven-peel')).toBeVisible();
    await expect(scene.locator('.loaf.pale')).toBeVisible();

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(scene).toHaveAttribute('data-reduced-motion', 'true');
    await page.getByRole('button', { name: 'Put loaf in oven' }).click();
    await expect(scene).toHaveAttribute('data-bakery-phase', 'baking');
    await expect(scene.locator('.oven-embers')).toHaveCSS('animation-name', 'none');
    await expect(scene.locator('.oven-steam')).toHaveCSS('animation-name', 'none');
    const staticLoafStyle = await scene.locator('.loaf-stack').getAttribute('style');
    await page.waitForTimeout(350);
    await expect(scene.locator('.loaf-stack')).toHaveAttribute('style', staticLoafStyle!);
    await expect(scene).toBeVisible();
    await expectNoHorizontalOverflow(page);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
