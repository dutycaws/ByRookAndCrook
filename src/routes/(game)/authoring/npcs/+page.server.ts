import { fail, redirect } from '@sveltejs/kit';
import { createNpcSheet } from '$lib/game/community-npc-ui';
import { communityContext, requireCapability } from '$lib/server/community-npc-workspace';
import type { Actions, PageServerLoad } from './$types';
import type { Json } from '$lib/database.types';

export const load: PageServerLoad = async ({ locals }) => {
  const community = await communityContext(locals.supabase); requireCapability(community, 'npc_author');
  const [workspace, analytics] = await Promise.all([locals.supabase.rpc('npc_author_workspace'), locals.supabase.rpc('npc_author_analytics')]);
  if (workspace.error || analytics.error) throw new Error(workspace.error?.message ?? analytics.error?.message);
  return { community, workspace: (workspace.data ?? []) as any[], analytics: analytics.data as any };
};
export const actions: Actions = { create: async ({ locals, request }) => {
  const community = await communityContext(locals.supabase); requireCapability(community, 'npc_author');
  const form = await request.formData();
  const name = String(form.get('name') ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 80) return fail(400, { message: 'Choose a name between 1 and 80 characters.' });
  const { data, error } = await locals.supabase.rpc('npc_author_create', { p_sheet: createNpcSheet(name) as unknown as Json });
  if (error) return fail(400, { message: error.message });
  redirect(303, `/authoring/npcs/${(data as { npcId: string }).npcId}`);
} };
