import { afterEach, describe, expect, it } from 'vitest';
import { createTestPlayer } from '../helpers/local-supabase';
import { createBakedTavern } from '../helpers/baked-tavern';
import { getSnapshot } from '../../src/lib/server/game';

type Player = Awaited<ReturnType<typeof createTestPlayer>>;
const players: Player[] = [];

afterEach(async () => {
  await Promise.all(players.splice(0).map(({ admin, userId }) => admin.auth.admin.deleteUser(userId)));
});

async function tavern(prefix: string) {
  const player = await createTestPlayer(prefix);
  players.push(player);
  const created = await player.client.rpc('create_tavern');
  if (created.error) throw created.error;
  const snapshot = await getSnapshot(player.client);
  if (!snapshot) throw new Error('Expected tavern snapshot.');
  return { ...player, saveId: snapshot.save.id, snapshot };
}

async function fund(player: Player, saveId: string) {
  const result = await (player.admin as any).from('tavern_saves').update({ gold: 100 }).eq('id', saveId);
  if (result.error) throw result.error;
}

async function gardenCommand(player: Player, saveId: string, revision: number, commandKind: 'purchase' | 'plant', payload: object) {
  const result = await (player.client.rpc as any)('garden_command', {
    p_save_id: saveId,
    p_action_id: crypto.randomUUID(),
    p_expected_revision: revision,
    p_command_kind: commandKind,
    p_payload: payload
  });
  if (result.error) throw result.error;
  return result.data;
}

async function mature(player: Player, saveId: string, cellId: string) {
  const plant = await (player.admin as any).from('garden_plants')
    .update({ lifecycle: 'mature', growth_progress: 100, ready_since_day: 1 })
    .eq('save_id', saveId).eq('cell_id', cellId);
  if (plant.error) throw plant.error;
}

function deck(value: unknown) {
  const result = (value && typeof value === 'object' && 'dailyDeck' in value
    ? (value as { dailyDeck: unknown }).dailyDeck
    : value) as {
    phase: string;
    cards: Array<{ id: string; kind: string; cardKey?: string }>;
    pending: { additions: number; removals: string[] };
    provisions?: { potionOfForgetfulness: number };
  };
  if (!result || !Array.isArray(result.cards) || !result.pending) throw new Error('Expected daily deck state.');
  return result;
}

async function settleMorning(player: Player, saveId: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const status = await (player.client.rpc as any)('world_settlement_status', { p_save_id: saveId });
    if (status.error) throw status.error;
    if (status.data.status === 'completed') return;
    const claim = await (player.admin.rpc as any)('world_settlement_claim', { p_settlement_id: status.data.id });
    if (claim.error) throw claim.error;
    if (claim.data.status === 'completed') return;
    const completed = await (player.admin.rpc as any)('world_settlement_safe_result', {
      p_settlement_id: status.data.id, p_job_id: claim.data.jobId, p_fence: claim.data.fence,
      p_kind: 'skipped', p_public_digest: 'Focused acquisition fixture settled this morning.'
    });
    if (completed.error) throw completed.error;
  }
  throw new Error('Settlement did not complete.');
}

