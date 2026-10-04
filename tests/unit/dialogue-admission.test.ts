import { afterEach, describe, expect, it } from 'vitest';
import { runDialogue } from '../../src/lib/server/dialogue/orchestrator';
import type { DialogueProvider } from '../../src/lib/server/dialogue/provider';
import { fixturePromptRegistry } from '../helpers/prompt-registry-fixture';
import { clearProjectionCache, putProjectionArtifact } from '$lib/server/npc-memory/projection-cache';
import { canonicalNpcMemoryContextPayload, sha256Hex, utf8Bytes } from '$lib/server/npc-memory/context';

const npcId='11111111-1111-4111-8111-111111111111', instanceId='33333333-3333-4333-8333-333333333333';
const actor='44444444-4444-4444-8444-444444444444', turnId='22222222-2222-4222-8222-222222222222';
const result=(data:unknown)=>({abortSignal:async()=>({data,error:null})});
function harness(counts:number[], options:{checkpoints?:Record<string,any>;identity?:string;baseExtra?:Record<string,unknown>;unverified?:boolean}={}) {
  const base={instanceId,name:'Lira',recent:Array.from({length:5},(_,i)=>({id:`exchange-${i}`,keeper:`Keeper qualification ${i}`,npc:`NPC complete reply ${i}`})),questStatus:'active',allowedTargets:[],...options.baseExtra};
  const sourceId='77777777-7777-4777-8777-777777777777';
  const item={id:'55555555-5555-4555-8555-555555555555',recordRootId:'66666666-6666-4666-8666-666666666666',recordVersion:1,kind:'commitment',text:'Protect travelers if the bandits refuse.',quote:'Protect travelers if the bandits refuse.',speaker:'npc',truthClass:'attributed',disclosureClass:'npc_known',status:'unresolved',relatedQuestId:null,correctionMemoryId:null,entityRefs:[],importance:3,occurredDay:1,occurredSequence:1,learnedDay:1,learnedSequence:1,sourceKind:'dialogue_turn',sourceId,sourceVersion:1,sourceHash:'a'.repeat(64),ledgerSequence:5,channelRanks:{relational:1},fusedScore:1,selectionReasons:['unresolved_commitment']};
  const evidence={retrievalVersion:'npc-memory-evidence-v4',cutoffLedgerSequence:5,semantic:{available:false,availability:'disabled',profile:null},items:[item],bundles:[],sourceFallback:[],sourceManifest:[{sourceKind:'dialogue_turn',sourceId,sourceVersion:1,sourceHash:'a'.repeat(64),ledgerSequence:5}],coverage:{complete:true,sourceFallback:{total:0,included:0,truncated:false,complete:true},watermarks:[]}};
  const checkpoints=options.checkpoints??{};const calls:string[]=[], stages:string[]=[], counted:string[]=[], artifacts:any[]=[];
  const client={rpc(name:string,args?:Record<string,unknown>){calls.push(name);
    if(name==='npc_dialogue_begin')return result({status:'processing',fence:'fixture',checkpoints,content_version:'npc-v1',rule_version:'rules-v1'});
    if(name==='npc_dialogue_context')return result(base);
    if(name==='npc_memory_evidence_retrieve_for_actor')return result(evidence);
    if(name==='npc_dialogue_checkpoint'){const key=String(args?.p_stage);checkpoints[key]=args?.p_value;if(key.startsWith('frozen_context:'))artifacts.push((args?.p_value as any).value);return result(null);}
    if(name==='npc_dialogue_complete')return result({status:'completed'});
    throw new Error(`Unexpected RPC ${name}`);
  }} as any;
  const provider:DialogueProvider={contextIdentity:options.identity,async countContext(text){counted.push(text);return {model:'fixture',counterId:options.unverified?'':'fixture-counter',inputTokens:counts[Math.min(counted.length-1,counts.length-1)],durationMs:1};},async generate(stage){stages.push(stage);const value=stage==='investigate'?{kind:'informational',needsMore:false,remember:false,requests:[]}:stage==='speak'?{text:'A measured reply.'}:{ok:true,issues:[]};return {value,usage:{input:1,output:1},model:'fixture',durationMs:1,promptVersion:'fixture'};}};
  return {base,evidence,checkpoints,calls,stages,counted,artifacts,run:()=>runDialogue(client,actor,{turnId,npcId,message:'How will you approach the parley?',expectedConversationSequence:5,interactionVersion:'dialogue-v2'},provider,{rounds:1,promptRegistry:fixturePromptRegistry()})};
}
afterEach(clearProjectionCache);
describe('dialogue complete-evidence admission',()=>{
  it('keeps an informational context within 8k routine without deliberation',async()=>{
    const h=harness([8000]);await h.run();expect(h.counted).toHaveLength(1);expect(h.artifacts[0]).toMatchObject({tier:'routine',payload:{admission:{tier:'routine',reason:'routine'},targetTokens:8000}});expect(h.stages).not.toContain('deliberate');
  });
  it('admits the captured 8867-token overflow losslessly after recounting the final canonical payload',async()=>{
    const h=harness([8867,8900]);await expect(h.run()).resolves.toMatchObject({status:'completed'});
    expect(h.counted).toHaveLength(2);const a=h.artifacts[0];expect(a).toMatchObject({tier:'consequential',tokens:8900,payload:{targetTokens:16000,admission:{tier:'consequential',reason:'complete_evidence_overflow',routineTokens:8867}}});
    expect(a.payload.projections.private.base).toEqual(h.base);expect(a.payload.projections.private.context[0].data.items).toEqual(h.evidence.items);expect(a.payload.projections.private.coverage).toMatchObject({omittedExchanges:0,omittedResults:0});
    expect(a.canonicalJson).toBe(h.counted[1]);expect(a.hash).toBe(sha256Hex(h.counted[1]));expect(a.utf8Bytes).toBe(utf8Bytes(h.counted[1]));expect(h.stages).toEqual(['investigate','speak','review']);expect(h.checkpoints.decision.sourceStage).toBeNull();
  });
  it.each([[16001],[8867,16001]])('rejects evidence beyond 16k including a final recount overflow (%j)',async(...counts)=>{
    const h=harness(counts as number[]);await expect(h.run()).rejects.toMatchObject({code:'CONTEXT_BUDGET'});expect(h.artifacts).toEqual([]);expect(h.stages).toEqual([]);
  });
  it('rejects a protected base beyond 64KiB and unverified token counts',async()=>{
    const oversized=harness([1],{baseExtra:{identity:'x'.repeat(65536)}});await expect(oversized.run()).rejects.toMatchObject({code:'CONTEXT_BUDGET'});expect(oversized.stages).toEqual([]);
    const unknown=harness([8867],{unverified:true});await expect(unknown.run()).rejects.toMatchObject({code:'CONTEXT_BUDGET'});expect(unknown.artifacts).toEqual([]);expect(unknown.stages).toEqual([]);
  });
  it('rejects routine overflow when preparation has omitted whole exchanges',async()=>{
    const recent=Array.from({length:5},(_,i)=>({id:`large-exchange-${i}`,keeper:`Complete keeper qualification ${i}`,npc:'x'.repeat(17000)}));
    const h=harness([8867,8900],{baseExtra:{recent}});
    await expect(h.run()).rejects.toMatchObject({code:'CONTEXT_BUDGET'});
    const prepared=JSON.parse(h.counted[0]).payload.projections.private;
    expect(prepared.coverage.omittedExchanges).toBeGreaterThan(0);expect(h.counted).toHaveLength(1);expect(h.artifacts).toEqual([]);expect(h.stages).toEqual([]);
  });
  it('rejects a rehashed overflow replay that claims omitted evidence',async()=>{
    const original=harness([8867,8900]);await original.run();const bad=structuredClone(original.artifacts[0]);
    bad.payload.projections.private.coverage.omittedResults=1;
    bad.canonicalJson=canonicalNpcMemoryContextPayload({sources:bad.sourceManifest,requiredSourceIds:bad.coverage.required,payload:bad.payload});bad.hash=sha256Hex(bad.canonicalJson);bad.utf8Bytes=utf8Bytes(bad.canonicalJson);
    const replay=harness([1],{checkpoints:{memory:{value:{}},'frozen_context:0':{value:bad}}});
    await expect(replay.run()).rejects.toMatchObject({code:'CONTEXT_BUDGET'});expect(replay.counted).toEqual([]);expect(replay.stages).toEqual([]);
  });
  it('replays promoted evidence without recounting or adding deliberation and rejects tampered admission',async()=>{
    const original=harness([8867,8900]);await original.run();const a=original.artifacts[0];const checkpoints={'frozen_context:0':{value:a}};
    const replay=harness([NaN],{checkpoints});await replay.run();expect(replay.counted).toEqual([]);expect(replay.calls).not.toContain('npc_memory_evidence_retrieve_for_actor');expect(replay.stages).not.toContain('deliberate');
    const bad=structuredClone(a);bad.payload.admission.routineTokens=8000;bad.canonicalJson=canonicalNpcMemoryContextPayload({sources:bad.sourceManifest,requiredSourceIds:bad.coverage.required,payload:bad.payload});bad.hash=sha256Hex(bad.canonicalJson);bad.utf8Bytes=utf8Bytes(bad.canonicalJson);
    const tampered=harness([1],{checkpoints:{memory:{value:{}},'frozen_context:0':{value:bad}}});await expect(tampered.run()).rejects.toMatchObject({code:'CONTEXT_BUDGET'});expect(tampered.counted).toEqual([]);expect(tampered.stages).toEqual([]);
  });
  it('fails closed for a promoted replay whose private projection is missing',async()=>{
    const original=harness([8867,8900]);await original.run();const bad=structuredClone(original.artifacts[0]);
    delete bad.payload.projections.private;
    bad.canonicalJson=canonicalNpcMemoryContextPayload({sources:bad.sourceManifest,requiredSourceIds:bad.coverage.required,payload:bad.payload});bad.hash=sha256Hex(bad.canonicalJson);bad.utf8Bytes=utf8Bytes(bad.canonicalJson);
    const replay=harness([1],{checkpoints:{memory:{value:{}},'frozen_context:0':{value:bad}}});
    await expect(replay.run()).rejects.toMatchObject({code:'CONTEXT_BUDGET'});expect(replay.counted).toEqual([]);expect(replay.stages).toEqual([]);
  });
  it('segregates routine and overflow cache entries and reuses the final promoted count',async()=>{
    const first=harness([8867,8900],{identity:'same-model'});await first.run();
    const seed=()=>{const a=first.artifacts[0];putProjectionArtifact({actorId:actor,instanceId,view:'speech',cutoffSequence:5,policyVersion:a.policyVersion,projectionVersion:a.projectionVersion,tier:a.tier,identity:'same-model',sources:a.sourceManifest,payload:a.payload},a);};
    seed();
    const same=harness([8867,9999],{identity:'same-model'});await same.run();expect(same.counted).toHaveLength(1);expect(same.artifacts[0].tokens).toBe(8900);
    seed();
    const routine=harness([100],{identity:'same-model'});await routine.run();expect(routine.artifacts[0].tier).toBe('routine');expect(routine.artifacts[0].tokens).toBe(100);
  });
});
