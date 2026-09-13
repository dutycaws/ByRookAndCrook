import { error, fail, redirect } from '@sveltejs/kit';
import { getBarSnapshot, serveHospitality } from '$lib/server/serving';
import { GameServiceError } from '$lib/server/game';
import { dialogueAvailability } from '$lib/server/dialogue/runtime';
import { databaseError } from '$lib/server/dialogue/orchestrator';
import { localScenePublicUrl } from '$lib/server/community-npc-jobs/local-assets';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import type { Journal } from '$lib/game/dialogue';
import type { Actions, PageServerLoad } from './$types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ locals, setHeaders, url }) => {
  if (!await locals.getVerifiedUser()) redirect(303, '/login');
  setHeaders({ 'cache-control': 'private, no-store' });
  try {
    const snapshot = await getBarSnapshot(locals.supabase);
    const journals: Record<string,Journal> = {};
    if(snapshot) {
      const rpc = locals.supabase.rpc.bind(locals.supabase) as any;
      const requested = uuid.test(url.searchParams.get('npc') ?? '') ? url.searchParams.get('npc')! : null;
      const archived = url.searchParams.get('archive') === '1';
      const rosterResult = await rpc(archived ? 'npc_archived_roster' : 'npc_roster', { p_limit: 20, p_cursor: null, p_query: null });
      if (rosterResult.error) throw rosterResult.error;
      const roster = (Array.isArray(rosterResult.data) ? rosterResult.data : []).map((resident: any) => ({
        ...resident, sceneStorageKey: localScenePublicUrl(resident.sceneStorageKey ?? '', PUBLIC_SUPABASE_URL)
      }));
      if (requested && !roster.some((resident: any) => resident.instanceId === requested)) {
        const selected = await rpc(archived ? 'npc_archived_resident' : 'npc_resident', { p_instance: requested });
        if (!selected.error && selected.data) roster.unshift({ ...selected.data, sceneStorageKey: localScenePublicUrl(selected.data.sceneStorageKey ?? '', PUBLIC_SUPABASE_URL) });
      }
      snapshot.roster = roster as typeof snapshot.roster;
      const selectedInstanceId = requested && roster.some((resident: any) => resident.instanceId === requested)
        ? requested : roster[0]?.instanceId;
      if(selectedInstanceId) {
        const result=await rpc('npc_journals',{p_instance_ids:[selectedInstanceId]});
      if(result.error)throw result.error;
      for (const [instanceId, raw] of Object.entries(result.data as Record<string, any>)) {
        const journal = raw as any;
        journals[instanceId]={
          instanceId, npcId:journal.npcId, sequence:Number(journal.sequence ?? 0),
          availability:['active','between','failed','settled','abandoned'].includes(journal.status)?'present':journal.status,
          intention:journal.campaign?.activePlan ? { goal:journal.currentMilestone?.objective ?? 'Current intention', motivation:journal.currentMilestone?.motivation ?? '', targets:journal.currentMilestone?.allowedTargets ?? [], steps:journal.campaign.activePlan } : null,
          questStatus:journal.status, preparation:Number(journal.campaign?.preparation ?? 0), nextStep:Number(journal.campaign?.step ?? 0), risk:journal.risk ?? 'none', warning:null,
          turns:(journal.turns ?? []).map((turn:any)=>({id:turn.turnId, message:turn.keeper, reply:turn.npc, day:turn.day})),
          events:(journal.events ?? []).map((event:any)=>({id:event.id,text:event.text,outcome:event.outcome,day:event.day,publicNews:event.publicNews})),
          pending:journal.pending ? {turnId:journal.pending.turnId,status:journal.pending.status,message:journal.pending.message,error:journal.pending.error} : null
        };
      }
      }
    }
    return { snapshot, journals, archived: url.searchParams.get('archive') === '1', selectedNpcInstanceId: uuid.test(url.searchParams.get('npc') ?? '') ? url.searchParams.get('npc') : null, dialogueUnavailable:dialogueAvailability() };
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
    const r=await locals.supabase.rpc('advance_tavern_day',{p_save_id:save,p_action_id:action,p_expected_revision:revision});
    if(r.error){const e=databaseError(r.error);return fail(e.status,{message:e.message});}
    return {success:true,message:'The tavern is closed. A new day begins; the journal records what happened overnight.'};
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
