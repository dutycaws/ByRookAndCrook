import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';
import { parseBarSnapshot, parseServeReceipt, type ServeCommand } from '$lib/game/serving';
import { GameServiceError } from './game';

function failure(cause: { code: string; message: string }): GameServiceError {
  const status = ({ PT400: 400, PT401: 401, PT404: 404, PT409: 409, PT422: 422 } as Record<string, number>)[cause.code] ?? 500;
  return new GameServiceError(status >= 500 ? 'The bar ledger is unavailable. Please try again.' : cause.message, status, cause.code);
}

export async function getBarSnapshot(client: SupabaseClient<Database>) {
  // Roster and journals have their own bounded APIs; never open the Bar by
  // aggregating every resident into a snapshot.
  const { data, error } = await (client.rpc as any)('npc_bar_summary');
  if (error) throw failure(error);
  return parseBarSnapshot(data);
}

export async function serveHospitality(client: SupabaseClient<Database>, command: ServeCommand) {
  const start = performance.now();
  const { data, error } = await client.rpc('npc_serve_hospitality', {
    p_save_id: command.saveId, p_instance_id: command.instanceId,
    p_item_kind: command.itemKind, p_item_id: command.itemId,
    p_action_id: command.actionId, p_expected_revision: command.expectedRevision
  });
  console.info('serve_hospitality', {
    actionId: command.actionId, itemKind: command.itemKind,
    outcome: error?.code ?? 'committed', durationMs: Math.round(performance.now() - start)
  });
  if (error) throw failure(error);
  return parseServeReceipt(data);
}
