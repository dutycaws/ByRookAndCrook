import { createHash } from 'node:crypto';
import type { NpcSheet } from '$lib/game/npc-sheet';
import {
  createPortraitProvider, loadPrivatePortraitReferences, lockedPortraitPrompt, portraitPromptContext, optimisePortraitWebp,
  cleanupStoredPrivatePortrait, portraitProviderConfiguration, referenceSetHash, storePrivatePortrait, PRIVATE_PORTRAIT_MASTER_BUCKET,
  type PortraitControls, type PortraitProvider, type PortraitReference, type PrivatePortraitStorage, PortraitProviderError
} from './index';
import { portraitIdentityAnchorInstruction, releaseImagePrompt, type PromptReleaseSnapshot } from '$lib/server/prompt-registry';
import { type PromptRegistryService } from '$lib/server/prompt-registry/service';

export type PortraitCompletionClient = { rpc(name: string, args: Record<string, unknown>): Promise<{ error: { message: string } | null }> };
/** `visualInputHash` is minted by the reserve RPC and is authoritative. */
export type PortraitJob = { jobId: string; npcId: string; sheet: NpcSheet; controls: Partial<PortraitControls>; alternatives: number; visualInputHash: string };
export type PortraitBatchOutcome = { status: 'completed' | 'failed'; completed: number; failed: number; errorCode?: string };
type Runtime = { config: Record<string, string | undefined>; storage: PrivatePortraitStorage; provider?: PortraitProvider; references?: readonly PortraitReference[]; timeoutMs?: number; projectRoot?: string; promptRelease?: PromptReleaseSnapshot };

/**
 * A service-only lease returned by the database worker queue.  It is kept
 * deliberately separate from author-facing job status: the lease token,
 * storage keys, and full NPC sheet must never cross a route boundary.
 */
export type PortraitGenerationAttempt = {
  attemptId: string;
  leaseToken: string;
  jobId: string;
  candidateId: string;
  ordinal: number;
  request: {
    npcId: string;
    sheet: NpcSheet;
    controls: Partial<PortraitControls>;
    visualInputHash: string;
    slot: 'neutral' | 'happy' | 'sad' | 'angry' | 'engaged' | 'leaving';
    neutralAnchorHash?: string | null;
  };
  neutralAnchorAsset?: {
    assetId: string;
    runtimeStorageKey: string;
    masterStorageKey: string;
    sha256: string;
  } | null;
};

export type PortraitWorkerRpcResult = { data: unknown; error: { message: string } | null };
export type PortraitWorkerClient = { rpc(name: string, args?: Record<string, unknown>): Promise<PortraitWorkerRpcResult> };
export type PortraitWorkerRuntime = Runtime & { heartbeatMs?: number; promptRegistry?: PromptRegistryService };
export type PortraitAttemptOutcome = { status: 'completed' | 'failed' | 'lost_lease'; errorCode?: string };

function hash(value: string | Buffer) { return createHash('sha256').update(value).digest('hex'); }
function errorCode(error: unknown) { return error instanceof PortraitProviderError ? error.code : 'provider_failed'; }
/**
 * Once dispatch is recorded, only these conditions leave the upstream result
 * unknowable. All other classified failures have a known provider or local
 * outcome and should remain ordinary charged failures, not false ambiguity.
 */
