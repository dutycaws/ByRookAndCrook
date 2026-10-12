import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNpcMemoryEmbeddingProvider, createNpcMemorySummaryV2Provider, NpcMemorySummaryProviderError } from '$lib/server/npc-memory/provider';
import { captureMockedNpcProviderRequests } from '../helpers/capture-npc-provider-payloads';
import { fixturePromptRelease } from '../helpers/prompt-registry-fixture';

const signal = new AbortController().signal;
const memoryPrompt = fixturePromptRelease.prompts['npc_memory.summary.v2'];
const config = { OPENAI_API_KEY: 'test', NPC_CONTEXT_MODEL: 'gpt-6-luna', NPC_MODEL_INPUT_CAPACITY: '90000' };
const input = { systemPrompt: memoryPrompt.body, payload: { evidence: 'A bounded fixture memory summary request.' }, model: 'gpt-6-luna', maxSummaryChars: 100, maxCitations: 1, maxBytes: 384 * 1024, signal };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'x-request-id': 'req_1' } });
afterEach(() => { captureMockedNpcProviderRequests('npc-memory-provider.test.ts'); vi.unstubAllGlobals(); });
describe('npc memory v2 provider', () => {
  it('counts the exact token-bearing projection and sends its frozen body unchanged once', async () => {
    const calls: RequestInit[] = []; vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { calls.push(init); return calls.length === 1 ? response({ input_tokens: 12 }) : response({ status: 'completed', usage: { input_tokens: 12, output_tokens: 3, input_tokens_details: { cached_tokens: 3, cache_write_tokens: 4 } }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ version: 'npc-memory-summary-v2', mode: 'model', summary: 'ok', citations: [], protectedRefs: [], leaves: [] }) }] }] }); }));
    const provider = createNpcMemorySummaryV2Provider(config); const prepared = await provider.preflight(input); const countBody = JSON.parse(String(calls[0].body));
    expect(Object.keys(countBody).sort()).toEqual(['input', 'model', 'text']); expect(prepared.prepared.body).toMatchObject({ model: 'gpt-6-luna', store: false, max_output_tokens: 4096 }); expect(Object.isFrozen(prepared.prepared.body)).toBe(true);
    await expect(provider.generate({ prepared: prepared.prepared, signal })).resolves.toMatchObject({ inputTokens: 12, outputTokens: 3, cachedInputTokens: 3, cacheWriteInputTokens: 4 }); expect(JSON.parse(String(calls[1].body))).toEqual(prepared.prepared.body);
  });
  it('rejects absent capacity, byte/token ceilings, timeout, and malformed completed responses', async () => {
    await expect(createNpcMemorySummaryV2Provider({ OPENAI_API_KEY: 'x', NPC_CONTEXT_MODEL: 'fixture-model' }).preflight(input)).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(createNpcMemorySummaryV2Provider(config).preflight({ ...input, maxBytes: 0 })).rejects.toMatchObject({ code: 'provider_malformed' });
    vi.stubGlobal('fetch', vi.fn(async () => response({ input_tokens: 80001 }))); await expect(createNpcMemorySummaryV2Provider(config).preflight(input)).rejects.toMatchObject({ code: 'provider_malformed' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); })); await expect(createNpcMemorySummaryV2Provider(config).preflight(input)).rejects.toBeInstanceOf(NpcMemorySummaryProviderError);
  });

  it('enforces frozen schema bounds, transport capacity, and provider error shapes', async () => {
    await expect(createNpcMemorySummaryV2Provider({ ...config, OPENAI_API_KEY: undefined }).preflight(input)).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(createNpcMemorySummaryV2Provider({ ...config, NPC_MODEL_INPUT_CAPACITY: '4096' }).preflight(input)).rejects.toMatchObject({ code: 'provider_unavailable' });
    vi.stubGlobal('fetch', vi.fn(async () => response({ input_tokens: 1 })));
    await expect(createNpcMemorySummaryV2Provider(config).preflight({ ...input, maxBytes: 384 * 1024 + 1 })).rejects.toMatchObject({ code: 'provider_malformed' });
    const prepared = await createNpcMemorySummaryV2Provider(config).preflight(input);
    const schema = (prepared.prepared.body.text as any).format.schema;
    expect(schema.properties.version).toEqual({ type: 'string', const: 'npc-memory-summary-v2' });
    expect(schema.properties.mode).toEqual({ type: 'string', const: 'model' });
    expect(schema.properties.summary.maxLength).toBe(100);
    expect(schema.properties.citations.maxItems).toBe(1);
    expect(prepared.prepared.body.store).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => response({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }, { type: 'output_text', text: '{}' }] }] })));
    await expect(createNpcMemorySummaryV2Provider(config).generate({ prepared: prepared.prepared, signal })).rejects.toMatchObject({ code: 'provider_malformed' });
  });

  it('rejects HTTP, malformed JSON, usage, and request-id failures without accepting partial output', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(createNpcMemorySummaryV2Provider(config).preflight(input)).rejects.toMatchObject({ code: 'provider_failed' });
    vi.stubGlobal('fetch', vi.fn(async () => response({ input_tokens: 1 })));
    const prepared = await createNpcMemorySummaryV2Provider(config).preflight(input);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(createNpcMemorySummaryV2Provider(config).generate({ prepared: prepared.prepared, signal })).rejects.toMatchObject({ code: 'provider_malformed' });
    vi.stubGlobal('fetch', vi.fn(async () => response({ status: 'completed', usage: {}, output: [] })));
    await expect(createNpcMemorySummaryV2Provider(config).generate({ prepared: prepared.prepared, signal })).rejects.toMatchObject({ code: 'provider_malformed' });
  });

  it('accepts exact 80k/capacity edges and rejects the next token or malformed request id', async () => {
    const edge = { ...config, NPC_MODEL_INPUT_CAPACITY: '84096' };
    vi.stubGlobal('fetch', vi.fn(async () => response({ input_tokens: 80000 })));
    await expect(createNpcMemorySummaryV2Provider(edge).preflight(input)).resolves.toMatchObject({ inputTokens: 80000 });
    vi.stubGlobal('fetch', vi.fn(async () => response({ input_tokens: 80001 })));
    await expect(createNpcMemorySummaryV2Provider(edge).preflight(input)).rejects.toMatchObject({ code: 'provider_malformed' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] }), { status: 200, headers: { 'x-request-id': 'x'.repeat(201) } })));
    const prepared = { body: {}, model: 'gpt-6-luna', inputTokens: 1, maxSummaryChars: 1, maxCitations: 0 } as any;
    await expect(createNpcMemorySummaryV2Provider(config).generate({ prepared, signal })).rejects.toMatchObject({ code: 'provider_malformed' });
  });

  it('measures the actual serialized generation body at the byte edge and classifies an already-aborted request as a timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ input_tokens: 1 })));
    const provider = createNpcMemorySummaryV2Provider(config);
    const baseline = await provider.preflight({ ...input, payload: { evidence: 'é'.repeat(1000) } });
    const exactBytes = new TextEncoder().encode(JSON.stringify(baseline.prepared.body)).byteLength;
    await expect(provider.preflight({ ...input, payload: { evidence: 'é'.repeat(1000) }, maxBytes: exactBytes })).resolves.toMatchObject({ prepared: { body: baseline.prepared.body } });
    await expect(provider.preflight({ ...input, payload: { evidence: 'é'.repeat(1000) }, maxBytes: exactBytes - 1 })).rejects.toMatchObject({ code: 'provider_malformed' });
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('aborted'); }));
    await expect(provider.preflight({ ...input, signal: controller.signal })).rejects.toMatchObject({ code: 'provider_timeout' });
  });
});

