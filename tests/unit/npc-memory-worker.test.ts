import { describe, expect, it, vi } from 'vitest';
import { assembleNpcMemoryContext, canonicalJson, sha256Hex, utf8Bytes } from '$lib/server/npc-memory/context';
import { runNpcMemoryClaim } from '$lib/server/npc-memory/worker';

const id = '11111111-1111-4111-8111-111111111111';
const fence = '22222222-2222-4222-8222-222222222222';
const sourceId = '33333333-3333-4333-8333-333333333333';
const sourceHash = 'a'.repeat(64);
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

  it('freezes a byte-accurate, source-hashed context artifact', () => {
    const artifact = assembleNpcMemoryContext({ policyVersion: 'memory-v1', projectionVersion: 'speech-v1', tokenizer: { id: 'verified-test', count: (text) => [...text].length }, maxBytes: 1024, maxTokens: 1024, sources: [{ id: sourceId, version: 1, hash: sourceHash, kind: 'dialogue_turn' }], requiredSourceIds: [sourceId], payload: { text: 'e\u0301 👩‍🌾' } });
    expect(artifact.utf8Bytes).toBe(utf8Bytes(artifact.canonicalJson));
    expect(artifact.hash).toBe(sha256Hex(artifact.canonicalJson));
    expect(artifact.canonicalJson).toBe(canonicalJson({ payload: { text: 'e\u0301 👩‍🌾' }, sourceManifest: [{ id: sourceId, version: 1, hash: sourceHash, kind: 'dialogue_turn' }], coverage: { required: [sourceId], included: [sourceId], missing: [], complete: true } }));
    expect(Object.isFrozen(artifact.payload)).toBe(true);
  });
});
