import { describe,it,expect } from 'vitest';
import { mergeEnvironment } from '../../scripts/environment-merge';
import { parseInput,runDialogue,validateDecision } from '../../src/lib/server/dialogue/orchestrator';
import { createProvider, type DialogueProvider } from '../../src/lib/server/dialogue/provider';

const npcId='11111111-1111-4111-8111-111111111111';
const turnId='22222222-2222-4222-8222-222222222222';

function rpcResult(data: unknown) {
  return {
    abortSignal: async () => ({ data, error: null })
  };
}

function cognitionClient(base: Record<string, unknown>) {
  const evidence: Record<string, unknown> = {
    beliefs:[{id:'belief-1',statement:'The keeper may be unreliable.',confidence:55,provenance:[{sourceKind:'dialogue_claim'}]}],
    relationships:{facts:[{text:'Mara is an ally.'}],relationships:[{name:'Mara',kind:'friend'}],currentSocial:[{toInstanceId:'mara',fear:82,respect:11}]},
    quests:[{id:'quest-1',text:'The mill road remains unsafe.'}]
  };
  return {
    rpc(name:string,args?:Record<string, unknown>) {
      if(name==='npc_dialogue_begin') return rpcResult({status:'processing',fence:'fence-1',checkpoints:{},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_context') return rpcResult(args?.p_category==='base' ? base : evidence[String(args?.p_category)] ?? []);
      if(name==='npc_dialogue_checkpoint') return rpcResult(null);
      if(name==='npc_dialogue_complete') return rpcResult({status:'completed',reply:'Recorded.'});
      throw new Error(`Unexpected RPC ${name}`);
    }
  } as any;
}
describe('dialogue boundaries',()=>{
  it('preserves custom environment configuration and multiline values',()=>{
    const original='OPENAI_API_KEY="test-only-placeholder"\nCUSTOM="first\nsecond"\nPUBLIC_SUPABASE_URL=old\n';
    const result=mergeEnvironment(original,{PUBLIC_SUPABASE_URL:'http://127.0.0.1:57321'});
    expect(result).toContain('OPENAI_API_KEY="test-only-placeholder"');expect(result).toContain('CUSTOM="first\nsecond"');expect(result).not.toContain('=old');
  });
  it('accepts intent and hospitality independently and validates message/sequence',()=>{
    const input={turnId:crypto.randomUUID(),npcId:crypto.randomUUID(),message:'Hello',expectedConversationSequence:0,interactionVersion:'dialogue-v2' as const};
    expect(parseInput(input)).toMatchObject({intentCardId:null,offering:null});
    expect(parseInput({...input,intentCardId:crypto.randomUUID()}).offering).toBeNull();
    expect(parseInput({...input,offering:{kind:'beverage',itemId:crypto.randomUUID()}}).intentCardId).toBeNull();
    expect(()=>parseInput({...input,offering:{kind:'invalid',itemId:crypto.randomUUID()}})).toThrow();
    expect(()=>parseInput({...input,message:' '.repeat(2001)})).toThrow();
  });
  it('removes unsupported effects and requires quoted player evidence',()=>{
    const base={questStatus:'active',allowedTargets:['millhaven']};
    const d={stance:'agree',reaction:1,subject:'quest',evidence:'invented quote',intention:null};
    expect(validateDecision(d,base,'hello').reaction).toBe(0);
    expect(validateDecision({...d,gold:1000},base,'hello').stance).toBe('clarify');
  });
  it('requires the only terminal action to be the last daily step',()=>{
    const base={questStatus:'active',allowedTargets:['millhaven']};
    const proposal={stance:'agree',reaction:0,subject:'quest',evidence:'',intention:{goal:'Guard Millhaven',motivation:'Protect travelers',targets:['millhaven'],steps:[] as any[]}};
    for(const actions of [['attempt','prepare','attempt'],['abandon','attempt'],['prepare'],['wait']]) {
      proposal.intention.steps=actions.map(action=>({action,approach:'scouting'}));
      expect(validateDecision(proposal,base,'Please consider this plan.').stance).toBe('clarify');
      expect(validateDecision(proposal,base,'Please consider this plan.').intention).toBeNull();
    }
    for(const actions of [['attempt'],['abandon'],['prepare','wait','attempt'],['prepare','abandon']]) {
      proposal.intention.steps=actions.map(action=>({action,approach:'scouting'}));
      expect(validateDecision(proposal,base,'Please consider this plan.').intention).toEqual(proposal.intention);
    }
  });
  it('local mode never falls back to a hosted provider',async()=>{
    await expect(createProvider({NPC_PROVIDER:'local',OPENAI_API_KEY:'test-only-placeholder'}).generate('speak',{},new AbortController().signal)).rejects.toThrow('not implemented');
  });
  it('emits a sanitized provider-stage failure without retaining keeper prose or provider error text',async()=>{
    const base={name:'Lira',recent:[],questStatus:'active',allowedTargets:['millhaven'],personality:{values:['care']}};
    const provider: DialogueProvider={ async generate() { const error=Object.assign(new Error('provider exposed sk-secret-value'),{name:'ProviderUnavailable'}); throw error; } };
    const operationalEvents: unknown[]=[];
    await expect(runDialogue(cognitionClient(base),'33333333-3333-4333-8333-333333333333',{
      turnId,npcId,message:'A private keeper message.',expectedConversationSequence:0,interactionVersion:'dialogue-v2'
    },provider,{rounds:1,observability:(event)=>{operationalEvents.push(event);}})).rejects.toMatchObject({code:'PROVIDER_FAILED'});
    expect(operationalEvents).toEqual([expect.objectContaining({correlationId:turnId,workflow:'dialogue',stage:'investigate0',status:'failed',attempt:1,errorCode:'provider_unavailable'})]);
    expect(JSON.stringify(operationalEvents)).not.toContain('private keeper message');
    expect(JSON.stringify(operationalEvents)).not.toContain('sk-secret-value');
  });
  it('uses private cognition for investigation and deliberation but removes it from speech and review',async()=>{
    const base={
      name:'Lira',message:'Can Mara help with the mill road?',recent:[],questStatus:'active',allowedTargets:['millhaven'],
      intention:{goal:'Protect Millhaven',motivation:'Keep travelers safe',targets:['millhaven'],steps:[{action:'attempt',approach:'scouting'}]},
      personality:{values:['care']},evolvingProfile:{privateMotivation:'Do not reveal this.'},profileRevision:7,
      pressure:{hidden:true},privateIntent:{goal:'Never serialize this.'}
    };
    const payloads: Record<string, any>={};
    const provider: DialogueProvider={
      async generate(stage,payload) {
        payloads[stage]=payload;
        const value=stage==='investigate'
          ? {kind:'social',needsMore:false,remember:false,requests:[
            {category:'beliefs',query:'Mara'}, {category:'relationships',query:'Mara'}, {category:'quests',query:'mill road'}
          ]}
          : stage==='deliberate'
            ? {stance:'respond',reaction:0,subject:'personal',evidence:'',intention:null}
            : stage==='speak'
              ? {text:'Mara has stood beside me before. I will ask what she has heard.'}
              : {ok:true,issues:[]};
        return {value,usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
      }
    };
    const operationalEvents: unknown[]=[];
    const result=await runDialogue(cognitionClient(base),'33333333-3333-4333-8333-333333333333',{
      turnId,npcId,message:base.message,expectedConversationSequence:0,interactionVersion:'dialogue-v2'
    },provider,{rounds:1,observability:(event)=>{operationalEvents.push(event);}});
    expect(result.status).toBe('completed');
    expect(payloads.investigate.privateCognition).toMatchObject({profileRevision:7,evolvingProfile:{privateMotivation:'Do not reveal this.'}});
    expect(payloads.deliberate.privateCognition).toMatchObject({
      beliefs:[[expect.objectContaining({statement:'The keeper may be unreliable.'})]],
      currentSocial:[[expect.objectContaining({fear:82})]]
    });
    expect(payloads.speak.base).toMatchObject({name:'Lira',personality:{values:['care']}});
    expect(payloads.speak.context).toEqual(expect.arrayContaining([
      expect.objectContaining({category:'relationships',data:expect.objectContaining({facts:[{text:'Mara is an ally.'}]})}),
      expect.objectContaining({category:'quests',data:[{id:'quest-1',text:'The mill road remains unsafe.'}]})
    ]));
    for(const payload of [payloads.speak,payloads.review]) {
      const serialized=JSON.stringify(payload);
      expect(serialized).not.toContain('Do not reveal this.');
      expect(serialized).not.toContain('The keeper may be unreliable.');
      expect(serialized).not.toContain('"fear":82');
      expect(serialized).not.toContain('Never serialize this.');
      expect(payload.privateCognition).toBeUndefined();
      expect(payload.base.evolvingProfile).toBeUndefined();
      expect(payload.base.profileRevision).toBeUndefined();
    }
    expect(operationalEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({correlationId:turnId,workflow:'dialogue',stage:'investigate0',status:'completed',attempt:1,model:'fixture',tokenUsage:{input:1,output:1}}),
      expect.objectContaining({correlationId:turnId,workflow:'dialogue',stage:'speak',status:'completed'})
    ]));
    expect(JSON.stringify(operationalEvents)).not.toContain(base.message);
    expect(JSON.stringify(operationalEvents)).not.toContain('Do not reveal this.');
    expect(JSON.stringify(operationalEvents)).not.toContain('The keeper may be unreliable.');
  });
});
