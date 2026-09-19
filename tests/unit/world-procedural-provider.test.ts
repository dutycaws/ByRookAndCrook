import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFrozenProceduralWorldContext, parseProceduralWorldProposal } from '../../src/lib/game/evolving-world';
import { PROCEDURAL_WORLD_CHECKPOINT_STAGE, PROCEDURAL_WORLD_SETTLEMENT_PROMPT_VERSION, SETTLEMENT_PROVIDER_CALL_BUDGETS, createSettlementProvider as createSettlementProviderBase, promptVersionForProviderStage } from '../../src/lib/server/evolving-world';
import { SETTLEMENT_PROMPT_KEY } from '../../src/lib/server/prompt-registry';
import { fixturePromptRelease } from '../helpers/prompt-registry-fixture';

const promptRelease=fixturePromptRelease;
function createSettlementProvider(config: Record<string,string|undefined>) {
  const provider=createSettlementProviderBase(config);
  return { ...provider, generate(stage: Parameters<typeof provider.generate>[0], payload: unknown, signal: AbortSignal) {
    return provider.generate(stage,payload,signal,promptRelease.prompts[SETTLEMENT_PROMPT_KEY[stage]]);
  } };
}

const resident='11111111-1111-4111-8111-111111111111';
function context() { return {version:'procedural-world-v1',entityKinds:{millhaven:'location'},activeGeneratedEntityCount:12,activeQuestByResident:{},capabilities:{[resident]:{version:'capabilities-v1',allowedActions:['prepare'],allowedApproaches:['scouting'],allowedWorldEffects:['create_entity','record_world_event'],allowedTargetKinds:['location'],socialCapabilities:[],irreversibleEffects:[]}}}; }
function proposal() { return {version:'procedural-world-v1',commands:[{operation:'entity',effectKind:'create_entity',sourceResidentId:resident,entityKind:'place',entityKey:'Old Mill',archetypeKey:'landmark',proposedName:'Old Mill',payload:{region:'north'}},{operation:'public_event',effectKind:'record_world_event',sourceResidentId:resident,templateKey:'market-day',participantEntityRefs:['millhaven'],title:'Market day returns',summary:'Merchants gather by the old mill.',reuseKey:'old-mill-market'}]}; }
function completed(value:unknown) { return new Response(JSON.stringify({status:'completed',usage:{input_tokens:11,output_tokens:4},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}),{status:200,headers:{'content-type':'application/json'}}); }

afterEach(() => vi.unstubAllGlobals());

