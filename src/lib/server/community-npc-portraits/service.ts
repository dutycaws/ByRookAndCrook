import { createHash } from 'node:crypto';
import type { NpcSheet } from '$lib/game/npc-sheet';
import {
  createPortraitProvider, loadPrivatePortraitReferences, lockedPortraitPrompt, optimisePortraitWebp,
  portraitProviderAvailability, referenceSetHash, storePrivatePortrait,
  type PortraitControls, type PortraitProvider, type PrivatePortraitStorage, PortraitProviderError
} from './index';

export type PortraitCompletionClient = { rpc(name: string, args: Record<string, unknown>): Promise<{ error: { message: string } | null }> };
/** `visualInputHash` is minted by the reserve RPC and is authoritative. */
export type PortraitJob = { jobId: string; npcId: string; sheet: NpcSheet; controls: Partial<PortraitControls>; alternatives: number; visualInputHash: string };
export type PortraitBatchOutcome = { status: 'completed' | 'failed'; completed: number; failed: number; errorCode?: string };
type Runtime = { config: Record<string, string | undefined>; storage: PrivatePortraitStorage; provider?: PortraitProvider; timeoutMs?: number; projectRoot?: string };

function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function errorCode(error: unknown) { return error instanceof PortraitProviderError ? error.code : 'provider_failed'; }
async function complete(client: PortraitCompletionClient, job: PortraitJob, candidates: unknown[], failure: string | null) {
  const result = await client.rpc('npc_author_portrait_complete', { p_job_id: job.jobId, p_candidates: candidates, p_error_code: failure });
  if (result.error) throw new Error(result.error.message);
}
async function deadline<T>(ms: number, callback: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms);
  try { return await callback(controller.signal); }
  catch (error) { if (controller.signal.aborted) throw new PortraitProviderError('provider_timeout', 'Portrait generation timed out.'); throw error; }
  finally { clearTimeout(timer); }
}

/**
 * Executes a small, explicit batch exactly once per ordinal.  It deliberately
 * does not retry any potentially billable provider request.
 */
export async function runPortraitBatch(client: PortraitCompletionClient, job: PortraitJob, runtime: Runtime): Promise<PortraitBatchOutcome> {
  const availability = portraitProviderAvailability(runtime.config);
  if (!availability.available) { await complete(client, job, [], 'provider_unavailable'); return { status: 'failed', completed: 0, failed: job.alternatives, errorCode: 'provider_unavailable' }; }
  const alternatives = Math.max(1, Math.min(job.alternatives, 4));
  let references;
  try { references = loadPrivatePortraitReferences(runtime.projectRoot); }
  catch (error) { const code = errorCode(error); await complete(client, job, [], code); return { status: 'failed', completed: 0, failed: alternatives, errorCode: code }; }
  const provider = runtime.provider ?? createPortraitProvider(runtime.config); const prompt = lockedPortraitPrompt(job.sheet, job.controls); const promptHash = hash(prompt); const currentVisualHash = job.visualInputHash; const referenceHash = referenceSetHash(references);
  const candidates: Array<Record<string, unknown>> = []; let failed = 0; let firstError: string | null = null;
  for (let ordinal = 1; ordinal <= alternatives; ordinal += 1) {
    try {
      const configuredDeadline = runtime.timeoutMs ?? (Number(runtime.config.NPC_IMAGE_DEADLINE_MS) || 60_000);
      const generated = await deadline(Math.max(1_000, Math.min(configuredDeadline, 120_000)), (signal) => provider.generate({ idempotencyKey: `${job.jobId}:${ordinal}`, prompt, references, alternativeOrdinal: ordinal, width: 1024, height: 1536, outputFormat: 'png', background: 'transparent' }, signal));
      const optimized = await optimisePortraitWebp(generated.bytes); const stored = await storePrivatePortrait(runtime.storage, optimized, generated.bytes);
      candidates.push({ ordinal, storageKey: stored.runtimeKey, masterStorageKey: stored.masterKey, altText: `Generated portrait candidate ${ordinal} for ${job.sheet.identity.name}.`, mimeType: optimized.runtimeMimeType, width: optimized.width, height: optimized.height, byteSize: optimized.runtimeBytes.length, sha256: optimized.runtimeSha256, masterSha256: optimized.sha256, alphaValid: true, visualInputHash: currentVisualHash, provider: generated.provider, model: generated.model, requestId: generated.requestId ?? null, promptHash, styleVersion: 'community-npc-portrait-sprite-v1', referenceSetVersion: 'brac-character-look-v1', referenceSetHash: referenceHash, state: 'ready' });
    } catch (error) { failed += 1; firstError ??= errorCode(error); }
  }
  try { await complete(client, job, candidates, candidates.length ? null : firstError ?? 'provider_failed'); }
  catch (error) { return { status: 'failed', completed: candidates.length, failed, errorCode: errorCode(error) }; }
  return candidates.length ? { status: 'completed', completed: candidates.length, failed } : { status: 'failed', completed: 0, failed, errorCode: firstError ?? 'provider_failed' };
}
