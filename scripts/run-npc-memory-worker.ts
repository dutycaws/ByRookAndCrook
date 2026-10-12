import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { env as privateEnv } from '$env/dynamic/private';
import { getSupabaseConfig } from '$lib/server/config';
import { createNpcMemorySummaryV2Provider, drainNpcMemoryQueue, runNpcMemorySummaryJobById, type NpcMemoryOutcome, type NpcMemoryWorkerClient, type NpcMemoryWorkerRuntime } from '$lib/server/npc-memory';
import { privateRuntimeEnvironment } from '$lib/server/private-runtime-environment';
import { releaseTextPrompt, type PromptSnapshot } from '$lib/server/prompt-registry';
import { PromptRegistryService, promptRegistryService, type PromptRegistryClient } from '$lib/server/prompt-registry/service';

const DRAIN_LIMIT = 4;
const DEFAULT_POLL_MS = 15_000;
const DEFAULT_DEADLINE_MS = 60_000;
const PROMPT_KEY = 'npc_memory.summary.v2' as const;
type SafeStatus = 'completed' | 'failed' | 'reused' | 'skipped';
const SAFE_STATUS = new Set<SafeStatus>(['completed', 'failed', 'reused', 'skipped']);
const SAFE_ERROR_CODES = new Set(['provider_unavailable', 'provider_timeout', 'provider_malformed', 'provider_failed', 'quota_exceeded', 'stale', 'cancelled', 'lease_expired', 'storage_failed', 'moderation_failed', 'registry_unavailable']);

type SummaryConfig = Record<string, string | undefined>;
type SummaryDrain = (limit: number, signal: AbortSignal, jobId?: string) => Promise<NpcMemoryOutcome[]>;
type QueueDrainer = (limit: number, client: NpcMemoryWorkerClient, runtime: NpcMemoryWorkerRuntime) => Promise<NpcMemoryOutcome[]>;
type SafeEvent = Readonly<{ jobId: string; batchOrdinal?: number; promptReleaseId?: string; promptRevisionId?: string; promptKey?: string; status: string; model?: string; durationMs?: number; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; cacheWriteInputTokens?: number; errorCode?: string }>;

export type NpcMemoryWorkerOptions = {
  drain?: SummaryDrain;
  createDrain?: () => SummaryDrain | null;
  pollMs?: number;
  deadlineMs?: number;
  jobId?: string;
  signal?: AbortSignal;
  once?: boolean;
  log?: Pick<Console, 'info' | 'warn'>;
  delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

function statusClasses(outcomes: NpcMemoryOutcome[]): string {
  const statuses = new Set(outcomes.map((outcome) => outcome.status).filter((status) => /^[a-z_]{1,40}$/.test(status)));
  return [...statuses].sort().join(',') || 'none';
}

function childDeadline(parent: AbortSignal | undefined, deadlineMs: number): { signal: AbortSignal; close(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) controller.abort(); else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, Math.max(1, deadlineMs));
  return { signal: controller.signal, close: () => { clearTimeout(timer); parent?.removeEventListener('abort', abort); } };
}

function safePromptEvent(event: SafeEvent): event is SafeEvent & Required<Pick<SafeEvent, 'promptReleaseId' | 'promptRevisionId' | 'promptKey'>> {
  return typeof event.jobId === 'string' && typeof event.promptReleaseId === 'string' && typeof event.promptRevisionId === 'string' && event.promptKey === PROMPT_KEY && SAFE_STATUS.has(event.status as SafeStatus);
}

export function npcMemoryRegistryErrorCode(errorCode: unknown): string | undefined {
  return typeof errorCode === 'string' && SAFE_ERROR_CODES.has(errorCode) ? errorCode : undefined;
}

export function npcMemoryRegistryAttempt(batchOrdinal: unknown): number {
  return Number.isSafeInteger(batchOrdinal) && (batchOrdinal as number) >= 0 ? batchOrdinal as number : 0;
}

