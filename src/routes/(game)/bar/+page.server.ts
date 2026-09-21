import { error, fail, redirect } from '@sveltejs/kit';
import { getBarSnapshot, serveHospitality } from '$lib/server/serving';
import { advanceDay } from '$lib/server/game';
import { GameServiceError } from '$lib/server/game';
import { dialogueAvailability } from '$lib/server/dialogue/runtime';
import { localScenePublicUrl } from '$lib/server/community-npc-jobs/local-assets';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { presentBarPatrons } from '$lib/game/bar-scene';
import { parsePublicSettlementStatus } from '$lib/game/evolving-world';
import type { ActionKind, Approach, CurrentQuest, Journal, PublicDisposition, PublicEvolutionEntry, PublicQuestArchive, PublicQuestArchiveQuest, PublicQuestHistoryEntry, QuestLifecycleStatus } from '$lib/game/dialogue';
import type { Actions, PageServerLoad } from './$types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const day = nonNegativeInteger(candidate?.day);
    const outcome = shortText(candidate?.outcome, 64);
    const text = shortText(candidate?.text, 1000);
    if (!id || day === null || !outcome || !text) return [];
    return [{ id, day, outcome, text, publicNews: candidate?.publicNews === true }];
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
  return value.slice(0, 6).flatMap((entry) => {
    const candidate = record(entry);
    const disposition = publicDisposition(candidate?.disposition);
    const day = nonNegativeInteger(candidate?.day);
    const profileRevision = nonNegativeInteger(candidate?.profileRevision, 1);
    const createdAt = shortText(candidate?.createdAt, 64);
    if (!disposition || day === null || profileRevision === null || !createdAt) return [];
    return [{ day, profileRevision, createdAt, disposition }];
  });
}

export const load: PageServerLoad = async ({ locals, setHeaders, url }) => {
  if (!await locals.getVerifiedUser()) redirect(303, '/login');
  setHeaders({ 'cache-control': 'private, no-store' });
  const requested = uuid.test(url.searchParams.get('npc') ?? '') ? url.searchParams.get('npc')! : null;
  const historyCursor = uuid.test(url.searchParams.get('questCursor') ?? '') ? url.searchParams.get('questCursor')! : null;
  try {
    const snapshot = await getBarSnapshot(locals.supabase);
    let settlement = null;
    const journals: Record<string,Journal> = {};
    if(snapshot) {
      const rpc = locals.supabase.rpc.bind(locals.supabase) as any;
      try {
        const settlementResult = await rpc('world_settlement_status', { p_save_id: snapshot.save.id, p_settlement_id: null });
        if (settlementResult.error) throw settlementResult.error;
        settlement = parsePublicSettlementStatus(settlementResult.data);
      } catch (cause) {
        // Settlement status is an optional player interlude. The core bar and
        // journal remain usable if that projection is temporarily unavailable.
        console.warn('bar_settlement_status_unavailable', { cause: cause instanceof Error ? cause.name : 'unknown' });
      }
      const archived = url.searchParams.get('archive') === '1';
      const rosterFunction = archived ? 'npc_archived_roster' : 'npc_roster';
      const rawRoster: any[] = [];
      let cursor: string | null = null;
      do {
        const rosterResult: { data: unknown; error: { message?: string } | null } = await rpc(rosterFunction, { p_limit: 20, p_cursor: cursor, p_query: null });
        if (rosterResult.error) throw rosterResult.error;
        const page: any[] = Array.isArray(rosterResult.data) ? rosterResult.data : [];
        rawRoster.push(...page);
        // The RPC uses an instance UUID cursor and clamps each page to twenty.
        // Stop on a short page rather than guessing a total roster count.
        cursor = page.length === 20 ? page.at(-1)?.instanceId ?? null : null;
      } while (cursor);
      const roster = rawRoster.map((resident: any) => ({
        ...resident, sceneStorageKey: localScenePublicUrl(resident.sceneStorageKey ?? '', PUBLIC_SUPABASE_URL)
      }));
      if (requested && !roster.some((resident: any) => resident.instanceId === requested)) {
        const selected = await rpc(archived ? 'npc_archived_resident' : 'npc_resident', { p_instance: requested });
        if (!selected.error && selected.data) roster.unshift({ ...selected.data, sceneStorageKey: localScenePublicUrl(selected.data.sceneStorageKey ?? '', PUBLIC_SUPABASE_URL) });
      }
      snapshot.roster = roster as typeof snapshot.roster;
      const instanceIds = roster.map((resident: any) => resident.instanceId);
      const historyInstanceId = requested ?? roster[0]?.instanceId ?? null;
      if (instanceIds.length) {
        const result=await rpc('npc_journals',{p_instance_ids: instanceIds});
      if(result.error)throw result.error;
      for (const [instanceId, raw] of Object.entries(result.data as Record<string, any>)) {
        const journal = raw as any;
        const lifecycle = questStatus(journal.questLifecycleStatus);
        journals[instanceId]={
          instanceId, npcId:journal.npcId, sequence:Number(journal.sequence ?? 0),
          availability:lifecycle === 'departed' ? 'departed' : ['active','between','failed','settled','abandoned'].includes(journal.status) ? 'present' : journal.status,
          questLifecycleStatus: lifecycle,
          currentQuest: currentQuest(journal.currentQuest),
          // Archive pages come from the separately paged RPC below. Never
          // display the compact journal's legacy event window as history.
          questHistory: [],
          questArchive: { items: [], nextCursor: null },
          farewellText: shortText(journal.farewellText, 1000),
          turns:(journal.turns ?? []).map((turn:any)=>({id:turn.turnId, message:turn.keeper, reply:turn.npc, day:turn.day})),
          pending:journal.pending ? {turnId:journal.pending.turnId,status:journal.pending.status,message:journal.pending.message,error:journal.pending.error} : null,
          disposition: publicDisposition(journal.disposition),
          evolution: publicEvolution(journal.evolution)
        };
      }
      if (historyInstanceId && journals[historyInstanceId]) {
        const historyResult = await rpc('npc_quest_history_archive', {
          p_instance_id: historyInstanceId,
          p_limit: 20,
          p_cursor: historyCursor
        });
        if (historyResult.error) throw historyResult.error;
        journals[historyInstanceId].questArchive = publicQuestArchive(historyResult.data);
      }
      }
      // The roster is a bounded browse projection.  The illustrated room may
      // only show residents whose authoritative journal says they are present.
      // Keep roster intact for the archive/safety tools, but make the smaller
      // presentation list explicit so the client never guesses availability.
      snapshot.patrons = presentBarPatrons(roster, journals) as typeof snapshot.patrons;
    }
    return { snapshot, settlement, journals, archived: url.searchParams.get('archive') === '1', selectedNpcInstanceId: requested, questArchiveCursor: historyCursor, dialogueUnavailable:dialogueAvailability() };
  } catch (cause) {
    console.error('bar_load_failed', cause);
    error(500, 'The bar ledger is unavailable. Please try again.');
  }
};

