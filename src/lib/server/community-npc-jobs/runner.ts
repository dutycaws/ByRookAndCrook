import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import type { Json, Database } from '$lib/database.types';
import { canonicalNpcSheet, validateNpcSheet, type NpcSheet } from '$lib/game/npc-sheet';
import { getSupabaseConfig } from '$lib/server/config';
import { privateRuntimeEnvironment } from '$lib/server/private-runtime-environment';
import { listLocalSceneAssets, type LocalSceneAsset } from './local-assets';
import {
  authoringProviderAvailability as availabilityFor,
  createAuthoringProvider,
  AuthoringProviderError,
  type AuthoringProvider,
  type AuthoringProviderAvailability,
  type SandboxTurn
} from './provider';
import { promptRegistryService, type PromptRegistryClient } from '$lib/server/prompt-registry/service';
import { releaseTextPrompt, type PromptReleaseSnapshot } from '$lib/server/prompt-registry';
import type { PromptRegistryService } from '$lib/server/prompt-registry/service';

export type AuthoringJobKind = 'assist' | 'scene' | 'sandbox';
export type AssistanceSection = 'identity' | 'appearance' | 'personality' | 'lore' | 'skills' | 'campaign';
export type QueuedAuthoringJob = {
  jobId: string; npcId: string; kind: AuthoringJobKind; section?: string; instruction?: string;
  /** Legacy field retained while the route migrates to full-sheet input. */
  currentSection?: Json; message?: string; sheet?: NpcSheet; turns?: SandboxTurn[];
};
export type AuthoringProviderJob =
  | { jobId: string; npcId: string; kind: 'assist'; section: AssistanceSection; instruction: string; sheet: NpcSheet }
  | { jobId: string; npcId: string; kind: 'sandbox'; sheet: NpcSheet; turns: SandboxTurn[] };

type RpcResult = { error: { message: string } | null };
export type CompletionClient = { rpc(name: string, args: Record<string, unknown>): Promise<RpcResult> };
export type AuthoringJobOutcome = { status: 'completed' | 'failed'; errorCode?: string };
export type LocalJobOutcome = AuthoringJobOutcome;
export type LocalJobRuntime = { sceneAssets?: LocalSceneAsset[]; provider?: AuthoringProvider; timeoutMs?: number; promptRelease?: PromptReleaseSnapshot; promptRegistry?: PromptRegistryService };
export type LocalEvaluationOutcome = { status: 'completed' | 'failed'; errorCode?: string; hardBlockCount?: number };

const sections = new Set<AssistanceSection>(['identity', 'appearance', 'personality', 'lore', 'skills', 'campaign']);
function clipped(value: string, maximum: number): string { return value.replace(/\s+/g, ' ').trim().slice(0, maximum); }
function jsonEqual(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
function sectionJob(job: QueuedAuthoringJob): job is Extract<AuthoringProviderJob, { kind: 'assist' }> {
  return job.kind === 'assist' && !!job.sheet && typeof job.instruction === 'string' && sections.has(job.section as AssistanceSection);
}
function sandboxJob(job: QueuedAuthoringJob): job is Extract<AuthoringProviderJob, { kind: 'sandbox' }> {
  return job.kind === 'sandbox' && !!job.sheet && Array.isArray(job.turns) && job.turns.length > 0;
}

function runtimeConfig() { return privateRuntimeEnvironment(env); }
export function authoringProviderAvailability(config: Record<string, string | undefined> = runtimeConfig()): AuthoringProviderAvailability { return availabilityFor(config); }
async function complete(client: CompletionClient, name: string, args: Record<string, unknown>): Promise<void> {
  const result = await client.rpc(name, args); if (result.error) throw new Error(result.error.message);
}
async function recordFailure(client: CompletionClient, job: QueuedAuthoringJob, errorCode: string): Promise<AuthoringJobOutcome> {
  try {
    if (job.kind === 'assist') await complete(client, 'npc_author_assistance_complete', { p_job_id: job.jobId, p_proposal: {}, p_error_code: errorCode });
    if (job.kind === 'scene') await complete(client, 'npc_author_scene_complete', { p_job_id: job.jobId, p_candidates: [], p_error_code: errorCode });
    if (job.kind === 'sandbox') await complete(client, 'npc_author_sandbox_complete', { p_job_id: job.jobId, p_reply: '', p_error_code: errorCode });
  } catch { /* A fenced retry may already have persisted the winner. */ }
  return { status: 'failed', errorCode };
}
function failureCode(cause: unknown): string { return cause instanceof AuthoringProviderError ? cause.code : 'provider_failed'; }
async function withinDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await operation(controller.signal); }
  catch (cause) {
    if (controller.signal.aborted) throw new AuthoringProviderError('provider_timeout', 'The provider request timed out.');
    throw cause;
  } finally { clearTimeout(timer); }
}
function validSheet(sheet: NpcSheet): boolean { return validateNpcSheet(sheet).length === 0; }
function candidateWithSection(sheet: NpcSheet, section: AssistanceSection, replacement: unknown): NpcSheet { return { ...structuredClone(sheet), [section]: replacement } as NpcSheet; }