describe('npc memory embedding provider', () => {
  const embeddingConfig = { OPENAI_API_KEY: 'key', NPC_EMBEDDING_MODEL: 'embed-fixture', NPC_EMBEDDING_DIMENSIONS: '3' };
  it('preflights a deeply frozen exact float body and sends it once with the caller signal', async () => {
    const fetchMock = vi.fn(async () => response({ object: 'list', model: 'embed-fixture', data: [{ object: 'embedding', index: 0, embedding: [1, 0, 2] }], usage: { prompt_tokens: 2, total_tokens: 2 } })); vi.stubGlobal('fetch', fetchMock);
    const provider = createNpcMemoryEmbeddingProvider(embeddingConfig); const prepared = provider.preflight({ inputText: 'évidence', model: 'embed-fixture', dimensions: 3 });
    expect(Object.isFrozen(prepared)).toBe(true); expect(Object.isFrozen(prepared.body)).toBe(true); expect(prepared.body).toEqual({ model: 'embed-fixture', input: 'évidence', dimensions: 3, encoding_format: 'float' });
    await expect(provider.embed(prepared, signal)).resolves.toMatchObject({ vector: '[1,0,2]', providerRequestId: 'req_1', promptTokens: 2, totalTokens: 2 });
    const call=(fetchMock.mock.calls as unknown as [string, RequestInit][])[0]!; expect(fetchMock).toHaveBeenCalledTimes(1); expect(call[0]).toBe('https://api.openai.com/v1/embeddings'); expect(JSON.parse(String(call[1].body))).toEqual(prepared.body); expect(call[1].signal).toBe(signal);
  });
  it('fails closed for config, UTF-8 transport, abort, and malformed provider evidence', async () => {
    expect(() => createNpcMemoryEmbeddingProvider({}).preflight({ inputText: 'x', model: 'embed-fixture', dimensions: 3 })).toThrow();
    expect(() => createNpcMemoryEmbeddingProvider(embeddingConfig).preflight({ inputText: 'é'.repeat(200000), model: 'embed-fixture', dimensions: 3 })).toThrow();
    const provider=createNpcMemoryEmbeddingProvider(embeddingConfig); const prepared=provider.preflight({ inputText:'x',model:'embed-fixture',dimensions:3 });
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('bad',{status:500}))); await expect(provider.embed(prepared,signal)).rejects.toMatchObject({code:'provider_failed'});
    vi.stubGlobal('fetch',vi.fn(async()=>response({object:'list',model:'wrong',data:[],usage:{}}))); await expect(provider.embed(prepared,signal)).rejects.toMatchObject({code:'provider_malformed'});
    const controller=new AbortController(); controller.abort(); vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('abort');})); await expect(provider.embed(prepared,controller.signal)).rejects.toMatchObject({code:'provider_timeout'});
  });
});
