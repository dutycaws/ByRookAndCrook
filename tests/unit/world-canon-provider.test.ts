import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANON_CHECKPOINT_STAGE,
  CANON_SETTLEMENT_PROMPT_VERSION,
  SETTLEMENT_PROVIDER_CALL_BUDGETS,
  checkpointStageForProviderStage,
  createSettlementProvider,
  frozenCanonEventContext,
  parseFrozenCanonEventProposal,
  promptVersionForProviderStage
} from '../../src/lib/server/evolving-world';

const event=()=>({
  version:'world-canon-event-v1',kind:'world_event',templateKey:'market-day',participantEntityIds:['lira','millhaven'],
  title:'Market day reaches Millhaven',summary:'Travelers gather near the mill road.',reuseKey:'millhaven-market-day',
  payload:{template:'market-day',participants:['lira','millhaven'],visibility:'public'}
});
const payload=()=>({worldSnapshot:{
  registeredTemplateKeys:['market-day','storm-front'],entityKinds:{lira:'npc',millhaven:'location'},
  activeGeneratedEntityCount:149,existingPublicEventReuseKeys:[]
}});

function completed(value: unknown) {
  return new Response(JSON.stringify({status:'completed',usage:{input_tokens:13,output_tokens:5},output:[{
    type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]
  }]}),{status:200,headers:{'content-type':'application/json'}});
}

afterEach(() => vi.unstubAllGlobals());

