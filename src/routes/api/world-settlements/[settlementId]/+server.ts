import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parsePublicSettlementStatus } from '$lib/game/evolving-world';
import { getBarSnapshot } from '$lib/server/serving';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_NO_STORE = { 'cache-control': 'private, no-store' };

/** Poll a single owner-visible settlement. The save comes from the verified
 * player's current bar snapshot, never from request input. */
export const GET: RequestHandler = async ({ locals, params }) => {
  if (!await locals.getVerifiedUser()) return json({ message: 'Please sign in.' }, { status: 401, headers: PRIVATE_NO_STORE });
  if (!UUID.test(params.settlementId)) return json({ message: 'Invalid overnight update.' }, { status: 400, headers: PRIVATE_NO_STORE });

  try {
    const snapshot = await getBarSnapshot(locals.supabase);
    if (!snapshot) return json({ message: 'No tavern is available.' }, { status: 404, headers: PRIVATE_NO_STORE });
    const rpc = locals.supabase.rpc.bind(locals.supabase) as any;
    const result = await rpc('world_settlement_status', {
      p_save_id: snapshot.save.id,
      p_settlement_id: params.settlementId
    });
    if (result.error) return json({ message: 'The overnight update is unavailable.' }, { status: 500, headers: PRIVATE_NO_STORE });
    const settlement = parsePublicSettlementStatus(result.data);
    if (!settlement) return json({ message: 'Overnight update not found.' }, { status: 404, headers: PRIVATE_NO_STORE });
    return json({ settlement }, { headers: PRIVATE_NO_STORE });
  } catch (cause) {
    console.error('world_settlement_status_failed', { settlementId: params.settlementId, cause: cause instanceof Error ? cause.name : 'unknown' });
    return json({ message: 'The overnight update is unavailable.' }, { status: 500, headers: PRIVATE_NO_STORE });
  }
};
