import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createBrewedTavern } from '../tests/helpers/brewed-tavern.js';
import { createTestPlayer } from '../tests/helpers/local-supabase.js';
import { createCaptureDirectory, finalizeCapture } from './media/capture-artifacts.js';
import { LOCAL_SCENE_RUNTIME_ASSET_DIRECTORY, SCENE_RUNTIME_ASSETS } from '../src/lib/game/scene-runtime-assets.js';
import {
  ISSUE_24_SCENE_CAPTURE_KIND,
  ISSUE_24_SCENE_VIEWPORTS,
  issue24ScreenshotName,
  type Issue24Scene
} from './issue-24-scene-acceptance-contract.js';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const outputDirectory = createCaptureDirectory(ISSUE_24_SCENE_CAPTURE_KIND);
const temporaryVideoDirectory = await mkdtemp(join(tmpdir(), 'brac-issue-24-video-'));

type Player = Awaited<ReturnType<typeof createTestPlayer>>;
type BrewedPlayer = Awaited<ReturnType<typeof createBrewedTavern>>;
type ResourceSummary = { url: string; bytes: number; transferBytes: number; durationMs: number };
type PageVitals = {
  lcpMs: number | null;
  cls: number;
  sceneResourceBytes: number;
  largestImageBytes: number;
  interactionMs: number | null;
};
type RuntimeSceneMediaBudget = { runtimeSceneAssetBytes: number; largestSceneAssetBytes: number };
type ViewportResult = { viewport: string; overflowPx: number; sceneReadyMs: number; interactiveReadyMs: number; resources: ResourceSummary[]; vitals: Omit<PageVitals, 'interactionMs'> };

function now() { return performance.now(); }

