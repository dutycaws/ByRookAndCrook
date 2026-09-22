import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/database.types';
import { hasExecutableSteps, type Decision, type DialogueInput } from '$lib/game/dialogue';
import { ProviderContextBudgetError, type DialogueProvider } from './provider';
import { ContextBudgetError, describePayload, evidenceKey, prepareContext, requirePayloadBudget, stagePayload, utf8Bytes, type ContextWindow } from './context';
import { assembleNpcMemoryContext, canonicalNpcMemoryContextPayload, sha256Hex, utf8Bytes as artifactUtf8Bytes, ContextAssemblyConfigurationError, InsufficientNpcMemoryContextError, type NpcMemoryContextArtifact } from '$lib/server/npc-memory/context';
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
  sourceManifest: Array<{ id: string; version: number; hash: string; kind: string }>;
  sourceManifestCoverage: { missingItemIds: string[]; complete: boolean };
};
type FrozenDialogueArtifact = NpcMemoryContextArtifact & Readonly<{
  revision: number;
  model: string;
  payload: Readonly<{ projections: { private: ContextWindow; public: ContextWindow }; baseProvenance: { contentVersion: string; profileRevision: number | null } }>;
}>;
const ROUTINE_CONTEXT_TOKENS=8_000;
const CONSEQUENTIAL_CONTEXT_TOKENS=16_000;
const FROZEN_CONTEXT_STAGE='frozen_context';
const frozenContextRevisionStage=(revision:number)=>`${FROZEN_CONTEXT_STAGE}:${revision}`;

