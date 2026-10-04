import { describe,it,expect } from 'vitest';
import { mergeEnvironment } from '../../scripts/environment-merge';
import { parseInput,runDialogue,validateDecision } from '../../src/lib/server/dialogue/orchestrator';
import { createProvider, type DialogueProvider } from '../../src/lib/server/dialogue/provider';
import { matchesSchema, normalizeRememberOutput, schemas } from '../../src/lib/server/dialogue/schemas';
import { fixturePromptRegistry, fixturePromptRelease } from '../helpers/prompt-registry-fixture';

const npcId='11111111-1111-4111-8111-111111111111';
const turnId='22222222-2222-4222-8222-222222222222';
const promptRegistry = fixturePromptRegistry();

describe('remember output normalization', () => {
  it('normalizes keeper promises and preserves NPC promises and source wording', () => {
    const keeper = { kind:'promise', text:'I will scout tomorrow.', quote:'I will scout tomorrow.', speaker:'keeper', priorCommitmentId:null, commitmentStatus:'unresolved' };
    const npc = { kind:'promise', text:'I will bring supplies.', quote:'I will bring supplies.', speaker:'npc', priorCommitmentId:null, commitmentStatus:'unresolved' };
    const output = normalizeRememberOutput({ memories:[keeper,npc] }) as { memories: unknown[] };

    expect(output.memories).toEqual([
      { ...keeper, kind:'keeper_claim', commitmentStatus:null, priorCommitmentId:null },
      npc
    ]);
  });

  it('accepts only SQL-valid new-promise, correction, and ordinary-record metadata pairs', () => {
    const base = { kind:'promise', text:'I will scout tomorrow.', quote:'I will scout tomorrow.', speaker:'npc', priorCommitmentId:null, commitmentStatus:'unresolved' };
    expect(matchesSchema({memories:[base]},schemas.remember)).toBe(true);
    expect(matchesSchema({memories:[{...base,priorCommitmentId:crypto.randomUUID(),commitmentStatus:'withdrawn'}]},schemas.remember)).toBe(true);
    expect(matchesSchema({memories:[{...base,kind:'npc_statement',priorCommitmentId:null,commitmentStatus:null}]},schemas.remember)).toBe(true);
    expect(matchesSchema({memories:[{...base,priorCommitmentId:crypto.randomUUID(),commitmentStatus:'unresolved'}]},schemas.remember)).toBe(false);
    expect(matchesSchema({memories:[{...base,priorCommitmentId:null,commitmentStatus:'disputed'}]},schemas.remember)).toBe(false);
    expect(matchesSchema({memories:[{...base,priorCommitmentId:null,commitmentStatus:null}]},schemas.remember)).toBe(false);
  });
});

function rpcResult(data: unknown) {
  return {
    abortSignal: async () => ({ data, error: null })
  };
}
const emptyEvidence=(cutoff=0)=>({retrievalVersion:'npc-memory-evidence-v4',cutoffLedgerSequence:cutoff,semantic:{available:false,availability:'disabled',profile:null},items:[],bundles:[],sourceFallback:[],sourceManifest:[],coverage:{complete:true,sourceFallback:{total:0,included:0,truncated:false,complete:true},watermarks:[]}});