/** Creates the v2-only queue drain. It intentionally has no legacy source loader. */
export function createNpcMemorySummaryDrain(client: NpcMemoryWorkerClient & PromptRegistryClient, config: SummaryConfig, registry?: PromptRegistryService, queueDrainer: QueueDrainer = drainNpcMemoryQueue): SummaryDrain | null {
  if (!config.SUPABASE_SERVICE_ROLE_KEY || !config.OPENAI_API_KEY || !config.NPC_CONTEXT_MODEL || !config.NPC_MODEL_INPUT_CAPACITY) return null;
  const activeRegistry = registry ?? promptRegistryService(client);
  const provider = createNpcMemorySummaryV2Provider(config);
  const snapshots = new Map<string, PromptSnapshot>();
  const resolvePinnedPrompt = async (releaseId: string) => {
    let prompt = snapshots.get(releaseId);
    if (!prompt) { prompt = releaseTextPrompt(await activeRegistry.resolve(releaseId), PROMPT_KEY); snapshots.set(releaseId, prompt); }
    return { releaseId: prompt.releaseId, revisionId: prompt.revisionId, key: prompt.key, contractId: prompt.contractId, contractHash: prompt.contractHash, body: prompt.body };
  };
  const recordTelemetry = async (event: SafeEvent) => {
    if (!safePromptEvent(event)) return;
    let prompt = snapshots.get(event.promptReleaseId);
    if (!prompt) { prompt = releaseTextPrompt(await activeRegistry.resolve(event.promptReleaseId), PROMPT_KEY); snapshots.set(event.promptReleaseId, prompt); }
    if (prompt.releaseId !== event.promptReleaseId || prompt.revisionId !== event.promptRevisionId || prompt.key !== event.promptKey) return;
    await activeRegistry.recordSafeRun({ executionId: event.jobId, attempt: npcMemoryRegistryAttempt(event.batchOrdinal), workflow: 'npc_memory_summary', nodeKey: PROMPT_KEY, prompt, status: event.status as 'completed' | 'failed' | 'reused' | 'skipped', model: event.model, durationMs: event.durationMs, inputTokens: event.inputTokens, outputTokens: event.outputTokens, cachedInputTokens: event.cachedInputTokens, cacheWriteInputTokens: event.cacheWriteInputTokens, errorCode: npcMemoryRegistryErrorCode(event.errorCode) });
  };
  const runtime: NpcMemoryWorkerRuntime = {
    processorKind: 'summary', processorVersion: 'npc-memory-summary-v2', summaryV2: provider, summaryV2Model: config.NPC_CONTEXT_MODEL!,
    loadSource: async () => { throw new Error('Legacy NPC memory source loading is unavailable for summary-v2.'); },
    resolvePinnedPrompt, recordTelemetry
  };
  return (limit, signal, jobId) => {
    const activeRuntime = { ...runtime, summaryV2Signal: signal };
    if (jobId) return runNpcMemorySummaryJobById(client, jobId, activeRuntime).then((outcome) => [outcome]);
    return queueDrainer(limit, client, activeRuntime);
  };
}

function defaultDrain(): SummaryDrain | null {
  const config = privateRuntimeEnvironment(privateEnv);
  if (!config.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const client = createClient(getSupabaseConfig().url, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as NpcMemoryWorkerClient & PromptRegistryClient;
    return createNpcMemorySummaryDrain(client, config);
  } catch { return null; }
}

/** Runs bounded serial summary-v2 drains. Each pass owns a fresh deadline signal. */
export async function runNpcMemorySummaryWorker(options: NpcMemoryWorkerOptions = {}): Promise<void> {
  const signal = options.signal;
  const log = options.log ?? console;
  const drain = options.drain ?? options.createDrain?.() ?? defaultDrain();
  if (!drain || signal?.aborted) { if (!signal?.aborted) log.warn('[npc-memory:worker] summary worker unavailable.'); return; }
  const pollMs = Math.max(1, options.pollMs ?? DEFAULT_POLL_MS);
  const deadlineMs = Math.max(1, options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const delay = options.delay ?? ((ms, currentSignal) => wait(ms, undefined, { signal: currentSignal }).then(() => undefined));
  do {
    const deadline = childDeadline(signal, deadlineMs);
    try {
      const outcomes = options.jobId
        ? await drain(1, deadline.signal, options.jobId)
        : await drain(DRAIN_LIMIT, deadline.signal);
      if (outcomes.length) log.info(`[npc-memory:worker] processed ${outcomes.length} summary job(s): ${statusClasses(outcomes)}.`);
    } catch { if (!signal?.aborted) log.warn('[npc-memory:worker] summary poll failed; retrying.'); }
    finally { deadline.close(); }
    if (options.jobId) return;
    if (!options.once && !signal?.aborted) { try { await delay(pollMs, signal); } catch { /* signal cancellation exits promptly */ } }
  } while (!options.once && !signal?.aborted);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { await runNpcMemorySummaryWorker({ signal: controller.signal, once: process.argv.includes('--once') }); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