async function addPerformanceObservers(context: BrowserContext) {
  await context.addInitScript(() => {
    const metrics = { lcpMs: null as number | null, cls: 0 };
    (window as Window & { __issue24SceneMetrics?: typeof metrics }).__issue24SceneMetrics = metrics;
    new PerformanceObserver((entries) => {
      const latest = entries.getEntries().at(-1);
      if (latest) metrics.lcpMs = latest.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries() as PerformanceEntry[] & Array<{ value?: number; hadRecentInput?: boolean }>) {
        if (!entry.hadRecentInput) metrics.cls += entry.value ?? 0;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

async function runtimeSceneMediaBudget(): Promise<RuntimeSceneMediaBudget> {
  const sizes = await Promise.all(SCENE_RUNTIME_ASSETS.map(async (asset) => {
    try { return (await stat(join(LOCAL_SCENE_RUNTIME_ASSET_DIRECTORY, asset.filename))).size; }
    catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return 0;
      throw error;
    }
  }));
  return { runtimeSceneAssetBytes: sizes.reduce((total, bytes) => total + bytes, 0), largestSceneAssetBytes: Math.max(0, ...sizes) };
}

async function login(page: Page, player: Player | BrewedPlayer, startTavern: boolean) {
  await page.goto(`${appUrl}/login`);
  await page.getByLabel('Email').fill(player.email);
  await page.getByLabel('Password').fill(player.password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await page.waitForURL(`${appUrl}/garden`);
  if (startTavern) {
    const start = page.getByRole('button', { name: 'Start tavern' });
    if (await start.isVisible()) await start.click();
  }
}

async function openScene(page: Page, scene: Issue24Scene) {
  const beganAt = now();
  await page.goto(`${appUrl}/${scene}`);
  const composition = page.locator(`[data-scene-composition="${scene}"]`);
  await composition.waitFor();
  await page.locator(`[data-area-scene="${scene}"][data-scene-ready="true"]`).waitFor();
  const sceneReadyMs = Math.round(now() - beganAt);
  const interactiveReadyMs = scene === 'bar'
    ? await waitForBarTargets(page, beganAt)
    : sceneReadyMs;
  return { composition, sceneReadyMs, interactiveReadyMs };
}

async function waitForBarTargets(page: Page, beganAt: number) {
  const targets = page.locator('[data-scene-composition="bar"] button[data-scene-actor]');
  await targets.first().waitFor();
  const count = await targets.count();
  if (count < 2) throw new Error(`Bar requires both authored resident targets; found ${count}.`);
  for (let index = 0; index < count; index += 1) {
    const box = await targets.nth(index).boundingBox();
    if (!box || box.width < 44 || box.height < 44) {
      throw new Error(`Bar scene actor ${index} must retain a 44px target; got ${box?.width ?? 0}×${box?.height ?? 0}.`);
    }
  }
  return Math.round(now() - beganAt);
}

function resourceSummary(page: Page): Promise<ResourceSummary[]> {
  return page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => entry as PerformanceResourceTiming)
    .filter((entry) => /(?:scene|storage\/v1\/object\/public\/prototype-runtime-media)/.test(entry.name))
    .map((entry) => ({
      url: new URL(entry.name).pathname,
      bytes: Math.round(entry.decodedBodySize),
      transferBytes: Math.round(entry.transferSize),
      durationMs: Math.round(entry.duration)
    }))
    .sort((left, right) => left.url.localeCompare(right.url)));
}

function pageVitals(page: Page, interactionMs: number | null = null): Promise<PageVitals> {
  return page.evaluate(({ interactionMs }) => {
    const metrics = (window as Window & { __issue24SceneMetrics?: { lcpMs: number | null; cls: number } }).__issue24SceneMetrics;
    const resources = performance.getEntriesByType('resource')
      .map((entry) => entry as PerformanceResourceTiming)
      .filter((entry) => /(?:scene|storage\/v1\/object\/public\/prototype-runtime-media)/.test(entry.name));
    const imageResources = resources.filter((entry) => /\.(?:avif|gif|jpe?g|png|webp)(?:$|\?)/i.test(entry.name));
    return {
      lcpMs: metrics?.lcpMs === null || metrics?.lcpMs === undefined ? null : Math.round(metrics.lcpMs),
      cls: Number((metrics?.cls ?? 0).toFixed(4)),
      sceneResourceBytes: resources.reduce((total, entry) => total + entry.decodedBodySize, 0),
      largestImageBytes: imageResources.reduce((largest, entry) => Math.max(largest, entry.decodedBodySize), 0),
      interactionMs
    };
  }, { interactionMs });
}

async function captureStills(page: Page, scene: Issue24Scene) {
  const results: ViewportResult[] = [];
  for (const viewport of ISSUE_24_SCENE_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const opened = await openScene(page, scene);
    const overflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
    if (overflowPx > 0) throw new Error(`${scene} overflowed ${viewport.label} by ${overflowPx}px.`);
    await page.screenshot({ path: join(outputDirectory, issue24ScreenshotName(scene, viewport)), fullPage: false });
    results.push({
      viewport: viewport.label,
      overflowPx,
      sceneReadyMs: opened.sceneReadyMs,
      interactiveReadyMs: opened.interactiveReadyMs,
      resources: await resourceSummary(page),
      vitals: await pageVitals(page)
    });
  }
  return results;
}

async function moveAcrossScene(page: Page, scene: Issue24Scene) {
  const bounds = await page.locator(`[data-scene-composition="${scene}"]`).boundingBox();
  if (!bounds) throw new Error(`${scene} composition has no bounds for motion proof.`);
  await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .35);
  await page.waitForTimeout(120);
  await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height * .62, { steps: 12 });
  await page.waitForTimeout(200);
}

async function recordShopParallax(browser: Awaited<ReturnType<typeof chromium.launch>>, player: Player) {
  const context = await browser.newContext({
    viewport: ISSUE_24_SCENE_VIEWPORTS[0],
    recordVideo: { dir: temporaryVideoDirectory, size: { width: 1024, height: 576 } }
  });
  await addPerformanceObservers(context);
  const page = await context.newPage();
  await login(page, player, true);
  await openScene(page, 'shop');
  const video = page.video();
  await moveAcrossScene(page, 'shop');
  await context.close();
  await video?.saveAs(join(outputDirectory, 'shop-parallax.webm'));
}

async function recordBarSelection(browser: Awaited<ReturnType<typeof chromium.launch>>, player: BrewedPlayer) {
  const context = await browser.newContext({
    viewport: ISSUE_24_SCENE_VIEWPORTS[0],
    recordVideo: { dir: temporaryVideoDirectory, size: { width: 1024, height: 576 } }
  });
  await addPerformanceObservers(context);
  const page = await context.newPage();
  await login(page, player, false);
  await openScene(page, 'bar');
  const video = page.video();
  await moveAcrossScene(page, 'bar');
  // The composition deliberately permits overlapping illustrated hit regions.
  // Use the roving keyboard target here: it verifies the equivalent accessible
  // selection interaction without depending on whichever actor paints on top.
  const nextActor = page.locator('[data-scene-composition="bar"] button[data-scene-actor][aria-pressed="false"]').first();
  await nextActor.focus();
  const interactionStarted = now();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-scene-composition="bar"] button[data-scene-actor][aria-pressed="true"]')
    ?.getAttribute('data-scene-actor') === document.activeElement?.getAttribute('data-scene-actor'));
  const interactionMs = Math.round(now() - interactionStarted);
  await page.waitForTimeout(250);
  await context.close();
  await video?.saveAs(join(outputDirectory, 'bar-selection-parallax.webm'));
  return interactionMs;
}