/** The 081 RPC already applies save/instance scope, disclosure policy, and cutoff. */
function memoryRetrieval(value: unknown): MemoryRetrieval {
  const raw=value && typeof value==='object' ? value as Record<string, unknown> : {};
  const manifestCoverage=raw.sourceManifestCoverage;
  return {
    cutoffSequence:typeof raw.cutoffSequence==='number' ? raw.cutoffSequence : null,
    items:Array.isArray(raw.items) ? raw.items : [],
    sourceFallback:Array.isArray(raw.sourceFallback) ? raw.sourceFallback : [],
    watermarks:Array.isArray(raw.watermarks) ? raw.watermarks : []
    ,sourceManifest:Array.isArray(raw.sourceManifest) ? raw.sourceManifest.filter((entry): entry is {id:string;version:number;hash:string;kind:string}=>!!entry&&typeof entry==='object'&&typeof (entry as any).id==='string'&&Number.isSafeInteger((entry as any).version)&&typeof (entry as any).hash==='string'&&typeof (entry as any).kind==='string') : [],
    sourceManifestCoverage:manifestCoverage && typeof manifestCoverage==='object' && typeof (manifestCoverage as any).complete==='boolean'
      ? {missingItemIds:Array.isArray((manifestCoverage as any).missingItemIds) ? (manifestCoverage as any).missingItemIds.filter((id:unknown): id is string=>typeof id==='string') : [],complete:(manifestCoverage as any).complete}
      : {missingItemIds:[],complete:false}
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

function frozenArtifact(value: unknown, expected?: { cutoffSequence: number; contentVersion: string }): FrozenDialogueArtifact | null {
  if (!value || typeof value!=='object') return null;
  const artifact=value as Partial<FrozenDialogueArtifact>;
  const provenance=(artifact.payload as any)?.baseProvenance;
  if (!Number.isSafeInteger(artifact.revision) || artifact.revision! < 0 || typeof artifact.canonicalJson!=='string'
    || typeof artifact.hash!=='string' || !Number.isSafeInteger(artifact.tokens) || !Number.isSafeInteger(artifact.utf8Bytes)
    || artifact.tokens! < 0 || artifact.utf8Bytes! < 0 || !artifact.payload || typeof artifact.payload!=='object' || !(artifact.payload as any).projections?.private || !(artifact.payload as any).projections?.public
    || !['npc-context-routine-v1','npc-context-consequential-v1'].includes(artifact.policyVersion ?? '') || artifact.projectionVersion!=='npc-dialogue-projections-v1'
    || typeof artifact.tokenizer!=='string' || !artifact.tokenizer || typeof artifact.counterId!=='string' || !artifact.counterId || artifact.tokenizer!==artifact.counterId
    || typeof artifact.model!=='string' || !artifact.model || !Number.isSafeInteger(artifact.counterDurationMs) || artifact.counterDurationMs! < 0
    || !Number.isSafeInteger(artifact.cutoffSequence) || artifact.cutoffSequence! < 0 || artifact.view!=='speech'
    || !provenance || typeof provenance.contentVersion!=='string' || !provenance.contentVersion || !(provenance.profileRevision===null || (Number.isSafeInteger(provenance.profileRevision) && provenance.profileRevision>=0))
    || !Array.isArray(artifact.sourceManifest) || !artifact.coverage?.complete) return null;
  if (expected && (artifact.cutoffSequence!==expected.cutoffSequence || provenance.contentVersion!==expected.contentVersion)) return null;
  const canonical=canonicalNpcMemoryContextPayload({sources:artifact.sourceManifest,requiredSourceIds:artifact.coverage.required,payload:artifact.payload as Record<string,unknown>});
  if (canonical!==artifact.canonicalJson || artifactUtf8Bytes(canonical)!==artifact.utf8Bytes || sha256Hex(canonical)!==artifact.hash) return null;
  return artifact as FrozenDialogueArtifact;
}

function initialMemoryQuery(message: string, recent: unknown): string {
  const previous=Array.isArray(recent) ? recent.at(-1) : null;
  const previousText=previous && typeof previous==='object'
    ? [(previous as Record<string, unknown>).keeper,(previous as Record<string, unknown>).npc].filter((value): value is string=>typeof value==='string').join(' ')
    : '';
  return [message,previousText].filter(Boolean).join('\n').slice(0,400);
}

/** Content-free measurements only; the evidence itself remains checkpoint-only. */
function memoryContextMeasurements(payload: unknown, reuse: 'fresh'|'replayed', preflight?: { inputTokens: number; durationMs: number }, artifact?: FrozenDialogueArtifact | null) {
  const context=(payload && typeof payload==='object' && Array.isArray((payload as Record<string, unknown>).context))
    ? (payload as {context:Array<Record<string, unknown>>}).context : [];
  const memory=context.filter(entry=>entry.category==='memories');
  const selectedRecordCount=memory.reduce((count,entry)=>count+(Array.isArray((entry.data as Record<string, unknown> | undefined)?.items)
    ? ((entry.data as Record<string, unknown>).items as unknown[]).length : 0),0);
  const sourceRecordCount=new Set(memory.flatMap(entry=>Array.isArray(entry.sourceIds) ? entry.sourceIds.filter((id): id is string=>typeof id==='string') : [])).size;
  const coverageGapCount=memory.reduce((count,entry)=>count+(Array.isArray((entry.data as Record<string, unknown> | undefined)?.watermarks)
    ? ((entry.data as Record<string, unknown>).watermarks as unknown[]).filter(watermark=>watermark && typeof watermark==='object' && (watermark as Record<string, unknown>).gapSequence!=null).length : 0),0);
  return {selectedRecordCount,sourceRecordCount,utf8Bytes:utf8Bytes(payload),coverageGapCount,reuse,
    ...(preflight ? { modelTokenCount: preflight.inputTokens, assemblyDurationMs: preflight.durationMs } : {}),
    ...(artifact ? {artifactHash:artifact.hash,artifactRevision:artifact.revision,artifactTokens:artifact.tokens,artifactCounterModel:artifact.model,artifactUtf8Bytes:artifact.utf8Bytes,artifactCountDurationMs:artifact.counterDurationMs,configuredTokenCount:artifact.tokens} : {})};
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
  if (cause instanceof ProviderContextBudgetError) return 'context_budget';
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
  let frozenTelemetry: FrozenDialogueArtifact | null=null;
  async function checkpoint(stage:string,value:unknown) {
    const r=await client.rpc('npc_dialogue_checkpoint',{p_actor:actor,p_turn_id:input.turnId,p_fence:fence,p_stage:stage,p_value:value as Json})
      .abortSignal(stage==='fail'?AbortSignal.timeout(1000):signal);
    if(r.error) throw databaseError(r.error);
  }
  async function generate(name:string,stage:Stage,payload:unknown):Promise<any> {
    if(checkpoints[name] && (name.startsWith('investigate') || checkpoints[name].artifactHash===frozenTelemetry?.hash)) return checkpoints[name].value;
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
    await emitAiObservability(options.observability,{correlationId:input.turnId,workflow:'dialogue',stage:name,status:'completed',attempt:calls,durationMs:out.durationMs,model:out.model,tokenUsage:out.usage,memoryContext:memoryContextMeasurements(payload,contextWasReplayed?'replayed':'fresh',out.preflight,frozenTelemetry)});
    const recorded={...out,inputContext:describePayload(payload),...(frozenTelemetry?{artifactRevision:frozenTelemetry.revision,artifactHash:frozenTelemetry.hash}:{})};
    await checkpoint(name,recorded); checkpoints[name]=recorded;
    return out.value;
  }
  async function retrieve(category:string,query='') {
    const r=await client.rpc('npc_dialogue_context',{p_actor:actor,p_turn_id:input.turnId,p_category:category,p_query:query.slice(0,200)}).abortSignal(signal);
    if(r.error) throw databaseError(r.error); return r.data;
  }
  try {
    const activeFrozenPointer=checkpoints[FROZEN_CONTEXT_STAGE]?.value;
    const replayArtifacts=Object.entries(checkpoints).flatMap(([stage,checkpoint])=>{
      const match=new RegExp(`^${FROZEN_CONTEXT_STAGE}:(\\d+)$`).exec(stage);
      const candidate=frozenArtifact(checkpoint?.value,{cutoffSequence:input.expectedConversationSequence,contentVersion:String(turn.content_version ?? '')});
      return match && candidate?.revision===Number(match[1]) ? [candidate] : [];
    }).sort((left,right)=>right.revision-left.revision);
    const replayArtifact=replayArtifacts[0] ?? null;
    if (replayArtifact && (activeFrozenPointer?.revision!==replayArtifact.revision || activeFrozenPointer?.hash!==replayArtifact.hash)) {
      await checkpoint(FROZEN_CONTEXT_STAGE,{value:{revision:replayArtifact.revision,hash:replayArtifact.hash}});
      checkpoints[FROZEN_CONTEXT_STAGE]={value:{revision:replayArtifact.revision,hash:replayArtifact.hash}};
    }
    if (!replayArtifact && checkpoints.memory) throw new DialogueError('This dialogue retry has a legacy memory checkpoint without a verifiable frozen context. Please retry the message.',503,'CONTEXT_BUDGET');
    const base=replayArtifact ? replayArtifact.payload.projections.private.base : checkpoints.base?.value ?? await retrieve('base') as any;
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
    let artifact=replayArtifact;
    contextWasReplayed=!!artifact;
    const context:any[]=[]; const fetched=new Set<string>();
    if (artifact) for (const item of structuredClone(artifact.payload.projections.private.context)) { context.push(item); fetched.add(evidenceKey(item)); }
    let consequential=!!base.hospitality||!!base.playerIntent; let remember=false;
    function sourceManifestFor(evidence: any[]) {
      const sources=new Map<string,{id:string;version:number;hash:string;kind:string}>();
      for(const item of evidence) {
        if(item?.category!=='memories') continue;
        const memory=memoryRetrieval(item.data);
        if(!memory.sourceManifestCoverage.complete) throw new ContextBudgetError();
        for(const source of memory.sourceManifest) sources.set(`${source.id}:${source.version}:${source.hash}:${source.kind}`,source);
      }
      return [...sources.values()];
    }
    async function freezeContext(revision:number) {
      const privateWindow=prepareContext(base,context);
      const requiredMemory=context.filter(item=>item?.category==='memories');
      if (requiredMemory.some(item=>!privateWindow.context.some(candidate=>evidenceKey(candidate)===evidenceKey(item)))) throw new ContextBudgetError();
      const publicWindow=publicDialogueWindow(privateWindow);
      const sources=sourceManifestFor(privateWindow.context);
      const payload={projections:{private:privateWindow,public:publicWindow},targetTokens:consequential?16_000:8_000,
        baseProvenance:{contentVersion:String(turn.content_version ?? ''),profileRevision:Number.isSafeInteger(base.profileRevision)?base.profileRevision as number:null}};
      const policyVersion=consequential?'npc-context-consequential-v1':'npc-context-routine-v1';
      const projectionVersion='npc-dialogue-projections-v1';
      const maxTokens=CONSEQUENTIAL_CONTEXT_TOKENS;
      if(!provider.countContext) throw new ProviderContextBudgetError('The dialogue provider cannot verify frozen-context tokens.');
      const canonical=canonicalNpcMemoryContextPayload({sources,requiredSourceIds:sources.map(source=>source.id),payload});
      let counted: Awaited<ReturnType<NonNullable<DialogueProvider['countContext']>>>;
      try { counted=await provider.countContext(canonical,signal); }
      catch (cause) { throw new ProviderContextBudgetError(cause instanceof Error ? cause.message : 'Frozen-context counting is unavailable.'); }
      const next=assembleNpcMemoryContext({policyVersion,projectionVersion,maxBytes:64*1024,maxTokens,sources,requiredSourceIds:sources.map(source=>source.id),payload,
        tokenCount:counted.inputTokens,tokenizerId:counted.counterId,counterId:counted.counterId,counterDurationMs:counted.durationMs,model:counted.model,cutoffSequence:input.expectedConversationSequence,view:'speech',revision}) as FrozenDialogueArtifact;
      await checkpoint(frozenContextRevisionStage(revision),{value:next});
      checkpoints[frozenContextRevisionStage(revision)]={value:next};
      await checkpoint(FROZEN_CONTEXT_STAGE,{value:{revision:next.revision,hash:next.hash}});
      checkpoints[FROZEN_CONTEXT_STAGE]={value:{revision:next.revision,hash:next.hash}}; artifact=next; frozenTelemetry=next;
      return next;
    }
    if(!artifact) {
      const data=await retrieveMemory(memoryQuery);
      if(!data.sourceManifestCoverage.complete) throw new ContextBudgetError();
      const evidence={category:'memories',query:memoryQuery,sourceIds:memorySourceIds(data),contentVersion:'npc-memory-v1',data};
      context.push(evidence); fetched.add(evidenceKey(evidence));
      await checkpoint('memory',{value:evidence,cutoffSequence:input.expectedConversationSequence,view:'speech'});
      artifact=await freezeContext(0);
    }
    let activeArtifact=artifact; frozenTelemetry=activeArtifact;
    for(let i=0;i<Math.min(2,Math.max(1,options.rounds??2));i++) {
      const investigationWindow=activeArtifact.payload.projections.private;
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
          if(request.category==='memories' && !memoryRetrieval(data).sourceManifestCoverage.complete) throw new ContextBudgetError();
          const sourceIds:string[]=[];
          if (request.category==='memories') sourceIds.push(...memorySourceIds(memoryRetrieval(data)));
          else {
            const collect=(v:any)=>{if(!v||typeof v!=='object')return;if(typeof v.id==='string')sourceIds.push(v.id);for(const child of Object.values(v))collect(child);};
            collect(data);
          }
          evidence.push({category:request.category,query:request.query.slice(0,request.category==='memories'?400:200),sourceIds,contentVersion:request.category==='memories'?'npc-memory-v1':turn.content_version,data});
        }
        const evidenceCheckpoint={value:evidence,sourceArtifact:{revision:activeArtifact.revision,hash:activeArtifact.hash}};
        await checkpoint(evidenceName,evidenceCheckpoint);
        checkpoints[evidenceName]=evidenceCheckpoint;
      }
      for(const result of evidence)fetched.add(evidenceKey(result));
      context.push(...evidence);
      const causativeHash=checkpoints[evidenceName]?.sourceArtifact?.hash ?? (activeArtifact.revision===0 ? activeArtifact.hash : null);
      const shouldAdvance=(evidence.length>0 || (consequential && activeArtifact.revision===0)) && causativeHash===activeArtifact.hash;
      if (shouldAdvance) activeArtifact=await freezeContext(activeArtifact.revision+1);
      if(!selected.needsMore) break;
    }
    const window=activeArtifact.payload.projections.private;
    let decision:Decision;
    if(checkpoints.decision?.artifactHash===activeArtifact.hash) decision=checkpoints.decision.value as Decision;
    else {
      const proposed=consequential ? await generate('deliberate','deliberate',stagePayload(window,{privateCognition:privateCognition(window)}))
        : {stance:'respond',reaction:0,subject:'quest',evidence:'',intention:null};
      decision=validateDecision(proposed,base,input.message);
      await checkpoint('decision',{value:decision,contextWindow:window,ruleVersion:turn.rule_version,validated:true,sourceStage:consequential?'deliberate':null,
        evidenceCheckpoints:['base','context0',...(checkpoints.investigate1?['context1']:[])],
        ...(frozenTelemetry?{artifactRevision:frozenTelemetry.revision,artifactHash:frozenTelemetry.hash}:{})});
    }
    const decisionContext={decision,effectiveIntention:decision.intention??window.base.intention};
    const speechWindow=activeArtifact.payload.projections.public;
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
    if(cause instanceof ContextBudgetError || cause instanceof ProviderContextBudgetError || cause instanceof InsufficientNpcMemoryContextError || cause instanceof ContextAssemblyConfigurationError)cause=new DialogueError(cause.message,503,'CONTEXT_BUDGET');
    await checkpoint('fail',{code:cause instanceof DialogueError?cause.code:'PROVIDER_FAILED'}).catch(()=>{});
    console.info('npc_turn',{turnId:input.turnId,npcId:input.npcId,calls,outcome:cause instanceof DialogueError?cause.code:'PROVIDER_FAILED'});
    if(cause instanceof DialogueError) throw cause;
    throw new DialogueError(cause instanceof Error&&cause.name==='ProviderUnavailable'?cause.message:'Dialogue generation is unavailable. Please retry.',503,'PROVIDER_FAILED');
  }
}
