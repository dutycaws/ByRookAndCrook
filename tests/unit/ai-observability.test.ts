import { describe, expect, it, vi } from 'vitest';
import { AI_OBSERVABILITY_VERSION, createAiObservabilityEvent, emitAiObservability, sanitizeAiErrorCode } from '$lib/server/observability/ai-events';

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
  });

  it('sanitizes errors and never allows a telemetry sink failure to change execution', async () => {
    expect(sanitizeAiErrorCode('PROVIDER_TIMEOUT')).toBe('provider_timeout');
    expect(sanitizeAiErrorCode('Provider says: key=sk-live-secret')).toBe('internal_error');
    const sink = vi.fn(async () => { throw new Error('telemetry unavailable'); });
    await expect(emitAiObservability(sink, { correlationId: 'settlement:abc', workflow: 'world_settlement', stage: 'critic', status: 'failed', attempt: 1, errorCode: 'provider_timeout' })).resolves.toMatchObject({ errorCode: 'provider_timeout' });
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
