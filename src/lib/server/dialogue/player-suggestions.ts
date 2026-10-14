import type { PromptSnapshot } from '$lib/server/prompt-registry';
import { prompts } from './prompts';
import type { DialogueProvider } from './provider';

export type SuggestionCard = Readonly<{ id:string; kind:'social'|'food'|'beverage'; cardKey?:'charm'|'insight'|'rumor'; displayName:string; qualityIndex?:number|null }>;
/** `id` is the stable world_npc_instances identity used by dialogue admission. */
export type SuggestionGuest = Readonly<{ id:string; name:string; context?:unknown }>;
export type PlayerSuggestion = Readonly<{ dailyCardId:string; npcId:string; text:string; source:'generated'|'fallback' }>;
export type SuggestionBatch = Readonly<{ generationId:string; status:'ready'|'fallback'; suggestions:PlayerSuggestion[] }>;
export type SuggestionBatchContext = Readonly<{ generationId:string; cards:SuggestionCard[]; guests:SuggestionGuest[]; history?:unknown; knowledge?:unknown }>;

type SuggestionStore = {
  get(generationId:string): Promise<unknown>;
  context(generationId:string): Promise<unknown>;
  claim?(generationId:string): Promise<unknown>;
  finalizeFallback?(generationId:string,suggestions:PlayerSuggestion[]): Promise<unknown>;
  upsert(generationId:string,status:'ready'|'fallback',suggestions:PlayerSuggestion[]): Promise<unknown>;
};

const prompt = {
  releaseId:'daily-player-suggestions-v1', revisionId:'daily-player-suggestions-v1', key:'dialogue.player_suggestions', revision:1,
  promptType:'text_system', body:prompts.player_suggestions, contentHash:'daily-player-suggestions-v1', bodyHash:'daily-player-suggestions-v1',
  contractId:'daily-player-suggestions-v1', contractHash:'daily-player-suggestions-v1', modelLane:'character', createdAt:'', createdBy:'system'
} as unknown as PromptSnapshot;

const validId=(value:unknown): value is string => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const keyOf=(dailyCardId:string,npcId:string)=>`${dailyCardId}:${npcId}`;

export function fallbackPlayerSuggestion(card:SuggestionCard, guest:SuggestionGuest): string {
  if (card.kind==='food' || card.kind==='beverage') return `I brought ${card.displayName}${card.qualityIndex == null ? '' : `, quality ${card.qualityIndex}`}. Would you like to try it, ${guest.name}?`;
  if (card.cardKey==='insight') return `How are you finding things lately, ${guest.name}? I would value your thoughts.`;
  if (card.cardKey==='rumor') return `Have you heard anything worth knowing, ${guest.name}? I would like to sort rumor from fact.`;
  return `It is good to see you, ${guest.name}. How has your day been?`;
}

export function fallbackPlayerSuggestions(context:SuggestionBatchContext): PlayerSuggestion[] {
  return context.cards.flatMap(card=>context.guests.map(guest=>({dailyCardId:card.id,npcId:guest.id,text:fallbackPlayerSuggestion(card,guest),source:'fallback' as const})));
}

export function validatePlayerSuggestions(value:unknown, context:SuggestionBatchContext): PlayerSuggestion[] | null {
  const raw=value && typeof value==='object' && Array.isArray((value as {suggestions?:unknown}).suggestions) ? (value as {suggestions:unknown[]}).suggestions : null;
  if (!raw) return null;
  const expected=new Set(context.cards.flatMap(card=>context.guests.map(guest=>keyOf(card.id,guest.id))));
  if (raw.length!==expected.size) return null;
  const seen=new Set<string>(); const suggestions:PlayerSuggestion[]=[];
  for (const row of raw) {
    if (!row || typeof row!=='object') return null;
    const {dailyCardId,npcId,text}=row as Record<string,unknown>;
    if (!validId(dailyCardId)||!validId(npcId)||typeof text!=='string'||!text.trim()||text.length>500) return null;
    const key=keyOf(dailyCardId,npcId);
    if (!expected.has(key)||seen.has(key)) return null;
    seen.add(key); suggestions.push({dailyCardId,npcId,text:text.trim(),source:'generated'});
  }
  return seen.size===expected.size ? suggestions : null;
}

function isSavedBatch(value:unknown): SuggestionBatch | null {
  if (!value || typeof value!=='object') return null;
  const row=value as {generationId?:unknown;status?:unknown;suggestions?:unknown};
  if (!validId(row.generationId)||(row.status!=='ready'&&row.status!=='fallback')||!Array.isArray(row.suggestions)) return null;
  const suggestions=row.suggestions.filter((item):item is PlayerSuggestion=>!!item&&typeof item==='object'&&validId((item as any).dailyCardId)&&validId((item as any).npcId)&&typeof (item as any).text==='string'&&((item as any).source==='generated'||(item as any).source==='fallback'));
  return suggestions.length===row.suggestions.length ? {generationId:row.generationId,status:row.status,suggestions} : null;
}

function coversContext(batch:SuggestionBatch, context:SuggestionBatchContext): boolean {
  const expected=new Set(context.cards.flatMap(card=>context.guests.map(guest=>keyOf(card.id,guest.id))));
  if (batch.suggestions.length!==expected.size) return false;
  const received=new Set(batch.suggestions.map(row=>keyOf(row.dailyCardId,row.npcId)));
  return received.size===expected.size && [...received].every(key=>expected.has(key));
}

