import { expect, test, type Page } from '@playwright/test';
import { createTestPlayer } from '../helpers/local-supabase';

async function createPromptManager() {
  const player = await createTestPlayer('prompt-registry-manager');
  const bootstrap = await player.admin.rpc('npc_bootstrap_admin', { p_user: player.userId });
  if (bootstrap.error) throw bootstrap.error;
  const granted = await player.client.rpc('npc_admin_set_capability', {
    p_user: player.userId, p_capability: 'prompt_manager', p_enabled: true, p_reason: 'Prompt registry browser fixture'
  });
  if (granted.error) throw granted.error;
  // Exercise the dedicated capability, rather than inheriting access through
  // administrator status. The browser session remains valid after revocation.
  const revoked = await player.client.rpc('npc_admin_set_capability', {
    p_user: player.userId, p_capability: 'admin', p_enabled: false, p_reason: 'Exercise prompt-manager-only access'
  });
  if (revoked.error) throw revoked.error;
  return player;
}

async function createAdministrator() {
  const player = await createTestPlayer('prompt-registry-admin');
  const bootstrap = await player.admin.rpc('npc_bootstrap_admin', { p_user: player.userId });
  if (bootstrap.error) throw bootstrap.error;
  return player;
}

async function signIn(page: Page, player: Awaited<ReturnType<typeof createTestPlayer>>) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(player.email);
  await page.getByLabel('Password').fill(player.password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await expect(page).toHaveURL(/\/garden$/);
}

test('a prompt manager sees all registered prompts, their workflow outline, and can stage a candidate without a model call', async ({ page }) => {
  const player = await createPromptManager();
  try {
    await signIn(page, player);
    await page.getByLabel('Keeper menu').click();
    await expect(page.getByRole('link', { name: 'Prompt registry' })).toBeVisible();
    await page.getByRole('link', { name: 'Prompt registry' }).click();
    await expect(page).toHaveURL(/\/admin\/prompts/);
    await expect(page.getByRole('heading', { name: 'Prompt registry' })).toBeVisible();
    await expect(page.locator('.prompt-list a')).toHaveCount(26);
    await expect(page.locator('.prompt-list')).toContainText('dialogue.investigate');
    await expect(page.locator('.prompt-list')).toContainText('image.runtime_art');
    await expect(page.getByText('Authoritative workflow sequence')).toBeVisible();
    await expect(page.locator('.prompt-workflow-outline')).toContainText('Dialogue investigation');
    await expect(page.getByText('Code-owned boundary:')).toBeVisible();

    await page.getByRole('button', { name: 'Create revision' }).click();
    // Parallel browser projects share the prototype database. Keep this
    // immutable candidate body unique so the registry's content-hash
    // deduplication remains part of the test environment rather than a race.
    await page.getByLabel('Complete prompt body').fill(`Interpret the supplied keeper message using only bounded evidence. Do not invent world facts. Fixture ${player.userId}.`);
    await page.getByLabel('Change note').fill('Exercise the immutable candidate and release-tray path without dispatching any model work.');
    await page.getByRole('button', { name: 'Create candidate revision' }).click();
    await expect(page.locator('.community-notice')).toContainText('Candidate revision created');
    await expect(page.locator('.prompt-staged-list')).toContainText('dialogue.investigate');
    await expect(page.locator('.prompt-release-tray')).toContainText('Expected active release');
    await expect(page.locator('.prompt-execution-ledger')).toContainText('This ledger excludes prompt text');
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('administrators retain prompt-registry access while an ordinary keeper receives no prompt disclosure', async ({ page, browser }) => {
  const admin = await createAdministrator();
  const ordinary = await createTestPlayer('prompt-registry-ordinary');
  try {
    await signIn(page, admin);
    await page.goto('/admin/prompts');
    await expect(page.getByRole('heading', { name: 'Prompt registry' })).toBeVisible();
    await expect(page.locator('.prompt-list a')).toHaveCount(26);

    const context = await browser.newContext();
    try {
      const other = await context.newPage();
      await signIn(other, ordinary);
      await other.goto('/admin/prompts');
      await expect(other.getByText('This workspace requires community access.')).toBeVisible();
      await expect(other.getByText('Dialogue investigation')).toHaveCount(0);
      await expect(other.getByText('dialogue.investigate')).toHaveCount(0);
      await expect(other.getByText('You are part of a fictional tavern game.')).toHaveCount(0);
      await expect(other.getByText('Prompt registry')).toHaveCount(0);
    } finally {
      await context.close();
    }
  } finally {
    await admin.admin.auth.admin.deleteUser(admin.userId);
    await ordinary.admin.auth.admin.deleteUser(ordinary.userId);
  }
});
