import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

type WorkerRunner = (options: { signal: AbortSignal; once: boolean }) => Promise<void>;
type WorkerModule = { runWorldSettlementWorker?: WorkerRunner };
type SignalProcess = {
  argv: readonly string[];
  once(signal: NodeJS.Signals, listener: () => void): void;
  off(signal: NodeJS.Signals, listener: () => void): void;
};

export type SimulationWorkerCliOptions = {
  argv?: readonly string[];
  createViteServer?: () => Promise<ViteDevServer>;
  modulePath?: string;
  process?: SignalProcess;
  run?: WorkerRunner;
};

const workerModulePath = '/scripts/run-world-settlement-worker.ts';

async function createWorkerModuleLoader(): Promise<ViteDevServer> {
  return createServer({ appType: 'custom', server: { middlewareMode: true } });
}

/**
 * Loads the SvelteKit-aware worker module through Vite's SSR resolver. This
 * keeps `$env` and `$lib` resolution identical to the application without
 * starting an HTTP server or running a queue drain during module loading.
 */
export async function runSimulationWorkerCli(options: SimulationWorkerCliOptions = {}): Promise<void> {
  const processApi = options.process ?? process;
  const controller = new AbortController();
  const stop = () => controller.abort();
  const once = (options.argv ?? processApi.argv).includes('--once');
  const loader = await (options.createViteServer ?? createWorkerModuleLoader)();

  processApi.once('SIGINT', stop);
  processApi.once('SIGTERM', stop);
  try {
    const workerModule = await loader.ssrLoadModule(options.modulePath ?? workerModulePath) as WorkerModule;
    const run = options.run ?? workerModule.runWorldSettlementWorker;
    if (!run) throw new Error('Settlement worker module did not export runWorldSettlementWorker.');
    await run({ signal: controller.signal, once });
  } finally {
    processApi.off('SIGINT', stop);
    processApi.off('SIGTERM', stop);
    await loader.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runSimulationWorkerCli();
}
