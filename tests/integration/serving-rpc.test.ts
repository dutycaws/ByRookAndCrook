import { afterEach, describe, expect, it } from 'vitest';
import { createBrewedTavern } from '../helpers/brewed-tavern';
import { parseBarSnapshot, parseServeReceipt } from '../../src/lib/game/serving';

type Fixture = Awaited<ReturnType<typeof createBrewedTavern>> & { legacyCardId: string };
const players: Fixture[] = [];
afterEach(async () => {
  await Promise.all(players.splice(0).map(({ admin, userId }) => admin.auth.admin.deleteUser(userId)));
});

async function fixture(): Promise<Fixture> {
  const player = await createBrewedTavern('serving');
  const legacy = await player.admin.from('social_cards').insert({
    save_id: player.saveId,
    source_beverage_id: player.brew.beverageId,
    card_key: 'pour-ale',
    display_name: 'Pour Ale',
    tier: 'exceptional',
    relationship_gain: 10,
    gold_multiplier: 2
  }).select('id').single();
  if (legacy.error) throw legacy.error;
  const result = { ...player, legacyCardId: legacy.data.id };
  players.push(result);
  return result;
}

function command(player: Fixture) {
  return {
    p_save_id: player.saveId,
    p_item_kind: 'beverage',
    p_item_id: player.brew.beverageId,
    p_patron_key: 'lira',
    p_legacy_card_id: player.legacyCardId,
    p_action_id: crypto.randomUUID(),
    p_expected_revision: 3
  };
}

describe('patron hospitality RPC', () => {
  it('serves typed food once through the same receipt and availability contract', async () => {
    const player = await fixture();
    const inserted = await player.admin.from('foods').insert({
      save_id: player.saveId,
      name: 'Test hearth loaf',
      recipe_key: 'hearth-loaf',
      quality_index: 4,
      day_number: 1,
      source_action_id: crypto.randomUUID()
    }).select('id').single();
    if (inserted.error) throw inserted.error;
    const input = {
      p_save_id: player.saveId,
      p_patron_key: 'lira',
      p_item_kind: 'food',
      p_item_id: inserted.data.id,
      p_action_id: crypto.randomUUID(),
      p_expected_revision: 3
    };
    const served = await player.client.rpc('serve_hospitality', input);
    expect(served.error).toBeNull();
    expect(parseServeReceipt(served.data!)).toMatchObject({
      itemKind: 'food', itemId: inserted.data.id, foodId: inserted.data.id,
      beverageId: null, goldEarned: 18, committedRevision: 4
    });
    const after = parseBarSnapshot((await player.client.rpc('get_bar_snapshot')).data)!;
    expect(after.foods).toHaveLength(0);
    expect(after.beverages).toHaveLength(1);
    expect(after.history).toHaveLength(1);
    expect((await player.client.rpc('serve_hospitality', {
      ...input, p_action_id: crypto.randomUUID(), p_expected_revision: 4
    })).error?.code).toBe('PT409');
  });

  it('replays parallel identical servings exactly once with gold, legacy entitlement use, and history', async () => {
    const player = await fixture();
    const initial = parseBarSnapshot((await player.client.rpc('get_bar_snapshot')).data)!;
    expect(initial.save.gold).toBe(0);
    expect(initial.patrons).toHaveLength(2);
    expect(initial.legacyCards).toHaveLength(1);
    const input = command(player);
    const results = await Promise.all([
      player.client.rpc('serve_hospitality', input),
      player.client.rpc('serve_hospitality', input)
    ]);
    for (const result of results) expect(result.error).toBeNull();
    expect(results[0].data).toEqual(results[1].data);
    expect(parseServeReceipt(results[0].data!)).toMatchObject({
      itemKind: 'beverage', goldEarned: 90, relationship: 61, arcProgress: 0, committedRevision: 4
    });
    const after = parseBarSnapshot((await player.client.rpc('get_bar_snapshot')).data)!;
    expect(after.save).toMatchObject({ gold: 90, revision: 4 });
    expect(after.beverages).toHaveLength(0);
    expect(after.legacyCards).toHaveLength(0);
    expect(after.history).toHaveLength(1);
    const changed = await player.client.rpc('serve_hospitality', { ...input, p_patron_key: 'torvin' });
    expect(changed.error?.code).toBe('PT409');
  });

  it('serializes legacy and v2 commands competing for the same bottle', async () => {
    const player = await fixture();
    const modern = { ...command(player), p_legacy_card_id: undefined };
    const legacy = {
      p_save_id: player.saveId,
      p_beverage_id: player.brew.beverageId,
      p_patron_key: 'torvin',
      p_card_id: undefined,
      p_action_id: crypto.randomUUID(),
      p_expected_revision: 3
    };
    const results = await Promise.all([
      player.client.rpc('serve_hospitality', modern),
      player.client.rpc('serve_beverage', legacy)
    ]);
    expect(results.filter(({ error }) => !error)).toHaveLength(1);
    expect(results.find(({ error }) => error)?.error?.code).toBe('PT409');
    const after = parseBarSnapshot((await player.client.rpc('get_bar_snapshot')).data)!;
    expect([40, 45]).toContain(after.save.gold);
    expect(after.legacyCards).toHaveLength(1);
    expect(after.history).toHaveLength(1);
  });

  it('rejects foreign items, entitlements, saves, and direct ledger writes', async () => {
    const owner = await fixture();
    const stranger = await fixture();
    const input = command(owner);
    expect((await stranger.client.rpc('serve_hospitality', input)).error?.code).toBe('PT404');
    expect((await owner.client.rpc('serve_hospitality', { ...input, p_item_id: stranger.brew.beverageId })).error?.code).toBe('PT404');
    expect((await owner.client.rpc('serve_hospitality', { ...input, p_legacy_card_id: stranger.legacyCardId })).error?.code).toBe('PT404');
    const own = parseBarSnapshot((await owner.client.rpc('get_bar_snapshot')).data)!;
    expect(own.save.gold).toBe(0);
    expect(own.beverages).toHaveLength(1);
    expect((await stranger.client.from('hospitality_events').select('*').eq('save_id', owner.saveId)).data).toEqual([]);
    expect((await owner.client.from('tavern_saves').update({ gold: 9999 }).eq('id', owner.saveId)).error).not.toBeNull();
    expect((await owner.client.from('patron_states').upsert({ save_id: owner.saveId, patron_key: 'lira', relationship: 100 })).error).not.toBeNull();
  });
});
