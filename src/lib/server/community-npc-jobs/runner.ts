import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import type { Json, Database } from '$lib/database.types';
import { validateNpcSheet } from '$lib/game/npc-sheet';
import { getSupabaseConfig } from '$lib/server/config';
import { listLocalSceneAssets, type LocalSceneAsset } from './local-assets';

export type AuthoringJobKind = 'assist' | 'scene' | 'sandbox';
export type QueuedAuthoringJob = {
  jobId: string;
  npcId: string;
  kind: AuthoringJobKind;
  section?: string;
  instruction?: string;
  currentSection?: Json;
  message?: string;
};

type RpcResult = { error: { message: string } | null };
export type CompletionClient = {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
};

export type LocalJobOutcome = { status: 'completed' | 'failed'; errorCode?: string };
export type LocalJobRuntime = { sceneAssets?: LocalSceneAsset[] };
export type LocalEvaluationOutcome = { status: 'completed' | 'failed'; errorCode?: string; hardBlockCount?: number };

function clipped(value: string, maximum: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function deterministicAssistance(job: QueuedAuthoringJob): Json {
  const instruction = clipped(job.instruction ?? '', 240);
  // Local fixtures deliberately preserve the author supplied section. This
  // produces a reviewable proposal while avoiding a fake model claim.
  return {
    replacement: job.currentSection ?? {},
    note: instruction
      ? `Local fixture proposal preserved the current ${job.section} section for review: ${instruction}`
      : `Local fixture proposal preserved the current ${job.section} section for review.`
  } as Json;
}

function deterministicSandboxReply(job: QueuedAuthoringJob): string {
  const message = clipped(job.message ?? '', 320);
  return message
    ? `Local sandbox fixture received: “${message}” This isolated reply cannot alter the draft.`
    : 'Local sandbox fixture is waiting for a keeper message.';
}

async function complete(client: CompletionClient, name: string, args: Record<string, unknown>): Promise<void> {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
}

async function recordFailure(client: CompletionClient, job: QueuedAuthoringJob, errorCode: string): Promise<LocalJobOutcome> {
  try {
    if (job.kind === 'assist') await complete(client, 'npc_author_assistance_complete', { p_job_id: job.jobId, p_proposal: {}, p_error_code: errorCode });
    if (job.kind === 'scene') await complete(client, 'npc_author_scene_complete', { p_job_id: job.jobId, p_candidates: [], p_error_code: errorCode });
    if (job.kind === 'sandbox') await complete(client, 'npc_author_sandbox_complete', { p_job_id: job.jobId, p_reply: '', p_error_code: errorCode });
  } catch {
    // The first completion may have won a retry race. Never claim a later
    // state that this worker did not persist.
  }
  return { status: 'failed', errorCode };
}

/** Runs one queued authoring job using only deterministic local fixtures. */
export async function runLocalAuthoringJob(client: CompletionClient, job: QueuedAuthoringJob, runtime: LocalJobRuntime = {}): Promise<LocalJobOutcome> {
  try {
    if (job.kind === 'assist') {
      await complete(client, 'npc_author_assistance_complete', { p_job_id: job.jobId, p_proposal: deterministicAssistance(job), p_error_code: null });
      return { status: 'completed' };
    }
    if (job.kind === 'sandbox') {
      await complete(client, 'npc_author_sandbox_complete', { p_job_id: job.jobId, p_reply: deterministicSandboxReply(job), p_error_code: null });
      return { status: 'completed' };
    }
    const asset = (runtime.sceneAssets ?? listLocalSceneAssets())[0];
    if (!asset) return recordFailure(client, job, 'local_scene_asset_missing');
    const prompt = clipped(job.instruction ?? '', 280);
    await complete(client, 'npc_author_scene_complete', {
      p_job_id: job.jobId,
      p_candidates: [{
        storageKey: asset.storageKey,
        altText: prompt
          ? `Local scene fixture selected for the authored prompt: ${prompt}`
          : 'Local scene fixture selected from the ignored runtime derivative catalog.',
        generation: { provider: 'local-fixture', localFilename: asset.localFilename }
      }],
      p_error_code: null
    });
    return { status: 'completed' };
  } catch {
    return recordFailure(client, job, 'local_authoring_worker_failed');
  }
}

/** Service-role client exists only in this server module and is never bundled. */
export function localAuthoringCompletionClient(): CompletionClient | null {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { url } = getSupabaseConfig();
  return createClient<Database>(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as CompletionClient;
}

/**
 * Runs after a queue RPC has committed. Failure is persisted through the
 * completion RPC so a page reload reports the real terminal state.
 */
export async function dispatchLocalAuthoringJob(job: QueuedAuthoringJob): Promise<LocalJobOutcome> {
  const client = localAuthoringCompletionClient();
  if (!client) return { status: 'failed', errorCode: 'local_authoring_service_unconfigured' };
  return runLocalAuthoringJob(client, job);
}

/**
 * Runs only deterministic schema checks. It intentionally does not claim a
 * model, voice, safety, or subjective quality evaluation took place.
 */
export async function runLocalNpcEvaluation(client: CompletionClient, versionId: string, sheet: unknown): Promise<LocalEvaluationOutcome> {
  const issues = validateNpcSheet(sheet);
  const result: Json = {
    evaluator: 'local-structural-fixture-v1',
    mode: 'deterministic-local-structural-validation',
    hardBlocks: issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })),
    advisories: [
      'No live provider or subjective voice-quality evaluation was run. Reviewer judgment remains required.'
    ],
    prohibited: false
  } as Json;
  try {
    await complete(client, 'npc_evaluation_complete', { p_version: versionId, p_result: result, p_error_code: null });
    return { status: 'completed', hardBlockCount: issues.length };
  } catch {
    try {
      await complete(client, 'npc_evaluation_complete', { p_version: versionId, p_result: {}, p_error_code: 'local_evaluation_worker_failed' });
    } catch {
      // A retry may already have completed the evaluation.
    }
    return { status: 'failed', errorCode: 'local_evaluation_worker_failed' };
  }
}

export async function dispatchLocalNpcEvaluation(versionId: string, sheet: unknown): Promise<LocalEvaluationOutcome> {
  const client = localAuthoringCompletionClient();
  if (!client) return { status: 'failed', errorCode: 'local_authoring_service_unconfigured' };
  return runLocalNpcEvaluation(client, versionId, sheet);
}
