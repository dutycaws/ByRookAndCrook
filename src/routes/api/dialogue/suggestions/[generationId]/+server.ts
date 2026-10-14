import { json } from '@sveltejs/kit';
import { dialogueRuntime } from '$lib/server/dialogue/runtime';
import { playerSuggestionStore, preparePlayerSuggestions } from '$lib/server/dialogue/player-suggestions';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
  const store=playerSuggestionStore(locals.supabase as any);
  try { return json(await store.get(params.generationId),{headers:{'cache-control':'private, no-store'}}); }
  catch { return json({message:'Player suggestions are unavailable.'},{status:503}); }
};

/** Opening invokes this once; repeated calls simply return the persisted batch. */
export const POST: RequestHandler = async ({ locals, params }) => {
  try {
    // A missing provider must finish the bounded opening path with stored,
    // editable fallbacks instead of leaving the tavern unable to open.
    let provider;
    try { provider=dialogueRuntime().provider; }
    catch { provider=null; }
    return json(await preparePlayerSuggestions(playerSuggestionStore(locals.supabase as any),params.generationId,provider),{headers:{'cache-control':'private, no-store'}});
  } catch { return json({message:'Player suggestions are unavailable.'},{status:503}); }
};
