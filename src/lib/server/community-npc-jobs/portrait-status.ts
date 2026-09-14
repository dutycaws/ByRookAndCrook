import { communityContext, requireCapability, safePortraitJobSnapshot, type PortraitJobAlternativeSnapshot, type PortraitJobSnapshot } from '$lib/server/community-npc-workspace';
import { resolvePortraitPreview } from '$lib/server/community-npc-jobs/portrait-service';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function portraitJobSnapshot(locals: App.Locals, npcId: string, jobId: string) {
	const owned = await ownedPortraitJobStatus(locals, npcId, jobId);
	if (!owned) return null;
	const { snapshot, raw } = owned;
	const rawCandidates = Array.isArray(raw.candidates) ? raw.candidates : [];
	const previewByCandidate = new Map<string, string | null>();
	await Promise.all(rawCandidates.map(async (entry) => {
		const candidate = record(entry);
		const candidateId = typeof candidate.candidateId === 'string' ? candidate.candidateId : typeof candidate.id === 'string' ? candidate.id : null;
		const token = typeof candidate.previewToken === 'string' ? candidate.previewToken : null;
		if (candidateId && token) {
			previewByCandidate.set(candidateId, await resolvePortraitPreview(locals.supabase as unknown as { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> }, token));
		}
	}));
	for (const candidate of snapshot.candidates) candidate.previewUrl = previewByCandidate.get(candidate.candidateId) ?? null;
	return snapshot;
}

type OwnedPortraitJobStatus = { snapshot: PortraitJobSnapshot; raw: Record<string, unknown> };
async function ownedPortraitJobStatus(locals: App.Locals, npcId: string, jobId: string): Promise<OwnedPortraitJobStatus | null> {
	requireCapability(await communityContext(locals.supabase), 'npc_author');
	if (!uuid.test(npcId) || !uuid.test(jobId)) return null;
	const result = await (locals.supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)('npc_author_portrait_status', { p_job_id: jobId });
	if (result.error) return null;
	const snapshot = safePortraitJobSnapshot(result.data);
	if (!snapshot) return null;

	// The RPC verifies job ownership. The path is an additional containment
	// boundary: a valid job for another NPC must never become a preview oracle.
	const raw = record(result.data);
	if (raw.npcId !== npcId) return null;
	return { snapshot, raw };
}

/** Narrow, non-preview state used by EventSource reads and its polling loop. */
export type PortraitJobEventSnapshot = Pick<PortraitJobSnapshot, 'jobId' | 'slot' | 'status'> & {
	alternatives: PortraitJobAlternativeSnapshot[];
};
export async function portraitJobEventSnapshot(locals: App.Locals, npcId: string, jobId: string): Promise<PortraitJobEventSnapshot | null> {
	requireCapability(await communityContext(locals.supabase), 'npc_author');
	if (!uuid.test(npcId) || !uuid.test(jobId)) return null;
	// Do not substitute the full status RPC here. Its candidate DTO creates
	// preview grants as a side effect, even if a caller later drops candidates.
	const result = await (locals.supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)('npc_author_portrait_event_status', { p_job_id: jobId });
	if (result.error) return null;
	const raw = record(result.data);
	if (raw.npcId !== npcId) return null;
	const snapshot = safePortraitJobSnapshot(raw);
	if (!snapshot) return null;
	const { jobId: safeJobId, slot, status, alternatives } = snapshot;
	return { jobId: safeJobId, slot, status, alternatives };
}
