import type { Json } from '../../src/lib/database.types';
import { expect } from 'vitest';
import {createTestPlayer} from './local-supabase';
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


export async function createBakedTavern(prefix:string) {
 const player=await createTestPlayer(prefix);
 try {
  const {snapshot,ingredient}=await provisionIngredient(player);
  const ready=await prepareAndOven(player,snapshot,ingredient.id);
  const clock=await player.admin.from('bake_sessions').update({oven_started_at:new Date(Date.now()-30000).toISOString()}).eq('id',ready.sessionId);
  if(clock.error)throw clock.error;
  const completed=await player.client.rpc('complete_bake',{p_save_id:snapshot.save.id,p_session_id:ready.sessionId,p_action_id:crypto.randomUUID(),p_expected_revision:ready.revision});
  if(completed.error)throw completed.error;
  return {...player,saveId:snapshot.save.id,bake:completed.data as any};
 }catch(cause){await player.admin.auth.admin.deleteUser(player.userId);throw cause;}
}
