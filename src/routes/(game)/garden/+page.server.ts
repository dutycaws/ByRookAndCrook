import { error, fail, redirect } from '@sveltejs/kit';
import {
  commitGardenCommand,
  createTavern,
  GameServiceError,
  getSnapshot,
  harvestCrop,
  previewGardenCommand
} from '$lib/server/game';
import type { GardenCommandKind, GardenCommandPayload } from '$lib/game/contracts';
import type { Actions, PageServerLoad } from './$types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GARDEN_COMMAND_KINDS = new Set<GardenCommandKind>([
  'plant',
  'move',
  'remove',
  'water',
  'amend',
  'incorporate_clover',
  'compost_ingredient',
  'purchase',
  'expand'
]);

async function requireUser(locals: App.Locals) {
  const user = await locals.getVerifiedUser();
  if (!user) redirect(303, '/login');
  return user;
}

function parseGardenCommandInput(data: FormData) {
  const commandKind = String(data.get('commandKind') ?? '') as GardenCommandKind;
  const payloadText = String(data.get('payload') ?? '');
  let payload: GardenCommandPayload;
  try {
    const parsed: unknown = JSON.parse(payloadText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    payload = parsed as GardenCommandPayload;
  } catch {
    return null;
  }
  if (!GARDEN_COMMAND_KINDS.has(commandKind)) return null;
  return { commandKind, payload };
}

function gardenFailure(cause: unknown, fallback: string, pendingAction?: object) {
  if (cause instanceof GameServiceError) {
    return fail(cause.status, {
      message: cause.message,
      pendingAction: cause.status >= 500 ? pendingAction : undefined,
      conflict: cause.status === 409
    });
  }
  console.error('garden command failed', cause);
  return fail(500, { message: fallback, pendingAction });
}

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  await requireUser(locals);
  setHeaders({ 'cache-control': 'private, no-store' });

  try {
    return { snapshot: await getSnapshot(locals.supabase) };
  } catch (cause) {
    console.error('get_tavern_snapshot failed', cause);
    error(500, 'The garden ledger is unavailable. Please try again.');
  }
};

export const actions: Actions = {
  create: async ({ locals }) => {
    await requireUser(locals);

    try {
      await createTavern(locals.supabase);
      return { success: true, message: 'Your tavern garden is ready.' };
    } catch (cause) {
      console.error('create_tavern failed', cause);
      return fail(500, { message: 'The starter garden could not be created.' });
    }
  },

  preview: async ({ request, locals }) => {
    await requireUser(locals);
    const parsed = parseGardenCommandInput(await request.formData());
    if (!parsed) return fail(400, { message: 'The garden preview request was invalid.' });

    try {
      const preview = await previewGardenCommand(locals.supabase, parsed.commandKind, parsed.payload);
      return { success: true, preview };
    } catch (cause) {
      return gardenFailure(cause, 'The garden preview is unavailable. Please try again.');
    }
  },

  command: async ({ request, locals }) => {
    await requireUser(locals);
    const data = await request.formData();
    const parsed = parseGardenCommandInput(data);
    const saveId = String(data.get('saveId') ?? '');
    const actionId = String(data.get('actionId') ?? '');
    const expectedRevision = Number(String(data.get('expectedRevision') ?? ''));
    if (
      !parsed ||
      !UUID_PATTERN.test(saveId) ||
      !UUID_PATTERN.test(actionId) ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      return fail(400, { message: 'The garden command was invalid.' });
    }

    const pendingAction = { saveId, actionId, expectedRevision, ...parsed };
    try {
      const receipt = await commitGardenCommand(locals.supabase, pendingAction);
      return { success: true, message: 'The garden ledger has been updated.', receipt };
    } catch (cause) {
      return gardenFailure(
        cause,
        'The garden outcome is unknown. Retry the same action to recover it.',
        pendingAction
      );
    }
  },

  harvest: async ({ request, locals }) => {
    await requireUser(locals);
    const data = await request.formData();
    const saveId = String(data.get('saveId') ?? '');
    const cellId = String(data.get('cellId') ?? '');
    const actionId = String(data.get('actionId') ?? '');
    const revisionText = String(data.get('expectedRevision') ?? '');
    const expectedRevision = Number(revisionText);

    const pendingAction = { saveId, cellId, actionId, expectedRevision };
    if (
      !UUID_PATTERN.test(saveId) ||
      !UUID_PATTERN.test(cellId) ||
      !UUID_PATTERN.test(actionId) ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      return fail(400, { message: 'The harvest request was invalid.', pendingAction });
    }

    try {
      const receipt = await harvestCrop(locals.supabase, pendingAction);
      return {
        success: true,
        message: `Harvested ${receipt.quantity} ingredient${receipt.quantity === 1 ? '' : 's'}.`,
        receipt
      };
    } catch (cause) {
      if (cause instanceof GameServiceError) {
        return fail(cause.status, {
          message: cause.message,
          pendingAction: cause.status >= 500 ? pendingAction : undefined,
          conflict: cause.status === 409
        });
      }

      console.error('harvest action failed', cause);
      return fail(500, {
        message: 'The harvest outcome is unknown. Retry the same request.',
        pendingAction
      });
    }
  },

  signout: async ({ locals }) => {
    const { error: signOutError } = await locals.supabase.auth.signOut({ scope: 'local' });
    if (signOutError) return fail(500, { message: 'Sign out failed. Please try again.' });
    redirect(303, '/login');
  }
};
