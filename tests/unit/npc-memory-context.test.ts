import { describe, expect, it } from 'vitest';
import { runDialogue, type DialogueRuntimeOptions } from '../../src/lib/server/dialogue/orchestrator';
import type { DialogueProvider } from '../../src/lib/server/dialogue/provider';
import { fixturePromptRegistry } from '../helpers/prompt-registry-fixture';
import { assembleNpcMemoryContext, canonicalNpcMemoryContextPayload, dialogueContextTier, utf8Bytes } from '$lib/server/npc-memory/context';

const npcId='11111111-1111-4111-8111-111111111111';
const instanceId='33333333-3333-4333-8333-333333333333';
const turnId='22222222-2222-4222-8222-222222222222';
const memoryId='55555555-5555-4555-8555-555555555555';
const rootId='66666666-6666-4666-8666-666666666666';
const sourceId='77777777-7777-4777-8777-777777777777';
const evidence=(overrides:Record<string,unknown>={})=>({retrievalVersion:'npc-memory-evidence-v4',cutoffLedgerSequence:7,semantic:{available:false,availability:'disabled',profile:null},items:[{id:memoryId,recordRootId:rootId,recordVersion:1,kind:'commitment',text:'I will fund a guide, not weapons.',quote:'I will fund a guide, not weapons.',speaker:'npc',truthClass:'canonical',disclosureClass:'npc_known',status:'unresolved',relatedQuestId:null,correctionMemoryId:null,entityRefs:[],importance:3,occurredDay:1,occurredSequence:1,learnedDay:1,learnedSequence:1,sourceKind:'dialogue_turn',sourceId,sourceVersion:1,sourceHash:'a'.repeat(64),ledgerSequence:7,channelRanks:{relational:1},fusedScore:1,selectionReasons:['unresolved_commitment']}],bundles:[],sourceFallback:[],sourceManifest:[{sourceKind:'dialogue_turn',sourceId,sourceVersion:1,sourceHash:'a'.repeat(64),ledgerSequence:7}],coverage:{complete:true,sourceFallback:{total:0,included:0,truncated:false,complete:true},watermarks:[]},...overrides});
const memory=evidence();

const rpcResult=(data:unknown)=>({abortSignal:async()=>({data,error:null})});

