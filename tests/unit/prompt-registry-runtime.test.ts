import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider } from '../../src/lib/server/dialogue/provider.js';
import { createSettlementProvider } from '../../src/lib/server/evolving-world/provider.js';
import { initialPromptReleaseSnapshot } from '../../src/lib/server/prompt-registry/index.js';
import { PromptRegistryService } from '../../src/lib/server/prompt-registry/service.js';

const release = initialPromptReleaseSnapshot();
const oldRelease = { ...release, releaseId: '11111111-1111-4111-8111-111111111111', prompts: Object.fromEntries(Object.entries(release.prompts).map(([key, prompt]) => [key, { ...prompt, releaseId: '11111111-1111-4111-8111-111111111111' }])) } as typeof release;

afterEach(() => vi.unstubAllGlobals());

describe('release-pinned provider adapters', () => {
  it('resolves durable work release IDs instead of the active release', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const registry = new PromptRegistryService({ rpc(name, args) {
      calls.push({ name, args });
      if (name === 'prompt_registry_service_work_release') return Promise.resolve({ data: oldRelease.releaseId, error: null });
      return Promise.resolve({ data: { releaseId: oldRelease.releaseId, releaseNumber: 1, label: 'old', prompts: oldRelease.prompts }, error: null });
    } });
    expect((await registry.resolveForWork('dialogue', '22222222-2222-4222-8222-222222222222')).releaseId).toBe(oldRelease.releaseId);
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'prompt_registry_service_work_release', args: { p_work_kind: 'dialogue', p_work_id: '22222222-2222-4222-8222-222222222222' } })]));
  });

  it('sends the pinned dialogue and settlement bodies, and refuses an absent prompt', async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); requestBodies.push(body);
      const name = body.text?.format?.name;
      const output = name === 'world_proposer' ? JSON.stringify({ proposalJson: '{}' }) : JSON.stringify({ text: 'okay' });
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: output }] }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
    });
    const dialogue = createProvider({ OPENAI_API_KEY: 'key' });
    await expect(dialogue.generate('speak', {}, AbortSignal.timeout(1_000), undefined as never)).rejects.toThrow('pinned dialogue prompt');
    // Deliberate produces a valid schema-free transport assertion after the body
    // reaches Responses; the structure rejection is irrelevant to provenance.
    await dialogue.generate('speak', {}, AbortSignal.timeout(1_000), release.prompts['dialogue.speak']).catch(() => undefined);
    const settlement = createSettlementProvider({ OPENAI_API_KEY: 'key' });
    await settlement.generate('proposer', { schema: {}, profile: {}, capability: {}, worldSnapshot: {}, authorizedEvidence: [] }, AbortSignal.timeout(1_000), release.prompts['resident.proposer']).catch(() => undefined);
    expect(requestBodies.map((body) => (body.input as Array<{ content: string }>)[0].content)).toEqual(expect.arrayContaining([
      release.prompts['dialogue.speak'].body, release.prompts['resident.proposer'].body
    ]));
  });
});
