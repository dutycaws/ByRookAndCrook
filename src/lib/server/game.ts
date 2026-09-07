import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';
import {
  parseReceipt,
  parseSnapshot,
  type GameSnapshot,
  type HarvestCommand,
  type HarvestReceipt
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