function postDispatchFailureStage(error: unknown): 'confirmed_post_dispatch_failure' | 'ambiguous_after_dispatch' {
  const code = errorCode(error);
  return code === 'provider_timeout' || code === 'provider_failed'
    ? 'ambiguous_after_dispatch' : 'confirmed_post_dispatch_failure';
}
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function expressionSlot(value: unknown): PortraitGenerationAttempt['request']['slot'] | null {
  return ['neutral', 'happy', 'sad', 'angry', 'engaged', 'leaving'].includes(String(value))
    ? value as PortraitGenerationAttempt['request']['slot'] : null;
}
function asAttempt(value: unknown): PortraitGenerationAttempt | null {
  const row = record(value); const request = record(row.request); const sheet = request.sheet;
  const controls = record(request.controls); const anchor = record(row.neutralAnchorAsset);
  const attemptId = text(row.attemptId); const leaseToken = text(row.leaseToken); const jobId = text(row.jobId);
  const candidateId = text(row.candidateId); const ordinal = Number(row.ordinal); const npcId = text(request.npcId);
  const visualInputHash = text(request.visualInputHash); const slot = expressionSlot(request.slot);
  if (!attemptId || !leaseToken || !jobId || !candidateId || !Number.isInteger(ordinal) || ordinal < 1
    || !npcId || !visualInputHash || !slot || !sheet || typeof sheet !== 'object') return null;
  const neutralAnchorAsset = text(anchor.assetId) && text(anchor.runtimeStorageKey) && text(anchor.masterStorageKey) && text(anchor.masterSha256)
    ? { assetId: anchor.assetId as string, runtimeStorageKey: anchor.runtimeStorageKey as string,
      masterStorageKey: anchor.masterStorageKey as string, sha256: anchor.masterSha256 as string } : null;
  return {
    attemptId, leaseToken, jobId, candidateId, ordinal,
    request: { npcId, sheet: sheet as NpcSheet, controls: controls as Partial<PortraitControls>, visualInputHash,
      slot, neutralAnchorHash: text(request.neutralAnchorHash) },
    neutralAnchorAsset
  };
}
async function workerRpc(client: PortraitWorkerClient, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** Claims one ordinal. Invalid queue data is treated as no work rather than risking an arbitrary provider call. */
export async function claimPortraitGenerationAttempt(client: PortraitWorkerClient): Promise<PortraitGenerationAttempt | null> {
  return asAttempt(await workerRpc(client, 'npc_portrait_claim_generation_attempt'));
}

async function addNeutralIdentityAnchor(
  attempt: PortraitGenerationAttempt,
  storage: PrivatePortraitStorage,
  references: readonly PortraitReference[]
): Promise<PortraitReference[]> {
  if (attempt.request.slot === 'neutral') return [...references];
  const anchor = attempt.neutralAnchorAsset;
  if (!anchor) throw new PortraitProviderError('provider_malformed', 'An optional expression requires its selected Neutral identity anchor.');
  const downloaded = await storage.from(PRIVATE_PORTRAIT_MASTER_BUCKET).download(anchor.masterStorageKey);
  if (downloaded.error || !downloaded.data) throw new PortraitProviderError('storage_failed', 'The selected Neutral identity anchor is unavailable.');
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  if (hash(bytes) !== anchor.sha256) throw new PortraitProviderError('storage_failed', 'The selected Neutral identity anchor did not match its approved hash.');
  return [...references, { revision: `neutral-anchor@${anchor.sha256.slice(0, 12)}`, filename: 'selected-neutral-anchor.png', sha256: anchor.sha256, bytes }];
}

async function markDispatched(client: PortraitWorkerClient, attempt: PortraitGenerationAttempt): Promise<void> {
  await workerRpc(client, 'npc_portrait_mark_generation_dispatched', {
    p_attempt_id: attempt.attemptId, p_lease_token: attempt.leaseToken
  });
}
async function completeAttempt(
  client: PortraitWorkerClient,
  attempt: PortraitGenerationAttempt,
  result: Record<string, unknown>,
  error: string | null
): Promise<void> {
  await workerRpc(client, 'npc_portrait_complete_generation_attempt', {
    p_attempt_id: attempt.attemptId, p_lease_token: attempt.leaseToken, p_result: result, p_error_code: error
  });
}

/**
 * Runs exactly one already-leased ordinal.  The dispatch marker is persisted
 * before the provider call: anything uncertain after that point is terminal,
 * never silently retried or charged a second time.
 */
export async function runPortraitGenerationAttempt(
  client: PortraitWorkerClient,
  attempt: PortraitGenerationAttempt,
  runtime: PortraitWorkerRuntime
): Promise<PortraitAttemptOutcome> {
  const availability = portraitProviderConfiguration(runtime.config);
  if (!availability.available) {
    await completeAttempt(client, attempt, { stage: 'pre_dispatch_failed' }, 'provider_unavailable');
    return { status: 'failed', errorCode: 'provider_unavailable' };
  }
  let baseReferences: PortraitReference[];
  try { baseReferences = runtime.references ? [...runtime.references] : loadPrivatePortraitReferences(runtime.projectRoot); }
  catch (error) {
    const code = errorCode(error); await completeAttempt(client, attempt, { stage: 'pre_dispatch_failed' }, code);
    return { status: 'failed', errorCode: code };
  }
  let references: PortraitReference[];
  try { references = await addNeutralIdentityAnchor(attempt, runtime.storage, baseReferences); }
  catch (error) {
    const code = errorCode(error); await completeAttempt(client, attempt, { stage: 'pre_dispatch_failed' }, code);
    return { status: 'failed', errorCode: code };
  }
  let promptRelease: PromptReleaseSnapshot;
  try {
    if (!runtime.promptRegistry) throw new Error('Prompt registry is required for portrait execution');
    promptRelease = await runtime.promptRegistry.resolveForWork('portrait', attempt.attemptId);
  } catch {
    await completeAttempt(client, attempt, { stage: 'pre_dispatch_failed' }, 'provider_unavailable');
    return { status: 'failed', errorCode: 'provider_unavailable' };
  }
  const renderedPrompt=releaseImagePrompt(promptRelease,'image.community_portrait',{
    portrait_context: portraitPromptContext(attempt.request.sheet,attempt.request.controls), identity_anchor_instruction: portraitIdentityAnchorInstruction(attempt.request.slot)
  });
  const prompt = renderedPrompt.rendered;
  const promptHash = hash(prompt); const referenceHash = referenceSetHash(references);
  const provider = runtime.provider ?? createPortraitProvider(runtime.config);
  const controller = new AbortController(); let leaseLost = false; let dispatched = false; let completionStarted = false;
  let stored: Awaited<ReturnType<typeof storePrivatePortrait>> | null = null;
  const heartbeatMs = Math.max(1_000, Math.min(runtime.heartbeatMs ?? 30_000, 60_000));
  const heartbeat = setInterval(() => {
    void workerRpc(client, 'npc_portrait_heartbeat_generation_attempt', {
      p_attempt_id: attempt.attemptId, p_lease_token: attempt.leaseToken
    }).catch(() => { leaseLost = true; controller.abort(); });
  }, heartbeatMs);
  try {
    // This is the irreversible billing boundary. Do not move it after generate.
    await markDispatched(client, attempt); dispatched = true;
    await runtime.promptRegistry?.recordSafeRun({executionId:`portrait:${attempt.attemptId}`,attempt:attempt.ordinal,workflow:'portrait_generation',nodeKey:'image.community_portrait',prompt:renderedPrompt,status:'started'}).catch(()=>{});
    const configuredDeadline = runtime.timeoutMs ?? (Number(runtime.config.NPC_IMAGE_DEADLINE_MS) || 60_000);
    const generated = await deadline(Math.max(1_000, Math.min(configuredDeadline, 120_000)), (signal) =>
      provider.generate({ idempotencyKey: `${attempt.jobId}:${attempt.ordinal}`, prompt, references,
        alternativeOrdinal: attempt.ordinal, width: 1024, height: 1536, outputFormat: 'png', background: 'transparent' },
      AbortSignal.any([signal, controller.signal])));
    await runtime.promptRegistry?.recordSafeRun({executionId:`portrait:${attempt.attemptId}`,attempt:attempt.ordinal,workflow:'portrait_generation',nodeKey:'image.community_portrait',prompt:renderedPrompt,status:'completed',model:generated.model}).catch(()=>{});
    if (leaseLost) return { status: 'lost_lease' };
    const optimized = await optimisePortraitWebp(generated.bytes);
    stored = await storePrivatePortrait(runtime.storage, optimized, generated.bytes);
    completionStarted = true;
    await completeAttempt(client, attempt, {
      stage: 'completed', candidate: {
        id: attempt.candidateId, ordinal: attempt.ordinal, slot: attempt.request.slot, source: 'ai_generated',
        storageKey: stored.runtimeKey, masterStorageKey: stored.masterKey,
        altText: `Generated ${attempt.request.slot} portrait candidate ${attempt.ordinal} for ${attempt.request.sheet.identity.name}.`,
        mimeType: optimized.runtimeMimeType, width: optimized.width, height: optimized.height, byteSize: optimized.runtimeBytes.length,
        sha256: optimized.runtimeSha256, masterSha256: optimized.sha256, alphaValid: true,
        visualInputHash: attempt.request.visualInputHash, neutralAnchorHash: attempt.request.neutralAnchorHash ?? null,
        provider: generated.provider, model: generated.model, requestId: generated.requestId ?? null,
        promptHash, styleVersion: 'community-npc-portrait-sprite-v1', referenceSetVersion: 'brac-character-look-v1',
        referenceSetHash: referenceHash
      }
    }, null);
    return { status: 'completed' };
  } catch (error) {
    // A rejected dispatch or completion is a fence loss. It must not be
    // followed by another completion attempt from this stale worker.
    if (leaseLost || completionStarted || !dispatched) {
      if (stored) await cleanupStoredPrivatePortrait(runtime.storage, stored);
      return { status: 'lost_lease' };
    }
    const code = errorCode(error);
    await runtime.promptRegistry?.recordSafeRun({executionId:`portrait:${attempt.attemptId}`,attempt:attempt.ordinal,workflow:'portrait_generation',nodeKey:'image.community_portrait',prompt:renderedPrompt,status:'failed',errorCode:code==='storage_failed'?'storage_failed':code==='provider_refused'?'moderation_failed':'provider_failed'}).catch(()=>{});
    // The database charges every dispatched attempt, but only the genuinely
    // unknowable provider outcomes become ambiguous. A refusal, malformed
    // response, invalid image, or storage failure is an ordinary failed
    // candidate with an actionable safe code.
    try { await completeAttempt(client, attempt, { stage: postDispatchFailureStage(error) }, code); }
    catch { return { status: 'lost_lease' }; }
    return { status: 'failed', errorCode: code };
  } finally { clearInterval(heartbeat); }
}

/**
 * Executes a small, explicit batch exactly once per ordinal.  It deliberately
 * does not retry any potentially billable provider request.
 */
export async function runPortraitBatch(client: PortraitCompletionClient, job: PortraitJob, runtime: Runtime): Promise<PortraitBatchOutcome> {
  const availability = portraitProviderConfiguration(runtime.config);
  if (!availability.available) { await complete(client, job, [], 'provider_unavailable'); return { status: 'failed', completed: 0, failed: job.alternatives, errorCode: 'provider_unavailable' }; }
  const alternatives = Math.max(1, Math.min(job.alternatives, 4));
  let references;
  try { references = runtime.references ? [...runtime.references] : loadPrivatePortraitReferences(runtime.projectRoot); }
  catch (error) { const code = errorCode(error); await complete(client, job, [], code); return { status: 'failed', completed: 0, failed: alternatives, errorCode: code }; }
  if (!runtime.promptRelease) return { status: 'failed', completed: 0, failed: alternatives, errorCode: 'provider_unavailable' };
  const provider = runtime.provider ?? createPortraitProvider(runtime.config); const prompt = lockedPortraitPrompt(job.sheet, job.controls, 'neutral', runtime.promptRelease); const promptHash = hash(prompt); const currentVisualHash = job.visualInputHash; const referenceHash = referenceSetHash(references);
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
