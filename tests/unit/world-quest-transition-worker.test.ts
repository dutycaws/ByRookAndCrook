import { describe, expect, it } from 'vitest';
import { runQuestTransitionClaim } from '$lib/server/evolving-world/quest-transition-worker';

const transitionId = '11111111-1111-4111-8111-111111111111';
const terminalEventId = '22222222-2222-4222-8222-222222222222';
const instanceId = '33333333-3333-4333-8333-333333333333';
const fence = '44444444-4444-4444-8444-444444444444';
const later = () => new Date(Date.now() + 300_000).toISOString();
const proposal = {
  version: 'quest-transition-v1', kind: 'next_authored_milestone', terminalEventId,
  milestoneId: 'milestone-2', plan: [{ action: 'prepare', approach: 'scouting' }, { action: 'attempt', approach: 'scouting' }]
};

function claim(checkpoints: unknown[] = []) {
  return {
    transitionId, terminalEventId, instanceId, fence, attempt: 1, leaseUntil: later(), checkpoints,
    frozenContext: {
      capabilityEnvelope: { allowedActions: ['prepare', 'attempt'], allowedApproaches: ['scouting'], allowedWorldEffects: ['create_quest'] },
      validCanonicalTargets: [{ id: 'target-1', ref: 'forest' }], nextAuthoredMilestone: { id: 'milestone-2' },
      privateProfile: 'this must never appear in metrics'
    }
  };
}
function context13() {
  return {
    quest: { id: 'quest-1', saveId: 'save-1', instanceId, versionId: 'version-1', packageId: 'package-1', packageHash: 'hash', origin: 'authored_milestone', title: 'Keep the road safe', objective: 'Secure the northern road.', motivation: 'Lira protects travellers.', constraints: ['Do not endanger travellers.'], targetRefs: ['forest'], difficulty: 2, terminalDay: 3 },
    terminalEvent: { id: terminalEventId, day: 3, step: 1, action: 'attempt', approach: 'scouting', outcome: 'succeeded', text: 'The road is safe.', publicNews: true },
    eventHistory: [{ id: terminalEventId, day: 3, step: 1, action: 'attempt', approach: 'scouting', outcome: 'succeeded', text: 'The road is safe.', publicNews: true }],
    versionSheet: { name: 'Lira', identity: '{"role":"ranger"}', personality: 'Steady and cautious.', lore: 'She knows the northern road.', boundaries: 'Never abandon travellers.' },
    capabilityEnvelope: { allowGeneratedSuccessor: true, allowDeparture: false, allowedActions: ['prepare', 'attempt'], allowedApproaches: ['scouting'] },
    registeredActions: ['prepare', 'attempt'], registeredApproaches: ['scouting'],
    validCanonicalTargets: [{ id: 'target-1', ref: 'forest', kind: 'place' }], currentProfile: { summary: 'Trusted by the village.' },
    nextAuthoredMilestone: { id: 'milestone-2', title: 'Trace the threat' }, dialogueEvidence: [], beliefs: [], socialEdges: []
  };
}
function claim077(checkpoints: unknown[] = []) { return { ...claim(checkpoints), frozenContext: context13() }; }
function registry() {
  const prompts = Object.fromEntries(['quest_transition.proposer', 'quest_transition.critic', 'quest_transition.repair', 'quest_transition.final_critic'].map((key) => [key, { key, releaseId: 'release-1', revisionId: 'revision-1', revision: 1, promptType: 'text_system', body: 'fixture', contentHash: 'x', bodyHash: 'x', contractId: 'quest-transition-v1', contractHash: 'x', modelLane: 'world', createdAt: '', createdBy: 'test' }]));
  return {
    async resolveForWork() { return { releaseId: 'release-1', prompts }; },
    async recordSafeRun() {}
  } as any;
}
function client(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const api = {
    async rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ name, args });
      const result = overrides[name];
      if (typeof result === 'function') return (result as any)(args);
      if (result) return result as any;
      if (name === 'world_quest_transition_heartbeat') return { data: { leaseUntil: later() }, error: null };
      if (name === 'world_quest_transition_commit') return { data: { status: 'completed', transitionId, terminalEventId, kind: 'next_authored_milestone' }, error: null };
      return { data: {}, error: null };
    }
  };
  return { api, calls };
}
function provider(values: Record<string, unknown>) {
  const calls: string[] = [];
  return {
    calls,
    async generate(stage: string) {
      calls.push(stage);
      const value = values[stage];
      if (value instanceof Error) throw value;
      return { value, model: 'fixture-model', usage: { input: 3, output: 2 }, durationMs: 1, promptVersion: 'quest-transition-v1' };
    }
  } as any;
}

