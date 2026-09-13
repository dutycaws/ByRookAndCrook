import { fail } from '@sveltejs/kit';
import type { Json } from '$lib/database.types';
import {
  decodeAuthoringWorkspace,
  normalizeAuthoringError,
  providerFailure,
  type AuthoringActionKind,
  type AuthoringActionResult,
  type AuthoringProviderState,
  type AuthoringSection,
  type AuthoringWorkspaceDetail
} from '$lib/game/authoring-workspace';
import { npcSheetFromAuthoringForm } from '$lib/game/npc-sheet-editor';
import type { NpcSheet } from '$lib/game/npc-sheet';
import {
  authoringProviderAvailability,
  dispatchAuthoringJob,
  dispatchLocalNpcEvaluation
} from '$lib/server/community-npc-jobs/runner';
import type { SandboxTurn } from '$lib/server/community-npc-jobs/provider';
import { localScenePublicUrl } from '$lib/server/community-npc-jobs/local-assets';
import { communityContext, requireCapability } from '$lib/server/community-npc-workspace';
import { getSupabaseConfig } from '$lib/server/config';
import type { Actions, PageServerLoad } from './$types';

type RecordValue = Record<string, unknown>;
type RpcError = { code?: string; message?: string } | null;

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numeric(value: FormDataEntryValue | null): number {
  return Number(typeof value === 'string' ? value : Number.NaN);
}

function identifier(value: unknown, name: string): string {
  const candidate = record(value)[name];
  return typeof candidate === 'string' ? candidate : '';
}

function providerState(): AuthoringProviderState {
  const state = authoringProviderAvailability();
  if (state.available) return { available: true, reason: null };
  const reason = state.reason === 'missing_openai_key'
    ? 'Add OPENAI_API_KEY to the server environment to use this feature.'
    : state.reason === 'local_not_implemented'
      ? 'The local authoring provider is not implemented yet.'
      : 'The configured authoring provider is not supported.';
  return { available: false, reason };
}

