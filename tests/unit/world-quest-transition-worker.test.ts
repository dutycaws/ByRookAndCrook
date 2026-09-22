import { describe, expect, it } from 'vitest';
import { runQuestTransitionClaim } from '$lib/server/evolving-world/quest-transition-worker';
import { canonicalNpcMemoryContextPayload, sha256Hex, utf8Bytes } from '$lib/server/npc-memory/context';

const transitionId = '11111111-1111-4111-8111-111111111111';
const terminalEventId = '22222222-2222-4222-8222-222222222222';
const instanceId = '33333333-3333-4333-8333-333333333333';
const fence = '44444444-4444-4444-8444-444444444444';
const later = () => new Date(Date.now() + 300_000).toISOString();
const proposal = {
  version: 'quest-transition-v1', kind: 'next_authored_milestone', terminalEventId,
  milestoneId: 'milestone-2', plan: [{ action: 'prepare', approach: 'scouting' }, { action: 'attempt', approach: 'scouting' }]
};
const actorId='55555555-5555-4555-8555-555555555555';
const emptyEvidence=(cutoff=1)=>({retrievalVersion:'npc-memory-evidence-v4',cutoffLedgerSequence:cutoff,semantic:{available:false,availability:'disabled',profile:null},items:[],bundles:[],sourceFallback:[],sourceManifest:[],coverage:{complete:true,sourceFallback:{total:0,included:0,truncated:false,complete:true},watermarks:[]}});

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
      if (name === 'world_quest_transition_memory_scope') return { data: { actorId, instanceId, cutoffLedgerSequence: 1 }, error: null };
      if (name === 'npc_memory_evidence_retrieve_for_actor') return { data: emptyEvidence(), error: null };
      if (name === 'world_quest_transition_commit') return { data: { status: 'completed', transitionId, terminalEventId, kind: 'next_authored_milestone' }, error: null };
      return { data: {}, error: null };
    }
  };
  return { api, calls };
}
function provider(values: Record<string, unknown>) {
  const calls: string[] = []; const payloads: unknown[] = [];
  return {
    calls, payloads,
    async generate(stage: string, payload: unknown) {
      calls.push(stage);
      payloads.push(payload);
      const value = values[stage];
      if (value instanceof Error) throw value;
      return { value, model: 'fixture-model', usage: { input: 3, output: 2 }, durationMs: 1, promptVersion: 'quest-transition-v1' };
    }
    ,async countMemoryContext() { return {model:'fixture-model',counterId:'fixture-counter',inputTokens:3,durationMs:1}; }
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

  it('gives every stage one deterministic terminal-bound memory dossier and never emits its prose to telemetry', async () => {
    const events: unknown[] = []; const mock = client(); const model = provider({
      quest_transition_proposer: proposal,
      quest_transition_critic: { decision: 'repair', instructions: [{ code: 'plan_shape', path: 'plan' }] },
      quest_transition_repair: proposal,
      quest_transition_final_critic: { decision: 'accept', instructions: [] }
    });
    await expect(runQuestTransitionClaim(mock.api, claim077(), { provider: model, promptRegistry: registry(), observability: (event) => { events.push(event); }, heartbeatMs: 99_999 })).resolves.toMatchObject({ status: 'completed' });
    const dossiers = model.payloads.map((payload: any) => payload.memoryDossier);
    expect(dossiers).toHaveLength(4);
    expect(new Set(dossiers.map((dossier: any) => dossier.fingerprint)).size).toBe(1);
    expect(new Set(dossiers.map((dossier: any) => dossier.evidence)).size).toBe(1);
    expect(dossiers[0]).toMatchObject({ version: 'quest-transition-memory-dossier-v1', manifest: { transitionId, terminalEventId, sourceFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) }, coverage: { terminalEvent: true, eventHistory: 1 }, bytes: { frozenContext: expect.any(Number), dossier: expect.any(Number) } });
    expect(dossiers[0].evidence).toMatchObject({ ...((model.payloads[0] as any).frozenContext), memoryContext: expect.objectContaining({ tier:'ordinary', payload:expect.objectContaining({evidence:expect.objectContaining({retrievalVersion:'npc-memory-evidence-v4'})}), tokens:3 }) });
    expect((dossiers[0].evidence as any).memoryContext).toMatchObject({tier:'ordinary',hash:expect.stringMatching(/^[0-9a-f]{64}$/)});
    expect((dossiers[0].evidence as any).memoryContext).not.toHaveProperty('canonicalJson');
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ memoryContext: expect.objectContaining({ utf8Bytes: dossiers[0].bytes.dossier, reuse: 'fresh' }) })]));
    expect(JSON.stringify(events)).not.toContain('Steady and cautious');
  });

  it('selects the rich transition attachment tier only for successor/departure-capable terminal contexts without a next authored milestone', async () => {
    const mock=client(); const rich=claim077();
    (rich.frozenContext as any).nextAuthoredMilestone=null;
    (rich.frozenContext as any).capabilityEnvelope={...(rich.frozenContext as any).capabilityEnvelope,allowGeneratedSuccessor:true};
    const model=provider({quest_transition_proposer:proposal,quest_transition_critic:{decision:'accept',instructions:[]}});
    // The fixture proposal remains authored-milestone shaped, so validation
    // may reject after capture; tier admission is proven before model output.
    await runQuestTransitionClaim(mock.api,rich,{provider:model,promptRegistry:registry(),heartbeatMs:99_999});
    expect((model.payloads[0] as any).memoryDossier.evidence.memoryContext).toMatchObject({tier:'rich',policyVersion:'npc-transition-evidence-v1',tokens:expect.any(Number)});
    expect(mock.calls.find(call=>call.name==='npc_memory_evidence_retrieve_for_actor')?.args).toMatchObject({p_limit:32,p_candidate_limit:128});
  });

  it('reclaims a persisted memory context and model checkpoints without re-opening scope, retrieval, profile, or embedding work', async () => {
    const first=client();
    const firstModel=provider({ quest_transition_proposer: proposal, quest_transition_critic: { decision: 'accept', instructions: [] } });
    await expect(runQuestTransitionClaim(first.api, claim(), { provider:firstModel, promptRegistry:registry(), heartbeatMs:99_999 })).resolves.toMatchObject({status:'completed'});
    const memoryContext=first.calls.find(call=>call.name==='world_quest_transition_checkpoint' && call.args?.p_stage==='memory_context')?.args?.p_payload;
    expect(memoryContext).toBeTruthy();
    // JSON UTF-8 bytes—not JavaScript code units—govern the special durable
    // checkpoint. This is intentionally above the old 64KiB parser cap while
    // remaining below the 512KiB SQL cap.
    const oversizedMemoryContext={...(memoryContext as Record<string,unknown>),padding:'界'.repeat(30_000)};
    expect(new TextEncoder().encode(JSON.stringify(oversizedMemoryContext)).byteLength).toBeGreaterThan(65_536);
    const replay=client(); let recounts=0;
    const replayModel=provider({});
    replayModel.countMemoryContext=async()=>{ recounts++; throw new Error('replay must not recount'); };
    await expect(runQuestTransitionClaim(replay.api,claim([
      {stage:'memory_context',payload:oversizedMemoryContext},
      {stage:'proposer',payload:{proposal}},
      {stage:'critic',payload:{decision:{decision:'accept',instructions:[]}}}
    ]),{provider:replayModel,promptRegistry:registry(),heartbeatMs:99_999})).resolves.toMatchObject({status:'completed'});
    expect(replayModel.calls).toEqual([]);
    expect(recounts).toBe(0);
    expect(replay.calls.map(call=>call.name)).not.toEqual(expect.arrayContaining([
      'world_quest_transition_memory_scope','npc_memory_active_embedding_profile','npc_memory_evidence_retrieve_for_actor'
    ]));
  });

  it('rejects a self-consistent attachment mutation when it no longer binds the authoritative replay evidence', async () => {
    const first=client(); const firstModel=provider({quest_transition_proposer:proposal,quest_transition_critic:{decision:'accept',instructions:[]}});
    await runQuestTransitionClaim(first.api,claim(),{provider:firstModel,promptRegistry:registry(),heartbeatMs:99_999});
    const memoryContext=structuredClone(first.calls.find(call=>call.name==='world_quest_transition_checkpoint'&&call.args?.p_stage==='memory_context')?.args?.p_payload) as any;
    const attachment=memoryContext.attachment;
    attachment.payload={...attachment.payload,evidence:{...attachment.payload.evidence,retrievalVersion:'substituted-evidence-v4'}};
    attachment.canonicalJson=canonicalNpcMemoryContextPayload({sources:attachment.sourceManifest,requiredSourceIds:attachment.coverage.required,payload:attachment.payload});
    attachment.hash=sha256Hex(attachment.canonicalJson);
    attachment.utf8Bytes=utf8Bytes(attachment.canonicalJson);
    memoryContext.budget.utf8Bytes=attachment.utf8Bytes;
    const replay=client(); const replayModel=provider({});
    await expect(runQuestTransitionClaim(replay.api,claim([{stage:'memory_context',payload:memoryContext}]),{provider:replayModel,promptRegistry:registry(),heartbeatMs:99_999})).resolves.toMatchObject({status:'failed',errorCode:'validation_rejected'});
    expect(replayModel.calls).toEqual([]);
    expect(replay.calls.map(call=>call.name)).not.toEqual(expect.arrayContaining(['world_quest_transition_memory_scope','npc_memory_evidence_retrieve_for_actor']));
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
