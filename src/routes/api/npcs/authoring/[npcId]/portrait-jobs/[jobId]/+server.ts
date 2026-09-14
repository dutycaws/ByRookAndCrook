import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { portraitJobSnapshot } from '$lib/server/community-npc-jobs/portrait-status';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!await locals.getVerifiedUser()) return json({ message: 'Please sign in.' }, { status: 401 });
  const snapshot = await portraitJobSnapshot(locals, params.npcId, params.jobId);
  if (!snapshot) return json({ message: 'Portrait job not found.' }, { status: 404 });
  return json(snapshot, { headers: { 'cache-control': 'private, no-store' } });
};
