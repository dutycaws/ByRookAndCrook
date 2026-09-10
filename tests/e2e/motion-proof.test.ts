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
    await page.getByRole('button', { name: 'Begin 30-second brew' }).click();

    let scene = page.locator('[data-motion-proof="brewery"]');
    await expect(scene).toBeVisible();
    await expect(scene.locator('img')).toHaveCount(4);
    await dragCircle(page, true);
    await expect.poll(async () => Number(await scene.getAttribute('data-speed'))).toBeGreaterThan(10);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(scene).toHaveAttribute('data-speed', '0');
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

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(scene).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await dragCircle(page, true);
    await expect.poll(async () => Number(await scene.getAttribute('data-speed'))).toBeGreaterThan(10);
    await page.mouse.up();
    await page.route('**/assets/scenes/brewery-environment.webp', (route) => route.abort());
    await page.reload();
    await expect(page.getByRole('img', { name: 'Brewery environment artwork could not be loaded' })).toBeVisible();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('the Bakery proof commits one fold and one score from canonical layered poses', async ({ page }) => {
  test.setTimeout(60_000);
  const player = await createTestPlayer('bake-motion-proof');
  try {
    await loginAndHarvest(page, player.email, player.password);
    await page.getByRole('link', { name: 'Bakery', exact: true }).click();
    await page.getByRole('button', { name: 'Begin today’s loaf' }).click();

    let scene = page.locator('[data-motion-proof="bakery"]');
    await expect(scene).toHaveAttribute('data-phase', 'folding');
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

    for (let count = 2; count <= 6; count += 1) {
      await page.getByRole('button', { name: 'Fold dough with keyboard' }).click();
      if (count < 6) await expect(page.locator('.stage-heading > strong')).toHaveText(`${count}/6`);
    }

    scene = page.locator('[data-motion-proof="bakery"]');
    await expect(scene).toHaveAttribute('data-phase', 'scoring');
    projection = await sceneProjection(scene);
    point = projection.point(652, 621);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    point = projection.point(1020, 574);
    await page.mouse.move(point.x, point.y, { steps: 8 });
    await expect(scene.locator('.scoring-tool')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('.stage-heading > strong')).toHaveText('1/3');
    await expect(scene.locator('.groove')).toBeVisible();

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(scene).toHaveAttribute('data-reduced-motion', 'true');
    await expect(scene).toBeVisible();
    await expectNoHorizontalOverflow(page);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
