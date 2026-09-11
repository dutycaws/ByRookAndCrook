import { afterEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../src/lib/database.types';
import { createTestPlayer } from '../helpers/local-supabase';

const createdUsers: Array<{ admin: SupabaseClient<Database>; userId: string }> = [];

interface BrewerySnapshot {
  save: {
    id: string;
    revision: number;
    currentDay: number;
    dayMinigameCompleted: boolean;
    dailyCraftKind: 'brew' | 'bake' | null;
  };
  cells: Array<{ id: string; layoutKey: string }>;
  ingredients: Array<{ id: string; plantKey: string; quantity: number }>;
  brewery: {
    activeSession: { id: string; ingredientBatchId: string } | null;
    beverages: Array<{ id: string; name: string; qualityIndex: number; dayNumber: number }>;
    socialCards: Array<{ tier: string; relationshipGain: number; goldMultiplier: number }>;
    intentCards: Array<{ id: string; cardKey: string; tier: string; sourceBeverageId: string | null }>;
  };
}

function asSnapshot(data: Json | null): BrewerySnapshot {
  return data as unknown as BrewerySnapshot;
}

async function provisionFennel(player: Awaited<ReturnType<typeof createTestPlayer>>) {
  expect((await player.client.rpc('create_tavern')).error).toBeNull();
  const initial = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
  const fennelCell = initial.cells.find((cell) => cell.layoutKey === 'c1');
  expect(fennelCell).toBeDefined();

  const harvest = await player.client.rpc('harvest_crop', {
    p_save_id: initial.save.id,
    p_cell_id: fennelCell!.id,
    p_action_id: crypto.randomUUID(),
    p_expected_revision: initial.save.revision
  });
  expect(harvest.error).toBeNull();

  const harvested = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
  const fennel = harvested.ingredients.find((ingredient) => ingredient.plantKey === 'fennel');
  expect(fennel).toBeDefined();
  return { snapshot: harvested, ingredient: fennel! };
}

afterEach(async () => {
  await Promise.all(createdUsers.splice(0).map(({ admin, userId }) => admin.auth.admin.deleteUser(userId)));
});

describe('brewery RPC', () => {
  it('commits start, completion, reward, and day advance once across identical retries', async () => {
    const player = await createTestPlayer('brew-replay');
    createdUsers.push(player);
    const { snapshot: harvested, ingredient } = await provisionFennel(player);

    const startInput = {
      p_save_id: harvested.save.id,
      p_ingredient_batch_id: ingredient.id,
      p_action_id: crypto.randomUUID(),
      p_expected_revision: harvested.save.revision
    };
    const [started, startReplay] = await Promise.all([
      player.client.rpc('start_brew', startInput),
      player.client.rpc('start_brew', startInput)
    ]);

    expect(started.error).toBeNull();
    expect(startReplay.error).toBeNull();
    expect(started.data).toEqual(startReplay.data);
    expect(started.data).toEqual(expect.objectContaining({
      durationSeconds: 15, countdownSeconds: 2, stirRulesVersion: 'guide-v2'
    }));

    const brewing = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    expect(brewing.save.revision).toBe(2);
    expect(brewing.brewery.activeSession?.ingredientBatchId).toBe(ingredient.id);

    const sessionId = brewing.brewery.activeSession!.id;
    const backdated = await player.admin
      .from('brew_sessions')
      .update({ started_at: new Date(Date.now() - 18_000).toISOString() })
      .eq('id', sessionId);
    expect(backdated.error).toBeNull();

    const completeInput = {
      p_save_id: brewing.save.id,
      p_session_id: sessionId,
      p_action_id: crypto.randomUUID(),
      p_expected_revision: brewing.save.revision,
      p_perfect_ticks: 60,
      p_good_ticks: 0,
      p_total_ticks: 60
    };
    const [completed, completionReplay] = await Promise.all([
      player.client.rpc('complete_brew', completeInput),
      player.client.rpc('complete_brew', completeInput)
    ]);

    expect(completed.error).toBeNull();
    expect(completionReplay.error).toBeNull();
    expect(completed.data).toEqual(completionReplay.data);
    expect(completed.data).toEqual(
      expect.objectContaining({ beverageName: 'Ambrosial Draught', qualityIndex: 6, stirScore: 6 })
    );

    const finished = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    expect(finished.save).toEqual(
      expect.objectContaining({ revision: 3, currentDay: 1, dayMinigameCompleted: true })
    );
    expect(finished.ingredients).toEqual([
      expect.objectContaining({ id: ingredient.id, plantKey: 'fennel', quantity: 1 })
    ]);
    expect(finished.brewery.activeSession).toBeNull();
    expect(finished.brewery.beverages).toEqual([
      expect.objectContaining({ name: 'Ambrosial Draught', qualityIndex: 6, dayNumber: 1 })
    ]);
    expect(finished.brewery.socialCards).toEqual([]);
    expect(finished.brewery.intentCards).toContainEqual(
      expect.objectContaining({ cardKey: 'resolve', tier: 'exceptional', sourceBeverageId: finished.brewery.beverages[0].id })
    );

    const advanceInput = {
      p_save_id: finished.save.id,
      p_action_id: crypto.randomUUID(),
      p_expected_revision: finished.save.revision
    };
    const firstAdvance = await player.client.rpc('advance_tavern_day', advanceInput);
    const replayedAdvance = await player.client.rpc('advance_tavern_day', advanceInput);
    expect(firstAdvance.error).toBeNull();
    expect(replayedAdvance.error).toBeNull();
    expect(firstAdvance.data).toEqual(replayedAdvance.data);

    const nextDay = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    expect(nextDay.save).toEqual(
      expect.objectContaining({ revision: 4, currentDay: 2, dayMinigameCompleted: false })
    );
    expect(nextDay.brewery.beverages).toHaveLength(1);
  });

  it('serializes competing starts and denies foreign commands and direct writes', async () => {
    const owner = await createTestPlayer('brew-owner');
    const stranger = await createTestPlayer('brew-stranger');
    createdUsers.push(owner, stranger);
    const { snapshot, ingredient } = await provisionFennel(owner);
    expect((await stranger.client.rpc('create_tavern')).error).toBeNull();

    const input = (actionId: string) => ({
      p_save_id: snapshot.save.id,
      p_ingredient_batch_id: ingredient.id,
      p_action_id: actionId,
      p_expected_revision: snapshot.save.revision
    });
    const competitors = await Promise.all([
      owner.client.rpc('start_brew', input(crypto.randomUUID())),
      owner.client.rpc('start_brew', input(crypto.randomUUID()))
    ]);

    expect(competitors.filter(({ error }) => error === null)).toHaveLength(1);
    expect(competitors.find(({ error }) => error)?.error?.code).toBe('PT409');

    const ownerAfter = asSnapshot((await owner.client.rpc('get_tavern_snapshot')).data);
    expect(ownerAfter.save.revision).toBe(2);
    expect(ownerAfter.brewery.activeSession).not.toBeNull();

    const foreignStart = await stranger.client.rpc('start_brew', input(crypto.randomUUID()));
    expect(foreignStart.error?.code).toBe('PT404');

    const directSessionWrite = await owner.client
      .from('brew_sessions')
      .update({ started_at: new Date(0).toISOString() })
      .eq('id', ownerAfter.brewery.activeSession!.id);
    expect(directSessionWrite.error).not.toBeNull();

    const directRewardWrite = await owner.client.from('social_cards').insert({
      save_id: snapshot.save.id,
      source_beverage_id: crypto.randomUUID(),
      card_key: 'pour-ale',
      display_name: 'Pour Ale',
      tier: 'exceptional',
      relationship_gain: 10,
      gold_multiplier: 2
    });
    expect(directRewardWrite.error).not.toBeNull();
  });

  it('allows two sequential brews on the same day and retains both outputs', async () => {
    const player = await createTestPlayer('brew-repeat');
    createdUsers.push(player);
    const { snapshot, ingredient } = await provisionFennel(player);
    let current = snapshot;

    for (let index = 0; index < 2; index += 1) {
      const started = await player.client.rpc('start_brew', {
        p_save_id: current.save.id, p_ingredient_batch_id: ingredient.id,
        p_action_id: crypto.randomUUID(), p_expected_revision: current.save.revision
      });
      expect(started.error).toBeNull();
      const sessionId = (started.data as { sessionId: string }).sessionId;
      expect((await player.admin.from('brew_sessions').update({
        started_at: new Date(Date.now() - 18_000).toISOString()
      }).eq('id', sessionId)).error).toBeNull();
      expect((await player.client.rpc('complete_brew', {
        p_save_id: current.save.id, p_session_id: sessionId,
        p_action_id: crypto.randomUUID(),
        p_expected_revision: (started.data as { committedRevision: number }).committedRevision,
        p_perfect_ticks: 60, p_good_ticks: 0, p_total_ticks: 60
      })).error).toBeNull();
      current = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
      expect(current.save).toEqual(expect.objectContaining({
        currentDay: 1, dayMinigameCompleted: true, dailyCraftKind: null
      }));
    }

    expect(current.brewery.beverages).toHaveLength(2);
    expect(current.brewery.beverages.every((beverage) => beverage.dayNumber === 1)).toBe(true);
    expect(current.ingredients).toEqual([]);
  });
});
