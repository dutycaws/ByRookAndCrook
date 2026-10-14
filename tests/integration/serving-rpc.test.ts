import { afterEach, describe, expect, it } from 'vitest';
import { createBrewedTavern } from '../helpers/brewed-tavern';
import { parseBarSnapshot, parseServeReceipt } from '../../src/lib/game/serving';
import { openDailyDialogueCard } from '../helpers/daily-deck-fixture';
import { runDialogue } from '../../src/lib/server/dialogue/orchestrator';
import { fixtureProvider } from '../helpers/dialogue-provider';
import { fixturePromptRegistry } from '../helpers/prompt-registry-fixture';

const promptRegistry = fixturePromptRegistry();

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
    const daily = await openDailyDialogueCard(player, { offering: { kind: 'beverage', itemId: player.brew.beverageId } });
    const input = { turnId: crypto.randomUUID(), npcId: lira!.npcId, message: 'Please accept this drink.', expectedConversationSequence: lira!.sequence, interactionVersion: 'dialogue-v2' as const, dailyCardId: daily.dailyCardId, offering: { kind: 'beverage' as const, itemId: player.brew.beverageId } };
    const completed = await runDialogue(player.admin, player.userId, input, fixtureProvider(), { promptRegistry });
    const replay = await runDialogue(player.admin, player.userId, input, fixtureProvider(), { promptRegistry });
    expect(replay.result).toEqual(completed.result);
    expect((completed.result as any).serving).toMatchObject({
      instanceId: lira!.instanceId,
      itemKind: 'beverage',
      itemId: player.brew.beverageId,
      committedRevision: before!.save.revision + 2
    });

    const after = await snapshot(player);
    expect(after!.save.revision).toBe(before!.save.revision + 2);
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
    const daily = await openDailyDialogueCard(player, { offering: { kind: 'food', itemId: food.data.id } });
    const command = { turnId: crypto.randomUUID(), npcId: lira.npcId, message: 'Please accept this food.', expectedConversationSequence: lira.sequence, interactionVersion: 'dialogue-v2' as const, dailyCardId: daily.dailyCardId, offering: { kind: 'food' as const, itemId: food.data.id } };
    const served = await runDialogue(player.admin, player.userId, command, fixtureProvider(), { promptRegistry });
    expect((served.result as any).serving).toMatchObject({ itemKind: 'food', itemId: food.data.id, instanceId: lira.instanceId });
    const after = await snapshot(player);
    expect(after!.foods).toHaveLength(0);
    expect(after!.beverages).toHaveLength(1);
    expect((await player.client.rpc('npc_serve_hospitality', {
      p_save_id: player.saveId, p_instance_id: lira.instanceId, p_item_kind: 'food', p_item_id: food.data.id,
      p_action_id: crypto.randomUUID(), p_expected_revision: before!.save.revision
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
    expect((await stranger.client.rpc('npc_serve_hospitality', input)).error).not.toBeNull();
    expect((await owner.client.rpc('npc_serve_hospitality', {
      ...input, p_item_id: stranger.brew.beverageId, p_action_id: crypto.randomUUID()
    })).error).not.toBeNull();
    expect((await owner.client.rpc('npc_dismiss', { p_instance: torvin.instanceId })).error).toBeNull();
    expect((await owner.client.rpc('npc_serve_hospitality', {
      ...input, p_instance_id: torvin.instanceId
    })).error).not.toBeNull();
    const ownerDaily = await openDailyDialogueCard(owner, { offering: { kind: 'beverage', itemId: owner.brew.beverageId } });
    const strangerDaily = await openDailyDialogueCard(stranger, { offering: { kind: 'beverage', itemId: stranger.brew.beverageId } });
    const ownerBefore = await snapshot(owner);
    const strangerBefore = await snapshot(stranger);
    const ownerDeck = ownerDaily.deck;
    const strangerDeck = strangerDaily.deck;
    await expect(runDialogue(stranger.admin, stranger.userId, {
      turnId: crypto.randomUUID(), npcId: lira.npcId, message: 'Foreign card.', expectedConversationSequence: 0,
      interactionVersion: 'dialogue-v2', dailyCardId: ownerDaily.dailyCardId,
      offering: { kind: 'beverage', itemId: owner.brew.beverageId }
    }, fixtureProvider(), { promptRegistry })).rejects.toThrow();
    await expect(runDialogue(owner.admin, owner.userId, {
      turnId: crypto.randomUUID(), npcId: lira.npcId, message: 'Foreign item.', expectedConversationSequence: lira.sequence,
      interactionVersion: 'dialogue-v2', dailyCardId: ownerDaily.dailyCardId,
      offering: { kind: 'beverage', itemId: stranger.brew.beverageId }
    }, fixtureProvider(), { promptRegistry })).rejects.toThrow();
    await expect(runDialogue(owner.admin, owner.userId, {
      turnId: crypto.randomUUID(), npcId: torvin.npcId, message: 'Dismissed resident.', expectedConversationSequence: torvin.sequence,
      interactionVersion: 'dialogue-v2', dailyCardId: ownerDaily.dailyCardId,
      offering: { kind: 'beverage', itemId: owner.brew.beverageId }
    }, fixtureProvider(), { promptRegistry })).rejects.toThrow();
    const ownerAfter = await snapshot(owner);
    const strangerAfter = await snapshot(stranger);
    expect(ownerAfter!.save.gold).toBe(ownerBefore!.save.gold);
    expect(strangerAfter!.save.gold).toBe(strangerBefore!.save.gold);
    expect(ownerAfter!.beverages.map(item => item.id)).toContain(owner.brew.beverageId);
    expect(strangerAfter!.beverages.map(item => item.id)).toContain(stranger.brew.beverageId);
    const ownerState = await (owner.client.rpc as any)('daily_deck_state');
    const strangerState = await (stranger.client.rpc as any)('daily_deck_state');
    expect(ownerState.error).toBeNull();
    expect(strangerState.error).toBeNull();
    expect((ownerState.data as any).handIds).toContain(ownerDaily.dailyCardId);
    expect((strangerState.data as any).handIds).toContain(strangerDaily.dailyCardId);
    expect((await owner.client.from('tavern_saves').update({ gold: 9999 }).eq('id', owner.saveId)).error).not.toBeNull();
    expect(strangerSnapshot!.roster.map((resident) => resident.instanceId)).not.toContain(lira.instanceId);
  });
});
