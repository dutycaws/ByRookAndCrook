import { expect, test, type Page } from '@playwright/test';
import { createTestPlayer } from '../helpers/local-supabase';
import { runDialogue } from '../../src/lib/server/dialogue/orchestrator';
import { fixtureProvider } from '../helpers/dialogue-provider';
import { fixturePromptRegistry } from '../helpers/prompt-registry-fixture';
import { fallbackPlayerSuggestions, type SuggestionBatchContext } from '../../src/lib/server/dialogue/player-suggestions';

const promptRegistry = fixturePromptRegistry();

test.setTimeout(45_000);

function residents(page: Page) { return page.getByRole('group', { name: 'Scene characters' }).getByRole('button'); }
function hand(page: Page) { return page.locator('.workflow-hand [data-workflow-choice]'); }

async function prepareDailyDeck(player: Awaited<ReturnType<typeof createTestPlayer>>) {
  const snapshot = await player.client.rpc('get_tavern_snapshot');
  expect(snapshot.error).toBeNull();
  const opened = await (player.client.rpc as any)('daily_deck_open', { p_expected_revision: (snapshot.data as any).save.revision });
  expect(opened.error).toBeNull();
  const generationId = (opened.data as any).dailyDeck.generationId as string;
  const claimed = await (player.client.rpc as any)('player_suggestion_batch_claim', { p_generation_id: generationId });
  expect(claimed.error).toBeNull();
  const context = (claimed.data as any).batch as SuggestionBatchContext;
  expect((claimed.data as any).claimed).toBe(true);
  const saved = await (player.client.rpc as any)('player_suggestion_batch_upsert', {
    p_generation_id: generationId, p_status: 'fallback', p_suggestions: fallbackPlayerSuggestions(context)
  });
  expect(saved.error).toBeNull();
  return generationId;
}

