import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/database.types';
import { hasExecutableSteps, type Decision, type DialogueInput } from '$lib/game/dialogue';
import type { DialogueProvider } from './provider';
import { ContextBudgetError, describePayload, evidenceKey, prepareContext, requirePayloadBudget, stagePayload, utf8Bytes, type ContextWindow } from './context';
import { matchesSchema, schemas, type Stage } from './schemas';
import { emitAiObservability, type AiObservabilitySink } from '$lib/server/observability/ai-events';
import { DIALOGUE_PROMPT_KEY, releaseTextPrompt } from '$lib/server/prompt-registry/runtime';
import type { PromptRegistryService } from '$lib/server/prompt-registry/service';

export class DialogueError extends Error { constructor(message:string,public status=500,public code='DIALOGUE_FAILED'){super(message);} }
export type DialogueRuntimeOptions = { maxCalls?:number; rounds?:number; deadlineMs?:number; observability?: AiObservabilitySink; promptRegistry?: PromptRegistryService };
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_COGNITION_KEYS=new Set(['evolvingProfile','profileRevision','beliefs','currentSocial','social','pressure','roll','rolls','critic','privateIntent','privateCognition']);

/**
 * The investigation and decision stages are server-only cognition work. Speech
 * and review receive a separately constructed public window so private beliefs
 * cannot accidentally become a model-visible source for a factual statement.
 */
function stripPrivateCognition(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPrivateCognition);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !PRIVATE_COGNITION_KEYS.has(key))
    .map(([key, child]) => [key, stripPrivateCognition(child)]));
}

function privateCognition(window: ContextWindow) {
  const base=window.base as Record<string, unknown>;
  return {
    profileRevision:base.profileRevision ?? null,
    evolvingProfile:base.evolvingProfile ?? null,
    beliefs:window.context.filter(item=>item.category==='beliefs').map(item=>item.data),
    currentSocial:window.context.filter(item=>item.category==='relationships').map(item=>
      item.data && typeof item.data==='object' ? (item.data as Record<string, unknown>).currentSocial ?? null : null)
  };
}

type MemoryRetrieval = {
  cutoffSequence: number | null;
  items: unknown[];
  sourceFallback: unknown[];
  watermarks: unknown[];
};

/** The 081 RPC already applies save/instance scope, disclosure policy, and cutoff. */
function memoryRetrieval(value: unknown): MemoryRetrieval {
  const raw=value && typeof value==='object' ? value as Record<string, unknown> : {};
  return {
    cutoffSequence:typeof raw.cutoffSequence==='number' ? raw.cutoffSequence : null,
    items:Array.isArray(raw.items) ? raw.items : [],
    sourceFallback:Array.isArray(raw.sourceFallback) ? raw.sourceFallback : [],
    watermarks:Array.isArray(raw.watermarks) ? raw.watermarks : []
  };
}

function memorySourceIds(retrieval: MemoryRetrieval): string[] {
  const ids=new Set<string>();
  for (const item of retrieval.items) {
    if (!item || typeof item!=='object') continue;
    const record=item as Record<string, unknown>;
    for (const key of ['id','record_root_id','source_id']) if (typeof record[key]==='string') ids.add(record[key]);
  }
  for (const turn of retrieval.sourceFallback) {
    if (turn && typeof turn==='object' && typeof (turn as Record<string, unknown>).turnId==='string') ids.add((turn as Record<string, string>).turnId);
  }
  return [...ids];
}

function initialMemoryQuery(message: string, recent: unknown): string {
  const previous=Array.isArray(recent) ? recent.at(-1) : null;
  const previousText=previous && typeof previous==='object'
    ? [(previous as Record<string, unknown>).keeper,(previous as Record<string, unknown>).npc].filter((value): value is string=>typeof value==='string').join(' ')
    : '';
  return [message,previousText].filter(Boolean).join('\n').slice(0,400);
}

/** Content-free measurements only; the evidence itself remains checkpoint-only. */
function memoryContextMeasurements(payload: unknown, reuse: 'fresh'|'replayed') {
  const context=(payload && typeof payload==='object' && Array.isArray((payload as Record<string, unknown>).context))
    ? (payload as {context:Array<Record<string, unknown>>}).context : [];
  const memory=context.filter(entry=>entry.category==='memories');
  const selectedRecordCount=memory.reduce((count,entry)=>count+(Array.isArray((entry.data as Record<string, unknown> | undefined)?.items)
    ? ((entry.data as Record<string, unknown>).items as unknown[]).length : 0),0);
  const sourceRecordCount=new Set(memory.flatMap(entry=>Array.isArray(entry.sourceIds) ? entry.sourceIds.filter((id): id is string=>typeof id==='string') : [])).size;
  const coverageGapCount=memory.reduce((count,entry)=>count+(Array.isArray((entry.data as Record<string, unknown> | undefined)?.watermarks)
    ? ((entry.data as Record<string, unknown>).watermarks as unknown[]).filter(watermark=>watermark && typeof watermark==='object' && (watermark as Record<string, unknown>).gapSequence!=null).length : 0),0);
  return {selectedRecordCount,sourceRecordCount,utf8Bytes:utf8Bytes(payload),coverageGapCount,reuse};
}

