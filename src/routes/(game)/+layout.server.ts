import { redirect } from '@sveltejs/kit';
import { communityContext } from '$lib/server/community-npc-workspace';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  const user = await locals.getVerifiedUser();
  if (!user) redirect(303, '/login');

  const community = await communityContext(locals.supabase);
  return { userEmail: user.email ?? 'Tavern keeper', community };
};
