import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createTestPlayer, getLocalTestDatabaseContainer } from '../helpers/local-supabase';

async function loginAndCreate(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await page.getByRole('button', { name: 'Start tavern' }).click();
  await expect(page.getByRole('group', { name: /Illustrated tavern courtyard with \d+ selectable garden plots/i })).toBeVisible();
}

async function snapshotFor(player: Awaited<ReturnType<typeof createTestPlayer>>) {
  const snapshot = await player.client.rpc('get_tavern_snapshot');
  expect(snapshot.error).toBeNull();
  return snapshot.data as unknown as {
    save: { id: string };
    cells: Array<{ layoutKey: string; hive?: { colony?: { id: string } } }>;
  };
}

async function expectCenteredReveal(page: Page, title: string, animation: string) {
  const layer = page.locator('.acquisition-layer');
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  await expect(layer).toHaveCSS('position', 'fixed');
  await expect.poll(() => dialog.evaluate((element) => getComputedStyle(element).animationName)).toContain(animation);

  await expect.poll(() => dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.max(
      Math.abs(box.x + box.width / 2 - document.documentElement.clientWidth / 2),
      Math.abs(box.y + box.height / 2 - window.innerHeight / 2)
    );
  })).toBeLessThanOrEqual(4);
  return dialog;
}

async function selectGardenCell(page: Page, cell: Locator) {
  await expect(page.locator('main[data-hydrated="true"]')).toBeVisible();
  await cell.click();
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
}

test('a harvested crop reveals as an animated centered acquisition and Escape dismisses it', async ({ page }) => {
  const player = await createTestPlayer('acquisition-harvest');
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAndCreate(page, player.email, player.password);
    await selectGardenCell(page, page.getByRole('button', { name: /c1, Fennel.*ready to harvest/i }));
    await page.locator('[data-workflow-choice="harvest"]').click();

    await expectCenteredReveal(page, 'Fennel', 'acquisition-arrive');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Fennel' })).toBeHidden();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('honey extraction reveals a centered receipt that Continue dismisses', async ({ page }) => {
  const player = await createTestPlayer('acquisition-honey');
  try {
    await page.setViewportSize({ width: 1024, height: 768 });
    await loginAndCreate(page, player.email, player.password);
    const state = await snapshotFor(player);
    const colony = state.cells.find((cell) => cell.layoutKey === 'c2')?.hive?.colony;
    if (!colony) throw new Error('Expected the starter apiary colony.');
    execFileSync('docker', [
      'exec', getLocalTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', `update public.apiary_colonies set floral_honey=8 where id='${colony.id}'::uuid`
    ]);
    await page.reload();

    await selectGardenCell(page, page.getByRole('button', { name: /c2,.*beehive/i }));
    await page.locator('[data-workflow-choice="apiary"]').click();
    await page.locator('[data-workflow-choice="manage-apiary"]').click();
    await page.locator('[data-workflow-choice="apiary:extract_honey"]').click();
    await expect(page.locator('[data-workflow-confirm]')).toBeEnabled();
    await page.locator('[data-workflow-confirm]').click();

    const dialog = await expectCenteredReveal(page, 'Honey', 'acquisition-arrive');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog).toBeHidden();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('an ordinary shop purchase reveals its acquired item', async ({ page }) => {
  const player = await createTestPlayer('acquisition-shop-item');
  try {
    await loginAndCreate(page, player.email, player.password);
    const state = await snapshotFor(player);
    execFileSync('docker', [
      'exec', getLocalTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', `update public.tavern_saves set gold=50 where id='${state.save.id}'::uuid`
    ]);
    await page.goto('/shop');
    await page.getByRole('button', { name: 'Seeds', exact: true }).click();
    await page.getByRole('button', { name: 'Hops seed', exact: true }).click();
    await page.locator('.workflow-inspection').getByRole('button', { name: 'Hops seed.', exact: false }).click();

    const dialog = await expectCenteredReveal(page, 'Hops seed', 'acquisition-arrive');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog).toBeHidden();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('a rejected unfunded potion purchase creates no acquisition overlay', async ({ page }) => {
  const player = await createTestPlayer('acquisition-rejected');
  try {
    await loginAndCreate(page, player.email, player.password);
    await page.goto('/shop');
    await page.getByRole('button', { name: 'Provisions', exact: true }).click();
    await expect(page.locator('[data-forgetfulness-purchase]').getByRole('button', { name: 'Buy · 12 gold' })).toBeDisabled();
    await expect(page.locator('.acquisition-layer')).toHaveCount(0);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('Potion of Forgetfulness purchase keeps its acquisition centered on mobile and honors reduced motion', async ({ page }) => {
  const player = await createTestPlayer('acquisition-potion');
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginAndCreate(page, player.email, player.password);
    const state = await snapshotFor(player);
    execFileSync('docker', [
      'exec', getLocalTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', `update public.tavern_saves set gold=50 where id='${state.save.id}'::uuid`
    ]);
    await page.goto('/shop');
    await page.reload();
    await page.getByRole('button', { name: 'Provisions', exact: true }).click();
    const potion = page.locator('[data-forgetfulness-purchase]');
    await potion.getByRole('button', { name: 'Buy · 12 gold' }).click();

    const dialog = await expectCenteredReveal(page, 'Potion of Forgetfulness', 'none');
    const firstAcquisition = await dialog.getAttribute('aria-labelledby');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog).toBeHidden();
    await potion.getByRole('button', { name: 'Buy · 12 gold' }).click();
    const secondDialog = await expectCenteredReveal(page, 'Potion of Forgetfulness', 'none');
    expect(await secondDialog.getAttribute('aria-labelledby')).not.toBe(firstAcquisition);
    await expect(page.getByText('Potion of Forgetfulness · 2 held', { exact: true })).toBeVisible();
    await secondDialog.getByRole('button', { name: 'Continue' }).click();
    await expect(secondDialog).toBeHidden();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
