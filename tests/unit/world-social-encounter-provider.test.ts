import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFrozenSocialEncounterContext, parseSocialEncounterProposal } from '../../src/lib/game/evolving-world';
import { SOCIAL_ENCOUNTER_SETTLEMENT_PROMPT_VERSION, createSettlementProvider as createSettlementProviderBase } from '../../src/lib/server/evolving-world';
import { SETTLEMENT_PROMPT_KEY } from '../../src/lib/server/prompt-registry';
import { fixturePromptRelease } from '../helpers/prompt-registry-fixture';

const promptRelease=fixturePromptRelease;
function createSettlementProvider(config: Record<string,string|undefined>) {
  const provider=createSettlementProviderBase(config);
  return { ...provider, generate(stage: Parameters<typeof provider.generate>[0], payload: unknown, signal: AbortSignal) {
    return provider.generate(stage,payload,signal,promptRelease.prompts[SETTLEMENT_PROMPT_KEY[stage]]);
  } };
}

const lira='11111111-1111-4111-8111-111111111111';
const torvin='22222222-2222-4222-8222-222222222222';
const liraNpc='33333333-3333-4333-8333-333333333333';
const torvinNpc='44444444-4444-4444-8444-444444444444';
const beliefId='55555555-5555-4555-8555-555555555555';
const fingerprint='a'.repeat(64);

function capability(socialCapabilities: string[]) { return {version:'v1',allowedActions:[],allowedApproaches:[],allowedWorldEffects:[],allowedTargetKinds:[],socialCapabilities,irreversibleEffects:[]}; }
function resident(residentId:string, npcId:string, socialCapabilities:string[], beliefs:unknown[]=[]) { return {residentId,npcId,profileRevision:1,profile:{dimensions:{},entries:[]},beliefs,edges:[{subjectNpcId:npcId,objectEntityId:npcId===liraNpc ? torvinNpc : liraNpc,axes:{trust:0,affection:0,respect:0,fear:0,obligation:0}}],capability:capability(socialCapabilities)}; }
function contextRaw(liraCapabilities=['deceive','share_gossip']) {
  const belief={id:beliefId,subjectEntityId:torvinNpc,content:'Smoke rose by the northern pass.',confidence:67,provenance:[{sourceKind:'direct_evidence',sourceId:'evidence-smoke'}],originalClaimFingerprint:fingerprint,contradictionStatus:'uncontested',state:'active'};
  return {version:'social-encounter-v1',templateKey:'road-rumor',participantResidentIds:[lira,torvin],publicCanon:{currentDay:4,entityKinds:{[liraNpc]:'npc',[torvinNpc]:'npc'}},authorizedEvidence:[{id:'evidence-smoke',kind:'world_event',sourceFingerprint:fingerprint,summary:'Smoke rose by the northern pass.'}],participants:[resident(lira,liraNpc,liraCapabilities,[belief]),resident(torvin,torvinNpc,[])]};
}
function proposal(mode:'honest'|'fabricate'='honest', informational=false) { return {version:'social-encounter-v1',templateKey:'road-rumor',participantResidentIds:[lira,torvin],privateCommunicativeIntents:informational ? [] : [{speakerResidentId:lira,recipientResidentId:torvin,mode,message:mode==='fabricate' ? 'Lira privately floats a misleading trail rumor.' : 'Lira privately shares the smoke report.'}],privateExchangeSummary:informational ? 'They exchange a quiet greeting and leave matters unchanged.' : 'Lira privately summarizes the smoke report for Torvin.',evidenceIds:['evidence-smoke'],causalExplanation:'The encounter relies only on the frozen smoke report.',relationshipEffects:informational ? [] : [{recipientResidentId:torvin,sourceResidentId:lira,axis:'trust',delta:1}],gossipBeliefAdditions:informational ? [] : [{recipientResidentId:torvin,sourceResidentId:lira,sourceBeliefId:beliefId,sourceEvidenceId:'evidence-smoke',originalClaimFingerprint:fingerprint,content:'Smoke rose by the northern pass.',confidence:56,provenance:[{sourceKind:'direct_evidence',sourceId:'evidence-smoke'},{sourceKind:'gossip',sourceId:beliefId,speakerNpcId:liraNpc}]}],publicSummary:informational ? null : 'Lira and Torvin compared reports by the northern road.'}; }
function completed(value:unknown) { return new Response(JSON.stringify({status:'completed',usage:{input_tokens:13,output_tokens:5},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}),{status:200,headers:{'content-type':'application/json'}}); }

afterEach(() => vi.unstubAllGlobals());

