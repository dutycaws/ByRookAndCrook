import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

type WorkerRunner = (options: { signal: AbortSignal; once: boolean; jobId?: string }) => Promise<void>;
type WorkerModule = { runNpcMemorySummaryWorker?: WorkerRunner };
type SignalProcess = { argv: readonly string[]; once(signal: NodeJS.Signals, listener: () => void): void; off(signal: NodeJS.Signals, listener: () => void): void; };
export type NpcMemoryWorkerCliOptions = { argv?: readonly string[]; createViteServer?: () => Promise<ViteDevServer>; modulePath?: string; process?: SignalProcess; run?: WorkerRunner };
const workerModulePath = '/scripts/run-npc-memory-worker.ts';
const createWorkerModuleLoader = () => createServer({ appType: 'custom', server: { middlewareMode: true } });

function selectedJobId(argv: readonly string[]): string | undefined {
  const indexes = argv.flatMap((argument, index) => argument === '--job-id' || argument.startsWith('--job-id=') ? [index] : []);
  if (indexes.length > 1) throw new Error('Only one --job-id may be supplied.');
  if (indexes.length === 0) return undefined;
  const index = indexes[0];
  const argument = argv[index];
  const id = argument.startsWith('--job-id=') ? argument.slice('--job-id='.length) : argv[index + 1];
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('--job-id requires a valid UUID.');
  }
  return id;
}

/** Uses Vite SSR resolution so SvelteKit server aliases and private env match the app. */
export async function runNpcMemorySummaryWorkerCli(options: NpcMemoryWorkerCliOptions = {}): Promise<void> {
  const processApi = options.process ?? process;
  const jobId = selectedJobId(options.argv ?? processApi.argv);
  const controller = new AbortController();
  const stop = () => controller.abort();
  const loader = await (options.createViteServer ?? createWorkerModuleLoader)();
  processApi.once('SIGINT', stop); processApi.once('SIGTERM', stop);
  try {
    const worker = await loader.ssrLoadModule(options.modulePath ?? workerModulePath) as WorkerModule;
    const run = options.run ?? worker.runNpcMemorySummaryWorker;
    if (!run) throw new Error('NPC memory worker module did not export runNpcMemorySummaryWorker.');
    await run({ signal: controller.signal, once: (options.argv ?? processApi.argv).includes('--once'), jobId });
  } finally { processApi.off('SIGINT', stop); processApi.off('SIGTERM', stop); await loader.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await runNpcMemorySummaryWorkerCli();
