import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createTestPlayer } from '../tests/helpers/local-supabase';

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const outputDirectory = fileURLToPath(new URL('../docs/screenshots', import.meta.url));

const player = await createTestPlayer('screenshots');
const browser = await chromium.launch();

try {
  await mkdir(outputDirectory, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

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

  console.info(`Wrote garden and ingredient screenshots to ${outputDirectory}.`);
} finally {
  await browser.close();
  await player.admin.auth.admin.deleteUser(player.userId);
}
