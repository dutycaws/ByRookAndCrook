import {
  parseQuestTransitionCriticDecision,
  parseQuestTransitionProposal,
  validateQuestTransitionProposal,
  type QuestTransitionValidationContext
} from '$lib/game/evolving-world';
import { emitAiObservability, type AiObservabilitySink } from '$lib/server/observability/ai-events';
import { SETTLEMENT_PROMPT_KEY, releaseTextPrompt } from '$lib/server/prompt-registry/runtime';
import { type PromptRegistryService } from '$lib/server/prompt-registry/service';
import {
  SETTLEMENT_PROVIDER_CALL_BUDGETS,
  SettlementProviderError,
  type ProviderResult,
  type QuestTransitionProviderStage,
  type SettlementProvider
} from './settlement-contracts';
import type { SettlementOutcome, SettlementRuntime, SettlementWorkerClient } from './settlement-worker';
import { createSettlementProvider } from './provider';
import { env } from '$env/dynamic/private';
import { privateRuntimeEnvironment } from '$lib/server/private-runtime-environment';

type QuestTransitionCheckpoint = { stage: 'proposer' | 'critic' | 'repair' | 'final_critic'; payload: Record<string, unknown> };
type QuestTransitionClaim = {
  transitionId: string;
  terminalEventId: string;
  instanceId: string;
  fence: string;
  attempt: number;
  leaseUntil: string;
  leaseUntilMs: number;
  frozenContext: Record<string, unknown>;
  checkpoints: QuestTransitionCheckpoint[];
};
type QuestTransitionRuntime = SettlementRuntime;

const MAX_TOTAL_MS = 90_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function string(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
function isLeaseError(error: unknown): boolean {
  return /stale quest transition fence|transition.*(active|lease)|lease/i.test(error instanceof Error ? error.message : String(error));
}
/** A model answer that fails its closed contract is not a retryable provider outage. */
class TransitionValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'TransitionValidationError'; }
}
function errorCode(cause: unknown): string {
  if (cause instanceof TransitionValidationError) return 'validation_rejected';
  // The adapter reserves provider_malformed for structured model output that
  // failed its declared contract. Replaying that output after a new lease
  // would otherwise make the transition permanently unrecoverable.
  if (cause instanceof SettlementProviderError && cause.code === 'provider_malformed') return 'validation_rejected';
  return cause instanceof SettlementProviderError ? cause.code : 'worker_failed';
}
function rpc(client: SettlementWorkerClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  return client.rpc(name, args).then((result) => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });
}

function parseClaim(value: unknown): QuestTransitionClaim | { status: 'idle' } | null {
  if (!object(value)) return null;
  if (value.status === 'idle') return { status: 'idle' };
  if (!string(value.transitionId, 120) || !string(value.terminalEventId, 120) || !string(value.instanceId, 120)
    || !string(value.fence, 120) || !Number.isSafeInteger(value.attempt) || (value.attempt as number) < 1 || (value.attempt as number) > 1_000
    || !string(value.leaseUntil, 64) || !object(value.frozenContext) || !Array.isArray(value.checkpoints)
    || !uuid.test(value.transitionId as string) || !uuid.test(value.terminalEventId as string) || !uuid.test(value.instanceId as string) || !uuid.test(value.fence as string)) return null;
  try { if (JSON.stringify(value.frozenContext).length > 65_536) return null; } catch { return null; }
  const leaseUntilMs = Date.parse(value.leaseUntil as string);
  if (!Number.isFinite(leaseUntilMs) || leaseUntilMs <= Date.now()) return null;
  const checkpoints: QuestTransitionCheckpoint[] = [];
  for (const raw of value.checkpoints) {
    if (!object(raw) || !['proposer', 'critic', 'repair', 'final_critic'].includes(String(raw.stage)) || !object(raw.payload)) return null;
    try { if (JSON.stringify(raw.payload).length > 16_384) return null; } catch { return null; }
    const stage = raw.stage as QuestTransitionCheckpoint['stage'];
    if (checkpoints.some((checkpoint) => checkpoint.stage === stage)) return null;
    checkpoints.push({ stage, payload: raw.payload });
  }
  return {
    transitionId: value.transitionId as string, terminalEventId: value.terminalEventId as string,
    instanceId: value.instanceId as string, fence: value.fence as string, attempt: value.attempt as number,
    leaseUntil: value.leaseUntil as string, leaseUntilMs, frozenContext: value.frozenContext, checkpoints
  };
}

