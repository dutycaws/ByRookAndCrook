import { describe, expect, it, vi } from 'vitest';
import { runNpcMemoryEmbeddingWorkerCli } from '../../scripts/run-npc-memory-embedding-worker-cli';

function fakeProcess(argv: readonly string[] = []) { const handlers = new Map<string, () => void>(); return { argv, once: vi.fn((name: string, fn: () => void) => handlers.set(name, fn)), off: vi.fn((name: string) => handlers.delete(name)), emit: (name: string) => handlers.get(name)?.() }; }
describe('embedding worker cli', () => {
  it('loads the selected module, forwards once, and cleans up', async () => {
    const close = vi.fn(), run = vi.fn(async () => undefined), load = vi.fn(async () => ({})), process = fakeProcess(['--once']);
    await runNpcMemoryEmbeddingWorkerCli({ process, modulePath: '/custom.ts', run, createViteServer: async () => ({ close, ssrLoadModule: load } as any) });
    expect(load).toHaveBeenCalledWith('/custom.ts'); expect(run).toHaveBeenCalledWith(expect.objectContaining({ once: true })); expect(close).toHaveBeenCalledOnce(); expect(process.off).toHaveBeenCalledTimes(2);
  });

  it('uses the worker export when no injection is supplied', async () => {
    const close = vi.fn(), run = vi.fn(async () => undefined);
    await runNpcMemoryEmbeddingWorkerCli({ argv: [], createViteServer: async () => ({ close, ssrLoadModule: vi.fn(async () => ({ runNpcMemoryEmbeddingWorker: run })) } as any) });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ once: false })); expect(close).toHaveBeenCalledOnce();
  });

  it('propagates process signals to the runner and still cleans up on error', async () => {
    const process = fakeProcess(), close = vi.fn(), run = vi.fn(async ({ signal }: { signal: AbortSignal }) => { process.emit('SIGTERM'); expect(signal.aborted).toBe(true); throw new Error('boom'); });
    await expect(runNpcMemoryEmbeddingWorkerCli({ process, run, createViteServer: async () => ({ close, ssrLoadModule: vi.fn() } as any) })).rejects.toThrow('boom');
    expect(close).toHaveBeenCalledOnce(); expect(process.off).toHaveBeenCalledTimes(2);
  });

  it('throws for a missing export and closes the loader', async () => {
    const close = vi.fn();
    await expect(runNpcMemoryEmbeddingWorkerCli({ createViteServer: async () => ({ close, ssrLoadModule: vi.fn(async () => ({})) } as any) })).rejects.toThrow('did not export');
    expect(close).toHaveBeenCalledOnce();
  });
});
