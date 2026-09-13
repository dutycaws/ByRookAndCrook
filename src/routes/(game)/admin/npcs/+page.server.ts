import { fail } from '@sveltejs/kit';
import { communityContext, requireCapability } from '$lib/server/community-npc-workspace';
import { drainPortraitDeletionQueue } from '$lib/server/community-npc-jobs/portrait-service';
import type { Actions, PageServerLoad } from './$types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const guard = async (locals: App.Locals, cap = 'npc_reviewer') => requireCapability(await communityContext(locals.supabase), cap);
export const load: PageServerLoad = async ({ locals, url }) => {
  const community = await communityContext(locals.supabase);
  requireCapability(community, 'npc_reviewer');

  const query = url.searchParams.get('q') ?? '';
  const selectedReportId = url.searchParams.get('report') ?? '';
  const admin = community.capabilities.includes('admin');
  const reportDetailRequest = UUID_PATTERN.test(selectedReportId)
    ? locals.supabase.rpc('npc_reviewer_report_detail', { p_report_id: selectedReportId })
    : Promise.resolve({ data: null as any, error: null });
  const [queue, reports, retirements, users, audit, reportDetail] = await Promise.all([
    locals.supabase.rpc('npc_reviewer_queue'),
    locals.supabase.rpc('npc_reviewer_moderation_queue', { p_kind: 'reports', p_limit: 50 }),
    locals.supabase.rpc('npc_reviewer_moderation_queue', { p_kind: 'retirements', p_limit: 50 }),
    admin ? locals.supabase.rpc('npc_admin_users', { p_query: query || undefined, p_limit: 50 }) : Promise.resolve({ data: [] as any[], error: null }),
    admin ? locals.supabase.rpc('npc_admin_audit', { p_limit: 50 }) : Promise.resolve({ data: [] as any[], error: null }),
    reportDetailRequest
  ]);
  for (const result of [queue, reports, retirements, users, audit, reportDetail]) if (result.error) throw new Error(result.error.message);

  return {
    community,
    query,
    selectedReportId: UUID_PATTERN.test(selectedReportId) ? selectedReportId : null,
    reportDetail: reportDetail.data as any,
    queue: (queue.data ?? []) as any[],
    moderation: [
      ...((reports.data ?? []) as any[]).map((row) => ({ ...row, kind: 'report' })),
      ...((retirements.data ?? []) as any[]).map((row) => ({ ...row, kind: 'retirement' }))
    ],
    users: (users.data ?? []) as any[],
    audit: (audit.data ?? []) as any[]
  };
};
async function call(locals: App.Locals, request: Request, rpc: string, capability = 'npc_reviewer') {
  await guard(locals, capability); const d = await request.formData(); const value = (key: string) => String(d.get(key) ?? '');
  const args: Record<string, Record<string, unknown>> = {
    npc_reviewer_comment: { p_npc_id: value('npcId'), p_version_id: value('versionId'), p_section: value('section'), p_body: value('body') }, npc_reviewer_decide: { p_version_id: value('versionId'), p_decision: value('decision'), p_notes: value('notes'), p_rating: value('rating') || undefined }, npc_reviewer_publish: { p_version_id: value('versionId') }, npc_reviewer_resolve_report: { p_report: value('reportId'), p_uphold: value('uphold') === 'true', p_reviewer_reason: value('reviewerReason'), p_creator_reason: value('creatorReason'), p_action: value('action') }, npc_reviewer_retirement: { p_request: value('requestId'), p_approve: value('approve') === 'true', p_reason: value('reason') }, npc_admin_set_capability: { p_user: value('userId'), p_capability: value('capability'), p_enabled: value('enabled') === 'true', p_reason: value('reason') }, npc_admin_quarantine_or_purge: { p_npc: value('npcId'), p_purge: value('purge') === 'true', p_reason: value('reason') }
  }; const r = await locals.supabase.rpc(rpc as never, args[rpc] as never); return r.error ? fail(400, { message: r.error.message }) : { message: 'Community action recorded.' };
}
async function quarantine(locals: App.Locals, request: Request) {
  await guard(locals, 'admin');
  const data = await request.formData();
  const purge = String(data.get('purge') ?? '') === 'true';
  if (purge && String(data.get('confirmation') ?? '').trim() !== 'PURGE') {
    return fail(400, { message: 'Type PURGE to confirm permanent portrait deletion.' });
  }
  const result = await locals.supabase.rpc('npc_admin_quarantine_or_purge', {
    p_npc: String(data.get('npcId') ?? ''),
    p_purge: purge,
    p_reason: String(data.get('reason') ?? '')
  });
  if (result.error) return fail(400, { message: result.error.message });
  if (!purge) return { message: 'Community action recorded.' };
  try {
    const cleanup = await drainPortraitDeletionQueue();
    return { message: `Community action recorded. Deleted ${cleanup.deleted} private portrait asset${cleanup.deleted === 1 ? '' : 's'}.` };
  } catch {
    return { message: 'Community action recorded. Private portrait cleanup remains queued for the next administrator retry.' };
  }
}
export const actions: Actions = { comment: ({ locals, request }) => call(locals, request, 'npc_reviewer_comment'), decide: ({ locals, request }) => call(locals, request, 'npc_reviewer_decide'), publish: ({ locals, request }) => call(locals, request, 'npc_reviewer_publish'), resolveReport: ({ locals, request }) => call(locals, request, 'npc_reviewer_resolve_report'), retirement: ({ locals, request }) => call(locals, request, 'npc_reviewer_retirement'), capability: ({ locals, request }) => call(locals, request, 'npc_admin_set_capability', 'admin'), quarantine: ({ locals, request }) => quarantine(locals, request) };