async function measureShopInteraction(page: Page) {
  await openScene(page, 'shop');
  const action = page.locator('[data-good-key="seed_clover"] button').first();
  await action.waitFor();
  const startedAt = now();
  await action.click();
  await page.locator('[data-shop-detail]').waitFor();
  return pageVitals(page, Math.round(now() - startedAt));
}

async function measureBarInteraction(page: Page) {
  await openScene(page, 'bar');
  const nextActor = page.locator('[data-scene-composition="bar"] button[data-scene-actor][aria-pressed="false"]').first();
  await nextActor.focus();
  const startedAt = now();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-scene-composition="bar"] button[data-scene-actor][aria-pressed="true"]')
    ?.getAttribute('data-scene-actor') === document.activeElement?.getAttribute('data-scene-actor'));
  return pageVitals(page, Math.round(now() - startedAt));
}

const shopPlayer = await createTestPlayer('issue-24-shop-capture');
const barPlayer = await createBrewedTavern('issue-24-bar-capture');
const browser = await chromium.launch();

try {
  await mkdir(outputDirectory, { recursive: true });
  const shopContext = await browser.newContext({ viewport: ISSUE_24_SCENE_VIEWPORTS[0] });
  await addPerformanceObservers(shopContext);
  const shopPage = await shopContext.newPage();
  await login(shopPage, shopPlayer, true);
  const shop = await captureStills(shopPage, 'shop');
  const shopPerformance = await measureShopInteraction(shopPage);
  await shopContext.close();

  const barContext = await browser.newContext({ viewport: ISSUE_24_SCENE_VIEWPORTS[0] });
  await addPerformanceObservers(barContext);
  const barPage = await barContext.newPage();
  await login(barPage, barPlayer, false);
  const bar = await captureStills(barPage, 'bar');
  const barPerformance = await measureBarInteraction(barPage);
  await barContext.close();

  await recordShopParallax(browser, shopPlayer);
  const barProofInteractionMs = await recordBarSelection(browser, barPlayer);
  await writeFile(join(outputDirectory, 'issue-24-results.json'), `${JSON.stringify({
    issue: 24,
    note: 'Focused Shop and Bar acceptance capture; output remains ignored candidate evidence.',
    shop,
    bar,
    performance: {
      shop: shopPerformance,
      bar: { ...barPerformance, proofInteractionMs: barProofInteractionMs },
      runtimeSceneMedia: await runtimeSceneMediaBudget(),
      note: 'Report-only browser timing. Compare byte values and largest-image bytes to MOBILE_MEDIA_BUDGETS; no pass/fail budget is imposed here.'
    }
  }, null, 2)}\n`);
  await finalizeCapture(outputDirectory, ISSUE_24_SCENE_CAPTURE_KIND, await browser.version(), { width: 1672, height: 941, deviceScaleFactor: 1 }, 'npm run issue:24:scene:capture', process.env.ACCEPTANCE_SERVER_MODE ?? 'development server', {
    viewports: ISSUE_24_SCENE_VIEWPORTS.map((viewport) => viewport.label),
    checks: ['no horizontal overflow', 'Bar actor targets at least 44px', 'runtime resource byte/load timings', 'Shop parallax proof', 'Bar selection plus parallax proof']
  });
  console.info(`Wrote focused Issue #24 Shop/Bar evidence to ${outputDirectory}.`);
} finally {
  await browser.close();
  await Promise.all([
    shopPlayer.admin.auth.admin.deleteUser(shopPlayer.userId),
    barPlayer.admin.auth.admin.deleteUser(barPlayer.userId)
  ]);
  await rm(temporaryVideoDirectory, { recursive: true, force: true });
}
