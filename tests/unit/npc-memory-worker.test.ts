import { describe, expect, it, vi } from 'vitest';
import { assembleNpcMemoryContext, canonicalJson, sha256Hex, utf8Bytes } from '$lib/server/npc-memory/context';
import { drainNpcMemoryQueue, runNpcMemoryClaim } from '$lib/server/npc-memory/worker';

const id = '11111111-1111-4111-8111-111111111111';
const fence = '22222222-2222-4222-8222-222222222222';
const sourceId = '33333333-3333-4333-8333-333333333333';
const sourceHash = 'a'.repeat(64);
const signal = new AbortController().signal;
const claim = () => ({ id, fence, saveId: '44444444-4444-4444-8444-444444444444', instanceId: '55555555-5555-4555-8555-555555555555', sourceKind: 'dialogue_turn', sourceId, sourceVersion: 1, sourceHash });

function client(error: string | null = null) {
  return { rpc: vi.fn(async (name: string, _args: Record<string, unknown>) => name === 'world_npc_memory_complete' ? { data: null, error: error ? { message: error } : null } : { data: null, error: null }) };
}
function runtime() {
  return { processorKind: 'summary' as const, processorVersion: 'npc-memory-v1', loadSource: async () => ({ records: [
    { id: sourceId, speaker: 'keeper', text: 'I will fund a guide, not weapons.', quote: 'fund a guide, not weapons' },
    { id: '66666666-6666-4666-8666-666666666666', speaker: 'Lira', text: 'I accept those conditions.' }
  ] }) };
}

