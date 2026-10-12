import { describe, expect, it, vi } from 'vitest';
import { runNpcMemorySummaryWorkerCli } from '../../scripts/run-npc-memory-worker-cli';

function signals(argv: readonly string[] = []) {
  const listeners = new Map<string, () => void>();
  return { argv: ['node', 'worker', ...argv], once: vi.fn((signal: string, listener: () => void) => { listeners.set(signal, listener); }), off: vi.fn((signal: string, listener: () => void) => { if (listeners.get(signal) === listener) listeners.delete(signal); }), emit: (signal: string) => listeners.get(signal)?.() };
}

describe('npc memory worker CLI', () => {
  it('loads through Vite SSR and always closes the loader after a one-shot run', async () => {
    const close = vi.fn(async () => {}); const ssrLoadModule = vi.fn(async () => ({})); const jobId = '11111111-1111-4111-8111-111111111111'; const process = signals(['--once', `--job-id=${jobId}`]);
    const run = vi.fn(async ({ signal, once, jobId: selectedJobId }: { signal: AbortSignal; once: boolean; jobId?: string }) => { expect(once).toBe(true); expect(signal.aborted).toBe(false); expect(selectedJobId).toBe(jobId); });
    await runNpcMemorySummaryWorkerCli({ process, createViteServer: async () => ({ ssrLoadModule, close } as any), run });
    expect(ssrLoadModule).toHaveBeenCalledWith('/scripts/run-npc-memory-worker.ts');
    expect(close).toHaveBeenCalledOnce(); expect(process.off).toHaveBeenCalledTimes(2);
  });

  it('validates the selected UUID before starting the Vite worker loader', async () => {
    const createViteServer = vi.fn(async () => ({ ssrLoadModule: vi.fn(), close: vi.fn() } as any));
    await expect(runNpcMemorySummaryWorkerCli({ process: signals(['--job-id', 'invalid']), createViteServer })).rejects.toThrow('--job-id requires a valid UUID.');
    expect(createViteServer).not.toHaveBeenCalled();
  });

  it('aborts the injected worker on SIGTERM and closes the loader when it fails', async () => {
    const close = vi.fn(async () => {}); const process = signals();
    const run = vi.fn(async ({ signal }: { signal: AbortSignal }) => { process.emit('SIGTERM'); expect(signal.aborted).toBe(true); throw new Error('expected'); });
    await expect(runNpcMemorySummaryWorkerCli({ process, createViteServer: async () => ({ ssrLoadModule: async () => ({ runNpcMemorySummaryWorker: run }), close } as any) })).rejects.toThrow('expected');
    expect(close).toHaveBeenCalledOnce(); expect(process.off).toHaveBeenCalledTimes(2);
  });
});