describe('issue #39 social garden acquisition', () => {
  it('buys, plants, and harvests a Charm seed during preparation, then activates exactly one copy tomorrow', async () => {
    const player = await tavern('issue39-prep-seed');
    await fund(player, player.saveId);
    const empty = player.snapshot.cells.find((cell) => cell.kind === 'empty')!;
    await gardenCommand(player, player.saveId, 0, 'purchase', { itemKey: 'seed_charm_bloom', quantity: 1 });
    await gardenCommand(player, player.saveId, 1, 'plant', { cellId: empty.id, seedItemKey: 'seed_charm_bloom' });
    await mature(player, player.saveId, empty.id);

    const harvested = await player.client.rpc('harvest_crop', {
      p_save_id: player.saveId, p_cell_id: empty.id, p_action_id: crypto.randomUUID(), p_expected_revision: 2
    });
    expect(harvested.error).toBeNull();
    expect(harvested.data).toMatchObject({ scheduledSocialCardKey: 'charm', socialCardEffectiveDay: 2 });

    const opened = await (player.client.rpc as any)('daily_deck_open', { p_expected_revision: 3 });
    expect(opened.error).toBeNull();
    const openedDeck = deck(opened.data);
    expect(openedDeck.cards.filter((card) => card.kind === 'social')).toHaveLength(6);

    const closed = await (player.client.rpc as any)('daily_deck_close', { p_expected_revision: 4 });
    expect(closed.error).toBeNull();
    const advanced = await (player.client.rpc as any)('advance_tavern_day', {
      p_save_id: player.saveId, p_action_id: crypto.randomUUID(), p_expected_revision: 5
    });
    expect(advanced.error).toBeNull();
    await settleMorning(player, player.saveId);
    const tomorrow = await getSnapshot(player.client);
    const nextOpen = await (player.client.rpc as any)('daily_deck_open', { p_expected_revision: tomorrow!.save.revision });
    expect(nextOpen.error).toBeNull();
    const nextDeck = deck(nextOpen.data);
    expect(nextDeck.cards.filter((card) => card.kind === 'social' && card.cardKey === 'charm')).toHaveLength(3);
    expect(nextDeck.pending.additions).toBe(0);
  });

  it('keeps garden and shop available in service, while ordinary harvests never schedule social cards', async () => {
    const player = await tavern('issue39-service-seed');
    await fund(player, player.saveId);
    const opened = await (player.client.rpc as any)('daily_deck_open', { p_expected_revision: 0 });
    expect(opened.error).toBeNull();
    const empty = player.snapshot.cells.find((cell) => cell.kind === 'empty')!;
    await gardenCommand(player, player.saveId, 1, 'purchase', { itemKey: 'seed_rumor_thyme', quantity: 1 });
    await gardenCommand(player, player.saveId, 2, 'plant', { cellId: empty.id, seedItemKey: 'seed_rumor_thyme' });
    await mature(player, player.saveId, empty.id);
    const socialHarvest = await player.client.rpc('harvest_crop', {
      p_save_id: player.saveId, p_cell_id: empty.id, p_action_id: crypto.randomUUID(), p_expected_revision: 3
    });
    expect(socialHarvest.error).toBeNull();
    expect(socialHarvest.data).toMatchObject({ scheduledSocialCardKey: 'rumor' });

    const ordinary = player.snapshot.cells.find((cell) => cell.kind === 'plant')!;
    await mature(player, player.saveId, ordinary.id);
    const ordinaryHarvest = await player.client.rpc('harvest_crop', {
      p_save_id: player.saveId, p_cell_id: ordinary.id, p_action_id: crypto.randomUUID(), p_expected_revision: 4
    });
    expect(ordinaryHarvest.error).toBeNull();
    expect(ordinaryHarvest.data).not.toHaveProperty('scheduledSocialCardKey');

    const state = deck((await (player.client.rpc as any)('daily_deck_state')).data);
    expect(state.phase).toBe('service');
    expect(state.pending.additions).toBe(1);
    expect(state.cards.filter((card) => card.kind === 'social')).toHaveLength(6);
  });

  it('purchases one forgetfulness provision once and schedules its selected social copy for tomorrow', async () => {
    const player = await tavern('issue39-potion-provision');
    await fund(player, player.saveId);
    const actionId = crypto.randomUUID();
    const purchased = await (player.client.rpc as any)('daily_deck_purchase_provision', {
      p_expected_revision: 0, p_action_id: actionId
    });
    expect(purchased.error).toBeNull();
    expect(purchased.data).toMatchObject({ actionId, provisionKey: 'potion_of_forgetfulness', quantity: 1, price: 12, gold: 88 });
    const replay = await (player.client.rpc as any)('daily_deck_purchase_provision', {
      p_expected_revision: 0, p_action_id: actionId
    });
    expect(replay.data).toEqual(purchased.data);

    const opened = await (player.client.rpc as any)('daily_deck_open', { p_expected_revision: 1 });
    expect(opened.error).toBeNull();
    const openedDeck = deck(opened.data);
    const selected = openedDeck.cards.find((card) => card.kind === 'social')!;
    const used = await (player.client.rpc as any)('daily_deck_use_forgetfulness', {
      p_expected_revision: 2, p_card_id: selected.id, p_action_id: crypto.randomUUID()
    });
    expect(used.error).toBeNull();
    const usedDeck = deck(used.data);
    expect(usedDeck.pending.removals).toContain(selected.id);
    expect(usedDeck.provisions?.potionOfForgetfulness).toBe(0);
  });

  it('finishing an ordinary bakery craft creates serving stock without any social-card reward', async () => {
    const player = await createBakedTavern('issue39-bake-no-social');
    players.push(player);
    const snapshot = await getSnapshot(player.client);
    expect(snapshot?.bakery.foods).toHaveLength(1);
    const food = snapshot!.bakery.foods[0];
    expect(snapshot!.bakery.intentCards.filter((card) => card.sourceFoodId === food.id)).toEqual([]);
    const storedCards = await (player.admin as any).from('intent_cards')
      .select('id', { count: 'exact', head: true }).eq('source_food_id', food.id);
    expect(storedCards.error).toBeNull();
    expect(storedCards.count).toBe(0);
  });
});
