import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!await locals.getVerifiedUser()) return json({ message: 'Please sign in.' }, { status: 401 });
  if (!uuid.test(params.instanceId)) return json({ message: 'Invalid guest.' }, { status: 400 });
  const rpc = locals.supabase.rpc.bind(locals.supabase) as any;
  const result = await rpc('npc_journals', { p_instance_ids: [params.instanceId] });
  if (result.error) return json({ message: 'The guest journal is unavailable.' }, { status: 500 });
  const journal = result.data?.[params.instanceId];
  if (!journal) return json({ message: 'Guest not found.' }, { status: 404 });
  return json({ journal }, { headers: { 'cache-control': 'private, no-store' } });
};
