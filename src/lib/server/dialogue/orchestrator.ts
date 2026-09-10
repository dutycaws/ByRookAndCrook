import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/database.types';
import { hasExecutableSteps, type Decision, type DialogueInput } from '$lib/game/dialogue';
import type { DialogueProvider } from './provider';
import { ContextBudgetError, describePayload, evidenceKey, prepareContext, requirePayloadBudget, stagePayload } from './context';
import { matchesSchema, schemas, type Stage } from './schemas';

export class DialogueError extends Error { constructor(message:string,public status=500,public code='DIALOGUE_FAILED'){super(message);} }
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseInput(value:unknown): DialogueInput {
  const v=value as DialogueInput;
  if(!v || typeof v!=='object' || !uuid.test(v.turnId??'') || !['lira','torvin'].includes(v.patronKey) || typeof v.message!=='string'
    || !v.message.trim() || v.message.length>2000 || !Number.isSafeInteger(v.expectedConversationSequence) || v.expectedConversationSequence<0
    || v.interactionVersion!=='dialogue-v2' || v.intentCardId!=null&&!uuid.test(v.intentCardId)
    || v.offering!=null&&(!['food','beverage'].includes(v.offering.kind)||!uuid.test(v.offering.itemId)))
    throw new DialogueError('Enter a message and choose an available intent card or offering.',400,'INVALID_INPUT');
  return {turnId:v.turnId,patronKey:v.patronKey,message:v.message,expectedConversationSequence:v.expectedConversationSequence,
    interactionVersion:'dialogue-v2',intentCardId:v.intentCardId??null,offering:v.offering??null};
}
export function databaseError(e:{message:string;code:string}): DialogueError {
  const status=Number(e.code.match(/^PT(\d{3})$/)?.[1]??500);
  return new DialogueError(status<500?e.message:'The conversation ledger is unavailable.',status,e.code);
}
export function validateDecision(raw:unknown,base:any,message:string): Decision {
  const fallback:Decision={stance:'clarify',reaction:0,subject:'quest',evidence:'',intention:null};
  if(!matchesSchema(raw,schemas.deliberate)) return fallback;
  const d=structuredClone(raw) as Decision;
  if(d.reaction && (d.evidence.length<3||!message.includes(d.evidence))) d.reaction=0;
  const p=d.intention;
  if(p && (d.stance!=='agree'||base.questStatus!=='active'&&p.goal===base.intention?.goal||!p.goal.trim()||p.goal.length>300||!p.motivation.trim()||p.motivation.length>300
    || !hasExecutableSteps(p.steps)
    ||p.targets.length<1||p.targets.length>5||p.targets.some(x=>!base.allowedTargets.includes(x)))) {
    d.intention=null; d.stance='clarify';
  }
  return d;
}
export async function runDialogue(client:SupabaseClient<Database>,actor:string,input:DialogueInput,provider:DialogueProvider,
  options:{maxCalls?:number;rounds?:number;deadlineMs?:number}={}) {
  const started=performance.now();
  const signal=AbortSignal.timeout(Math.min(90000,Math.max(1000,options.deadlineMs??90000)));
  const begun=await client.rpc('dialogue_begin',{p_actor:actor,p_turn:input.turnId,p_patron:input.patronKey,p_message:input.message,
    p_sequence:input.expectedConversationSequence,p_intent_card:input.intentCardId??undefined,
    p_offering_kind:input.offering?.kind,p_offering_item:input.offering?.itemId}).abortSignal(signal);
  if(begun.error) throw databaseError(begun.error);
  const turn=begun.data as any;
  if(turn.status==='completed') return {status:'completed',result:turn.result};
  if(turn.status==='stale') throw new DialogueError('The tavern changed. Send a new message from the refreshed conversation.',409,'STATE_CHANGED');
  if(turn.busy) return {status:'processing',turnId:input.turnId};
  const fence=turn.fence as string;
  const checkpoints=turn.checkpoints as Record<string,any>;
  let calls=0;
  async function checkpoint(stage:string,value:unknown) {
    const r=await client.rpc('dialogue_checkpoint',{p_actor:actor,p_turn:input.turnId,p_fence:fence,p_stage:stage,p_value:value as Json})
      .abortSignal(stage==='fail'?AbortSignal.timeout(1000):signal);
    if(r.error) throw databaseError(r.error);
  }
  async function generate(name:string,stage:Stage,payload:unknown):Promise<any> {
    if(checkpoints[name]) return checkpoints[name].value;
    if(signal.aborted || calls>=Math.min(8,options.maxCalls??8)) throw new DialogueError('The conversation took too long. Please retry.',503,'BUDGET');
    requirePayloadBudget(payload);
    await checkpoint('reserve',null); calls++;
    const out=await provider.generate(stage,payload,signal);
    if(signal.aborted) throw new DialogueError('The conversation took too long. Please retry.',503,'BUDGET');
    if(!matchesSchema(out.value,schemas[stage])) throw new DialogueError('A response stage was invalid. Please retry.',503,'STRUCTURE');
    const recorded={...out,inputContext:describePayload(payload)};
    await checkpoint(name,recorded); checkpoints[name]=recorded;
    return out.value;
  }
  async function retrieve(category:string,query='') {
    const r=await client.rpc('dialogue_context',{p_actor:actor,p_turn:input.turnId,p_category:category,p_query:query.slice(0,200)}).abortSignal(signal);
    if(r.error) throw databaseError(r.error); return r.data;
  }
  try {
    const base=checkpoints.base?.value ?? await retrieve('base') as any;
    if(!checkpoints.base) await checkpoint('base',{value:base,contentVersion:turn.content_version});
    const context:any[]=[]; const fetched=new Set<string>();
    let consequential=!!base.hospitality||!!base.playerIntent; let remember=false;
    for(let i=0;i<Math.min(2,Math.max(1,options.rounds??2));i++) {
      const selected=await generate(`investigate${i}`,'investigate',stagePayload(prepareContext(base,context)));
      consequential ||= selected.kind!=='informational'; remember ||= selected.remember;
      const evidenceName=`context${i}`;
      const evidence:any[]=checkpoints[evidenceName]?.value ?? [];
      if(!checkpoints[evidenceName]) {
        for(const request of selected.requests.slice(0,3)) {
          const key=evidenceKey(request); if(fetched.has(key)) continue; fetched.add(key);
          const data=await retrieve(request.category,request.query);
          const sourceIds:string[]=[];
          const collect=(v:any)=>{if(!v||typeof v!=='object')return;if(typeof v.id==='string')sourceIds.push(v.id);for(const child of Object.values(v))collect(child);};
          collect(data);
          evidence.push({category:request.category,query:request.query.slice(0,200),sourceIds,contentVersion:turn.content_version,data});
        }
        await checkpoint(evidenceName,{value:evidence});
      }
      for(const result of evidence)fetched.add(evidenceKey(result));
      context.push(...evidence);
      if(!selected.needsMore) break;
    }
    const window=checkpoints.decision?.contextWindow ?? prepareContext(base,context);
    let decision:Decision;
    if(checkpoints.decision) decision=checkpoints.decision.value as Decision;
    else {
      const proposed=consequential ? await generate('deliberate','deliberate',stagePayload(window))
        : {stance:'respond',reaction:0,subject:'quest',evidence:'',intention:null};
      decision=validateDecision(proposed,base,input.message);
      await checkpoint('decision',{value:decision,contextWindow:window,ruleVersion:turn.rule_version,validated:true,sourceStage:consequential?'deliberate':null,
        evidenceCheckpoints:['base','context0',...(checkpoints.investigate1?['context1']:[])]});
    }
    const decisionContext={decision,effectiveIntention:decision.intention??window.base.intention};
    let speech=await generate('speak','speak',stagePayload(window,decisionContext));
    let review=await generate('review','review',stagePayload(window,{...decisionContext,reply:speech.text}));
    if(!review.ok) {
      speech=await generate('rewrite','speak',stagePayload(window,{...decisionContext,previousReply:speech.text,corrections:review.issues}));
      review=await generate('rereview','review',stagePayload(window,{...decisionContext,reply:speech.text}));
      if(!review.ok) throw new DialogueError('The reply could not be verified. Cancel this message and rephrase it.',503,'CONSISTENCY');
    }
    if(remember||decision.intention||decision.reaction) {
      await generate('remember','remember',{keeper:input.message,npc:speech.text,npcName:base.name,decision});
    }
    if(signal.aborted) throw new DialogueError('The conversation took too long. Please retry.',503,'BUDGET');
    const committed=await client.rpc('dialogue_complete',{p_actor:actor,p_turn:input.turnId,p_fence:fence}).abortSignal(signal);
    if(committed.error) throw databaseError(committed.error);
    if((committed.data as any)?.status==='stale') throw new DialogueError('The tavern changed before the reply could be saved. Send a new message.',409,'STATE_CHANGED');
    console.info('npc_turn',{turnId:input.turnId,patron:input.patronKey,calls,durationMs:Math.round(performance.now()-started),outcome:'completed'});
    return {status:'completed',result:committed.data};
  } catch(cause) {
    if(cause instanceof ContextBudgetError)cause=new DialogueError(cause.message,503,'CONTEXT_BUDGET');
    await checkpoint('fail',{code:cause instanceof DialogueError?cause.code:'PROVIDER_FAILED'}).catch(()=>{});
    console.info('npc_turn',{turnId:input.turnId,patron:input.patronKey,calls,outcome:cause instanceof DialogueError?cause.code:'PROVIDER_FAILED'});
    if(cause instanceof DialogueError) throw cause;
    throw new DialogueError(cause instanceof Error&&cause.name==='ProviderUnavailable'?cause.message:'Dialogue generation is unavailable. Please retry.',503,'PROVIDER_FAILED');
  }
}
