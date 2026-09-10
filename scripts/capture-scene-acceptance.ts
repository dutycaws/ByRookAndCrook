import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { cpus, freemem, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createTestPlayer } from '../tests/helpers/local-supabase';
import { createCaptureDirectory, finalizeCapture } from './media/capture-artifacts';

type Area = 'garden' | 'brewery' | 'bakery';
type Viewport = { label: string; width: number; height: number };
type TestPlayer = Awaited<ReturnType<typeof createTestPlayer>>;

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const serverMode = process.env.ACCEPTANCE_SERVER_MODE ?? 'development server';
const outputDirectory = createCaptureDirectory('scene-acceptance');
const temporaryVideoDirectory = await mkdtemp(join(tmpdir(), 'brac-scene-acceptance-video-'));
const benchmarkDurationMs = 2_000;
const benchmarkTrials = 3;

const viewports: Viewport[] = [
  { label: 'reference', width: 1672, height: 941 },
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'mobile', width: 390, height: 844 }
];

const references: Record<Area, { file: string; state: string }> = {
  garden: { file: 'CozyTavernConceptArt2.png', state: 'mature c1 selected' },
  brewery: { file: 'CozyTavernConceptArt3.png', state: 'active wort and paddle' },
  bakery: { file: 'CozyTavernConceptArt4.png', state: 'scored dough on the broad workbench' }
};

function round(value: number, places = 2) {
  return Number(value.toFixed(places));
}

function percentile(values: number[], fraction: number) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] ?? 0;
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete), undefined, { timeout: 5_000 })
    .catch(() => undefined);
  await page.waitForTimeout(100);
}

async function loginAndCreate(page: Page, player: TestPlayer) {
  await page.goto(`${appUrl}/login`);
  await page.getByLabel('Email').fill(player.email);
  await page.getByLabel('Password').fill(player.password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await page.waitForURL(`${appUrl}/garden`);
  const start = page.getByRole('button', { name: 'Start tavern' });
  if (await start.isVisible()) await start.click();
  else if (!(await page.getByRole('heading', { name: 'Hex garden' }).isVisible())) {
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 500);
    throw new Error(`Authenticated Garden did not expose a fresh or existing tavern: ${body}`);
  }
  await page.getByRole('heading', { name: 'Hex garden' }).waitFor();
}

async function harvestStarter(page: Page) {
  await page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }).click();
  await page.getByRole('button', { name: 'Harvest crop' }).click();
  await page.getByRole('status').filter({ hasText: 'Harvested 2 ingredients' }).waitFor();
}

async function prepareGarden(browser: Awaited<ReturnType<typeof chromium.launch>>, player: TestPlayer) {
  const context = await browser.newContext({ viewport: { width: 1672, height: 941 } });
  const page = await context.newPage();
  await loginAndCreate(page, player);
  await page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }).click();
  return { context, page };
}

async function prepareBrewery(browser: Awaited<ReturnType<typeof chromium.launch>>, player: TestPlayer) {
  const context = await browser.newContext({ viewport: { width: 1672, height: 941 } });
  const page = await context.newPage();
  await loginAndCreate(page, player);
  await harvestStarter(page);
  await page.goto(`${appUrl}/brewery`);
  await page.getByRole('button', { name: 'Begin 30-second brew' }).click();
  await page.locator('[data-motion-proof="brewery"][data-brew-phase="active"]').waitFor();
  return { context, page };
}

async function prepareBakery(browser: Awaited<ReturnType<typeof chromium.launch>>, player: TestPlayer) {
  const context = await browser.newContext({ viewport: { width: 1672, height: 941 } });
  const page = await context.newPage();
  await loginAndCreate(page, player);
  await harvestStarter(page);
  await page.goto(`${appUrl}/bakery`);
  await page.getByRole('button', { name: 'Begin today’s loaf' }).click();
  for (let count = 1; count <= 6; count += 1) {
    await page.getByRole('button', { name: 'Fold dough with keyboard' }).click();
    if (count < 6) await page.locator('.stage-heading > strong').filter({ hasText: `${count}/6` }).waitFor();
  }
  const scene = page.locator('[data-motion-proof="bakery"][data-bakery-phase="scoring"]');
  await scene.waitFor();
  await page.getByRole('button', { name: 'Score loaf with keyboard' }).click();
  await page.locator('.stage-heading > strong').filter({ hasText: '1/3' }).waitFor();
  return { context, page };
}

