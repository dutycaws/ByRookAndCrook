import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { localScenePublicUrl } from '$lib/server/community-npc-jobs/local-assets';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!await locals.getVerifiedUser()) return json({ message: 'Please sign in.' }, { status: 401 });
  const cursor = url.searchParams.get('cursor');
  const query = url.searchParams.get('q')?.trim().slice(0, 80) || null;
  const archived = url.searchParams.get('archive') === '1';
  if (cursor && !uuid.test(cursor)) return json({ message: 'Invalid roster cursor.' }, { status: 400 });
  const rpc = locals.supabase.rpc.bind(locals.supabase) as any;
  const result = await rpc(archived ? 'npc_archived_roster' : 'npc_roster', { p_limit: 20, p_cursor: cursor || null, p_query: query });
  if (result.error) return json({ message: 'The guest ledger is unavailable.' }, { status: 500 });
  const residents = (Array.isArray(result.data) ? result.data : []).map((resident: any) => ({
    ...resident, sceneStorageKey: localScenePublicUrl(resident.sceneStorageKey ?? '', PUBLIC_SUPABASE_URL)
  }));
  return json({ residents, nextCursor: residents.length === 20 ? residents.at(-1)?.instanceId ?? null : null }, {
    headers: { 'cache-control': 'private, no-store' }
  });
};