function validationContext(claim: QuestTransitionClaim): QuestTransitionValidationContext | null {
  const source = claim.frozenContext;
  const envelope = source.capabilityEnvelope;
  if (!object(envelope) || !Array.isArray(envelope.allowedActions) || !Array.isArray(envelope.allowedApproaches)
    || !Array.isArray(envelope.allowedWorldEffects)
    || !envelope.allowedActions.every((value) => typeof value === 'string')
    || !envelope.allowedApproaches.every((value) => typeof value === 'string')
    || !envelope.allowedWorldEffects.every((value) => typeof value === 'string')) return null;
  const refs = Array.isArray(source.validCanonicalTargets)
    ? source.validCanonicalTargets.flatMap((target) => object(target) ? [target.id, target.ref].filter((value): value is string => typeof value === 'string') : [])
    : [];
  const milestone = object(source.nextAuthoredMilestone) && typeof source.nextAuthoredMilestone.id === 'string'
    ? { id: source.nextAuthoredMilestone.id } : undefined;
  const residents = Array.isArray(source.socialEdges)
    ? source.socialEdges.flatMap((edge) => object(edge) ? [edge.from, edge.to].filter((value): value is string => typeof value === 'string' && value !== claim.instanceId) : [])
    : [];
  return {
    terminalEventId: claim.terminalEventId,
    residentId: claim.instanceId,
    frozenTargetRefs: [...new Set(refs)].slice(0, 300),
    capabilities: {
      actions: envelope.allowedActions as string[], approaches: envelope.allowedApproaches as string[],
      allowGeneratedSuccessor: envelope.allowedWorldEffects.includes('create_quest'), allowDeparture: true
    },
    ...(milestone ? { nextAuthoredMilestone: milestone } : {}),
    ...(residents.length ? { otherResidentIds: [...new Set(residents)].slice(0, 32) } : {})
  };
}
function checkpoint(claim: QuestTransitionClaim, stage: QuestTransitionCheckpoint['stage']): Record<string, unknown> | undefined {
  return claim.checkpoints.find((candidate) => candidate.stage === stage)?.payload;
}
function usage(result: ProviderResult): Record<string, number> {
  return { input: result.usage.input, output: result.usage.output };
}

class LeaseGuard {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private leaseUntilMs: number;
  lost = false;
  constructor(private readonly client: SettlementWorkerClient, private readonly claim: QuestTransitionClaim, private readonly controller: AbortController, private readonly cadence: number) {
    this.leaseUntilMs = claim.leaseUntilMs;
  }
  private margin(): number { return Math.max(1_000, Math.min(10_000, Math.floor((this.leaseUntilMs - Date.now()) / 5))); }
  async beat(): Promise<boolean> {
    if (this.lost || Date.now() >= this.leaseUntilMs - this.margin()) { this.lost = true; this.controller.abort(); return false; }
    try {
      const result = await rpc(this.client, 'world_quest_transition_heartbeat', { p_transition_id: this.claim.transitionId, p_fence: this.claim.fence });
      if (!object(result) || !string(result.leaseUntil, 64)) throw new Error('Malformed transition heartbeat');
      const next = Date.parse(result.leaseUntil); if (!Number.isFinite(next) || next <= Date.now()) throw new Error('Expired transition heartbeat');
      this.leaseUntilMs = next;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.beat(); }, Math.max(1_000, Math.min(this.cadence, Math.floor((next - Date.now()) / 2))));
      this.timer.unref?.();
      return true;
    } catch { this.lost = true; this.controller.abort(); return false; }
  }
  canCall(): boolean { return !this.lost && Date.now() < this.leaseUntilMs - this.margin(); }
  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
}

function committed(value: unknown, claim: QuestTransitionClaim): string | null {
  if (!object(value) || value.status !== 'completed' || value.transitionId !== claim.transitionId || value.terminalEventId !== claim.terminalEventId || !['next_authored_milestone', 'successor', 'departure'].includes(String(value.kind))) return null;
  return value.kind as string;
}

