import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';
import {
  parseAdvanceDayReceipt,
  parseBakeGestureReceipt,
  parseBeginBakeOvenReceipt,
  parseCompleteBakeReceipt,
  parseCompleteBrewReceipt,
  parseReceipt,
  parseSnapshot,
  parseStartBakeReceipt,
  parseStartBrewReceipt,
  type AdvanceDayCommand,
  type AdvanceDayReceipt,
  type BakeGestureCommand,
  type BakeGestureReceipt,
  type BeginBakeOvenCommand,
  type BeginBakeOvenReceipt,
  type CompleteBakeCommand,
  type CompleteBakeReceipt,
  type CompleteBrewCommand,
  type CompleteBrewReceipt,
  type GameSnapshot,
  type HarvestCommand,
  type HarvestReceipt,
  type StartBakeCommand,
  type StartBakeReceipt,
  type StartBrewCommand,
  type StartBrewReceipt
} from '$lib/game/contracts';

export class GameServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  PT400: 400,
  PT401: 401,
  PT404: 404,
  PT409: 409,
  PT422: 422
};

function mapDatabaseError(error: { code?: string; message: string }): GameServiceError {
  const code = error.code ?? 'DATABASE_ERROR';
  const status = STATUS_BY_CODE[code] ?? 500;
  const message = status === 500 ? 'The tavern ledger could not be updated.' : error.message;
  return new GameServiceError(message, status, code);
}

export async function getSnapshot(client: SupabaseClient<Database>): Promise<GameSnapshot | null> {
  const { data, error } = await client.rpc('get_tavern_snapshot');
  if (error) throw mapDatabaseError(error);
  return parseSnapshot(data);
}

export async function createTavern(client: SupabaseClient<Database>): Promise<void> {
  const { error } = await client.rpc('create_tavern');
  if (error) throw mapDatabaseError(error);
}

export async function harvestCrop(
  client: SupabaseClient<Database>,
  command: HarvestCommand
): Promise<HarvestReceipt> {
  const startedAt = performance.now();
  const { data, error } = await client.rpc('harvest_crop', {
    p_save_id: command.saveId,
    p_cell_id: command.cellId,
    p_action_id: command.actionId,
    p_expected_revision: command.expectedRevision
  });

  if (error) {
    const mapped = mapDatabaseError(error);
    console.info('harvest_crop', {
      actionId: command.actionId,
      outcome: mapped.code,
      durationMs: Math.round(performance.now() - startedAt)
    });
    throw mapped;
  }

  const receipt = parseReceipt(data);
  console.info('harvest_crop', {
    actionId: receipt.actionId,
    outcome: 'committed',
    revision: receipt.committedRevision,
    durationMs: Math.round(performance.now() - startedAt)
  });
  return receipt;
}

export async function startBrew(
  client: SupabaseClient<Database>,
  command: StartBrewCommand
): Promise<StartBrewReceipt> {
  const { data, error } = await client.rpc('start_brew', {
    p_save_id: command.saveId,
    p_ingredient_batch_id: command.ingredientBatchId,
    p_action_id: command.actionId,
    p_expected_revision: command.expectedRevision
  });
  if (error) throw mapDatabaseError(error);
  return parseStartBrewReceipt(data);
}

export async function completeBrew(
  client: SupabaseClient<Database>,
  command: CompleteBrewCommand
): Promise<CompleteBrewReceipt> {
  const startedAt = performance.now();
  const { data, error } = await client.rpc('complete_brew', {
    p_save_id: command.saveId,
    p_session_id: command.sessionId,
    p_action_id: command.actionId,
    p_expected_revision: command.expectedRevision,
    p_perfect_ticks: command.perfectTicks,
    p_good_ticks: command.goodTicks,
    p_total_ticks: command.totalTicks
  });

  if (error) {
    const mapped = mapDatabaseError(error);
    console.info('complete_brew', {
      actionId: command.actionId,
      outcome: mapped.code,
      durationMs: Math.round(performance.now() - startedAt)
    });
    throw mapped;
  }

  const receipt = parseCompleteBrewReceipt(data);
  console.info('complete_brew', {
    actionId: receipt.actionId,
    outcome: 'committed',
    revision: receipt.committedRevision,
    durationMs: Math.round(performance.now() - startedAt)
  });
  return receipt;
}

export async function startBake(
  client: SupabaseClient<Database>,
  command: StartBakeCommand
): Promise<StartBakeReceipt> {
  const { data, error } = await client.rpc('start_bake', {
    p_save_id: command.saveId,
    p_ingredient_batch_id: command.ingredientBatchId,
    p_action_id: command.actionId,
    p_expected_revision: command.expectedRevision
  });
  if (error) throw mapDatabaseError(error);
  return parseStartBakeReceipt(data);
}

export async function foldBake(
  client: SupabaseClient<Database>,
  command: BakeGestureCommand
): Promise<BakeGestureReceipt> {
  const { data, error } = await client.rpc('fold_bake', {
    p_save_id: command.saveId,
    p_session_id: command.sessionId,
    p_action_id: command.actionId,
    p_expected_revision: command.expectedRevision,
    p_distance: command.value
  });
  if (error) throw mapDatabaseError(error);
  return parseBakeGestureReceipt(data);
}

export async function scoreBake(
  client: SupabaseClient<Database>,
  command: BakeGestureCommand
): Promise<BakeGestureReceipt> {
  const { data, error } = await client.rpc('score_bake', {
    p_save_id: command.saveId,
    p_session_id: command.sessionId,
    p_action_id: command.actionId,
    p_expected_revision: command.expectedRevision,
    p_length: command.value
  });
  if (error) throw mapDatabaseError(error);
  return parseBakeGestureReceipt(data);
}

export async function beginBakeOven(
  client: SupabaseClient<Database>,
  command: BeginBakeOvenCommand
): Promise<BeginBakeOvenReceipt> {
  const { data, error } = await client.rpc('begin_bake_oven', {
    p_save_id: command.saveId,
    p_session_id: command.sessionId,
    p_action_id: command.actionId,
    p_expected_revision: command.expectedRevision
  });
  if (error) throw mapDatabaseError(error);
  return parseBeginBakeOvenReceipt(data);
}

export async function completeBake(
  client: SupabaseClient<Database>,
  command: CompleteBakeCommand
): Promise<CompleteBakeReceipt> {
  const startedAt = performance.now();
  const { data, error } = await client.rpc('complete_bake', {
    p_save_id: command.saveId,
    p_session_id: command.sessionId,
    p_action_id: command.actionId,
    p_expected_revision: command.expectedRevision
  });
  if (error) {
    const mapped = mapDatabaseError(error);
    console.info('complete_bake', {
      actionId: command.actionId,
      outcome: mapped.code,
      durationMs: Math.round(performance.now() - startedAt)
    });
    throw mapped;
  }
  const receipt = parseCompleteBakeReceipt(data);
  console.info('complete_bake', {
    actionId: receipt.actionId,
    outcome: 'committed',
    revision: receipt.committedRevision,
    durationMs: Math.round(performance.now() - startedAt)
  });
  return receipt;
}

export async function advanceDay(
  client: SupabaseClient<Database>,
  command: AdvanceDayCommand
): Promise<AdvanceDayReceipt> {
  const { data, error } = await client.rpc('advance_tavern_day', {
    p_save_id: command.saveId,
    p_action_id: command.actionId,
    p_expected_revision: command.expectedRevision
  });
  if (error) throw mapDatabaseError(error);
  return parseAdvanceDayReceipt(data);
}
