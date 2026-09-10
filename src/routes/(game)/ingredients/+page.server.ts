import { error, redirect } from '@sveltejs/kit';
import { getSnapshot } from '$lib/server/game';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  const user = await locals.getVerifiedUser();
  if (!user) redirect(303, '/login');
  setHeaders({ 'cache-control': 'private, no-store' });

  try {
    return { snapshot: await getSnapshot(locals.supabase) };
  } catch (cause) {
    console.error('get_tavern_snapshot failed', cause);
    error(500, 'The ingredient ledger is unavailable. Please try again.');
  }
};