/** Executes a frozen terminal-event transition outside the database transaction. */
export async function runQuestTransitionClaim(client: SettlementWorkerClient, rawClaim: unknown, runtime: QuestTransitionRuntime = {}): Promise<SettlementOutcome> {
  const parsed = parseClaim(rawClaim);
  if (!parsed) return { status: 'failed', errorCode: 'claim_malformed' };
  if ('status' in parsed) return { status: 'idle' };
  const claim = parsed;
  const context = validationContext(claim);
  if (!context) return { status: 'failed', errorCode: 'claim_malformed' };
  const timeoutMs = Math.min(Math.max(runtime.timeoutMs ?? MAX_TOTAL_MS, 1_000), MAX_TOTAL_MS);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const guard = new LeaseGuard(client, claim, controller, Math.max(1_000, Math.min(runtime.heartbeatMs ?? 20_000, 45_000)));
  const provider = runtime.provider ?? createSettlementProvider(privateRuntimeEnvironment(env));
  const observability = runtime.observability;
  const correlationId = `quest-transition:${claim.transitionId}`;
  let calls = 0;
  try {
    const registry = runtime.promptRegistry;
    if (!registry) throw new Error('Prompt registry is required for quest transition execution');
    const release = await registry.resolveForWork('quest_transition', claim.transitionId);
    const generate = async (stage: QuestTransitionProviderStage, payload: unknown): Promise<ProviderResult> => {
      const prompt = releaseTextPrompt(release, SETTLEMENT_PROMPT_KEY[stage]);
      if (calls >= SETTLEMENT_PROVIDER_CALL_BUDGETS.quest_transition.maximum) throw new SettlementProviderError('provider_failed', 'Quest transition model-call budget exhausted.');
      if (!guard.canCall() || !await guard.beat()) throw new SettlementProviderError('provider_timeout', 'Quest transition lease was lost.');
      calls += 1;
      await registry.recordSafeRun({ executionId: correlationId, attempt: claim.attempt, workflow: 'quest_transition', nodeKey: stage, prompt, status: 'started' }).catch(() => undefined);
      await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage, status: 'started', attempt: claim.attempt });
      try {
        const result = await provider.generate(stage, payload, controller.signal, prompt);
        await registry.recordSafeRun({ executionId: correlationId, attempt: claim.attempt, workflow: 'quest_transition', nodeKey: stage, prompt, status: 'completed', model: result.model, durationMs: result.durationMs, inputTokens: result.usage.input, outputTokens: result.usage.output }).catch(() => undefined);
        await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage, status: 'completed', attempt: claim.attempt, durationMs: result.durationMs, model: result.model, tokenUsage: result.usage });
        return result;
      } catch (cause) {
        await registry.recordSafeRun({ executionId: correlationId, attempt: claim.attempt, workflow: 'quest_transition', nodeKey: stage, prompt, status: 'failed', errorCode: errorCode(cause) }).catch(() => undefined);
        await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage, status: 'failed', attempt: claim.attempt, errorCode: controller.signal.aborted ? 'provider_timeout' : errorCode(cause) });
        throw cause;
      }
    };
    if (!await guard.beat()) return { status: 'lease_lost', errorCode: 'lease_unavailable' };
    const payloadBase = { context, frozenContext: claim.frozenContext };
    let proposal = checkpoint(claim, 'proposer')?.proposal;
    if (!proposal) {
      const result = await generate('quest_transition_proposer', payloadBase);
      proposal = result.value;
      await rpc(client, 'world_quest_transition_checkpoint', { p_transition_id: claim.transitionId, p_fence: claim.fence, p_stage: 'proposer', p_payload: { proposal } });
    } else {
      await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_proposer', status: 'reused', attempt: claim.attempt });
    }
    const parsedProposal = parseQuestTransitionProposal(proposal, context);
    if (!parsedProposal.ok) throw new TransitionValidationError('Quest transition proposal does not validate.');
    proposal = parsedProposal.value;
    let critic = checkpoint(claim, 'critic')?.decision;
    if (!critic) {
      const result = await generate('quest_transition_critic', { ...payloadBase, proposal }); critic = result.value;
      await rpc(client, 'world_quest_transition_checkpoint', { p_transition_id: claim.transitionId, p_fence: claim.fence, p_stage: 'critic', p_payload: { decision: critic } });
    } else await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_critic', status: 'reused', attempt: claim.attempt });
    let decision = parseQuestTransitionCriticDecision(critic);
    if (!decision || decision.decision === 'reject') throw new TransitionValidationError('Quest transition was rejected.');
    if (decision.decision === 'repair') {
      let repaired = checkpoint(claim, 'repair')?.proposal;
      if (!repaired) {
        const result = await generate('quest_transition_repair', { ...payloadBase, proposal, instructions: decision.instructions }); repaired = result.value;
        await rpc(client, 'world_quest_transition_checkpoint', { p_transition_id: claim.transitionId, p_fence: claim.fence, p_stage: 'repair', p_payload: { proposal: repaired } });
      } else await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_repair', status: 'reused', attempt: claim.attempt });
      const parsedRepair = parseQuestTransitionProposal(repaired, context);
      if (!parsedRepair.ok) throw new TransitionValidationError('Repaired quest transition does not validate.');
      proposal = parsedRepair.value;
      let final = checkpoint(claim, 'final_critic')?.decision;
      if (!final) {
        const result = await generate('quest_transition_final_critic', { ...payloadBase, proposal }); final = result.value;
        await rpc(client, 'world_quest_transition_checkpoint', { p_transition_id: claim.transitionId, p_fence: claim.fence, p_stage: 'final_critic', p_payload: { decision: final } });
      } else await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_final_critic', status: 'reused', attempt: claim.attempt });
      decision = parseQuestTransitionCriticDecision(final);
      if (!decision || decision.decision !== 'accept') throw new TransitionValidationError('Repaired quest transition was rejected.');
    }
    await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_validate', status: 'started', attempt: claim.attempt });
    if (validateQuestTransitionProposal(proposal, context).length > 0) {
      await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_validate', status: 'failed', attempt: claim.attempt, errorCode: 'validation_rejected' });
      throw new TransitionValidationError('Validated quest transition is invalid.');
    }
    await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_validate', status: 'completed', attempt: claim.attempt });
    if (!guard.canCall()) return { status: 'lease_lost', errorCode: 'lease_lost' };
    await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_commit', status: 'started', attempt: claim.attempt });
    const result = await rpc(client, 'world_quest_transition_commit', { p_transition_id: claim.transitionId, p_fence: claim.fence, p_proposal: proposal });
    const kind = committed(result, claim);
    await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_commit', status: kind ? 'completed' : 'failed', attempt: claim.attempt, errorCode: kind ? undefined : 'commit_unknown' });
    return kind ? { status: 'completed', kind } : { status: 'failed', errorCode: 'commit_unknown' };
  } catch (cause) {
    if (guard.lost || isLeaseError(cause)) return { status: 'lease_lost', errorCode: errorCode(cause) };
    const failure = timedOut ? 'provider_timeout' : errorCode(cause);
    await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_fallback', status: 'started', attempt: claim.attempt, errorCode: failure });
    try {
      await rpc(client, 'world_quest_transition_fail', { p_transition_id: claim.transitionId, p_fence: claim.fence, p_failure_code: failure });
      await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_fallback', status: 'completed', attempt: claim.attempt, errorCode: failure });
    }
    catch (error) { if (isLeaseError(error)) return { status: 'lease_lost', errorCode: failure }; }
    return { status: 'failed', errorCode: failure };
  } finally { guard.stop(); clearTimeout(timeout); }
}

/** The settlement worker calls this after resolution so terminal effects drain promptly but remain bounded. */
export async function drainQuestTransitionQueue(limit: number, client: SettlementWorkerClient, runtime: QuestTransitionRuntime = {}): Promise<SettlementOutcome[]> {
  const outcomes: SettlementOutcome[] = [];
  for (let index = 0; index < Math.max(0, Math.min(limit, 4)); index += 1) {
    const next = await client.rpc('world_quest_transition_claim_next', {});
    if (next.error) break;
    const outcome = await runQuestTransitionClaim(client, next.data, runtime);
    outcomes.push(outcome);
    if (outcome.status === 'idle') break;
  }
  return outcomes;
}
