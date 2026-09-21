import { canonicalJson, sha256Hex } from './context';
import type { NpcMemoryArtifact, NpcMemoryClaim, NpcMemoryOutcome, NpcMemoryProcessorKind, NpcMemorySource, NpcMemoryWorkerClient } from './contracts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/i;
const processors = new Set<NpcMemoryProcessorKind>(['extract', 'summary', 'embedding']);

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function claim(value: unknown): NpcMemoryClaim | null {
  if (!object(value)) return null;
  if (!['id', 'fence', 'saveId', 'instanceId', 'sourceId'].every((key) => typeof value[key] === 'string' && uuid.test(value[key] as string))
    || !['dialogue_turn', 'quest_event'].includes(String(value.sourceKind)) || !Number.isSafeInteger(value.sourceVersion) || (value.sourceVersion as number) < 1
    || typeof value.sourceHash !== 'string' || !hash.test(value.sourceHash as string)) return null;
  return value as unknown as NpcMemoryClaim;
}
function stale(error: unknown): boolean { return /memory work fence is stale|stale.*fence|lease/i.test(error instanceof Error ? error.message : String(error)); }
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
}>;

/** Runs one fenced derived-memory job. It cannot alter quests, profiles, or any game effect. */
export async function runNpcMemoryClaim(client: NpcMemoryWorkerClient, rawClaim: unknown, runtime: NpcMemoryWorkerRuntime): Promise<NpcMemoryOutcome> {
  if (object(rawClaim) && rawClaim.status === 'idle') return { status: 'idle' };
  const job = claim(rawClaim); if (!job) return { status: 'failed', errorCode: 'claim_malformed' };
  const processor = runtime.processorKind ?? 'extract';
  if (!processors.has(processor) || !runtime.processorVersion) return { status: 'failed', errorCode: 'worker_misconfigured' };
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
