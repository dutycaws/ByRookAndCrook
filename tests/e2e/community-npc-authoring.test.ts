import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
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

async function prepareValidArtwork(player: Awaited<ReturnType<typeof createAuthor>>, npcId: string, revision = 0) {
  const settingId = 'c0370000-0000-4000-8000-000000000001';
  const provider = await player.admin.rpc('npc_author_set_portrait_provider_status', {
    p_available: true,
    p_provider: 'openai',
    p_model: 'deterministic-e2e',
    p_expires_in_seconds: 300
  });
  if (provider.error) throw new Error(`provider status: ${provider.error.message}`);
  const registered = await player.admin.rpc('npc_author_register_setting_asset', {
    p_setting_id: settingId,
    p_storage_key: 'community-settings/lantern-lit-tavern-table.webp',
    p_mime_type: 'image/webp',
    p_width: 1600,
    p_height: 900,
    p_sha256: 'a'.repeat(64)
  });
  if (registered.error) throw new Error(`setting registration: ${registered.error.message}`);
  const setting = await player.client.rpc('npc_author_select_setting', {
    p_npc_id: npcId,
    p_expected_revision: revision,
    p_setting_id: settingId
  });
  if (setting.error) throw new Error(`setting selection: ${setting.error.message}`);
  const settingRevision = Number((setting.data as { revision: number }).revision);
  const requested = await player.client.rpc('npc_author_request_portrait', {
    p_npc_id: npcId,
    p_expected_revision: settingRevision,
    p_controls: {},
    p_alternatives: 1
  });
  if (requested.error) throw new Error(`portrait request: ${requested.error.message}`);
  const receipt = requested.data as { jobId: string; visualInputHash: string; draftRevision: number };
  const mediaId = crypto.randomUUID();
  const completed = await player.admin.rpc('npc_author_portrait_complete', {
    p_job_id: receipt.jobId,
    p_candidates: [{
      ordinal: 1,
      storageKey: `v1/${mediaId}/sprite.webp`,
      masterStorageKey: `v1/${mediaId}/master.png`,
      masterSha256: 'd'.repeat(64),
      referenceSetHash: 'e'.repeat(64),
      requestId: `e2e-${mediaId}`,
      altText: 'A full-body courier in a warm tavern pose.',
      mimeType: 'image/webp',
      width: 1024,
      height: 1536,
      byteSize: 120_000,
      sha256: '1'.repeat(64),
      alphaValid: true,
      visualInputHash: receipt.visualInputHash,
      provider: 'deterministic',
      model: 'fixture',
      promptHash: 'b'.repeat(64),
      styleVersion: 'community-npc-portrait-sprite-v1',
      referenceSetVersion: 'brac-character-look-v1'
    }] as unknown as Json
  });
  if (completed.error) throw new Error(`portrait completion: ${completed.error.message}`);
  const candidate = (completed.data as { candidates: Array<{ assetId?: string }> }).candidates[0];
  if (!candidate?.assetId) throw new Error('Portrait fixture did not return an asset id.');
  const selected = await player.client.rpc('npc_author_select_portrait', {
    p_npc_id: npcId,
    p_expected_revision: receipt.draftRevision,
    p_asset_id: candidate.assetId
  });
  if (selected.error) throw new Error(`portrait selection: ${selected.error.message}`);
  return Number((selected.data as { revision: number }).revision);
}

async function prepareSetting(player: Awaited<ReturnType<typeof createAuthor>>, npcId: string, revision = 0) {
  const settingId = 'c0370000-0000-4000-8000-000000000001';
  const registered = await player.admin.rpc('npc_author_register_setting_asset', {
    p_setting_id: settingId,
    p_storage_key: 'community-settings/lantern-lit-tavern-table.webp',
    p_mime_type: 'image/webp',
    p_width: 1600,
    p_height: 900,
    p_sha256: 'a'.repeat(64)
  });
  if (registered.error) throw new Error(`setting registration: ${registered.error.message}`);
  const selected = await player.client.rpc('npc_author_select_setting', {
    p_npc_id: npcId,
    p_expected_revision: revision,
    p_setting_id: settingId
  });
  if (selected.error) throw new Error(`setting selection: ${selected.error.message}`);
  return Number((selected.data as { revision: number }).revision);
}

