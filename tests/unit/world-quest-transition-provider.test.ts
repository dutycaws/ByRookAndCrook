import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUEST_TRANSITION_CHECKPOINT_STAGE, QUEST_TRANSITION_PROVIDER_STAGES, SETTLEMENT_PROVIDER_CALL_BUDGETS, createSettlementProvider, promptVersionForProviderStage } from '../../src/lib/server/evolving-world';
import { QUEST_TRANSITION_PROPOSAL_CONTRACT } from '../../src/lib/server/evolving-world/quest-transition-prompt-contract';
import { SETTLEMENT_PROMPTS } from '../../src/lib/server/evolving-world/prompts';
import { SETTLEMENT_PROMPT_KEY } from '../../src/lib/server/prompt-registry';
import { fixturePromptRelease } from '../helpers/prompt-registry-fixture';
import { captureMockedNpcProviderRequests } from '../helpers/capture-npc-provider-payloads';

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
  const provider = createSettlementProvider({ OPENAI_API_KEY: 'test-key',NPC_MODEL_INPUT_CAPACITY:'80000' });
  return provider.generate(stage, payload, new AbortController().signal, fixturePromptRelease.prompts[SETTLEMENT_PROMPT_KEY[stage]]);
}

afterEach(() => { captureMockedNpcProviderRequests('world-quest-transition-provider.test.ts'); vi.unstubAllGlobals(); });

