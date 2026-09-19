/** Server action bridge for portrait work.  It is intentionally not a worker. */
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import type { Database } from '$lib/database.types';
import type { NpcSheet } from '$lib/game/npc-sheet';
import { getSupabaseConfig } from '$lib/server/config';
import { privateRuntimeEnvironment } from '$lib/server/private-runtime-environment';
import {
  authorizedPortraitPreview,
  DEFAULT_PORTRAIT_IMAGE_MODEL,
  ensurePrivatePortraitBuckets,
  purgePrivatePortrait,
  portraitProviderAvailability as availability,
  type PortraitControls,
  type PrivatePortraitBucketStorage,
  type PrivatePortraitStorage
} from '$lib/server/community-npc-portraits';
import {
  claimPortraitGenerationAttempt, runPortraitGenerationAttempt,
  type PortraitAttemptOutcome, type PortraitBatchOutcome, type PortraitWorkerClient
} from '$lib/server/community-npc-portraits/service';
import { promptRegistryService } from '$lib/server/prompt-registry/service';

/** Legacy bridge input retained while callers migrate from inline execution. */
export type DispatchPortraitJob = { jobId: string; npcId: string; sheet: NpcSheet; controls: Partial<PortraitControls>; alternatives?: number; visualInputHash: string };
function runtimeConfig() { return privateRuntimeEnvironment(env); }
export function portraitProviderAvailability(config: Record<string, string | undefined> = runtimeConfig()) { return availability(config); }

type RpcClient = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function serviceClient(config = runtimeConfig()) {
  if (!config.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { url } = getSupabaseConfig();
  return createClient<Database>(url, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Service-only storage boundary for upload finalization and worker output. */
export function portraitStorageService(): PrivatePortraitStorage {
  const client = serviceClient();
  if (!client) throw new Error('Portrait storage service is unavailable.');
  return client.storage as unknown as PrivatePortraitStorage;
}

/** Local resets can remove Storage buckets without rerunning fixture seeding. */
export async function readyPortraitStorageService(): Promise<PrivatePortraitStorage> {
  const client = serviceClient();
  if (!client) throw new Error('Portrait storage service is unavailable.');
  const storage = client.storage as unknown as PrivatePortraitBucketStorage;
  await ensurePrivatePortraitBuckets(storage);
  return storage;
}

/** The browser submits bytes to the route; only this service client registers their private keys. */
export async function registerUploadedPortraitCandidate(input: {
  npcId: string; expectedRevision: number; slot: string; metadata: Record<string, unknown>;
}): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
  const client = serviceClient();
  if (!client) return { data: null, error: { message: 'Portrait storage service is unavailable.', code: 'PT503' } };
  const result = await (client as unknown as RpcClient).rpc('npc_author_register_uploaded_portrait', {
    p_npc_id: input.npcId, p_expected_revision: input.expectedRevision, p_slot: input.slot, p_metadata: input.metadata
  });
  return result;
}

/** Refreshes the persisted availability used by workspace DTOs before a reservation. */
export async function syncPortraitProviderStatus(config: Record<string, string | undefined> = runtimeConfig()) {
  const state = availability(config); const client = serviceClient();
  if (!client) return { available: false, reason: 'service_unavailable' } as const;
  const result = await (client as unknown as RpcClient).rpc('npc_author_set_portrait_provider_status', {
    p_available: state.available, p_provider: state.available ? state.provider : (config.NPC_IMAGE_PROVIDER ?? 'openai'),
    p_model: state.available ? state.model : (config.NPC_IMAGE_MODEL ?? DEFAULT_PORTRAIT_IMAGE_MODEL),
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

type WorkerState = { running: boolean; timer: ReturnType<typeof setInterval> | null };
const workerStateKey = Symbol.for('brac.community-npc-portrait-generation-worker');
function workerState(): WorkerState {
  const state = globalThis as typeof globalThis & { [workerStateKey]?: WorkerState };
  return state[workerStateKey] ??= { running: false, timer: null };
}

/**
 * Drains bounded leased work.  The queue is authoritative: a process restart,
 * second server instance, or duplicate wake can neither generate an ordinal
 * twice nor complete it with a stale lease token.
 */
export async function drainPortraitGenerationQueue(limit = 8): Promise<PortraitAttemptOutcome[]> {
  const config = runtimeConfig(); const client = serviceClient(config);
  if (!client) return [];
  const outcomes: PortraitAttemptOutcome[] = [];
  const maximum = Math.max(1, Math.min(limit, 32));
  for (let count = 0; count < maximum; count += 1) {
    const attempt = await claimPortraitGenerationAttempt(client as unknown as PortraitWorkerClient);
    if (!attempt) break;
    outcomes.push(await runPortraitGenerationAttempt(client as unknown as PortraitWorkerClient, attempt, {
      config, storage: client.storage as unknown as PrivatePortraitStorage, promptRegistry: promptRegistryService(client)
    }));
  }
  return outcomes;
}

/** Schedules a non-blocking queue pass. Safe to invoke after every reservation. */
export function wakePortraitGenerationWorker(): void {
  const state = workerState();
  if (state.running) return;
  state.running = true;
  void drainPortraitGenerationQueue().catch(() => {
    // Individual attempts retain an exact safe error in the database. A later
    // timer tick can reclaim only work that never crossed provider dispatch.
  }).finally(() => { state.running = false; });
}

/**
 * Adapter-node bootstrap. It never blocks a request and stays inert in test or
 * unconfigured environments. A short polling cadence complements immediate
 * post-reservation wake-ups when a process restarts mid-job.
 */
export function startPortraitGenerationWorker(intervalMs = 5_000): void {
  const state = workerState();
  if (state.timer) return;
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
  const config = runtimeConfig();
  if (!config.SUPABASE_SERVICE_ROLE_KEY) return;
  state.timer = setInterval(wakePortraitGenerationWorker, Math.max(1_000, Math.min(intervalMs, 60_000)));
  state.timer.unref?.();
  wakePortraitGenerationWorker();
}

/** Test-only and controlled-shutdown cleanup; production workers rely on process exit. */
export function stopPortraitGenerationWorker(): void {
  const state = workerState();
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

/**
 * Compatibility entry point for the legacy action. It deliberately does not
 * execute a provider batch inline: reservation has already persisted ordinals,
 * and the worker will claim them under database fencing.
 */
export async function dispatchPortraitJob(_job: DispatchPortraitJob): Promise<PortraitBatchOutcome> {
  const config = runtimeConfig();
  if (!config.SUPABASE_SERVICE_ROLE_KEY) {
    return { status: 'failed', completed: 0, failed: _job.alternatives ?? 2, errorCode: 'provider_unavailable' };
  }
  wakePortraitGenerationWorker();
  return { status: 'completed', completed: 0, failed: 0 };
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
