import { error, fail, redirect } from '@sveltejs/kit';
import { getBarSnapshot } from '$lib/server/serving';
import { advanceDay, GameServiceError } from '$lib/server/game';
import { dialogueAvailability } from '$lib/server/dialogue/runtime';
import { presentBarPatrons } from '$lib/game/bar-scene';
import { parsePublicSettlementStatus } from '$lib/game/evolving-world';
import { profileBurnStyle } from '$lib/card-effects';
import { getNpcHistory } from '$lib/server/npc-history';
import { dialogueRuntime } from '$lib/server/dialogue/runtime';
import { playerSuggestionStore, preparePlayerSuggestions } from '$lib/server/dialogue/player-suggestions';
import type { Journal } from '$lib/game/dialogue';
import type { Actions, PageServerLoad } from './$types';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const load: PageServerLoad = async ({locals,setHeaders,url})=>{
 const user=await locals.getVerifiedUser();
 if(!user)redirect(303,'/login');
 setHeaders({'cache-control':'private, no-store'});
 const requested=uuid.test(url.searchParams.get('npc')??'')?url.searchParams.get('npc'):null;
 const historyCursor=uuid.test(url.searchParams.get('questCursor')??'')?url.searchParams.get('questCursor'):null;
 try {
  const snapshot=await getBarSnapshot(locals.supabase);
  let settlement=null;
  const history=snapshot?await getNpcHistory(locals.supabase,{includeArchived:true,requested,historyCursor}):{residents:[],journals:{} as Record<string,Journal>,hospitality:[]};
  if(snapshot) {
   snapshot.roster=history.residents;
   snapshot.patrons=presentBarPatrons(history.residents,history.journals);
   snapshot.history=history.hospitality;
   try {const result=await (locals.supabase.rpc as any)('world_settlement_status',{p_save_id:snapshot.save.id,p_settlement_id:null});if(result.error)throw result.error;settlement=parsePublicSettlementStatus(result.data);}
   catch(cause){console.warn('bar_settlement_status_unavailable',{cause:cause instanceof Error?cause.name:'unknown'});}
  }
  return {snapshot,journals:history.journals,archived:url.searchParams.get('archive')==='1',selectedNpcInstanceId:requested,questArchiveCursor:historyCursor,dialogueUnavailable:dialogueAvailability(),settlement,cardBurnStyle:profileBurnStyle(user.user_metadata)};
 }catch(cause){console.error('bar_load_failed',cause);error(500,'The bar ledger is unavailable. Please try again.');}
};

export const actions: Actions = {
	open: async ({ locals, request }) => {
		if (!await locals.getVerifiedUser()) redirect(303, '/login');
		const data = await request.formData();
		const revision = Number(data.get('revision'));
		if (!data.has('revision') || !Number.isSafeInteger(revision) || revision < 0) return fail(400, { message: 'Invalid tavern opening.' });
		try {
			const result = await (locals.supabase.rpc as any)('daily_deck_open', { p_expected_revision: revision });
			if (result.error) throw new GameServiceError(result.error.message, 409, result.error.code ?? 'DAILY_DECK_OPEN');
			const dailyDeck = result.data?.dailyDeck ?? result.data;
			const generationId = dailyDeck?.generationId;
			if (typeof generationId === 'string') {
				let provider = null;
				try { provider = dialogueRuntime().provider; } catch { /* persisted fallback still opens service */ }
				await preparePlayerSuggestions(playerSuggestionStore(locals.supabase as any), generationId, provider, 12_000);
			}
			return { success: true, message: 'The doors open and your prepared hand is ready.' };
		} catch (cause) {
			const message = cause instanceof GameServiceError ? cause.message : 'The tavern could not open. Please try again.';
			return fail(cause instanceof GameServiceError ? cause.status : 500, { message });
		}
	},
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
  }
};