describe('npc memory worker', () => {
  const v2Claim = () => ({ ...claim(), sourceKind: 'memory_set' as const });
  const v2Plan = () => {
    const set = { id: sourceId, setVersion: 1, setHash: sourceHash, summaryKind: 'episode_summary', cutoffLedgerSequence: 2, disclosureClass: 'npc_known' };
    const prompt = { releaseId: '77777777-7777-4777-8777-777777777777', key: 'npc_memory.summary.v2', revisionId: '88888888-8888-4888-8888-888888888888', contractId: 'npc-memory-summary-v2', contractHash: 'f279a108f11e212c77e4876521e9ee47092171b6d2a820d83a245d57a3c64e03' };
    const base = { version: 'npc-memory-summary-v2-runtime-plan-1', jobId: id, fence, set, prompt, batchCount: 1, maxSummaryChars: 12000, maxCitations: 128, batches: [{ ordinal: 0, firstLeafOrdinal: 0, lastLeafOrdinal: 0, leafCount: 1, maxSummaryChars: 12000, maxCitations: 128 }] };
    return { ...base, planHash: sha256Hex(canonicalJson(base)) };
  };
  const v2Load = () => {
    const plan = v2Plan(); const leaf = { ordinal: 0, sourceKind: 'dialogue_turn', sourceId, sourceVersion: 1, sourceHash, ledgerSequence: 2, envelope: {}, records: [{ id: '99999999-9999-4999-8999-999999999999', speaker: 'keeper', text: 'Exact stored quote.', quote: 'stored quote' }] };
    return { jobId: id, fence, promptReleaseId: plan.prompt.releaseId, promptKey: plan.prompt.key, promptRevisionId: plan.prompt.revisionId, set: plan.set, batch: { ordinal: 0, firstLeafOrdinal: 0, lastLeafOrdinal: 0, leafCount: 1 }, leaves: [leaf] };
  };
  const v2Refs = () => v2Load().leaves.map(({ ordinal, sourceKind, sourceId, sourceVersion, sourceHash, ledgerSequence }) => ({ ordinal, sourceKind, sourceId, sourceVersion, sourceHash, ledgerSequence }));
  const finalized = (fallback: boolean) => ({ status: 'completed', fallback, contentHash: 'd'.repeat(64) });
  const prepared = () => { const body: any = { model: 'fixture', store: false, max_output_tokens: 4096, text: { format: { schema: { properties: { summary: { maxLength: 12000 }, citations: { maxItems: 16 } } } } } }; Object.freeze(body); return Object.freeze({ body, model: 'fixture', inputTokens: 1, maxSummaryChars: 12000, maxCitations: 16 }); };
  const v2Runtime = (provider = { preflight: vi.fn(async () => ({ prepared: prepared(), inputTokens: 1, durationMs: 1 })), generate: vi.fn(async () => ({ result: { version: 'npc-memory-summary-v2', mode: 'model', summary: 'safe', citations: [], protectedRefs: v2Refs(), leaves: v2Refs() }, model: 'fixture', inputTokens: 1, outputTokens: 1, durationMs: 1 })) }) => ({ processorKind: 'summary' as const, processorVersion: 'npc-memory-summary-v2', loadSource: async () => ({ records: [] }), summaryV2: provider, summaryV2Model: 'fixture', summaryV2Signal: signal, resolvePinnedPrompt: async (releaseId: string) => ({ releaseId, revisionId: v2Plan().prompt.revisionId, key: 'npc_memory.summary.v2', contractId: 'npc-memory-summary-v2', contractHash: 'f279a108f11e212c77e4876521e9ee47092171b6d2a820d83a245d57a3c64e03', body: 'Pinned prompt' }) });

  it('prepares before remote token preflight, then dispatches immediately before its one generation', async () => {
    const calls: string[] = [];
    const api = { rpc: vi.fn(async (name: string) => { calls.push(name); const data: Record<string, unknown> = name === 'world_npc_memory_summary_plan_v2' ? v2Plan() : name === 'world_npc_memory_summary_recover_dispatch' ? { directive: 'fallback_only', reason: 'no_prior_receipt' } : name === 'world_npc_memory_summary_load' ? v2Load() : name === 'world_npc_memory_summary_prepare_dispatch' ? { state: 'prepared', idempotencyKey: 'key', identityHash: 'b'.repeat(64), requestHash: 'c'.repeat(64) } : name === 'world_npc_memory_summary_finalize_v2' ? finalized(false) : {}; return { data, error: null }; }) };
    const provider = { preflight: vi.fn(async () => ({ prepared: prepared(), inputTokens: 1, durationMs: 1 })), generate: vi.fn(async () => ({ result: { version: 'npc-memory-summary-v2', mode: 'model', summary: 'safe', citations: [], protectedRefs: v2Refs(), leaves: v2Refs() }, model: 'fixture', inputTokens: 1, outputTokens: 1, durationMs: 1 })) };
    await expect(runNpcMemoryClaim(api, v2Claim(), v2Runtime(provider))).resolves.toEqual({ status: 'completed', artifacts: 1, fallback: false });
    expect(calls).toEqual(['world_npc_memory_summary_plan_v2','world_npc_memory_summary_recover_dispatch','world_npc_memory_summary_load','world_npc_memory_summary_prepare_dispatch','world_npc_memory_summary_mark_dispatched','world_npc_memory_summary_record_dispatch_result','world_npc_memory_summary_finalize_v2']);
    expect(provider.preflight).toHaveBeenCalledTimes(1); expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('never resends prepared or dispatched recovery states and finalizes extractively', async () => {
    const api = { rpc: vi.fn(async (name: string) => ({ data: name === 'world_npc_memory_summary_plan_v2' ? v2Plan() : name === 'world_npc_memory_summary_recover_dispatch' ? { directive: 'fallback_only', reason: 'prepared_receipt' } : finalized(true), error: null })) };
    const provider = { preflight: vi.fn(), generate: vi.fn() } as any;
    await expect(runNpcMemoryClaim(api, v2Claim(), v2Runtime(provider))).resolves.toEqual({ status: 'completed', artifacts: 1, fallback: true });
    expect(provider.preflight).not.toHaveBeenCalled(); expect(provider.generate).not.toHaveBeenCalled();
    expect(api.rpc.mock.calls.map(([name]) => name)).toEqual(['world_npc_memory_summary_plan_v2','world_npc_memory_summary_recover_dispatch','world_npc_memory_summary_finalize_v2']);
  });

  it('treats malformed plans and provider failures as finalizer-only paths without generic completion', async () => {
    const api = { rpc: vi.fn(async (name: string) => ({ data: name === 'world_npc_memory_summary_plan_v2' ? { ...v2Plan(), planHash: '0'.repeat(64) } : finalized(true), error: null })) };
    await expect(runNpcMemoryClaim(api, v2Claim(), v2Runtime())).resolves.toEqual({ status: 'completed', artifacts: 1, fallback: true });
    expect(api.rpc.mock.calls.map(([name]) => name)).toEqual(['world_npc_memory_summary_plan_v2','world_npc_memory_summary_finalize_v2']);
    expect(api.rpc).not.toHaveBeenCalledWith('world_npc_memory_complete', expect.anything());
  });

  it.each([
    ['prompt mismatch', 'prompt'], ['load mismatch', 'load'], ['bad prepare', 'prepare'], ['record failure', 'record']
  ])('routes %s to finalizer without dispatching or generic completion', async (_label, stage) => {
    const calls: string[] = []; const provider = { preflight: vi.fn(async () => ({ prepared: prepared(), inputTokens: 1, durationMs: 1 })), generate: vi.fn(async () => ({ result: { version: 'npc-memory-summary-v2', mode: 'model', summary: 'safe', citations: [], protectedRefs: v2Refs(), leaves: v2Refs() }, model: 'fixture', inputTokens: 1, outputTokens: 1, durationMs: 1 })) };
    const api = { rpc: vi.fn(async (name: string) => { calls.push(name); if (stage === 'record' && name === 'world_npc_memory_summary_record_dispatch_result') return { data: null, error: { message: 'record failed' } }; const data: any = name === 'world_npc_memory_summary_plan_v2' ? v2Plan() : name === 'world_npc_memory_summary_recover_dispatch' ? { directive: 'fallback_only', reason: 'no_prior_receipt' } : name === 'world_npc_memory_summary_load' ? (stage === 'load' ? { ...v2Load(), promptKey: 'bad' } : v2Load()) : name === 'world_npc_memory_summary_prepare_dispatch' ? (stage === 'prepare' ? {} : { state: 'prepared', idempotencyKey: 'key', identityHash: 'b'.repeat(64), requestHash: 'c'.repeat(64) }) : finalized(true); return { data, error: null }; }) };
    const rt: any = v2Runtime(provider); if (stage === 'prompt') rt.resolvePinnedPrompt = async (releaseId: string) => ({ ...(await v2Runtime().resolvePinnedPrompt!(releaseId)), body: '' });
    await expect(runNpcMemoryClaim(api, v2Claim(), rt)).resolves.toMatchObject({ status: 'completed' });
    expect(calls).toContain('world_npc_memory_summary_finalize_v2'); expect(calls).not.toContain('world_npc_memory_complete');
    if (stage !== 'record') expect(provider.generate).not.toHaveBeenCalled();
  });

  it('reuses received work with zero provider calls and treats stale plan/finalizer as lease loss', async () => {
    const provider: any = { preflight: vi.fn(), generate: vi.fn() };
    const api = { rpc: vi.fn(async (name: string) => ({ data: name === 'world_npc_memory_summary_plan_v2' ? v2Plan() : name === 'world_npc_memory_summary_recover_dispatch' ? { directive: 'reuse_result' } : finalized(false), error: null })) };
    await expect(runNpcMemoryClaim(api, v2Claim(), v2Runtime(provider))).resolves.toMatchObject({ status: 'completed' }); expect(provider.preflight).not.toHaveBeenCalled(); expect(provider.generate).not.toHaveBeenCalled();
    const staleApi = { rpc: vi.fn(async () => ({ data: null, error: { message: 'Summary runtime plan fence is stale' } })) };
    await expect(runNpcMemoryClaim(staleApi, v2Claim(), v2Runtime(provider))).resolves.toEqual({ status: 'lease_lost' }); expect(staleApi.rpc).not.toHaveBeenCalledWith('world_npc_memory_complete', expect.anything());
  });

  it('never resends after a lost post-mark generation attempt is reclaimed', async () => {
    let generation = 0; const provider: any = { preflight: vi.fn(async () => ({ prepared: prepared(), inputTokens: 1, durationMs: 1 })), generate: vi.fn(async () => { generation += 1; throw new Error('network'); }) };
    const first = { rpc: vi.fn(async (name: string) => ({ data: name === 'world_npc_memory_summary_plan_v2' ? v2Plan() : name === 'world_npc_memory_summary_recover_dispatch' ? { directive: 'fallback_only', reason: 'no_prior_receipt' } : name === 'world_npc_memory_summary_load' ? v2Load() : name === 'world_npc_memory_summary_prepare_dispatch' ? { state: 'prepared', idempotencyKey: 'x', identityHash: 'b'.repeat(64), requestHash: 'c'.repeat(64) } : finalized(true), error: null })) };
    await runNpcMemoryClaim(first, v2Claim(), v2Runtime(provider));
    const second = { rpc: vi.fn(async (name: string) => ({ data: name === 'world_npc_memory_summary_plan_v2' ? v2Plan() : name === 'world_npc_memory_summary_recover_dispatch' ? { directive: 'fallback_only', reason: 'prior_attempt_reclaimed' } : finalized(true), error: null })) };
    await runNpcMemoryClaim(second, v2Claim(), v2Runtime(provider));
    expect(generation).toBe(1); expect(provider.preflight).toHaveBeenCalledTimes(1); expect(second.rpc.mock.calls.map(([n]) => n)).toEqual(['world_npc_memory_summary_plan_v2','world_npc_memory_summary_recover_dispatch','world_npc_memory_summary_finalize_v2']); expect([...first.rpc.mock.calls, ...second.rpc.mock.calls].map(([n]) => n)).not.toContain('world_npc_memory_complete');
  });

  it('emits only the exact safe telemetry allowlist, never prompt, load, result, or quote text', async () => {
    const events: Record<string, unknown>[] = [];
    const api = { rpc: vi.fn(async (name: string) => ({ data: name === 'world_npc_memory_summary_plan_v2' ? v2Plan() : name === 'world_npc_memory_summary_recover_dispatch' ? { directive: 'fallback_only', reason: 'no_prior_receipt' } : name === 'world_npc_memory_summary_load' ? v2Load() : name === 'world_npc_memory_summary_prepare_dispatch' ? { state: 'prepared', idempotencyKey: 'key', identityHash: 'b'.repeat(64), requestHash: 'c'.repeat(64) } : name === 'world_npc_memory_summary_finalize_v2' ? finalized(false) : {}, error: null })) };
    const rt = { ...v2Runtime(), recordTelemetry: (event: Record<string, unknown>) => { events.push(event); } };
    await expect(runNpcMemoryClaim(api, v2Claim(), rt)).resolves.toMatchObject({ status: 'completed' });
    const allowed = ['batchOrdinal', 'durationMs', 'errorCode', 'inputTokens', 'jobId', 'model', 'outputTokens', 'planHash', 'promptKey', 'promptReleaseId', 'promptRevisionId', 'status'];
    expect(events).toHaveLength(2);
    for (const event of events) expect(Object.keys(event).sort()).toEqual(expect.arrayContaining(['jobId', 'planHash', 'promptKey', 'promptReleaseId', 'promptRevisionId', 'status']));
    for (const event of events) expect(Object.keys(event).every((key) => allowed.includes(key))).toBe(true);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('Pinned prompt');
    expect(serialized).not.toContain('Exact stored quote.');
    expect(serialized).not.toContain('stored quote');
    expect(serialized).not.toContain('safe');
  });

  it('treats a recorder throw as nonfatal and a reclaimed dispatch as no-resend work', async () => {
    const provider = { preflight: vi.fn(async () => ({ prepared: prepared(), inputTokens: 1, durationMs: 1 })), generate: vi.fn(async () => ({ result: { version: 'npc-memory-summary-v2', mode: 'model', summary: 'safe', citations: [], protectedRefs: v2Refs(), leaves: v2Refs() }, model: 'fixture', inputTokens: 1, outputTokens: 1, durationMs: 1 })) };
    const first = { rpc: vi.fn(async (name: string) => name === 'world_npc_memory_summary_plan_v2' ? { data: v2Plan(), error: null } : name === 'world_npc_memory_summary_recover_dispatch' ? { data: { directive: 'fallback_only', reason: 'no_prior_receipt' }, error: null } : name === 'world_npc_memory_summary_load' ? { data: v2Load(), error: null } : name === 'world_npc_memory_summary_prepare_dispatch' ? { data: { state: 'prepared', idempotencyKey: 'key', identityHash: 'b'.repeat(64), requestHash: 'c'.repeat(64) }, error: null } : name === 'world_npc_memory_summary_record_dispatch_result' ? { data: null, error: { message: 'recorder unavailable' } } : { data: finalized(true), error: null }) };
    await expect(runNpcMemoryClaim(first, v2Claim(), v2Runtime(provider))).resolves.toEqual({ status: 'completed', artifacts: 1, fallback: true });
    const second = { rpc: vi.fn(async (name: string) => ({ data: name === 'world_npc_memory_summary_plan_v2' ? v2Plan() : name === 'world_npc_memory_summary_recover_dispatch' ? { directive: 'fallback_only', reason: 'prior_attempt_reclaimed' } : finalized(true), error: null })) };
    await expect(runNpcMemoryClaim(second, v2Claim(), v2Runtime(provider))).resolves.toEqual({ status: 'completed', artifacts: 1, fallback: true });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(second.rpc.mock.calls.map(([name]) => name)).toEqual(['world_npc_memory_summary_plan_v2', 'world_npc_memory_summary_recover_dispatch', 'world_npc_memory_summary_finalize_v2']);
  });

  it('fails closed on a malformed finalizer response without generic completion', async () => {
    const api = { rpc: vi.fn(async (name: string) => ({ data: name === 'world_npc_memory_summary_plan_v2' ? { ...v2Plan(), planHash: '0'.repeat(64) } : { fallback: true }, error: null })) };
    await expect(runNpcMemoryClaim(api, v2Claim(), v2Runtime())).resolves.toEqual({ status: 'failed', errorCode: 'worker_failed' });
    expect(api.rpc.mock.calls.map(([name]) => name)).toEqual(['world_npc_memory_summary_plan_v2', 'world_npc_memory_summary_finalize_v2']);
    expect(api.rpc).not.toHaveBeenCalledWith('world_npc_memory_complete', expect.anything());
  });

  it('commits a deterministic extractive summary through the fence-bound completion RPC', async () => {
    const api = client();
    await expect(runNpcMemoryClaim(api, claim(), runtime())).resolves.toEqual({ status: 'completed', artifacts: 1, fallback: true });
    const args = api.rpc.mock.calls.find(([name]) => name === 'world_npc_memory_complete')?.[1];
    if (!args) throw new Error('Memory completion was not called.');
    expect(args).toMatchObject({ p_job_id: id, p_fence: fence, p_error_code: null });
    const artifacts = args.p_artifacts as Array<{ content: { mode: string; summary: string }; contentHash: string }>;
    expect(artifacts[0].content).toMatchObject({ mode: 'extractive-v1' });
    expect(artifacts[0].content.summary).toContain('keeper: I will fund a guide, not weapons.');
    expect(artifacts[0].contentHash).toBe(sha256Hex(canonicalJson(artifacts[0].content)));
  });

  it('does not report a winner when a retry has replaced its fence', async () => {
    await expect(runNpcMemoryClaim(client('Memory work fence is stale'), claim(), runtime())).resolves.toEqual({ status: 'lease_lost' });
  });

  it('terminalizes a valid embedding plan as provider_unavailable when runtime is absent', async () => {
    const plan=embeddingPlan(); const api={rpc:vi.fn(async(name:string,args:any)=>({data:name==='world_npc_memory_embedding_plan'?plan:name==='world_npc_memory_embedding_recover_dispatch'?{directive:'prepare_required',reason:'no_receipt'}:(expect(args).toMatchObject({p_profile_id:plan.profile.id,p_input_hash:plan.inputHash,p_error_code:'provider_unavailable'}),{status:'failed'}),error:null}))};
    await expect(runNpcMemoryClaim(api, claim(), { ...runtime(), processorKind: 'embedding', processorVersion:'embed-v3' })).resolves.toEqual({ status: 'failed', errorCode: 'provider_unavailable' });
    expect(api.rpc.mock.calls.map(([name])=>name)).toEqual(['world_npc_memory_embedding_plan','world_npc_memory_embedding_recover_dispatch','world_npc_memory_embedding_accept']);
    expect(api.rpc).not.toHaveBeenCalledWith('world_npc_memory_complete', expect.anything());
  });

  it('records an unavailable source as a durable gap rather than treating it as a stale fence', async () => {
    const api = client();
    await expect(runNpcMemoryClaim(api, claim(), { ...runtime(), loadSource: async () => { throw new Error('source_unavailable'); } })).resolves.toEqual({ status: 'failed', errorCode: 'source_unavailable' });
    expect(api.rpc).toHaveBeenCalledWith('world_npc_memory_complete', expect.objectContaining({ p_job_id: id, p_fence: fence, p_artifacts: [], p_error_code: 'source_unavailable' }));
  });

  it('drains no more than its bounded claim limit and stops at idle', async () => {
    const api = { rpc: vi.fn(async (name: string) => {
      if (name === 'world_npc_memory_claim') return { data: { status: 'idle' }, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    }) };
    await expect(drainNpcMemoryQueue(99, api, runtime())).resolves.toEqual([{ status: 'idle' }]);
    expect(api.rpc).toHaveBeenCalledTimes(1);
    expect(api.rpc).toHaveBeenCalledWith('world_npc_memory_claim', { p_processor_kind: 'summary', p_processor_version: 'npc-memory-v1' });
  });

  it('caps non-idle draining at 32 claims', async () => {
    const api = { rpc: vi.fn(async (name: string) => {
      if (name === 'world_npc_memory_claim') return { data: claim(), error: null };
      if (name === 'world_npc_memory_complete') return { data: null, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    }) };
    const outcomes = await drainNpcMemoryQueue(99, api, runtime());
    expect(outcomes).toHaveLength(32);
    expect(outcomes.every((outcome) => outcome.status === 'completed')).toBe(true);
    expect(api.rpc.mock.calls.filter(([name]) => name === 'world_npc_memory_claim')).toHaveLength(32);
  });

  it('stops safely when claiming work fails', async () => {
    const api = { rpc: vi.fn(async () => ({ data: null, error: { message: 'database unavailable' } })) };
    await expect(drainNpcMemoryQueue(2, api, runtime())).resolves.toEqual([]);
    expect(api.rpc).toHaveBeenCalledTimes(1);
  });

  it('freezes a byte-accurate, source-hashed context artifact', () => {
    const artifact = assembleNpcMemoryContext({ policyVersion: 'memory-v1', projectionVersion: 'speech-v1', tokenizer: { id: 'verified-test', count: (text) => [...text].length }, maxBytes: 1024, maxTokens: 1024, sources: [{ id: sourceId, version: 1, hash: sourceHash, kind: 'dialogue_turn', ledgerSequence: 1 }], requiredSourceIds: [sourceId], payload: { text: 'e\u0301 👩‍🌾' } });
    expect(artifact.utf8Bytes).toBe(utf8Bytes(artifact.canonicalJson));
    expect(artifact.hash).toBe(sha256Hex(artifact.canonicalJson));
    expect(artifact.canonicalJson).toBe(canonicalJson({ payload: { text: 'e\u0301 👩‍🌾' }, sourceManifest: [{ id: sourceId, version: 1, hash: sourceHash, kind: 'dialogue_turn', ledgerSequence: 1 }], coverage: { required: [sourceId], included: [sourceId], missing: [], complete: true } }));
    expect(Object.isFrozen(artifact.payload)).toBe(true);
  });

  it('uses one verified precomputed context count without calling a legacy tokenizer', () => {
    const legacyCount = vi.fn(() => { throw new Error('legacy tokenizer must not run'); });
    const input = { policyVersion: 'memory-v1', projectionVersion: 'speech-v1', maxBytes: 1024, maxTokens: 1024,
      sources: [{ id: sourceId, version: 1, hash: sourceHash, kind: 'dialogue_turn', ledgerSequence: 1 }], requiredSourceIds: [sourceId],
      payload: { text: 'مرحبا 👩‍🌾' }, tokenCount: 37, tokenizerId: 'openai-responses-input-tokens-v1',
      counterId: 'openai-responses-input-tokens-v1', model: 'gpt-5.6-luna', revision: 0 };
    const artifact = assembleNpcMemoryContext({...input, tokenizer:{id:'legacy',count:legacyCount}} as any);
    expect(artifact.tokens).toBe(37);
    expect(artifact).toMatchObject({ tokenizer: 'openai-responses-input-tokens-v1', counterId: 'openai-responses-input-tokens-v1', model: 'gpt-5.6-luna', revision: 0 });
    expect(legacyCount).not.toHaveBeenCalled();
    expect(assembleNpcMemoryContext({...input, tokenizer:{id:'legacy',count:legacyCount}} as any).hash).toBe(artifact.hash);
  });

  it('rejects incomplete verified-count metadata', () => {
    expect(() => assembleNpcMemoryContext({ policyVersion: 'memory-v1', projectionVersion: 'speech-v1', maxBytes: 1024, maxTokens: 1024,
      sources: [], payload: {}, tokenCount: 1, tokenizerId: '', counterId: 'counter', model: 'model' } as any)).toThrow('Verified NPC memory token-count metadata is invalid');
  });

  it('accepts exact UTF-8/token ceilings and rejects the next byte or token', () => {
    const input={policyVersion:'memory-v1',projectionVersion:'speech-v1',sources:[],payload:{text:'中文 العربية देवनागरी e\u0301 👩🏽‍🚀'},tokenCount:16_000,tokenizerId:'counter',counterId:'counter',model:'fixture',maxBytes:64*1024,maxTokens:16_000};
    const exact=assembleNpcMemoryContext(input);
    expect(exact.tokens).toBe(16_000);
    expect(assembleNpcMemoryContext({...input,maxBytes:exact.utf8Bytes}).utf8Bytes).toBe(exact.utf8Bytes);
    expect(()=>assembleNpcMemoryContext({...input,maxBytes:exact.utf8Bytes-1})).toThrow(`Authorized NPC memory evidence exceeds the frozen-context budget. Bytes: ${exact.utf8Bytes}/${exact.utf8Bytes-1}; tokens: 16000/16000.`);
    expect(()=>assembleNpcMemoryContext({...input,tokenCount:16_001,tier:'consequential'})).toThrow('Authorized NPC memory evidence exceeds the frozen-context budget. Bytes: ');
    expect(()=>assembleNpcMemoryContext({...input,tokenCount:16_001,tier:'consequential'})).toThrow('tokens: 16001/16000. Tier: consequential.');
  });
  const embeddingPlan = () => { const input={version:'npc-memory-embedding-input-v1',sourceKind:'dialogue_turn',sourceId,sourceVersion:1,sourceHash,ledgerSequence:2,envelope:{message:'x'}}, profile={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',processorVersion:'embed-v3',model:'embed',dimensions:2}, inputHash=sha256Hex(canonicalJson(input)); return {jobId:id,fence,profile,source:{kind:'dialogue_turn',id:sourceId,version:1,hash:sourceHash,ledgerSequence:2,disclosureClass:'npc_known'},input,inputText:canonicalJson(input),inputHash}; };
  const embeddingIdentityHash=(plan: ReturnType<typeof embeddingPlan>)=>sha256Hex(canonicalJson({jobId:id,fence,profileId:plan.profile.id,processorVersion:plan.profile.processorVersion,model:plan.profile.model,dimensions:plan.profile.dimensions,sourceKind:'dialogue_turn',sourceId,sourceVersion:1,sourceHash,inputHash:plan.inputHash}));
  it('runs a receipt-gated embedding exactly once and never uses generic completion', async () => {
    const plan=embeddingPlan(), body={model:'embed',input:plan.inputText,dimensions:2,encoding_format:'float' as const}, requestHash=sha256Hex(canonicalJson(body)); const calls:string[]=[];
    const provider={preflight:vi.fn(()=>Object.freeze({body:Object.freeze(body)})),embed:vi.fn(async()=>({vector:'[1,0]',model:'embed',dimensions:2,providerRequestId:'req',promptTokens:1,totalTokens:1}))};
    const api={rpc:vi.fn(async(name:string)=>{calls.push(name); const data:any=name==='world_npc_memory_embedding_plan'?plan:name==='world_npc_memory_embedding_recover_dispatch'?{directive:'prepare_required',reason:'no_receipt'}:name==='world_npc_memory_embedding_prepare_dispatch'?{directive:'dispatch_authorized',idempotencyKey:'key',identityHash:embeddingIdentityHash(plan),requestHash,state:'prepared',profileId:plan.profile.id,model:'embed',dimensions:2,inputHash:plan.inputHash,inputText:plan.inputText,encodingFormat:'float'}:name==='world_npc_memory_embedding_mark_dispatched'?{directive:'dispatch_once',idempotencyKey:'key'}:{status:'completed',contentHash:'c'.repeat(64)}; return {data,error:null};})};
    await expect(runNpcMemoryClaim(api,claim(),{processorKind:'embedding',processorVersion:'embed-v3',loadSource:runtime().loadSource,embeddingProvider:provider,embeddingSignal:signal})).resolves.toMatchObject({status:'completed'});
    expect(calls).toEqual(['world_npc_memory_embedding_plan','world_npc_memory_embedding_recover_dispatch','world_npc_memory_embedding_prepare_dispatch','world_npc_memory_embedding_mark_dispatched','world_npc_memory_embedding_accept']); expect(provider.embed).toHaveBeenCalledTimes(1); expect(api.rpc).not.toHaveBeenCalledWith('world_npc_memory_complete',expect.anything());
  });
  it('terminalizes fail-only embedding recovery without provider work using plan pins', async () => {
    const plan=embeddingPlan(), provider={preflight:vi.fn(),embed:vi.fn()}; const api={rpc:vi.fn(async(name:string,args:any)=>({data:name==='world_npc_memory_embedding_plan'?plan:name==='world_npc_memory_embedding_recover_dispatch'?{directive:'fail_only',reason:'prior_fence_receipt_exists',priorFence:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',receiptState:'terminalize_required'}:(expect(args).toMatchObject({p_profile_id:plan.profile.id,p_input_hash:plan.inputHash,p_error_code:'worker_failed'}),{status:'failed'}),error:null}))};
    await expect(runNpcMemoryClaim(api,claim(),{processorKind:'embedding',processorVersion:'embed-v3',loadSource:runtime().loadSource,embeddingProvider:provider as any,embeddingSignal:signal})).resolves.toMatchObject({status:'failed'}); expect(provider.preflight).not.toHaveBeenCalled(); expect(provider.embed).not.toHaveBeenCalled();
  });
  it.each(['world_npc_memory_embedding_plan','world_npc_memory_embedding_recover_dispatch','world_npc_memory_embedding_prepare_dispatch','world_npc_memory_embedding_mark_dispatched','world_npc_memory_embedding_accept'])('returns lease_lost without retry when %s is stale', async (staleStage) => {
    const plan=embeddingPlan(), body={model:'embed',input:plan.inputText,dimensions:2,encoding_format:'float' as const}, requestHash=sha256Hex(canonicalJson(body)), provider={preflight:vi.fn(()=>Object.freeze({body:Object.freeze(body)})),embed:vi.fn(async()=>({vector:'[1,0]',model:'embed',dimensions:2,providerRequestId:'req',promptTokens:1,totalTokens:1}))};
    const api={rpc:vi.fn(async(name:string)=>{if(name===staleStage)return {data:null,error:{message:'Embedding dispatch fence is stale'}}; const data:any=name==='world_npc_memory_embedding_plan'?plan:name==='world_npc_memory_embedding_recover_dispatch'?{directive:'prepare_required',reason:'no_receipt'}:name==='world_npc_memory_embedding_prepare_dispatch'?{directive:'dispatch_authorized',idempotencyKey:'key',identityHash:embeddingIdentityHash(plan),requestHash,state:'prepared',profileId:plan.profile.id,model:'embed',dimensions:2,inputHash:plan.inputHash,inputText:plan.inputText,encodingFormat:'float'}:name==='world_npc_memory_embedding_mark_dispatched'?{directive:'dispatch_once',idempotencyKey:'key'}:{status:'completed',contentHash:'c'.repeat(64)}; return {data,error:null};})};
    await expect(runNpcMemoryClaim(api,claim(),{processorKind:'embedding',processorVersion:'embed-v3',loadSource:runtime().loadSource,embeddingProvider:provider,embeddingSignal:signal})).resolves.toEqual({status:'lease_lost'});
    expect(api.rpc.mock.calls.filter(([name])=>name==='world_npc_memory_complete')).toHaveLength(0); expect(provider.embed).toHaveBeenCalledTimes(staleStage==='world_npc_memory_embedding_accept'?1:0);
  });
  it.each([
    ['wrong model',{model:'wrong'}],['wrong dimensions',{dimensions:3}],['wrong vector count',{vector:'[1]'}],['nonfinite vector',{vector:'[NaN,0]'}],['zero vector',{vector:'[0,0]'}],['unsafe request id',{providerRequestId:'bad id'}],['negative usage',{promptTokens:-1}],['noninteger usage',{totalTokens:1.5}],['inconsistent usage',{promptTokens:2,totalTokens:1}]
  ])('terminalizes injected %s provider result as malformed', async (_label, patch) => {
    const plan=embeddingPlan(),body={model:'embed',input:plan.inputText,dimensions:2,encoding_format:'float' as const},requestHash=sha256Hex(canonicalJson(body)); const provider={preflight:vi.fn(()=>Object.freeze({body:Object.freeze(body)})),embed:vi.fn(async()=>({vector:'[1,0]',model:'embed',dimensions:2,providerRequestId:'req',promptTokens:1,totalTokens:1,...patch}))};
    const api={rpc:vi.fn(async(name:string,args:any)=>({data:name==='world_npc_memory_embedding_plan'?plan:name==='world_npc_memory_embedding_recover_dispatch'?{directive:'prepare_required',reason:'no_receipt'}:name==='world_npc_memory_embedding_prepare_dispatch'?{directive:'dispatch_authorized',idempotencyKey:'key',identityHash:embeddingIdentityHash(plan),requestHash,state:'prepared',profileId:plan.profile.id,model:'embed',dimensions:2,inputHash:plan.inputHash,inputText:plan.inputText,encodingFormat:'float'}:name==='world_npc_memory_embedding_mark_dispatched'?{directive:'dispatch_once',idempotencyKey:'key'}:(expect(args).toMatchObject({p_error_code:'provider_malformed',p_profile_id:plan.profile.id,p_input_hash:plan.inputHash}),{status:'failed'}),error:null}))};
    await expect(runNpcMemoryClaim(api,claim(),{processorKind:'embedding',processorVersion:'embed-v3',loadSource:runtime().loadSource,embeddingProvider:provider,embeddingSignal:signal})).resolves.toEqual({status:'failed',errorCode:'provider_malformed'}); expect(provider.embed).toHaveBeenCalledTimes(1); expect(api.rpc.mock.calls.some(([n])=>n==='world_npc_memory_complete')).toBe(false);
  });
});
