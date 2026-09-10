import { error, fail, redirect } from '@sveltejs/kit';
import {
  advanceDay,
  beginBakeOven,
  completeBake,
  foldBake,
  GameServiceError,
  getSnapshot,
  scoreBake,
  startBake
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

function validBase(command: { saveId: string; actionId: string; expectedRevision: number }) {
  return UUID_PATTERN.test(command.saveId)
    && UUID_PATTERN.test(command.actionId)
    && Number.isSafeInteger(command.expectedRevision)
    && command.expectedRevision >= 0;
}

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  await requireUser(locals);
  setHeaders({ 'cache-control': 'private, no-store' });
  try {
    return { snapshot: await getSnapshot(locals.supabase) };
  } catch (cause) {
    console.error('get_tavern_snapshot failed', cause);
    error(500, 'The bakery ledger is unavailable. Please try again.');
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
    if (!validBase(command) || !UUID_PATTERN.test(command.ingredientBatchId)) {
      return fail(400, { message: 'Choose an available ingredient before starting the loaf.' });
    }
    try {
      await startBake(locals.supabase, command);
      return { success: true, message: 'The dough is mixed. Fold it six times.' };
    } catch (cause) {
      return expectedFailure(cause, 'The bake could not be started.', command);
    }
  },

  fold: async ({ request, locals }) => {
    await requireUser(locals);
    const data = await request.formData();
    const command = {
      saveId: String(data.get('saveId') ?? ''),
      sessionId: String(data.get('sessionId') ?? ''),
      actionId: String(data.get('actionId') ?? ''),
      expectedRevision: integer(data.get('expectedRevision')),
      value: integer(data.get('distance'))
    };
    if (!validBase(command) || !UUID_PATTERN.test(command.sessionId)
      || !Number.isInteger(command.value) || command.value < 0 || command.value > 100) {
      return fail(400, { message: 'That fold could not be recorded.' });
    }
    try {
      await foldBake(locals.supabase, command);
      return { success: true, message: 'Fold recorded.' };
    } catch (cause) {
      return expectedFailure(cause, 'The fold outcome is unknown. Retry the same motion.', command);
    }
  },

  score: async ({ request, locals }) => {
    await requireUser(locals);
    const data = await request.formData();
    const command = {
      saveId: String(data.get('saveId') ?? ''),
      sessionId: String(data.get('sessionId') ?? ''),
      actionId: String(data.get('actionId') ?? ''),
      expectedRevision: integer(data.get('expectedRevision')),
      value: integer(data.get('length'))
    };
    if (!validBase(command) || !UUID_PATTERN.test(command.sessionId)
      || !Number.isInteger(command.value) || command.value < 10 || command.value > 100) {
      return fail(400, { message: 'That score could not be recorded.' });
    }
    try {
      await scoreBake(locals.supabase, command);
      return { success: true, message: 'Score recorded.' };
    } catch (cause) {
      return expectedFailure(cause, 'The score outcome is unknown. Retry the same motion.', command);
    }
  },

  oven: async ({ request, locals }) => {
    await requireUser(locals);
    const data = await request.formData();
    const command = {
      saveId: String(data.get('saveId') ?? ''),
      sessionId: String(data.get('sessionId') ?? ''),
      actionId: String(data.get('actionId') ?? ''),
      expectedRevision: integer(data.get('expectedRevision'))
    };
    if (!validBase(command) || !UUID_PATTERN.test(command.sessionId)) {
      return fail(400, { message: 'The oven request was invalid.' });
    }
    try {
      await beginBakeOven(locals.supabase, command);
      return { success: true, message: 'The loaf is in the oven. Aim for thirty seconds.' };
    } catch (cause) {
      return expectedFailure(cause, 'The oven outcome is unknown. Retry the same ledger entry.', command);
    }
  },

  complete: async ({ request, locals }) => {
    await requireUser(locals);
    const data = await request.formData();
    const command = {
      saveId: String(data.get('saveId') ?? ''),
      sessionId: String(data.get('sessionId') ?? ''),
      actionId: String(data.get('actionId') ?? ''),
      expectedRevision: integer(data.get('expectedRevision'))
    };
    if (!validBase(command) || !UUID_PATTERN.test(command.sessionId)) {
      return fail(400, { message: 'The loaf removal request was invalid.' });
    }
    try {
      const receipt = await completeBake(locals.supabase, command);
      return {
        success: true,
        message: `${receipt.foodName} finished at ${receipt.qualityIndex + 1} of 7 quality.`,
        receipt
      };
    } catch (cause) {
      return expectedFailure(cause, 'The loaf outcome is unknown. Retry the same ledger entry.', command);
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
    if (!validBase(command)) return fail(400, { message: 'The day transition was invalid.' });
    try {
      const receipt = await advanceDay(locals.supabase, command);
      return { success: true, message: `Day ${receipt.newDay} begins.` };
    } catch (cause) {
      return expectedFailure(cause, 'The next tavern day could not begin.', command);
    }
  }
};