async function transparentSpritePng(fill: string) {
  return sharp(Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><circle cx="256" cy="256" r="172" fill="${fill}"/><circle cx="202" cy="220" r="16" fill="#1b120d"/><circle cx="310" cy="220" r="16" fill="#1b120d"/><path d="M170 320 Q256 390 342 320" fill="none" stroke="#1b120d" stroke-width="22" stroke-linecap="round"/></svg>`)).png().toBuffer();
}

async function uploadSprite(page: Page, slot: 'neutral' | 'happy', png: Buffer) {
  const panel = page.locator('#portrait-artwork');
  await panel.getByRole('tab', { name: new RegExp(`^${slot[0].toUpperCase()}${slot.slice(1)}`) }).click();
  const candidates = panel.locator('input[name="candidateId"]');
  const previousCandidateIds = await candidates.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  await panel.getByLabel('PNG sprite').setInputFiles({ name: `${slot}.png`, mimeType: 'image/png', buffer: png });
  await panel.getByRole('button', { name: `Upload ${slot[0].toUpperCase()}${slot.slice(1)}` }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'sprite uploaded for review' })).toBeVisible();
  await expect(candidates).toHaveCount(previousCandidateIds.length + 1);
  const uploadedCandidateId = await candidates.evaluateAll((inputs, priorIds) => inputs
    .map((input) => (input as HTMLInputElement).value)
    .find((candidateId) => !priorIds.includes(candidateId)) ?? null, previousCandidateIds);
  expect(uploadedCandidateId).not.toBeNull();
  const uploadedCandidate = panel.locator(`label.portrait-candidate:has(input[name="candidateId"][value="${uploadedCandidateId}"])`);
  await uploadedCandidate.click();
  await expect(uploadedCandidate.locator('input[name="candidateId"]')).toBeChecked();
}

async function expressionWorkspace(player: Awaited<ReturnType<typeof createAuthor>>, npcId: string) {
  const result = await player.client.rpc('npc_author_expression_sprite_workspace', { p_npc_id: npcId });
  if (result.error) throw result.error;
  return result.data as unknown as {
    selectedBySlot: Record<string, { candidateId: string; assetId: string }>;
    resolvedBySlot: Record<string, { candidateId?: string; assetId: string; fallbackFrom?: string }>;
    candidates: Array<{ id: string; slot: string; staleNeutralAnchor: boolean }>;
  };
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
    const saveStatus = page.getByRole('status', { name: 'Draft save status' });
    await expect(saveStatus).toHaveText('Saved');
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
    await prepareValidArtwork(player, npcId);

    await signIn(page, player);
    await page.goto(`/authoring/npcs/${npcId}`);
    await expect(page.getByRole('heading', { name: 'Character sprites' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'A place to meet' })).toBeVisible();
    await expect(page.getByText('Lantern-lit tavern table', { exact: true })).toBeVisible();
    const settingPreview = page.locator('.setting-preview').first();
    const settingPreviewContent = settingPreview.locator(':scope > img, :scope > .setting-preview-empty');
    await expect(settingPreview).toBeVisible();
    await expect(settingPreviewContent).toHaveCount(1);
    const settingImage = settingPreview.locator(':scope > img');
    if (await settingImage.count()) {
      await expect(settingImage).toHaveAttribute('src', /\S/);
    } else {
      await expect(settingPreview.getByText('Setting preview unavailable', { exact: true })).toBeVisible();
    }
    await expect(page.locator('.portrait-preview.checkerboard')).toBeVisible();
    await expect(page.getByText('Transparency verified')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
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

test('expression sprites keep Neutral authoritative while optional slots fall back, persist, and require stale reconfirmation', async ({ page }) => {
  const player = await createAuthor();
  try {
    const npcId = await createDraft(player, `Sprite Courier ${crypto.randomUUID().slice(0, 6)}`);
    await prepareSetting(player, npcId);
    const neutralOne = await transparentSpritePng('#795548');
    const neutralTwo = await transparentSpritePng('#546e7a');
    const happy = await transparentSpritePng('#ff9800');

    await signIn(page, player);
    await page.goto(`/authoring/npcs/${npcId}`);
    const panel = page.locator('#portrait-artwork');
    await expect(panel.getByRole('tablist', { name: 'Expression sprite slots' }).getByRole('tab')).toHaveCount(6);
    await expect(panel.getByRole('tab', { name: /^Happy/ })).toHaveAttribute('aria-disabled', 'true');

    await uploadSprite(page, 'neutral', neutralOne);
    await expect(panel.getByRole('button', { name: 'Select Neutral' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Select Neutral' }).click();
    await expect(panel.getByRole('status').filter({ hasText: 'Portrait selected for these visual details.' })).toBeVisible();
    await page.reload();
    await expect(panel.getByRole('tab', { name: /^Neutral selected/ })).toBeVisible();
    await expect(panel.locator('.portrait-candidate.selected')).toHaveCount(1);
    await expect(page.locator('.authoring-scene-preview .scene-portrait')).toBeVisible();

    await uploadSprite(page, 'happy', happy);
    await panel.getByRole('button', { name: 'Select Happy' }).click();
    await expect(panel.getByRole('status').filter({ hasText: 'Portrait selected for these visual details.' })).toBeVisible();
    await page.reload();
    await expect(panel.getByRole('tab', { name: /^Happy selected/ })).toBeVisible();
    const afterHappy = await expressionWorkspace(player, npcId);
    expect(afterHappy.selectedBySlot.happy.assetId).toBeTruthy();
    expect(afterHappy.resolvedBySlot.sad.assetId).toBe(afterHappy.selectedBySlot.neutral.assetId);
    expect(afterHappy.resolvedBySlot.sad.fallbackFrom).toBe('neutral');
    await expect(page.locator('.authoring-scene-preview .scene-portrait')).toBeVisible();

    await uploadSprite(page, 'neutral', neutralTwo);
    await expect(panel.getByLabel('I understand changing Neutral clears optional selections.')).toBeVisible();
    await panel.getByLabel('I understand changing Neutral clears optional selections.').check();
    await panel.getByRole('button', { name: 'Select Neutral' }).click();
    await expect(panel.getByRole('status').filter({ hasText: 'Portrait selected for these visual details.' })).toBeVisible();
    await page.reload();
    await expect(panel.getByRole('tab', { name: /^Happy selected/ })).toHaveCount(0);
    await panel.getByRole('tab', { name: /^Happy/ }).click();
    const staleCandidate = panel.locator('label.portrait-candidate.stale');
    await expect(staleCandidate).toHaveCount(1);
    await staleCandidate.click();
    await expect(staleCandidate.locator('input[name="candidateId"]')).toBeChecked();
    await expect(panel.getByRole('button', { name: 'Select Happy' })).toBeDisabled();
    await panel.getByLabel('I reviewed this sprite against the current Neutral anchor.').check();
    await panel.getByRole('button', { name: 'Select Happy' }).click();
    await expect(panel.getByRole('status').filter({ hasText: 'Portrait selected for these visual details.' })).toBeVisible();
    await page.reload();

    const finalWorkspace = await expressionWorkspace(player, npcId);
    expect(finalWorkspace.selectedBySlot.neutral.assetId).not.toBe(afterHappy.selectedBySlot.neutral.assetId);
    expect(finalWorkspace.selectedBySlot.happy.assetId).toBe(afterHappy.selectedBySlot.happy.assetId);
    expect(finalWorkspace.resolvedBySlot.leaving.assetId).toBe(finalWorkspace.selectedBySlot.neutral.assetId);
    expect(finalWorkspace.resolvedBySlot.leaving.fallbackFrom).toBe('neutral');
    await expect(panel.getByRole('tab', { name: /^Happy selected/ })).toBeVisible();
    await expect(page.locator('.authoring-scene-preview .scene-portrait')).toBeVisible();
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
