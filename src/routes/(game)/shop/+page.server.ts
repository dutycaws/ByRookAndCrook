import { error } from '@sveltejs/kit';
import { getSnapshot } from '$lib/server/game';
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
    return { snapshot: await getSnapshot(locals.supabase) };
  } catch (cause) {
    console.error('get_tavern_snapshot failed', cause);
    error(500, 'The shop ledger is unavailable. Please try again.');
  }
};

export const actions: Actions = {
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
