import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createTestPlayer } from '../tests/helpers/local-supabase';
import { createCaptureDirectory, finalizeCapture } from './media/capture-artifacts';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const outputDirectory = createCaptureDirectory('screenshots');

const player = await createTestPlayer('screenshots');
const browser = await chromium.launch();

try {
  await mkdir(outputDirectory, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors: string[] = [];
  page.on('pageerror', (cause) => pageErrors.push(cause.message));

  await page.goto(`${appUrl}/login`);
  await page.getByLabel('Email').fill(player.email);
  await page.getByLabel('Password').fill(player.password);
  await Promise.all([
    page.waitForURL(`${appUrl}/garden`),
    page.getByRole('button', { name: 'Open the ledger' }).click()
  ]);
  await page.getByRole('button', { name: 'Start tavern' }).click();
  await page.getByRole('heading', { name: 'Hex garden' }).waitFor();
  await page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }).click();
  await page.screenshot({ path: `${outputDirectory}/garden.png`, fullPage: true });

  await page.getByRole('button', { name: 'Harvest crop' }).click();
  await page.getByRole('status').filter({ hasText: 'Harvested 2 ingredients' }).waitFor();
  await Promise.all([
    page.waitForURL(`${appUrl}/ingredients`),
    page.getByRole('link', { name: /View ingredients/ }).click()
  ]);
  await page.getByRole('heading', { name: 'Fennel' }).waitFor();
  await page.screenshot({ path: `${outputDirectory}/ingredients.png`, fullPage: true });

  await page.getByRole('link', { name: 'Open brewery' }).click();
  await page.getByRole('heading', { name: "Prepare today's infusion" }).waitFor();
  await page.screenshot({ path: `${outputDirectory}/brewery-setup.png`, fullPage: true });

  await page.getByRole('button', { name: 'Begin 30-second brew' }).click();
  await page.getByRole('heading', { name: 'Stir the wort' }).waitFor();
  await page.waitForFunction(() => {
    const timer = document.querySelector('.brew-progress-heading strong');
    return timer !== null && timer.textContent !== '30s';
  });
  await page.getByRole('radio', { name: /Assisted control/ }).check();
  await page.getByLabel('Stirring speed').evaluate((control) => {
    const slider = control as HTMLInputElement;
    slider.value = '15';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByText('Perfect', { exact: true }).waitFor();
  await page.screenshot({ path: `${outputDirectory}/brewery-active.png`, fullPage: true });

  const snapshot = await player.client.rpc('get_tavern_snapshot');
  if (snapshot.error) throw snapshot.error;
  const activeSession = (snapshot.data as unknown as { brewery: { activeSession: { id: string } | null } })
    .brewery.activeSession;
  if (!activeSession) throw new Error('Expected an active brew session while capturing screenshots.');
  const backdated = await player.admin
    .from('brew_sessions')
    .update({ started_at: new Date(Date.now() - 31_000).toISOString() })
    .eq('id', activeSession.id);
  if (backdated.error) throw backdated.error;

  await page.reload();
  await page.getByRole('button', { name: 'Bottle this brew' }).click();
  await page.getByRole('heading', { name: 'Honest Mead' }).waitFor();
  await page.screenshot({ path: `${outputDirectory}/brewery-result.png`, fullPage: true });

  await page.getByRole('link', { name: 'Serve a drink at the bar' }).click();
  await page.getByRole('group', { name: 'Choose your intent' }).getByRole('button').nth(1).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${outputDirectory}/bar-1440.png`, fullPage: false });
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${outputDirectory}/bar-1672.png`, fullPage: false });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${outputDirectory}/bar-768.png`, fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Serve to Lira Nightwind' }).click();
  await page.locator('.serving-history li').first().waitFor();
  await page.screenshot({ path: `${outputDirectory}/bar-result.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${outputDirectory}/bar-390.png`, fullPage: false });

  if (pageErrors.length > 0) throw new Error(`Browser errors while capturing screenshots: ${pageErrors.join('; ')}`);

  await finalizeCapture(outputDirectory, 'screenshots', await browser.version(), { width: 1440, height: 1000, deviceScaleFactor: 1 }, 'npm run screenshots', process.env.ACCEPTANCE_SERVER_MODE ?? 'development server', {
    viewports: ['1440x1000', '1440x900', '1672x941', '768x1024', '390x844']
  });
  console.info(`Wrote candidate screenshots and capture manifest to ${outputDirectory}.`);
} finally {
  await browser.close();
  await player.admin.auth.admin.deleteUser(player.userId);
}
