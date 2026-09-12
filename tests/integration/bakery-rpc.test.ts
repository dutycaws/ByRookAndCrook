import { afterEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../src/lib/database.types';
import { createTestPlayer, getLocalSupabase } from '../helpers/local-supabase';

const createdUsers: Array<{ admin: SupabaseClient<Database>; userId: string }> = [];

interface BakerySnapshot {
  save: {
    id: string;
    revision: number;
    currentDay: number;
    dayMinigameCompleted: boolean;
    dailyCraftKind: 'brew' | 'bake' | null;
  };
  cells: Array<{ id: string; layoutKey: string }>;
  ingredients: Array<{ id: string; plantKey: string; quantity: number }>;
  brewery: { beverages: Array<{ id: string; dayNumber: number }> };
  bakery: {
    activeSession: {
      id: string;
      status: 'folding' | 'scoring' | 'ready' | 'baking';
      foldCount: number;
      scoreCount: number;
      ovenStartedAt: string | null;
    } | null;
    foods: Array<{ id: string; name: string; qualityIndex: number; bakeSessionId: string }>;
    intentCards: Array<{ id: string; cardKey: string; tier: string; sourceFoodId: string }>;
  };
}

function asSnapshot(data: Json | null): BakerySnapshot {
  return data as unknown as BakerySnapshot;
}

async function provisionIngredient(player: Awaited<ReturnType<typeof createTestPlayer>>) {
  expect((await player.client.rpc('create_tavern')).error).toBeNull();
  const initial = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
  const cell = initial.cells.find((candidate) => candidate.layoutKey === 'c1');
  expect(cell).toBeDefined();
  expect((await player.client.rpc('harvest_crop', {
    p_save_id: initial.save.id,
    p_cell_id: cell!.id,
    p_action_id: crypto.randomUUID(),
    p_expected_revision: initial.save.revision
  })).error).toBeNull();
  const snapshot = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
  const ingredient = snapshot.ingredients.find((candidate) => candidate.plantKey === 'fennel');
  expect(ingredient).toBeDefined();
  return { snapshot, ingredient: ingredient! };
}

async function prepareAndOven(
  player: Awaited<ReturnType<typeof createTestPlayer>>,
  snapshot: BakerySnapshot,
  ingredientId: string
) {
  const start = await player.client.rpc('start_bake', {
    p_save_id: snapshot.save.id,
    p_ingredient_batch_id: ingredientId,
    p_action_id: crypto.randomUUID(),
    p_expected_revision: snapshot.save.revision
  });
  expect(start.error).toBeNull();
  let revision = (start.data as { committedRevision: number }).committedRevision;
  const sessionId = (start.data as { sessionId: string }).sessionId;

  for (let index = 0; index < 6; index += 1) {
    const fold = await player.client.rpc('fold_bake', {
      p_save_id: snapshot.save.id,
      p_session_id: sessionId,
      p_action_id: crypto.randomUUID(),
      p_expected_revision: revision,
      p_distance: 70
    });
    expect(fold.error).toBeNull();
    revision = (fold.data as { committedRevision: number }).committedRevision;
  }
  for (let index = 0; index < 3; index += 1) {
    const score = await player.client.rpc('score_bake', {
      p_save_id: snapshot.save.id,
      p_session_id: sessionId,
      p_action_id: crypto.randomUUID(),
      p_expected_revision: revision,
      p_length: 70
    });
    expect(score.error).toBeNull();
    revision = (score.data as { committedRevision: number }).committedRevision;
  }
  const oven = await player.client.rpc('begin_bake_oven', {
    p_save_id: snapshot.save.id,
    p_session_id: sessionId,
    p_action_id: crypto.randomUUID(),
    p_expected_revision: revision
  });
  expect(oven.error).toBeNull();
  return {
    sessionId,
    revision: (oven.data as { committedRevision: number }).committedRevision
  };
}

afterEach(async () => {
  await Promise.all(createdUsers.splice(0).map(({ admin, userId }) => admin.auth.admin.deleteUser(userId)));
});

describe('bakery RPC', () => {
  it('persists every stage and atomically produces one food plus an independent intent reward', async () => {
    const player = await createTestPlayer('bake-replay');
    createdUsers.push(player);
    const { snapshot, ingredient } = await provisionIngredient(player);
    const startInput = {
      p_save_id: snapshot.save.id,
      p_ingredient_batch_id: ingredient.id,
      p_action_id: crypto.randomUUID(),
      p_expected_revision: snapshot.save.revision
    };
    const started = await player.client.rpc('start_bake', startInput);
    const startReplay = await player.client.rpc('start_bake', startInput);
    expect(started.error).toBeNull();
    expect(startReplay.error).toBeNull();
    expect(startReplay.data).toEqual(started.data);

    let current = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    expect(current.save).toEqual(expect.objectContaining({ revision: 2, dailyCraftKind: 'bake' }));
    expect(current.bakery.activeSession).toEqual(expect.objectContaining({ status: 'folding', foldCount: 0 }));
    const sessionId = current.bakery.activeSession!.id;

    const firstFoldInput = {
      p_save_id: current.save.id,
      p_session_id: sessionId,
      p_action_id: crypto.randomUUID(),
      p_expected_revision: current.save.revision,
      p_distance: 70
    };
    const firstFold = await player.client.rpc('fold_bake', firstFoldInput);
    expect(firstFold.error).toBeNull();
    expect((await player.client.rpc('fold_bake', firstFoldInput)).data).toEqual(firstFold.data);
    expect((await player.client.rpc('fold_bake', { ...firstFoldInput, p_distance: 20 })).error?.code).toBe('PT409');

    let revision = (firstFold.data as { committedRevision: number }).committedRevision;
    for (let index = 1; index < 6; index += 1) {
      const folded = await player.client.rpc('fold_bake', {
        p_save_id: current.save.id, p_session_id: sessionId, p_action_id: crypto.randomUUID(),
        p_expected_revision: revision, p_distance: 70
      });
      expect(folded.error).toBeNull();
      revision = (folded.data as { committedRevision: number }).committedRevision;
    }
    current = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    expect(current.bakery.activeSession).toEqual(expect.objectContaining({ status: 'scoring', foldCount: 6 }));

    for (const invalidLength of [0, 9]) {
      const before = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
      const invalidScore = await player.client.rpc('score_bake', {
        p_save_id: current.save.id, p_session_id: sessionId, p_action_id: crypto.randomUUID(),
        p_expected_revision: revision, p_length: invalidLength
      });
      expect(invalidScore.error?.code).toBe('PT400');
      const after = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
      expect(after.save.revision).toBe(before.save.revision);
      expect(after.bakery.activeSession?.scoreCount).toBe(0);
    }

    for (let index = 0; index < 3; index += 1) {
      const scored = await player.client.rpc('score_bake', {
        p_save_id: current.save.id, p_session_id: sessionId, p_action_id: crypto.randomUUID(),
        p_expected_revision: revision, p_length: 70
      });
      expect(scored.error).toBeNull();
      revision = (scored.data as { committedRevision: number }).committedRevision;
    }
    current = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    expect(current.bakery.activeSession).toEqual(expect.objectContaining({ status: 'ready', scoreCount: 3 }));

    const oven = await player.client.rpc('begin_bake_oven', {
      p_save_id: current.save.id, p_session_id: sessionId, p_action_id: crypto.randomUUID(),
      p_expected_revision: revision
    });
    expect(oven.error).toBeNull();
    revision = (oven.data as { committedRevision: number }).committedRevision;
    current = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    expect(current.bakery.activeSession).toEqual(expect.objectContaining({ status: 'baking' }));
    expect(current.bakery.activeSession?.ovenStartedAt).toBeTruthy();

    const completeInput = {
      p_save_id: current.save.id, p_session_id: sessionId, p_action_id: crypto.randomUUID(),
      p_expected_revision: revision
    };
    const completed = await player.client.rpc('complete_bake', completeInput);
    const completionReplay = await player.client.rpc('complete_bake', completeInput);
    expect(completed.error).toBeNull();
    expect(completionReplay.data).toEqual(completed.data);
    expect(completed.data).toEqual(expect.objectContaining({ timingBand: 'red', qualityIndex: 4 }));

    current = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    expect(current.save).toEqual(expect.objectContaining({ dayMinigameCompleted: true, dailyCraftKind: null }));
    expect(current.bakery.activeSession).toBeNull();
    expect(current.bakery.foods).toHaveLength(1);
    expect(current.bakery.foods[0]).toEqual(expect.objectContaining({ bakeSessionId: sessionId, qualityIndex: 4 }));
    expect(current.bakery.intentCards).toContainEqual(expect.objectContaining({
      sourceFoodId: current.bakery.foods[0].id, cardKey: 'charm', tier: 'superior'
    }));
    expect(current.ingredients).toEqual([]);

    const counts = await Promise.all([
      player.admin.from('foods').select('*', { count: 'exact', head: true }).eq('save_id', current.save.id),
      player.admin.from('intent_cards').select('*', { count: 'exact', head: true }).eq('source_food_id', current.bakery.foods[0].id),
      player.admin.from('bake_actions').select('*', { count: 'exact', head: true }).eq('command_kind', 'complete_bake').eq('save_id', current.save.id)
    ]);
    expect(counts.map((result) => result.count)).toEqual([1, 1, 1]);
    expect((await player.client.from('foods').insert({
      save_id: current.save.id, name: 'Forged loaf', recipe_key: 'herb-loaf', quality_index: 6,
      day_number: current.save.currentDay, source_action_id: crypto.randomUUID()
    })).error).not.toBeNull();
  });

  it('uses server oven time for strictly ordered red, yellow, and green outcomes', async () => {
    const qualities: number[] = [];
    for (const [label, elapsedSeconds] of [['red', 10], ['yellow', 24], ['green', 30]] as const) {
      const player = await createTestPlayer(`bake-${label}`);
      createdUsers.push(player);
      const { snapshot, ingredient } = await provisionIngredient(player);
      const oven = await prepareAndOven(player, snapshot, ingredient.id);
      expect((await player.admin.from('bake_sessions').update({
        oven_started_at: new Date(Date.now() - elapsedSeconds * 1000).toISOString()
      }).eq('id', oven.sessionId)).error).toBeNull();
      const result = await player.client.rpc('complete_bake', {
        p_save_id: snapshot.save.id, p_session_id: oven.sessionId,
        p_action_id: crypto.randomUUID(), p_expected_revision: oven.revision
      });
      expect(result.error).toBeNull();
      expect((result.data as { timingBand: string }).timingBand).toBe(label);
      qualities.push((result.data as { qualityIndex: number }).qualityIndex);
    }
    expect(qualities[0]).toBeLessThan(qualities[1]);
    expect(qualities[1]).toBeLessThan(qualities[2]);
  }, 20_000);

  it('serializes the active craft and allows a no-craft day to close', async () => {
    const baker = await createTestPlayer('bake-budget');
    const brewer = await createTestPlayer('brew-budget');
    const racer = await createTestPlayer('craft-race');
    createdUsers.push(baker, brewer, racer);
    const baked = await provisionIngredient(baker);
    const brewed = await provisionIngredient(brewer);

    const startBake = await baker.client.rpc('start_bake', {
      p_save_id: baked.snapshot.save.id, p_ingredient_batch_id: baked.ingredient.id,
      p_action_id: crypto.randomUUID(), p_expected_revision: baked.snapshot.save.revision
    });
    expect(startBake.error).toBeNull();
    expect((await baker.client.rpc('start_brew', {
      p_save_id: baked.snapshot.save.id, p_ingredient_batch_id: baked.ingredient.id,
      p_action_id: crypto.randomUUID(), p_expected_revision: 2
    })).error?.code).toBe('PT422');
    expect((await baker.client.rpc('advance_tavern_day', {
      p_save_id: baked.snapshot.save.id, p_action_id: crypto.randomUUID(), p_expected_revision: 2
    })).error?.message).toBe('Finish the active bake before closing');

    const startBrew = await brewer.client.rpc('start_brew', {
      p_save_id: brewed.snapshot.save.id, p_ingredient_batch_id: brewed.ingredient.id,
      p_action_id: crypto.randomUUID(), p_expected_revision: brewed.snapshot.save.revision
    });
    expect(startBrew.error).toBeNull();
    expect((await brewer.client.rpc('start_bake', {
      p_save_id: brewed.snapshot.save.id, p_ingredient_batch_id: brewed.ingredient.id,
      p_action_id: crypto.randomUUID(), p_expected_revision: 2
    })).error?.code).toBe('PT422');

    const raced = await provisionIngredient(racer);
    const [racedBrew, racedBake] = await Promise.all([
      racer.client.rpc('start_brew', {
        p_save_id: raced.snapshot.save.id, p_ingredient_batch_id: raced.ingredient.id,
        p_action_id: crypto.randomUUID(), p_expected_revision: raced.snapshot.save.revision
      }),
      racer.client.rpc('start_bake', {
        p_save_id: raced.snapshot.save.id, p_ingredient_batch_id: raced.ingredient.id,
        p_action_id: crypto.randomUUID(), p_expected_revision: raced.snapshot.save.revision
      })
    ]);
    expect([racedBrew, racedBake].filter((result) => result.error === null)).toHaveLength(1);
    expect([racedBrew, racedBake].find((result) => result.error)?.error?.code)
      .toMatch(/^PT(409|422)$/);

    const foreignCalls = await Promise.all([
      brewer.client.rpc('start_bake', {
        p_save_id: baked.snapshot.save.id, p_ingredient_batch_id: baked.ingredient.id,
        p_action_id: crypto.randomUUID(), p_expected_revision: 2
      }),
      brewer.client.rpc('fold_bake', {
        p_save_id: baked.snapshot.save.id, p_session_id: (startBake.data as { sessionId: string }).sessionId,
        p_action_id: crypto.randomUUID(), p_expected_revision: 2, p_distance: 70
      }),
      brewer.client.rpc('score_bake', {
        p_save_id: baked.snapshot.save.id, p_session_id: (startBake.data as { sessionId: string }).sessionId,
        p_action_id: crypto.randomUUID(), p_expected_revision: 2, p_length: 70
      }),
      brewer.client.rpc('begin_bake_oven', {
        p_save_id: baked.snapshot.save.id, p_session_id: (startBake.data as { sessionId: string }).sessionId,
        p_action_id: crypto.randomUUID(), p_expected_revision: 2
      }),
      brewer.client.rpc('complete_bake', {
        p_save_id: baked.snapshot.save.id, p_session_id: (startBake.data as { sessionId: string }).sessionId,
        p_action_id: crypto.randomUUID(), p_expected_revision: 2
      })
    ]);
    expect(foreignCalls.map((result) => result.error?.code)).toEqual(Array(5).fill('PT404'));

    const directWrites = await Promise.all([
      baker.client.from('bake_sessions').update({ fold_count: 6 }).eq('save_id', baked.snapshot.save.id),
      baker.client.from('bake_sessions').delete().eq('save_id', baked.snapshot.save.id),
      baker.client.from('bake_actions').insert({
        save_id: baked.snapshot.save.id, action_id: crypto.randomUUID(), actor_id: baker.userId,
        command_kind: 'complete_bake', subject_id: (startBake.data as { sessionId: string }).sessionId,
        input_expected_revision: 2, result: {}, committed_revision: 3
      }),
      baker.client.from('bake_actions').delete().eq('save_id', baked.snapshot.save.id)
    ]);
    expect(directWrites.every((result) => result.error !== null)).toBe(true);

    const local = getLocalSupabase();
    const anonymous = createClient<Database>(local.url, local.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const anonymousCalls = await Promise.all([
      anonymous.rpc('start_bake', {
        p_save_id: baked.snapshot.save.id, p_ingredient_batch_id: baked.ingredient.id,
        p_action_id: crypto.randomUUID(), p_expected_revision: 2
      }),
      anonymous.rpc('fold_bake', {
        p_save_id: baked.snapshot.save.id, p_session_id: (startBake.data as { sessionId: string }).sessionId,
        p_action_id: crypto.randomUUID(), p_expected_revision: 2, p_distance: 70
      }),
      anonymous.rpc('score_bake', {
        p_save_id: baked.snapshot.save.id, p_session_id: (startBake.data as { sessionId: string }).sessionId,
        p_action_id: crypto.randomUUID(), p_expected_revision: 2, p_length: 70
      }),
      anonymous.rpc('begin_bake_oven', {
        p_save_id: baked.snapshot.save.id, p_session_id: (startBake.data as { sessionId: string }).sessionId,
        p_action_id: crypto.randomUUID(), p_expected_revision: 2
      }),
      anonymous.rpc('complete_bake', {
        p_save_id: baked.snapshot.save.id, p_session_id: (startBake.data as { sessionId: string }).sessionId,
        p_action_id: crypto.randomUUID(), p_expected_revision: 2
      })
    ]);
    expect(anonymousCalls.every((result) => result.error?.code === '42501')).toBe(true);

    const noCraft = await createTestPlayer('no-craft');
    createdUsers.push(noCraft);
    expect((await noCraft.client.rpc('create_tavern')).error).toBeNull();
    const empty = asSnapshot((await noCraft.client.rpc('get_tavern_snapshot')).data);
    const closed = await noCraft.client.rpc('advance_tavern_day', {
      p_save_id: empty.save.id, p_action_id: crypto.randomUUID(), p_expected_revision: empty.save.revision
    });
    expect(closed.error).toBeNull();
    const nextDay = asSnapshot((await noCraft.client.rpc('get_tavern_snapshot')).data);
    expect(nextDay.save).toEqual(expect.objectContaining({ currentDay: 2, dailyCraftKind: null }));
  });

  it('allows bake, brew, and bake again on one day while ingredients remain', async () => {
    const player = await createTestPlayer('repeat-crafting');
    createdUsers.push(player);
    const provisioned = await provisionIngredient(player);
    const hopsCell = provisioned.snapshot.cells.find((cell) => cell.layoutKey === 'c0');
    const tomatoCell = provisioned.snapshot.cells.find((cell) => cell.layoutKey === 'c7');
    expect(hopsCell).toBeDefined();
    expect(tomatoCell).toBeDefined();
    expect((await player.client.rpc('harvest_crop', {
      p_save_id: provisioned.snapshot.save.id, p_cell_id: hopsCell!.id,
      p_action_id: crypto.randomUUID(), p_expected_revision: provisioned.snapshot.save.revision
    })).error).toBeNull();
    let snapshot = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    expect((await player.client.rpc('harvest_crop', {
      p_save_id: snapshot.save.id, p_cell_id: tomatoCell!.id,
      p_action_id: crypto.randomUUID(), p_expected_revision: snapshot.save.revision
    })).error).toBeNull();
    snapshot = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    const fennel = snapshot.ingredients.find((batch) => batch.plantKey === 'fennel');
    const hops = snapshot.ingredients.find((batch) => batch.plantKey === 'hops');
    const tomatoes = snapshot.ingredients.find((batch) => batch.plantKey === 'tomatoes');
    expect(fennel).toBeDefined();
    expect(hops).toBeDefined();
    expect(tomatoes).toBeDefined();

    const firstOven = await prepareAndOven(player, snapshot, fennel!.id);
    expect((await player.admin.from('bake_sessions').update({
      oven_started_at: new Date(Date.now() - 30_000).toISOString()
    }).eq('id', firstOven.sessionId)).error).toBeNull();
    expect((await player.client.rpc('complete_bake', {
      p_save_id: snapshot.save.id, p_session_id: firstOven.sessionId,
      p_action_id: crypto.randomUUID(), p_expected_revision: firstOven.revision
    })).error).toBeNull();

    let current = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    const brew = await player.client.rpc('start_brew', {
      p_save_id: current.save.id, p_ingredient_batch_id: hops!.id,
      p_action_id: crypto.randomUUID(), p_expected_revision: current.save.revision
    });
    expect(brew.error).toBeNull();
    const brewSessionId = (brew.data as { sessionId: string }).sessionId;
    expect((await player.admin.from('brew_sessions').update({
      started_at: new Date(Date.now() - 18_000).toISOString()
    }).eq('id', brewSessionId)).error).toBeNull();
    expect((await player.client.rpc('complete_brew', {
      p_save_id: current.save.id, p_session_id: brewSessionId,
      p_action_id: crypto.randomUUID(),
      p_expected_revision: (brew.data as { committedRevision: number }).committedRevision,
      p_perfect_ticks: 60, p_good_ticks: 0, p_total_ticks: 60
    })).error).toBeNull();

    current = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    const secondOven = await prepareAndOven(player, current, tomatoes!.id);
    expect((await player.admin.from('bake_sessions').update({
      oven_started_at: new Date(Date.now() - 30_000).toISOString()
    }).eq('id', secondOven.sessionId)).error).toBeNull();
    expect((await player.client.rpc('complete_bake', {
      p_save_id: current.save.id, p_session_id: secondOven.sessionId,
      p_action_id: crypto.randomUUID(), p_expected_revision: secondOven.revision
    })).error).toBeNull();

    current = asSnapshot((await player.client.rpc('get_tavern_snapshot')).data);
    expect(current.save).toEqual(expect.objectContaining({
      currentDay: 1, dayMinigameCompleted: true, dailyCraftKind: null
    }));
    expect(current.bakery.foods).toHaveLength(2);
    expect(current.brewery.beverages).toHaveLength(1);
    expect(current.ingredients).toEqual([]);
  }, 20_000);
});