/** Provider work is synchronous; only service-only completion RPCs persist terminal state. */
export async function runAuthoringJob(client: CompletionClient, job: AuthoringProviderJob, runtime: LocalJobRuntime): Promise<AuthoringJobOutcome> {
  const provider = runtime.provider;
  if (!provider) return recordFailure(client, job, 'provider_unavailable');
  if (!validSheet(job.sheet)) return recordFailure(client, job, 'provider_malformed');
  const timeoutMs = Math.max(1_000, Math.min(runtime.timeoutMs ?? 30_000, 90_000));
  const prompt = runtime.promptRelease ? releaseTextPrompt(runtime.promptRelease, job.kind === 'assist' ? 'authoring.assist' : 'authoring.sandbox') : null;
  if (!prompt) return recordFailure(client, job, 'provider_unavailable');
  try {
    await runtime.promptRegistry?.recordSafeRun({executionId:job.jobId,attempt:0,workflow:'authoring',nodeKey:prompt.key,prompt,status:'started'}).catch(()=>{});
    if (job.kind === 'assist') {
      const response = await withinDeadline((signal) => provider.assist({ section: job.section, instruction: clipped(job.instruction, 2_000), sheet: structuredClone(job.sheet) }, signal), timeoutMs);
      const candidate = candidateWithSection(job.sheet, job.section, response.replacement);
      if (!response.explanation.trim() || response.explanation.length > 600 || !validSheet(candidate)) return recordFailure(client, job, 'provider_malformed');
      if (jsonEqual(job.sheet[job.section], response.replacement) || canonicalNpcSheet(candidate) === canonicalNpcSheet(job.sheet)) return recordFailure(client, job, 'provider_no_change');
      await complete(client, 'npc_author_assistance_complete', { p_job_id: job.jobId, p_proposal: { replacement: response.replacement, explanation: clipped(response.explanation, 600), provider: 'openai-responses' } as Json, p_error_code: null });
      await runtime.promptRegistry?.recordSafeRun({executionId:job.jobId,attempt:0,workflow:'authoring',nodeKey:prompt.key,prompt,status:'completed'}).catch(()=>{});
      return { status: 'completed' };
    }
    const turns = job.turns.map((turn) => ({ role: turn.role, content: clipped(turn.content, 2_000) })).filter((turn) => turn.content);
    if (!turns.length || turns.at(-1)?.role !== 'keeper') return recordFailure(client, job, 'provider_malformed');
    const response = await withinDeadline((signal) => provider.sandbox({ sheet: structuredClone(job.sheet), turns }, signal), timeoutMs);
    if (!response.reply.trim() || response.reply.length > 4_000) return recordFailure(client, job, 'provider_malformed');
    await complete(client, 'npc_author_sandbox_complete', { p_job_id: job.jobId, p_reply: response.reply.trim(), p_error_code: null });
    await runtime.promptRegistry?.recordSafeRun({executionId:job.jobId,attempt:0,workflow:'authoring',nodeKey:prompt.key,prompt,status:'completed'}).catch(()=>{});
    return { status: 'completed' };
  } catch (cause) { await runtime.promptRegistry?.recordSafeRun({executionId:job.jobId,attempt:0,workflow:'authoring',nodeKey:prompt.key,prompt,status:'failed',errorCode:'provider_failed'}).catch(()=>{}); return recordFailure(client, job, failureCode(cause)); }
}

