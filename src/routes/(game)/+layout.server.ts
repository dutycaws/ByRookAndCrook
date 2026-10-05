import { redirect } from '@sveltejs/kit';
import { communityContext } from '$lib/server/community-npc-workspace';
import { getTavernReports } from '$lib/server/tavern-reports';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  const user = await locals.getVerifiedUser();
  if (!user) redirect(303, '/login');

  const community = await communityContext(locals.supabase);
  const tavernReports = await getTavernReports(locals.supabase).catch(() => []);
  return { userId: user.id, userEmail: user.email ?? 'Tavern keeper', community, tavernReports, unreadCount:tavernReports.filter(report=>report.unread).length };
};
