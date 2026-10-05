import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';
import type { ActionKind, Approach, CurrentQuest, Journal, PublicDisposition, PublicEvolutionEntry, PublicQuestArchive, PublicQuestArchiveQuest, PublicQuestHistoryEntry, QuestLifecycleStatus } from '$lib/game/dialogue';
import type { Patron, ServeReceipt } from '$lib/game/serving';
import { localScenePublicUrl } from '$lib/server/community-npc-jobs/local-assets';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { barResidentArtworkId, sceneRuntimeAssetPublicUrl } from '$lib/game/scene-runtime-assets';
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function shortText(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= limit ? text : null;
}

function nonNegativeInteger(value: unknown, minimum = 0): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : null;
}

function questStatus(value: unknown): QuestLifecycleStatus {
  return value === 'awaiting_transition' || value === 'departing' || value === 'departed' ? value : 'active';
}

function questStep(value: unknown): { action: ActionKind; approach: Approach } | null {
  const candidate = record(value);
  const action = candidate?.action;
  const approach = candidate?.approach;
  return (action === 'prepare' || action === 'attempt' || action === 'wait' || action === 'abandon')
    && (approach === 'scouting' || approach === 'combat' || approach === 'diplomacy' || approach === 'trade')
    ? { action, approach }
    : null;
}

function currentQuest(value: unknown): CurrentQuest | null {
  const candidate = record(value);
  if (!candidate) return null;
  const id = shortText(candidate.id, 80);
  const origin = candidate.origin;
  const title = shortText(candidate.title, 240);
  const objective = shortText(candidate.objective, 2000);
  const currentStep = nonNegativeInteger(candidate.currentStep);
  const activationDay = nonNegativeInteger(candidate.activationDay);
  const readiness = candidate.readiness;
  const risk = candidate.risk;
  const plan = Array.isArray(candidate.plan) ? candidate.plan.flatMap((step) => {
    const parsed = questStep(step);
    return parsed ? [parsed] : [];
  }) : [];
  if (!id || (origin !== 'authored_milestone' && origin !== 'generated_successor') || !title || !objective
    || currentStep === null || activationDay === null || currentStep >= plan.length
    || (readiness !== 'rising' && readiness !== 'steady' && readiness !== 'strained')
    || (risk !== 'low' && risk !== 'moderate' && risk !== 'high')) return null;
  return { id, origin, title, objective, plan, currentStep, activationDay, readiness, risk };
}

function publicQuestHistory(value: unknown): PublicQuestHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const candidate = record(entry);
    const id = shortText(candidate?.id, 80);
    const questId = shortText(candidate?.questId, 80);
    const day = nonNegativeInteger(candidate?.day);
    const outcome = shortText(candidate?.outcome, 64);
    const text = shortText(candidate?.text, 1000);
    if (!id || day === null || !outcome || !text) return [];
    return [{ id, ...(questId ? { questId } : {}), day, outcome, text, publicNews: candidate?.publicNews === true }];
  });
}

function publicQuestArchive(value: unknown): PublicQuestArchive {
  const archive = record(value);
  const nextCursor = archive?.nextCursor === null ? null : shortText(archive?.nextCursor, 80);
  if (!archive || (archive.nextCursor !== null && !nextCursor) || !Array.isArray(archive.items)) {
    return { items: [], nextCursor: null };
  }
  const items: PublicQuestArchiveQuest[] = archive.items.flatMap((entry) => {
    const candidate = record(entry);
    const id = shortText(candidate?.id, 80);
    const origin = candidate?.origin;
    const title = shortText(candidate?.title, 240);
    const objective = shortText(candidate?.objective, 2000);
    const outcome = candidate?.outcome;
    const activationDay = nonNegativeInteger(candidate?.activationDay);
    const terminalDay = nonNegativeInteger(candidate?.terminalDay);
    const events = publicQuestHistory(candidate?.events);
    if (!id || (origin !== 'authored_milestone' && origin !== 'generated_successor') || !title || !objective
      || (outcome !== 'succeeded' && outcome !== 'failed' && outcome !== 'abandoned') || activationDay === null || terminalDay === null) return [];
    return [{ id, origin, title, objective, outcome, activationDay, terminalDay, events }];
  });
  return { items, nextCursor };
}

/**
 * Treat this projection as a narrow allow-list even though the RPC is owner
 * scoped. That keeps future internal settlement fields out of page data by
 * default and gives the UI one stable, player-safe vocabulary.
 */