async function annotate(page: Page, area: Area, viewport: Viewport, state = references[area].state) {
  await page.evaluate(({ area, viewport, reference, state }) => {
    document.querySelector('#scene-acceptance-annotation')?.remove();
    const note = document.createElement('aside');
    note.id = 'scene-acceptance-annotation';
    note.setAttribute('aria-label', 'Acceptance evidence annotation');
    note.textContent = `Issue #13 · ${area.toUpperCase()} · ${state} · ${viewport.width}×${viewport.height} · reference ${reference}`;
    Object.assign(note.style, {
      position: 'fixed',
      right: '10px',
      bottom: '10px',
      zIndex: '2147483647',
      maxWidth: 'min(680px, calc(100vw - 20px))',
      padding: '7px 10px',
      border: '1px solid #d8a94e',
      borderRadius: '4px',
      background: 'rgba(19, 13, 8, .94)',
      color: '#f5db9b',
      font: '600 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '.02em',
      boxShadow: '0 3px 14px rgba(0,0,0,.55)',
      pointerEvents: 'none'
    });
    document.body.append(note);
  }, { area, viewport, reference: references[area].file, state });
}

async function frameArea(page: Page, area: Area) {
  const layout = page.locator(`[data-crafting-layout="${area}"]`);
  await layout.waitFor();
  await layout.evaluate((element) => {
    const headerOffset = 82;
    const top = element.getBoundingClientRect().top + window.scrollY - headerOffset;
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  });
  await settle(page);
}

async function captureStills(page: Page, area: Area) {
  const captures: Array<{ file: string; viewport: string; overflowPx: number }> = [];
  for (const viewport of viewports) {
    console.info(`Capturing ${area} at ${viewport.width}×${viewport.height}…`);
    await page.setViewportSize(viewport);
    await frameArea(page, area);
    await annotate(page, area, viewport);
    const file = `${area}-${viewport.width}x${viewport.height}.png`;
    await page.screenshot({ path: `${outputDirectory}/${file}`, fullPage: false });
    const overflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
    if (overflowPx > 0) throw new Error(`${area} overflowed ${viewport.width}×${viewport.height} by ${overflowPx}px.`);
    captures.push({ file, viewport: `${viewport.width}x${viewport.height}`, overflowPx });
  }
  return captures;
}

async function sceneProjection(page: Page, area: 'brewery') {
  const scene = page.locator(`[data-motion-proof="${area}"]`);
  await scene.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => Number(document.querySelector('[data-motion-proof="brewery"]')?.getAttribute('data-scene-scale')) > 0);
  const bounds = await scene.boundingBox();
  if (!bounds) throw new Error('The Brewery scene has no rendered bounds.');
  const scale = Number(await scene.getAttribute('data-scene-scale'));
  const offsetX = Number(await scene.getAttribute('data-scene-offset-x'));
  const offsetY = Number(await scene.getAttribute('data-scene-offset-y'));
  return {
    scale,
    point(x: number, y: number) {
      return { x: bounds.x + offsetX + x * scale, y: bounds.y + offsetY + y * scale };
    }
  };
}