describe('NPC memory dialogue context',()=>{
  it('retrieves a speech-safe source-backed memory view at the turn cutoff and freezes it for all later stages',async()=>{
    const calls:Array<{name:string;args?:Record<string,unknown>}>=[];
    const order:string[]=[]; let contextCounts=0;
    const payloads:Record<string,any>={};
    const events:unknown[]=[];
    const client={rpc(name:string,args?:Record<string,unknown>) {
      calls.push({name,args}); order.push(`rpc:${name}:${String(args?.p_stage??'')}`);
      if(name==='npc_dialogue_begin') return rpcResult({status:'processing',fence:'fence-1',checkpoints:{},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_context') return rpcResult({instanceId,name:'Lira',recent:[],questStatus:'active',allowedTargets:[],evolvingProfile:'private cognition must never reach speech'});
      if(name==='npc_memory_evidence_retrieve_for_actor') return rpcResult(memory);
      if(name==='npc_dialogue_checkpoint') return rpcResult(null);
      if(name==='npc_dialogue_complete') return rpcResult({status:'completed'});
      throw new Error(`Unexpected RPC ${name}`);
    }} as any;
    const provider:DialogueProvider={async countContext(){contextCounts++;order.push('count');return {model:'fixture',counterId:'fixture-counter',inputTokens:1,durationMs:1};},async generate(stage,payload) {
      order.push(`generate:${stage}`);
      payloads[stage]=payload;
      const value=stage==='investigate'
        ? {kind:'social',needsMore:false,remember:false,requests:[]}
        : stage==='deliberate' ? {stance:'respond',reaction:0,subject:'quest',evidence:'',intention:null}
        : stage==='speak' ? {text:'I can fund a guide, but not weapons.'} : {ok:true,issues:[]};
      return {value,usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
    }};
    const options:DialogueRuntimeOptions={rounds:1,promptRegistry:fixturePromptRegistry(),observability:event=>{events.push(event);}};
    await expect(runDialogue(client,'44444444-4444-4444-8444-444444444444',{turnId,npcId,message:'What about your promise?',expectedConversationSequence:7,interactionVersion:'dialogue-v2'},provider,options)).resolves.toMatchObject({status:'completed'});

    expect(calls).toContainEqual({name:'npc_memory_evidence_retrieve_for_actor',args:expect.objectContaining({p_actor:'44444444-4444-4444-8444-444444444444',p_instance_id:instanceId,p_query:'What about your promise?',p_limit:12,p_cutoff_ledger_sequence:7,p_view:'speech'})});
    expect(contextCounts).toBe(2);
    expect(order.indexOf('rpc:npc_dialogue_checkpoint:frozen_context:0')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('rpc:npc_dialogue_checkpoint:frozen_context:0')).toBeLessThan(order.indexOf('generate:investigate'));
    for (const payload of [payloads.investigate,payloads.deliberate,payloads.speak,payloads.review]) {
      expect(payload.context).toEqual(expect.arrayContaining([expect.objectContaining({
        category:'memories',sourceIds:expect.arrayContaining([memoryId,rootId,sourceId]),data:expect.objectContaining({cutoffLedgerSequence:7,items:expect.any(Array),coverage:expect.objectContaining({complete:true})})
      })]));
    }
    // Investigation/deliberation receive the private frozen projection; the
    // speech/review projection retains the same authorized evidence but removes
    // private cognition before it can influence a player-visible answer.
    expect(JSON.stringify(payloads.investigate)).toContain('private cognition must never reach speech');
    expect(JSON.stringify(payloads.deliberate)).toContain('private cognition must never reach speech');
    expect(JSON.stringify(payloads.speak)).not.toContain('private cognition must never reach speech');
    expect(JSON.stringify(payloads.review)).not.toContain('private cognition must never reach speech');
    expect(JSON.stringify(payloads.speak)).not.toContain('privateCognition');
    expect(JSON.stringify(payloads.review)).not.toContain('privateCognition');
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({memoryContext:expect.objectContaining({selectedRecordCount:1,sourceRecordCount:3,coverageGapCount:0,reuse:'fresh'})})]));
    expect(JSON.stringify(events)).not.toContain('I will fund a guide');
  });
  it('fails closed for a legacy raw-memory checkpoint with malformed frozen-envelope metadata',async()=>{
    const calls:string[]=[];
    const base={instanceId,name:'Lira',recent:[],questStatus:'active',allowedTargets:[]};
    const projection={base,context:[{category:'memories',query:'older query',sourceIds:['memory-1','turn-1'],contentVersion:'npc-memory-v1',data:memory}],coverage:{version:'npc-context-v1' as const,omittedExchanges:0,omittedResults:0}};
    const valid=assembleNpcMemoryContext({policyVersion:'npc-context-routine-v1',projectionVersion:'npc-dialogue-projections-v1',maxBytes:64*1024,maxTokens:16_000,sources:[],requiredSourceIds:[],payload:{projections:{private:projection,public:projection},targetTokens:8000,baseProvenance:{contentVersion:'npc-v1',profileRevision:null}},tokenCount:1,tokenizerId:'fixture-counter',counterId:'fixture-counter',counterDurationMs:1,model:'fixture',cutoffSequence:99,view:'speech',revision:0});
    const malformed={...valid,policyVersion:'npc-context-unknown-v9'};
    const client={rpc(name:string) {
      calls.push(name);
      if(name==='npc_dialogue_begin') return rpcResult({status:'processing',fence:'fence-1',checkpoints:{memory:{value:{category:'memories',query:'older query',sourceIds:['memory-1','turn-1'],contentVersion:'npc-memory-v1',data:memory}},'frozen_context:0':{value:malformed}},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_context') return rpcResult(base);
      if(name==='npc_dialogue_checkpoint') return rpcResult(null);
      if(name==='npc_dialogue_complete') return rpcResult({status:'completed'});
      throw new Error(`Unexpected RPC ${name}`);
    }} as any;
    const payloads:any[]=[];
    let countCalls=0;
    const provider:DialogueProvider={async countContext(){countCalls++;return {model:'fixture',counterId:'fixture-counter',inputTokens:1,durationMs:1};},async generate(stage,payload) {
      payloads.push(payload);
      const value=stage==='investigate' ? {kind:'informational',needsMore:false,remember:false,requests:[]}
        : stage==='speak' ? {text:'I remember.'} : {ok:true,issues:[]};
      return {value,usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
    }};
    await expect(runDialogue(client,'44444444-4444-4444-8444-444444444444',{turnId,npcId,message:'A changed query must not replace evidence.',expectedConversationSequence:99,interactionVersion:'dialogue-v2'},provider,{rounds:1,promptRegistry:fixturePromptRegistry()})).rejects.toMatchObject({code:'CONTEXT_BUDGET'});
    expect(calls).not.toContain('npc_memory_evidence_retrieve_for_actor');
    expect(calls).not.toContain('npc_dialogue_context');
    expect(countCalls).toBe(0);
    expect(payloads).toEqual([]);
  });
  it('replays the exact revision-zero artifact without retrieval or another artifact count',async()=>{
    const base={instanceId,name:'Lira',recent:[],questStatus:'active',allowedTargets:[]};
    const projection={base,context:[{category:'memories',query:'older query',sourceIds:['memory-1','turn-1'],contentVersion:'npc-memory-v1',data:memory}],coverage:{version:'npc-context-v1' as const,omittedExchanges:0,omittedResults:0}};
    const artifact=assembleNpcMemoryContext({policyVersion:'npc-context-routine-v1',projectionVersion:'npc-dialogue-projections-v1',maxBytes:64*1024,maxTokens:8_000,tier:'routine',sources:[],requiredSourceIds:[],payload:{projections:{private:projection,public:projection},targetTokens:8000,baseProvenance:{contentVersion:'npc-v1',profileRevision:null}},tokenCount:1,tokenizerId:'fixture-counter',counterId:'fixture-counter',counterDurationMs:1,model:'fixture',cutoffSequence:99,view:'speech',revision:0});
    const calls:string[]=[]; const stages:string[]=[];
    const client={rpc(name:string,args?:Record<string,unknown>) {
      calls.push(name);
      if(name==='npc_dialogue_begin') return rpcResult({status:'processing',fence:'fence-1',checkpoints:{'frozen_context:0':{value:artifact}},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_context') return rpcResult(base);
      if(name==='npc_dialogue_checkpoint') {stages.push(String(args?.p_stage)); return rpcResult(null);}
      if(name==='npc_dialogue_complete') return rpcResult({status:'completed'});
      throw new Error(`Unexpected RPC ${name}`);
    }} as any;
    let countCalls=0;
    const provider:DialogueProvider={async countContext(){countCalls++;throw new Error('must not recount');},async generate(stage) {
      // Simulate a crash after the frozen artifact but before investigation was
      // checkpointed: retries must not re-open the v4 evidence boundary.
      const value=stage==='investigate'?{kind:'informational',needsMore:false,remember:false,requests:[{category:'memories',query:'fresh forbidden retrieval'}]}:stage==='speak'?{text:'I remember.'}:{ok:true,issues:[]};
      return {value,usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
    }};
    await expect(runDialogue(client,'44444444-4444-4444-8444-444444444444',{turnId,npcId,message:'A changed query must not replace evidence.',expectedConversationSequence:99,interactionVersion:'dialogue-v2'},provider,{rounds:1,promptRegistry:fixturePromptRegistry()})).resolves.toMatchObject({status:'completed'});
    expect(calls).not.toContain('npc_memory_evidence_retrieve_for_actor');
    expect(calls).not.toContain('npc_memory_active_embedding_profile');
    expect(calls).not.toContain('npc_dialogue_context');
    expect(countCalls).toBe(0);
    expect(artifact.revision).toBe(0);
    expect(stages).toContain('frozen_context');
  });
  it('recovers a pre-freeze evidence checkpoint by creating revision one exactly once',async()=>{
    const base={instanceId,name:'Lira',recent:[],questStatus:'active',allowedTargets:[]};
    const projection={base,context:[{category:'memories',query:'older query',sourceIds:['memory-1','turn-1'],contentVersion:'npc-memory-v1',data:memory}],coverage:{version:'npc-context-v1' as const,omittedExchanges:0,omittedResults:0}};
    const artifact=assembleNpcMemoryContext({policyVersion:'npc-context-routine-v1',projectionVersion:'npc-dialogue-projections-v1',maxBytes:64*1024,maxTokens:8_000,tier:'routine',sources:[],requiredSourceIds:[],payload:{projections:{private:projection,public:projection},targetTokens:8000,baseProvenance:{contentVersion:'npc-v1',profileRevision:null}},tokenCount:1,tokenizerId:'fixture-counter',counterId:'fixture-counter',counterDurationMs:1,model:'fixture',cutoffSequence:99,view:'speech',revision:0});
    const stages:string[]=[]; const calls:string[]=[];
    const client={rpc(name:string,args?:Record<string,unknown>) {
      calls.push(name); if(name==='npc_dialogue_checkpoint') stages.push(String(args?.p_stage));
      if(name==='npc_dialogue_begin') return rpcResult({status:'processing',fence:'fence-1',checkpoints:{frozen_context:{value:{revision:0,hash:artifact.hash}},'frozen_context:0':{value:artifact},investigate0:{value:{kind:'social',needsMore:false,remember:false,requests:[]}},context0:{value:[{category:'relationships',query:'Mara',sourceIds:['relationship-1'],contentVersion:'npc-v1',data:{facts:[]}}]}},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_context') return rpcResult(base);
      if(name==='npc_dialogue_complete') return rpcResult({status:'completed'});
      if(name==='npc_dialogue_checkpoint') return rpcResult(null);
      throw new Error(`Unexpected RPC ${name}`);
    }} as any;
    let countCalls=0;
    const provider:DialogueProvider={async countContext(){countCalls++;return {model:'fixture',counterId:'fixture-counter',inputTokens:2,durationMs:1};},async generate(stage) {
      const value=stage==='deliberate'?{stance:'respond',reaction:0,subject:'quest',evidence:'',intention:null}:stage==='speak'?{text:'I remember.'}:{ok:true,issues:[]};
      return {value,usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
    }};
    await runDialogue(client,'44444444-4444-4444-8444-444444444444',{turnId,npcId,message:'A changed query must not replace evidence.',expectedConversationSequence:99,interactionVersion:'dialogue-v2'},provider,{rounds:1,promptRegistry:fixturePromptRegistry()});
    expect(calls).not.toContain('npc_memory_evidence_retrieve_for_actor');
    expect(countCalls).toBe(1);
    expect(stages.filter(stage=>stage==='frozen_context:1')).toHaveLength(1);
    expect(stages).not.toContain('frozen_context:0');
  });
  it('counts and checkpoints a new immutable revision when investigation adds memory evidence',async()=>{
    const base={instanceId,name:'Lira',recent:[],questStatus:'active',allowedTargets:[]};
    const initial=memory;
    const added=evidence({items:[{...(memory.items[0] as any),id:'88888888-8888-4888-8888-888888888888',recordRootId:'99999999-9999-4999-8999-999999999999',sourceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',text:'A later source.',quote:'A later source.',sourceHash:'b'.repeat(64)}],sourceManifest:[{sourceKind:'dialogue_turn',sourceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sourceVersion:1,sourceHash:'b'.repeat(64),ledgerSequence:7}]});
    const stages:Array<{stage:string;value:any}>=[]; let retrievals=0; let counts=0; const speechPayloads:any[]=[];
    const client={rpc(name:string,args?:Record<string,unknown>) {
      if(name==='npc_dialogue_begin') return rpcResult({status:'processing',fence:'fence-1',checkpoints:{},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_context') return rpcResult(base);
      if(name==='npc_memory_evidence_retrieve_for_actor') return rpcResult(++retrievals===1?initial:added);
      if(name==='npc_dialogue_checkpoint') { stages.push({stage:String(args?.p_stage),value:args?.p_value}); return rpcResult(null); }
      if(name==='npc_dialogue_complete') return rpcResult({status:'completed'});
      throw new Error(`Unexpected RPC ${name}`);
    }} as any;
    const provider:DialogueProvider={async countContext(){counts++;return {model:'fixture',counterId:'fixture-counter',inputTokens:1,durationMs:1};},async generate(stage,payload) {
      if(stage==='speak') speechPayloads.push(payload);
      const value=stage==='investigate'?{kind:'social',needsMore:false,remember:false,requests:[{category:'memories',query:'later'}]}:stage==='deliberate'?{stance:'respond',reaction:0,subject:'quest',evidence:'',intention:null}:stage==='speak'?{text:'I remember.'}:{ok:true,issues:[]};
      return {value,usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
    }};
    await runDialogue(client,'44444444-4444-4444-8444-444444444444',{turnId,npcId,message:'What changed?',expectedConversationSequence:7,interactionVersion:'dialogue-v2'},provider,{rounds:1,promptRegistry:fixturePromptRegistry()});
    expect(counts).toBe(2);
    expect(stages.map(entry=>entry.stage)).toEqual(expect.arrayContaining(['frozen_context:0','frozen_context:1','frozen_context']));
    expect(stages.find(entry=>entry.stage==='frozen_context:0')?.value.value.revision).toBe(0);
    expect(stages.find(entry=>entry.stage==='frozen_context:1')?.value.value.revision).toBe(1);
    expect(stages.filter(entry=>entry.stage==='frozen_context').at(-1)?.value.value).toMatchObject({revision:1});
    expect(JSON.stringify(speechPayloads[0])).toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });
  it('does not generate when persisting revision zero fails',async()=>{
    const base={instanceId,name:'Lira',recent:[],questStatus:'active',allowedTargets:[]}; let generations=0;
    const client={rpc(name:string,args?:Record<string,unknown>) {
      if(name==='npc_dialogue_begin') return rpcResult({status:'processing',fence:'fence-1',checkpoints:{},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_context') return rpcResult(base);
      if(name==='npc_memory_evidence_retrieve_for_actor') return rpcResult(memory);
      if(name==='npc_dialogue_checkpoint' && args?.p_stage==='frozen_context:0') return {abortSignal:async()=>({data:null,error:{message:'checkpoint unavailable',code:'PT503'}})};
      if(name==='npc_dialogue_checkpoint') return rpcResult(null);
      throw new Error(`Unexpected RPC ${name}`);
    }} as any;
    const provider:DialogueProvider={async countContext(){return {model:'fixture',counterId:'fixture-counter',inputTokens:1,durationMs:1};},async generate(){generations++;throw new Error('must not generate');}};
    await expect(runDialogue(client,'44444444-4444-4444-8444-444444444444',{turnId,npcId,message:'What changed?',expectedConversationSequence:7,interactionVersion:'dialogue-v2'},provider,{rounds:1,promptRegistry:fixturePromptRegistry()})).rejects.toMatchObject({code:'PT503'});
    expect(generations).toBe(0);
  });
  it.each([
    ['rejects incomplete evidence coverage before generation',evidence({coverage:{complete:false,sourceFallback:{total:1,included:0,truncated:true,complete:false},watermarks:[]}}),1,0],
    ['rejects a verified count above the 16k hard limit before generation',memory,16_001,1]
  ])('%s',async(_name,retrieval:any,tokens:number,expectedCounts:number)=>{
    const base={instanceId,name:'Lira',recent:[],questStatus:'active',allowedTargets:[]}; let counts=0; let generations=0;
    const client={rpc(name:string,args?:Record<string,unknown>) {
      if(name==='npc_dialogue_begin') return rpcResult({status:'processing',fence:'fence-1',checkpoints:{},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_context') return rpcResult(base);
      if(name==='npc_memory_evidence_retrieve_for_actor') return rpcResult(retrieval);
      if(name==='npc_dialogue_checkpoint') return rpcResult(null);
      throw new Error(`Unexpected RPC ${name}`);
    }} as any;
    const provider:DialogueProvider={async countContext(){counts++;return {model:'fixture',counterId:'fixture-counter',inputTokens:tokens,durationMs:1};},async generate(){generations++;throw new Error('must not generate');}};
    await expect(runDialogue(client,'44444444-4444-4444-8444-444444444444',{turnId,npcId,message:'What changed?',expectedConversationSequence:7,interactionVersion:'dialogue-v2'},provider,{rounds:1,promptRegistry:fixturePromptRegistry()})).rejects.toMatchObject({code:'CONTEXT_BUDGET'});
    expect(counts).toBe(expectedCounts); expect(generations).toBe(0);
  });

  it('canonicalizes a multilingual frozen artifact exactly and admits only byte/token boundary values',()=>{
    const text='東京 العربية देवनागरी 𠜎 e\u0301 👩🏽‍🚀';
    const source={id:'unicode-source',version:1,hash:'c'.repeat(64),kind:'dialogue_turn',ledgerSequence:3};
    const payload={projections:{private:{text},public:{text}},baseProvenance:{contentVersion:'v1',profileRevision:null}};
    const canonical=canonicalNpcMemoryContextPayload({sources:[source],requiredSourceIds:[source.id],payload});
    expect(JSON.parse(canonical).payload.projections.private.text).toBe(text);
    expect(canonical).toContain(text);
    expect(utf8Bytes(canonical)).toBeGreaterThan(text.length);
    const bytes=utf8Bytes(canonical);
    const input={policyVersion:'test',projectionVersion:'test',sources:[source],requiredSourceIds:[source.id],payload,
      tokenizerId:'fixture',counterId:'fixture',model:'fixture',tokenCount:16_000};
    expect(()=>assembleNpcMemoryContext({...input,maxBytes:bytes-1,maxTokens:16_000})).toThrow();
    expect(()=>assembleNpcMemoryContext({...input,maxBytes:bytes,maxTokens:16_000})).not.toThrow();
    expect(()=>assembleNpcMemoryContext({...input,maxBytes:bytes+1,maxTokens:16_000})).not.toThrow();
    for (const [tokens,accepted] of [[15_999,true],[16_000,true],[16_001,false]] as const) {
      const assemble=()=>assembleNpcMemoryContext({...input,maxBytes:bytes,maxTokens:16_000,tokenCount:tokens});
      if (accepted) expect(assemble).not.toThrow(); else expect(assemble).toThrow();
    }
  });
  it('admits dialogue context only within its persisted routine or consequential tier',()=>{
    const source={id:'tier-source',version:1,hash:'d'.repeat(64),kind:'dialogue_turn',ledgerSequence:1};
    const base={policyVersion:'tier-v1',projectionVersion:'tier-v1',maxBytes:64*1024,sources:[source],requiredSourceIds:[source.id],payload:{text:'tier'},tokenizerId:'fixture',counterId:'fixture',model:'fixture'};
    const routine=dialogueContextTier(false); const consequential=dialogueContextTier(true);
    expect(()=>assembleNpcMemoryContext({...base,maxTokens:routine.maxTokens,tier:routine.tier,tokenCount:8_001})).toThrow();
    expect(()=>assembleNpcMemoryContext({...base,maxTokens:consequential.maxTokens,tier:consequential.tier,tokenCount:16_000})).not.toThrow();
  });
});
