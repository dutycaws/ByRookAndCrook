import { canonicalJson, sha256Hex } from './context';
import type { NpcMemoryArtifact, NpcMemoryClaim, NpcMemoryOutcome, NpcMemoryProcessorKind, NpcMemorySource, NpcMemorySummaryV2Provider, NpcMemoryWorkerClient } from './contracts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/i;
const processors = new Set<NpcMemoryProcessorKind>(['extract', 'summary', 'embedding']);

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function claim(value: unknown): NpcMemoryClaim | null {
  if (!object(value)) return null;
  if (!['id', 'fence', 'saveId', 'instanceId', 'sourceId'].every((key) => typeof value[key] === 'string' && uuid.test(value[key] as string))
    || !['dialogue_turn', 'quest_event', 'hospitality', 'resident_evolution', 'memory_set'].includes(String(value.sourceKind)) || !Number.isSafeInteger(value.sourceVersion) || (value.sourceVersion as number) < 1
    || typeof value.sourceHash !== 'string' || !hash.test(value.sourceHash as string)) return null;
  return value as unknown as NpcMemoryClaim;
}
function stale(error: unknown): boolean { return /memory work fence is stale|fence.*stale|stale.*fence|lease/i.test(error instanceof Error ? error.message : String(error)); }
async function rpc(client: NpcMemoryWorkerClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await client.rpc(name, args); if (result.error) throw new Error(result.error.message); return result.data;
}
function fallbackSummary(source: NpcMemorySource): Record<string, unknown> {
  const records = source.records.slice(0, 12).map((record) => ({ id: record.id, speaker: record.speaker, text: record.text, ...(record.quote ? { quote: record.quote } : {}) }));
  // Extractive by design: preserve original words/attribution rather than infer facts.
  return { mode: 'extractive-v1', records, summary: records.map((record) => `${record.speaker}: ${record.text}`).join('\n') };
}
function artifact(kind: 'episode_summary' | 'quest_summary', source: NpcMemorySource): NpcMemoryArtifact {
  const content = fallbackSummary(source);
  return { artifactKind: kind, disclosureClass: source.disclosureClass ?? 'npc_known', content, contentHash: sha256Hex(canonicalJson(content)) };
}

export type NpcMemoryWorkerRuntime = Readonly<{
  processorKind?: NpcMemoryProcessorKind;
  processorVersion?: string;
  loadSource(claim: NpcMemoryClaim): Promise<NpcMemorySource>;
  /** Optional by policy: unavailable embedding infrastructure never fails gameplay work. */
  embed?(text: string, claim: NpcMemoryClaim): Promise<{ vector: string; dimensions: number; model: string }>;
  summaryV2?: NpcMemorySummaryV2Provider;
  /** The explicitly capacity-verified model name; never inferred by the provider. */
  summaryV2Model?: string;
  /** Caller-owned deadline; v2 provider work is never allowed an unbounded controller. */
  summaryV2Signal?: AbortSignal;
  resolvePinnedPrompt?(releaseId: string): Promise<{ releaseId: string; revisionId: string; key: string; contractId: string; contractHash: string; body: string }>;
  recordTelemetry?(event: Readonly<{ jobId: string; batchOrdinal?: number; planHash?: string; promptReleaseId?: string; promptRevisionId?: string; promptKey?: string; status: string; model?: string; durationMs?: number; inputTokens?: number; outputTokens?: number; errorCode?: string }>): Promise<void> | void;
}>;

