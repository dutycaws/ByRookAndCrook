import { error, fail, redirect } from '@sveltejs/kit';
import { getBarSnapshot, serveBeverage } from '$lib/server/serving';
import { GameServiceError } from '$lib/server/game';
import { dialogueAvailability } from '$lib/server/dialogue/runtime';
import { databaseError } from '$lib/server/dialogue/orchestrator';
import type { Journal } from '$lib/game/dialogue';
import type { Actions, PageServerLoad } from './$types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  if (!await locals.getVerifiedUser()) redirect(303, '/login');
  setHeaders({ 'cache-control': 'private, no-store' });
  try {
    const snapshot = await getBarSnapshot(locals.supabase);
    const journals: Record<string,Journal> = {};
    if(snapshot) for(const key of ['lira','torvin']) {
      const result=await locals.supabase.rpc('get_npc_journal',{p_patron:key});
      if(result.error)throw result.error;
      journals[key]=result.data as unknown as Journal;
    }
    return { snapshot, journals, dialogueUnavailable:dialogueAvailability() };
  } catch {
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
      saveId: String(data.get('saveId') ?? ''), patronKey: String(data.get('patronKey') ?? ''),
      beverageId: String(data.get('beverageId') ?? ''), cardId: String(data.get('cardId') ?? '') || null,
      actionId: String(data.get('actionId') ?? ''), expectedRevision: revision === '' ? NaN : Number(revision)
    };
    if (!uuid.test(command.saveId) || !uuid.test(command.beverageId) || !uuid.test(command.actionId) ||
      (command.cardId !== null && !uuid.test(command.cardId)) || !/^[a-z0-9-]{1,40}$/.test(command.patronKey) ||
      !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
      return fail(400, { message: 'Choose a patron and an available beverage.', retryable: false });
    }
    try {
      const receipt = await serveBeverage(locals.supabase, command);
      return { success: true, receipt, message: `Served ${receipt.beverageName} to ${receipt.patronName}. Earned ${receipt.goldEarned} gold.` };
    } catch (cause) {
      const status = cause instanceof GameServiceError ? cause.status : 500;
      return fail(status, {
        message: cause instanceof GameServiceError ? cause.message : 'The serving outcome is unknown. Retry the same pour.',
        retryable: status >= 500
      });
    }
  }
};
