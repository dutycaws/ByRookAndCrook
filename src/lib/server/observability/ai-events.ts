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
/**
 * Bounded, content-free measurements from the shared NPC-memory context path.
 * These are deliberately measurements rather than a context manifest: source
 * IDs, retrieval terms, prompt text, selected records, and provider payloads
 * do not belong in telemetry.
 */
export type AiMemoryContextMeasurements = Readonly<{
  selectedRecordCount: number;
  sourceRecordCount: number;
  utf8Bytes: number;
  configuredTokenCount?: number;
  modelTokenCount?: number;
  coverageGapCount: number;
  reuse: 'fresh' | 'cache_hit' | 'replayed';
  queryDurationMs?: number;
  assemblyDurationMs?: number;
  artifactHash?: string;
  artifactRevision?: number;
  artifactTokens?: number;
  artifactCounterModel?: string;
  artifactUtf8Bytes?: number;
  artifactCountDurationMs?: number;
}>;

/** Current provider-call checkpoints. These are operational labels, not prompts. */
export const DIALOGUE_AI_STAGES = ['investigate0', 'investigate1', 'deliberate', 'speak', 'review', 'rewrite', 'rereview', 'remember'] as const;
export const WORLD_SETTLEMENT_AI_STAGES = [
  'proposer', 'critic', 'repair', 'final_critic', 'digest', 'validated',
  'canon_proposer', 'canon_critic', 'canon_repair', 'canon_final_critic',
  'canon_validate', 'canon_commit', 'news_aggregate', 'news_commit', 'safe_fallback',
  'social_encounter_proposer', 'social_encounter_critic', 'social_encounter_repair',
  'social_encounter_final_critic', 'social_encounter_validate', 'social_encounter_commit',
  'social_encounter_fallback',
  'procedural_world_proposer', 'procedural_world_critic', 'procedural_world_repair',
  'procedural_world_final_critic', 'procedural_world_validate', 'procedural_world_commit', 'lease',
  'procedural_world_fallback', 'procedural_world_promotion',
  'quest_transition_proposer', 'quest_transition_critic', 'quest_transition_repair',
  'quest_transition_final_critic', 'quest_transition_validate', 'quest_transition_commit', 'quest_transition_fallback'
] as const;

export type DialogueAiStage = (typeof DIALOGUE_AI_STAGES)[number];
export type WorldSettlementAiStage = (typeof WORLD_SETTLEMENT_AI_STAGES)[number];
export type AiStage = DialogueAiStage | WorldSettlementAiStage;

export type AiFailureDiagnostic = Readonly<{
  stage: 'memory_context' | 'prompt_registry' | 'quest_transition_proposer' | 'quest_transition_critic' | 'quest_transition_repair' | 'quest_transition_final_critic' | 'quest_transition_validate' | 'quest_transition_commit';
  errorClass: 'transition_validation' | 'settlement_provider' | 'ordinary_error' | 'unknown';
  reasonCode: 'scope_invalid' | 'coverage_incomplete' | 'manifest_invalid' | 'evidence_projection_invalid' | 'counter_unavailable' | 'counter_result_invalid' | 'counter_budget_exceeded' | 'artifact_budget_exceeded' | 'memory_checkpoint_failed' | 'memory_context_malformed' | 'provider_unavailable' | 'provider_timeout' | 'provider_malformed' | 'provider_failed' | 'provider_payload_contract_invalid' | 'provider_request_budget_exceeded' | 'provider_preflight_http_error' | 'provider_preflight_json_invalid' | 'provider_preflight_count_invalid' | 'provider_input_budget_exceeded' | 'provider_response_http_error' | 'provider_response_json_invalid' | 'provider_response_incomplete' | 'provider_response_unexpected_status' | 'provider_response_refusal' | 'provider_output_missing' | 'provider_output_schema_invalid' | 'provider_output_outer_json_invalid' | 'provider_output_inner_json_invalid' | 'provider_quest_proposal_shape' | 'provider_quest_terminal_event' | 'provider_quest_authored_milestone' | 'provider_quest_successor_bounds' | 'provider_quest_departure_safety' | 'provider_output_semantic_invalid' | 'prompt_registry_failed' | 'proposal_invalid' | 'critic_rejected' | 'repair_invalid' | 'repair_rejected' | 'transition_validation_invalid' | 'commit_failed' | 'unclassified';
  inputTokens?: number;
  maxTokens?: number;
}>;

