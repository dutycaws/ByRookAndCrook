import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createTestPlayer } from '../../tests/helpers/local-supabase';
import {
  aggregateRouteTrials,
  evaluateRouteBudget,
  formatPerformanceSummary,
  MOBILE_MEDIA_BUDGETS,
  MOBILE_MEDIA_ROUTES,
  persistentBudgetFailures,
  shouldRetryBudgetEvaluation,
  type MediaRoute,
  type PerformanceMode,
  type TrialMetrics
} from './performance-policy';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const OUTPUT = process.env.MEDIA_PERF_OUTPUT
  ?? fileURLToPath(new URL('../../artifacts/media-performance/latest.json', import.meta.url));
const TRIAL_COUNT = 3;
const FAST_4G = { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 };
const MOBILE_CONTEXT = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

type CapturePageMetrics = {
  lcpMs: number | null;
  cls: number;
  interactionMs: number | null;
  resources: Array<{ name: string; initiatorType: string; encodedBodySize: number; transferSize: number }>;
};

function modeFromEnvironment(): PerformanceMode {
  const value = process.env.MEDIA_PERF_MODE ?? 'report';
  if (value !== 'report' && value !== 'enforce') throw new Error('MEDIA_PERF_MODE must be report or enforce.');
  return value;
}

function gitRevision() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

async function loginAndStart(page: Page, player: Awaited<ReturnType<typeof createTestPlayer>>) {
  await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill(player.email);
  await page.getByLabel('Password').fill(player.password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await page.waitForURL(`${APP_URL}/garden`);
  const start = page.getByRole('button', { name: 'Start tavern' });
  if (await start.isVisible()) await start.click();
  await page.getByRole('heading', { name: 'Hex garden' }).waitFor();
  // Create one pantry ingredient before measurements. Later route interactions
  // are all client-only selections, so the shared fixture stays unchanged.
  const starterCrop = page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i });
  await starterCrop.waitFor({ state: 'visible' });
  await starterCrop.click();
  const harvest = page.getByRole('button', { name: 'Harvest crop' });
  await harvest.waitFor({ state: 'visible' });
  await harvest.click();
  await page.getByRole('status').filter({ hasText: 'Harvested 2 ingredients' }).waitFor({ state: 'visible' });
}

/** Runs the documented, route-owned non-persistent interaction for Event Timing. */
async function performRepresentativeInteraction(page: Page, route: MediaRoute) {
  switch (route) {
    case '/garden':
      await page.locator('[data-layout-key="c2"]').click();
      return;
    case '/brewery':
    case '/bakery':
      await page.locator('input[name="ingredient"]').first().check();
      return;
    case '/bar': {
      const patrons = page.getByRole('group', { name: 'Choose a patron' }).getByRole('button');
      if (await patrons.count() < 2) throw new Error('Bar performance fixture did not render a second selectable patron.');
      await patrons.nth(1).click();
      return;
    }
  }
}

async function configureColdMobileContext(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.emulateNetworkConditions', FAST_4G);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return cdp;
}

async function installMetricObservers(page: Page) {
  await page.addInitScript(() => {
    type MetricStore = { lcpMs: number | null; cls: number; interactionMs: number | null };
    const eventSupported = PerformanceObserver.supportedEntryTypes.includes('event');
    const metrics: MetricStore = { lcpMs: null, cls: 0, interactionMs: eventSupported ? 0 : null };
    (window as Window & { __mediaPerf?: MetricStore }).__mediaPerf = metrics;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) metrics.lcpMs = Math.max(metrics.lcpMs ?? 0, entry.startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEntryList & { value?: number; hadRecentInput?: boolean }[]) {
          const layout = entry as unknown as { value: number; hadRecentInput: boolean };
          if (!layout.hadRecentInput) metrics.cls += layout.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const event = entry as PerformanceEntry & { duration: number };
          metrics.interactionMs = Math.max(metrics.interactionMs ?? 0, event.duration);
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch {
      // The result remains null when a browser does not support Event Timing.
    }
  });
}

