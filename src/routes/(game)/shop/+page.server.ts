import { error, fail } from '@sveltejs/kit';
import { getSnapshot } from '$lib/server/game';
import { getGeneratedSupplies, purchaseGeneratedSupply, useGeneratedSupply } from '$lib/server/evolving-world/generated-supplies';
import {
  handleGardenCommand,
  handleGardenPreview,
  requireGameUser,
  SHOP_COMMAND_KINDS
} from '$lib/server/garden-form-actions';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  await requireGameUser(locals);
  setHeaders({ 'cache-control': 'private, no-store' });

  try {
    const snapshot = await getSnapshot(locals.supabase);
    if (!snapshot) return { snapshot, supplies: null };
    return { snapshot, supplies: await getGeneratedSupplies(locals.supabase, snapshot.save.id) };
  } catch (cause) {
    console.error('get_tavern_snapshot failed', cause);
    error(500, 'The shop ledger is unavailable. Please try again.');
  }
};

export const actions: Actions = {
  purchaseGeneratedSupply: async ({ request, locals }) => {
    await requireGameUser(locals);
    const data = await request.formData();
    const input = generatedSupplyInput(data, false);
    if (!input || input.quantity === null) return fail(400, { message:'That provision purchase was invalid.', error:true });
    try {
      await purchaseGeneratedSupply(locals.supabase, { ...input, quantity:input.quantity });
      return { message:'Provision purchased.', error:false };
    } catch (cause) { return fail(422, { message: cause instanceof Error ? cause.message : 'The provision purchase could not be completed.', error:true }); }
  },
  useGeneratedSupply: async ({ request, locals }) => {
    await requireGameUser(locals);
    const data = await request.formData();
    const input = generatedSupplyInput(data, true);
    if (!input || !input.questId) return fail(400, { message:'That provision use was invalid.', error:true });
    try {
      await useGeneratedSupply(locals.supabase, { saveId:input.saveId, actionId:input.actionId, expectedRevision:input.expectedRevision, itemKey:input.itemKey, questId:input.questId });
      return { message:'Provision prepared for the successor quest.', error:false };
    } catch (cause) { return fail(422, { message: cause instanceof Error ? cause.message : 'The provision could not be prepared.', error:true }); }
  },
  preview: async ({ request, locals }) => {
    await requireGameUser(locals);
    return handleGardenPreview(locals, await request.formData(), {
      allowedKinds: SHOP_COMMAND_KINDS,
      invalidMessage: 'That shop preview was invalid.',
      unavailableMessage: 'The shop preview is unavailable. Please try again.'
    });
  },

  command: async ({ request, locals }) => {
    await requireGameUser(locals);
    return handleGardenCommand(locals, await request.formData(), {
      allowedKinds: SHOP_COMMAND_KINDS,
      invalidMessage: 'That shop purchase was invalid.',
      unavailableMessage: 'The purchase outcome is unknown. Retry the same purchase to recover it.',
      successMessage: 'Purchase complete.'
    });
  }
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[a-z][a-z0-9-]{1,79}$/;
function generatedSupplyInput(data: FormData, requiresQuest: boolean) {
  const saveId = String(data.get('saveId') ?? '');
  const actionId = String(data.get('actionId') ?? '');
  const itemKey = String(data.get('itemKey') ?? '');
  const expectedRevision = Number(data.get('expectedRevision'));
  const questId = String(data.get('questId') ?? '');
  const quantity = requiresQuest ? null : Number(data.get('quantity') ?? 1);
  if (!UUID.test(saveId) || !UUID.test(actionId) || !KEY.test(itemKey) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || (!requiresQuest && (!Number.isSafeInteger(quantity) || quantity! < 1 || quantity! > 10)) || (requiresQuest && !UUID.test(questId))) return null;
  return { saveId, actionId, itemKey, expectedRevision, questId: requiresQuest ? questId : null, quantity };
}
