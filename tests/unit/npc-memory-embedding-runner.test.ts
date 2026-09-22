import { describe, expect, it, vi } from 'vitest';
import { createNpcMemoryEmbeddingDrain, runNpcMemoryEmbeddingWorker } from '../../scripts/run-npc-memory-embedding-worker';

const config = { SUPABASE_SERVICE_ROLE_KEY: 'service', OPENAI_API_KEY: 'key', NPC_EMBEDDING_MODEL: 'model', NPC_EMBEDDING_DIMENSIONS: '2', NPC_EMBEDDING_PROCESSOR_VERSION: 'v1' };
const active = { scheduled: 0, semanticAvailable: true, profileId: '11111111-1111-4111-8111-111111111111', processorVersion: 'v1' };
const client = (data: unknown, error: { message: string } | null = null) => ({ rpc: vi.fn(async () => ({ data, error })) });

describe('embedding runner config and scheduling', () => {
  it.each([
    ['missing service key', { SUPABASE_SERVICE_ROLE_KEY: undefined }], ['whitespace key', { SUPABASE_SERVICE_ROLE_KEY: ' service' }], ['oversize api key', { OPENAI_API_KEY: 'x'.repeat(4097) }],
    ['blank model', { NPC_EMBEDDING_MODEL: '' }], ['oversize model', { NPC_EMBEDDING_MODEL: 'x'.repeat(121) }], ['blank version', { NPC_EMBEDDING_PROCESSOR_VERSION: '' }],
    ['oversize version', { NPC_EMBEDDING_PROCESSOR_VERSION: 'x'.repeat(121) }], ['zero dimensions', { NPC_EMBEDDING_DIMENSIONS: '0' }], ['noncanonical dimensions', { NPC_EMBEDDING_DIMENSIONS: '02' }], ['large dimensions', { NPC_EMBEDDING_DIMENSIONS: '4097' }]
  ])('fails closed for %s', (_name, patch) => expect(createNpcMemoryEmbeddingDrain(client(active) as any, { ...config, ...patch })).toBeNull());

  it('schedules before a capped four-item drain and wires the configured runtime', async () => {
    const api = client(active), queue = vi.fn(async () => []);
    const signal = new AbortController().signal;
    await createNpcMemoryEmbeddingDrain(api as any, config, queue)!(99, signal);
    expect(api.rpc).toHaveBeenCalledWith('world_npc_memory_embedding_schedule', { p_limit: 4 });
    expect(queue).toHaveBeenCalledWith(4, api, expect.objectContaining({ processorKind: 'embedding', processorVersion: 'v1', embeddingSignal: signal, embeddingProvider: expect.any(Object) }));
  });

  it('treats no active profile as an intentional empty drain', async () => {
    const api = client({ scheduled: 0, semanticAvailable: false, reason: 'no_active_profile' }), queue = vi.fn();
    await expect(createNpcMemoryEmbeddingDrain(api as any, config, queue)!(4, new AbortController().signal)).resolves.toEqual([]);
    expect(queue).not.toHaveBeenCalled();
  });

  it('still drains once when an active profile schedules zero jobs', async () => {
    const api = client(active), queue = vi.fn(async () => [{ status: 'idle' as const }]);
    await createNpcMemoryEmbeddingDrain(api as any, config, queue)!(4, new AbortController().signal);
    expect(queue).toHaveBeenCalledOnce();
  });

  it.each([
    null, {}, { scheduled: 0, semanticAvailable: false, reason: 'wrong' }, { ...active, profileId: 'nope' }, { ...active, processorVersion: 'other' }, { ...active, scheduled: 5 }, { ...active, extra: true }
  ])('rejects malformed schedule responses', async (data) => {
    await expect(createNpcMemoryEmbeddingDrain(client(data) as any, config)!(4, new AbortController().signal)).rejects.toThrow('Embedding schedule malformed.');
  });

  it('uses a generic error for scheduler errors', async () => {
    await expect(createNpcMemoryEmbeddingDrain(client(null, { message: 'secret' }) as any, config)!(4, new AbortController().signal)).rejects.toThrow('Embedding schedule unavailable.');
  });
});

describe('embedding runner loop', () => {
  const logger = () => ({ info: vi.fn(), warn: vi.fn() });
  it('runs one bounded pass and reports only sorted status classes', async () => {
    const drain = vi.fn(async () => [{ status: 'failed' as const, errorCode: 'secret' }, { status: 'completed' as const, artifacts: 1, fallback: false }]), log = logger();
    await runNpcMemoryEmbeddingWorker({ drain, once: true, log });
    expect(drain).toHaveBeenCalledWith(4, expect.any(AbortSignal));
    expect(log.info).toHaveBeenCalledWith('[npc-memory:embedding] processed 2 job(s): completed,failed.');
  });

  it('warns generically when unavailable or a poll fails', async () => {
    const unavailable = logger(); await runNpcMemoryEmbeddingWorker({ createDrain: () => null, once: true, log: unavailable });
    expect(unavailable.warn).toHaveBeenCalledWith('[npc-memory:embedding] worker unavailable.');
    const failed = logger(); await runNpcMemoryEmbeddingWorker({ drain: vi.fn(async () => { throw new Error('secret'); }), once: true, log: failed });
    expect(failed.warn).toHaveBeenCalledWith('[npc-memory:embedding] poll failed; retrying.');
  });

  it('uses fresh per-pass signals and exits after a parent abort', async () => {
    const parent = new AbortController(), signals: AbortSignal[] = [], drain = vi.fn(async (_limit: number, signal: AbortSignal) => { signals.push(signal); if (signals.length === 2) parent.abort(); return []; });
    await runNpcMemoryEmbeddingWorker({ drain, signal: parent.signal, delay: async () => undefined, log: logger() });
    expect(signals).toHaveLength(2); expect(signals[0]).not.toBe(signals[1]); expect(signals[1]?.aborted).toBe(true);
  });

  it('aborts an active pass on its deadline without starting another pass', async () => {
    let observed: AbortSignal | undefined;
    const drain = vi.fn(async (_limit: number, signal: AbortSignal) => { observed = signal; await new Promise((resolve) => setTimeout(resolve, 10)); return []; });
    await runNpcMemoryEmbeddingWorker({ drain, once: true, deadlineMs: 1, log: logger() });
    expect(observed?.aborted).toBe(true); expect(drain).toHaveBeenCalledOnce();
  });
});