describe('quest transition provider stages', () => {
  it('includes the same complete inner proposal contract in proposer and repair source prompts', () => {
    for (const stage of ['quest_transition_proposer', 'quest_transition_repair'] as const) {
      expect(SETTLEMENT_PROMPTS[stage].endsWith(QUEST_TRANSITION_PROPOSAL_CONTRACT)).toBe(true);
    }
  });

  it('uses the closed four-stage contract, prompt mapping, and release-pinned prompt keys', () => {
    expect(QUEST_TRANSITION_PROVIDER_STAGES).toEqual(['quest_transition_proposer', 'quest_transition_critic', 'quest_transition_repair', 'quest_transition_final_critic']);
    expect(QUEST_TRANSITION_CHECKPOINT_STAGE).toEqual({ quest_transition_proposer: 'proposer', quest_transition_critic: 'critic', quest_transition_repair: 'repair', quest_transition_final_critic: 'final_critic' });
    expect(SETTLEMENT_PROVIDER_CALL_BUDGETS.quest_transition).toEqual({ maximum: 4, ordinary: 2, stages: QUEST_TRANSITION_PROVIDER_STAGES });
    expect(SETTLEMENT_PROMPT_KEY.quest_transition_proposer).toBe('quest_transition.proposer');
    expect(promptVersionForProviderStage('quest_transition_final_critic')).toBe('quest-transition-v1');
  });

  it('validates frozen proposer output and uses a strict proposal schema', async () => {
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return String(url).endsWith('/input_tokens') ? new Response(JSON.stringify({input_tokens:5}),{status:200}) : completed({ proposalJson: JSON.stringify(proposal()) }); }));
    await expect(generate('quest_transition_proposer', { context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier() })).resolves.toMatchObject({ value: { kind: 'successor' }, model: 'gpt-6-luna', promptVersion: 'quest-transition-v1' });
    expect(requests[0].text.format).toMatchObject({ name: 'world_quest_transition_proposer', strict: true, schema: { additionalProperties: false, required: ['proposalJson'], properties: { proposalJson: { maxLength: 6000 } } } });
    expect(requests[0].input[0].content).toContain('frozen transition context');
  });

  it('captures the departure transition request from the production provider path', async () => {
    const departure = { version: 'quest-transition-v1', kind: 'departure', terminalEventId: 'terminal-event-1', privateRationale: 'The road now leads beyond the village.', farewellText: 'I will remember your kindness.', publicNews: 'Lira has set out for the northern road.' };
    const fetch = vi.fn(async (url: string) => String(url).endsWith('/input_tokens')
      ? new Response(JSON.stringify({ input_tokens: 5 }), { status: 200 })
      : completed({ proposalJson: JSON.stringify(departure) }));
    vi.stubGlobal('fetch', fetch);
    const terminalContext = { ...frozenContext(), terminalEvent: { id: 'terminal-event-1', outcome: 'abandoned' } };
    const dossier = { ...memoryDossier(), evidence: terminalContext };
    await expect(generate('quest_transition_proposer', { context: context(), frozenContext: terminalContext, memoryDossier: dossier }))
      .resolves.toMatchObject({ value: { kind: 'departure' }, model: 'gpt-6-luna' });
  });

  it('uses bounded critic instructions and rejects repairs or malformed payloads before fetch', async () => {
    const fetch = vi.fn(async (url) => String(url).endsWith('/input_tokens') ? new Response(JSON.stringify({input_tokens:5}),{status:200}) : completed({ decision: 'repair', instructions: [{ code: 'plan_shape', path: 'plan' }] }));
    vi.stubGlobal('fetch', fetch);
    await expect(generate('quest_transition_critic', { context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier(), proposal: proposal() })).resolves.toMatchObject({ value: { decision: 'repair' }, model: 'gpt-6-luna' });
    await expect(generate('quest_transition_final_critic', { context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier(), proposal: proposal() })).rejects.toMatchObject({ code: 'provider_malformed' });
    await expect(generate('quest_transition_repair', { context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier(), proposal: proposal(), instructions: [{ code: 'not-real', path: 'plan' }] })).rejects.toMatchObject({ code: 'provider_malformed' });
    await expect(generate('quest_transition_proposer', { context: { ...context(), frozenTargetRefs: ['unknown'], extra: true }, frozenContext: frozenContext(), memoryDossier: memoryDossier() })).rejects.toMatchObject({ code: 'provider_malformed' });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('accepts only the thirteen-key bounded snapshot and continuity repair codes', async () => {
    const fetch = vi.fn(async (url) => String(url).endsWith('/input_tokens') ? new Response(JSON.stringify({input_tokens:5}),{status:200}) : completed({ decision: 'repair', instructions: [{ code: 'causal_continuity', path: 'causalContinuity' }] }));
    vi.stubGlobal('fetch', fetch);
    await expect(generate('quest_transition_critic', { context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier(), proposal: proposal() })).resolves.toMatchObject({ value: { decision: 'repair' } });
    await expect(generate('quest_transition_proposer', { context: context(), frozenContext: { ...frozenContext(), hospitality: [] }, memoryDossier: memoryDossier() })).rejects.toMatchObject({ code: 'provider_malformed' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects dossiers with missing metadata or unrecognized top-level fields before fetch', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(generate('quest_transition_proposer', { context: context(), frozenContext: frozenContext(), memoryDossier: { ...memoryDossier(), coverage: { terminalEvent: true } } })).rejects.toMatchObject({ code: 'provider_malformed' });
    await expect(generate('quest_transition_proposer', { context: context(), frozenContext: frozenContext(), memoryDossier: { ...memoryDossier(), privateProse: 'do not admit this' } })).rejects.toMatchObject({ code: 'provider_malformed' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['quest_transition_critic', (payload: any) => ({ context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier(), proposal: proposal() }), { decision: 'accept', instructions: [] }],
    ['quest_transition_repair', (payload: any) => ({ context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier(), proposal: proposal(), instructions: [{ code: 'plan_shape', path: 'plan' }] }), { proposalJson: JSON.stringify(proposal()) }]
  ] as const)('preflights the complete %s request at input limit-1, limit, and limit+1', async (stage, makePayload, output) => {
    for (const [tokens,accepted] of [[4,true],[5,true],[6,false]] as const) {
      const requests:any[]=[];
      vi.stubGlobal('fetch',vi.fn(async (url,init:RequestInit)=>{
        const body=JSON.parse(String(init.body)); requests.push({url:String(url),body});
        return String(url).endsWith('/input_tokens')
          ? new Response(JSON.stringify({input_tokens:tokens}),{status:200})
          : completed(output);
      }));
      const provider=createSettlementProvider({OPENAI_API_KEY:'test-key',NPC_MODEL_INPUT_CAPACITY:'2205'});
      const prompt=fixturePromptRelease.prompts[SETTLEMENT_PROMPT_KEY[stage]];
      const run=()=>provider.generate(stage,makePayload({}),new AbortController().signal,prompt);
      if (accepted) await expect(run()).resolves.toBeTruthy(); else await expect(run()).rejects.toMatchObject({code:'provider_malformed'});
      expect(requests[0].body).toMatchObject({model:expect.any(String),input:expect.any(Array),text:expect.any(Object)});
      expect(JSON.stringify(requests[0].body.input)).toContain('memoryDossier');
      expect(requests).toHaveLength(accepted?2:1);
      captureMockedNpcProviderRequests('world-quest-transition-provider.test.ts');
      vi.unstubAllGlobals();
    }
  });

  it.each(['quest_transition_critic','quest_transition_repair'] as const)('enforces the 80k full-request token ceiling for %s at -1, equal, and +1',async(stage)=>{
    const payload=stage==='quest_transition_critic'
      ? {context:context(),frozenContext:frozenContext(),memoryDossier:memoryDossier(),proposal:proposal()}
      : {context:context(),frozenContext:frozenContext(),memoryDossier:memoryDossier(),proposal:proposal(),instructions:[{code:'plan_shape',path:'plan'}]};
    const output=stage==='quest_transition_critic'?{decision:'accept',instructions:[]}:{proposalJson:JSON.stringify(proposal())};
    for(const [tokens,accepted] of [[79_999,true],[80_000,true],[80_001,false]] as const) {
      const fetch=vi.fn(async(url)=>String(url).endsWith('/input_tokens')?new Response(JSON.stringify({input_tokens:tokens}),{status:200}):completed(output));
      vi.stubGlobal('fetch',fetch);
      const provider=createSettlementProvider({OPENAI_API_KEY:'test-key',NPC_MODEL_INPUT_CAPACITY:'100000'});
      const run=()=>provider.generate(stage,payload,new AbortController().signal,fixturePromptRelease.prompts[SETTLEMENT_PROMPT_KEY[stage]]);
      if(accepted) await expect(run()).resolves.toBeTruthy(); else await expect(run()).rejects.toMatchObject({code:'provider_malformed'});
      expect(fetch).toHaveBeenCalledTimes(accepted?2:1); captureMockedNpcProviderRequests('world-quest-transition-provider.test.ts'); vi.unstubAllGlobals();
    }
  });

  it.each(['quest_transition_critic','quest_transition_repair'] as const)('enforces the exact 384KiB UTF-8 request ceiling for %s at -1, equal, and +1', async (stage) => {
    const payload=stage==='quest_transition_critic'
      ? {context:context(),frozenContext:frozenContext(),memoryDossier:memoryDossier(),proposal:proposal()}
      : {context:context(),frozenContext:frozenContext(),memoryDossier:memoryDossier(),proposal:proposal(),instructions:[{code:'plan_shape',path:'plan'}]};
    const output=stage==='quest_transition_critic'?{decision:'accept',instructions:[]}:{proposalJson:JSON.stringify(proposal())};
    const fetch=vi.fn(async(url)=>String(url).endsWith('/input_tokens')?new Response(JSON.stringify({input_tokens:5}),{status:200}):completed(output));
    vi.stubGlobal('fetch',fetch);
    const provider=createSettlementProvider({OPENAI_API_KEY:'test-key',NPC_MODEL_INPUT_CAPACITY:'100000'});
    const basePrompt=fixturePromptRelease.prompts[SETTLEMENT_PROMPT_KEY[stage]];
    const run=(bytes:number)=>provider.generate(stage,payload,new AbortController().signal,{...basePrompt,body:'x'.repeat(bytes)});
    // Search for the exact largest one-byte ASCII prompt accepted by the full
    // serialized Responses body; this covers schema, critic/repair payload, and
    // transport framing rather than a synthetic partial projection.
    let low=0, high=384*1024;
    while(low<high) {
      const middle=Math.ceil((low+high)/2);
      try { await run(middle); low=middle; } catch { high=middle-1; }
    }
    await expect(run(low-1)).resolves.toBeTruthy();
    await expect(run(low)).resolves.toBeTruthy();
    await expect(run(low+1)).rejects.toMatchObject({code:'provider_malformed'});
  });

  it.each([
    ['preflight HTTP', 'provider_failed', 'provider_preflight_http_error', async () => new Response('private provider error', { status: 503 }), undefined],
    ['preflight JSON', 'provider_malformed', 'provider_preflight_json_invalid', async () => new Response('{', { status: 200 }), undefined],
    ['input budget', 'provider_malformed', 'provider_input_budget_exceeded', async () => new Response(JSON.stringify({ input_tokens: 80_000 }), { status: 200 }), undefined],
    ['provider HTTP', 'provider_failed', 'provider_response_http_error', async () => new Response(JSON.stringify({ input_tokens: 5 }), { status: 200 }), async () => new Response('private provider error', { status: 503 })],
    ['incomplete response', 'provider_failed', 'provider_response_incomplete', async () => new Response(JSON.stringify({ input_tokens: 5 }), { status: 200 }), async () => new Response(JSON.stringify({ status: 'incomplete', output: [] }), { status: 200 })],
    ['unreadable response JSON', 'provider_malformed', 'provider_response_json_invalid', async () => new Response(JSON.stringify({ input_tokens: 5 }), { status: 200 }), async () => new Response('{', { status: 200 })],
    ['refusal without text', 'provider_malformed', 'provider_response_refusal', async () => new Response(JSON.stringify({ input_tokens: 5 }), { status: 200 }), async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'PRIVATE REFUSAL TEXT' }] }] }), { status: 200 })],
    ['missing output', 'provider_malformed', 'provider_output_missing', async () => new Response(JSON.stringify({ input_tokens: 5 }), { status: 200 }), async () => new Response(JSON.stringify({ status: 'completed', output: [] }), { status: 200 })],
    ['outer JSON', 'provider_malformed', 'provider_output_outer_json_invalid', async () => new Response(JSON.stringify({ input_tokens: 5 }), { status: 200 }), async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{' }] }] }), { status: 200 })],
    ['schema envelope', 'provider_malformed', 'provider_output_schema_invalid', async () => new Response(JSON.stringify({ input_tokens: 5 }), { status: 200 }), async () => completed({})],
    ['inner JSON', 'provider_malformed', 'provider_output_inner_json_invalid', async () => new Response(JSON.stringify({ input_tokens: 5 }), { status: 200 }), async () => completed({ proposalJson: '{' })],
    ['semantic proposal', 'provider_malformed', 'provider_quest_terminal_event', async () => new Response(JSON.stringify({ input_tokens: 5 }), { status: 200 }), async () => completed({ proposalJson: JSON.stringify({ ...proposal(), terminalEventId: 'wrong-terminal' }) })]
  ] as const)('classifies the %s provider failure without changing its public code', async (_name, code, diagnosticReason, preflight, response) => {
    vi.stubGlobal('fetch', vi.fn(async (url) => String(url).endsWith('/input_tokens') ? preflight() : response!()));
    await expect(generate('quest_transition_proposer', { context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier() }))
      .rejects.toMatchObject({ code, diagnosticReason });
  });

  it('preserves accepted output when a refusal block accompanies valid output text', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => String(url).endsWith('/input_tokens')
      ? new Response(JSON.stringify({ input_tokens: 5 }), { status: 200 })
      : new Response(JSON.stringify({ status: 'completed', output: [
        { type: 'message', content: [{ type: 'refusal', refusal: 'PRIVATE REFUSAL TEXT' }, { type: 'output_text', text: JSON.stringify({ proposalJson: JSON.stringify(proposal()) }) }] }
      ] }), { status: 200 })));
    await expect(generate('quest_transition_proposer', { context: context(), frozenContext: frozenContext(), memoryDossier: memoryDossier() }))
      .resolves.toMatchObject({ value: { kind: 'successor' } });
  });
});
