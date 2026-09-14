import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { drainWorldSettlementQueue, type SettlementOutcome } from '../src/lib/server/evolving-world/settlement-worker';

export type SimulationWorkerOptions = {
  drain?: (limit: number) => Promise<SettlementOutcome[]>;
  pollMs?: number;
  signal?: AbortSignal;
  log?: Pick<Console, 'info' | 'warn'>;
  once?: boolean;
};

const defaultPollMs = 15_000;

/**
 * Runs one serial local settlement worker. Each poll awaits exactly one
 * `drainWorldSettlementQueue(4)`: the queue processes claims serially, so this
 * process makes at most one provider call at a time and claims at most four
 * jobs per poll.
 */
export async function runWorldSettlementWorker(options: SimulationWorkerOptions = {}): Promise<void> {
  const drain = options.drain ?? drainWorldSettlementQueue;
  const pollMs = options.pollMs ?? defaultPollMs;
  const signal = options.signal;
  const log = options.log ?? console;
  if (signal?.aborted) return;
  do {
    try {
      const outcomes = await drain(4);
      if (outcomes.length > 0) log.info(`[simulation:worker] processed ${outcomes.length} settlement job(s).`);
    } catch {
      // The durable queue and lease fence make a later poll safe. Avoid logging
      // provider or settlement payloads from this unattended local process.
      log.warn('[simulation:worker] settlement poll failed; retrying.');
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
