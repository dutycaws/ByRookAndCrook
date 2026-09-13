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
import { localScenePublicUrl, localSettingPublicUrl } from '$lib/server/community-npc-jobs/local-assets';
import { portraitProviderAvailability, resolvePortraitPreview, syncPortraitProviderStatus } from '$lib/server/community-npc-jobs/portrait-service';
import type { PortraitControls } from '$lib/server/community-npc-portraits';
import { communityContext, requireCapability } from '$lib/server/community-npc-workspace';
import { getSupabaseConfig } from '$lib/server/config';
import type { Actions, PageServerLoad } from './$types';

type RecordValue = Record<string, unknown>;
type RpcError = { code?: string; message?: string } | null;
type UntypedRpcResult = { data: Json; error: RpcError };

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

/** New additive RPCs may arrive before generated database types in local dev. */
function authoringRpc(locals: App.Locals, name: string, args: Record<string, unknown>): Promise<UntypedRpcResult> {
  return (locals.supabase.rpc as unknown as (rpcName: string, rpcArgs: Record<string, unknown>) => Promise<UntypedRpcResult>)(name, args);
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

function portraitState(): AuthoringProviderState {
  const state = portraitProviderAvailability();
  if (state.available) return { available: true, reason: null };
  const reason = state.reason === 'missing_image_api_key'
    ? 'Add NPC_IMAGE_API_KEY or OPENAI_API_KEY to the server environment to create portraits.'
    : state.reason === 'local_not_implemented'
      ? 'The local image provider is not implemented yet.'
      : state.reason === 'missing_private_references'
        ? 'The approved private style-reference set is unavailable, so portrait creation is paused.'
      : 'The configured image provider is not supported.';
  return { available: false, reason };
}

async function rawDetail(locals: App.Locals, npcId: string): Promise<Json> {
  const result = await locals.supabase.rpc('npc_author_workspace_detail', { p_npc_id: npcId });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function workspaceFrom(locals: App.Locals, raw: Json): Promise<AuthoringWorkspaceDetail> {
  const { url } = getSupabaseConfig();
  const detail = decodeAuthoringWorkspace(raw, providerState(), (assetKey) =>
    localScenePublicUrl(assetKey, url) ?? localSettingPublicUrl(assetKey, url)
  );
  const availablePortraitProvider = portraitState();
  // Database availability is advisory; the server config is the final guard
  // before credit reservation and is what the author sees.
  detail.provider.portrait = availablePortraitProvider;
  detail.portrait.available = availablePortraitProvider.available;
  detail.portrait.reason = availablePortraitProvider.reason;
  const rawPortrait = record(record(raw).portrait);
  const portraitRows = Array.isArray(rawPortrait.candidates) ? rawPortrait.candidates : [];
  const previewByCandidate = new Map<string, string | null>();
  await Promise.all(portraitRows.map(async (entry) => {
    const row = record(entry);
    const candidateId = typeof row.id === 'string' ? row.id : null;
    const token = typeof row.previewToken === 'string' ? row.previewToken : null;
    if (candidateId) previewByCandidate.set(candidateId, token ? await resolvePortraitPreview(locals.supabase as unknown as { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> }, token) : null);
  }));
  for (const candidate of detail.portrait.candidates) candidate.previewUrl = previewByCandidate.get(candidate.id) ?? null;
  return detail;
}

async function workspace(locals: App.Locals, npcId: string): Promise<AuthoringWorkspaceDetail> {
  return workspaceFrom(locals, await rawDetail(locals, npcId));
}

function success(action: AuthoringActionKind, message: string, extra: Partial<AuthoringActionResult> = {}): AuthoringActionResult {
  return { action, status: 'success', message, ...extra };
}

function rpcFailure(action: AuthoringActionKind, error: RpcError, fallback: string, status = 400) {
  return fail(status, { action, ...normalizeAuthoringError(error, fallback) } satisfies AuthoringActionResult);
}

function unavailable(action: 'assist' | 'sandbox' | 'portrait', reason: string | null) {
  return fail(503, {
    action,
    status: 'unavailable',
    category: 'provider_unavailable',
    message: reason ?? 'The authoring provider is unavailable.'
  } satisfies AuthoringActionResult);
}

function providerFailed(action: 'assist' | 'sandbox' | 'portrait', errorCode: string | undefined) {
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

const portraitPoses = new Set(['automatic', 'relaxed', 'confident', 'guarded', 'working']);
const portraitExpressions = new Set(['from_sheet', 'warm', 'wary', 'determined', 'thoughtful', 'stern']);
const portraitConditions = new Set(['from_sheet', 'well_kept', 'patched', 'road_worn']);

/** This is deliberately a small, closed authoring surface. The provider owns the locked style. */
type PortraitRequestControls = PortraitControls & { alternatives: number; optionalItem: string | null };

function portraitControls(data: FormData): PortraitRequestControls | null {
  const pose = text(data.get('pose'));
  const expression = text(data.get('expression'));
  const clothingCondition = text(data.get('clothingCondition'));
  const alternatives = numeric(data.get('count'));
  const item = text(data.get('item'));
  const note = text(data.get('note'));
  if (!portraitPoses.has(pose) || !portraitExpressions.has(expression) || !portraitConditions.has(clothingCondition)) return null;
  if (!Number.isInteger(alternatives) || alternatives < 1 || alternatives > 4 || item.length > 120 || note.length > 240) return null;
  return {
    pose: pose as PortraitRequestControls['pose'], expression: expression as PortraitRequestControls['expression'],
    clothingCondition: clothingCondition as PortraitRequestControls['clothingCondition'], alternatives,
    optionalItem: item || null, compositionNote: note || null
  };
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

  portrait: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const data = await request.formData();
    const current = await workspace(locals, params.npcId);
    // Keep the database's short availability lease aligned with server-only
    // configuration and private references before it reserves any credits.
    const synced = await syncPortraitProviderStatus();
    if (!synced.available) return unavailable('portrait', portraitState().reason);
    const controls = portraitControls(data);
    if (!controls) return fail(400, {
      action: 'portrait', status: 'failure', category: 'invalid_data',
      message: 'Choose valid portrait controls and between one and four alternatives.'
    } satisfies AuthoringActionResult);
    // Portrait generation is wired to the bounded server-only service below.
    // No prompt, reference identifier, storage key, or provider credential is
    // accepted from this form or returned to the browser.
    const result = await authoringRpc(locals, 'npc_author_request_portrait', {
      p_npc_id: params.npcId,
      p_expected_revision: numeric(data.get('revision')),
      p_controls: {
        pose: controls.pose, expression: controls.expression, clothingCondition: controls.clothingCondition,
        optionalItem: controls.optionalItem, compositionNote: controls.compositionNote
      } as Json,
      p_alternatives: controls.alternatives
    });
    if (result.error) return rpcFailure('portrait', result.error, 'The portrait request could not start.', result.error.code === 'PT409' ? 409 : 400);
    const jobId = identifier(result.data, 'jobId');
    const visualInputHash = identifier(result.data, 'visualInputHash');
    if (!jobId || !visualInputHash) return rpcFailure('portrait', null, 'The portrait request did not create a protected job.', 500);
    const { dispatchPortraitJob } = await import('$lib/server/community-npc-jobs/portrait-service');
    const outcome = await dispatchPortraitJob({ jobId, npcId: params.npcId, controls, alternatives: controls.alternatives, sheet: current.draft.sheet, visualInputHash });
    if (outcome.status === 'failed') return providerFailed('portrait', outcome.errorCode);
    return success('portrait', 'Portrait alternatives are ready for review.');
  },

  selectPortrait: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const data = await request.formData();
    const current = await workspace(locals, params.npcId);
    const candidate = current.portrait.candidates.find((entry) => entry.id === text(data.get('candidateId')));
    if (!candidate?.assetId) return fail(400, {
      action: 'portrait', status: 'failure', category: 'invalid_data',
      message: 'Choose a ready portrait alternative before selecting it.'
    } satisfies AuthoringActionResult);
    const result = await authoringRpc(locals, 'npc_author_select_portrait', {
      p_npc_id: params.npcId,
      p_expected_revision: numeric(data.get('revision')),
      p_asset_id: candidate.assetId
    });
    if (result.error) return rpcFailure('portrait', result.error, 'The portrait could not be selected.', result.error.code === 'PT409' ? 409 : 400);
    const revision = Number(record(result.data).revision);
    return success('portrait', 'Portrait selected for these visual details.', { revision });
  },

  selectSetting: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const data = await request.formData();
    const result = await authoringRpc(locals, 'npc_author_select_setting', {
      p_npc_id: params.npcId,
      p_expected_revision: numeric(data.get('revision')),
      p_setting_id: text(data.get('settingId'))
    });
    if (result.error) return rpcFailure('setting', result.error, 'The setting could not be selected.', result.error.code === 'PT409' ? 409 : 400);
    const revision = Number(record(result.data).revision);
    return success('setting', 'Setting selected.', { revision });
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
