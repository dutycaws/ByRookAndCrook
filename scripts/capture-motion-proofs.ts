import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createTestPlayer } from '../tests/helpers/local-supabase';
import { createCaptureDirectory, finalizeCapture } from './media/capture-artifacts';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const outputDirectory = createCaptureDirectory('motion-proofs');
const temporaryVideoDirectory = await mkdtemp(join(tmpdir(), 'brac-motion-proof-video-'));

async function loginAndHarvest(page: Page, email: string, password: string) {
  await page.goto(`${appUrl}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await page.getByRole('button', { name: 'Start tavern' }).click();
  await page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }).click();
  await page.getByRole('button', { name: 'Harvest crop' }).click();
  await page.getByRole('status').filter({ hasText: 'Harvested 2 ingredients' }).waitFor();
}

async function dragCircle(page: Page, clockwise: boolean) {
  const scene = page.locator('[data-motion-proof="brewery"]');
  const bounds = await scene.boundingBox();
  if (!bounds) throw new Error('The Brewery proof has no rendered bounds.');
  const centerX = bounds.x + bounds.width * (836 / 1672);
  const centerY = bounds.y + bounds.height * (463 / 941);
  const radiusX = bounds.width * (330 / 1672);
  const radiusY = bounds.height * (96 / 941);
  await page.mouse.move(centerX + radiusX, centerY);
  await page.mouse.down();
  for (let index = 1; index <= 28; index += 1) {
    const angle = (clockwise ? 1 : -1) * Math.PI * 2 * index / 28;
    await page.mouse.move(centerX + Math.cos(angle) * radiusX, centerY + Math.sin(angle) * radiusY);
    await page.waitForTimeout(18);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
}

async function dragBakery(page: Page) {
  const scene = page.locator('[data-motion-proof="bakery"]');
  const bounds = await scene.boundingBox();
  if (!bounds) throw new Error('The Bakery proof has no rendered bounds.');
  await page.mouse.move(bounds.x + bounds.width * .39, bounds.y + bounds.height * .69);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .66, bounds.y + bounds.height * .63, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

async function screenshotScene(context: BrowserContext, path: string, route: '/brewery' | '/bakery') {
  const page = await context.newPage();
  await page.goto(`${appUrl}${route}`);
  const scene = page.locator(`[data-motion-proof="${route.slice(1)}"]`);
  await scene.waitFor();
  await scene.screenshot({ path });
  await page.close();
}

const breweryPlayer = await createTestPlayer('brew-motion-evidence');
const bakeryPlayer = await createTestPlayer('bake-motion-evidence');
const browser = await chromium.launch();

try {
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(temporaryVideoDirectory, { recursive: true });

  const breweryContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    recordVideo: { dir: temporaryVideoDirectory, size: { width: 1024, height: 711 } }
  });
  const breweryPage = await breweryContext.newPage();
  await loginAndHarvest(breweryPage, breweryPlayer.email, breweryPlayer.password);
  await breweryPage.getByRole('link', { name: 'Brewery', exact: true }).click();
  await breweryPage.getByRole('button', { name: 'Begin guided brew' }).click();
  const breweryScene = breweryPage.locator('[data-motion-proof="brewery"]');
  await breweryScene.waitFor();
  const breweryStorage = await breweryContext.storageState();
  await breweryScene.screenshot({ path: `${outputDirectory}/brewery-desktop-1x.png` });
  await dragCircle(breweryPage, true);
  await dragCircle(breweryPage, false);
  await breweryPage.setViewportSize({ width: 390, height: 844 });
  await breweryScene.screenshot({ path: `${outputDirectory}/brewery-phone-1x.png` });
  const breweryVideo = breweryPage.video();
  await breweryContext.close();
  await breweryVideo?.saveAs(`${outputDirectory}/brewery-demo.webm`);

  const brewery2xDesktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, storageState: breweryStorage
  });
  await screenshotScene(brewery2xDesktop, `${outputDirectory}/brewery-desktop-2x.png`, '/brewery');
  await brewery2xDesktop.close();
  const brewery2xPhone = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, storageState: breweryStorage
  });
  await screenshotScene(brewery2xPhone, `${outputDirectory}/brewery-phone-2x.png`, '/brewery');
  await brewery2xPhone.close();

  const bakeryContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    recordVideo: { dir: temporaryVideoDirectory, size: { width: 1024, height: 711 } }
  });
  const bakeryPage = await bakeryContext.newPage();
  await loginAndHarvest(bakeryPage, bakeryPlayer.email, bakeryPlayer.password);
  await bakeryPage.getByRole('link', { name: 'Bakery', exact: true }).click();
  await bakeryPage.getByRole('button', { name: 'Begin today’s loaf' }).click();
  let bakeryScene = bakeryPage.locator('[data-motion-proof="bakery"]');
  await bakeryScene.waitFor();
  await bakeryScene.screenshot({ path: `${outputDirectory}/bakery-fold-desktop-1x.png` });
  await dragBakery(bakeryPage);
  for (let count = 2; count <= 6; count += 1) {
    await bakeryPage.getByRole('button', { name: 'Fold dough with keyboard' }).click();
    if (count < 6) {
      await bakeryPage.locator('.stage-heading > strong').filter({ hasText: `${count}/6` }).waitFor();
    }
  }
  bakeryScene = bakeryPage.locator('[data-motion-proof="bakery"][data-bakery-phase="scoring"]');
  await bakeryScene.waitFor();
  await dragBakery(bakeryPage);
  await bakeryPage.locator('.stage-heading > strong').filter({ hasText: '1/3' }).waitFor();
  const bakeryStorage = await bakeryContext.storageState();
  await bakeryPage.setViewportSize({ width: 390, height: 844 });
  await bakeryScene.screenshot({ path: `${outputDirectory}/bakery-score-phone-1x.png` });
  const bakeryVideo = bakeryPage.video();
  await bakeryContext.close();
  await bakeryVideo?.saveAs(`${outputDirectory}/bakery-demo.webm`);

  const bakery2xDesktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, storageState: bakeryStorage
  });
  await screenshotScene(bakery2xDesktop, `${outputDirectory}/bakery-score-desktop-2x.png`, '/bakery');
  await bakery2xDesktop.close();
  const bakery2xPhone = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, storageState: bakeryStorage
  });
  await screenshotScene(bakery2xPhone, `${outputDirectory}/bakery-score-phone-2x.png`, '/bakery');
  await bakery2xPhone.close();

  await finalizeCapture(outputDirectory, 'motion-proofs', await browser.version(), { width: 1440, height: 1000, deviceScaleFactor: 1 }, 'npm run motion:proof:capture', process.env.ACCEPTANCE_SERVER_MODE ?? 'development server', {
    viewports: ['1440x1000@1x', '1440x1000@2x', '390x844@1x', '390x844@2x']
  });
  console.info(`Wrote candidate motion evidence and capture manifest to ${outputDirectory}.`);
} finally {
  await browser.close();
  await Promise.all([
    breweryPlayer.admin.auth.admin.deleteUser(breweryPlayer.userId),
    bakeryPlayer.admin.auth.admin.deleteUser(bakeryPlayer.userId)
  ]);
  await rm(temporaryVideoDirectory, { recursive: true, force: true });
}