describe('world canon event provider stages',()=>{
  it('freezes canon provider names onto the existing durable checkpoint names and prompt versions',()=>{
    expect(CANON_CHECKPOINT_STAGE).toEqual({canon_proposer:'proposer',canon_critic:'critic',canon_repair:'repair',canon_final_critic:'final_critic'});
    expect(SETTLEMENT_PROVIDER_CALL_BUDGETS).toEqual({
      resident:{maximum:5,stages:['proposer','critic','repair','final_critic','digest']},
      canon:{maximum:4,accepted:2,stages:['canon_proposer','canon_critic','canon_repair','canon_final_critic']},
      social_encounter:{maximum:4,ordinary:2,stages:['social_encounter_proposer','social_encounter_critic','social_encounter_repair','social_encounter_final_critic']},
      procedural_world:{maximum:4,ordinary:2,stages:['procedural_world_proposer','procedural_world_critic','procedural_world_repair','procedural_world_final_critic']},
      news:{maximum:0,stages:[]}
    });
    expect(SETTLEMENT_PROVIDER_CALL_BUDGETS.canon.stages).not.toContain('digest');
    expect(checkpointStageForProviderStage('canon_repair')).toBe('repair');
    expect(checkpointStageForProviderStage('proposer')).toBe('proposer');
    expect(promptVersionForProviderStage('canon_proposer')).toBe(CANON_SETTLEMENT_PROMPT_VERSION);
    expect(promptVersionForProviderStage('proposer')).toBe('world-settlement-v1');
  });
  it('derives a strict validation context only from the frozen world snapshot',()=>{
    expect(frozenCanonEventContext(payload())).toMatchObject({activeGeneratedEntityCount:149,entityKinds:{lira:'npc'}});
    expect(frozenCanonEventContext({worldSnapshot:{...payload().worldSnapshot,activeGeneratedEntityCount:150.5}})).toBeNull();
    expect(frozenCanonEventContext({worldSnapshot:{...payload().worldSnapshot,existingPublicEventReuseKeys:['Bad Key']}})).toBeNull();
    expect(frozenCanonEventContext({worldSnapshot:{...payload().worldSnapshot,registeredTemplateKeys:['storm-front','market-day']}})).toBeNull();
    expect(frozenCanonEventContext({worldSnapshot:{...payload().worldSnapshot,existingPublicEventReuseKeys:['zeta','alpha']}})).toBeNull();
    expect(parseFrozenCanonEventProposal(event(),payload())).toMatchObject({templateKey:'market-day'});
    expect(parseFrozenCanonEventProposal(event(),{proposal:event(),instructions:['Keep it public.'],...payload()})).toMatchObject({templateKey:'market-day'});
    expect(parseFrozenCanonEventProposal({...event(),templateKey:'festival-arrival',payload:{...event().payload,template:'festival-arrival'}},payload())).toBeNull();
  });
  it('builds and validates canon proposer and repair requests with exact schemas',async()=>{
    const requests: any[]=[];
    vi.stubGlobal('fetch',vi.fn(async (_url, init:RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return completed({eventJson:JSON.stringify(event())});
    }));
    const provider=createSettlementProvider({OPENAI_API_KEY:'test-key'});
    const proposed=await provider.generate('canon_proposer',payload(),new AbortController().signal);
    const repaired=await provider.generate('canon_repair',payload(),new AbortController().signal);
    expect(proposed).toMatchObject({value:event(),model:'gpt-5.6-terra',promptVersion:'world-canon-event-v1',usage:{input:13,output:5}});
    expect(repaired).toMatchObject({value:event(),model:'gpt-5.6-terra',promptVersion:'world-canon-event-v1'});
    expect(requests.map((request) => request.text.format.name)).toEqual(['world_canon_proposer','world_canon_repair']);
    for (const request of requests) {
      expect(request.text.format.schema).toEqual(expect.objectContaining({
        additionalProperties:false,required:['eventJson'],properties:{eventJson:expect.objectContaining({maxLength:4096})}
      }));
      expect(request.input[0].content).toContain('frozen day-close worldSnapshot');
      expect(request.reasoning).toEqual({effort:'low'});
    }
  });
  it('uses strict critic schemas and cheap review model for canon criticism',async()=>{
    const requests: any[]=[];
    vi.stubGlobal('fetch',vi.fn(async (_url, init:RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return completed({outcome:'accept',rationale:'Frozen inputs match.',instructions:[]});
    }));
    const provider=createSettlementProvider({OPENAI_API_KEY:'test-key'});
    const critic=await provider.generate('canon_critic',payload(),new AbortController().signal);
    const final=await provider.generate('canon_final_critic',payload(),new AbortController().signal);
    expect(critic).toMatchObject({value:{outcome:'accept',rationale:'Frozen inputs match.',instructions:[]},model:'gpt-5.6-luna',promptVersion:'world-canon-event-v1'});
    expect(final).toMatchObject({model:'gpt-5.6-luna'});
    expect(requests.map((request) => request.text.format.name)).toEqual(['world_canon_critic','world_canon_final_critic']);
    expect(requests.every((request) => request.reasoning.effort==='none')).toBe(true);
  });
  it('preserves resident proposal parsing and fails closed for malformed canon output or local mode',async()=>{
    vi.stubGlobal('fetch',vi.fn(async () => completed({proposalJson:JSON.stringify({rulesVersion:'evolving-world-v1'})})));
    const provider=createSettlementProvider({OPENAI_API_KEY:'test-key'});
    await expect(provider.generate('proposer',{resident:true},new AbortController().signal)).resolves.toMatchObject({
      value:{rulesVersion:'evolving-world-v1'},promptVersion:'world-settlement-v1'
    });
    vi.stubGlobal('fetch',vi.fn(async () => completed({eventJson:JSON.stringify({...event(),participantEntityIds:['unknown'],payload:{template:'market-day',participants:['unknown'],visibility:'public'}})})));
    await expect(provider.generate('canon_proposer',payload(),new AbortController().signal)).rejects.toMatchObject({code:'provider_malformed'});
    await expect(createSettlementProvider({NPC_PROVIDER:'local',OPENAI_API_KEY:'test-key'}).generate('canon_proposer',payload(),new AbortController().signal)).rejects.toMatchObject({code:'provider_unavailable'});
  });
});