describe('quest transition worker', () => {
  it('proposes, critiques, checkpoints, and commits a valid next milestone', async () => {
    const mock = client(); const model = provider({ quest_transition_proposer: proposal, quest_transition_critic: { decision: 'accept', instructions: [] } });
    const result = await runQuestTransitionClaim(mock.api, claim(), { provider: model, promptRegistry: registry(), heartbeatMs: 99_999 });
    expect(result).toEqual({ status: 'completed', kind: 'next_authored_milestone' });
    expect(model.calls).toEqual(['quest_transition_proposer', 'quest_transition_critic']);
    expect(mock.calls.map((call) => call.name)).toEqual(expect.arrayContaining(['world_quest_transition_checkpoint', 'world_quest_transition_commit']));
  });

  it('executes normally from the exact bounded thirteen-key 077 snapshot', async () => {
    const mock = client(); const model = provider({ quest_transition_proposer: proposal, quest_transition_critic: { decision: 'accept', instructions: [] } });
    await expect(runQuestTransitionClaim(mock.api, claim077(), { provider: model, promptRegistry: registry(), heartbeatMs: 99_999 })).resolves.toEqual({ status: 'completed', kind: 'next_authored_milestone' });
    expect(model.calls).toEqual(['quest_transition_proposer', 'quest_transition_critic']);
  });

  it('uses at most one repair then a final critic', async () => {
    const mock = client(); const model = provider({
      quest_transition_proposer: proposal,
      quest_transition_critic: { decision: 'repair', instructions: [{ code: 'plan_shape', path: 'plan' }] },
      quest_transition_repair: proposal,
      quest_transition_final_critic: { decision: 'accept', instructions: [] }
    });
    await expect(runQuestTransitionClaim(mock.api, claim(), { provider: model, promptRegistry: registry(), heartbeatMs: 99_999 })).resolves.toMatchObject({ status: 'completed' });
    expect(model.calls).toHaveLength(4);
  });

  it('records validation_rejected and never commits when the final continuity critic rejects a repair', async () => {
    const mock = client(); const model = provider({
      quest_transition_proposer: proposal,
      quest_transition_critic: { decision: 'repair', instructions: [{ code: 'causal_continuity', path: 'causalContinuity' }] },
      quest_transition_repair: proposal,
      quest_transition_final_critic: { decision: 'reject', instructions: [] }
    });
    await expect(runQuestTransitionClaim(mock.api, claim(), { provider: model, promptRegistry: registry(), heartbeatMs: 99_999 })).resolves.toEqual({ status: 'failed', errorCode: 'validation_rejected' });
    expect(mock.calls.map((call) => call.name)).not.toContain('world_quest_transition_commit');
    expect(mock.calls.find((call) => call.name === 'world_quest_transition_fail')?.args?.p_failure_code).toBe('validation_rejected');
  });

  it('reuses durable proposer and critic checkpoints without another model call', async () => {
    const mock = client(); const model = provider({});
    await expect(runQuestTransitionClaim(mock.api, claim([{ stage: 'proposer', payload: { proposal } }, { stage: 'critic', payload: { decision: { decision: 'accept', instructions: [] } } }]), { provider: model, promptRegistry: registry(), heartbeatMs: 99_999 })).resolves.toMatchObject({ status: 'completed' });
    expect(model.calls).toEqual([]);
  });

  it.each([
    ['rejection', { quest_transition_proposer: proposal, quest_transition_critic: { decision: 'reject', instructions: [] } }, 'validation_rejected'],
    ['malformed model proposal', { quest_transition_proposer: { invented: true } }, 'validation_rejected'],
    ['provider failure', { quest_transition_proposer: new Error('upstream') }, 'worker_failed']
  ])('records a recoverable failure for %s', async (_label, values, expectedCode) => {
    const mock = client();
    const outcome = await runQuestTransitionClaim(mock.api, claim(), { provider: provider(values), promptRegistry: registry(), heartbeatMs: 99_999 });
    expect(outcome).toMatchObject({ status: 'failed', errorCode: expectedCode });
    expect(mock.calls.map((call) => call.name)).toContain('world_quest_transition_fail');
    const failure = mock.calls.find((call) => call.name === 'world_quest_transition_fail');
    expect(failure?.args?.p_failure_code).toBe(expectedCode);
  });

  it('does not commit after an initial critic rejection', async () => {
    const mock = client();
    await expect(runQuestTransitionClaim(mock.api, claim077(), { provider: provider({ quest_transition_proposer: proposal, quest_transition_critic: { decision: 'reject', instructions: [] } }), promptRegistry: registry(), heartbeatMs: 99_999 })).resolves.toEqual({ status: 'failed', errorCode: 'validation_rejected' });
    expect(mock.calls.map((call) => call.name)).not.toContain('world_quest_transition_commit');
    expect(mock.calls.find((call) => call.name === 'world_quest_transition_fail')?.args?.p_failure_code).toBe('validation_rejected');
  });

  it('returns lease_lost for a stale fence and accepts a replayed commit receipt', async () => {
    const stale = client({ world_quest_transition_heartbeat: { data: null, error: { message: 'Quest transition fence is stale' } } });
    await expect(runQuestTransitionClaim(stale.api, claim(), { provider: provider({}), promptRegistry: registry() })).resolves.toMatchObject({ status: 'lease_lost' });
    const replay = client({ world_quest_transition_commit: { data: { status: 'completed', transitionId, terminalEventId, kind: 'next_authored_milestone', replayed: true }, error: null } });
    await expect(runQuestTransitionClaim(replay.api, claim([{ stage: 'proposer', payload: { proposal } }, { stage: 'critic', payload: { decision: { decision: 'accept', instructions: [] } } }]), { provider: provider({}), promptRegistry: registry(), heartbeatMs: 99_999 })).resolves.toMatchObject({ status: 'completed' });
  });

  it('emits operational telemetry without frozen profile content', async () => {
    const events: unknown[] = []; const mock = client();
    await runQuestTransitionClaim(mock.api, claim(), { provider: provider({ quest_transition_proposer: proposal, quest_transition_critic: { decision: 'accept', instructions: [] } }), promptRegistry: registry(), observability: (event) => { events.push(event); }, heartbeatMs: 99_999 });
    expect(JSON.stringify(events)).not.toContain('privateProfile');
    expect(JSON.stringify(events)).not.toContain('this must never');
  });
});
