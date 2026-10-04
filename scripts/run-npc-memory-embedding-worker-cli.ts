import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
type WorkerRunner = (options: { signal: AbortSignal; once: boolean }) => Promise<void>;
type WorkerModule = { runNpcMemoryEmbeddingWorker?: WorkerRunner };
type SignalProcess = { argv: readonly string[]; once(signal: NodeJS.Signals, listener: () => void): void; off(signal: NodeJS.Signals, listener: () => void): void; };
export type NpcMemoryEmbeddingWorkerCliOptions = { argv?: readonly string[]; createViteServer?: () => Promise<ViteDevServer>; modulePath?: string; process?: SignalProcess; run?: WorkerRunner };
const workerModulePath = '/scripts/run-npc-memory-embedding-worker.ts';
const createWorkerModuleLoader = () => createServer({ appType: 'custom', server: { middlewareMode: true } });
/** Loads the server worker through Vite so aliases and private environment resolution match the app. */
export async function runNpcMemoryEmbeddingWorkerCli(options: NpcMemoryEmbeddingWorkerCliOptions = {}): Promise<void> {
  const processApi = options.process ?? process, controller = new AbortController(), stop = () => controller.abort(), loader = await (options.createViteServer ?? createWorkerModuleLoader)();
  processApi.once('SIGINT', stop); processApi.once('SIGTERM', stop);
  try { const worker = await loader.ssrLoadModule(options.modulePath ?? workerModulePath) as WorkerModule; const run = options.run ?? worker.runNpcMemoryEmbeddingWorker; if (!run) throw new Error('NPC memory embedding worker module did not export runNpcMemoryEmbeddingWorker.'); await run({ signal: controller.signal, once: (options.argv ?? processApi.argv).includes('--once') }); }
  finally { processApi.off('SIGINT', stop); processApi.off('SIGTERM', stop); await loader.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await runNpcMemoryEmbeddingWorkerCli();
