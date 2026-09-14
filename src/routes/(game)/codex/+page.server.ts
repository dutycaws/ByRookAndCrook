import { error } from '@sveltejs/kit';
import { getSnapshot } from '$lib/server/game';
import { parsePublicWorldCodex } from '$lib/game/evolving-world';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  const user = await locals.getVerifiedUser();
  if (!user) error(401, 'Sign in to read the codex.');
  setHeaders({ 'cache-control': 'private, no-store' });

  try {
    const snapshot = await getSnapshot(locals.supabase);
    if (!snapshot) return { snapshot: null, codex: null };
    const rpc = locals.supabase.rpc.bind(locals.supabase) as any;
    const result = await rpc('world_public_codex', { p_save_id: snapshot.save.id });
    if (result.error) throw result.error;
    return { snapshot, codex: parsePublicWorldCodex(result.data) };
  } catch (cause) {
    console.error('world_public_codex_failed', { cause: cause instanceof Error ? cause.name : 'unknown' });
    error(500, 'The world codex is unavailable. Please try again.');
  }
};
