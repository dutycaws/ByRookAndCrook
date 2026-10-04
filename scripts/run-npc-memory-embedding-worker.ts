import { setTimeout as wait } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { env as privateEnv } from '$env/dynamic/private';
import { getSupabaseConfig } from '$lib/server/config';
import { createNpcMemoryEmbeddingProvider, drainNpcMemoryQueue, type NpcMemoryOutcome, type NpcMemoryWorkerClient, type NpcMemoryWorkerRuntime } from '$lib/server/npc-memory';
import { privateRuntimeEnvironment } from '$lib/server/private-runtime-environment';

const DRAIN_LIMIT = 4;
const DEFAULT_POLL_MS = 15_000;
const DEFAULT_DEADLINE_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type EmbeddingConfig = Record<string, string | undefined>;
type EmbeddingDrain = (limit: number, signal: AbortSignal) => Promise<NpcMemoryOutcome[]>;
type QueueDrainer = (limit: number, client: NpcMemoryWorkerClient, runtime: NpcMemoryWorkerRuntime) => Promise<NpcMemoryOutcome[]>;

export type NpcMemoryEmbeddingWorkerOptions = { drain?: EmbeddingDrain; createDrain?: () => EmbeddingDrain | null; once?: boolean; signal?: AbortSignal; pollMs?: number; deadlineMs?: number; log?: Pick<Console, 'info' | 'warn'>; delay?: (ms: number, signal?: AbortSignal) => Promise<void> };

function exactString(value: unknown, maximum: number): value is string { return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maximum; }
function canonicalDimensions(value: unknown): number | null { if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null; const dimensions = Number(value); return Number.isSafeInteger(dimensions) && dimensions <= 4096 ? dimensions : null; }
function validConfig(config: EmbeddingConfig): boolean { return exactString(config.SUPABASE_SERVICE_ROLE_KEY, 4096) && exactString(config.OPENAI_API_KEY, 4096) && exactString(config.NPC_EMBEDDING_MODEL, 120) && exactString(config.NPC_EMBEDDING_PROCESSOR_VERSION, 120) && canonicalDimensions(config.NPC_EMBEDDING_DIMENSIONS) !== null; }
function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function activeSchedule(value: unknown, limit: number, version: string): boolean { return exactKeys(value, ['scheduled', 'semanticAvailable', 'profileId', 'processorVersion']) && value.semanticAvailable === true && Number.isSafeInteger(value.scheduled) && (value.scheduled as number) >= 0 && (value.scheduled as number) <= limit && typeof value.profileId === 'string' && UUID.test(value.profileId) && typeof value.processorVersion === 'string' && value.processorVersion === version; }

/** Schedules embedding work before every bounded queue drain. */
export function createNpcMemoryEmbeddingDrain(client: NpcMemoryWorkerClient, config: EmbeddingConfig, queueDrainer: QueueDrainer = drainNpcMemoryQueue): EmbeddingDrain | null {
  if (!validConfig(config)) return null;
  const provider = createNpcMemoryEmbeddingProvider(config);
  const processorVersion = config.NPC_EMBEDDING_PROCESSOR_VERSION!;
  return async (requestedLimit, signal) => {
    const limit = Math.max(1, Math.min(DRAIN_LIMIT, requestedLimit));
    const scheduled = await client.rpc('world_npc_memory_embedding_schedule', { p_limit: limit });
    if (scheduled.error) throw new Error('Embedding schedule unavailable.');
    if (exactKeys(scheduled.data, ['scheduled', 'semanticAvailable', 'reason']) && scheduled.data.scheduled === 0 && scheduled.data.semanticAvailable === false && scheduled.data.reason === 'no_active_profile') return [];
    if (!activeSchedule(scheduled.data, limit, processorVersion)) throw new Error('Embedding schedule malformed.');
    return queueDrainer(limit, client, { processorKind: 'embedding', processorVersion, embeddingProvider: provider, embeddingSignal: signal, loadSource: async () => { throw new Error('Embedding uses canonical plans.'); } });
  };
}

function defaultDrain(): EmbeddingDrain | null { const config = privateRuntimeEnvironment(privateEnv); if (!validConfig(config)) return null; try { return createNpcMemoryEmbeddingDrain(createClient(getSupabaseConfig().url, config.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as NpcMemoryWorkerClient, config); } catch { return null; } }
function childDeadline(parent: AbortSignal | undefined, deadlineMs: number): { signal: AbortSignal; close(): void } { const controller = new AbortController(); const abort = () => controller.abort(); if (parent?.aborted) controller.abort(); else parent?.addEventListener('abort', abort, { once: true }); const timer = setTimeout(abort, Math.max(1, deadlineMs)); return { signal: controller.signal, close: () => { clearTimeout(timer); parent?.removeEventListener('abort', abort); } }; }
function statusClasses(outcomes: NpcMemoryOutcome[]): string { const statuses = new Set(outcomes.map((outcome) => outcome.status).filter((status) => /^[a-z_]{1,40}$/.test(status))); return [...statuses].sort().join(',') || 'none'; }

/** Runs serial, bounded embedding passes and exposes only count/status-class telemetry. */
export async function runNpcMemoryEmbeddingWorker(options: NpcMemoryEmbeddingWorkerOptions = {}): Promise<void> {
  const signal = options.signal, log = options.log ?? console, drain = options.drain ?? options.createDrain?.() ?? defaultDrain();
  if (!drain || signal?.aborted) { if (!signal?.aborted) log.warn('[npc-memory:embedding] worker unavailable.'); return; }
  const pollMs = Math.max(1, options.pollMs ?? DEFAULT_POLL_MS), deadlineMs = Math.max(1, options.deadlineMs ?? DEFAULT_DEADLINE_MS), delay = options.delay ?? ((ms, currentSignal) => wait(ms, undefined, { signal: currentSignal }).then(() => undefined));
  do { const deadline = childDeadline(signal, deadlineMs); try { const outcomes = await drain(DRAIN_LIMIT, deadline.signal); if (outcomes.length) log.info(`[npc-memory:embedding] processed ${outcomes.length} job(s): ${statusClasses(outcomes)}.`); } catch { if (!signal?.aborted) log.warn('[npc-memory:embedding] poll failed; retrying.'); } finally { deadline.close(); } if (!options.once && !signal?.aborted) { try { await delay(pollMs, signal); } catch { /* cancellation ends the poll loop */ } } } while (!options.once && !signal?.aborted);
}