function isContext(value:unknown): value is SuggestionBatchContext {
  const row=value as Partial<SuggestionBatchContext> | null;
  return !!row && validId(row.generationId) && Array.isArray(row.cards) && Array.isArray(row.guests)
    && row.cards.every(card=>card&&validId(card.id)&&['social','food','beverage'].includes(card.kind)&&typeof card.displayName==='string')
    && row.guests.every(guest=>guest&&validId(guest.id)&&typeof guest.name==='string');
}

function normalizeContext(value:unknown): SuggestionBatchContext | null {
  if (!value || typeof value!=='object') return null;
  const row=value as Record<string,unknown>;
  const guests=Array.isArray(row.guests) ? row.guests.map(guest=>guest&&typeof guest==='object'&&typeof (guest as any).guestId==='string'
    ? {...guest as Record<string,unknown>,id:(guest as any).guestId} : guest) : row.guests;
  const normalized={...row,guests};
  return isContext(normalized) ? normalized : null;
}

const pause=(milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds));

/** A generation ID is immutable: stored output always wins, so previews/reloads never regenerate. */
export async function preparePlayerSuggestions(store:SuggestionStore,generationId:string,provider:DialogueProvider | null | undefined,deadlineMs=12_000):Promise<SuggestionBatch> {
  const claim=store.claim ? await store.claim(generationId) : null;
  const claimed=!!claim && typeof claim==='object' && (claim as {claimed?:unknown}).claimed===true;
  const claimBatch=claim && typeof claim==='object' ? (claim as {batch?:unknown}).batch : null;
  const rawContext=claimed ? claimBatch : await store.context(generationId);
  const context=normalizeContext(rawContext);
  if (!context || context.generationId!==generationId) throw new Error('Player suggestion context is unavailable.');
  const saved=isSavedBatch(claimed ? null : claimBatch) ?? isSavedBatch(await store.get(generationId));
  if (saved && coversContext(saved,context)) return saved;
  const fallback=fallbackPlayerSuggestions(context);
  if (claim && !claimed) {
    const until=Date.now()+Math.max(1_000,deadlineMs)+250;
    while (Date.now()<until) {
      await pause(200);
      const winner=isSavedBatch(await store.get(generationId));
      if (winner && coversContext(winner,context)) return winner;
    }
    const winner=store.finalizeFallback ? isSavedBatch(await store.finalizeFallback(generationId,fallback)) : null;
    if (winner && coversContext(winner,context)) return winner;
    throw new Error('Player suggestion batch did not finalize.');
  }
  if (fallback.length===0) {
    await store.upsert(generationId,'ready',[]);
    return {generationId,status:'ready',suggestions:[]};
  }
  if (!provider) {
    await store.upsert(generationId,'fallback',fallback);
    return {generationId,status:'fallback',suggestions:fallback};
  }
  try {
    const controller=new AbortController();
    const timeout=Math.max(1_000,deadlineMs);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let output;
    try {
      output=await Promise.race([
      provider.generate('player_suggestions',{generationId,cards:context.cards,guests:context.guests,history:context.history??[],knowledge:context.knowledge??[]},controller.signal,prompt),
        new Promise<never>((_,reject)=>{ timeoutId=setTimeout(()=>{ controller.abort(); reject(new Error('player suggestion timeout')); },timeout); })
      ]);
    } finally { if (timeoutId) clearTimeout(timeoutId); }
    const suggestions=validatePlayerSuggestions(output.value,context);
    if (!suggestions) throw new Error('Player suggestion coverage was incomplete.');
    const stored=isSavedBatch(await store.upsert(generationId,'ready',suggestions));
    if (!stored || !coversContext(stored,context)) throw new Error('Player suggestion batch was not saved.');
    return stored;
  } catch {
    let stored:SuggestionBatch | null=null;
    try { stored=isSavedBatch(await store.upsert(generationId,'fallback',fallback)); } catch { /* expired claims finalize below */ }
    if (stored && coversContext(stored,context)) return stored;
    const winner=store.finalizeFallback ? isSavedBatch(await store.finalizeFallback(generationId,fallback)) : null;
    if (winner && coversContext(winner,context)) return winner;
    throw new Error('Player suggestion fallback was not saved.');
  }
}

export function playerSuggestionStore(client:{rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:{message:string}|null}>}):SuggestionStore {
  const call=async(name:string,args:Record<string,unknown>)=>{
    const result=await client.rpc(name,args);
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  return {get:generationId=>call('player_suggestion_batch_get',{p_generation_id:generationId}),context:generationId=>call('player_suggestion_batch_context',{p_generation_id:generationId}),claim:generationId=>call('player_suggestion_batch_claim',{p_generation_id:generationId}),finalizeFallback:(generationId,suggestions)=>call('player_suggestion_batch_finalize_fallback',{p_generation_id:generationId,p_suggestions:suggestions}),upsert:(generationId,status,suggestions)=>call('player_suggestion_batch_upsert',{p_generation_id:generationId,p_status:status,p_suggestions:suggestions})};
}