/** Scene selection remains a deterministic local-asset fixture by design. */
async function runSceneFixture(client: CompletionClient, job: QueuedAuthoringJob, runtime: LocalJobRuntime): Promise<AuthoringJobOutcome> {
  const asset = (runtime.sceneAssets ?? listLocalSceneAssets())[0]; if (!asset) return recordFailure(client, job, 'local_scene_asset_missing');
  const prompt = clipped(job.instruction ?? '', 280);
  try {
    await complete(client, 'npc_author_scene_complete', { p_job_id: job.jobId, p_candidates: [{ storageKey: asset.storageKey, altText: prompt ? `Local scene fixture selected for the authored prompt: ${prompt}` : 'Local scene fixture selected from the ignored runtime derivative catalog.', generation: { provider: 'local-fixture', localFilename: asset.localFilename } }], p_error_code: null });
    return { status: 'completed' };
  } catch { return recordFailure(client, job, 'local_authoring_worker_failed'); }
}

/** Compatibility entry point. It never manufactures assistance or sandbox success. */
export async function runLocalAuthoringJob(client: CompletionClient, job: QueuedAuthoringJob, runtime: LocalJobRuntime = {}): Promise<LocalJobOutcome> {
  if (job.kind === 'scene') return runSceneFixture(client, job, runtime);
  if (sectionJob(job) || sandboxJob(job)) return runAuthoringJob(client, job, runtime);
  return recordFailure(client, job, 'provider_malformed');
}

/** Service-role client exists only in this server module and is never bundled. */
export function localAuthoringCompletionClient(): CompletionClient | null {
  const config = runtimeConfig();
  if (!config.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { url } = getSupabaseConfig(); return createClient<Database>(url, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as CompletionClient;
}
export async function dispatchAuthoringJob(job: QueuedAuthoringJob): Promise<AuthoringJobOutcome> {
  const client = localAuthoringCompletionClient(); if (!client) return { status: 'failed', errorCode: 'provider_unavailable' };
  if (job.kind === 'scene') return runSceneFixture(client, job, {});
  const config = runtimeConfig();
  if (!authoringProviderAvailability(config).available) return recordFailure(client, job, 'provider_unavailable');
  try {
    const registry=promptRegistryService(client as unknown as PromptRegistryClient);
    const release=await registry.resolveForWork('authoring',job.jobId);
    return runLocalAuthoringJob(client, job, { provider: createAuthoringProvider(config,release), promptRelease:release, promptRegistry:registry, timeoutMs: Number(config.NPC_AUTHORING_DEADLINE_MS) || 30_000 });
  } catch { return recordFailure(client, job, 'provider_unavailable'); }
}
/** Legacy name retained so routes can migrate without a split deployment. */
export const dispatchLocalAuthoringJob = dispatchAuthoringJob;

/** Runs only deterministic schema checks; it intentionally does not claim model evaluation. */
export async function runLocalNpcEvaluation(client: CompletionClient, versionId: string, sheet: unknown): Promise<LocalEvaluationOutcome> {
  const issues = validateNpcSheet(sheet);
  const result: Json = { evaluator: 'local-structural-fixture-v1', mode: 'deterministic-local-structural-validation', hardBlocks: issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })), advisories: ['No live provider or subjective voice-quality evaluation was run. Reviewer judgment remains required.'], prohibited: false } as Json;
  try { await complete(client, 'npc_evaluation_complete', { p_version: versionId, p_result: result, p_error_code: null }); return { status: 'completed', hardBlockCount: issues.length }; }
  catch { try { await complete(client, 'npc_evaluation_complete', { p_version: versionId, p_result: {}, p_error_code: 'local_evaluation_worker_failed' }); } catch { /* retry winner */ } return { status: 'failed', errorCode: 'local_evaluation_worker_failed' }; }
}
export async function dispatchLocalNpcEvaluation(versionId: string, sheet: unknown): Promise<LocalEvaluationOutcome> {
  const client = localAuthoringCompletionClient(); if (!client) return { status: 'failed', errorCode: 'local_authoring_service_unconfigured' };
  return runLocalNpcEvaluation(client, versionId, sheet);
}