async function collectTrial(route: MediaRoute, trial: number, browser: Awaited<ReturnType<typeof chromium.launch>>, storageState: Awaited<ReturnType<BrowserContext['storageState']>>): Promise<TrialMetrics> {
  const context = await browser.newContext({ ...MOBILE_CONTEXT, storageState });
  const page = await context.newPage();
  try {
    await installMetricObservers(page);
    await configureColdMobileContext(context, page);
    await page.goto(`${APP_URL}${route}`, { waitUntil: 'networkidle', timeout: 45_000 });
    // Do not submit a game command here: all trials share the same fixture save.
    // The selected controls invoke actual route handlers but only mutate local UI state.
    await performRepresentativeInteraction(page, route);
    // Give image decode, paint, and Event Timing buffers a short, deterministic settling window.
    await page.waitForTimeout(350);
    const metrics = await page.evaluate<CapturePageMetrics>(() => {
      const current = (window as Window & { __mediaPerf?: { lcpMs: number | null; cls: number; interactionMs: number | null } }).__mediaPerf;
      return {
        lcpMs: current?.lcpMs ?? null,
        cls: current?.cls ?? 0,
        interactionMs: current?.interactionMs ?? null,
        resources: performance.getEntriesByType('resource').map((entry) => {
          const resource = entry as PerformanceResourceTiming;
          return { name: resource.name, initiatorType: resource.initiatorType, encodedBodySize: resource.encodedBodySize, transferSize: resource.transferSize };
        })
      };
    });
    const images = metrics.resources.filter((resource) => resource.initiatorType === 'img' || /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(resource.name));
    const bytes = (resource: typeof images[number]) => Math.max(resource.encodedBodySize, resource.transferSize, 0);
    return {
      route, trial, lcpMs: metrics.lcpMs, cls: metrics.cls, interactionMs: metrics.interactionMs,
      imageCount: images.length,
      encodedMediaBytes: images.reduce((total, image) => total + bytes(image), 0),
      largestImageBytes: Math.max(0, ...images.map(bytes))
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const mode = modeFromEnvironment();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let player: Awaited<ReturnType<typeof createTestPlayer>> | undefined;
  let setupContext: BrowserContext | undefined;
  try {
    const activeBrowser = browser = await chromium.launch({ headless: true });
    const activePlayer = player = await createTestPlayer('media-performance');
    setupContext = await activeBrowser.newContext();
    const setupPage = await setupContext.newPage();
    await loginAndStart(setupPage, activePlayer);
    const storageState = await setupContext.storageState();
    await setupContext.close();
    setupContext = undefined;

    const trials: TrialMetrics[] = [];
    const evaluations: Array<{
      route: ReturnType<typeof aggregateRouteTrials>;
      initialFailures: ReturnType<typeof evaluateRouteBudget>;
      retry?: ReturnType<typeof aggregateRouteTrials>;
      failures: ReturnType<typeof evaluateRouteBudget>;
    }> = [];
    for (const route of MOBILE_MEDIA_ROUTES) {
      for (let trial = 1; trial <= TRIAL_COUNT; trial += 1) {
        console.info(`[media:perf] ${route} cold-cache trial ${trial}/${TRIAL_COUNT}`);
        trials.push(await collectTrial(route, trial, activeBrowser, storageState));
      }
      const routeMetrics = aggregateRouteTrials(route, trials.filter((trial) => trial.route === route));
      const initialFailures = evaluateRouteBudget(routeMetrics);
      if (shouldRetryBudgetEvaluation(mode, initialFailures)) {
        console.warn(`[media:perf] ${route} breached ${initialFailures.map((failure) => failure.metric).join(', ')}; retrying once.`);
        const retryTrials: TrialMetrics[] = [];
        for (let trial = 1; trial <= TRIAL_COUNT; trial += 1) {
          retryTrials.push(await collectTrial(route, TRIAL_COUNT + trial, activeBrowser, storageState));
        }
        trials.push(...retryTrials);
        const retry = aggregateRouteTrials(route, retryTrials);
        evaluations.push({ route: routeMetrics, initialFailures, retry, failures: persistentBudgetFailures(initialFailures, evaluateRouteBudget(retry)) });
      } else {
        evaluations.push({ route: routeMetrics, initialFailures, failures: initialFailures });
      }
    }
    const routes = evaluations.map((evaluation) => evaluation.route);
    for (const evaluation of evaluations) {
      console.info(formatPerformanceSummary(evaluation.retry ?? evaluation.route, evaluation.failures));
    }
    const report = {
      schemaVersion: 1,
      mode,
      generatedAt: new Date().toISOString(),
      gitRevision: gitRevision(),
      appUrl: APP_URL,
      trials,
      routes,
      evaluations,
      budgets: MOBILE_MEDIA_BUDGETS,
      failures: evaluations.flatMap(({ route, failures }) => failures.map((failure) => ({ route: route.route, ...failure })))
    };
    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
    if (mode === 'enforce' && report.failures.length > 0) throw new Error(`Mobile media performance budget failed for ${report.failures.map((failure) => `${failure.route}:${failure.metric}`).join(', ')}.`);
  } finally {
    await setupContext?.close().catch((error: unknown) => console.warn('[media:perf] Could not close setup browser context:', error));
    if (player) await player.admin.auth.admin.deleteUser(player.userId)
      .catch((error: unknown) => console.warn('[media:perf] Could not delete test player:', error));
    await browser?.close().catch((error: unknown) => console.warn('[media:perf] Could not close browser:', error));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