describe('social encounter provider stages', () => {
  it('validates honest and attributed gossip proposals against the direct frozen context', async () => {
    const requests:any[]=[];
    vi.stubGlobal('fetch',vi.fn(async (_url, init:RequestInit) => { requests.push(JSON.parse(String(init.body))); return completed({proposalJson:JSON.stringify(proposal())}); }));
    const result=await createSettlementProvider({OPENAI_API_KEY:'test-key'}).generate('social_encounter_proposer',contextRaw(),new AbortController().signal);
    expect(result).toMatchObject({value:proposal(),model:'gpt-5.6-terra',promptVersion:SOCIAL_ENCOUNTER_SETTLEMENT_PROMPT_VERSION,usage:{input:13,output:5}});
    expect(result.value).toMatchObject({gossipBeliefAdditions:[{sourceBeliefId:beliefId,sourceEvidenceId:'evidence-smoke',originalClaimFingerprint:fingerprint}]});
    expect(requests[0].text.format).toMatchObject({name:'world_social_encounter_proposer',strict:true,schema:{additionalProperties:false,required:['proposalJson'],properties:{proposalJson:{maxLength:12000}}}});
  });

  it('allows authorized deception but fails closed when the frozen capability does not allow it', async () => {
    const allowed=contextRaw(['deceive','share_gossip']);
    const parsed=parseFrozenSocialEncounterContext(allowed); if (!parsed) throw new Error('fixture must parse');
    expect(parseSocialEncounterProposal(proposal('fabricate'),parsed).ok).toBe(true);
    const forbidden=contextRaw(['share_gossip']);
    const frozen=parseFrozenSocialEncounterContext(forbidden); if (!frozen) throw new Error('fixture must parse');
    expect(parseSocialEncounterProposal(proposal('fabricate'),frozen).ok).toBe(false);
    vi.stubGlobal('fetch',vi.fn(async () => completed({proposalJson:JSON.stringify(proposal('fabricate'))})));
    await expect(createSettlementProvider({OPENAI_API_KEY:'test-key'}).generate('social_encounter_proposer',forbidden,new AbortController().signal)).rejects.toMatchObject({code:'provider_malformed'});
  });

  it('uses the dedicated closed social critic schema and rejects repair from the final critic', async () => {
    const requests:any[]=[]; let call=0;
    vi.stubGlobal('fetch',vi.fn(async (_url, init:RequestInit) => { requests.push(JSON.parse(String(init.body))); return completed(call++ === 0 ? {decision:'repair',instructions:[{code:'gossip_attribution',path:'gossipBeliefAdditions'}]} : {decision:'repair',instructions:[{code:'private_summary',path:'privateExchangeSummary'}]}); }));
    const provider=createSettlementProvider({OPENAI_API_KEY:'test-key'}); const payload={context:contextRaw(),proposal:proposal()};
    await expect(provider.generate('social_encounter_critic',payload,new AbortController().signal)).resolves.toMatchObject({value:{decision:'repair',instructions:[{code:'gossip_attribution',path:'gossipBeliefAdditions'}]},model:'gpt-5.6-luna'});
    await expect(provider.generate('social_encounter_final_critic',payload,new AbortController().signal)).rejects.toMatchObject({code:'provider_malformed'});
    expect(requests[0].text.format.schema).toMatchObject({additionalProperties:false,required:['decision','instructions'],properties:{decision:{enum:['accept','reject','repair']},instructions:{minItems:0,maxItems:4,items:{additionalProperties:false,required:['code','path'],properties:{code:{enum:expect.arrayContaining(['gossip_attribution'])},path:{enum:expect.arrayContaining(['gossipBeliefAdditions'])}}}}}});
    expect(requests[0].text.format.schema).not.toHaveProperty('allOf');
    expect(requests[0].input[0].content).toContain('publicCanon');
    expect(requests[0].input[0].content).toContain('private context');
    expect(requests[0].input[0].content).not.toContain('outcome');
    expect(requests[1].text.format.schema).toMatchObject({properties:{decision:{enum:['accept','reject']},instructions:{maxItems:0}}});
  });

  it('accepts an informational no-change proposal and keeps repair input frozen to context', async () => {
    const requests:any[]=[];
    vi.stubGlobal('fetch',vi.fn(async (_url, init:RequestInit) => { requests.push(JSON.parse(String(init.body))); return completed({proposalJson:JSON.stringify(proposal('honest',true))}); }));
    const context=contextRaw(); const result=await createSettlementProvider({OPENAI_API_KEY:'test-key'}).generate('social_encounter_repair',{context,proposal:proposal(),instructions:[{code:'public_projection',path:'publicSummary'}]},new AbortController().signal);
    expect(result.value).toMatchObject({privateCommunicativeIntents:[],relationshipEffects:[],gossipBeliefAdditions:[],publicSummary:null});
    expect(requests[0].model).toBe('gpt-5.6-terra');
    expect(requests[0].input[0].content).toContain('may not introduce participants');
  });

  it('fails closed for malformed social output and leaves local mode explicitly unavailable', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => completed({proposalJson:'{not json'})));
    const provider=createSettlementProvider({OPENAI_API_KEY:'test-key'});
    await expect(provider.generate('social_encounter_proposer',contextRaw(),new AbortController().signal)).rejects.toMatchObject({code:'provider_malformed'});
    await expect(createSettlementProvider({NPC_PROVIDER:'local',OPENAI_API_KEY:'test-key'}).generate('social_encounter_proposer',contextRaw(),new AbortController().signal)).rejects.toMatchObject({code:'provider_unavailable'});
  });

  it('rejects malformed critic and repair payloads before calling the provider', async () => {
    const fetch=vi.fn(async () => completed({decision:'accept',instructions:[]})); vi.stubGlobal('fetch',fetch);
    const provider=createSettlementProvider({OPENAI_API_KEY:'test-key'});
    await expect(provider.generate('social_encounter_critic',{context:contextRaw(),proposal:{wrong:true}},new AbortController().signal)).rejects.toMatchObject({code:'provider_malformed'});
    await expect(provider.generate('social_encounter_repair',{context:contextRaw(),proposal:proposal(),instructions:[{code:'invented_fact',path:'publicSummary'}]},new AbortController().signal)).rejects.toMatchObject({code:'provider_malformed'});
    await expect(provider.generate('social_encounter_proposer',{context:contextRaw()},new AbortController().signal)).rejects.toMatchObject({code:'provider_malformed'});
    expect(fetch).not.toHaveBeenCalled();
  });
});
