import { afterEach, describe, expect, it } from 'vitest';
import { createTestPlayer } from '../helpers/local-supabase';
import { createBrewedTavern } from '../helpers/brewed-tavern';
import { fixtureProvider } from '../helpers/dialogue-provider';
import { fixturePromptRegistry } from '../helpers/prompt-registry-fixture';
import { runDialogue } from '../../src/lib/server/dialogue/orchestrator';
import { parseBarSnapshot } from '../../src/lib/game/serving';
import type { DailyDeckState } from '../../src/lib/game/daily-deck';

type Player = Awaited<ReturnType<typeof createTestPlayer>>;
type BrewedPlayer = Awaited<ReturnType<typeof createBrewedTavern>>;
type AnyPlayer = Player | BrewedPlayer;
const players: AnyPlayer[] = [];
const promptRegistry = fixturePromptRegistry();

afterEach(async () => {
  await Promise.all(players.splice(0).map(({ admin, userId }) => admin.auth.admin.deleteUser(userId)));
});

async function tavern(prefix: string): Promise<Player & { saveId: string }> {
  const player = await createTestPlayer(prefix);
  players.push(player);
  const created = await player.client.rpc('create_tavern');
  if (created.error) throw created.error;
  const snapshot = parseBarSnapshot((await player.client.rpc('npc_bar_snapshot')).data!);
  if (!snapshot) throw new Error('Expected a bar snapshot.');
  return { ...player, saveId: snapshot.save.id };
}

async function bar(player: AnyPlayer) {
  const result = await player.client.rpc('npc_bar_snapshot');
  if (result.error) throw result.error;
  const snapshot = parseBarSnapshot(result.data!);
  if (!snapshot) throw new Error('Expected a bar snapshot.');
  return snapshot;
}

function dailyDeck(value: unknown): DailyDeckState {
  const deck = (value && typeof value === 'object' && 'dailyDeck' in value
    ? (value as { dailyDeck?: unknown }).dailyDeck
    : value) as Partial<DailyDeckState> | null;
  if (!deck || !['preparation', 'service', 'closed'].includes(String(deck.phase))
    || !Array.isArray(deck.cards) || !Array.isArray(deck.handIds) || !Array.isArray(deck.drawPileIds)
    || !Array.isArray(deck.discardIds) || typeof deck.generationId !== 'string') {
    throw new Error('Expected the authoritative daily deck.');
  }
  return deck as DailyDeckState;
}

async function open(player: AnyPlayer, revision: number) {
  const result = await (player.client.rpc as any)('daily_deck_open', { p_expected_revision: revision });
  if (result.error) throw result.error;
  return dailyDeck(result.data);
}

async function close(player: AnyPlayer, revision: number) {
  const result = await (player.client.rpc as any)('daily_deck_close', { p_expected_revision: revision });
  if (result.error) throw result.error;
  return result.data;
}

async function advance(player: Player & { saveId: string }, revision: number) {
  const result = await (player.client.rpc as any)('advance_tavern_day', {
    p_save_id: player.saveId, p_action_id: crypto.randomUUID(), p_expected_revision: revision
  });
  if (result.error) throw result.error;
  return result.data;
}

async function settleNewMorning(player: Player & { saveId: string }) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const status = await (player.client.rpc as any)('world_settlement_status', { p_save_id: player.saveId });
    if (status.error) throw status.error;
    if (status.data.status === 'completed') return;
    const claim = await (player.admin.rpc as any)('world_settlement_claim', { p_settlement_id: status.data.id });
    if (claim.error) throw claim.error;
    if (claim.data.status === 'completed') return;
    const completed = await (player.admin.rpc as any)('world_settlement_safe_result', {
      p_settlement_id: status.data.id, p_job_id: claim.data.jobId, p_fence: claim.data.fence,
      p_kind: 'skipped', p_public_digest: 'The focused daily-deck fixture settled this morning.'
    });
    if (completed.error) throw completed.error;
  }
  throw new Error('Daily-deck fixture could not settle the new morning.');
}

