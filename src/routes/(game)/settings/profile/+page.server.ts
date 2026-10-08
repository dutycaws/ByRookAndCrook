import { fail } from '@sveltejs/kit';
import { communityContext } from '$lib/server/community-npc-workspace';
import { clearProjectionCache } from '$lib/server/npc-memory/projection-cache';
import { requireGameUser } from '$lib/server/garden-form-actions';
import { profileBurnStyle, resolveBurnStyle } from '$lib/card-effects';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  const user = await requireGameUser(locals);
  setHeaders({ 'cache-control': 'private, no-store' });
  return {
    community: await communityContext(locals.supabase),
    cardBurnStyle: profileBurnStyle(user.user_metadata)
  };
};

export const actions: Actions = {
  saveCardEffects: async ({ locals, request }) => {
    await requireGameUser(locals);
    const data = await request.formData();
    const cardBurnStyle = resolveBurnStyle(data.get('cardBurnStyle'));
    if (!cardBurnStyle) return fail(400, { cardEffectsError: 'Choose a valid card burn effect.' });

    const { error } = await locals.supabase.auth.updateUser({ data: { card_burn_style: cardBurnStyle } });
    if (error) return fail(400, { cardEffectsError: 'Your card effects could not be saved. Please try again.', cardBurnStyle });
    return { cardEffectsMessage: 'Card effects saved.', cardBurnStyle };
  },
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
    if (!result.error && !mature && wasMature) clearProjectionCache();
    return result.error
      ? fail(400, { message: result.error.message })
      : { message: mature || !wasMature ? 'Community profile updated.' : 'Community profile updated and mature NPC stories were removed from this tavern.' };
  }
};