async function rawDetail(locals: App.Locals, npcId: string): Promise<Json> {
  const result = await locals.supabase.rpc('npc_author_workspace_detail', { p_npc_id: npcId });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

function workspaceFrom(raw: Json): AuthoringWorkspaceDetail {
  const { url } = getSupabaseConfig();
  return decodeAuthoringWorkspace(raw, providerState(), (storageKey) => localScenePublicUrl(storageKey, url));
}

async function workspace(locals: App.Locals, npcId: string): Promise<AuthoringWorkspaceDetail> {
  return workspaceFrom(await rawDetail(locals, npcId));
}

function success(action: AuthoringActionKind, message: string, extra: Partial<AuthoringActionResult> = {}): AuthoringActionResult {
  return { action, status: 'success', message, ...extra };
}

function rpcFailure(action: AuthoringActionKind, error: RpcError, fallback: string, status = 400) {
  return fail(status, { action, ...normalizeAuthoringError(error, fallback) } satisfies AuthoringActionResult);
}

function unavailable(action: 'assist' | 'sandbox', reason: string | null) {
  return fail(503, {
    action,
    status: 'unavailable',
    category: 'provider_unavailable',
    message: reason ?? 'The authoring provider is unavailable.'
  } satisfies AuthoringActionResult);
}

function providerFailed(action: 'assist' | 'sandbox', errorCode: string | undefined) {
  return fail(errorCode?.includes('unavailable') ? 503 : 502, {
    action,
    ...providerFailure(errorCode)
  } satisfies AuthoringActionResult);
}

function parseSection(value: FormDataEntryValue | null): AuthoringSection | null {
  const candidate = text(value);
  return ['identity', 'appearance', 'personality', 'lore', 'skills', 'campaign'].includes(candidate)
    ? candidate as AuthoringSection
    : null;
}

function sandboxContext(value: unknown): { sheet: NpcSheet; turns: SandboxTurn[] } | null {
  const status = record(value);
  const frozenSheet = status.frozenSheet;
  if (!frozenSheet || typeof frozenSheet !== 'object' || Array.isArray(frozenSheet)) return null;
  const turns = (Array.isArray(status.turns) ? status.turns : [])
    .map((entry) => record(entry))
    .filter((entry) => entry.role === 'keeper' || entry.role === 'npc')
    .sort((left, right) => Number(left.ordinal ?? 0) - Number(right.ordinal ?? 0))
    .map((entry): SandboxTurn => ({
      role: entry.role as SandboxTurn['role'],
      content: typeof entry.content === 'string' ? entry.content : ''
    }))
    .filter((entry) => entry.content.length > 0);
  return { sheet: frozenSheet as unknown as NpcSheet, turns };
}

export const load: PageServerLoad = async ({ locals, params }) => {
  const community = await communityContext(locals.supabase);
  requireCapability(community, 'npc_author');
  return { community, detail: await workspace(locals, params.npcId) };
};

export const actions: Actions = {
  save: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const data = await request.formData();
    const current = await workspace(locals, params.npcId);
    let sheet: NpcSheet;
    try {
      sheet = npcSheetFromAuthoringForm(data, current.draft.sheet);
    } catch (cause) {
      return fail(400, {
        action: 'save', status: 'failure', category: 'invalid_data',
        message: cause instanceof Error ? cause.message : 'The draft contains invalid authoring data.'
      } satisfies AuthoringActionResult);
    }
    const result = await locals.supabase.rpc('npc_author_save', {
      p_npc_id: params.npcId,
      p_expected_revision: numeric(data.get('revision')),
      p_sheet: sheet as unknown as Json
    });
    if (result.error) return rpcFailure('save', result.error, 'The draft could not be saved.', result.error.code === 'PT409' ? 409 : 400);
    const revision = Number(record(result.data).revision);
    return success('save', `Saved revision ${revision}.`, { revision });
  },

  assist: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const availability = providerState();
    if (!availability.available) return unavailable('assist', availability.reason);
    const data = await request.formData();
    const selectedSection = parseSection(data.get('section'));
    if (!selectedSection) return fail(400, {
      action: 'assist', status: 'failure', category: 'invalid_data', message: 'Choose a section to improve.'
    } satisfies AuthoringActionResult);
    const current = await workspace(locals, params.npcId);
    const result = await locals.supabase.rpc('npc_author_request_assistance', {
      p_npc_id: params.npcId,
      p_expected_revision: numeric(data.get('revision')),
      p_section_path: selectedSection,
      p_instruction: text(data.get('instruction'))
    });
    if (result.error) return rpcFailure('assist', result.error, 'The suggestion could not be requested.', result.error.code === 'PT409' ? 409 : 400);
    const jobId = identifier(result.data, 'jobId');
    if (!jobId) return rpcFailure('assist', null, 'The suggestion request did not create a provider job.', 500);
    const outcome = await dispatchAuthoringJob({
      jobId,
      npcId: params.npcId,
      kind: 'assist',
      section: selectedSection,
      instruction: text(data.get('instruction')),
      sheet: current.draft.sheet
    });
    if (outcome.status === 'failed') return providerFailed('assist', outcome.errorCode);
    return success('assist', 'Suggestion ready for review.', { revision: current.draft.revision });
  },

  disposition: async ({ locals, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const data = await request.formData();
    const accepted = data.get('accept') === 'true';
    const result = await locals.supabase.rpc('npc_author_assistance_disposition', {
      p_event_id: text(data.get('eventId')),
      p_expected_revision: numeric(data.get('revision')),
      p_accept: accepted
    });
    if (result.error) return rpcFailure('assist', result.error, 'The suggestion decision could not be saved.', result.error.code === 'PT409' ? 409 : 400);
    const revision = Number(record(result.data).revision);
    return success('assist', accepted ? 'Suggestion applied to the draft.' : 'Suggestion discarded.', { revision });
  },

  scene: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const data = await request.formData();
    const result = await locals.supabase.rpc('npc_author_request_scene', {
      p_npc_id: params.npcId,
      p_expected_revision: numeric(data.get('revision')),
      p_prompt: text(data.get('prompt')),
      p_alternative: numeric(data.get('alternative')) || 1
    });
    if (result.error) return rpcFailure('scene', result.error, 'The local scene lookup could not start.', result.error.code === 'PT409' ? 409 : 400);
    const jobId = identifier(result.data, 'jobId');
    if (!jobId) return rpcFailure('scene', null, 'The scene lookup did not create a job.', 500);
    const outcome = await dispatchAuthoringJob({ jobId, npcId: params.npcId, kind: 'scene', instruction: text(data.get('prompt')) });
    if (outcome.status === 'failed') return fail(422, {
      action: 'scene', status: 'failure', category: 'missing_prerequisite',
      message: outcome.errorCode === 'local_scene_asset_missing'
        ? 'No approved local scene derivative is available. Add one to the ignored media folder and run the local fixture command.'
        : 'The local scene lookup could not complete.'
    } satisfies AuthoringActionResult);
    return success('scene', 'A local scene candidate is ready for review.');
  },

  selectScene: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const data = await request.formData();
    const result = await locals.supabase.rpc('npc_author_select_scene', {
      p_npc_id: params.npcId,
      p_expected_revision: numeric(data.get('revision')),
      p_asset_id: text(data.get('assetId'))
    });
    if (result.error) return rpcFailure('scene', result.error, 'The scene could not be selected.', result.error.code === 'PT409' ? 409 : 400);
    const revision = Number(record(result.data).revision);
    return success('scene', 'Scene selected.', { revision });
  },

  sandbox: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const availability = providerState();
    if (!availability.available) return unavailable('sandbox', availability.reason);
    const data = await request.formData();
    const current = await workspace(locals, params.npcId);
    let sandboxId = current.sandbox.active?.id ?? '';
    if (!sandboxId) {
      const started = await locals.supabase.rpc('npc_author_sandbox_start', {
        p_npc_id: params.npcId,
        p_expected_revision: numeric(data.get('revision'))
      });
      if (started.error) return rpcFailure('sandbox', started.error, 'The sandbox could not be started.', started.error.code === 'PT409' ? 409 : 400);
      sandboxId = identifier(started.data, 'sandboxId');
    }
    if (!sandboxId) return rpcFailure('sandbox', null, 'The sandbox session was not created.', 500);
    const sent = await locals.supabase.rpc('npc_author_sandbox_send', {
      p_sandbox_id: sandboxId,
      p_message: text(data.get('message'))
    });
    if (sent.error) return rpcFailure('sandbox', sent.error, 'The sandbox message could not be sent.', sent.error.code === 'PT409' ? 409 : 400);
    const jobId = identifier(sent.data, 'jobId');
    const status = await locals.supabase.rpc('npc_author_sandbox_status', { p_sandbox_id: sandboxId });
    if (status.error) return rpcFailure('sandbox', status.error, 'The sandbox transcript could not be loaded.', 500);
    const context = sandboxContext(status.data);
    if (!jobId || !context) return rpcFailure('sandbox', null, 'The sandbox context was incomplete.', 500);
    const outcome = await dispatchAuthoringJob({ jobId, npcId: params.npcId, kind: 'sandbox', sheet: context.sheet, turns: context.turns });
    if (outcome.status === 'failed') return providerFailed('sandbox', outcome.errorCode);
    return success('sandbox', 'The NPC replied in the private sandbox.', { revision: current.draft.revision });
  },

  submit: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const data = await request.formData();
    const current = await workspace(locals, params.npcId);
    if (current.preflight.length > 0) return fail(400, {
      action: 'submit', status: 'failure', category: 'missing_prerequisite',
      message: `Finish ${current.preflight.length} authoring prerequisite${current.preflight.length === 1 ? '' : 's'} before submitting.`,
      focusTarget: current.preflight[0]?.focusId
    } satisfies AuthoringActionResult);
    const nextVersionNumber = Math.max(0, ...current.versions.map((version) => version.number)) + 1;
    const result = await locals.supabase.rpc('npc_author_submit', {
      p_npc_id: params.npcId,
      p_expected_revision: numeric(data.get('revision'))
    });
    if (result.error) return rpcFailure('submit', result.error, 'The draft could not be submitted.', result.error.code === 'PT409' ? 409 : 400);
    const versionId = identifier(result.data, 'versionId');
    const versionNumber = Number(record(result.data).versionNumber ?? nextVersionNumber);
    if (!versionId) return rpcFailure('submit', null, 'The submitted version could not be evaluated.', 500);
    const outcome = await dispatchLocalNpcEvaluation(versionId, current.draft.sheet);
    if (outcome.status === 'failed') return fail(502, {
      action: 'submit', status: 'failure', category: 'unexpected', versionNumber,
      message: `Version ${versionNumber} was submitted, but its checks could not complete.`
    } satisfies AuthoringActionResult);
    return success('submit', outcome.hardBlockCount
      ? `Version ${versionNumber} submitted with ${outcome.hardBlockCount} issue${outcome.hardBlockCount === 1 ? '' : 's'} to resolve.`
      : `Version ${versionNumber} submitted — checks passed and reviewer judgment is pending.`, { versionNumber });
  },

  retire: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const data = await request.formData();
    const result = await locals.supabase.rpc('npc_author_request_retirement', {
      p_npc_id: params.npcId,
      p_reason: text(data.get('reason'))
    });
    if (result.error) return rpcFailure('retire', result.error, 'The retirement request could not be saved.');
    return success('retire', 'Retirement request submitted for review.');
  },

  resolveComment: async ({ locals, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const data = await request.formData();
    const result = await locals.supabase.rpc('npc_author_resolve_review_comment', { p_comment_id: text(data.get('commentId')) });
    if (result.error) return rpcFailure('comment', result.error, 'The comment could not be resolved.');
    return success('comment', 'Comment marked resolved.');
  }
};