export const actions: Actions = {
  close: async({locals,request})=>{
    if(!await locals.getVerifiedUser())redirect(303,'/login');
    const data=await request.formData();
    const action=String(data.get('actionId')??''); const save=String(data.get('saveId')??'');
    const revision=Number(data.get('revision'));
    if(!uuid.test(action)||!uuid.test(save)||!data.has('revision')||!Number.isSafeInteger(revision)||revision<0)return fail(400,{message:'Invalid day transition.'});
    try {
      const receipt = await advanceDay(locals.supabase, { saveId:save, actionId:action, expectedRevision:revision });
      if (receipt.worldSettlement) {
        return { success:true, receipt, message:'The tavern is closed. Overnight settlement is underway; the journal will update when it completes.' };
      }
      return { success:true, receipt, message:'The tavern is closed. A new day begins; the journal records what happened overnight.' };
    } catch (cause) {
      const message = cause instanceof GameServiceError ? cause.message : 'The tavern ledger is unavailable. Please retry the same close.';
      const status = cause instanceof GameServiceError ? cause.status : 500;
      return fail(status, { message });
    }
  },
  serve: async ({ locals, request }) => {
    if (!await locals.getVerifiedUser()) redirect(303, '/login');
    const data = await request.formData();
    const revision = String(data.get('expectedRevision') ?? '');
    const command = {
      saveId: String(data.get('saveId') ?? ''), instanceId: String(data.get('instanceId') ?? ''),
      itemKind: String(data.get('itemKind') ?? '') as 'food' | 'beverage',
      itemId: String(data.get('itemId') ?? ''),
      actionId: String(data.get('actionId') ?? ''), expectedRevision: revision === '' ? NaN : Number(revision)
    };
    if (!uuid.test(command.saveId) || !uuid.test(command.itemId) || !uuid.test(command.actionId) ||
      !['food', 'beverage'].includes(command.itemKind) ||
      !uuid.test(command.instanceId) ||
      !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
      return fail(400, { message: 'Choose a patron and an available food or drink.', retryable: false });
    }
    try {
      const receipt = await serveHospitality(locals.supabase, command);
      return { success: true, receipt, message: `Served ${receipt.itemName}. Earned ${receipt.goldEarned} gold.` };
    } catch (cause) {
      const status = cause instanceof GameServiceError ? cause.status : 500;
      return fail(status, {
        message: cause instanceof GameServiceError ? cause.message : 'The serving outcome is unknown. Retry the same pour.',
        retryable: status >= 500
      });
    }
  }
};
