import { error, fail, redirect } from '@sveltejs/kit';
import {
  advanceDay,
  completeBrew,
  GameServiceError,
  getSnapshot,
  startBrew
} from '$lib/server/game';
import type { Actions, PageServerLoad } from './$types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireUser(locals: App.Locals) {
  const user = await locals.getVerifiedUser();
  if (!user) redirect(303, '/login');
}

function integer(value: FormDataEntryValue | null): number {
  return Number(String(value ?? ''));
}

function expectedFailure(cause: unknown, fallback: string, pendingAction?: object) {
  if (cause instanceof GameServiceError) {
    return fail(cause.status, {
      message: cause.message,
      conflict: cause.status === 409,
      pendingAction: cause.status >= 500 ? pendingAction : undefined
    });
  }

  console.error(fallback, cause);
  return fail(500, { message: fallback, pendingAction });
}

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  await requireUser(locals);
  setHeaders({ 'cache-control': 'private, no-store' });

  try {
    return { snapshot: await getSnapshot(locals.supabase) };
  } catch (cause) {
    console.error('get_tavern_snapshot failed', cause);
    error(500, 'The brewery ledger is unavailable. Please try again.');
  }
};

export const actions: Actions = {
  start: async ({ request, locals }) => {
    await requireUser(locals);
    const data = await request.formData();
    const command = {
      saveId: String(data.get('saveId') ?? ''),
      ingredientBatchId: String(data.get('ingredientBatchId') ?? ''),
      actionId: String(data.get('actionId') ?? ''),
      expectedRevision: integer(data.get('expectedRevision'))
    };

    if (
      !UUID_PATTERN.test(command.saveId) ||
      !UUID_PATTERN.test(command.ingredientBatchId) ||
      !UUID_PATTERN.test(command.actionId) ||
      !Number.isSafeInteger(command.expectedRevision) ||
      command.expectedRevision < 0
    ) {
      return fail(400, { message: 'Choose an available ingredient before starting the brew.' });
    }

    try {
      await startBrew(locals.supabase, command);
      return { success: true, message: 'The wort is ready. Keep the stir in the sweet spot.' };
    } catch (cause) {
      return expectedFailure(cause, 'The brew could not be started.', command);
    }
  },

  complete: async ({ request, locals }) => {
    await requireUser(locals);
    const data = await request.formData();
    const command = {
      saveId: String(data.get('saveId') ?? ''),
      sessionId: String(data.get('sessionId') ?? ''),
      actionId: String(data.get('actionId') ?? ''),
      expectedRevision: integer(data.get('expectedRevision')),
      perfectTicks: integer(data.get('perfectTicks')),
      goodTicks: integer(data.get('goodTicks')),
      totalTicks: integer(data.get('totalTicks'))
    };

    if (
      !UUID_PATTERN.test(command.saveId) ||
      !UUID_PATTERN.test(command.sessionId) ||
      !UUID_PATTERN.test(command.actionId) ||
      !Number.isSafeInteger(command.expectedRevision) ||
      !Number.isSafeInteger(command.perfectTicks) ||
      !Number.isSafeInteger(command.goodTicks) ||
      !Number.isSafeInteger(command.totalTicks) ||
      command.expectedRevision < 0 ||
      command.perfectTicks < 0 ||
      command.goodTicks < 0 ||
      command.totalTicks < 0 ||
      command.totalTicks > 160 ||
      command.perfectTicks + command.goodTicks > command.totalTicks
    ) {
      return fail(400, { message: 'The stirring record was invalid.' });
    }

    try {
      const receipt = await completeBrew(locals.supabase, command);
      return {
        success: true,
        message: `${receipt.beverageName} bottled at ${receipt.qualityIndex + 1} of 7 quality.`,
        receipt
      };
    } catch (cause) {
      return expectedFailure(cause, 'The bottling outcome is unknown. Retry the same ledger entry.', command);
    }
  },

  advance: async ({ request, locals }) => {
    await requireUser(locals);
    const data = await request.formData();
    const command = {
      saveId: String(data.get('saveId') ?? ''),
      actionId: String(data.get('actionId') ?? ''),
      expectedRevision: integer(data.get('expectedRevision'))
    };

    if (
      !UUID_PATTERN.test(command.saveId) ||
      !UUID_PATTERN.test(command.actionId) ||
      !Number.isSafeInteger(command.expectedRevision) ||
      command.expectedRevision < 0
    ) {
      return fail(400, { message: 'The day transition was invalid.' });
    }

    try {
      const receipt = await advanceDay(locals.supabase, command);
      return { success: true, message: `Day ${receipt.newDay} begins.` };
    } catch (cause) {
      return expectedFailure(cause, 'The next tavern day could not begin.', command);
    }
  }
};