async function signInAndOpen(page: Page, player: Awaited<ReturnType<typeof createTestPlayer>>, alreadyOpen = false) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(player.email);
  await page.getByLabel('Password').fill(player.password);
  await page.getByRole('button', { name: 'Open the ledger' }).click();
  await expect(page).toHaveURL(/\/garden$/);
  await page.goto('/bar');
  await expect(page.locator('[data-area-scene="bar"]')).toHaveAttribute('data-scene-ready', 'true');
  if (!alreadyOpen) {
    await page.getByRole('button', { name: 'Open the tavern', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open the tavern', exact: true })).toHaveCount(0);
  }
}

async function openFirstCard(page: Page) {
  await residents(page).first().click();
  await page.getByRole('button', { name: 'Talk', exact: true }).click();
  await expect(hand(page)).toHaveCount(5);
  await hand(page).first().click();
  const composer = page.getByRole('textbox');
  await expect(composer).toBeVisible();
  await expect(composer).not.toHaveValue('');
  return composer;
}

test('persisted daily suggestions preview across physical-card switching and reload', async ({ page }) => {
  const player = await createTestPlayer('issue39-suggestions');
  try {
    const created = await player.client.rpc('create_tavern');
    expect(created.error).toBeNull();
    const generationId = await prepareDailyDeck(player);
    await signInAndOpen(page, player, true);

    const firstGuest = residents(page).first();
    const firstGuestActor = await firstGuest.getAttribute('data-scene-actor');
    expect(firstGuestActor).toMatch(/^patron:/);
    const composer = await openFirstCard(page);
    const firstSuggestion = await composer.inputValue();
    const firstDraft = `${firstSuggestion} I mean every word.`;
    await composer.fill(firstDraft);
    await expect(page.getByText('This exact editable line will be submitted when you confirm.')).toBeVisible();

    await page.getByRole('button', { name: 'Close conversation', exact: true }).click();
    await hand(page).nth(1).click();
    await expect(composer).not.toHaveValue('');
    await page.getByRole('button', { name: 'Close conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Resident actions' }).click();
    await page.getByRole('button', { name: 'Return to room' }).click();
    await expect(residents(page)).toHaveCount(2);

    const secondGuest = residents(page).nth(1);
    const secondGuestActor = await secondGuest.getAttribute('data-scene-actor');
    expect(secondGuestActor).toMatch(/^patron:/);
    const secondGuestId = secondGuestActor!.slice('patron:'.length);

    // Focus/Enter proves selection independently of the actor artwork hitbox.
    await secondGuest.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-scene-actor="${secondGuestActor}"]`)).toHaveAttribute('aria-pressed', 'true');

    const persisted = await (await page.request.get(`/api/dialogue/suggestions/${generationId}`)).json();
    const secondGuestRows = persisted.suggestions.filter((row: { npcId: string }) => row.npcId === secondGuestId);
    expect(secondGuestRows).not.toHaveLength(0);

    await expect(page.getByRole('button', { name: 'Talk', exact: true })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Talk', exact: true }).click();
    await expect(hand(page)).toHaveCount(5, { timeout: 5_000 });
    await hand(page).first().click();
    await expect(composer).toBeVisible({ timeout: 5_000 });
    const secondGuestSuggestion = await composer.inputValue();
    expect(secondGuestRows.some((row: { text: string }) => row.text === secondGuestSuggestion)).toBe(true);

    await page.getByRole('button', { name: 'Close conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Resident actions' }).click();
    await page.getByRole('button', { name: 'Return to room' }).click();
    const firstGuestAgain = page.locator(`[data-scene-actor="${firstGuestActor}"]`);
    await firstGuestAgain.focus();
    await page.keyboard.press('Enter');
    await expect(firstGuestAgain).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Talk', exact: true }).click();
    await hand(page).first().click();
    await expect(composer).toHaveValue(firstDraft);

    await page.reload();
    await expect(residents(page)).toHaveCount(2);
    await expect(firstGuestAgain).toHaveAttribute('aria-disabled', 'false');
    await firstGuestAgain.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Talk', exact: true }).click();
    await hand(page).first().click();
    await expect(composer).toHaveValue(firstDraft);
    const reloaded = await (await page.request.get(`/api/dialogue/suggestions/${generationId}`)).json();
    expect(reloaded.suggestions).toEqual(persisted.suggestions);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('an edited suggested line submits its exact words and spends one physical card', async ({ page }) => {
  const player = await createTestPlayer('issue39-suggestion-submit');
  const submitted: string[] = [];
  try {
    expect((await player.client.rpc('create_tavern')).error).toBeNull();
    await prepareDailyDeck(player);
    await signInAndOpen(page, player, true);
    const composer = await openFirstCard(page);
    await page.route('**/api/dialogue', async route => {
      const input = route.request().postDataJSON();
      submitted.push(input.message);
      const result = await runDialogue(player.admin, player.userId, input, fixtureProvider(), { promptRegistry });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    });
    const exactWords = 'I brought my own careful words, exactly as written.';
    await composer.fill(exactWords);
    await page.locator('button.composer-send').click();
    expect(submitted).toEqual([exactWords]);
    await expect(hand(page)).toHaveCount(4);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});

test('a technical dialogue failure retains the selected physical daily card', async ({ page }) => {
  const player = await createTestPlayer('issue39-suggestion-failure');
  try {
    const created = await player.client.rpc('create_tavern');
    expect(created.error).toBeNull();
    await prepareDailyDeck(player);
    await signInAndOpen(page, player, true);
    const composer = await openFirstCard(page);
    await composer.fill('This failed request must not spend the physical card.');
    await page.route('**/api/dialogue', route => route.abort('failed'));
    await page.locator('button.composer-send').click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.reload();
    await residents(page).first().click();
    await page.getByRole('button', { name: 'Talk', exact: true }).click();
    await expect(hand(page)).toHaveCount(5);
  } finally {
    await player.admin.auth.admin.deleteUser(player.userId);
  }
});
