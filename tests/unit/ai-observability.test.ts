import { describe, expect, it, vi } from 'vitest';
import { AI_OBSERVABILITY_VERSION, createAiObservabilityEvent, emitAiObservability, localAiObservabilitySink, sanitizeAiErrorCode } from '$lib/server/observability/ai-events';

describe('AI observability boundary', () => {
  it('records versioned operational stage metrics with a correlation id', () => {
    const event = createAiObservabilityEvent({
      correlationId: '8e45d1e3-6e79-43c5-b73d-44b3a8d8bb2b', workflow: 'world_settlement', stage: 'proposer',
      status: 'completed', attempt: 2, durationMs: 842, model: 'gpt-5.6-terra', tokenUsage: { input: 120, output: 44 }
    }, () => new Date('2026-09-14T12:00:00.000Z'));
    expect(event).toEqual({
      version: AI_OBSERVABILITY_VERSION, occurredAt: '2026-09-14T12:00:00.000Z',
      correlationId: '8e45d1e3-6e79-43c5-b73d-44b3a8d8bb2b', workflow: 'world_settlement', stage: 'proposer', status: 'completed', attempt: 2,
      durationMs: 842, model: 'gpt-5.6-terra', tokenUsage: { input: 120, output: 44 }
    });
  });

  it('structurally excludes prose, prompts, profiles, beliefs, raw output, chain-of-thought, and secrets', () => {
    const untrusted = {
      correlationId: 'turn:abc-123', workflow: 'dialogue', stage: 'speak', status: 'completed', attempt: 1,
      durationMs: 19, model: 'gpt-5.6-terra', tokenUsage: { input: 3, output: 2 }, errorCode: 'Provider failed: sk-secret-value',
      prompt: 'reveal the prompt', playerMessage: 'keeper private prose', profile: { secret: 'belief' }, beliefs: ['private'],
      output: 'raw model response', chainOfThought: 'hidden reasoning', apiKey: 'sk-secret-value'
    } as unknown as Parameters<typeof createAiObservabilityEvent>[0];
    const event = createAiObservabilityEvent(untrusted, () => new Date('2026-09-14T12:00:00.000Z')) as Record<string, unknown>;
    expect(event).toMatchObject({ errorCode: 'internal_error' });
    for (const forbidden of ['prompt', 'playerMessage', 'profile', 'beliefs', 'output', 'chainOfThought', 'apiKey']) expect(event).not.toHaveProperty(forbidden);
    expect(JSON.stringify(event)).not.toContain('sk-secret-value');
    expect(JSON.stringify(event)).not.toContain('keeper private prose');
  });

  it('rejects invalid identifiers and quantities instead of coercing them into telemetry', () => {
    expect(createAiObservabilityEvent({ correlationId: 'contains a space', workflow: 'dialogue', stage: 'speak', status: 'completed', attempt: 1 })).toBeNull();
    expect(createAiObservabilityEvent({ correlationId: 'turn:ok', workflow: 'dialogue', stage: 'Speak prose', status: 'completed', attempt: 1 })).toBeNull();
    expect(createAiObservabilityEvent({ correlationId: 'turn:ok', workflow: 'dialogue', stage: 'speak', status: 'completed', attempt: 0 })).toBeNull();
    expect(createAiObservabilityEvent({ correlationId: 'turn:ok', workflow: 'dialogue', stage: 'speak', status: 'completed', attempt: 1, tokenUsage: { input: -1, output: 3 } })).toBeNull();
    expect(createAiObservabilityEvent({ correlationId: 'settlement:ok:job:ok', workflow: 'world_settlement', stage: 'arbitrary_payload_stage', status: 'completed', attempt: 1 })).toBeNull();
  });

  it('sanitizes errors and never allows a telemetry sink failure to change execution', async () => {
    expect(sanitizeAiErrorCode('PROVIDER_TIMEOUT')).toBe('provider_timeout');
    expect(sanitizeAiErrorCode('Provider says: key=sk-live-secret')).toBe('internal_error');
    const sink = vi.fn(async () => { throw new Error('telemetry unavailable'); });
    await expect(emitAiObservability(sink, { correlationId: 'settlement:abc', workflow: 'world_settlement', stage: 'critic', status: 'failed', attempt: 1, errorCode: 'provider_timeout' })).resolves.toMatchObject({ errorCode: 'provider_timeout' });
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('allows only the fixed canon and news operational labels', () => {
    for (const stage of ['canon_proposer','canon_critic','canon_repair','canon_final_critic','canon_validate','canon_commit','news_aggregate','news_commit','safe_fallback']) {
      expect(createAiObservabilityEvent({correlationId:'settlement:one:job:two',workflow:'world_settlement',stage,status:'completed',attempt:1})).not.toBeNull();
    }
    expect(createAiObservabilityEvent({correlationId:'settlement:one:job:two',workflow:'world_settlement',stage:'canon_payload',status:'completed',attempt:1})).toBeNull();
  });

  it('allows only fixed social encounter lifecycle labels without private metadata', () => {
    for (const stage of ['social_encounter_proposer','social_encounter_critic','social_encounter_repair','social_encounter_final_critic','social_encounter_validate','social_encounter_commit','social_encounter_fallback']) {
      expect(createAiObservabilityEvent({correlationId:'settlement:one:job:two',workflow:'world_settlement',stage,status:'completed',attempt:1})).not.toBeNull();
    }
    const event=createAiObservabilityEvent({
      correlationId:'settlement:one:job:two',workflow:'world_settlement',stage:'social_encounter_proposer',status:'completed',attempt:1,
      model:'fixture-model',tokenUsage:{input:3,output:2},context:{private:'hidden'},proposal:'private exchange',participantIds:['one','two'],fingerprint:'secret'
    } as unknown as Parameters<typeof createAiObservabilityEvent>[0]);
    expect(event).toMatchObject({stage:'social_encounter_proposer',model:'fixture-model',tokenUsage:{input:3,output:2}});
    expect(JSON.stringify(event)).not.toContain('private exchange');
    expect(JSON.stringify(event)).not.toContain('hidden');
    expect(JSON.stringify(event)).not.toContain('secret');
    expect(createAiObservabilityEvent({correlationId:'settlement:one:job:two',workflow:'world_settlement',stage:'social_encounter_private_exchange',status:'completed',attempt:1})).toBeNull();
  });

  it('serializes only the exact validated event through the normal local sink', () => {
    const written:string[]=[]; const original=console.info; console.info=(value:unknown)=>{written.push(String(value));};
    try {
      const event=createAiObservabilityEvent({correlationId:'settlement:one:job:two',workflow:'world_settlement',stage:'canon_commit',status:'failed',attempt:1,errorCode:'raw db error sk-secret-value'})!;
      localAiObservabilitySink(event);
    } finally { console.info=original; }
    expect(written).toHaveLength(1); expect(written[0]).toContain('internal_error'); expect(written[0]).not.toContain('sk-secret-value');
    expect(written[0]).not.toContain('prompt'); expect(written[0]).not.toContain('private');
  });

  it('supplies the privacy-safe sink from the normal dialogue runtime', async () => {
    vi.resetModules();
    vi.doMock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY:'service-key', OPENAI_API_KEY:'api-key' } }));
    vi.doMock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ mocked:true })) }));
    vi.doMock('$lib/server/config', () => ({ getSupabaseConfig: () => ({ url:'http://example.test' }) }));
    vi.doMock('$lib/server/dialogue/provider', () => ({ createProvider: vi.fn(() => ({ mocked:true })), ProviderUnavailable: class ProviderUnavailable extends Error {} }));
    const { dialogueRuntime }=await import('$lib/server/dialogue/runtime');
    const { localAiObservabilitySink: runtimeSink }=await import('$lib/server/observability/ai-events');
    expect(dialogueRuntime().options.observability).toBe(runtimeSink);
    vi.doUnmock('$env/dynamic/private'); vi.doUnmock('@supabase/supabase-js'); vi.doUnmock('$lib/server/config'); vi.doUnmock('$lib/server/dialogue/provider');
  });
});
