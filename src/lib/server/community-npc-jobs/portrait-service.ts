/** Server action bridge for portrait work.  It is intentionally not a worker. */
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import type { Database } from '$lib/database.types';
import type { NpcSheet } from '$lib/game/npc-sheet';
import { getSupabaseConfig } from '$lib/server/config';
import {
  authorizedPortraitPreview,
  purgePrivatePortrait,
  portraitProviderAvailability as availability,
  type PortraitControls,
  type PrivatePortraitStorage
} from '$lib/server/community-npc-portraits';
import { runPortraitBatch, type PortraitBatchOutcome, type PortraitCompletionClient } from '$lib/server/community-npc-portraits/service';

export type DispatchPortraitJob = { jobId: string; npcId: string; sheet: NpcSheet; controls: Partial<PortraitControls>; alternatives?: number; visualInputHash: string };
export function portraitProviderAvailability(config: Record<string, string | undefined> = env) { return availability(config); }

type RpcClient = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function serviceClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { url } = getSupabaseConfig();
  return createClient<Database>(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Refreshes the persisted availability used by workspace DTOs before a reservation. */
export async function syncPortraitProviderStatus(config: Record<string, string | undefined> = env) {
  const state = availability(config); const client = serviceClient();
  if (!client) return { available: false, reason: 'service_unavailable' } as const;
  const result = await (client as unknown as RpcClient).rpc('npc_author_set_portrait_provider_status', {
    p_available: state.available, p_provider: state.available ? state.provider : (config.NPC_IMAGE_PROVIDER ?? 'openai'),
    p_model: state.available ? state.model : (config.NPC_IMAGE_MODEL ?? 'gpt-image-2'),
    p_failure_code: state.available ? null : state.reason, p_expires_in_seconds: 60
  });
  if (result.error) return { available: false, reason: 'service_unavailable' } as const;
  return state;
}

/** Resolves an opaque preview grant under the viewer session, then signs only the authorized private object. */
export async function resolvePortraitPreview(viewer: RpcClient, previewToken: string): Promise<string | null> {
  const grant = await viewer.rpc('npc_author_portrait_preview_authorization', { p_token: previewToken });
  const assetId = typeof object(grant.data).assetId === 'string' ? object(grant.data).assetId as string : null;
  const service = serviceClient(); if (grant.error || !assetId || !service) return null;
  try {
    return await authorizedPortraitPreview(service.storage as unknown as PrivatePortraitStorage, async () => {
      const target = await (service as unknown as RpcClient).rpc('npc_author_portrait_preview_target', { p_asset_id: assetId });
      const key = object(target.data).storageKey; return target.error || typeof key !== 'string' ? null : key;
    });
  } catch {
    // A missing or unreadable private object degrades only that candidate's
    // preview. The rest of the workspace and its recovery actions stay usable.
    return null;
  }
}

/** Work begins only after the author action has atomically reserved its credits. */
export async function dispatchPortraitJob(job: DispatchPortraitJob): Promise<PortraitBatchOutcome> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { status: 'failed', completed: 0, failed: job.alternatives ?? 2, errorCode: 'provider_unavailable' };
  const client = serviceClient()!;
  return runPortraitBatch(client as unknown as PortraitCompletionClient, { ...job, alternatives: job.alternatives ?? 2 }, { config: env, storage: client.storage as unknown as PrivatePortraitStorage });
}

/**
 * Finishes database-authorized physical deletions after governance records
 * have been redacted. Failed removals remain queued for a later admin retry.
 */
export async function drainPortraitDeletionQueue(limit = 20): Promise<{ deleted: number }> {
  const client = serviceClient();
  if (!client) throw new Error('Portrait storage service is unavailable.');
  let deleted = 0;
  while (deleted < Math.max(1, Math.min(limit, 100))) {
    const next = await (client as unknown as RpcClient).rpc('npc_portrait_next_deletion_target', {});
    if (next.error) throw new Error(next.error.message);
    const target = object(next.data);
    if (!Object.keys(target).length) break;
    const assetId = typeof target.assetId === 'string' ? target.assetId : null;
    const claimToken = typeof target.claimToken === 'string' ? target.claimToken : null;
    const runtimeKey = typeof target.derivativeStorageKey === 'string' ? target.derivativeStorageKey : null;
    const masterKey = typeof target.masterStorageKey === 'string' ? target.masterStorageKey : null;
    if (!assetId || !claimToken || !runtimeKey) throw new Error('Portrait deletion target is malformed.');
    await purgePrivatePortrait(client.storage as unknown as PrivatePortraitStorage, { masterKey, runtimeKey });
    const completed = await (client as unknown as RpcClient).rpc('npc_portrait_deletion_complete', {
      p_asset_id: assetId,
      p_claim_token: claimToken
    });
    if (completed.error) throw new Error(completed.error.message);
    deleted += 1;
  }
  return { deleted };
}
