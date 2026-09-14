/**
 * Privacy-safe AI execution telemetry.
 *
 * This module deliberately has no generic metadata field. A caller can record
 * operational facts only; prompts, player prose, frozen profiles, beliefs,
 * provider output, secrets, and reasoning therefore have no representable
 * path through the event contract.
 */
export const AI_OBSERVABILITY_VERSION = 'ai-observability-v1' as const;

export type AiWorkflow = 'dialogue' | 'world_settlement';
export type AiEventStatus = 'started' | 'completed' | 'failed' | 'skipped' | 'reused';
export type AiTokenUsage = { input: number; output: number };

/** Current provider-call checkpoints. These are operational labels, not prompts. */
export const DIALOGUE_AI_STAGES = ['investigate0', 'investigate1', 'deliberate', 'speak', 'review', 'rewrite', 'rereview', 'remember'] as const;
export const WORLD_SETTLEMENT_AI_STAGES = [
  'proposer', 'critic', 'repair', 'final_critic', 'digest', 'validated',
  'canon_proposer', 'canon_critic', 'canon_repair', 'canon_final_critic',
  'canon_validate', 'canon_commit', 'news_aggregate', 'news_commit', 'safe_fallback',
  'social_encounter_proposer', 'social_encounter_critic', 'social_encounter_repair',
  'social_encounter_final_critic', 'social_encounter_validate', 'social_encounter_commit',
  'social_encounter_fallback'
] as const;

export type AiObservabilityEvent = Readonly<{
  version: typeof AI_OBSERVABILITY_VERSION;
  occurredAt: string;
  correlationId: string;
  workflow: AiWorkflow;
  stage: string;
  status: AiEventStatus;
  attempt: number;
  durationMs?: number;
  model?: string;
  tokenUsage?: AiTokenUsage;
  errorCode?: string;
}>;

/** The input mirrors the persisted event exactly. Arbitrary metadata is forbidden. */
export type AiObservabilityInput = Readonly<{
  correlationId: string;
  workflow: AiWorkflow;
  stage: string;
  status: AiEventStatus;
  attempt: number;
  durationMs?: number;
  model?: string;
  tokenUsage?: AiTokenUsage;
  errorCode?: unknown;
}>;

export type AiObservabilitySink = (event: AiObservabilityEvent) => void | Promise<void>;

const workflowSet = new Set<AiWorkflow>(['dialogue', 'world_settlement']);
const statusSet = new Set<AiEventStatus>(['started', 'completed', 'failed', 'skipped', 'reused']);
const opaqueId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const stageName = /^[a-z][a-z0-9_:-]{0,79}$/;
const modelName = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const permittedErrors = new Set([
  'provider_unavailable', 'provider_timeout', 'provider_malformed', 'provider_failed',
  'worker_failed', 'claim_malformed', 'lease_unavailable', 'lease_lost', 'commit_unknown',
  'validation_rejected', 'commit_rejected', 'commit_conflict',
  'context_budget', 'budget', 'structure', 'consistency', 'state_changed', 'internal_error'
]);

function finiteInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function tokenUsage(value: unknown): AiTokenUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!finiteInteger(candidate.input, 0, 10_000_000) || !finiteInteger(candidate.output, 0, 10_000_000)) return undefined;
  return { input: candidate.input, output: candidate.output };
}

/**
 * Never forward raw error text. Known error codes survive; every other cause
 * becomes a single safe bucket that cannot leak a provider response or secret.
 */
export function sanitizeAiErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 80);
  if (!normalized) return undefined;
  return permittedErrors.has(normalized) ? normalized : 'internal_error';
}

/**
 * Creates an allow-listed event. Invalid operational input is discarded rather
 * than being stringified, logged, or allowed to influence the game flow.
 */
export function createAiObservabilityEvent(input: AiObservabilityInput, now: () => Date = () => new Date()): AiObservabilityEvent | null {
  if (!opaqueId.test(input.correlationId) || !workflowSet.has(input.workflow) || !stageName.test(input.stage)
    || !statusSet.has(input.status) || !finiteInteger(input.attempt, 1, 1_000)) return null;
  const allowedStages = input.workflow === 'dialogue' ? DIALOGUE_AI_STAGES : WORLD_SETTLEMENT_AI_STAGES;
  if (!(allowedStages as readonly string[]).includes(input.stage)) return null;
  if (input.durationMs !== undefined && !finiteInteger(input.durationMs, 0, 24 * 60 * 60 * 1_000)) return null;
  if (input.model !== undefined && !modelName.test(input.model)) return null;
  if (input.tokenUsage !== undefined && !tokenUsage(input.tokenUsage)) return null;

  let occurredAt: string;
  try {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null;
    occurredAt = value.toISOString();
  } catch { return null; }
  const event: AiObservabilityEvent = {
    version: AI_OBSERVABILITY_VERSION,
    occurredAt,
    correlationId: input.correlationId,
    workflow: input.workflow,
    stage: input.stage,
    status: input.status,
    attempt: input.attempt
  };
  if (input.durationMs !== undefined) (event as { durationMs?: number }).durationMs = input.durationMs;
  if (input.model !== undefined) (event as { model?: string }).model = input.model;
  const usage = tokenUsage(input.tokenUsage);
  if (usage) (event as { tokenUsage?: AiTokenUsage }).tokenUsage = usage;
  const errorCode = sanitizeAiErrorCode(input.errorCode);
  if (errorCode) (event as { errorCode?: string }).errorCode = errorCode;
  return event;
}

/**
 * Normal server telemetry is a line-delimited, schema-checked structured log.
 * The event object is built before this sink runs, so the log path cannot
 * serialize arbitrary caller objects, prompts, model text, or credentials.
 */
export const localAiObservabilitySink: AiObservabilitySink = (event) => {
  try { console.info(JSON.stringify(event)); } catch { /* best effort only */ }
};

/**
 * Emits a previously allow-listed event. Sink failures are intentionally
 * swallowed: telemetry must never change a dialogue or settlement outcome.
 */
export async function emitAiObservability(sink: AiObservabilitySink | undefined, input: AiObservabilityInput, now?: () => Date): Promise<AiObservabilityEvent | null> {
  const event = createAiObservabilityEvent(input, now);
  if (!event) return null;
  try { await sink?.(event); } catch { /* observability is best-effort */ }
  return event;
}
