import { fail } from '@sveltejs/kit';
import { communityContext } from '$lib/server/community-npc-workspace';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({ community: await communityContext(locals.supabase) });

export const actions: Actions = {
  save: async ({ locals, request }) => {
    const community = await communityContext(locals.supabase);
    const data = await request.formData();
    const mature = data.get('mature') === 'on';
    const wasMature = community.profile.matureEnabled === true;
    if (mature && !wasMature && data.get('confirmMature') !== 'on') {
      return fail(400, { message: 'Confirm the mature-content summary before enabling mature community NPCs.' });
    }
    const result = await locals.supabase.rpc('npc_update_community_settings' as never, {
      p_display_name: String(data.get('displayName')),
      p_bio: String(data.get('bio')),
      p_mature: mature,
      p_attest_adult: data.get('attest') === 'on',
      p_creator_terms: data.get('terms') === 'on'
    } as never);
    return result.error
      ? fail(400, { message: result.error.message })
      : { message: mature || !wasMature ? 'Community profile updated.' : 'Community profile updated and mature NPC stories were removed from this tavern.' };
  }
};