/** Simulate deliberate removals without deleting immutable social-card history. */
async function consumeSocialCopies(player: AnyPlayer, saveId: string) {
  const result = await (player.admin as any).from('daily_deck_cards')
    .update({ pile: 'consumed' }).eq('save_id', saveId).eq('source_kind', 'social');
  if (result.error) throw result.error;
}

async function nextDayAfterRemovingSocialCopies(player: Player & { saveId: string }) {
  const initial = await bar(player);
  await open(player, initial.save.revision);
  await consumeSocialCopies(player, player.saveId);
  await close(player, initial.save.revision + 1);
  await advance(player, initial.save.revision + 2);
  await settleNewMorning(player);
  const nextDay = await bar(player);
  return { initial, nextDay, deck: await open(player, nextDay.save.revision) };
}

function dialogue(cardId: string, npcId: string, sequence: number, message = 'These are my exact edited words.') {
  return {
    turnId: crypto.randomUUID(), npcId, message, expectedConversationSequence: sequence,
    interactionVersion: 'dialogue-v2' as const, dailyCardId: cardId
  };
}

describe('issue #39 daily deck acceptance', () => {
  it('opens the six-copy starter deck into a five-copy hand and persists full-deck fallback coverage', async () => {
    const player = await tavern('issue39-starter');
    const before = await bar(player);
    const deck = await open(player, before.save.revision);

    expect(deck).toMatchObject({ phase: 'service', maxHandSize: 5 });
    expect(deck.cards).toHaveLength(6);
    expect(deck.handIds).toHaveLength(5);
    expect(new Set(deck.handIds).size).toBe(5);
    expect(deck.cards.filter(card => card.kind === 'social').map(card => card.cardKey).sort())
      .toEqual(['charm', 'charm', 'insight', 'insight', 'rumor', 'rumor']);

    const context = await (player.client.rpc as any)('player_suggestion_batch_context', { p_generation_id: deck.generationId });
    expect(context.error).toBeNull();
    const cards = context.data.cards as Array<{ id: string }>;
    const guests = context.data.guests as Array<{ id: string }>;
    expect(cards.map(card => card.id).sort()).toEqual(deck.cards.map(card => card.id).sort());
    expect(guests.length).toBeGreaterThan(0);

    const claimed = await (player.client.rpc as any)('player_suggestion_batch_claim', { p_generation_id: deck.generationId });
    expect(claimed.error).toBeNull();
    const suggestions = cards.flatMap(card => guests.map(guest => ({
      dailyCardId: card.id, npcId: guest.id, text: `Fallback for ${card.id} and ${guest.id}.`, source: 'fallback'
    })));
    const saved = await (player.client.rpc as any)('player_suggestion_batch_upsert', {
      p_generation_id: deck.generationId, p_status: 'fallback', p_suggestions: suggestions
    });
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject({ generationId: deck.generationId, status: 'fallback' });
    expect(saved.data.suggestions).toHaveLength(deck.cards.length * guests.length);
    const replay = await (player.client.rpc as any)('player_suggestion_batch_claim', { p_generation_id: deck.generationId });
    expect(replay.data).toMatchObject({ claimed: false, batch: saved.data });
  });

  it('does not spend a physical social card on provider failure, then discards a refusal exactly once on custom text replay', async () => {
    const player = await tavern('issue39-social-turn');
    const initial = await bar(player);
    const deck = await open(player, initial.save.revision);
    const cardId = deck.handIds[0];
    const guest = initial.roster[0];
    const command = {
      ...dialogue(cardId, guest.npcId, guest.sequence, 'I replaced every suggested word with this sentence.'),
      intentCardId: deck.cards.find(card => card.id === cardId)!.sourceId
    };

    await expect(runDialogue(player.admin, player.userId, command, fixtureProvider({ failStage: 'speak' }), { promptRegistry })).rejects.toThrow();
    expect(dailyDeck((await (player.client.rpc as any)('daily_deck_state')).data).handIds).toContain(cardId);
    expect((await bar(player)).roster.find(row => row.npcId === guest.npcId)?.sequence).toBe(guest.sequence);
    const substituted = { ...command, dailyCardId: deck.handIds[1] };
    await expect(runDialogue(player.admin, player.userId, substituted, fixtureProvider(), { promptRegistry })).rejects.toThrow();
    const afterSubstitution = dailyDeck((await (player.client.rpc as any)('daily_deck_state')).data);
    expect(afterSubstitution.handIds).toEqual(expect.arrayContaining([cardId, deck.handIds[1]]));

    const committed = await runDialogue(player.admin, player.userId, command, fixtureProvider({ refuse: true }), { promptRegistry });
    expect((committed.result as any).reply).toContain('I will not adopt');
    const after = dailyDeck((await (player.client.rpc as any)('daily_deck_state')).data);
    expect(after.handIds).not.toContain(cardId);
    expect(after.discardIds).toContain(cardId);
    const replay = await runDialogue(player.admin, player.userId, command, fixtureProvider({ failStage: 'investigate' }), { promptRegistry });
    expect(replay).toEqual(committed);
    expect(dailyDeck((await (player.client.rpc as any)('daily_deck_state')).data).discardIds.filter(id => id === cardId)).toHaveLength(1);
  });

  it('rejects cardless and undrawn dialogue entries without effects', async () => {
    const player = await tavern('issue39-admission');
    const before = await bar(player);
    const deck = await open(player, before.save.revision);
    const guest = before.roster[0];
    const undrawn = deck.drawPileIds[0];
    expect(undrawn).toBeTruthy();

    await expect(runDialogue(player.admin, player.userId, {
      ...dialogue(undrawn, guest.npcId, guest.sequence), turnId: crypto.randomUUID()
    }, fixtureProvider(), { promptRegistry })).rejects.toThrow();
    await expect(runDialogue(player.admin, player.userId, {
      turnId: crypto.randomUUID(), npcId: guest.npcId, message: 'A legacy cardless conversation.',
      expectedConversationSequence: guest.sequence, interactionVersion: 'dialogue-v2'
    }, fixtureProvider(), { promptRegistry })).rejects.toThrow();
    const after = dailyDeck((await (player.client.rpc as any)('daily_deck_state')).data);
    expect(after.handIds).toEqual(deck.handIds);
    expect(after.drawPileIds).toEqual(deck.drawPileIds);
    expect((await bar(player)).roster.find(row => row.npcId === guest.npcId)?.sequence).toBe(guest.sequence);
  });

  it('uses one drawn crafted beverage as its physical serving card, then removes item and card permanently', async () => {
    const player = await createBrewedTavern('issue39-serving');
    players.push(player);
    const { deck } = await nextDayAfterRemovingSocialCopies(player);
    const before = await bar(player);
    const serving = deck.cards.find(card => card.kind === 'beverage');
    expect(serving).toBeTruthy();
    expect(deck.handIds).toEqual([serving!.id]);
    const guest = before.roster[0];
    const legacy = await (player.client.rpc as any)('npc_serve_hospitality', {
      p_save_id: player.saveId, p_instance_id: guest.instanceId, p_item_kind: 'beverage',
      p_item_id: serving!.sourceId, p_action_id: crypto.randomUUID(), p_expected_revision: before.save.revision
    });
    expect(legacy.error).not.toBeNull();
    expect((await bar(player)).beverages.map(item => item.id)).toContain(serving!.sourceId);
    const command = {
      ...dialogue(serving!.id, guest.npcId, guest.sequence, 'I brought this brewed drink especially for you.'),
      offering: { kind: 'beverage' as const, itemId: serving!.sourceId }
    };
    const completed = await runDialogue(player.admin, player.userId, command, fixtureProvider(), { promptRegistry });
    expect((completed.result as any).serving).toMatchObject({ itemId: serving!.sourceId, itemKind: 'beverage' });
    const after = dailyDeck((await (player.client.rpc as any)('daily_deck_state')).data);
    const servedCard = after.cards.find(card => card.id === serving!.id);
    expect(servedCard === undefined || servedCard.pile === 'consumed').toBe(true);
    expect([...after.handIds, ...after.drawPileIds, ...after.discardIds]).not.toContain(serving!.id);
    expect((await bar(player)).beverages.map(item => item.id)).not.toContain(serving!.sourceId);

    const context = await (player.client.rpc as any)('player_suggestion_batch_context', { p_generation_id: deck.generationId });
    expect(context.error).toBeNull();
    const cards = context.data.cards as Array<{ id: string }>;
    const guests = context.data.guests as Array<{ id: string }>;
    expect(cards.map(card => card.id)).toContain(serving!.id);
    const claimed = await (player.client.rpc as any)('player_suggestion_batch_claim', { p_generation_id: deck.generationId });
    expect(claimed.error).toBeNull();
    const saved = await (player.client.rpc as any)('player_suggestion_batch_upsert', {
      p_generation_id: deck.generationId, p_status: 'fallback',
      p_suggestions: cards.flatMap(card => guests.map(guest => ({
        dailyCardId: card.id, npcId: guest.id, text: `Stored line for ${card.id} and ${guest.id}.`, source: 'fallback'
      })))
    });
    expect(saved.error).toBeNull();
    expect(saved.data.suggestions).toHaveLength(cards.length * guests.length);
  });

  it('leaves an admitted serving turn unchanged when completion fails, then commits that same turn once on retry', async () => {
    const player = await createBrewedTavern('issue39-complete-failure');
    players.push(player);
    const { deck } = await nextDayAfterRemovingSocialCopies(player);
    const before = await bar(player);
    const serving = deck.cards.find(card => card.kind === 'beverage')!;
    const guest = before.roster[0];
    const command = {
      ...dialogue(serving.id, guest.npcId, guest.sequence, 'Please accept this exact serving message.'),
      offering: { kind: 'beverage' as const, itemId: serving.sourceId }
    };
    const completionFailure = new Proxy(player.admin, {
      get(target, property, receiver) {
        if (property !== 'rpc') return Reflect.get(target, property, receiver);
        return (name: string, args?: Record<string, unknown>) => target.rpc(name as any,
          name === 'npc_dialogue_complete' ? { ...args, p_fence: crypto.randomUUID() } : args as any);
      }
    }) as typeof player.admin;

    await expect(runDialogue(completionFailure, player.userId, command, fixtureProvider(), { promptRegistry })).rejects.toThrow();
    const failedDeck = dailyDeck((await (player.client.rpc as any)('daily_deck_state')).data);
    const failedBar = await bar(player);
    expect(failedDeck.handIds).toContain(serving.id);
    expect(failedBar.beverages.map(item => item.id)).toContain(serving.sourceId);
    expect(failedBar.save.gold).toBe(before.save.gold);
    expect(failedBar.roster.find(row => row.npcId === guest.npcId)?.sequence).toBe(guest.sequence);

    const committed = await runDialogue(player.admin, player.userId, command, fixtureProvider(), { promptRegistry });
    expect((committed.result as any).serving).toMatchObject({ itemId: serving.sourceId });
    const after = await bar(player);
    expect(after.beverages.map(item => item.id)).not.toContain(serving.sourceId);
    expect(after.roster.find(row => row.npcId === guest.npcId)?.sequence).toBe(guest.sequence + 1);
    expect(dailyDeck((await (player.client.rpc as any)('daily_deck_state')).data).handIds).not.toContain(serving.id);
  });

  it('early-close recombines every surviving physical copy once and carries an unserved crafted beverage forward', async () => {
    const player = await createBrewedTavern('issue39-early-close');
    players.push(player);
    const before = await bar(player);
    const firstDeck = await open(player, before.save.revision);
    const originalIds = firstDeck.cards.map(card => card.id).sort();
    const beverage = firstDeck.cards.find(card => card.kind === 'beverage');
    expect(beverage).toBeTruthy();
    expect(firstDeck.cards).toHaveLength(7);
    expect(firstDeck.handIds).toHaveLength(5);

    await close(player, before.save.revision + 1);
    await advance(player, before.save.revision + 2);
    await settleNewMorning(player);
    const nextDay = await bar(player);
    expect(nextDay.beverages.map(item => item.id)).toContain(beverage!.sourceId);
    const secondDeck = await open(player, nextDay.save.revision);
    expect(secondDeck.generationId).not.toBe(firstDeck.generationId);
    expect(secondDeck.cards.map(card => card.id).sort()).toEqual(originalIds);
    expect(new Set(secondDeck.cards.map(card => card.id)).size).toBe(originalIds.length);
    expect(secondDeck.cards.find(card => card.id === beverage!.id)).toMatchObject({
      kind: 'beverage', sourceId: beverage!.sourceId
    });
  });

  it('opens and closes a deliberately empty deck without creating replacement social cards', async () => {
    const player = await tavern('issue39-empty');
    const { initial: before, nextDay, deck } = await nextDayAfterRemovingSocialCopies(player);
    expect(deck.cards).toEqual([]);
    expect(deck.handIds).toEqual([]);
    const closed = await close(player, nextDay.save.revision + 1);
    expect(dailyDeck(closed)).toMatchObject({ phase: 'closed', cards: [], handIds: [] });
    expect(nextDay.save.currentDay).toBe(before.save.currentDay + 1);
  });

  it('schedules a potion-selected physical social copy for the next morning without changing today\'s hand', async () => {
    const player = await tavern('issue39-forgetfulness');
    const seeded = await (player.admin as any).from('daily_deck_provisions').insert({
      save_id: player.saveId, provision_key: 'potion_of_forgetfulness', quantity: 1
    });
    if (seeded.error) throw seeded.error;
    const before = await bar(player);
    const deck = await open(player, before.save.revision);
    const cardId = deck.handIds[0];
    const used = await (player.client.rpc as any)('daily_deck_use_forgetfulness', {
      p_expected_revision: before.save.revision + 1, p_card_id: cardId, p_action_id: crypto.randomUUID()
    });
    expect(used.error).toBeNull();
    expect(used.data).toMatchObject({ cardId, effectiveDay: deck.dayNumber + 1 });
    const scheduled = dailyDeck(used.data);
    expect(scheduled.handIds).toContain(cardId);
    expect(scheduled.pending.removals).toContain(cardId);
    const replay = await (player.client.rpc as any)('daily_deck_use_forgetfulness', {
      p_expected_revision: before.save.revision + 1, p_card_id: cardId, p_action_id: used.data.actionId
    });
    expect(replay.error).toBeNull();
    expect(replay.data).toEqual(used.data);
    const potion = await (player.admin as any).from('daily_deck_provisions')
      .select('quantity').eq('save_id', player.saveId).eq('provision_key', 'potion_of_forgetfulness').single();
    expect(potion.data).toMatchObject({ quantity: 0 });
    await close(player, before.save.revision + 2);
    await advance(player, before.save.revision + 3);
    await settleNewMorning(player);
    const nextDay = await bar(player);
    const tomorrow = await open(player, nextDay.save.revision);
    expect(tomorrow.cards.map(card => card.id)).not.toContain(cardId);
    expect(tomorrow.cards.filter(card => card.kind === 'social')).toHaveLength(5);
  });
});