const V2_HASH = 'f279a108f11e212c77e4876521e9ee47092171b6d2a820d83a245d57a3c64e03';
type SafeTelemetry = { jobId: string; batchOrdinal?: number; planHash?: string; promptReleaseId?: string; promptRevisionId?: string; promptKey?: string; status: string; model?: string; durationMs?: number; inputTokens?: number; outputTokens?: number; errorCode?: string };
const telemetry = async (runtime: NpcMemoryWorkerRuntime, event: SafeTelemetry) => { try { await runtime.recordTelemetry?.(event); } catch { /* telemetry is never durable-work control flow */ } };
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> { return object(value) && Object.keys(value).length === keys.length && keys.every((key) => key in value); }
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && (value as number) >= min;
function plan(value: unknown, job: NpcMemoryClaim): Record<string, unknown> | null {
  const top = ['version','jobId','fence','set','prompt','batchCount','maxSummaryChars','maxCitations','batches','planHash'];
  const setKeys = ['id','setVersion','setHash','summaryKind','cutoffLedgerSequence','disclosureClass'];
  const promptKeys = ['releaseId','key','revisionId','contractId','contractHash'];
  const batchKeys = ['ordinal','firstLeafOrdinal','lastLeafOrdinal','leafCount','maxSummaryChars','maxCitations'];
  if (!exact(value, top) || value.version !== 'npc-memory-summary-v2-runtime-plan-1' || value.jobId !== job.id || value.fence !== job.fence || !object(value.set) || !exact(value.set, setKeys) || !object(value.prompt) || !exact(value.prompt, promptKeys) || !Array.isArray(value.batches) || !integer(value.batchCount, 1) || value.batchCount !== value.batches.length || !integer(value.maxSummaryChars, 1) || !integer(value.maxCitations, 0) || typeof value.planHash !== 'string' || !hash.test(value.planHash)) return null;
  const set = value.set, prompt = value.prompt;
  if (set.id !== job.sourceId || !uuid.test(String(set.id)) || set.setVersion !== job.sourceVersion || set.setHash !== job.sourceHash || !integer(set.setVersion, 1) || !hash.test(String(set.setHash)) || !['episode_summary','quest_summary'].includes(String(set.summaryKind)) || !integer(set.cutoffLedgerSequence, 0) || !['player_visible','npc_known','npc_private','system'].includes(String(set.disclosureClass)) || !uuid.test(String(prompt.releaseId)) || !uuid.test(String(prompt.revisionId)) || prompt.key !== 'npc_memory.summary.v2' || prompt.contractId !== 'npc-memory-summary-v2' || prompt.contractHash !== V2_HASH) return null;
  const n = value.batchCount as number, summaryBudget = Math.floor((12000 - 2 * (n - 1)) / n), citationBudget = Math.floor(128 / n);
  if (value.maxSummaryChars !== summaryBudget || value.maxCitations !== citationBudget) return null;
  let nextLeaf = 0;
  for (let index = 0; index < value.batches.length; index += 1) {
    const batch = value.batches[index];
    if (!exact(batch, batchKeys) || batch.ordinal !== index || !integer(batch.ordinal, 0) || !integer(batch.firstLeafOrdinal, 0) || !integer(batch.lastLeafOrdinal, 0) || !integer(batch.leafCount, 1) || batch.firstLeafOrdinal !== nextLeaf || batch.lastLeafOrdinal < batch.firstLeafOrdinal || batch.leafCount !== batch.lastLeafOrdinal - batch.firstLeafOrdinal + 1 || batch.maxSummaryChars !== summaryBudget || batch.maxCitations !== citationBudget) return null;
    nextLeaf = (batch.lastLeafOrdinal as number) + 1;
  }
  const { planHash, ...unhashed } = value; return sha256Hex(canonicalJson(unhashed)) === planHash ? value : null;
}
function validLoad(value: unknown, job: NpcMemoryClaim, runtimePlan: Record<string, unknown>, batch: Record<string, unknown>): value is Record<string, unknown> {
  const keys = ['jobId','fence','promptReleaseId','promptKey','promptRevisionId','set','batch','leaves'];
  if (!exact(value, keys) || value.jobId !== job.id || value.fence !== job.fence || !object(value.set) || !object(value.batch) || !Array.isArray(value.leaves)) return false;
  const prompt = runtimePlan.prompt as Record<string, unknown>, set = runtimePlan.set as Record<string, unknown>;
  if (value.promptReleaseId !== prompt.releaseId || value.promptKey !== prompt.key || value.promptRevisionId !== prompt.revisionId || canonicalJson(value.set) !== canonicalJson(set) || value.batch.ordinal !== batch.ordinal || value.batch.firstLeafOrdinal !== batch.firstLeafOrdinal || value.batch.lastLeafOrdinal !== batch.lastLeafOrdinal || value.batch.leafCount !== batch.leafCount) return false;
  const first = batch.firstLeafOrdinal as number, last = batch.lastLeafOrdinal as number;
  return value.leaves.length === last - first + 1 && value.leaves.every((leaf, index) => exact(leaf, ['ordinal','sourceKind','sourceId','sourceVersion','sourceHash','ledgerSequence','envelope','records']) && leaf.ordinal === first + index && typeof leaf.sourceKind === 'string' && leaf.sourceKind.length > 0 && uuid.test(String(leaf.sourceId)) && integer(leaf.sourceVersion, 1) && hash.test(String(leaf.sourceHash)) && integer(leaf.ledgerSequence, 0) && Array.isArray(leaf.records) && leaf.records.every((record) => object(record) && uuid.test(String(record.id)) && typeof record.speaker === 'string' && typeof record.text === 'string' && (record.quote === null || record.quote === undefined || typeof record.quote === 'string')));
}
function immutableRefs(load: Record<string, unknown>): unknown[] { return (load.leaves as Record<string, unknown>[]).map(({ ordinal, sourceKind, sourceId, sourceVersion, sourceHash, ledgerSequence }) => ({ ordinal, sourceKind, sourceId, sourceVersion, sourceHash, ledgerSequence })); }
function validPrepared(value: unknown, model: string, maxSummaryChars: number, maxCitations: number): boolean {
  if (!object(value) || !object(value.prepared) || !integer(value.inputTokens, 0) || !integer(value.durationMs, 0)) return false;
  const prepared = value.prepared; if (!Object.isFrozen(prepared) || !Object.isFrozen(prepared.body) || prepared.model !== model || prepared.maxSummaryChars !== maxSummaryChars || prepared.maxCitations !== maxCitations || prepared.inputTokens !== value.inputTokens || !object(prepared.body) || prepared.body.model !== model || prepared.body.store !== false || prepared.body.max_output_tokens !== 4096 || !object(prepared.body.text) || !object(prepared.body.text.format) || !object(prepared.body.text.format.schema)) return false;
  const schema = prepared.body.text.format.schema as Record<string, unknown>; return object(schema.properties) && object(schema.properties.summary) && schema.properties.summary.maxLength === maxSummaryChars && object(schema.properties.citations) && schema.properties.citations.maxItems === maxCitations;
}
function validBatchResult(value: unknown, load: Record<string, unknown>, batch: Record<string, unknown>): value is Record<string, unknown> {
  const rawSummaryChars = batch.maxSummaryChars, rawCitations = batch.maxCitations;
  if (!Number.isSafeInteger(rawSummaryChars) || !Number.isSafeInteger(rawCitations)) return false;
  const maxSummaryChars = rawSummaryChars as number, maxCitations = Math.min(rawCitations as number, 16);
  if (!exact(value, ['version','mode','summary','citations','protectedRefs','leaves']) || value.version !== 'npc-memory-summary-v2' || value.mode !== 'model' || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > maxSummaryChars || !Array.isArray(value.citations) || value.citations.length > maxCitations || !Array.isArray(value.leaves) || !Array.isArray(value.protectedRefs)) return false;
  const refs = immutableRefs(load);
  if (canonicalJson(value.leaves) !== canonicalJson(refs) || canonicalJson(value.protectedRefs) !== canonicalJson(refs)) return false;
  let priorLeaf = -1, priorRecord = '';
  return value.citations.every((c) => {
    if (!exact(c, ['leafOrdinal','recordId','speaker','quote','sourceKind','sourceId','sourceVersion','sourceHash']) || !integer(c.leafOrdinal, 0) || !uuid.test(String(c.recordId)) || typeof c.speaker !== 'string' || typeof c.quote !== 'string' || !c.quote.trim() || [...c.quote].length > 12000 || typeof c.sourceKind !== 'string' || !uuid.test(String(c.sourceId)) || !integer(c.sourceVersion, 1) || !hash.test(String(c.sourceHash)) || (c.leafOrdinal as number) < priorLeaf || ((c.leafOrdinal as number) === priorLeaf && String(c.recordId) <= priorRecord)) return false;
    const leaf = (load.leaves as unknown[]).find((candidate) => object(candidate) && candidate.ordinal === c.leafOrdinal);
    const record = object(leaf) && Array.isArray(leaf.records) ? leaf.records.find((candidate) => object(candidate) && candidate.id === c.recordId) : undefined;
    if (!object(leaf) || !object(record) || leaf.sourceKind !== c.sourceKind || leaf.sourceId !== c.sourceId || leaf.sourceVersion !== c.sourceVersion || leaf.sourceHash !== c.sourceHash || record.speaker !== c.speaker || (record.quote !== c.quote && (typeof record.text !== 'string' || !record.text.includes(c.quote)))) return false;
    priorLeaf = c.leafOrdinal as number; priorRecord = String(c.recordId); return true;
  });
}
async function runSummaryV2(client: NpcMemoryWorkerClient, job: NpcMemoryClaim, runtime: NpcMemoryWorkerRuntime): Promise<NpcMemoryOutcome> {
  let safe: Pick<SafeTelemetry, 'planHash' | 'promptReleaseId' | 'promptRevisionId' | 'promptKey'> = {};
  let finalizerAttempted = false;
  const final = async (errorCode?: string): Promise<NpcMemoryOutcome> => { finalizerAttempted = true; const response = await rpc(client, 'world_npc_memory_summary_finalize_v2', { p_job_id: job.id, p_fence: job.fence }); if (!exact(response, ['status','fallback','contentHash']) || !['completed','reused'].includes(String(response.status)) || typeof response.fallback !== 'boolean' || !hash.test(String(response.contentHash))) throw new Error('Summary finalizer response was malformed'); const fallback = response.fallback; await telemetry(runtime, { jobId: job.id, ...safe, status: errorCode ? 'failed' : 'completed', errorCode }); return { status: 'completed', artifacts: 1, fallback }; };
  try {
    const runtimePlan = plan(await rpc(client, 'world_npc_memory_summary_plan_v2', { p_job_id: job.id, p_fence: job.fence }), job);
    if (!runtimePlan || !runtime.summaryV2 || !runtime.resolvePinnedPrompt) return await final('worker_failed');
    const planPrompt = runtimePlan.prompt as Record<string, unknown>;
    safe = { planHash: runtimePlan.planHash as string, promptReleaseId: planPrompt.releaseId as string, promptRevisionId: planPrompt.revisionId as string, promptKey: planPrompt.key as string };
    const pinned = await runtime.resolvePinnedPrompt(planPrompt.releaseId as string);
    if (!pinned.body.trim() || pinned.releaseId !== planPrompt.releaseId || pinned.revisionId !== planPrompt.revisionId || pinned.key !== planPrompt.key || pinned.contractId !== planPrompt.contractId || pinned.contractHash !== planPrompt.contractHash) return await final('worker_failed');
    for (const rawBatch of runtimePlan.batches as unknown[]) {
      if (!object(rawBatch)) return await final('worker_failed');
      const ordinal = rawBatch.ordinal as number; const recovery = await rpc(client, 'world_npc_memory_summary_recover_dispatch', { p_job_id: job.id, p_fence: job.fence, p_batch_ordinal: ordinal });
      if (object(recovery) && recovery.directive === 'reuse_result') continue;
      if (!object(recovery) || recovery.directive !== 'fallback_only' || recovery.reason !== 'no_prior_receipt') return await final('worker_failed');
      const load = await rpc(client, 'world_npc_memory_summary_load', { p_job_id: job.id, p_fence: job.fence, p_batch_ordinal: ordinal });
      if (!validLoad(load, job, runtimePlan, rawBatch)) return await final('worker_failed');
      if (!runtime.summaryV2Model || !runtime.summaryV2Signal) return await final('worker_failed');
      const receipt = await rpc(client, 'world_npc_memory_summary_prepare_dispatch', { p_job_id: job.id, p_fence: job.fence, p_batch_ordinal: ordinal });
      if (!object(receipt) || receipt.state !== 'prepared' || typeof receipt.idempotencyKey !== 'string' || !hash.test(String(receipt.identityHash)) || !hash.test(String(receipt.requestHash))) return await final('worker_failed');
      const maxCitations = Math.min(rawBatch.maxCitations as number, 16);
      const preflight = await runtime.summaryV2.preflight({ systemPrompt: pinned.body, payload: load, model: runtime.summaryV2Model, maxSummaryChars: rawBatch.maxSummaryChars as number, maxCitations, maxBytes: 384 * 1024, signal: runtime.summaryV2Signal });
      if (!validPrepared(preflight, runtime.summaryV2Model, rawBatch.maxSummaryChars as number, maxCitations)) return await final('provider_malformed');
      await rpc(client, 'world_npc_memory_summary_mark_dispatched', { p_job_id: job.id, p_fence: job.fence, p_batch_ordinal: ordinal, p_provider_request_id: null });
      const result = await runtime.summaryV2.generate({ prepared: preflight.prepared, signal: runtime.summaryV2Signal });
      if (result.model !== runtime.summaryV2Model || !integer(result.inputTokens, 0) || !integer(result.outputTokens, 0) || !integer(result.durationMs, 0) || !validBatchResult(result.result, load, rawBatch)) return await final('provider_malformed');
      await rpc(client, 'world_npc_memory_summary_record_dispatch_result', { p_job_id: job.id, p_fence: job.fence, p_batch_ordinal: ordinal, p_result: result.result, p_model: result.model, p_provider_request_id: result.providerRequestId ?? null });
      await telemetry(runtime, { jobId: job.id, batchOrdinal: ordinal, ...safe, status: 'completed', model: result.model, durationMs: result.durationMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    }
    return await final();
  } catch (error) { if (stale(error)) return { status: 'lease_lost' }; if (finalizerAttempted) return { status: 'failed', errorCode: 'worker_failed' }; try { return await final(error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'worker_failed'); } catch (finalError) { return stale(finalError) ? { status: 'lease_lost' } : { status: 'failed', errorCode: 'worker_failed' }; } }
}

/** Runs one fenced derived-memory job. It cannot alter quests, profiles, or any game effect. */
export async function runNpcMemoryClaim(client: NpcMemoryWorkerClient, rawClaim: unknown, runtime: NpcMemoryWorkerRuntime): Promise<NpcMemoryOutcome> {
  if (object(rawClaim) && rawClaim.status === 'idle') return { status: 'idle' };
  const job = claim(rawClaim); if (!job) return { status: 'failed', errorCode: 'claim_malformed' };
  const processor = runtime.processorKind ?? 'extract';
  if (!processors.has(processor) || !runtime.processorVersion) return { status: 'failed', errorCode: 'worker_misconfigured' };
  if (processor === 'summary' && runtime.processorVersion === 'npc-memory-summary-v2' && job.sourceKind === 'memory_set') return runSummaryV2(client, job, runtime);
  try {
    const source = await runtime.loadSource(job);
    let artifacts: NpcMemoryArtifact[] = [];
    let fallback = false;
    if (processor === 'summary') { artifacts = [artifact(job.sourceKind === 'quest_event' ? 'quest_summary' : 'episode_summary', source)]; fallback = true; }
    if (processor === 'embedding' && runtime.embed) {
      const content = fallbackSummary(source); const embedded = await runtime.embed(String(content.summary), job);
      artifacts = [{ artifactKind: 'embedding', disclosureClass: source.disclosureClass ?? 'npc_known', model: embedded.model, content, contentHash: sha256Hex(canonicalJson(content)), embedding: embedded.vector, embeddingDimensions: embedded.dimensions }];
    }
    // Extract work reuses committed dialogue remember output through loadSource;
    // no second model extraction or authoritative write occurs here.
    await rpc(client, 'world_npc_memory_complete', { p_job_id: job.id, p_fence: job.fence, p_artifacts: artifacts, p_error_code: null });
    return { status: 'completed', artifacts: artifacts.length, fallback };
  } catch (cause) {
    if (stale(cause)) return { status: 'lease_lost' };
    const errorCode = cause instanceof Error && cause.message === 'source_unavailable' ? 'source_unavailable' : 'worker_failed';
    try { await rpc(client, 'world_npc_memory_complete', { p_job_id: job.id, p_fence: job.fence, p_artifacts: [], p_error_code: errorCode }); }
    catch (completeError) { if (stale(completeError)) return { status: 'lease_lost' }; }
    return { status: 'failed', errorCode };
  }
}

/** Claims a bounded number of jobs through the server-private outbox contract. */
export async function drainNpcMemoryQueue(limit: number, client: NpcMemoryWorkerClient, runtime: NpcMemoryWorkerRuntime): Promise<NpcMemoryOutcome[]> {
  const outcomes: NpcMemoryOutcome[] = [];
  const processor = runtime.processorKind ?? 'extract';
  for (let index = 0; index < Math.max(0, Math.min(limit, 32)); index += 1) {
    let next: unknown;
    try { next = await rpc(client, 'world_npc_memory_claim', { p_processor_kind: processor, p_processor_version: runtime.processorVersion ?? 'npc-memory-v1' }); }
    catch { break; }
    const outcome = await runNpcMemoryClaim(client, next ?? { status: 'idle' }, runtime); outcomes.push(outcome);
    if (outcome.status === 'idle') break;
  }
  return outcomes;
}
