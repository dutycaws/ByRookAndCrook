import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messageFor = (code?: string) => ({ PT404: 'That guest is no longer available.', PT409: 'The conversation changed. Review the new preview first.', PT422: 'Please add a short report reason.' }[code ?? ''] ?? 'That action could not be completed.');

export const POST: RequestHandler = async ({ locals, request, url }) => {
  if (request.headers.get('origin') !== url.origin) return json({ message: 'Invalid request origin.' }, { status: 403 });
  if (!await locals.getVerifiedUser()) return json({ message: 'Please sign in.' }, { status: 401 });
  let input: any;
  try { input = await request.json(); } catch { return json({ message: 'Invalid action.' }, { status: 400 }); }
  const rpc = locals.supabase.rpc.bind(locals.supabase) as any;
  if (input.action === 'dismiss' && uuid.test(input.instanceId)) {
    const result = await rpc('npc_dismiss', { p_instance: input.instanceId });
    return result.error ? json({ message: messageFor(result.error.code) }, { status: 400 }) : json({ ok: true, message: 'This guest has been dismissed from this tavern.' });
  }
  if (input.action === 'report' && uuid.test(input.versionId) && typeof input.category === 'string') {
    const evidence = typeof input.evidence === 'string' ? input.evidence.trim().slice(0, 2000) : '';
    const result = await rpc('npc_report', { p_version: input.versionId, p_category: input.category.slice(0, 80), p_evidence: evidence });
    return result.error ? json({ message: messageFor(result.error.code) }, { status: 400 }) : json({ ok: true, reportId: result.data, message: 'Your report saved an immutable copy of the encountered version and transcript.' });
  }
  if (input.action === 'share-preview' && uuid.test(input.instanceId)) {
    const result = await rpc('npc_share_preview', { p_instance: input.instanceId });
    return result.error ? json({ message: messageFor(result.error.code) }, { status: 400 }) : json({ ok: true, preview: result.data });
  }
  if (input.action === 'share' && uuid.test(input.instanceId) && typeof input.contentHash === 'string') {
    const result = await rpc('npc_share_conversation', { p_instance: input.instanceId, p_expected_hash: input.contentHash, p_include_display_name: input.includeDisplayName === true });
    return result.error ? json({ message: messageFor(result.error.code) }, { status: 400 }) : json({ ok: true, token: result.data, message: 'An immutable share link is ready.' });
  }
  return json({ message: 'Invalid action.' }, { status: 400 });
};
