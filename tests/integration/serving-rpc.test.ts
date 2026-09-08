import { afterEach, describe, expect, it } from 'vitest';
import { createBrewedTavern } from '../helpers/brewed-tavern';
import { parseBarSnapshot, parseServeReceipt } from '../../src/lib/game/serving';

const players: Array<Awaited<ReturnType<typeof createBrewedTavern>>> = [];
afterEach(async () => {
  await Promise.all(players.splice(0).map(({ admin, userId }) => admin.auth.admin.deleteUser(userId)));
});

async function fixture() {
  const player = await createBrewedTavern('serving');
  players.push(player);
  return player;
}

function command(player: Awaited<ReturnType<typeof fixture>>) {
  return { p_save_id: player.saveId, p_beverage_id: player.brew.beverageId, p_patron_key: 'lira',
    p_card_id: player.brew.socialCardId!, p_action_id: crypto.randomUUID(), p_expected_revision: 3 };
}

describe('patron serving RPC', () => {
  it('replays parallel identical pours exactly once with gold, card use, and preserved story history', async () => {
    const player = await fixture();
    const initial = parseBarSnapshot((await player.client.rpc('get_bar_snapshot')).data)!;
    expect(initial.save.gold).toBe(0);
    expect(initial.patrons).toHaveLength(2);
    const input = command(player);
    const results = await Promise.all([player.client.rpc('serve_beverage', input), player.client.rpc('serve_beverage', input)]);
    for (const result of results) expect(result.error).toBeNull();
    expect(results[0].data).toEqual(results[1].data);
    expect(parseServeReceipt(results[0].data!)).toMatchObject({ goldEarned: 90, relationship: 61, arcProgress: 0, committedRevision: 4 });
    const after = parseBarSnapshot((await player.client.rpc('get_bar_snapshot')).data)!;
    expect(after.save).toMatchObject({ gold: 90, revision: 4 });
    expect(after.beverages).toHaveLength(0);
    expect(after.cards).toHaveLength(0);
    expect(after.history).toHaveLength(1);
    const changed = await player.client.rpc('serve_beverage', { ...input, p_patron_key: 'torvin' });
    expect(changed.error?.code).toBe('PT409');
  });

  it('serializes different patrons competing for the same bottle and permits card-free serving', async () => {
    const player = await fixture();
    const input = { ...command(player), p_card_id: undefined };
    const results = await Promise.all([
      player.client.rpc('serve_beverage', input),
      player.client.rpc('serve_beverage', { ...input, p_action_id: crypto.randomUUID(), p_patron_key: 'torvin' })
    ]);
    expect(results.filter(({ error }) => !error)).toHaveLength(1);
    expect(results.find(({ error }) => error)?.error?.code).toBe('PT409');
    const after = parseBarSnapshot((await player.client.rpc('get_bar_snapshot')).data)!;
    expect([40, 45]).toContain(after.save.gold);
    expect(after.cards).toHaveLength(1);
    expect(after.history).toHaveLength(1);
  });

  it('rejects foreign bottles, cards, saves, and direct ledger writes', async () => {
    const owner = await fixture();
    const stranger = await fixture();
    const input = command(owner);
    expect((await stranger.client.rpc('serve_beverage', input)).error?.code).toBe('PT404');
    expect((await owner.client.rpc('serve_beverage', { ...input, p_beverage_id: stranger.brew.beverageId })).error?.code).toBe('PT404');
    expect((await owner.client.rpc('serve_beverage', { ...input, p_card_id: stranger.brew.socialCardId! })).error?.code).toBe('PT404');
    const own = parseBarSnapshot((await owner.client.rpc('get_bar_snapshot')).data)!;
    expect(own.save.gold).toBe(0);
    expect(own.beverages).toHaveLength(1);
    expect((await stranger.client.from('serving_events').select('*').eq('save_id', owner.saveId)).data).toEqual([]);
    expect((await owner.client.from('tavern_saves').update({ gold: 9999 }).eq('id', owner.saveId)).error).not.toBeNull();
    expect((await owner.client.from('patron_states').upsert({ save_id: owner.saveId, patron_key: 'lira', relationship: 100 })).error).not.toBeNull();
  });
});
