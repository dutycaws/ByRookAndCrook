import { afterEach, describe, expect, it } from 'vitest';
import { createBrewedTavern } from '../helpers/brewed-tavern';
import { parseBarSnapshot, parseServeReceipt } from '../../src/lib/game/serving';

type Fixture = Awaited<ReturnType<typeof createBrewedTavern>>;
const players: Fixture[] = [];

afterEach(async () => {
  await Promise.all(players.splice(0).map(({ admin, userId }) => admin.auth.admin.deleteUser(userId)));
});

async function fixture(prefix = 'uuid-serving'): Promise<Fixture> {
  const player = await createBrewedTavern(prefix);
  players.push(player);
  return player;
}

async function snapshot(player: Fixture) {
  const result = await player.client.rpc('npc_bar_snapshot');
  expect(result.error).toBeNull();
  return parseBarSnapshot(result.data!);
}

function serveInput(player: Fixture, instanceId: string, itemId: string, expectedRevision = 3) {
  return {
    p_save_id: player.saveId,
    p_instance_id: instanceId,
    p_item_kind: 'beverage',
    p_item_id: itemId,
    p_action_id: crypto.randomUUID(),
    p_expected_revision: expectedRevision
  };
}

describe('UUID resident hospitality RPC', () => {
  it('serves a beverage to a selected UUID resident once and replays its receipt', async () => {
    const player = await fixture();
    const before = await snapshot(player);
    const lira = before!.roster.find((resident) => resident.name === 'Lira Nightwind');
    expect(lira).toMatchObject({ origin: 'first_party', rating: 'standard', sequence: 0 });
    const input = serveInput(player, lira!.instanceId, player.brew.beverageId);

    const results = await Promise.all([
      player.client.rpc('npc_serve_hospitality', input),
      player.client.rpc('npc_serve_hospitality', input)
    ]);
    expect(results.every(({ error }) => error === null)).toBe(true);
    expect(results[0].data).toEqual(results[1].data);
    expect(parseServeReceipt(results[0].data!)).toMatchObject({
      actionId: input.p_action_id,
      instanceId: lira!.instanceId,
      itemKind: 'beverage',
      itemId: player.brew.beverageId,
      committedRevision: 4
    });

    const after = await snapshot(player);
    expect(after!.save).toMatchObject({ revision: 4 });
    expect(after!.beverages).toHaveLength(0);
    expect(after!.history).toHaveLength(1);
  });

  it('keeps food availability, receipts, and stale action protection scoped to the selected resident', async () => {
    const player = await fixture('uuid-serving-food');
    const before = await snapshot(player);
    const lira = before!.roster.find((resident) => resident.name === 'Lira Nightwind')!;
    const food = await player.admin.from('foods').insert({
      save_id: player.saveId,
      name: 'Test hearth loaf', recipe_key: 'hearth-loaf', quality_index: 4,
      day_number: 1, source_action_id: crypto.randomUUID()
    }).select('id').single();
    if (food.error) throw food.error;
    const input = {
      p_save_id: player.saveId, p_instance_id: lira.instanceId, p_item_kind: 'food',
      p_item_id: food.data.id, p_action_id: crypto.randomUUID(), p_expected_revision: 3
    };
    const served = await player.client.rpc('npc_serve_hospitality', input);
    expect(served.error).toBeNull();
    expect(parseServeReceipt(served.data!)).toMatchObject({ itemKind: 'food', itemId: food.data.id, instanceId: lira.instanceId });
    const after = await snapshot(player);
    expect(after!.foods).toHaveLength(0);
    expect(after!.beverages).toHaveLength(1);
    expect((await player.client.rpc('npc_serve_hospitality', {
      ...input, p_action_id: crypto.randomUUID(), p_expected_revision: 3
    })).error?.code).toBe('PT409');
  });

  it('rejects foreign saves, foreign items, unavailable residents, and direct private ledger reads', async () => {
    const owner = await fixture('uuid-serving-owner');
    const stranger = await fixture('uuid-serving-stranger');
    const ownerSnapshot = await snapshot(owner);
    const strangerSnapshot = await snapshot(stranger);
    const lira = ownerSnapshot!.roster.find((resident) => resident.name === 'Lira Nightwind')!;
    const torvin = ownerSnapshot!.roster.find((resident) => resident.name === 'Torvin Ashbeard')!;
    const input = serveInput(owner, lira.instanceId, owner.brew.beverageId);

    expect((await stranger.client.rpc('npc_serve_hospitality', input)).error?.code).toBe('PT404');
    // A foreign inventory UUID must never be served.  Depending on whether
    // the prior fenced action is observed first, the RPC reports unavailable
    // input or an unchanged revision; either outcome leaves the ledger intact.
    expect((await owner.client.rpc('npc_serve_hospitality', {
      ...input, p_item_id: stranger.brew.beverageId, p_action_id: crypto.randomUUID()
    })).error).not.toBeNull();
    expect((await owner.client.rpc('npc_dismiss', { p_instance: torvin.instanceId })).error).toBeNull();
    expect((await owner.client.rpc('npc_serve_hospitality', {
      ...input, p_instance_id: torvin.instanceId
    })).error?.code).toBe('PT422');
    expect((await owner.client.from('tavern_saves').update({ gold: 9999 }).eq('id', owner.saveId)).error).not.toBeNull();
    expect(strangerSnapshot!.roster.map((resident) => resident.instanceId)).not.toContain(lira.instanceId);
  });
});
