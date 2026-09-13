import { fail } from '@sveltejs/kit';
import type { NpcSheet } from '$lib/game/npc-sheet';
import { communityContext, requireCapability } from '$lib/server/community-npc-workspace';
import { dispatchLocalAuthoringJob, dispatchLocalNpcEvaluation } from '$lib/server/community-npc-jobs/runner';
import { localScenePublicUrl } from '$lib/server/community-npc-jobs/local-assets';
import { getSupabaseConfig } from '$lib/server/config';
import type { Actions, PageServerLoad } from './$types';
import type { Json } from '$lib/database.types';

function lines(data: FormData, name: string): string[] { return String(data.get(name) ?? '').split('\n').map((item) => item.trim()).filter(Boolean); }
function strictJson(data: FormData, name: string): unknown { const value = String(data.get(name) ?? '').trim(); if (!value) return []; try { return JSON.parse(value); } catch { throw new Error(`${name} must contain valid JSON.`); } }
function sheetFrom(data: FormData, current: NpcSheet): NpcSheet {
  return { ...current, rating: String(data.get('rating')) as NpcSheet['rating'], identity: { name: String(data.get('name')), title: String(data.get('title')), shortDescription: String(data.get('shortDescription')), voice: String(data.get('voice')) }, appearance: { physicalAppearance: String(data.get('physicalAppearance')), attire: String(data.get('attire')), notableFeatures: String(data.get('notableFeatures')), mood: String(data.get('mood')) }, personality: { values: lines(data, 'values'), likes: lines(data, 'likes'), dislikes: lines(data, 'dislikes'), boundaries: lines(data, 'boundaries') }, lore: { entities: strictJson(data, 'entities') as NpcSheet['lore']['entities'], facts: strictJson(data, 'facts') as NpcSheet['lore']['facts'], relationships: strictJson(data, 'relationships') as NpcSheet['lore']['relationships'], npcReferences: strictJson(data, 'npcReferences') as string[] }, skills: { scouting: Number(data.get('skill-scouting')), combat: Number(data.get('skill-combat')), diplomacy: Number(data.get('skill-diplomacy')), trade: Number(data.get('skill-trade')) }, campaign: { durableGoal: String(data.get('durableGoal')), milestones: strictJson(data, 'milestones') as NpcSheet['campaign']['milestones'] } };
}
async function detail(locals: App.Locals, npcId: string) { const r = await locals.supabase.rpc('npc_author_workspace_detail', { p_npc_id: npcId }); if (r.error) throw new Error(r.error.message); return r.data as unknown as Record<string, unknown>; }
function jobId(value: unknown): string | null { return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).jobId === 'string' ? (value as Record<string, string>).jobId : null; }
function versionId(value: unknown): string | null { return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).versionId === 'string' ? (value as Record<string, string>).versionId : null; }
function displayDetail(value: Record<string, unknown>) {
  const url = getSupabaseConfig().url;
  const assets = Array.isArray(value.assets) ? value.assets.map((asset) => {
    const record = asset as Record<string, unknown>;
    return { ...record, previewUrl: typeof record.storageKey === 'string' ? localScenePublicUrl(record.storageKey, url) : null };
  }) : [];
  return { ...value, assets };
}
export const load: PageServerLoad = async ({ locals, params }) => { const community = await communityContext(locals.supabase); requireCapability(community, 'npc_author'); return { community, detail: displayDetail(await detail(locals, params.npcId)) as any }; };
export const actions: Actions = {
  save: async ({ locals, params, request }) => { const community = await communityContext(locals.supabase); requireCapability(community, 'npc_author'); const data = await request.formData(); const existing = await detail(locals, params.npcId); const revision = Number(data.get('revision')); let sheet: NpcSheet; try { sheet = sheetFrom(data, existing.sheet as NpcSheet); } catch (cause) { return fail(400, { message: cause instanceof Error ? cause.message : 'Structured fields must contain valid JSON.' }); } const r = await locals.supabase.rpc('npc_author_save', { p_npc_id: params.npcId, p_expected_revision: revision, p_sheet: sheet as unknown as Json }); return r.error ? fail(r.error.code === 'PT409' ? 409 : 400, { message: r.error.message, conflict: r.error.code === 'PT409' }) : { message: `Saved revision ${(r.data as { revision: number }).revision}.` }; },
  assist: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const d = await request.formData(); const section = String(d.get('section')); const instruction = String(d.get('instruction'));
    const current = await detail(locals, params.npcId);
    const r = await locals.supabase.rpc('npc_author_request_assistance', { p_npc_id: params.npcId, p_expected_revision: Number(d.get('revision')), p_section_path: section, p_instruction: instruction });
    if (r.error) return fail(400, { message: r.error.message });
    const id = jobId(r.data);
    const outcome = id ? await dispatchLocalAuthoringJob({ jobId: id, npcId: params.npcId, kind: 'assist', section, instruction, currentSection: ((current.sheet as Record<string, Json> | undefined)?.[section] ?? {}) as Json }) : null;
    return { message: outcome?.status === 'completed' ? 'Local proposal is ready for review.' : `Assistance queued${outcome?.errorCode ? `, but the local worker reported ${outcome.errorCode}` : ''}.` };
  },
  disposition: async ({ locals, request }) => { requireCapability(await communityContext(locals.supabase), 'npc_author'); const d = await request.formData(); const r = await locals.supabase.rpc('npc_author_assistance_disposition', { p_event_id: String(d.get('eventId')), p_expected_revision: Number(d.get('revision')), p_accept: d.get('accept') === 'true' }); return r.error ? fail(409, { message: r.error.message, conflict: true }) : { message: d.get('accept') === 'true' ? 'Proposal applied.' : 'Proposal discarded.' }; },
  scene: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const d = await request.formData(); const prompt = String(d.get('prompt'));
    const r = await locals.supabase.rpc('npc_author_request_scene', { p_npc_id: params.npcId, p_expected_revision: Number(d.get('revision')), p_prompt: prompt, p_alternative: Number(d.get('alternative') ?? 1) });
    if (r.error) return fail(400, { message: r.error.message });
    const id = jobId(r.data); const outcome = id ? await dispatchLocalAuthoringJob({ jobId: id, npcId: params.npcId, kind: 'scene', instruction: prompt }) : null;
    return { message: outcome?.status === 'completed' ? 'Local scene candidate is ready for review.' : `Scene request queued${outcome?.errorCode ? `, but the local worker reported ${outcome.errorCode}` : ''}.` };
  },
  selectScene: async ({ locals, params, request }) => { requireCapability(await communityContext(locals.supabase), 'npc_author'); const d = await request.formData(); const r = await locals.supabase.rpc('npc_author_select_scene', { p_npc_id: params.npcId, p_expected_revision: Number(d.get('revision')), p_asset_id: String(d.get('assetId')) }); return r.error ? fail(409, { message: r.error.message, conflict: true }) : { message: 'Scene selected.' }; },
  sandbox: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const d = await request.formData(); const message = String(d.get('message'));
    const r = await locals.supabase.rpc('npc_author_sandbox_start', { p_npc_id: params.npcId, p_expected_revision: Number(d.get('revision')), p_message: message });
    if (r.error) return fail(400, { message: r.error.message });
    const id = jobId(r.data); const outcome = id ? await dispatchLocalAuthoringJob({ jobId: id, npcId: params.npcId, kind: 'sandbox', message }) : null;
    return { message: outcome?.status === 'completed' ? 'Sandbox reply is ready; it cannot change the canonical draft.' : `Sandbox turn queued${outcome?.errorCode ? `, but the local worker reported ${outcome.errorCode}` : ''}.` };
  },
  submit: async ({ locals, params, request }) => {
    requireCapability(await communityContext(locals.supabase), 'npc_author');
    const d = await request.formData(); const current = await detail(locals, params.npcId);
    const r = await locals.supabase.rpc('npc_author_submit', { p_npc_id: params.npcId, p_expected_revision: Number(d.get('revision')) });
    if (r.error) return fail(400, { message: r.error.message });
    const id = versionId(r.data); const outcome = id ? await dispatchLocalNpcEvaluation(id, current.sheet) : null;
    if (outcome?.status === 'completed') return { message: outcome.hardBlockCount ? `Immutable version submitted with ${outcome.hardBlockCount} structural hard block(s).` : 'Immutable version submitted with deterministic structural checks complete; reviewer judgment is still required.' };
    return { message: `Immutable version submitted; local evaluation is queued${outcome?.errorCode ? ` (${outcome.errorCode})` : ''}.` };
  },
  retire: async ({ locals, params, request }) => { requireCapability(await communityContext(locals.supabase), 'npc_author'); const d = await request.formData(); const r = await locals.supabase.rpc('npc_request_retirement', { p_npc: params.npcId, p_reason: String(d.get('reason')) }); return r.error ? fail(400, { message: r.error.message }) : { message: 'Retirement request sent to reviewers.' }; },
  resolveComment: async ({ locals, request }) => { requireCapability(await communityContext(locals.supabase), 'npc_author'); const d = await request.formData(); const r = await locals.supabase.rpc('npc_author_resolve_review_comment', { p_comment_id: String(d.get('commentId')) }); return r.error ? fail(400, { message: r.error.message }) : { message: 'Comment marked resolved.' }; }
};
