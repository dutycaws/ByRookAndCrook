import { expect, test } from '@playwright/test';
import { createTestPlayer } from '../helpers/local-supabase';
import { runDialogue } from '../../src/lib/server/dialogue/orchestrator';
import { fixtureProvider } from '../helpers/dialogue-provider';
import { fixturePromptRegistry } from '../helpers/prompt-registry-fixture';

const promptRegistry = fixturePromptRegistry();

type Player = Awaited<ReturnType<typeof createTestPlayer>>;
type RepairState = { offenseDay: number; distinctFollowThroughDays: number; requiredDays: number };
type Resident = { name: string; instanceId: string; relationship: number; relationshipRepair?: RepairState };
type BarSnapshot = { save: { id: string; currentDay: number }; roster: Resident[] };

function relationshipProvider(reaction: -1 | 1) {
  const provider = fixtureProvider();
  const generate = provider.generate.bind(provider);
  provider.generate = async (stage, payload, signal, prompt) => {
    const output = await generate(stage, payload, signal, prompt);
    if (stage === 'investigate') return { ...output, value: { ...(output.value as any), kind: 'social' } };
    if (stage !== 'deliberate') return output;
    const base = (payload as any).base;
    return {
      ...output,
      value: { ...(output.value as any), stance: 'respond', reaction, subject: 'personal', evidence: base.message, intention: null }
    };
  };
  return provider;
}

async function barSnapshot(player: Player): Promise<BarSnapshot> {
  const result = await player.client.rpc('npc_bar_snapshot');
  expect(result.error).toBeNull();
  return result.data as unknown as BarSnapshot;
}

async function settleDayThroughSupportedClaims(player: Player, saveId: string): Promise<void> {
  const status = await player.client.rpc('world_settlement_status', { p_save_id: saveId });
  expect(status.error).toBeNull();
  const settlementId = (status.data as { id?: string } | null)?.id;
  expect(settlementId).toMatch(/^[0-9a-f-]{36}$/i);

  for (let index = 0; index < 16; index += 1) {
    const claimed = await player.admin.rpc('world_settlement_claim', { p_settlement_id: settlementId! });
    expect(claimed.error).toBeNull();
    const claim = claimed.data as { jobId?: string; fence?: string };
    if (!claim.jobId || !claim.fence) break;
    const completed = await player.admin.rpc('world_settlement_safe_result', {
      p_settlement_id: settlementId!, p_job_id: claim.jobId, p_fence: claim.fence,
      p_kind: 'skipped', p_public_digest: 'The deterministic browser fixture completed this overnight moment.'
    });
    expect(completed.error).toBeNull();
    if (index === 15) throw new Error('The deterministic settlement fixture exceeded its bounded job count.');
  }

  for (let index = 0; index < 12; index += 1) {
    const claimed = await player.admin.rpc('world_quest_transition_claim_next');
    expect(claimed.error).toBeNull();
    const claim = claimed.data as { status?: string; transitionId?: string; fence?: string };
    if (claim.status === 'idle') break;
    if (!claim.transitionId || !claim.fence) throw new Error('Malformed quest-transition claim.');
    const deferred = await player.admin.rpc('world_quest_transition_fail', {
      p_transition_id: claim.transitionId, p_fence: claim.fence, p_failure_code: 'provider_unavailable'
    });
    expect(deferred.error).toBeNull();
    if (index === 11) throw new Error('The deterministic transition fixture exceeded its bounded job count.');
  }

  const completed = await player.client.rpc('world_settlement_status', { p_save_id: saveId });
  expect(completed.error).toBeNull();
  expect((completed.data as { status?: string } | null)?.status).toBe('completed');
}

async function closeDayFromBar(page: import('@playwright/test').Page, player: Player, saveId: string, nextDay: number): Promise<void> {
  await page.getByRole('button', { name: 'Close and begin next day' }).click();
  await expect(page.getByRole('region', { name: 'The night is settling' })).toBeVisible();
  await settleDayThroughSupportedClaims(player, saveId);
  await page.reload();
  await expect(page.getByText(`The common room · Day ${nextDay}`, { exact: true })).toBeVisible();
}

