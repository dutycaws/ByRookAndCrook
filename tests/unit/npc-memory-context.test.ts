import { describe, expect, it } from 'vitest';
import { runDialogue, type DialogueRuntimeOptions } from '../../src/lib/server/dialogue/orchestrator';
import type { DialogueProvider } from '../../src/lib/server/dialogue/provider';
import { fixturePromptRegistry } from '../helpers/prompt-registry-fixture';

const npcId='11111111-1111-4111-8111-111111111111';
const instanceId='33333333-3333-4333-8333-333333333333';
const turnId='22222222-2222-4222-8222-222222222222';
const memory={cutoffSequence:7,items:[{id:'memory-1',record_root_id:'memory-root-1',source_id:'turn-1',text:'I will fund a guide, not weapons.'}],sourceFallback:[{turnId:'turn-1',sequence:7,keeper:'Will you fund this?',npc:'A guide, not weapons.'}],watermarks:[]};

const rpcResult=(data:unknown)=>({abortSignal:async()=>({data,error:null})});

describe('NPC memory dialogue context',()=>{
  it('retrieves a speech-safe source-backed memory view at the turn cutoff and freezes it for all later stages',async()=>{
    const calls:Array<{name:string;args?:Record<string,unknown>}>=[];
    const payloads:Record<string,any>={};
    const events:unknown[]=[];
    const client={rpc(name:string,args?:Record<string,unknown>) {
      calls.push({name,args});
      if(name==='npc_dialogue_begin') return rpcResult({status:'processing',fence:'fence-1',checkpoints:{},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_context') return rpcResult({instanceId,name:'Lira',recent:[],questStatus:'active',allowedTargets:[]});
      if(name==='npc_memory_retrieve_for_actor') return rpcResult(memory);
      if(name==='npc_dialogue_checkpoint') return rpcResult(null);
      if(name==='npc_dialogue_complete') return rpcResult({status:'completed'});
      throw new Error(`Unexpected RPC ${name}`);
    }} as any;
    const provider:DialogueProvider={async generate(stage,payload) {
      payloads[stage]=payload;
      const value=stage==='investigate'
        ? {kind:'informational',needsMore:false,remember:false,requests:[]}
        : stage==='speak' ? {text:'I can fund a guide, but not weapons.'} : {ok:true,issues:[]};
      return {value,usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
    }};
    const options:DialogueRuntimeOptions={rounds:1,promptRegistry:fixturePromptRegistry(),observability:event=>{events.push(event);}};
    await expect(runDialogue(client,'44444444-4444-4444-8444-444444444444',{turnId,npcId,message:'What about your promise?',expectedConversationSequence:7,interactionVersion:'dialogue-v2'},provider,options)).resolves.toMatchObject({status:'completed'});

    expect(calls).toContainEqual({name:'npc_memory_retrieve_for_actor',args:{p_actor:'44444444-4444-4444-8444-444444444444',p_instance_id:instanceId,p_query:'What about your promise?',p_limit:12,p_cutoff_sequence:7,p_view:'speech'}});
    for (const payload of [payloads.investigate,payloads.speak,payloads.review]) {
      expect(payload.context).toEqual(expect.arrayContaining([expect.objectContaining({
        category:'memories',sourceIds:expect.arrayContaining(['memory-1','memory-root-1','turn-1']),data:memory
      })]));
    }
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({memoryContext:expect.objectContaining({selectedRecordCount:1,sourceRecordCount:3,coverageGapCount:0,reuse:'fresh'})})]));
    expect(JSON.stringify(events)).not.toContain('I will fund a guide');
  });
  it('reuses the checkpointed memory artifact instead of searching a newer index on retry',async()=>{
    const calls:string[]=[];
    const client={rpc(name:string) {
      calls.push(name);
      if(name==='npc_dialogue_begin') return rpcResult({status:'processing',fence:'fence-1',checkpoints:{memory:{value:{category:'memories',query:'older query',sourceIds:['memory-1','turn-1'],contentVersion:'npc-memory-v1',data:memory}}},content_version:'npc-v1',rule_version:'rules-v1'});
      if(name==='npc_dialogue_context') return rpcResult({instanceId,name:'Lira',recent:[],questStatus:'active',allowedTargets:[]});
      if(name==='npc_dialogue_checkpoint') return rpcResult(null);
      if(name==='npc_dialogue_complete') return rpcResult({status:'completed'});
      throw new Error(`Unexpected RPC ${name}`);
    }} as any;
    const payloads:any[]=[];
    const provider:DialogueProvider={async generate(stage,payload) {
      payloads.push(payload);
      const value=stage==='investigate' ? {kind:'informational',needsMore:false,remember:false,requests:[]}
        : stage==='speak' ? {text:'I remember.'} : {ok:true,issues:[]};
      return {value,usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};
    }};
    await runDialogue(client,'44444444-4444-4444-8444-444444444444',{turnId,npcId,message:'A changed query must not replace evidence.',expectedConversationSequence:99,interactionVersion:'dialogue-v2'},provider,{rounds:1,promptRegistry:fixturePromptRegistry()});
    expect(calls).not.toContain('npc_memory_retrieve_for_actor');
    expect(payloads[0].context[0]).toMatchObject({query:'older query',data:memory});
  });
});