export type AiObservabilityEvent = Readonly<{
  version: typeof AI_OBSERVABILITY_VERSION;
  occurredAt: string;
  correlationId: string;
  workflow: AiWorkflow;
  stage: AiStage;
  status: AiEventStatus;
  attempt: number;
  durationMs?: number;
  model?: string;
  tokenUsage?: AiTokenUsage;
  memoryContext?: AiMemoryContextMeasurements;
  failureDiagnostic?: AiFailureDiagnostic;
  errorCode?: string;
}>;

/** The input mirrors the persisted event exactly. Arbitrary metadata is forbidden. */
export type AiObservabilityInput = Readonly<{
  correlationId: string;
  workflow: AiWorkflow;
  // Dynamic orchestrators choose from their own bounded stage sets. The
  // runtime allowlist below remains the authority before an event is formed.
  stage: string;
  status: AiEventStatus;
  attempt: number;
  durationMs?: number;
  model?: string;
  tokenUsage?: AiTokenUsage;
  memoryContext?: AiMemoryContextMeasurements;
  failureDiagnostic?: unknown;
  errorCode?: unknown;
}>;

export type AiObservabilitySink = (event: AiObservabilityEvent) => void | Promise<void>;

const workflowSet = new Set<AiWorkflow>(['dialogue', 'world_settlement']);
const statusSet = new Set<AiEventStatus>(['started', 'completed', 'failed', 'skipped', 'reused']);
const opaqueId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const stageName = /^[a-z][a-z0-9_:-]{0,79}$/;
const modelName = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const memoryContextReuse = new Set<AiMemoryContextMeasurements['reuse']>(['fresh', 'cache_hit', 'replayed']);
const failureStages = new Set<AiFailureDiagnostic['stage']>(['memory_context','prompt_registry','quest_transition_proposer','quest_transition_critic','quest_transition_repair','quest_transition_final_critic','quest_transition_validate','quest_transition_commit']);
const failureClasses = new Set<AiFailureDiagnostic['errorClass']>(['transition_validation','settlement_provider','ordinary_error','unknown']);
const failureReasons = new Set<AiFailureDiagnostic['reasonCode']>(['scope_invalid','coverage_incomplete','manifest_invalid','evidence_projection_invalid','counter_unavailable','counter_result_invalid','counter_budget_exceeded','artifact_budget_exceeded','memory_checkpoint_failed','memory_context_malformed','provider_unavailable','provider_timeout','provider_malformed','provider_failed','provider_payload_contract_invalid','provider_request_budget_exceeded','provider_preflight_http_error','provider_preflight_json_invalid','provider_preflight_count_invalid','provider_input_budget_exceeded','provider_response_http_error','provider_response_json_invalid','provider_response_incomplete','provider_response_unexpected_status','provider_response_refusal','provider_output_missing','provider_output_schema_invalid','provider_output_outer_json_invalid','provider_output_inner_json_invalid','provider_quest_proposal_shape','provider_quest_terminal_event','provider_quest_authored_milestone','provider_quest_successor_bounds','provider_quest_departure_safety','provider_output_semantic_invalid','prompt_registry_failed','proposal_invalid','critic_rejected','repair_invalid','repair_rejected','transition_validation_invalid','commit_failed','unclassified']);
const permittedErrors = new Set([
  'provider_unavailable', 'provider_timeout', 'provider_malformed', 'provider_failed',
  'worker_failed', 'claim_malformed', 'lease_unavailable', 'lease_lost', 'commit_unknown',
  'validation_rejected', 'commit_rejected', 'commit_conflict',
  'context_budget', 'budget', 'structure', 'consistency', 'state_changed', 'promotion_failed', 'internal_error'
]);
const providerStages = new Set<string>([
  ...DIALOGUE_AI_STAGES,
  'proposer', 'critic', 'repair', 'final_critic', 'digest',
  'canon_proposer', 'canon_critic', 'canon_repair', 'canon_final_critic',
  'social_encounter_proposer', 'social_encounter_critic', 'social_encounter_repair', 'social_encounter_final_critic',
  'procedural_world_proposer', 'procedural_world_critic', 'procedural_world_repair', 'procedural_world_final_critic',
  'quest_transition_proposer', 'quest_transition_critic', 'quest_transition_repair', 'quest_transition_final_critic'
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

function memoryContextMeasurements(value: unknown): AiMemoryContextMeasurements | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!finiteInteger(candidate.selectedRecordCount, 0, 100_000)
    || !finiteInteger(candidate.sourceRecordCount, 0, 100_000)
    || !finiteInteger(candidate.utf8Bytes, 0, 10_000_000)
    || !finiteInteger(candidate.coverageGapCount, 0, 100_000)
    || typeof candidate.reuse !== 'string' || !memoryContextReuse.has(candidate.reuse as AiMemoryContextMeasurements['reuse'])) return undefined;
  if (candidate.configuredTokenCount !== undefined && !finiteInteger(candidate.configuredTokenCount, 0, 10_000_000)) return undefined;
  if (candidate.modelTokenCount !== undefined && !finiteInteger(candidate.modelTokenCount, 0, 10_000_000)) return undefined;
  if (candidate.queryDurationMs !== undefined && !finiteInteger(candidate.queryDurationMs, 0, 24 * 60 * 60 * 1_000)) return undefined;
  if (candidate.assemblyDurationMs !== undefined && !finiteInteger(candidate.assemblyDurationMs, 0, 24 * 60 * 60 * 1_000)) return undefined;
  if (candidate.artifactHash !== undefined && (typeof candidate.artifactHash !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.artifactHash))) return undefined;
  if (candidate.artifactRevision !== undefined && !finiteInteger(candidate.artifactRevision, 0, 1_000_000)) return undefined;
  if (candidate.artifactTokens !== undefined && !finiteInteger(candidate.artifactTokens, 0, 10_000_000)) return undefined;
  if (candidate.artifactCounterModel !== undefined && (typeof candidate.artifactCounterModel !== 'string' || !modelName.test(candidate.artifactCounterModel))) return undefined;
  if (candidate.artifactUtf8Bytes !== undefined && !finiteInteger(candidate.artifactUtf8Bytes, 0, 10_000_000)) return undefined;
  if (candidate.artifactCountDurationMs !== undefined && !finiteInteger(candidate.artifactCountDurationMs, 0, 24 * 60 * 60 * 1_000)) return undefined;
  const measured: AiMemoryContextMeasurements = {
    selectedRecordCount: candidate.selectedRecordCount,
    sourceRecordCount: candidate.sourceRecordCount,
    utf8Bytes: candidate.utf8Bytes,
    coverageGapCount: candidate.coverageGapCount,
    reuse: candidate.reuse as AiMemoryContextMeasurements['reuse']
  };
  if (candidate.configuredTokenCount !== undefined) (measured as { configuredTokenCount?: number }).configuredTokenCount = candidate.configuredTokenCount;
  if (candidate.modelTokenCount !== undefined) (measured as { modelTokenCount?: number }).modelTokenCount = candidate.modelTokenCount;
  if (candidate.queryDurationMs !== undefined) (measured as { queryDurationMs?: number }).queryDurationMs = candidate.queryDurationMs;
  if (candidate.assemblyDurationMs !== undefined) (measured as { assemblyDurationMs?: number }).assemblyDurationMs = candidate.assemblyDurationMs;
  if (candidate.artifactHash !== undefined) (measured as { artifactHash?: string }).artifactHash = candidate.artifactHash;
  if (candidate.artifactRevision !== undefined) (measured as { artifactRevision?: number }).artifactRevision = candidate.artifactRevision;
  if (candidate.artifactTokens !== undefined) (measured as { artifactTokens?: number }).artifactTokens = candidate.artifactTokens;
  if (candidate.artifactCounterModel !== undefined) (measured as { artifactCounterModel?: string }).artifactCounterModel = candidate.artifactCounterModel;
  if (candidate.artifactUtf8Bytes !== undefined) (measured as { artifactUtf8Bytes?: number }).artifactUtf8Bytes = candidate.artifactUtf8Bytes;
  if (candidate.artifactCountDurationMs !== undefined) (measured as { artifactCountDurationMs?: number }).artifactCountDurationMs = candidate.artifactCountDurationMs;
  return measured;
}