test('apology and praise do not repair trust; two distinct later-day follow-throughs persist through the Bar UI', async ({ page }) => {
  test.setTimeout(120_000);
  const player = await createTestPlayer('relationship-repair-ui');
  let reaction: -1 | 1 = 1;

  try {
    await page.goto('/login');
    await page.getByLabel('Email').fill(player.email);
    await page.getByLabel('Password').fill(player.password);
    await page.getByRole('button', { name: 'Open the ledger' }).click();
    await expect(page).toHaveURL(/\/garden$/);
    await page.getByRole('button', { name: 'Start tavern' }).click();
    await expect(page.getByRole('heading', { name: 'Hex garden' })).toBeVisible();
    await page.goto('/bar');
    const lira = page.getByRole('button', { name: /Speak with Lira Nightwind:/ });
    await lira.click();

    await page.route('**/api/dialogue', async (route) => {
      const result = await runDialogue(
        player.admin, player.userId, route.request().postDataJSON(), relationshipProvider(reaction), { promptRegistry }
      );
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    });

    let completedExchanges = 0;
    const sendFromUi = async (message: string, nextReaction: -1 | 1) => {
      reaction = nextReaction;
      await page.getByLabel('Your message').fill(message);
      await page.getByRole('button', { name: 'Speak', exact: true }).click();
      await expect(page.getByLabel('Your message')).toHaveValue('');
      completedExchanges += 1;
      await expect(page.locator('.npc-exchange')).toHaveCount(completedExchanges);
      return barSnapshot(player);
    };
    const reloadLira = async () => {
      await page.reload();
      await page.getByRole('button', { name: /Speak with Lira Nightwind:/ }).click();
    };

    let snapshot = await sendFromUi('I took the road watch and left your sister behind.', -1);
    let resident = snapshot.roster.find((item) => item.name === 'Lira Nightwind')!;
    const saveId = snapshot.save.id;
    expect(resident.relationship).toBe(43);
    expect(resident.relationshipRepair).toEqual({ offenseDay: 1, distinctFollowThroughDays: 0, requiredDays: 2 });
    await reloadLira();
    const relationship = page.getByRole('region', { name: 'Relationship' });
    await expect(relationship.getByRole('status')).toContainText('Trust was hurt on day 1.');
    await expect(relationship).toContainText('An apology alone does not count.');

    snapshot = await sendFromUi('I’m really sorry for what I said.', 1);
    resident = snapshot.roster.find((item) => item.name === 'Lira Nightwind')!;
    expect(resident.relationship).toBe(43);
    expect(resident.relationshipRepair?.distinctFollowThroughDays).toBe(0);
    await reloadLira();

    snapshot = await sendFromUi('You’re truly the best friend I ever had.', 1);
    resident = snapshot.roster.find((item) => item.name === 'Lira Nightwind')!;
    expect(resident.relationship).toBe(43);
    expect(resident.relationshipRepair?.distinctFollowThroughDays).toBe(0);
    await reloadLira();

    await closeDayFromBar(page, player, saveId, 2);
    await page.getByRole('button', { name: /Speak with Lira Nightwind:/ }).click();
    snapshot = await sendFromUi('Thank you, I brought medicine back and checked the east road warning.', 1);
    resident = snapshot.roster.find((item) => item.name === 'Lira Nightwind')!;
    expect(resident.relationship).toBe(43);
    expect(resident.relationshipRepair).toEqual({ offenseDay: 1, distinctFollowThroughDays: 1, requiredDays: 2 });
    await reloadLira();

    snapshot = await sendFromUi('Thank you, I returned to confirm the watch with the family.', 1);
    resident = snapshot.roster.find((item) => item.name === 'Lira Nightwind')!;
    expect(resident.relationship).toBe(43);
    expect(resident.relationshipRepair?.distinctFollowThroughDays).toBe(1);
    await reloadLira();

    await closeDayFromBar(page, player, saveId, 3);
    await page.getByRole('button', { name: /Speak with Lira Nightwind:/ }).click();
    snapshot = await sendFromUi('Thank you, I checked the road with the injured travelers again.', 1);
    resident = snapshot.roster.find((item) => item.name === 'Lira Nightwind')!;
    expect(resident.relationship).toBe(45);
    expect(resident.relationshipRepair).toBeFalsy();
    await reloadLira();
    await expect(page.getByRole('region', { name: 'Relationship' })).toContainText('acquaintance');
    expect((await barSnapshot(player)).roster.find((item) => item.name === 'Lira Nightwind')?.relationship).toBe(45);
  } finally {
    const deleted = await player.admin.auth.admin.deleteUser(player.userId);
    if (deleted.error && !/database error deleting user/i.test(deleted.error.message)) throw deleted.error;
  }
});
