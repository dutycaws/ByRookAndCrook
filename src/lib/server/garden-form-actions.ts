import { fail, redirect } from '@sveltejs/kit';
import {
  commitApiaryCommand,
  commitGardenCommand,
  GameServiceError,
  previewApiaryCommand,
  previewGardenCommand
} from '$lib/server/game';
import type {
  ApiaryCommandKind,
  ApiaryCommandPayload,
  GardenCommandKind,
  GardenCommandPayload
} from '$lib/game/contracts';
import { apiarySuccessFeedback, gardenSuccessFeedback } from '$lib/game/garden-feedback';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GARDEN_COMMAND_KINDS = new Set<GardenCommandKind>([
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

export const SHOP_COMMAND_KINDS = new Set<GardenCommandKind>(['purchase', 'expand']);

export const APIARY_COMMAND_KINDS = new Set<ApiaryCommandKind>([
  'install_hive',
  'install_colony',
  'feed',
  'treat',
  'split',
  'extract_honey'
]);

export async function requireGameUser(locals: App.Locals) {
  const user = await locals.getVerifiedUser();
  if (!user) redirect(303, '/login');
  return user;
}

function parseGardenCommandInput(data: FormData, allowedKinds: ReadonlySet<GardenCommandKind>) {
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
  if (!allowedKinds.has(commandKind)) return null;
  return { commandKind, payload };
}

function parseApiaryCommandInput(data: FormData, allowedKinds: ReadonlySet<ApiaryCommandKind>) {
  const commandKind = String(data.get('commandKind') ?? '') as ApiaryCommandKind;
  const payloadText = String(data.get('payload') ?? '');
  let payload: ApiaryCommandPayload;
  try {
    const parsed: unknown = JSON.parse(payloadText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    payload = parsed as ApiaryCommandPayload;
  } catch {
    return null;
  }
  if (!allowedKinds.has(commandKind)) return null;
  return { commandKind, payload };
}

function commandFailure(cause: unknown, fallback: string, pendingAction?: object) {
  if (cause instanceof GameServiceError) {
    return fail(cause.status, {
      message: cause.message,
      pendingAction: cause.status >= 500 ? pendingAction : undefined,
      conflict: cause.status === 409
    });
  }
  console.error(fallback, cause);
  return fail(500, { message: fallback, pendingAction });
}

export async function handleGardenPreview(
  locals: App.Locals,
  data: FormData,
  options: {
    allowedKinds?: ReadonlySet<GardenCommandKind>;
    invalidMessage?: string;
    unavailableMessage?: string;
  } = {}
) {
  const parsed = parseGardenCommandInput(data, options.allowedKinds ?? GARDEN_COMMAND_KINDS);
  if (!parsed) return fail(400, { message: options.invalidMessage ?? 'The garden preview request was invalid.' });

  try {
    const preview = await previewGardenCommand(locals.supabase, parsed.commandKind, parsed.payload);
    return { success: true, preview };
  } catch (cause) {
    return commandFailure(cause, options.unavailableMessage ?? 'The garden preview is unavailable. Please try again.');
  }
}

export async function handleGardenCommand(
  locals: App.Locals,
  data: FormData,
  options: {
    allowedKinds?: ReadonlySet<GardenCommandKind>;
    invalidMessage?: string;
    unavailableMessage?: string;
    successMessage?: string;
  } = {}
) {
  const parsed = parseGardenCommandInput(data, options.allowedKinds ?? GARDEN_COMMAND_KINDS);
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
    return fail(400, { message: options.invalidMessage ?? 'The garden command was invalid.' });
  }

  const pendingAction = { saveId, actionId, expectedRevision, ...parsed };
  try {
    const receipt = await commitGardenCommand(locals.supabase, pendingAction);
    return {
      success: true,
      message: options.successMessage ?? gardenSuccessFeedback(parsed.commandKind, receipt),
      receipt
    };
  } catch (cause) {
    return commandFailure(
      cause,
      options.unavailableMessage ?? 'The garden outcome is unknown. Retry the same action to recover it.',
      pendingAction
    );
  }
}

export async function handleApiaryPreview(
  locals: App.Locals,
  data: FormData,
  options: { invalidMessage?: string; unavailableMessage?: string } = {}
) {
  const parsed = parseApiaryCommandInput(data, APIARY_COMMAND_KINDS);
  if (!parsed) return fail(400, { message: options.invalidMessage ?? 'The apiary preview request was invalid.' });

  try {
    const preview = await previewApiaryCommand(locals.supabase, parsed.commandKind, parsed.payload);
    return { success: true, preview };
  } catch (cause) {
    return commandFailure(cause, options.unavailableMessage ?? 'The apiary preview is unavailable. Please try again.');
  }
}

export async function handleApiaryCommand(
  locals: App.Locals,
  data: FormData,
  options: { invalidMessage?: string; unavailableMessage?: string; successMessage?: string } = {}
) {
  const parsed = parseApiaryCommandInput(data, APIARY_COMMAND_KINDS);
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
    return fail(400, { message: options.invalidMessage ?? 'The apiary command was invalid.' });
  }

  const pendingAction = { saveId, actionId, expectedRevision, ...parsed };
  try {
    const receipt = await commitApiaryCommand(locals.supabase, pendingAction);
    return {
      success: true,
      message: options.successMessage ?? apiarySuccessFeedback(parsed.commandKind, receipt),
      receipt
    };
  } catch (cause) {
    return commandFailure(
      cause,
      options.unavailableMessage ?? 'The apiary outcome is unknown. Retry the same action to recover it.',
      pendingAction
    );
  }
}