function failureDiagnostic(value: unknown): AiFailureDiagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.some((key) => !['stage','errorClass','reasonCode','inputTokens','maxTokens'].includes(key))
    || !failureStages.has(candidate.stage as AiFailureDiagnostic['stage'])
    || !failureClasses.has(candidate.errorClass as AiFailureDiagnostic['errorClass'])
    || !failureReasons.has(candidate.reasonCode as AiFailureDiagnostic['reasonCode'])) return undefined;
  const hasInputTokens = candidate.inputTokens !== undefined;
  const hasMaxTokens = candidate.maxTokens !== undefined;
  if (hasInputTokens !== hasMaxTokens || (hasInputTokens && (candidate.reasonCode !== 'counter_budget_exceeded'
    || !finiteInteger(candidate.inputTokens, 0, 10_000_000) || !finiteInteger(candidate.maxTokens, 0, 10_000_000)))) return undefined;
  return {
    stage: candidate.stage as AiFailureDiagnostic['stage'],
    errorClass: candidate.errorClass as AiFailureDiagnostic['errorClass'],
    reasonCode: candidate.reasonCode as AiFailureDiagnostic['reasonCode'],
    ...(hasInputTokens ? { inputTokens: candidate.inputTokens as number, maxTokens: candidate.maxTokens as number } : {})
  };
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
  if (input.memoryContext !== undefined && !memoryContextMeasurements(input.memoryContext)) return null;
  if (input.failureDiagnostic !== undefined && (!failureDiagnostic(input.failureDiagnostic) || input.status !== 'started' || input.stage !== 'quest_transition_fallback')) return null;
  // Model identity and usage belong solely to a completed provider invocation.
  // This prevents checkpoint reuse and database commit events from looking like
  // billable model calls in dashboards.
  const hasProviderMetrics = input.model !== undefined || input.tokenUsage !== undefined;
  if (hasProviderMetrics && (input.status !== 'completed' || !providerStages.has(input.stage)
    || input.model === undefined || input.tokenUsage === undefined)) return null;
  if (input.status === 'reused' && (input.durationMs !== undefined || hasProviderMetrics)) return null;

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
    stage: input.stage as AiStage,
    status: input.status,
    attempt: input.attempt
  };
  if (input.durationMs !== undefined) (event as { durationMs?: number }).durationMs = input.durationMs;
  if (input.model !== undefined) (event as { model?: string }).model = input.model;
  const usage = tokenUsage(input.tokenUsage);
  if (usage) (event as { tokenUsage?: AiTokenUsage }).tokenUsage = usage;
  const memoryContext = memoryContextMeasurements(input.memoryContext);
  if (memoryContext) (event as { memoryContext?: AiMemoryContextMeasurements }).memoryContext = memoryContext;
  const failure = failureDiagnostic(input.failureDiagnostic);
  if (failure) (event as { failureDiagnostic?: AiFailureDiagnostic }).failureDiagnostic = failure;
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
