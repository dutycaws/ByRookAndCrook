import { describe, expect, it, vi } from 'vitest';
import { createNpcMemorySummaryDrain, npcMemoryRegistryAttempt, npcMemoryRegistryErrorCode, runNpcMemorySummaryWorker } from '../../scripts/run-npc-memory-worker';
import { PromptRegistryService } from '$lib/server/prompt-registry/service';
import { sha256Hex } from '$lib/server/prompt-registry/template';

describe('npc memory summary runner', () => {
  it('runs exactly one bounded serial drain for --once with a caller-owned deadline', async () => {
    const drain = vi.fn(async () => [{ status: 'completed' as const, artifacts: 1, fallback: false }]);
    const info = vi.fn();
    await runNpcMemorySummaryWorker({ once: true, drain, deadlineMs: 1000, log: { info, warn: vi.fn() } });
    expect(drain).toHaveBeenCalledTimes(1);
    expect(drain).toHaveBeenCalledWith(4, expect.any(AbortSignal));
    expect(info).toHaveBeenCalledWith('[npc-memory:worker] processed 1 summary job(s): completed.');
  });

  it('runs a selected job once without entering the global queue drain', async () => {
    const jobId = '11111111-1111-4111-8111-111111111111';
    const drain = vi.fn(async () => [{ status: 'completed' as const, artifacts: 1, fallback: false }]);
    const delay = vi.fn(async () => {});
    await runNpcMemorySummaryWorker({ jobId, drain, deadlineMs: 1000, delay, log: { info: vi.fn(), warn: vi.fn() } });
    expect(drain).toHaveBeenCalledTimes(1);
    expect(drain).toHaveBeenCalledWith(1, expect.any(AbortSignal), jobId);
    expect(delay).not.toHaveBeenCalled();
  });

  it('loops serially, creates fresh pass signals, and exits when the caller aborts', async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const drain = vi.fn(async (_limit: number, signal: AbortSignal) => { signals.push(signal); if (signals.length === 2) controller.abort(); return []; });
    const delay = vi.fn(async () => {});
    await runNpcMemorySummaryWorker({ drain, signal: controller.signal, pollMs: 1, deadlineMs: 1000, delay, log: { info: vi.fn(), warn: vi.fn() } });
    expect(drain).toHaveBeenCalledTimes(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it('does not claim work when required configuration is absent and logs no configuration detail', async () => {
    const warn = vi.fn();
    await runNpcMemorySummaryWorker({ once: true, createDrain: () => null, log: { info: vi.fn(), warn } });
    expect(warn).toHaveBeenCalledWith('[npc-memory:worker] summary worker unavailable.');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
    expect(createNpcMemorySummaryDrain({ rpc: vi.fn() } as any, {})).toBeNull();
  });

  it('logs only bounded counts and status classes, never job or evidence strings', async () => {
    const info = vi.fn();
    await runNpcMemorySummaryWorker({ once: true, drain: async () => [{ status: 'failed', errorCode: 'hidden_evidence_never_log' }], log: { info, warn: vi.fn() } });
    expect(info).toHaveBeenCalledWith('[npc-memory:worker] processed 1 summary job(s): failed.');
    expect(JSON.stringify(info.mock.calls)).not.toContain('hidden_evidence_never_log');
  });

  it('forwards only registry-supported error codes into safe telemetry', () => {
    expect(npcMemoryRegistryErrorCode('provider_timeout')).toBe('provider_timeout');
    expect(npcMemoryRegistryErrorCode('worker_failed')).toBeUndefined();
    expect(npcMemoryRegistryErrorCode('prompt body must never be logged')).toBeUndefined();
    expect(npcMemoryRegistryAttempt(3)).toBe(3);
    expect(npcMemoryRegistryAttempt(-1)).toBe(0);
    expect(npcMemoryRegistryAttempt('2')).toBe(0);
  });

  it('resolves and caches the exact pinned v2 prompt while mapping only safe telemetry', async () => {
    const prompt = { releaseId: '77777777-7777-4777-8777-777777777777', revisionId: '88888888-8888-4888-8888-888888888888', key: 'npc_memory.summary.v2' as const, revision: 1, promptType: 'text_system' as const, body: 'never forward this prompt body', contractId: 'npc-memory-summary-v2', contractHash: 'f279a108f11e212c77e4876521e9ee47092171b6d2a820d83a245d57a3c64e03', modelLane: 'context' as const };
    const client = { rpc: vi.fn(async (name: string, _args?: Record<string, unknown>) => name === 'prompt_registry_service_resolve' ? { data: { releaseId: prompt.releaseId, releaseNumber: 1, label: 'test', prompts: { [prompt.key]: { ...prompt, contentHash: sha256Hex(prompt.body), workflow: 'npc_memory_summary' } }, createdAt: '', createdBy: 'test' }, error: null } : { data: null, error: null }) };
    const registry = new PromptRegistryService(client);
    const drain = createNpcMemorySummaryDrain(client as any, { SUPABASE_SERVICE_ROLE_KEY: 'service', OPENAI_API_KEY: 'key', NPC_CONTEXT_MODEL: 'model', NPC_MODEL_INPUT_CAPACITY: '90000' }, registry, async (_limit, _client, runtime) => {
      const pinned = await (runtime.resolvePinnedPrompt as (releaseId: string) => Promise<any>)(prompt.releaseId);
      expect(pinned).toMatchObject({ releaseId: prompt.releaseId, revisionId: prompt.revisionId, key: prompt.key, contractId: prompt.contractId, contractHash: prompt.contractHash });
      await (runtime.recordTelemetry as (event: any) => Promise<void>)({ jobId: '11111111-1111-4111-8111-111111111111', batchOrdinal: 3, planHash: 'secret-plan', promptReleaseId: prompt.releaseId, promptRevisionId: prompt.revisionId, promptKey: prompt.key, status: 'failed', model: 'model', durationMs: 2, inputTokens: 3, outputTokens: 4, cachedInputTokens: 0, cacheWriteInputTokens: 2, errorCode: 'worker_failed', promptBody: prompt.body, result: 'secret result', quote: 'secret quote' });
      return [];
    });
    await drain?.(4, new AbortController().signal);
    expect(client.rpc.mock.calls.filter(([name]) => name === 'prompt_registry_service_resolve')).toHaveLength(1);
    const record = client.rpc.mock.calls.find(([name]) => name === 'prompt_registry_service_record_run')?.[1];
    expect(record).toMatchObject({ p_execution_id: '11111111-1111-4111-8111-111111111111', p_attempt: 3, p_workflow: 'npc_memory_summary', p_node_key: prompt.key, p_prompt_key: prompt.key, p_release_id: prompt.releaseId, p_revision_id: prompt.revisionId, p_status: 'failed', p_model: 'model', p_duration_ms: 2, p_input_tokens: 3, p_output_tokens: 4, p_cached_input_tokens: 0, p_cache_write_input_tokens: 2, p_error_code: null });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('secret-plan'); expect(serialized).not.toContain(prompt.body); expect(serialized).not.toContain('secret result'); expect(serialized).not.toContain('secret quote');
  });

  it('routes a selected job through the ID-scoped RPC instead of the global drainer', async () => {
    const jobId = '11111111-1111-4111-8111-111111111111';
    const client = { rpc: vi.fn(async () => ({ data: { status: 'idle' }, error: null })) };
    const globalDrain = vi.fn(async () => []);
    const selectedDrain = createNpcMemorySummaryDrain(client as any, {
      SUPABASE_SERVICE_ROLE_KEY: 'service', OPENAI_API_KEY: 'key', NPC_CONTEXT_MODEL: 'model', NPC_MODEL_INPUT_CAPACITY: '90000'
    }, undefined, globalDrain);
    await expect(selectedDrain?.(4, new AbortController().signal, jobId)).resolves.toEqual([{ status: 'idle' }]);
    expect(client.rpc).toHaveBeenCalledWith('world_npc_memory_claim_selected', { p_job_id: jobId });
    expect(globalDrain).not.toHaveBeenCalled();
  });
});