export function publicDialogueWindow(window: ContextWindow): ContextWindow {
  return stripPrivateCognition({
    ...window,
    // Beliefs are private character interpretation, never public evidence.
    context:window.context.filter(item=>item.category!=='beliefs')
  }) as ContextWindow;
}
export function parseInput(value:unknown): DialogueInput {
  const v=value as DialogueInput;
  if(!v || typeof v!=='object' || !uuid.test(v.turnId??'') || !uuid.test(v.npcId??'') || typeof v.message!=='string'
    || !v.message.trim() || v.message.length>2000 || !Number.isSafeInteger(v.expectedConversationSequence) || v.expectedConversationSequence<0
    || v.interactionVersion!=='dialogue-v2' || v.intentCardId!=null&&!uuid.test(v.intentCardId)
    || v.offering!=null&&(!['food','beverage'].includes(v.offering.kind)||!uuid.test(v.offering.itemId)))
    throw new DialogueError('Enter a message and choose an available intent card or offering.',400,'INVALID_INPUT');
  return {turnId:v.turnId,npcId:v.npcId,message:v.message,expectedConversationSequence:v.expectedConversationSequence,
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
  const activeIntention=base.intention;
  const sameTargets=(left:unknown,right:unknown)=>Array.isArray(left)&&Array.isArray(right)
    && left.length===right.length&&left.every((value,index)=>value===right[index]);
  if(p && (d.stance!=='agree'||(base.questLifecycleStatus??base.questStatus)!=='active'||!activeIntention
    ||p.goal!==activeIntention.goal||p.motivation!==activeIntention.motivation||!sameTargets(p.targets,activeIntention.targets)
    ||!p.goal.trim()||p.goal.length>300||!p.motivation.trim()||p.motivation.length>300
    || !hasExecutableSteps(p.steps)
    ||p.targets.length<1||p.targets.length>5||p.targets.some(x=>!base.allowedTargets.includes(x)))) {
    d.intention=null; d.stance='clarify';
  }
  return d;
}
function observabilityErrorCode(cause: unknown): string {
  if (cause instanceof DialogueError) return cause.code;
  if (cause instanceof Error && cause.name === 'ProviderUnavailable') return 'provider_unavailable';
  return 'provider_failed';
}
export async function runDialogue(client:SupabaseClient<Database>,actor:string,input:DialogueInput,provider:DialogueProvider,
  options:DialogueRuntimeOptions={}) {
  const npcId = input.npcId;
  const started=performance.now();
  const signal=AbortSignal.timeout(Math.min(90000,Math.max(1000,options.deadlineMs??90000)));
  const begun=await client.rpc('npc_dialogue_begin',{p_actor:actor,p_turn_id:input.turnId,p_npc_id:npcId,p_message:input.message,
    p_expected_sequence:input.expectedConversationSequence,p_intent_card_id:input.intentCardId??undefined,
    p_offering_kind:input.offering?.kind,p_offering_item_id:input.offering?.itemId}).abortSignal(signal);
  if(begun.error) throw databaseError(begun.error);
  const turn=begun.data as any;
  if(turn.status==='completed') return {status:'completed',result:turn.result};
  if(turn.status==='stale') throw new DialogueError('The tavern changed. Send a new message from the refreshed conversation.',409,'STATE_CHANGED');
  if(turn.busy) return {status:'processing',turnId:input.turnId};
  // The row was inserted before provider work and carries an immutable release
  // pin. Resolving it now prevents a later active-release change affecting a
  // retry of this turn.
  let promptRelease: Awaited<ReturnType<PromptRegistryService['resolveForWork']>>;
  try {
    if (!options.promptRegistry) throw new Error('Prompt registry is required for dialogue execution');
    promptRelease = await options.promptRegistry.resolveForWork('dialogue', input.turnId);
  }
  catch { throw new DialogueError('The dialogue prompt release is unavailable. Please retry.',503,'REGISTRY_UNAVAILABLE'); }
  const fence=turn.fence as string;
  const checkpoints=turn.checkpoints as Record<string,any>;
  let calls=0;
  let contextWasReplayed=false;
  async function checkpoint(stage:string,value:unknown) {
    const r=await client.rpc('npc_dialogue_checkpoint',{p_actor:actor,p_turn_id:input.turnId,p_fence:fence,p_stage:stage,p_value:value as Json})
      .abortSignal(stage==='fail'?AbortSignal.timeout(1000):signal);
    if(r.error) throw databaseError(r.error);
  }
  async function generate(name:string,stage:Stage,payload:unknown):Promise<any> {
    if(checkpoints[name]) return checkpoints[name].value;
    if(signal.aborted || calls>=Math.min(8,options.maxCalls??8)) throw new DialogueError('The conversation took too long. Please retry.',503,'BUDGET');
    requirePayloadBudget(payload);
    await checkpoint('reserve',null); calls++;
    let out: Awaited<ReturnType<DialogueProvider['generate']>>;
    const prompt = releaseTextPrompt(promptRelease, DIALOGUE_PROMPT_KEY[stage]);
    try {
      await options.promptRegistry?.recordSafeRun({ executionId:input.turnId,attempt:calls,workflow:'dialogue',nodeKey:name,prompt,status:'started' });
      out=await provider.generate(stage,payload,signal,prompt);
    }
    catch (cause) {
      await options.promptRegistry?.recordSafeRun({ executionId:input.turnId,attempt:calls,workflow:'dialogue',nodeKey:name,prompt,status:'failed',errorCode:'provider_failed' }).catch(()=>{});
      await emitAiObservability(options.observability,{correlationId:input.turnId,workflow:'dialogue',stage:name,status:'failed',attempt:calls,errorCode:signal.aborted?'provider_timeout':observabilityErrorCode(cause)});
      throw cause;
    }
    if(signal.aborted) {
      await emitAiObservability(options.observability,{correlationId:input.turnId,workflow:'dialogue',stage:name,status:'failed',attempt:calls,errorCode:'budget'});
      throw new DialogueError('The conversation took too long. Please retry.',503,'BUDGET');
    }
    if(!matchesSchema(out.value,schemas[stage])) {
      await options.promptRegistry?.recordSafeRun({ executionId:input.turnId,attempt:calls,workflow:'dialogue',nodeKey:name,prompt,status:'failed',errorCode:'provider_malformed' }).catch(()=>{});
      await emitAiObservability(options.observability,{correlationId:input.turnId,workflow:'dialogue',stage:name,status:'failed',attempt:calls,errorCode:'structure'});
      throw new DialogueError('A response stage was invalid. Please retry.',503,'STRUCTURE');
    }
    await options.promptRegistry?.recordSafeRun({ executionId:input.turnId,attempt:calls,workflow:'dialogue',nodeKey:name,prompt,status:'completed',model:out.model,durationMs:out.durationMs,inputTokens:out.usage.input,outputTokens:out.usage.output }).catch(()=>{});
    await emitAiObservability(options.observability,{correlationId:input.turnId,workflow:'dialogue',stage:name,status:'completed',attempt:calls,durationMs:out.durationMs,model:out.model,tokenUsage:out.usage,memoryContext:memoryContextMeasurements(payload,contextWasReplayed?'replayed':'fresh')});
    const recorded={...out,inputContext:describePayload(payload)};
    await checkpoint(name,recorded); checkpoints[name]=recorded;
    return out.value;
  }
  async function retrieve(category:string,query='') {
    const r=await client.rpc('npc_dialogue_context',{p_actor:actor,p_turn_id:input.turnId,p_category:category,p_query:query.slice(0,200)}).abortSignal(signal);
    if(r.error) throw databaseError(r.error); return r.data;
  }
  try {
    const base=checkpoints.base?.value ?? await retrieve('base') as any;
    if(!checkpoints.base) await checkpoint('base',{value:base,contentVersion:turn.content_version});
    const memoryQuery=initialMemoryQuery(input.message,base.recent);
    async function retrieveMemory(query:string) {
      if (typeof base.instanceId!=='string') throw new DialogueError('The resident memory scope is unavailable. Please retry.',503,'CONTEXT_UNAVAILABLE');
      const r=await client.rpc('npc_memory_retrieve_for_actor',{
        p_actor:actor,p_instance_id:base.instanceId,p_query:query.slice(0,400),p_limit:12,
        // The turn's expected sequence is captured before generation.  It is
        // the immutable knowledge boundary for this turn, including retries.
        p_cutoff_sequence:input.expectedConversationSequence,p_view:'speech'
      }).abortSignal(signal);
      if(r.error) throw databaseError(r.error);
      return memoryRetrieval(r.data);
    }
    contextWasReplayed=!!checkpoints.memory;
    const initialMemory:any=checkpoints.memory?.value ?? null;
    const context:any[]=initialMemory ? [initialMemory] : []; const fetched=new Set<string>();
    if(!checkpoints.memory) {
      const data=await retrieveMemory(memoryQuery);
      const evidence={category:'memories',query:memoryQuery,sourceIds:memorySourceIds(data),contentVersion:'npc-memory-v1',data};
      context.push(evidence); fetched.add(evidenceKey(evidence));
      await checkpoint('memory',{value:evidence,cutoffSequence:input.expectedConversationSequence,view:'speech'});
    } else fetched.add(evidenceKey(initialMemory));
    let consequential=!!base.hospitality||!!base.playerIntent; let remember=false;
    for(let i=0;i<Math.min(2,Math.max(1,options.rounds??2));i++) {
      const investigationWindow=prepareContext(base,context);
      const selected=await generate(`investigate${i}`,'investigate',stagePayload(investigationWindow,{privateCognition:privateCognition(investigationWindow)}));
      consequential ||= selected.kind!=='informational'; remember ||= selected.remember;
      const evidenceName=`context${i}`;
      const evidence:any[]=checkpoints[evidenceName]?.value ?? [];
      if(!checkpoints[evidenceName]) {
        for(const request of selected.requests.slice(0,3)) {
          const key=evidenceKey(request); if(fetched.has(key)) continue; fetched.add(key);
          const data=request.category==='memories'
            ? await retrieveMemory(request.query)
            : await retrieve(request.category,request.query);
          const sourceIds:string[]=[];
          if (request.category==='memories') sourceIds.push(...memorySourceIds(memoryRetrieval(data)));
          else {
            const collect=(v:any)=>{if(!v||typeof v!=='object')return;if(typeof v.id==='string')sourceIds.push(v.id);for(const child of Object.values(v))collect(child);};
            collect(data);
          }
          evidence.push({category:request.category,query:request.query.slice(0,request.category==='memories'?400:200),sourceIds,contentVersion:request.category==='memories'?'npc-memory-v1':turn.content_version,data});
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
      const proposed=consequential ? await generate('deliberate','deliberate',stagePayload(window,{privateCognition:privateCognition(window)}))
        : {stance:'respond',reaction:0,subject:'quest',evidence:'',intention:null};
      decision=validateDecision(proposed,base,input.message);
      await checkpoint('decision',{value:decision,contextWindow:window,ruleVersion:turn.rule_version,validated:true,sourceStage:consequential?'deliberate':null,
        evidenceCheckpoints:['base','context0',...(checkpoints.investigate1?['context1']:[])]});
    }
    const decisionContext={decision,effectiveIntention:decision.intention??window.base.intention};
    const speechWindow=publicDialogueWindow(window);
    let speech=await generate('speak','speak',stagePayload(speechWindow,decisionContext));
    let review=await generate('review','review',stagePayload(speechWindow,{...decisionContext,reply:speech.text}));
    if(!review.ok) {
      speech=await generate('rewrite','speak',stagePayload(speechWindow,{...decisionContext,previousReply:speech.text,corrections:review.issues}));
      review=await generate('rereview','review',stagePayload(speechWindow,{...decisionContext,reply:speech.text}));
      if(!review.ok) throw new DialogueError('The reply could not be verified. Cancel this message and rephrase it.',503,'CONSISTENCY');
    }
    if(remember||decision.intention||decision.reaction) {
      await generate('remember','remember',{keeper:input.message,npc:speech.text,npcName:base.name,decision});
    }
    if(signal.aborted) throw new DialogueError('The conversation took too long. Please retry.',503,'BUDGET');
    const committed=await client.rpc('npc_dialogue_complete',{p_actor:actor,p_turn_id:input.turnId,p_fence:fence}).abortSignal(signal);
    if(committed.error) throw databaseError(committed.error);
    if((committed.data as any)?.status==='stale') throw new DialogueError('The tavern changed before the reply could be saved. Send a new message.',409,'STATE_CHANGED');
    console.info('npc_turn',{turnId:input.turnId,npcId:input.npcId,calls,durationMs:Math.round(performance.now()-started),outcome:'completed'});
    return {status:'completed',result:committed.data};
  } catch(cause) {
    if(cause instanceof ContextBudgetError)cause=new DialogueError(cause.message,503,'CONTEXT_BUDGET');
    await checkpoint('fail',{code:cause instanceof DialogueError?cause.code:'PROVIDER_FAILED'}).catch(()=>{});
    console.info('npc_turn',{turnId:input.turnId,npcId:input.npcId,calls,outcome:cause instanceof DialogueError?cause.code:'PROVIDER_FAILED'});
    if(cause instanceof DialogueError) throw cause;
    throw new DialogueError(cause instanceof Error&&cause.name==='ProviderUnavailable'?cause.message:'Dialogue generation is unavailable. Please retry.',503,'PROVIDER_FAILED');
  }
}