async function dragBreweryCircle(page: Page) {
  const projection = await sceneProjection(page, 'brewery');
  const center = projection.point(836, 463);
  const radiusX = 330 * projection.scale;
  const radiusY = 96 * projection.scale;
  await page.mouse.move(center.x + radiusX, center.y);
  await page.mouse.down();
  for (let index = 1; index <= 28; index += 1) {
    const angle = Math.PI * 2 * index / 28;
    await page.mouse.move(center.x + Math.cos(angle) * radiusX, center.y + Math.sin(angle) * radiusY);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(650);
}

async function recordClip(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  area: Area,
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>,
  action: (page: Page) => Promise<void>
) {
  const viewport = viewports[0];
  const context = await browser.newContext({
    viewport,
    storageState,
    recordVideo: { dir: temporaryVideoDirectory, size: { width: 1024, height: 576 } }
  });
  const page = await context.newPage();
  await page.goto(`${appUrl}/${area}`);
  await frameArea(page, area);
  await annotate(page, area, viewport, `${references[area].state}; direct interaction`);
  const video = page.video();
  await page.waitForTimeout(350);
  await action(page);
  await page.waitForTimeout(750);
  await context.close();
  const file = `${area}-interaction.webm`;
  await video?.saveAs(`${outputDirectory}/${file}`);
  return file;
}

async function measureFrames(page: Page, durationMs: number) {
  const deltas = await page.evaluate<number[]>(`new Promise((resolve) => {
    const values = [];
    let startedAt = 0;
    let previous = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve(values);
    };
    setTimeout(finish, ${durationMs + 1_000});
    const tick = (now) => {
      if (finished) return;
      if (startedAt === 0) {
        startedAt = now;
        previous = now;
      } else {
        values.push(now - previous);
        previous = now;
      }
      if (now - startedAt >= ${durationMs}) finish();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`);
  const mean = deltas.reduce((total, value) => total + value, 0) / Math.max(1, deltas.length);
  const rawFps = mean > 0 ? 1000 / mean : 0;
  const rawWorstFrameMs = deltas.length > 0 ? Math.max(...deltas) : 0;
  return {
    frames: deltas.length,
    rawFps,
    rawWorstFrameMs,
    fps: round(rawFps, 1),
    medianFrameMs: round(percentile(deltas, .5)),
    p95FrameMs: round(percentile(deltas, .95)),
    worstFrameMs: round(rawWorstFrameMs),
    framesOver33ms: deltas.filter((value) => value > 33.34).length,
    framesOver50ms: deltas.filter((value) => value > 50).length
  };
}

async function startBenchmarkInteraction(page: Page, area: Area) {
  if (area === 'garden') {
    await page.evaluate(`(() => {
      const plots = Array.from(document.querySelectorAll('.plot-node .hex-cell')).slice(0, 2);
      let index = 0;
      window.__sceneAcceptanceDriver = setInterval(() => {
        plots[index % plots.length]?.click();
        index += 1;
      }, 140);
    })()`);
    return 'live native plot selection toggled every 140ms over the illustrated grid';
  }
  if (area === 'brewery') {
    await page.evaluate(`(() => {
      const slider = document.querySelector('input[type="range"][aria-label="Stirring speed in RPM"]');
      if (!slider) throw new Error('The assisted Brewery slider is unavailable.');
      let high = false;
      window.__sceneAcceptanceDriver = setInterval(() => {
        high = !high;
        slider.value = high ? '18' : '12';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }, 140);
    })()`);
    return 'live assisted stirring alternated inside the perfect band every 140ms';
  }
  const phase = await page.locator('[data-motion-proof="bakery"]').getAttribute('data-bakery-phase');
  if (phase !== 'baking') throw new Error(`The Bakery benchmark requires the live oven phase, received ${phase}.`);
  return 'server-timed oven phase with live embers, steam, loaf rise, and crust progression';
}

async function stopBenchmarkInteraction(page: Page) {
  await page.evaluate(`(() => {
    if (window.__sceneAcceptanceDriver) clearInterval(window.__sceneAcceptanceDriver);
    delete window.__sceneAcceptanceDriver;
  })()`);
}

async function benchmark(page: Page, area: Area, viewport: Viewport) {
  console.info(`Benchmarking ${area} at ${viewport.width}×${viewport.height}…`);
  await page.bringToFront();
  await page.setViewportSize(viewport);
  await frameArea(page, area);
  await page.locator('#scene-acceptance-annotation').evaluate((element) => element.remove()).catch(() => undefined);
  const interaction = await startBenchmarkInteraction(page, area);
  const trials = [];
  try {
    for (let index = 0; index < benchmarkTrials; index += 1) {
      trials.push(await measureFrames(page, benchmarkDurationMs));
    }
  } finally {
    await stopBenchmarkInteraction(page);
  }
  const meanRawFps = trials.reduce((total, trial) => total + trial.rawFps, 0) / trials.length;
  const meanFps = round(meanRawFps, 1);
  const rawWorstFrameMs = Math.max(...trials.map((trial) => trial.rawWorstFrameMs));
  const worstFrameMs = round(rawWorstFrameMs);
  const targetFps = viewport.width <= 390 ? 30 : 60;
  const minimumPassingFps = viewport.width <= 390 ? 30 : 59;
  return {
    area,
    viewport: `${viewport.width}x${viewport.height}`,
    targetFps,
    minimumPassingFps,
    interaction,
    meanFps,
    worstFrameMs,
    materialStallsOver50ms: trials.reduce((total, trial) => total + trial.framesOver50ms, 0),
    meetsTarget: meanRawFps >= minimumPassingFps && rawWorstFrameMs <= 50,
    trials: trials.map(({ rawFps, rawWorstFrameMs, ...trial }) => ({
      ...trial,
      unroundedFps: round(rawFps, 4),
      unroundedWorstFrameMs: round(rawWorstFrameMs, 4)
    }))
  };
}

const players: TestPlayer[] = [];
const contexts: BrowserContext[] = [];
const browser = await chromium.launch();

try {
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(temporaryVideoDirectory, { recursive: true });

  const gardenPlayer = await createTestPlayer('final-garden');
  const breweryPlayer = await createTestPlayer('final-brewery');
  const bakeryPlayer = await createTestPlayer('final-bakery');
  players.push(gardenPlayer, breweryPlayer, bakeryPlayer);

  const garden = await prepareGarden(browser, gardenPlayer);
  const brewery = await prepareBrewery(browser, breweryPlayer);
  const bakery = await prepareBakery(browser, bakeryPlayer);
  contexts.push(garden.context, brewery.context, bakery.context);

  const screenshots = [
    ...(await captureStills(garden.page, 'garden')),
    ...(await captureStills(brewery.page, 'brewery')),
    ...(await captureStills(bakery.page, 'bakery'))
  ];

  const gardenStorage = await garden.context.storageState();
  const breweryStorage = await brewery.context.storageState();
  const bakeryStorage = await bakery.context.storageState();

  if (await brewery.page.getByRole('radio', { name: /Assisted control/ }).isVisible()) {
    await brewery.page.getByRole('radio', { name: /Assisted control/ }).check();
  }
  const benchmarkViewports = [viewports[1], viewports[3]];
  const benchmarks = [];
  for (const { page, area } of [
    { page: brewery.page, area: 'brewery' as const },
    { page: garden.page, area: 'garden' as const }
  ]) {
    for (const viewport of benchmarkViewports) benchmarks.push(await benchmark(page, area, viewport));
  }

  const motionClips = [
    await recordClip(browser, 'garden', gardenStorage, async (page) => {
      await page.getByRole('button', { name: /^c4,/i }).click();
      await page.waitForTimeout(250);
      await page.getByRole('button', { name: /^c1,/i }).click();
      await page.getByRole('button', { name: 'Harvest crop' }).click();
      await page.getByRole('status').filter({ hasText: 'Harvested 2 ingredients' }).waitFor();
    }),
    await recordClip(browser, 'brewery', breweryStorage, dragBreweryCircle),
    await recordClip(browser, 'bakery', bakeryStorage, async (page) => {
      await page.getByRole('button', { name: 'Score loaf with keyboard' }).click();
      await page.locator('.stage-heading > strong').filter({ hasText: '2/3' }).waitFor();
      await page.getByRole('button', { name: 'Score loaf with keyboard' }).click();
      await page.locator('[data-motion-proof="bakery"][data-bakery-phase="ready"]').waitFor();
      await page.getByRole('button', { name: 'Put loaf in oven' }).click();
      await page.locator('[data-motion-proof="bakery"][data-bakery-phase="baking"]').waitFor();
    })
  ];

  await bakery.page.reload();
  for (const viewport of benchmarkViewports) benchmarks.push(await benchmark(bakery.page, 'bakery', viewport));

  const cpu = cpus()[0]?.model ?? 'unknown';
  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    gitCommit: process.env.CAPTURE_COMMIT ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    appUrl,
    conditions: {
      serverMode,
      operatingSystem: `${platform()} ${release()}`,
      cpu,
      logicalCpuCount: cpus().length,
      totalMemoryGiB: round(totalmem() / 1024 ** 3, 1),
      freeMemoryGiBAtCapture: round(freemem() / 1024 ** 3, 1),
      browser: await browser.version(),
      browserMode: 'headless Chromium',
      deviceScaleFactor: 1,
      throttling: 'none',
      mobileClaim: 'viewport-size emulation in desktop Chromium; no physical-device claim',
      benchmarkDurationMs,
      benchmarkTrials
    },
    references,
    screenshots,
    motionClips,
    benchmarks
  };
  await writeFile(`${outputDirectory}/acceptance-results.json`, `${JSON.stringify(report, null, 2)}\n`);

  await finalizeCapture(outputDirectory, 'scene-acceptance', await browser.version(), { width: 1672, height: 941, deviceScaleFactor: 1 }, 'npm run scene:acceptance:capture', serverMode, {
    references,
    benchmarks
  });

  const failed = benchmarks.filter((entry) => !entry.meetsTarget);
  if (failed.length > 0) {
    throw new Error(`Performance targets were missed: ${failed.map((entry) => `${entry.area} ${entry.viewport} ${entry.meanFps}fps/${entry.worstFrameMs}ms`).join(', ')}`);
  }
  console.info(`Wrote 12 annotated screenshots, 3 motion clips, and benchmark results to ${outputDirectory}.`);
} finally {
  await Promise.allSettled(contexts.map((context) => context.close()));
  await browser.close();
  await Promise.allSettled(players.map((player) => player.admin.auth.admin.deleteUser(player.userId)));
  await rm(temporaryVideoDirectory, { recursive: true, force: true });
}
