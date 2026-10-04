import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { env as privateEnv } from '$env/dynamic/private';
import { getSupabaseConfig } from '$lib/server/config';
import { privateRuntimeEnvironment } from '$lib/server/private-runtime-environment';
import { drainWorldSettlementQueue, type SettlementOutcome } from '../src/lib/server/evolving-world/settlement-worker';
import { createOpenAiRuntimeArtProvider, drainRuntimeArtQueue, type RuntimeArtRpc, type RuntimeArtStorage } from '../src/lib/server/evolving-world-art';

type ArtOutcome = { status: string };
type RuntimeArtDrain = (limit: number) => Promise<ArtOutcome[]>;

export type SimulationWorkerOptions = {
  drain?: (limit: number) => Promise<SettlementOutcome[]>;
  artDrain?: RuntimeArtDrain;
  pollMs?: number;
  signal?: AbortSignal;
  log?: Pick<Console, 'info' | 'warn'>;
  once?: boolean;
};

const defaultPollMs = 15_000;

function defaultRuntimeArtDrain(): RuntimeArtDrain {
  const config = privateRuntimeEnvironment(privateEnv);
  if (!config.SUPABASE_SERVICE_ROLE_KEY) return async () => [];
  const client = createClient(getSupabaseConfig().url, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const provider = createOpenAiRuntimeArtProvider(config);
  return (limit) => drainRuntimeArtQueue(client as unknown as RuntimeArtRpc, provider, client.storage as unknown as RuntimeArtStorage, config, {}, limit);
}

function statusClasses(outcomes: ArtOutcome[]): string {
  const classes = new Set(outcomes.map(({ status }) => status).filter((status) => /^[a-z_]{1,40}$/.test(status)));
  return [...classes].sort().join(',') || 'none';
}

/**
 * Runs one serial local settlement worker. Each poll awaits exactly one
 * `drainWorldSettlementQueue(4)` and `drainRuntimeArtQueue(4)` in order. Each
 * drain is serial, so this process makes at most one provider call at a time
 * and claims at most four jobs from either queue per poll.
 */
export async function runWorldSettlementWorker(options: SimulationWorkerOptions = {}): Promise<void> {
  const drain = options.drain ?? drainWorldSettlementQueue;
  const artDrain = options.artDrain ?? defaultRuntimeArtDrain();
  const pollMs = options.pollMs ?? defaultPollMs;
  const signal = options.signal;
  const log = options.log ?? console;
  if (signal?.aborted) return;
  do {
    try {
      const outcomes = await drain(4);
      if (outcomes.length > 0) log.info(`[simulation:worker] processed ${outcomes.length} settlement job(s): ${statusClasses(outcomes)}.`);
    } catch {
      // The durable queue and lease fence make a later poll safe. Avoid logging
      // provider or settlement payloads from this unattended local process.
      log.warn('[simulation:worker] settlement poll failed; retrying.');
    }
    try {
      const outcomes = await artDrain(4);
      if (outcomes.length > 0) log.info(`[simulation:worker] processed ${outcomes.length} runtime-art job(s): ${statusClasses(outcomes)}.`);
    } catch {
      // Never expose provider output, prompt/spec data, object keys, or job IDs
      // from this unattended process. The next leased poll can retry safely.
      log.warn('[simulation:worker] runtime-art poll failed; retrying.');
    }
    if (!options.once && !signal?.aborted) {
      try { await delay(pollMs, undefined, { signal }); }
      catch { /* SIGINT/SIGTERM cancels the poll wait and exits promptly. */ }
    }
  } while (!options.once && !signal?.aborted);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await runWorldSettlementWorker({ signal: controller.signal, once: process.argv.includes('--once') });
}
