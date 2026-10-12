import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_NO_STORE = { 'cache-control': 'private, no-store' };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const POST: RequestHandler = async ({ locals, request, url }) => {
  if (request.headers.get('origin') !== url.origin) {
    return json({ message: 'Invalid request origin.' }, { status: 403, headers: PRIVATE_NO_STORE });
  }
  if (!await locals.getVerifiedUser()) {
    return json({ message: 'Please sign in.' }, { status: 401, headers: PRIVATE_NO_STORE });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 8_000) {
    return json({ message: 'Invalid keepsake swap.' }, { status: 413, headers: PRIVATE_NO_STORE });
  }

  let input: unknown;
  try {
    const body = await request.text();
    if (body.length > 8_000) return json({ message: 'Invalid keepsake swap.' }, { status: 413, headers: PRIVATE_NO_STORE });
    input = JSON.parse(body);
  } catch {
    return json({ message: 'Invalid keepsake swap.' }, { status: 400, headers: PRIVATE_NO_STORE });
  }

  if (!record(input) || !UUID.test(String(input.saveId ?? '')) || !UUID.test(String(input.trinketId ?? ''))
    || !UUID.test(String(input.actionId ?? '')) || !Number.isSafeInteger(input.expectedRevision)
    || Number(input.expectedRevision) < 0
    || !(input.targetSlot === null || Number.isSafeInteger(input.targetSlot)
      && Number(input.targetSlot) >= 0 && Number(input.targetSlot) <= 3)) {
    return json({ message: 'Invalid keepsake swap.' }, { status: 400, headers: PRIVATE_NO_STORE });
  }

  try {
    const rpc = locals.supabase.rpc.bind(locals.supabase) as any;
    const result = await rpc('npc_swap_trinket', {
      p_save_id: input.saveId,
      p_trinket_id: input.trinketId,
      p_target_slot: input.targetSlot,
      p_action_id: input.actionId,
      p_expected_revision: input.expectedRevision
    });
    if (result.error) {
      const status = ({ PT400: 400, PT401: 401, PT404: 404, PT409: 409, PT422: 422 } as Record<string, number>)[result.error.code] ?? 500;
      const message = status >= 500
        ? 'The keepsake arrangement could not be confirmed. Retry the same swap.'
        : result.error.message ?? 'The keepsake arrangement could not be changed.';
      return json({ message }, { status, headers: PRIVATE_NO_STORE });
    }
    return json({ receipt: result.data }, { headers: PRIVATE_NO_STORE });
  } catch {
    return json({ message: 'The keepsake arrangement could not be confirmed. Retry the same swap.' }, {
      status: 500,
      headers: PRIVATE_NO_STORE
    });
  }
};