describe('procedural world provider stages', () => {
  it('freezes the namespaced budget, stage mapping, prompt version, and exact five-field DB context', () => {
    expect(PROCEDURAL_WORLD_CHECKPOINT_STAGE).toEqual({procedural_world_proposer:'proposer',procedural_world_critic:'critic',procedural_world_repair:'repair',procedural_world_final_critic:'final_critic'});
    expect(SETTLEMENT_PROVIDER_CALL_BUDGETS.procedural_world).toEqual({maximum:4,ordinary:2,stages:['procedural_world_proposer','procedural_world_critic','procedural_world_repair','procedural_world_final_critic']});
    expect(promptVersionForProviderStage('procedural_world_proposer')).toBe(PROCEDURAL_WORLD_SETTLEMENT_PROMPT_VERSION);
    expect(parseFrozenProceduralWorldContext(context())).toMatchObject({version:'procedural-world-v1',entityKinds:{millhaven:'location'}});
    expect(parseFrozenProceduralWorldContext({...context(),unexpected:true})).toBeNull();
    expect(parseFrozenProceduralWorldContext({...context(),activeGeneratedEntityCount:150.5})).toBeNull();
  });

  it('parses a frozen-authorized procedural proposal and uses the character model with bounded proposal output', async () => {
    const requests:any[]=[];
    vi.stubGlobal('fetch',vi.fn(async (_url, init:RequestInit) => { requests.push(JSON.parse(String(init.body))); return completed({proposalJson:JSON.stringify(proposal())}); }));
    const result=await createSettlementProvider({OPENAI_API_KEY:'test-key'}).generate('procedural_world_proposer',context(),new AbortController().signal);
    expect(result).toMatchObject({value:{version:'procedural-world-v1'},model:'gpt-5.6-terra',promptVersion:'procedural-world-v1',usage:{input:11,output:4}});
    expect((result.value as any).commands).toHaveLength(2);
    expect(requests[0].text.format).toMatchObject({name:'world_procedural_world_proposer',strict:true,schema:{additionalProperties:false,required:['proposalJson'],properties:{proposalJson:{maxLength:12000}}}});
    expect(requests[0].input[0].content).toContain('frozen five-field context');
  });

  it('rejects commands not authorized by frozen capability or context', async () => {
    const frozen=parseFrozenProceduralWorldContext(context()); if (!frozen) throw new Error('fixture must parse');
    const denied={...proposal(),commands:[{...proposal().commands[0],sourceResidentId:'22222222-2222-4222-8222-222222222222'}]};
    expect(parseProceduralWorldProposal(denied,frozen).ok).toBe(false);
    vi.stubGlobal('fetch',vi.fn(async () => completed({proposalJson:JSON.stringify(denied)})));
    await expect(createSettlementProvider({OPENAI_API_KEY:'test-key'}).generate('procedural_world_proposer',context(),new AbortController().signal)).rejects.toMatchObject({code:'provider_malformed'});
  });

  it('uses closed critic instructions, accepts only terminal final decisions, and validates all envelopes before fetch', async () => {
    const requests:any[]=[]; let call=0;
    const fetch=vi.fn(async (_url, init:RequestInit) => { requests.push(JSON.parse(String(init.body))); return completed(call++ === 0 ? {decision:'repair',instructions:[{code:'entity_registry',path:'commands.entity'}]} : {decision:'repair',instructions:[{code:'budget',path:'commands'}]}); }); vi.stubGlobal('fetch',fetch);
    const provider=createSettlementProvider({OPENAI_API_KEY:'test-key'}); const review={context:context(),proposal:proposal()};
    await expect(provider.generate('procedural_world_critic',review,new AbortController().signal)).resolves.toMatchObject({value:{decision:'repair',instructions:[{code:'entity_registry',path:'commands.entity'}]},model:'gpt-5.6-luna'});
    await expect(provider.generate('procedural_world_final_critic',review,new AbortController().signal)).rejects.toMatchObject({code:'provider_malformed'});
    expect(requests[0].text.format.schema).toMatchObject({additionalProperties:false,properties:{decision:{enum:['accept','reject','repair']},instructions:{maxItems:4,items:{additionalProperties:false,properties:{code:{enum:expect.arrayContaining(['entity_registry'])},path:{enum:expect.arrayContaining(['commands.entity'])}}}}}});
    expect(requests[1].text.format.schema).toMatchObject({properties:{decision:{enum:['accept','reject']},instructions:{maxItems:0}}});
    await expect(provider.generate('procedural_world_repair',{context:context(),proposal:proposal(),instructions:[{code:'not-real',path:'commands'}]},new AbortController().signal)).rejects.toMatchObject({code:'provider_malformed'});
    await expect(provider.generate('procedural_world_critic',{context:context(),proposal:{bad:true}},new AbortController().signal)).rejects.toMatchObject({code:'provider_malformed'});
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('parses a valid bounded repair against its frozen context', async () => {
    const requests:any[]=[];
    vi.stubGlobal('fetch',vi.fn(async (_url, init:RequestInit) => { requests.push(JSON.parse(String(init.body))); return completed({proposalJson:JSON.stringify(proposal())}); }));
    const result=await createSettlementProvider({OPENAI_API_KEY:'test-key'}).generate('procedural_world_repair',{context:context(),proposal:proposal(),instructions:[{code:'entity_registry',path:'commands.entity'}]},new AbortController().signal);
    expect(result).toMatchObject({value:{version:'procedural-world-v1'},model:'gpt-5.6-terra',promptVersion:'procedural-world-v1'});
    expect(requests[0].text.format).toMatchObject({name:'world_procedural_world_repair',schema:{additionalProperties:false,required:['proposalJson'],properties:{proposalJson:{maxLength:12000}}}});
  });

  it('rejects malformed provider output and keeps local mode unavailable', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => completed({proposalJson:'not-json'})));
    await expect(createSettlementProvider({OPENAI_API_KEY:'test-key'}).generate('procedural_world_proposer',context(),new AbortController().signal)).rejects.toMatchObject({code:'provider_malformed'});
    await expect(createSettlementProvider({NPC_PROVIDER:'local',OPENAI_API_KEY:'test-key'}).generate('procedural_world_proposer',context(),new AbortController().signal)).rejects.toMatchObject({code:'provider_unavailable'});
  });
});
