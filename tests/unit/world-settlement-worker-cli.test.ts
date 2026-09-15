import { describe, expect, it, vi } from 'vitest';
import { runSimulationWorkerCli } from '../../scripts/run-world-settlement-worker-cli';

function signals(argv: readonly string[] = []) {
  const listeners = new Map<string, () => void>();
  return {
    argv: ['node', 'worker', ...argv],
    once: vi.fn((signal: string, listener: () => void) => { listeners.set(signal, listener); }),
    off: vi.fn((signal: string, listener: () => void) => { if (listeners.get(signal) === listener) listeners.delete(signal); }),
    emit: (signal: string) => listeners.get(signal)?.()
  };
}

describe('world settlement worker CLI', () => {
  it('uses Vite SSR resolution for the SvelteKit worker and closes its loader after a one-shot run', async () => {
    const close = vi.fn(async () => {});
    const ssrLoadModule = vi.fn(async () => ({ runWorldSettlementWorker: async () => { throw new Error('test runner should replace the worker export'); } }));
    const process = signals(['--once']);
    const run = vi.fn(async ({ signal, once }: { signal: AbortSignal; once: boolean }) => {
      expect(once).toBe(true);
      expect(signal.aborted).toBe(false);
    });

    await runSimulationWorkerCli({
      process,
      createViteServer: async () => ({ ssrLoadModule, close } as any),
      run
    });

    expect(ssrLoadModule).toHaveBeenCalledWith('/scripts/run-world-settlement-worker.ts');
    expect(run).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(process.off).toHaveBeenCalledTimes(2);
  });

  it('loads the real worker dependency graph through Vite without executing a drain', async () => {
    const process = signals(['--once']);
    const run = vi.fn(async () => {});

    await runSimulationWorkerCli({ process, run });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ once: true, signal: expect.any(AbortSignal) }));
  });

  it('aborts the injected worker on SIGTERM and still closes the loader', async () => {
    const close = vi.fn(async () => {});
    const process = signals();
    const run = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      process.emit('SIGTERM');
      expect(signal.aborted).toBe(true);
    });

    await runSimulationWorkerCli({
      process,
      createViteServer: async () => ({ ssrLoadModule: async () => ({ runWorldSettlementWorker: run }), close } as any)
    });

    expect(close).toHaveBeenCalledOnce();
  });
});
