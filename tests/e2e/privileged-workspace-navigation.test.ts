import { expect, test, type Page } from '@playwright/test';
import { createTestPlayer } from '../helpers/local-supabase';

async function createAdministrator() {
  const player = await createTestPlayer('privileged-navigation-admin');
  const bootstrap = await player.admin.rpc('npc_bootstrap_admin', { p_user: player.userId });
  if (bootstrap.error) throw bootstrap.error;
  return player;
}

async function signIn(page: Page, player: Awaited<ReturnType<typeof createAdministrator>>) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(player.email);
  await page.getByLabel('Password').fill(player.password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await expect(page).toHaveURL(/\/garden$/);
}

async function openReviewSection(page: Page, section: 'revisions' | 'moderation' | 'access') {
  const nav = page.getByRole('navigation', { name: 'Review desk areas' });
  const selector = `a[href*="section=${section}"]:visible`;
  if (!(await nav.locator(selector).count())) await nav.locator('summary').click();
  await nav.locator(selector).click();
  await expect(page).toHaveURL(new RegExp(`[?&]section=${section}(?:&|$)`));
}

test('review work is separated into revision, moderation, and access rooms', async ({ page }) => {
  const player = await createAdministrator();
  try {
    await signIn(page, player);
    await page.goto('/admin/npcs');

    await expect(page.getByRole('heading', { name: 'Review desk' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Submitted versions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reports and retirement' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Access administration' })).toHaveCount(0);

    await openReviewSection(page, 'moderation');
    await expect(page.getByRole('heading', { name: 'Reports and retirement' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Submitted versions' })).toHaveCount(0);

    await openReviewSection(page, 'access');
    await expect(page.getByRole('heading', { name: 'Access administration' })).toBeVisible();
    await page.getByRole('link', { name: 'Audit trail', exact: true }).click();
    await expect(page).toHaveURL(/[?&]panel=audit(?:&|$)/);
    await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible();
    await page.getByRole('link', { name: 'Danger zone', exact: true }).click();
    await expect(page).toHaveURL(/[?&]panel=danger(?:&|$)/);
    await expect(page.getByText('Danger zone · permanent NPC removal')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