function cognitionClient(base: Record<string, unknown>) {
  base.instanceId ??= npcId;
  const evidence: Record<string, unknown> = {
    beliefs:[{id:'belief-1',statement:'The keeper may be unreliable.',confidence:55,provenance:[{sourceKind:'dialogue_claim'}]}],
    relationships:{facts:[{text:'Mara is an ally.'}],relationships:[{name:'Mara',kind:'friend'}],currentSocial:[{toInstanceId:'mara',fear:82,respect:11}]},
    quests:[{id:'quest-1',text:'The mill road remains unsafe.'}]
  };
  return {
    rpc(name:string,args?:Record<string, unknown>) {
      if(name==='npc_dialogue_begin') return rpcResult({status:'processing',fence:'fence-1',checkpoints:{},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_context') return rpcResult(args?.p_category==='base' ? base : evidence[String(args?.p_category)] ?? []);
      if(name==='npc_memory_evidence_retrieve_for_actor') return rpcResult(emptyEvidence(Number(args?.p_cutoff_ledger_sequence ?? 0)));
      if(name==='npc_dialogue_checkpoint') return rpcResult(null);
      if(name==='npc_dialogue_complete') return rpcResult({status:'completed',reply:'Recorded.'});
      throw new Error(`Unexpected RPC ${name}`);
    }
  } as any;
}
describe('dialogue boundaries',()=>{
  it('marks a claimed turn failed before returning a registry outage',async()=>{
    const calls:Array<{name:string;args:Record<string,unknown>}> = [];
    const signals:AbortSignal[] = [];
    const result=(data:unknown)=>({
      data,
      error:null,
      abortSignal(signal:AbortSignal) { signals.push(signal); return {data,error:null}; }
    });
    const client={rpc(name:string,args:Record<string,unknown>={}) {
      calls.push({name,args});
      if(name==='npc_dialogue_begin') return result({status:'processing',fence:'fence-1',checkpoints:{},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_checkpoint') return result(null);
      throw new Error(`Unexpected RPC ${name}`);
    }} as any;
    const unavailablePromptRegistry={async resolveForWork() { throw new Error('registry unavailable'); }};

    await expect(runDialogue(client,'33333333-3333-4333-8333-333333333333',{
      turnId,npcId,message:'Hello',expectedConversationSequence:0,interactionVersion:'dialogue-v2'
    },{} as DialogueProvider,{promptRegistry:unavailablePromptRegistry as any})).rejects.toMatchObject({status:503,code:'REGISTRY_UNAVAILABLE'});

    expect(calls.map((call)=>call.name)).toEqual(['npc_dialogue_begin','npc_dialogue_checkpoint']);
    expect(calls[1].args).toMatchObject({
      p_actor:'33333333-3333-4333-8333-333333333333',
      p_turn_id:turnId,
      p_fence:'fence-1',
      p_stage:'fail',
      p_value:{code:'REGISTRY_UNAVAILABLE'}
    });
    expect(signals).toHaveLength(2);
    expect(signals[1]).not.toBe(signals[0]);
  });

  it('retries a newly generated Remember result whose NPC quote is not an exact source substring',async()=>{
    const base={instanceId:npcId,name:'Lira',recent:[],questStatus:'active',allowedTargets:[]};
    const invalidQuote='I will scout at sunrise.';
    const exactQuote='I will scout at dawn.';
    const reply=exactQuote;
    const rememberWrites:unknown[]=[]; const rememberPayloads:any[]=[];
    const checkpoints:Record<string,any>={};
    let rememberCalls=0; let completionCalls=0;
    const client={rpc(name:string,args?:Record<string,unknown>) {
      if(name==='npc_dialogue_begin') return rpcResult({status:'processing',fence:'fence-1',checkpoints:{...checkpoints},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_context') return rpcResult(args?.p_category==='base' ? base : {});
      if(name==='npc_memory_evidence_retrieve_for_actor') return rpcResult(emptyEvidence());
      if(name==='npc_dialogue_checkpoint') {if(args?.p_stage==='remember') rememberWrites.push(args.p_value);if(args?.p_value===null) delete checkpoints[String(args.p_stage)];else checkpoints[String(args?.p_stage)]=args?.p_value;return rpcResult(null);}
      if(name==='npc_dialogue_complete') {completionCalls++;return rpcResult({status:'completed',reply});}
      throw new Error(`Unexpected RPC ${name}`);
    }} as any;
    const provider:DialogueProvider={async countContext(){return {model:'fixture',counterId:'fixture-counter',inputTokens:1,durationMs:1};},async generate(stage,payload){
      if(stage==='investigate') return {value:{kind:'informational',needsMore:false,remember:true,requests:[]},usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
      if(stage==='speak') return {value:{text:reply},usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
      if(stage==='review') return {value:{ok:true,issues:[]},usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
      if(stage==='remember') {
        rememberCalls++; rememberPayloads.push(payload);
        const quote=rememberCalls===1 ? invalidQuote : exactQuote;
        return {value:{memories:[{kind:'promise',text:exactQuote,quote,speaker:'npc',priorCommitmentId:null,commitmentStatus:'unresolved'}]},usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
      }
      throw new Error(`Unexpected provider stage ${stage}`);
    }};

    await expect(runDialogue(client,'33333333-3333-4333-8333-333333333333',{
      turnId:'66666666-6666-4666-8666-666666666666',npcId,message:'Please scout at dawn.',expectedConversationSequence:0,interactionVersion:'dialogue-v2'
    },provider,{rounds:1,promptRegistry,observability:()=>{}})).resolves.toMatchObject({status:'completed'});
    expect(rememberCalls).toBe(2);
    expect(rememberPayloads[1]).toMatchObject({quoteValidationFeedback:[{memoryIndex:0,source:'npc',code:'quote_not_in_source'}]});
    expect(completionCalls).toBe(1);
    expect(rememberWrites.some(value=>JSON.stringify(value).includes(invalidQuote))).toBe(false);
    expect(rememberWrites.at(-1)).toMatchObject({quoteRepairAttempted:true,value:{memories:[{quote:exactQuote}]} });

    checkpoints.remember={...checkpoints.remember,value:{...checkpoints.remember.value,memories:[{...checkpoints.remember.value.memories[0],quote:invalidQuote}]}};
    delete checkpoints.remember.quoteRepairAttempted;
    await expect(runDialogue(client,'33333333-3333-4333-8333-333333333333',{
      turnId:'66666666-6666-4666-8666-666666666666',npcId,message:'Please scout at dawn.',expectedConversationSequence:0,interactionVersion:'dialogue-v2'
    },provider,{rounds:1,promptRegistry,observability:()=>{}})).resolves.toMatchObject({status:'completed'});
    expect(rememberCalls).toBe(3);
    expect(rememberPayloads[2]).toMatchObject({quoteValidationFeedback:[{memoryIndex:0,source:'npc',code:'quote_not_in_source'}]});
    expect(completionCalls).toBe(2);
  });

  it('fails without completing when the single Remember quote repair retry is invalid',async()=>{
    const base={instanceId:npcId,name:'Lira',recent:[],questStatus:'active',allowedTargets:[]};
    const invalidQuote='I will scout at sunrise.';
    const checkpoints:Record<string,any>={};
    let rememberCalls=0; let completionCalls=0;
    const client={rpc(name:string,args?:Record<string,unknown>) {
      if(name==='npc_dialogue_begin') return rpcResult({status:'processing',fence:'fence-1',checkpoints:{...checkpoints},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_context') return rpcResult(args?.p_category==='base' ? base : {});
      if(name==='npc_memory_evidence_retrieve_for_actor') return rpcResult(emptyEvidence());
      if(name==='npc_dialogue_checkpoint') {if(args?.p_value===null) delete checkpoints[String(args.p_stage)]; else checkpoints[String(args?.p_stage)]=args?.p_value;return rpcResult(null);}
      if(name==='npc_dialogue_complete') {completionCalls++;return rpcResult({status:'completed'});}
      throw new Error(`Unexpected RPC ${name}`);
    }} as any;
    const provider:DialogueProvider={async countContext(){return {model:'fixture',counterId:'fixture-counter',inputTokens:1,durationMs:1};},async generate(stage){
      if(stage==='investigate') return {value:{kind:'informational',needsMore:false,remember:true,requests:[]},usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
      if(stage==='speak') return {value:{text:'I will scout at dawn.'},usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
      if(stage==='review') return {value:{ok:true,issues:[]},usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
      if(stage==='remember') {rememberCalls++;return {value:{memories:[{kind:'promise',text:'I will scout at dawn.',quote:invalidQuote,speaker:'npc',priorCommitmentId:null,commitmentStatus:'unresolved'}]},usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};}
      throw new Error(`Unexpected provider stage ${stage}`);
    }};

    await expect(runDialogue(client,'33333333-3333-4333-8333-333333333333',{
      turnId:'77777777-7777-4777-8777-777777777777',npcId,message:'Please scout at dawn.',expectedConversationSequence:0,interactionVersion:'dialogue-v2'
    },provider,{rounds:1,promptRegistry})).rejects.toMatchObject({code:'STRUCTURE'});
    expect(rememberCalls).toBe(2);
    expect(completionCalls).toBe(0);

    await expect(runDialogue(client,'33333333-3333-4333-8333-333333333333',{
      turnId:'77777777-7777-4777-8777-777777777777',npcId,message:'Please scout at dawn.',expectedConversationSequence:0,interactionVersion:'dialogue-v2'
    },provider,{rounds:1,promptRegistry})).rejects.toMatchObject({code:'STRUCTURE'});
    expect(rememberCalls).toBe(2);
    expect(completionCalls).toBe(0);

    checkpoints.remember={...checkpoints.remember,artifactHash:'a-previous-artifact'};
    await expect(runDialogue(client,'33333333-3333-4333-8333-333333333333',{
      turnId:'77777777-7777-4777-8777-777777777777',npcId,message:'Please scout at dawn.',expectedConversationSequence:0,interactionVersion:'dialogue-v2'
    },provider,{rounds:1,promptRegistry})).rejects.toMatchObject({code:'STRUCTURE'});
    expect(rememberCalls).toBe(2);
    expect(completionCalls).toBe(0);
  });

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
    const intention={goal:'Guard Millhaven',motivation:'Protect travelers',targets:['millhaven'],steps:[{action:'attempt',approach:'scouting'}]};
    const base={questLifecycleStatus:'active',allowedTargets:['millhaven'],intention};
    const proposal={stance:'agree',reaction:0,subject:'quest',evidence:'',intention:{...intention,steps:[] as any[]}};
    for(const actions of [['attempt','prepare','attempt'],['abandon','attempt'],['prepare'],['wait']]) {
      proposal.intention.steps=actions.map(action=>({action,approach:'scouting'}));
      expect(validateDecision(proposal,base,'Please consider this plan.').stance).toBe('clarify');
      expect(validateDecision(proposal,base,'Please consider this plan.').intention).toBeNull();
    }
    for(const actions of [['attempt'],['abandon'],['prepare','wait','attempt'],['prepare','abandon']]) {
      proposal.intention.steps=actions.map(action=>({action,approach:'scouting'}));
      expect(validateDecision(proposal,base,'Please consider this plan.').intention).toEqual(proposal.intention);
    }
    expect(validateDecision({...proposal,intention:{...proposal.intention,goal:'Replace the authored objective'}},base,'Please consider this plan.')).toMatchObject({stance:'clarify',intention:null});
    expect(validateDecision({...proposal,intention:{...proposal.intention,steps:[{action:'attempt',approach:'magic'}]}},base,'Please consider this plan.')).toMatchObject({stance:'clarify',intention:null});
  });
  it('local mode never falls back to a hosted provider',async()=>{
    await expect(createProvider({NPC_PROVIDER:'local',OPENAI_API_KEY:'test-only-placeholder'}).generate('speak',{},new AbortController().signal,fixturePromptRelease.prompts['dialogue.speak'])).rejects.toThrow('not implemented');
  });
  it('emits a sanitized provider-stage failure without retaining keeper prose or provider error text',async()=>{
    const base={name:'Lira',recent:[],questStatus:'active',allowedTargets:['millhaven'],personality:{values:['care']}};
    const provider: DialogueProvider={ async countContext(){return {model:'fixture',counterId:'fixture-counter',inputTokens:1,durationMs:1};}, async generate() { const error=Object.assign(new Error('provider exposed sk-secret-value'),{name:'ProviderUnavailable'}); throw error; } };
    const operationalEvents: unknown[]=[];
    await expect(runDialogue(cognitionClient(base),'33333333-3333-4333-8333-333333333333',{
      turnId,npcId,message:'A private keeper message.',expectedConversationSequence:0,interactionVersion:'dialogue-v2'
    },provider,{rounds:1,promptRegistry,observability:(event)=>{operationalEvents.push(event);}})).rejects.toMatchObject({code:'PROVIDER_FAILED'});
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
      async countContext(){return {model:'fixture',counterId:'fixture-counter',inputTokens:1,durationMs:1};},
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
        return {value,usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture',preflight:{inputTokens:7,durationMs:3}};
      }
    };
    const operationalEvents: unknown[]=[];
    const result=await runDialogue(cognitionClient(base),'33333333-3333-4333-8333-333333333333',{
      turnId,npcId,message:base.message,expectedConversationSequence:0,interactionVersion:'dialogue-v2'
    },provider,{rounds:1,promptRegistry,observability:(event)=>{operationalEvents.push(event);}});
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
      expect.objectContaining({correlationId:turnId,workflow:'dialogue',stage:'investigate0',status:'completed',attempt:1,model:'fixture',tokenUsage:{input:1,output:1},memoryContext:expect.objectContaining({modelTokenCount:7,assemblyDurationMs:3})}),
      expect.objectContaining({correlationId:turnId,workflow:'dialogue',stage:'speak',status:'completed'})
    ]));
    expect(JSON.stringify(operationalEvents)).not.toContain(base.message);
    expect(JSON.stringify(operationalEvents)).not.toContain('Do not reveal this.');
    expect(JSON.stringify(operationalEvents)).not.toContain('The keeper may be unreliable.');
  });
});
