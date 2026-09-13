import { expect, test, type Page } from '@playwright/test';
import { createTestPlayer } from '../helpers/local-supabase';
import { createNpcSheet } from '../../src/lib/game/community-npc-ui';
import type { Json } from '../../src/lib/database.types';

/**
 * The authoring form is a server action, so a browser route cannot replace its
 * server-only provider dependency. These helpers use the same service-only
 * completion RPC as the worker with fixed output. That gives the UI stable,
 * repeatable provider results without a network credential or model call.
 */
async function createAuthor() {
  const player = await createTestPlayer('community-authoring');
  const bootstrap = await player.admin.rpc('npc_bootstrap_admin', { p_user: player.userId });
  if (bootstrap.error) throw bootstrap.error;
  const profile = await player.client.rpc('npc_update_profile', {
    p_display_name: `Author ${player.userId.slice(0, 8)}`,
    p_bio: 'A local creator workspace browser test profile.',
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

async function signIn(page: Page, player: Awaited<ReturnType<typeof createAuthor>>) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(player.email);
  await page.getByLabel('Password').fill(player.password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await expect(page).toHaveURL(/\/garden$/);
}

async function createDraft(player: Awaited<ReturnType<typeof createAuthor>>, name: string) {
  const created = await player.client.rpc('npc_author_create', { p_sheet: createNpcSheet(name) as unknown as Json });
  if (created.error) throw created.error;
  const npcId = (created.data as { npcId?: string }).npcId;
  if (!npcId) throw new Error('Authoring fixture did not return an NPC id.');
  return npcId;
}

async function workspace(player: Awaited<ReturnType<typeof createAuthor>>, npcId: string) {
  const result = await player.client.rpc('npc_author_workspace_detail', { p_npc_id: npcId });
  if (result.error) throw result.error;
  return result.data as unknown as { draft: { sheet: { identity: Record<string, string> } } };
}

async function completeAssistanceFixture(player: Awaited<ReturnType<typeof createAuthor>>, npcId: string, revision: number) {
  const requested = await player.client.rpc('npc_author_request_assistance', {
    p_npc_id: npcId,
    p_expected_revision: revision,
    p_section_path: 'identity',
    p_instruction: 'Make the voice more cautious while preserving the character’s values.'
  });
  if (requested.error) throw requested.error;
  const detail = await workspace(player, npcId);
  const identity = detail.draft.sheet.identity;
  const completed = await player.admin.rpc('npc_author_assistance_complete', {
    p_job_id: (requested.data as { jobId: string }).jobId,
    p_proposal: {
      replacement: {
        ...identity,
        voice: 'Speaks with measured care, naming uncertainty before making a promise and never inventing a delivery.'
      },
      explanation: 'This keeps the courier practical while making uncertainty and boundaries easier to hear in play.'
    } as unknown as Json
  });
  if (completed.error) throw completed.error;
}

async function sendSandboxFixture(player: Awaited<ReturnType<typeof createAuthor>>, sandboxId: string, message: string, reply: string) {
  const sent = await player.client.rpc('npc_author_sandbox_send', { p_sandbox_id: sandboxId, p_message: message });
  if (sent.error) throw sent.error;
  const completed = await player.admin.rpc('npc_author_sandbox_complete', {
    p_job_id: (sent.data as { jobId: string }).jobId,
    p_reply: reply
  });
  if (completed.error) throw completed.error;
}

test('guided authoring saves a readable world and story arc across reloads', async ({ page }) => {
  const player = await createAuthor();
  const name = `Mara Quill ${crypto.randomUUID().slice(0, 6)}`;
  try {
    await signIn(page, player);
    await page.goto('/authoring/npcs');
    await page.getByLabel('New NPC name').fill(name);
    await page.getByRole('button', { name: 'Create an NPC draft' }).click();
    await expect(page).toHaveURL(/\/authoring\/npcs\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

    const world = page.locator('.guided-section').filter({ hasText: 'Their world and what they reveal' });
    await world.getByRole('button', { name: /Their world and what they reveal/ }).click();
    await world.getByRole('button', { name: 'Add detail' }).click();
    await world.getByLabel('Name').fill('The Lantern Archive');
    await world.getByLabel('Description').fill('A quiet archive where old delivery routes and weather logs are kept by patient clerks.');
    await expect(page.locator('.autosave-status')).toHaveText('Saving…');
    await expect(page.locator('.autosave-status')).toHaveText('Saved');
    await page.reload();

    await world.getByRole('button', { name: /Their world and what they reveal/ }).click();
    await expect(world.getByLabel('Name')).toHaveValue('The Lantern Archive');
    await expect(page.getByRole('button', { name: /Their story arc/ })).toBeVisible();
    await expect(page.getByText('Chapter 1', { exact: true })).toBeVisible();
    const textareasAreGuided = await page.locator('textarea').evaluateAll((fields) => fields.every((field) => !(field as HTMLTextAreaElement).value.trim().startsWith('[')));
    expect(textareasAreGuided).toBe(true);
    await expect(page.locator('input[type="hidden"][name="entities"]')).toHaveCount(1);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('fixture assistance and a draft-pinned sandbox persist, then become preserved after an applied revision', async ({ page }) => {
  const player = await createAuthor();
  try {
    const npcId = await createDraft(player, `Fixture Courier ${crypto.randomUUID().slice(0, 6)}`);
    await completeAssistanceFixture(player, npcId, 0);

    const started = await player.client.rpc('npc_author_sandbox_start', { p_npc_id: npcId, p_expected_revision: 0 });
    if (started.error) throw started.error;
    const sandboxId = (started.data as { sandboxId: string }).sandboxId;
    await sendSandboxFixture(player, sandboxId, 'How are preparations going?', 'I have checked the road markers twice; the fog still hides the eastern turn.');
    await sendSandboxFixture(player, sandboxId, 'What would help?', 'A dry map and a promise not to rush the crossing would help more than bravado.');

    await signIn(page, player);
    await page.goto(`/authoring/npcs/${npcId}`);
    await expect(page.getByRole('heading', { name: 'Suggestion ready' })).toBeVisible();
    await expect(page.locator('.assistance-comparison strong').filter({ hasText: 'Current' }).first()).toBeVisible();
    await expect(page.locator('.assistance-comparison strong').filter({ hasText: 'Suggested' }).first()).toBeVisible();
    await expect(page.locator('.sandbox-transcript')).toContainText('How are preparations going?');
    await expect(page.locator('.sandbox-transcript')).toContainText('A dry map and a promise not to rush the crossing');
    await page.reload();
    await expect(page.locator('.sandbox-transcript article')).toHaveCount(4);

    await page.getByRole('button', { name: 'Apply suggestion' }).click();
    await expect(page.locator('main > .community-notice')).toHaveText('Suggestion applied to the draft.');
    await expect(page.getByText('Earlier conversations are preserved')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Suggestion applied' })).toBeVisible();
    await expect(page.getByText('Earlier sandbox transcripts (1)')).toBeVisible();
    await expect(page.locator('.preserved-sandboxes')).toContainText('A dry map and a promise not to rush the crossing');
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('submission history and a governed retirement request survive reload', async ({ page }) => {
  const player = await createAuthor();
  try {
    const npcId = await createDraft(player, `Reviewable Courier ${crypto.randomUUID().slice(0, 6)}`);
    const scene = await player.client.rpc('npc_author_add_scene', {
      p_npc_id: npcId,
      p_storage_key: 'community-npcs/authoring-fixture.webp',
      p_alt_text: 'A lantern-lit courier table prepared for authoring review.',
      p_generation: { provider: 'e2e-fixture' } as unknown as Json
    });
    if (scene.error) throw scene.error;

    await signIn(page, player);
    await page.goto(`/authoring/npcs/${npcId}`);
    await page.getByRole('button', { name: 'Submit version 1' }).click();
    await expect(page.locator('main > .community-notice')).toContainText('Version 1 submitted');
    await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
    await page.getByLabel('Why should this NPC be retired?').fill('This prototype courier is being replaced by a more focused community character.');
    await page.getByRole('button', { name: 'Request retirement review' }).click();
    await expect(page.locator('main > .community-notice')).toHaveText('Retirement request submitted for review.');
    await page.reload();
    await expect(page.getByText('Pending review', { exact: true })).toBeVisible();
    await expect(page.getByText('This prototype courier is being replaced by a more focused community character.')).toBeVisible();
    await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
