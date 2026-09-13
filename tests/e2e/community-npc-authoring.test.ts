import { expect, test } from '@playwright/test';
import { createTestPlayer } from '../helpers/local-supabase';

async function createAuthor() {
  const player = await createTestPlayer('community-authoring');
  const bootstrap = await player.admin.rpc('npc_bootstrap_admin', { p_user: player.userId });
  if (bootstrap.error) throw bootstrap.error;
  const profile = await player.client.rpc('npc_update_profile', {
    p_display_name: `Author ${player.userId.slice(0, 8)}`,
    p_bio: 'A local creator workspace test profile.',
    p_mature: false,
    p_attest_adult: false,
    p_creator_terms: true
  });
  if (profile.error) throw profile.error;
  const capability = await player.client.rpc('npc_admin_set_capability', {
    p_user: player.userId,
    p_capability: 'npc_author',
    p_enabled: true,
    p_reason: 'Authoring browser test'
  });
  if (capability.error) throw capability.error;
  return player;
}

async function signIn(page: import('@playwright/test').Page, player: Awaited<ReturnType<typeof createAuthor>>) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(player.email);
  await page.getByLabel('Password').fill(player.password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await expect(page).toHaveURL(/\/garden$/);
}

test('an author creates and autosaves a structured NPC draft without fabricated scene media', async ({ page }) => {
  const player = await createAuthor();
  const name = `Mara Quill ${crypto.randomUUID().slice(0, 6)}`;
  try {
    await signIn(page, player);
    await page.goto('/authoring/npcs');
    await expect(page.getByRole('heading', { name: 'Creator studio' })).toBeVisible();
    await page.getByLabel('New NPC name').fill(name);
    await page.getByRole('button', { name: 'Create an NPC draft' }).click();
    await expect(page).toHaveURL(/\/authoring\/npcs\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

    const descriptionField = page.getByLabel('Short description');
    await expect(descriptionField).toBeEnabled();
    const description = 'A careful courier who remembers every promised delivery.';
    await descriptionField.fill(description);
    await expect(page.locator('.autosave-status')).toHaveText('Saving…');
    await expect(page.getByText('Revision 1 · open')).toBeVisible();
    await expect(page.locator('.autosave-status')).toHaveText('Saved');
    await page.reload();
    await expect(page.getByLabel('Short description')).toHaveValue(description);

    const voice = 'Speaks precisely, with a dry kindness and no invented deliveries.';
    await page.getByLabel('Voice and speech rules').fill(voice);
    await expect(page.locator('.autosave-status')).toHaveText('Saving…');
    await expect(page.getByText('Revision 2 · open')).toBeVisible();
    await expect(page.locator('.autosave-status')).toHaveText('Saved');
    await page.reload();
    await expect(page.getByLabel('Voice and speech rules')).toHaveValue(voice);

    await page.getByLabel('Scene prompt').fill('A candlelit tavern booth with maps and courier satchels.');
    await page.getByRole('button', { name: 'Queue scene' }).click();
    await expect(page.locator('.community-notice')).toContainText('local_scene_asset_missing');
    await expect(page.getByText(/This page never manufactures art/)).toBeVisible();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
