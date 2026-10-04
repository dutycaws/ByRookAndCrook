import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

type WorkerRunner = (options: { signal: AbortSignal; once: boolean }) => Promise<void>;
type WorkerModule = { runNpcMemorySummaryWorker?: WorkerRunner };
type SignalProcess = { argv: readonly string[]; once(signal: NodeJS.Signals, listener: () => void): void; off(signal: NodeJS.Signals, listener: () => void): void; };
export type NpcMemoryWorkerCliOptions = { argv?: readonly string[]; createViteServer?: () => Promise<ViteDevServer>; modulePath?: string; process?: SignalProcess; run?: WorkerRunner };
const workerModulePath = '/scripts/run-npc-memory-worker.ts';
const createWorkerModuleLoader = () => createServer({ appType: 'custom', server: { middlewareMode: true } });

/** Uses Vite SSR resolution so SvelteKit server aliases and private env match the app. */
export async function runNpcMemorySummaryWorkerCli(options: NpcMemoryWorkerCliOptions = {}): Promise<void> {
  const processApi = options.process ?? process;
  const controller = new AbortController();
  const stop = () => controller.abort();
  const loader = await (options.createViteServer ?? createWorkerModuleLoader)();
  processApi.once('SIGINT', stop); processApi.once('SIGTERM', stop);
  try {
    const worker = await loader.ssrLoadModule(options.modulePath ?? workerModulePath) as WorkerModule;
    const run = options.run ?? worker.runNpcMemorySummaryWorker;
    if (!run) throw new Error('NPC memory worker module did not export runNpcMemorySummaryWorker.');
    await run({ signal: controller.signal, once: (options.argv ?? processApi.argv).includes('--once') });
  } finally { processApi.off('SIGINT', stop); processApi.off('SIGTERM', stop); await loader.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await runNpcMemorySummaryWorkerCli();
