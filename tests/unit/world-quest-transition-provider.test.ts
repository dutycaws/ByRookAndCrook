import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUEST_TRANSITION_CHECKPOINT_STAGE, QUEST_TRANSITION_PROVIDER_STAGES, SETTLEMENT_PROVIDER_CALL_BUDGETS, createSettlementProvider, promptVersionForProviderStage } from '../../src/lib/server/evolving-world';
import { SETTLEMENT_PROMPT_KEY } from '../../src/lib/server/prompt-registry';
import { fixturePromptRelease } from '../helpers/prompt-registry-fixture';

const context = () => ({
  terminalEventId: 'terminal-event-1', residentId: 'resident-1', frozenTargetRefs: ['millhaven', 'north-road'],
  capabilities: { actions: ['prepare', 'attempt', 'abandon'], approaches: ['scouting'], allowGeneratedSuccessor: true, allowDeparture: true }
});
const frozenContext = () => ({
  quest: { id: 'quest-1', title: 'North road' }, terminalEvent: { id: 'terminal-event-1', outcome: 'succeeded' },
  eventHistory: [], versionSheet: { identity: { name: 'Lira' } },
  capabilityEnvelope: { allowedActions: ['prepare', 'attempt', 'abandon'], allowedApproaches: ['scouting'] },
  registeredActions: ['prepare', 'attempt', 'abandon'], registeredApproaches: ['scouting'],
  validCanonicalTargets: [{ id: 'target-1', ref: 'millhaven', kind: 'place' }], currentProfile: {},
  nextAuthoredMilestone: null, dialogueEvidence: [], beliefs: [], socialEdges: []
});
const memoryDossier = () => ({
  version: 'quest-transition-memory-dossier-v1', fingerprint: 'a'.repeat(64),
  manifest: { transitionId: 'transition-1', terminalEventId: 'terminal-event-1', sourceFingerprint: 'b'.repeat(64), sourceVersions: [] },
  coverage: { terminalEvent: true, eventHistory: 0, dialogueEvidence: 0, beliefs: 0, socialEdges: 0, sourceVersions: 0 },
  bytes: { frozenContext: 1, dossier: 1 }, evidence: frozenContext()
});
const proposal = () => ({ version: 'quest-transition-v1', kind: 'successor', terminalEventId: 'terminal-event-1', title: 'North road', objective: 'Trace the lost caravan.', motivation: 'The evidence points north.', constraints: ['Keep the village informed.'], targetRefs: ['millhaven'], difficulty: 2, plan: [{ action: 'prepare', approach: 'scouting' }, { action: 'attempt', approach: 'scouting' }] });
function completed(value: unknown) { return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 5, output_tokens: 3 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }), { status: 200 }); }
function generate(stage: Parameters<ReturnType<typeof createSettlementProvider>['generate']>[0], payload: unknown) {
  const provider = createSettlementProvider({ OPENAI_API_KEY: 'test-key' });
  return provider.generate(stage, payload, new AbortController().signal, fixturePromptRelease.prompts[SETTLEMENT_PROMPT_KEY[stage]]);
}

afterEach(() => vi.unstubAllGlobals());

describe('quest transition provider stages', () => {
  it('uses the closed four-stage contract, prompt mapping, and release-pinned prompt keys', () => {
    expect(QUEST_TRANSITION_PROVIDER_STAGES).toEqual(['quest_transition_proposer', 'quest_transition_critic', 'quest_transition_repair', 'quest_transition_final_critic']);
    expect(QUEST_TRANSITION_CHECKPOINT_STAGE).toEqual({ quest_transition_proposer: 'proposer', quest_transition_critic: 'critic', quest_transition_repair: 'repair', quest_transition_final_critic: 'final_critic' });
    expect(SETTLEMENT_PROVIDER_CALL_BUDGETS.quest_transition).toEqual({ maximum: 4, ordinary: 2, stages: QUEST_TRANSITION_PROVIDER_STAGES });
    expect(SETTLEMENT_PROMPT_KEY.quest_transition_proposer).toBe('quest_transition.proposer');
    expect(promptVersionForProviderStage('quest_transition_final_critic')).toBe('quest-transition-v1');
  });

  it('validates frozen proposer output and uses a strict proposal schema', async () => {
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return completed({ proposalJson: JSON.stringify(proposal()) }); }));
    await expect(generate('quest_transition_proposer', { context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier() })).resolves.toMatchObject({ value: { kind: 'successor' }, model: 'gpt-5.6-terra', promptVersion: 'quest-transition-v1' });
    expect(requests[0].text.format).toMatchObject({ name: 'world_quest_transition_proposer', strict: true, schema: { additionalProperties: false, required: ['proposalJson'], properties: { proposalJson: { maxLength: 6000 } } } });
    expect(requests[0].input[0].content).toContain('frozen transition context');
  });

  it('uses bounded critic instructions and rejects repairs or malformed payloads before fetch', async () => {
    const fetch = vi.fn(async () => completed({ decision: 'repair', instructions: [{ code: 'plan_shape', path: 'plan' }] }));
    vi.stubGlobal('fetch', fetch);
    await expect(generate('quest_transition_critic', { context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier(), proposal: proposal() })).resolves.toMatchObject({ value: { decision: 'repair' }, model: 'gpt-5.6-luna' });
    await expect(generate('quest_transition_final_critic', { context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier(), proposal: proposal() })).rejects.toMatchObject({ code: 'provider_malformed' });
    await expect(generate('quest_transition_repair', { context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier(), proposal: proposal(), instructions: [{ code: 'not-real', path: 'plan' }] })).rejects.toMatchObject({ code: 'provider_malformed' });
    await expect(generate('quest_transition_proposer', { context: { ...context(), frozenTargetRefs: ['unknown'], extra: true }, frozenContext: frozenContext(), memoryDossier: memoryDossier() })).rejects.toMatchObject({ code: 'provider_malformed' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('accepts only the thirteen-key bounded snapshot and continuity repair codes', async () => {
    const fetch = vi.fn(async () => completed({ decision: 'repair', instructions: [{ code: 'causal_continuity', path: 'causalContinuity' }] }));
    vi.stubGlobal('fetch', fetch);
    await expect(generate('quest_transition_critic', { context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier(), proposal: proposal() })).resolves.toMatchObject({ value: { decision: 'repair' } });
    await expect(generate('quest_transition_proposer', { context: context(), frozenContext: { ...frozenContext(), hospitality: [] }, memoryDossier: memoryDossier() })).rejects.toMatchObject({ code: 'provider_malformed' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects dossiers with missing metadata or unrecognized top-level fields before fetch', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(generate('quest_transition_proposer', { context: context(), frozenContext: frozenContext(), memoryDossier: { ...memoryDossier(), coverage: { terminalEvent: true } } })).rejects.toMatchObject({ code: 'provider_malformed' });
    await expect(generate('quest_transition_proposer', { context: context(), frozenContext: frozenContext(), memoryDossier: { ...memoryDossier(), privateProse: 'do not admit this' } })).rejects.toMatchObject({ code: 'provider_malformed' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
