import { error } from '@sveltejs/kit'; import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, params }) => { const r = await locals.supabase.rpc('npc_share_view', { p_token: params.token }); if (r.error || !r.data) error(404, 'This immutable share is unavailable.'); return { share: r.data as any }; };
