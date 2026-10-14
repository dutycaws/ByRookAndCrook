import { error, fail } from '@sveltejs/kit';
import { GameServiceError, getSnapshot, purchaseForgetfulness, useForgetfulness } from '$lib/server/game';
import { getGeneratedSupplies, purchaseGeneratedSupply } from '$lib/server/evolving-world/generated-supplies';
import {
  handleGardenCommand,
  handleGardenPreview,
  requireGameUser,
  SHOP_COMMAND_KINDS
} from '$lib/server/garden-form-actions';
import type { Actions, PageServerLoad } from './$types';
import { profileBurnStyle } from '$lib/card-effects';

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  const user = await requireGameUser(locals);
  const cardBurnStyle = profileBurnStyle(user.user_metadata);
  setHeaders({ 'cache-control': 'private, no-store' });

  try {
    const snapshot = await getSnapshot(locals.supabase);
    if (!snapshot) return { snapshot, supplies: null, cardBurnStyle };
    return { snapshot, supplies: await getGeneratedSupplies(locals.supabase, snapshot.save.id), cardBurnStyle };
  } catch (cause) {
    console.error('get_tavern_snapshot failed', cause);
    error(500, 'The shop ledger is unavailable. Please try again.');
  }
};

export const actions: Actions = {
  purchaseForgetfulness: async ({ request, locals }) => {
    await requireGameUser(locals);
    const data = await request.formData();
    const actionId = String(data.get('actionId') ?? '');
    const expectedRevision = Number(data.get('expectedRevision'));
    if (!UUID.test(actionId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return fail(400, { message: 'The potion purchase was invalid.', error: true });
    }
    try {
      const receipt = await purchaseForgetfulness(locals.supabase, { actionId, expectedRevision });
      return { success: true, error: false, message: `Potion of Forgetfulness purchased for ${receipt.price} gold.`, receipt };
    } catch (cause) {
      if (cause instanceof GameServiceError) return fail(cause.status, { message: cause.message, error: true });
      console.error('forgetfulness purchase failed', cause);
      return fail(500, { message: 'The potion purchase outcome is unknown. Retry the same purchase to recover it.', error: true });
    }
  },

  forgetfulness: async ({ request, locals }) => {
    await requireGameUser(locals);
    const data = await request.formData();
    const actionId = String(data.get('actionId') ?? '');
    const cardId = String(data.get('cardId') ?? '');
    const expectedRevision = Number(data.get('expectedRevision'));
    if (!UUID.test(actionId) || !UUID.test(cardId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return fail(400, { message: 'Choose a social copy before using the potion.', error: true });
    }
    try {
      const receipt = await useForgetfulness(locals.supabase, { actionId, cardId, expectedRevision });
      const card = receipt.dailyDeck.cards.find((candidate) => candidate.id === receipt.cardId);
      return { success: true, error: false, message: `${card?.displayName ?? 'That social'} copy will leave tomorrow's deck.`, receipt };
    } catch (cause) {
      if (cause instanceof GameServiceError) return fail(cause.status, { message: cause.message, error: true });
      console.error('forgetfulness action failed', cause);
      return fail(500, { message: 'The potion outcome is unknown. Retry the same use to recover it.', error: true });
    }
  },

  purchaseGeneratedSupply: async ({ request, locals }) => {
    await requireGameUser(locals);
    const data = await request.formData();
    const input = generatedSupplyInput(data);
    if (!input || input.quantity === null) return fail(400, { message:'That provision purchase was invalid.', error:true });
    try {
      await purchaseGeneratedSupply(locals.supabase, { ...input, quantity:input.quantity });
      return { message:'Provision purchased.', error:false };
    } catch (cause) { return fail(422, { message: cause instanceof Error ? cause.message : 'The provision purchase could not be completed.', error:true }); }
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
function generatedSupplyInput(data: FormData) {
  const saveId = String(data.get('saveId') ?? '');
  const actionId = String(data.get('actionId') ?? '');
  const itemKey = String(data.get('itemKey') ?? '');
  const expectedRevision = Number(data.get('expectedRevision'));
  const quantity = Number(data.get('quantity') ?? 1);
  if (!UUID.test(saveId) || !UUID.test(actionId) || !KEY.test(itemKey) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) return null;
  return { saveId, actionId, itemKey, expectedRevision, quantity };
}