function publicDisposition(value: unknown): PublicDisposition | null {
  const candidate = record(value);
  if (!candidate) return null;
  const summary = shortText(candidate.summary, 240);
  const state = shortText(candidate.state, 48);
  const version = shortText(candidate.version, 64);
  return summary && state && version ? { summary, state, version } : null;
}

function publicEvolution(value: unknown): PublicEvolutionEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const candidate = record(entry);
    const disposition = publicDisposition(candidate?.disposition);
    const day = nonNegativeInteger(candidate?.day);
    const profileRevision = nonNegativeInteger(candidate?.profileRevision, 1);
    const createdAt = shortText(candidate?.createdAt, 64);
    if (!disposition || day === null || profileRevision === null || !createdAt) return [];
    return [{ day, profileRevision, createdAt, disposition }];
  });
}


export async function getNpcHistory(client: SupabaseClient<Database>, options: {includeArchived?:boolean;archiveOnly?:boolean;requested?:string|null;historyCursor?:string|null}={}) {
 const rpc=client.rpc.bind(client) as any;
 const rawRoster:any[]=[];
 for(const name of options.archiveOnly?['npc_archived_roster']:options.includeArchived?['npc_roster','npc_archived_roster']:['npc_roster']) {
  let cursor:string|null=null;
  do {
   const result=await rpc(name,{p_limit:20,p_cursor:cursor,p_query:null});
   if(result.error)throw result.error;
   const page:any[]=Array.isArray(result.data)?result.data:[];
   rawRoster.push(...page);cursor=page.length===20?page.at(-1)?.instanceId??null:null;
  }while(cursor);
 }
 const residents:Patron[]=[...new Map(rawRoster.map(resident=>[resident.instanceId,resident])).values()].map(resident=>{
  const authoredArtwork = barResidentArtworkId(resident.name);
  return {...resident,sceneStorageKey:localScenePublicUrl(resident.sceneStorageKey??'',PUBLIC_SUPABASE_URL)
    || (authoredArtwork ? sceneRuntimeAssetPublicUrl(authoredArtwork,PUBLIC_SUPABASE_URL) : null)};
 });
 const journals:Record<string,Journal>={};
 const ids=residents.map(resident=>resident.instanceId);
 if(ids.length) {
  const result=await rpc('npc_journals',{p_instance_ids:ids});if(result.error)throw result.error;
      for (const [instanceId, raw] of Object.entries(result.data as Record<string, any>)) {
        const journal = raw as any;
        const lifecycle = questStatus(journal.questLifecycleStatus);
        journals[instanceId]={
          instanceId, npcId:journal.npcId, sequence:Number(journal.sequence ?? 0),
          availability:lifecycle === 'departed' ? 'departed' : ['active','between','failed','settled','abandoned'].includes(journal.status) ? 'present' : journal.status,
          questLifecycleStatus: lifecycle,
          currentQuest: currentQuest(journal.currentQuest),
          // This bounded event window lets the active quest explain recent setbacks.
          // Complete terminal history comes from the separately paged archive RPC.
          questHistory: publicQuestHistory(journal.questHistory),
          questArchive: { items: [], nextCursor: null },
          farewellText: shortText(journal.farewellText, 1000),
          turns:(journal.turns ?? []).map((turn:any)=>({id:turn.turnId, message:turn.keeper, reply:turn.npc, day:turn.day})),
          pending:journal.pending ? {turnId:journal.pending.turnId,status:journal.pending.status,message:journal.pending.message,error:journal.pending.error} : null,
          disposition: publicDisposition(journal.disposition),
          evolution: publicEvolution(journal.evolution)
        };
      }
      // Scene selection stays local while a conversation is pending. Preload
      // each journal's bounded archive so switching residents keeps its history.
      await Promise.all(Object.keys(journals).map(async (instanceId) => {
        const historyResult = await rpc('npc_quest_history_archive', {
          p_instance_id: instanceId,
          p_limit: 20,
          p_cursor: instanceId === options.requested ? options.historyCursor : null
        });
        if (historyResult.error) throw historyResult.error;
        journals[instanceId].questArchive = publicQuestArchive(historyResult.data);
      }));

 }
 const history=ids.length?await rpc('npc_hospitality_history',{p_instance_ids:ids}):{data:[]};
 if(history.error)throw history.error;
 return {residents,journals,hospitality:(history.data??[]) as ServeReceipt[]};
}
