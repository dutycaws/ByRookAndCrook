import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { canonicalizeProceduralWorldProposal, fingerprintMutationProposal, fingerprintSocialEncounterProposal, fingerprintWorldCanonEventProposal, parseFrozenProceduralWorldContext, parseFrozenSocialEncounterContext, parseMutationProposal, parseProceduralWorldCriticDecision, parseProceduralWorldProposal, parseSocialEncounterCriticDecision, parseSocialEncounterProposal, validatePersonalityProfile, validatePersonalitySchema, validateMutationProposal, validateQuestChanges, validateWorldEffectCommands } from '$lib/game/evolving-world';
import type { Database } from '$lib/database.types';
import { getSupabaseConfig } from '$lib/server/config';
import { privateRuntimeEnvironment } from '$lib/server/private-runtime-environment';
import { createSettlementProvider } from './provider';
import { drainQuestTransitionQueue } from './quest-transition-worker';
import { emitAiObservability, localAiObservabilitySink, type AiObservabilitySink } from '$lib/server/observability/ai-events';
import { SETTLEMENT_PROMPT_KEY, releaseTextPrompt } from '$lib/server/prompt-registry/runtime';
import { promptRegistryService, type PromptRegistryService } from '$lib/server/prompt-registry/service';
import {
  CANON_CHECKPOINT_STAGE, PROCEDURAL_WORLD_CHECKPOINT_STAGE, SETTLEMENT_PROVIDER_CALL_BUDGETS, SOCIAL_ENCOUNTER_CHECKPOINT_STAGE, frozenCanonEventContext, frozenEvolutionContext, parseCriticOutput, parseFrozenCanonEventProposal, parsePublicDigest, parseSettlementClaim, proposalBeliefsAreAttributed, proposalEvidenceIsAuthorized, SettlementProviderError,
  type ProviderResult, type ProviderStage, type SettlementClaim, type SettlementProvider
} from './settlement-contracts';

type RpcResult = { data: unknown; error: { message: string } | null };
export type SettlementWorkerClient = { rpc(name: string, args?: Record<string, unknown>): Promise<RpcResult> };
export type SettlementOutcome = { status: 'idle' | 'completed' | 'lease_lost' | 'failed'; kind?: string; errorCode?: string };
export type SettlementRuntime = { provider?: SettlementProvider; now?: () => number; timeoutMs?: number; heartbeatMs?: number; observability?: AiObservabilitySink; promptRegistry?: PromptRegistryService };
const MAX_TOTAL_MS = 90_000;

function runtimeConfig() { return privateRuntimeEnvironment(env); }
function serviceClient(config = runtimeConfig()): SettlementWorkerClient | null {
  if (!config.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient<Database>(getSupabaseConfig().url, config.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false,autoRefreshToken:false} }) as unknown as SettlementWorkerClient;
}
function clip(value: string, limit: number): string { return value.replace(/\s+/g, ' ').trim().slice(0, limit); }
function errorCode(cause: unknown): string { return cause instanceof SettlementProviderError ? cause.code : 'worker_failed'; }
type SafeFallbackReason = 'validation_rejected' | 'provider_unavailable' | 'provider_timeout' | 'provider_malformed' | 'provider_failed' | 'budget' | 'worker_failed';
function socialFallbackReason(cause: unknown): SafeFallbackReason {
  const code=errorCode(cause);
  return ['provider_unavailable','provider_timeout','provider_malformed','provider_failed','budget','worker_failed'].includes(code)
    ? code as SafeFallbackReason : 'worker_failed';
}
function isLeaseError(error: { message: string } | null): boolean { return !!error && /stale settlement fence|attempt is not active|lease/i.test(error.message); }
async function rpc(client: SettlementWorkerClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await client.rpc(name, args); if (result.error) throw new Error(result.error.message); return result.data;
}
function checkpoint(claim: SettlementClaim, stage: string): Record<string, unknown> | null {
  const match = claim.checkpoints.find((candidate) => candidate.stage === stage);
  return match?.payload ?? null;
}
function usage(result: ProviderResult): Record<string, unknown> { return { input: result.usage.input, output: result.usage.output, durationMs: result.durationMs }; }
function publicFacts(claim: SettlementClaim, accepted: boolean): Record<string, unknown> {
  // This is intentionally constructed, never copied, from the private frozen snapshot.
  return { dayNumber: claim.inputSnapshot.dayNumber, jobKind: claim.kind, acceptedProposal: accepted, knownPublicEntityIds: Array.isArray(claim.inputSnapshot.publicEntityIds) ? claim.inputSnapshot.publicEntityIds.filter((id): id is string => typeof id === 'string').slice(0, 12) : [] };
}
function digestText(value: unknown): string {
  const digest = parsePublicDigest(value); if (!digest) return 'The day settled without new world changes.';
  return clip([digest.summary, ...digest.journalEntries].filter(Boolean).join(' '), 500) || 'The day settled without new world changes.';
}
type CommittedOutcome = 'pressure_only' | 'roll_failed' | 'changed';
function committedKind(value: unknown, expected: { settlementId: string; jobId: string; proposalFingerprint: string; publicDigest: string }): CommittedOutcome | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  if (receipt.status !== 'completed' || receipt.rulesVersion !== 'evolving-world-v1'
    || !['pressure_only', 'roll_failed', 'changed'].includes(String(receipt.outcome))
    || receipt.settlementId !== expected.settlementId || receipt.jobId !== expected.jobId
    || receipt.proposalFingerprint !== expected.proposalFingerprint || receipt.publicDigest !== expected.publicDigest) return null;
  return receipt.outcome as CommittedOutcome;
}

class LeaseGuard {
  lost = false; private heartbeatTimer: ReturnType<typeof setTimeout> | null = null; private abortTimer: ReturnType<typeof setTimeout> | null = null; private leaseUntilMs: number;
  constructor(private client: SettlementWorkerClient, private claim: SettlementClaim, private signal: AbortController, private preferredMs: number) { this.leaseUntilMs=claim.leaseUntilMs; }
  private safetyMargin() { return Math.max(1_000, Math.min(10_000, Math.floor((this.leaseUntilMs-Date.now()) / 5))); }
  private arm(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer); if (this.abortTimer) clearTimeout(this.abortTimer);
    const remaining=this.leaseUntilMs-Date.now(); const safeRemaining=remaining-this.safetyMargin();
    if (safeRemaining <= 0) { this.lost=true; this.signal.abort(); return; }
    this.abortTimer=setTimeout(()=>{this.lost=true;this.signal.abort();},safeRemaining); this.abortTimer.unref?.();
    const cadence=Math.max(1_000,Math.min(this.preferredMs,Math.floor(remaining/2)));
    this.heartbeatTimer=setTimeout(()=>{void this.beat();},cadence); this.heartbeatTimer.unref?.();
  }
  async establish(): Promise<boolean> { return this.beat(); }
  async beat(): Promise<boolean> {
    if (this.lost || Date.now() >= this.leaseUntilMs-this.safetyMargin()) { this.lost=true; this.signal.abort(); return false; }
    try {
      const result=await rpc(this.client,'world_settlement_heartbeat',{p_settlement_id:this.claim.settlementId,p_fence:this.claim.fence});
      if (!result || typeof result !== 'object' || Array.isArray(result) || typeof (result as Record<string,unknown>).leaseUntil !== 'string') throw new Error('Settlement heartbeat was malformed.');
      const lease=Date.parse((result as Record<string,unknown>).leaseUntil as string); if (!Number.isFinite(lease) || lease <= Date.now()) throw new Error('Settlement heartbeat returned an expired lease.');
      this.leaseUntilMs=lease; this.arm(); return true;
    } catch { this.lost=true; this.signal.abort(); return false; }
  }
  canCall(): boolean { return !this.lost && Date.now() < this.leaseUntilMs-this.safetyMargin(); }
  stop() { if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer); if (this.abortTimer) clearTimeout(this.abortTimer); this.heartbeatTimer=null; this.abortTimer=null; }
}

function proposalValidationIssues(proposal: unknown, context: NonNullable<ReturnType<typeof frozenEvolutionContext>>): boolean {
  const parsed=parseMutationProposal(proposal); if (!parsed.ok || !proposalEvidenceIsAuthorized(parsed.value.evidenceIds,context) || !proposalBeliefsAreAttributed(parsed.value.beliefOperations, context)) return true;
  return [
    ...validatePersonalitySchema(context.schema), ...validatePersonalityProfile(context.profile,context.schema),
    ...validateMutationProposal(parsed.value,context.schema,context.profile,context.worldSnapshot), ...validateQuestChanges(parsed.value.questChanges,context.capability,context.worldSnapshot),
    ...validateWorldEffectCommands(parsed.value.worldEffects,context.capability,context.worldSnapshot)
  ].length > 0;
}

async function saveCheckpoint(client: SettlementWorkerClient, claim: SettlementClaim, stage: string, payload: Record<string, unknown>, result?: ProviderResult): Promise<void> {
  await rpc(client, 'world_settlement_checkpoint', { p_settlement_id:claim.settlementId, p_job_id:claim.jobId, p_fence:claim.fence, p_stage:stage, p_payload:payload, p_usage:result ? usage(result) : {}, p_model:result?.model ?? 'world-worker', p_prompt_version:result?.promptVersion ?? 'world-settlement-v1' });
}
async function safeResult(client: SettlementWorkerClient, claim: SettlementClaim, kind: 'no_changes' | 'rejected' | 'skipped', digest: string): Promise<void> {
  await rpc(client, 'world_settlement_safe_result', { p_settlement_id:claim.settlementId, p_job_id:claim.jobId, p_fence:claim.fence, p_kind:kind, p_public_digest:clip(digest, 500) || 'The day settled without new world changes.' });
}

function canonCommitted(value: unknown, expected: { settlementId:string; jobId:string; fingerprint:string }): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt=value as Record<string,unknown>;
  return receipt.status === 'completed' && receipt.rulesVersion === 'world-canon-event-v1'
    && receipt.settlementId === expected.settlementId && receipt.jobId === expected.jobId
    && receipt.proposalFingerprint === expected.fingerprint && typeof receipt.canonicalEventId === 'string'
    && receipt.kind === 'world_event' && typeof receipt.title === 'string' && typeof receipt.summary === 'string';
}

function newsCompleted(value: unknown, expected: { settlementId:string; jobId:string }): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt=value as Record<string,unknown>;
  return receipt.status === 'completed' && receipt.rulesVersion === 'world-canon-event-v1'
    && receipt.settlementId === expected.settlementId && receipt.jobId === expected.jobId
    && typeof receipt.morningNews === 'string' && receipt.morningNews.length > 0 && receipt.morningNews.length <= 500;
}

function socialEncounterCommitted(value: unknown, expected: { settlementId: string; jobId: string; proposalFingerprint: string }): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt=value as Record<string, unknown>;
  return receipt.status === 'completed' && receipt.rulesVersion === 'social-encounter-v1'
    && receipt.settlementId === expected.settlementId && receipt.jobId === expected.jobId
    && receipt.proposalFingerprint === expected.proposalFingerprint;
}

function proceduralWorldCommitReplay(value: unknown, expected: { settlementId: string; jobId: string; proposalFingerprint: string }): boolean | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const receipt=value as Record<string, unknown>;
  if (!(receipt.status === 'completed' && receipt.rulesVersion === 'procedural-world-v1'
    && receipt.settlementId === expected.settlementId && receipt.jobId === expected.jobId
    && receipt.proposalFingerprint === expected.proposalFingerprint && typeof receipt.replayed === 'boolean')) return null;
  return receipt.replayed;
}

function proceduralWorldPromotionStatus(value: unknown): 'completed' | 'reused' | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const receipt=value as Record<string, unknown>;
  if ((receipt.status !== 'completed' && receipt.status !== 'reused')
    || !Number.isSafeInteger(receipt.promotedCount) || (receipt.promotedCount as number) < 0 || (receipt.promotedCount as number) > 8) return null;
  if ((receipt.status === 'completed') !== ((receipt.promotedCount as number) > 0)) return null;
  return receipt.status;
}

async function fingerprintProceduralWorldProposal(proposal: unknown, context: NonNullable<ReturnType<typeof parseFrozenProceduralWorldContext>>): Promise<string | null> {
  const canonical=canonicalizeProceduralWorldProposal(proposal,context); if (!canonical) return null;
  const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** Runs one fenced job. A validated resident proposal is committed atomically by the server-owned mutation RPC. */
export async function runSettlementClaim(client: SettlementWorkerClient, rawClaim: unknown, runtime: SettlementRuntime = {}): Promise<SettlementOutcome> {
  let parsed; try { parsed = parseSettlementClaim(rawClaim); } catch { return { status:'failed', errorCode:'claim_malformed' }; }
  if ('status' in parsed) return { status:'idle' };
  const claim = parsed; const deadline = Math.min(Math.max(1_000, runtime.timeoutMs ?? MAX_TOTAL_MS), MAX_TOTAL_MS);
  const controller = new AbortController(); let timedOut = false; const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, deadline);
  const guard = new LeaseGuard(client, claim, controller, Math.max(1_000, Math.min(runtime.heartbeatMs ?? 20_000, 45_000)));
  const provider = runtime.provider ?? createSettlementProvider(runtimeConfig()); let calls = 0;
  let promptRelease: Awaited<ReturnType<PromptRegistryService['resolveForWork']>>;
  try {
    const registry = runtime.promptRegistry;
    if (!registry) throw new Error('Prompt registry is required for settlement execution');
    promptRelease = await registry.resolveForWork('settlement', claim.settlementId);
  } catch {
    return { status:'failed', errorCode:'registry_unavailable' };
  }
  const observability = runtime.observability;
  const correlationId = `settlement:${claim.settlementId}:job:${claim.jobId}`;
  const now = runtime.now ?? Date.now;
  const elapsed = (started: number) => Math.max(0, Math.min(24 * 60 * 60 * 1_000, Math.round(now() - started)));
  const callBudget = claim.kind === 'canon' ? SETTLEMENT_PROVIDER_CALL_BUDGETS.canon.maximum
    : claim.kind === 'resident' ? SETTLEMENT_PROVIDER_CALL_BUDGETS.resident.maximum
      : claim.kind === 'social_encounter' ? SETTLEMENT_PROVIDER_CALL_BUDGETS.social_encounter.maximum
        : claim.kind === 'procedural_world' ? SETTLEMENT_PROVIDER_CALL_BUDGETS.procedural_world.maximum : 0;
  const generate = async (stage: ProviderStage, payload: unknown): Promise<ProviderResult> => {
    const prompt=releaseTextPrompt(promptRelease,SETTLEMENT_PROMPT_KEY[stage]);
    if (calls >= callBudget) {
      await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage,status:'failed',attempt:claim.attempt,errorCode:'budget'});
      throw new SettlementProviderError('provider_failed', 'Settlement model-call budget exhausted.');
    }
    if (!guard.canCall() || !await guard.establish()) {
      await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage,status:'failed',attempt:claim.attempt,errorCode:'provider_timeout'});
      throw new SettlementProviderError('provider_timeout', 'Settlement lease was lost.');
    }
    calls += 1;
    await runtime.promptRegistry?.recordSafeRun({executionId:correlationId,attempt:claim.attempt,workflow:'world_settlement',nodeKey:stage,prompt,status:'started'}).catch(()=>{});
    await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage,status:'started',attempt:claim.attempt});
    try {
      const result = await provider.generate(stage, payload, controller.signal,prompt);
      await runtime.promptRegistry?.recordSafeRun({executionId:correlationId,attempt:claim.attempt,workflow:'world_settlement',nodeKey:stage,prompt,status:'completed',model:result.model,durationMs:result.durationMs,inputTokens:result.usage.input,outputTokens:result.usage.output}).catch(()=>{});
      await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage,status:'completed',attempt:claim.attempt,durationMs:result.durationMs,model:result.model,tokenUsage:result.usage});
      return result;
    } catch (cause) {
      await runtime.promptRegistry?.recordSafeRun({executionId:correlationId,attempt:claim.attempt,workflow:'world_settlement',nodeKey:stage,prompt,status:'failed',errorCode:'provider_failed'}).catch(()=>{});
      await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage,status:'failed',attempt:claim.attempt,errorCode:controller.signal.aborted?'provider_timeout':errorCode(cause)});
      throw cause;
    }
  };
  const completeSafely = async (
    kind: 'no_changes' | 'rejected' | 'skipped',
    digest: string,
    reason?: SafeFallbackReason,
    stage: 'safe_fallback' | 'social_encounter_fallback' | 'procedural_world_fallback' = 'safe_fallback'
  ): Promise<void> => {
    const started = now();
    await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage,status:'started',attempt:claim.attempt,errorCode:reason});
    try {
      await safeResult(client,claim,kind,digest);
      await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage,status:'completed',attempt:claim.attempt,durationMs:elapsed(started),errorCode:reason});
    } catch (cause) {
      await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage,status:'failed',attempt:claim.attempt,durationMs:elapsed(started),errorCode:isLeaseError(cause as Error)?'lease_lost':'commit_unknown'});
      throw cause;
    }
  };
  try {
    if (!await guard.establish()) {
      await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'lease',status:'failed',attempt:claim.attempt,errorCode:'lease_unavailable'});
      return { status:'lease_lost', errorCode:'lease_unavailable' };
    }
    if (claim.kind === 'news') {
      const newsStarted=now();
      await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'news_aggregate',status:'started',attempt:claim.attempt});
      let dispatched=false;
      try {
        await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'news_aggregate',status:'completed',attempt:claim.attempt,durationMs:elapsed(newsStarted)});
        await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'news_commit',status:'started',attempt:claim.attempt});
        const commitStarted=now();
        dispatched=true;
        const result=await rpc(client,'world_settlement_complete_news',{p_settlement_id:claim.settlementId,p_job_id:claim.jobId,p_fence:claim.fence});
        if (!newsCompleted(result,{settlementId:claim.settlementId,jobId:claim.jobId})) {
          await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'news_commit',status:'failed',attempt:claim.attempt,durationMs:elapsed(commitStarted),errorCode:'commit_unknown'});
          return {status:'failed',errorCode:'commit_unknown'};
        }
        await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'news_commit',status:'completed',attempt:claim.attempt,durationMs:elapsed(commitStarted)});
        return {status:'completed',kind:'news'};
      } catch (cause) {
        await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'news_commit',status:'failed',attempt:claim.attempt,durationMs:elapsed(newsStarted),errorCode:isLeaseError(cause as Error)?'lease_lost':'commit_unknown'});
        if (isLeaseError(cause as Error)) return {status:'lease_lost',errorCode:'lease_lost'};
        return {status:'failed',errorCode:dispatched?'commit_unknown':errorCode(cause)};
      }
    }
    if (claim.kind === 'canon') {
      const context=frozenCanonEventContext(claim.jobInputSnapshot);
      const canonPayload={worldSnapshot:claim.jobInputSnapshot.worldSnapshot ?? claim.jobInputSnapshot};
      const reject=async(reason:string):Promise<SettlementOutcome>=>{
        await saveCheckpoint(client,claim,'validated',{accepted:false,reason});
        await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'canon_validate',status:'skipped',attempt:claim.attempt,errorCode:'validation_rejected'});
        await completeSafely('rejected','The day settled without new world changes.','validation_rejected');
        return {status:'completed',kind:'rejected'};
      };
      if (!context) return await reject('canon_context_missing');
      let event=checkpoint(claim,CANON_CHECKPOINT_STAGE.canon_proposer)?.proposal;
      if (event) await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'canon_proposer',status:'reused',attempt:claim.attempt});
      else { const result=await generate('canon_proposer',canonPayload); event=result.value; await saveCheckpoint(client,claim,'proposer',{proposal:event},result); }
      let proposed=parseFrozenCanonEventProposal(event,canonPayload);
      if (!proposed) return await reject('canon_proposal_invalid');
      await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'canon_validate',status:'completed',attempt:claim.attempt});
      let rawCritic=checkpoint(claim,CANON_CHECKPOINT_STAGE.canon_critic)?.decision;
      if (rawCritic) await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'canon_critic',status:'reused',attempt:claim.attempt});
      else { const result=await generate('canon_critic',{...canonPayload,event:proposed}); rawCritic=result.value; await saveCheckpoint(client,claim,'critic',{decision:rawCritic},result); }
      let decision=parseCriticOutput(rawCritic);
      if (!decision || decision.outcome==='reject') return await reject('canon_critic_rejected');
      if (decision.outcome==='repair') {
        let repaired=checkpoint(claim,CANON_CHECKPOINT_STAGE.canon_repair)?.proposal;
        if (repaired) await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'canon_repair',status:'reused',attempt:claim.attempt});
        else { const result=await generate('canon_repair',{...canonPayload,event:proposed,instructions:decision.instructions}); repaired=result.value; await saveCheckpoint(client,claim,'repair',{proposal:repaired},result); }
        proposed=parseFrozenCanonEventProposal(repaired,canonPayload);
        if (!proposed) return await reject('canon_repair_invalid');
        let final=checkpoint(claim,CANON_CHECKPOINT_STAGE.canon_final_critic)?.decision;
        if (final) await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'canon_final_critic',status:'reused',attempt:claim.attempt});
        else { const result=await generate('canon_final_critic',{...canonPayload,event:proposed}); final=result.value; await saveCheckpoint(client,claim,'final_critic',{decision:final},result); }
        decision=parseCriticOutput(final);
        if (!decision || decision.outcome!=='accept') return await reject('canon_repair_rejected');
      }
      if (decision.outcome!=='accept') return await reject('canon_critic_malformed');
      await saveCheckpoint(client,claim,'validated',{accepted:true,event:proposed});
      const fingerprint=await fingerprintWorldCanonEventProposal(proposed,context);
      if (!fingerprint) return await reject('canon_fingerprint_invalid');
      if (guard.lost || !guard.canCall()) return {status:'lease_lost'};
      await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'canon_commit',status:'started',attempt:claim.attempt});
      const commitStarted=now();
      let dispatched=false;
      try {
        dispatched=true;
        const result=await rpc(client,'world_settlement_commit_canon',{p_settlement_id:claim.settlementId,p_job_id:claim.jobId,p_fence:claim.fence,p_event:proposed});
        if (!canonCommitted(result,{settlementId:claim.settlementId,jobId:claim.jobId,fingerprint})) {
          await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'canon_commit',status:'failed',attempt:claim.attempt,durationMs:elapsed(commitStarted),errorCode:'commit_unknown'});
          return {status:'failed',errorCode:'commit_unknown'};
        }
        await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'canon_commit',status:'completed',attempt:claim.attempt,durationMs:elapsed(commitStarted)});
        return {status:'completed',kind:'canon'};
      } catch (cause) {
        const code=isLeaseError(cause as Error)?'lease_lost':/PT409|conflict/i.test(String(cause))?'commit_conflict':'commit_unknown';
        await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'canon_commit',status:'failed',attempt:claim.attempt,durationMs:elapsed(commitStarted),errorCode:code});
        if (isLeaseError(cause as Error)) return {status:'lease_lost',errorCode:'lease_lost'};
        return {status:'failed',errorCode:dispatched?'commit_unknown':errorCode(cause)};
      }
    }
    if (claim.kind === 'social_encounter') {
      const context=parseFrozenSocialEncounterContext(claim.jobInputSnapshot);
      const reject=async(reason:string):Promise<SettlementOutcome> => {
        await saveCheckpoint(client,claim,'validated',{accepted:false,reason});
        await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'social_encounter_validate',status:'skipped',attempt:claim.attempt,errorCode:'validation_rejected'});
        await completeSafely('rejected','The day settled without new world changes.','validation_rejected','social_encounter_fallback');
        return {status:'completed',kind:'rejected'};
      };
      if (!context) return await reject('social_context_missing');
      try {
        let rawProposal=checkpoint(claim,SOCIAL_ENCOUNTER_CHECKPOINT_STAGE.social_encounter_proposer)?.proposal;
        if (rawProposal) {
          await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'social_encounter_proposer',status:'reused',attempt:claim.attempt});
        } else {
          const result=await generate('social_encounter_proposer',context);
          rawProposal=result.value;
          await saveCheckpoint(client,claim,SOCIAL_ENCOUNTER_CHECKPOINT_STAGE.social_encounter_proposer,{proposal:rawProposal},result);
        }
        let parsedProposal=parseSocialEncounterProposal(rawProposal,context);
        if (!parsedProposal.ok) return await reject('social_proposal_invalid');

        let rawDecision=checkpoint(claim,SOCIAL_ENCOUNTER_CHECKPOINT_STAGE.social_encounter_critic)?.decision;
        if (rawDecision) {
          await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'social_encounter_critic',status:'reused',attempt:claim.attempt});
        } else {
          const result=await generate('social_encounter_critic',{context,proposal:parsedProposal.value});
          rawDecision=result.value;
          await saveCheckpoint(client,claim,SOCIAL_ENCOUNTER_CHECKPOINT_STAGE.social_encounter_critic,{decision:rawDecision},result);
        }
        let decision=parseSocialEncounterCriticDecision(rawDecision);
        if (!decision || decision.decision === 'reject') return await reject('social_critic_rejected');

        if (decision.decision === 'repair') {
          let rawRepair=checkpoint(claim,SOCIAL_ENCOUNTER_CHECKPOINT_STAGE.social_encounter_repair)?.proposal;
          if (rawRepair) {
            await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'social_encounter_repair',status:'reused',attempt:claim.attempt});
          } else {
            const result=await generate('social_encounter_repair',{context,proposal:parsedProposal.value,instructions:decision.instructions});
            rawRepair=result.value;
            await saveCheckpoint(client,claim,SOCIAL_ENCOUNTER_CHECKPOINT_STAGE.social_encounter_repair,{proposal:rawRepair},result);
          }
          parsedProposal=parseSocialEncounterProposal(rawRepair,context);
          if (!parsedProposal.ok) return await reject('social_repair_invalid');
          let rawFinal=checkpoint(claim,SOCIAL_ENCOUNTER_CHECKPOINT_STAGE.social_encounter_final_critic)?.decision;
          if (rawFinal) {
            await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'social_encounter_final_critic',status:'reused',attempt:claim.attempt});
          } else {
            const result=await generate('social_encounter_final_critic',{context,proposal:parsedProposal.value});
            rawFinal=result.value;
            await saveCheckpoint(client,claim,SOCIAL_ENCOUNTER_CHECKPOINT_STAGE.social_encounter_final_critic,{decision:rawFinal},result);
          }
          decision=parseSocialEncounterCriticDecision(rawFinal);
          if (!decision || decision.decision !== 'accept') return await reject('social_repair_rejected');
        }
        if (decision.decision !== 'accept') return await reject('social_critic_malformed');
        await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'social_encounter_validate',status:'completed',attempt:claim.attempt});
        await saveCheckpoint(client,claim,'validated',{accepted:true,proposal:parsedProposal.value});

        const proposalFingerprint=await fingerprintSocialEncounterProposal(parsedProposal.value,context);
        if (!proposalFingerprint) return await reject('social_fingerprint_invalid');
        if (guard.lost || !guard.canCall()) return {status:'lease_lost',errorCode:'lease_lost'};
        const commitStarted=now();
        await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'social_encounter_commit',status:'started',attempt:claim.attempt});
        let dispatched=false;
        try {
          dispatched=true;
          const result=await rpc(client,'world_settlement_commit_social_encounter',{
            p_settlement_id:claim.settlementId,p_job_id:claim.jobId,p_fence:claim.fence,p_proposal:parsedProposal.value
          });
          if (!socialEncounterCommitted(result,{settlementId:claim.settlementId,jobId:claim.jobId,proposalFingerprint})) {
            await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'social_encounter_commit',status:'failed',attempt:claim.attempt,durationMs:elapsed(commitStarted),errorCode:'commit_unknown'});
            return {status:'failed',errorCode:'commit_unknown'};
          }
          await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'social_encounter_commit',status:'completed',attempt:claim.attempt,durationMs:elapsed(commitStarted)});
          return {status:'completed',kind:'social_encounter'};
        } catch (cause) {
          const code=isLeaseError(cause as Error) ? 'lease_lost' : /PT409|conflict/i.test(String(cause)) ? 'commit_conflict' : 'commit_unknown';
          await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'social_encounter_commit',status:'failed',attempt:claim.attempt,durationMs:elapsed(commitStarted),errorCode:code});
          if (isLeaseError(cause as Error)) return {status:'lease_lost',errorCode:'lease_lost'};
          return {status:'failed',errorCode:dispatched ? 'commit_unknown' : errorCode(cause)};
        }
      } catch (cause) {
        if (guard.lost || timedOut || controller.signal.aborted) {
          await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'social_encounter_fallback',status:'failed',attempt:claim.attempt,errorCode:'provider_timeout'});
          throw cause;
        }
        await completeSafely('skipped','The day settled without new world changes.',socialFallbackReason(cause),'social_encounter_fallback');
        return {status:'completed',kind:'skipped'};
      }
    }
    if (claim.kind === 'procedural_world') {
      const context=parseFrozenProceduralWorldContext(claim.jobInputSnapshot);
      const reject=async(reason:string):Promise<SettlementOutcome> => {
        await saveCheckpoint(client,claim,'validated',{accepted:false,reason});
        await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_validate',status:'skipped',attempt:claim.attempt,errorCode:'validation_rejected'});
        await completeSafely('rejected','The day settled without new world changes.','validation_rejected','procedural_world_fallback');
        return {status:'completed',kind:'rejected'};
      };
      if (!context) return await reject('procedural_world_context_missing');
      try {
        let rawProposal=checkpoint(claim,PROCEDURAL_WORLD_CHECKPOINT_STAGE.procedural_world_proposer)?.proposal;
        if (rawProposal) await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_proposer',status:'reused',attempt:claim.attempt});
        else {
          const result=await generate('procedural_world_proposer',context);
          rawProposal=result.value;
          await saveCheckpoint(client,claim,PROCEDURAL_WORLD_CHECKPOINT_STAGE.procedural_world_proposer,{proposal:rawProposal},result);
        }
        let parsedProposal=parseProceduralWorldProposal(rawProposal,context);
        if (!parsedProposal.ok) return await reject('procedural_world_proposal_invalid');

        let rawDecision=checkpoint(claim,PROCEDURAL_WORLD_CHECKPOINT_STAGE.procedural_world_critic)?.decision;
        if (rawDecision) await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_critic',status:'reused',attempt:claim.attempt});
        else {
          const result=await generate('procedural_world_critic',{context,proposal:parsedProposal.value});
          rawDecision=result.value;
          await saveCheckpoint(client,claim,PROCEDURAL_WORLD_CHECKPOINT_STAGE.procedural_world_critic,{decision:rawDecision},result);
        }
        let decision=parseProceduralWorldCriticDecision(rawDecision);
        if (!decision || decision.decision === 'reject') return await reject('procedural_world_critic_rejected');
        if (decision.decision === 'repair') {
          let rawRepair=checkpoint(claim,PROCEDURAL_WORLD_CHECKPOINT_STAGE.procedural_world_repair)?.proposal;
          if (rawRepair) await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_repair',status:'reused',attempt:claim.attempt});
          else {
            const result=await generate('procedural_world_repair',{context,proposal:parsedProposal.value,instructions:decision.instructions});
            rawRepair=result.value;
            await saveCheckpoint(client,claim,PROCEDURAL_WORLD_CHECKPOINT_STAGE.procedural_world_repair,{proposal:rawRepair},result);
          }
          parsedProposal=parseProceduralWorldProposal(rawRepair,context);
          if (!parsedProposal.ok) return await reject('procedural_world_repair_invalid');
          let rawFinal=checkpoint(claim,PROCEDURAL_WORLD_CHECKPOINT_STAGE.procedural_world_final_critic)?.decision;
          if (rawFinal) await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_final_critic',status:'reused',attempt:claim.attempt});
          else {
            const result=await generate('procedural_world_final_critic',{context,proposal:parsedProposal.value});
            rawFinal=result.value;
            await saveCheckpoint(client,claim,PROCEDURAL_WORLD_CHECKPOINT_STAGE.procedural_world_final_critic,{decision:rawFinal},result);
          }
          decision=parseProceduralWorldCriticDecision(rawFinal);
          if (!decision || decision.decision !== 'accept') return await reject('procedural_world_repair_rejected');
        }
        if (decision.decision !== 'accept') return await reject('procedural_world_critic_malformed');
        await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_validate',status:'completed',attempt:claim.attempt});
        await saveCheckpoint(client,claim,'validated',{accepted:true,proposal:parsedProposal.value});
        const proposalFingerprint=await fingerprintProceduralWorldProposal(parsedProposal.value,context);
        if (!proposalFingerprint) return await reject('procedural_world_fingerprint_invalid');
        if (guard.lost || !guard.canCall()) return {status:'lease_lost',errorCode:'lease_lost'};
        const commitStarted=now();
        await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_commit',status:'started',attempt:claim.attempt});
        let dispatched=false;
        try {
          dispatched=true;
          const result=await rpc(client,'world_settlement_commit_procedural_world',{p_settlement_id:claim.settlementId,p_job_id:claim.jobId,p_fence:claim.fence,p_proposal:parsedProposal.value});
          const replayed=proceduralWorldCommitReplay(result,{settlementId:claim.settlementId,jobId:claim.jobId,proposalFingerprint});
          if (replayed === null) {
            await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_commit',status:'failed',attempt:claim.attempt,durationMs:elapsed(commitStarted),errorCode:'commit_unknown'});
            return {status:'failed',errorCode:'commit_unknown'};
          }
          await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_commit',status:replayed?'reused':'completed',attempt:claim.attempt,...(replayed ? {} : {durationMs:elapsed(commitStarted)})});
          const promotionStarted=now();
          try {
            const promotion=proceduralWorldPromotionStatus(await rpc(client,'world_materialize_procedural_npc_packages',{
              p_settlement_id:claim.settlementId,p_job_id:claim.jobId
            }));
            if (!promotion) throw new Error('Procedural NPC promotion receipt was malformed.');
            await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_promotion',status:promotion,attempt:claim.attempt,...(promotion==='reused' ? {} : {durationMs:elapsed(promotionStarted)})});
            return {status:'completed',kind:'procedural_world'};
          } catch {
            await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_promotion',status:'failed',attempt:claim.attempt,durationMs:elapsed(promotionStarted),errorCode:'promotion_failed'});
            // The canonical command is already durable. Retry only its exact
            // immutable receipt so an uncertain first response cannot duplicate
            // provider work, world commands, or resident packages.
            try {
              const recovered=proceduralWorldPromotionStatus(await rpc(client,'world_retry_procedural_npc_package_materialization',{p_settlement_id:claim.settlementId,p_job_id:claim.jobId}));
              if (!recovered) throw new Error('Procedural NPC package retry receipt was malformed.');
              await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_promotion',status:recovered,attempt:claim.attempt});
              return {status:'completed',kind:'procedural_world'};
            } catch { /* The exact receipt remains available to an operator retry. */ }
            return {status:'failed',errorCode:'promotion_failed'};
          }
        } catch (cause) {
          const code=isLeaseError(cause as Error) ? 'lease_lost' : /PT409|conflict/i.test(String(cause)) ? 'commit_conflict' : 'commit_unknown';
          await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_commit',status:'failed',attempt:claim.attempt,durationMs:elapsed(commitStarted),errorCode:code});
          if (isLeaseError(cause as Error)) return {status:'lease_lost',errorCode:'lease_lost'};
          return {status:'failed',errorCode:dispatched ? 'commit_unknown' : errorCode(cause)};
        }
      } catch (cause) {
        if (guard.lost || timedOut || controller.signal.aborted) {
          await emitAiObservability(observability,{correlationId,workflow:'world_settlement',stage:'procedural_world_fallback',status:'failed',attempt:claim.attempt,errorCode:'provider_timeout'});
          throw cause;
        }
        await completeSafely('skipped','The day settled without new world changes.',socialFallbackReason(cause),'procedural_world_fallback');
        return {status:'completed',kind:'skipped'};
      }
    }
    if (claim.kind !== 'resident') {
      await completeSafely('skipped','The day settled without new world changes.');
      return { status:'completed', kind:'skipped' };
    }
    const context = frozenEvolutionContext(claim.jobInputSnapshot);
    if (!context) { await saveCheckpoint(client, claim, 'validated', { accepted:false, reason:'frozen_context_missing' }); await completeSafely('rejected','The day settled without new world changes.','validation_rejected'); return { status:'completed', kind:'rejected' }; }
    let proposal = checkpoint(claim, 'proposer')?.proposal;
    if (!proposal) {
      const result = await generate('proposer', { version:claim.jobInputVersion, jobKind:claim.kind, schema:context.schema, profile:context.profile, capability:context.capability, worldSnapshot:context.worldSnapshot, authorizedEvidence:context.authorizedEvidence });
      proposal = result.value; await saveCheckpoint(client, claim, 'proposer', { proposal }, result);
    }
    if (proposalValidationIssues(proposal,context)) { await saveCheckpoint(client, claim, 'validated', { accepted:false, reason:'proposal_invalid' }); await completeSafely('rejected','The day settled without new world changes.','validation_rejected'); return { status:'completed', kind:'rejected' }; }
    let critic = checkpoint(claim, 'critic')?.decision;
    if (!critic) { const result = await generate('critic', { proposal, schema:context.schema, profile:context.profile, capability:context.capability, worldSnapshot:context.worldSnapshot }); critic=result.value; await saveCheckpoint(client, claim, 'critic', { decision:critic }, result); }
    let decision = parseCriticOutput(critic);
    if (!decision) { await saveCheckpoint(client, claim, 'validated', { accepted:false, reason:'critic_malformed' }); await completeSafely('rejected','The day settled without new world changes.','validation_rejected'); return { status:'completed',kind:'rejected' }; }
    if (decision.outcome === 'repair') {
      let repaired = checkpoint(claim, 'repair')?.proposal;
      if (!repaired) { const result = await generate('repair', { proposal, instructions:decision.instructions, schema:context.schema, profile:context.profile, capability:context.capability, worldSnapshot:context.worldSnapshot, authorizedEvidence:context.authorizedEvidence }); repaired=result.value; await saveCheckpoint(client, claim, 'repair', { proposal:repaired }, result); }
      if (proposalValidationIssues(repaired,context)) { await saveCheckpoint(client, claim, 'validated', { accepted:false, reason:'repair_invalid' }); await completeSafely('rejected','The day settled without new world changes.','validation_rejected'); return { status:'completed',kind:'rejected' }; }
      proposal = repaired;
      let final = checkpoint(claim, 'final_critic')?.decision;
      if (!final) { const result = await generate('final_critic', { proposal, schema:context.schema, profile:context.profile, capability:context.capability, worldSnapshot:context.worldSnapshot }); final=result.value; await saveCheckpoint(client, claim, 'final_critic', { decision:final }, result); }
      decision = parseCriticOutput(final); if (!decision || decision.outcome !== 'accept') { await saveCheckpoint(client, claim, 'validated', { accepted:false, reason:'repair_rejected' }); await completeSafely('rejected','The day settled without new world changes.','validation_rejected'); return { status:'completed',kind:'rejected' }; }
    }
    if (decision.outcome !== 'accept') { await saveCheckpoint(client, claim, 'validated', { accepted:false, reason:'critic_rejected' }); await completeSafely('rejected','The day settled without new world changes.','validation_rejected'); return { status:'completed',kind:'rejected' }; }
    await saveCheckpoint(client, claim, 'validated', { accepted:true, proposal });
    let digest = checkpoint(claim, 'digest')?.digest;
    if (!digest) { const result = await generate('digest', publicFacts(claim, true)); digest=result.value; await saveCheckpoint(client, claim, 'digest', { digest }, result); }
    if (guard.lost || !guard.canCall()) return { status:'lease_lost' };
    const proposalFingerprint = await fingerprintMutationProposal(proposal);
    if (!proposalFingerprint) throw new SettlementProviderError('provider_malformed', 'Accepted mutation proposal could not be fingerprinted.');
    let commitDispatched = false;
    try {
      commitDispatched = true;
      const persisted = await rpc(client, 'world_settlement_commit_mutation', {
        p_settlement_id:claim.settlementId,
        p_job_id:claim.jobId,
        p_fence:claim.fence,
        p_proposal:proposal,
        p_proposal_fingerprint:proposalFingerprint,
        p_public_digest:digestText(digest)
      });
      const outcome = committedKind(persisted, {
        settlementId: claim.settlementId,
        jobId: claim.jobId,
        proposalFingerprint,
        publicDigest: digestText(digest)
      });
      if (!outcome) return { status:'failed', errorCode:'commit_unknown' };
      return { status:'completed', kind:outcome };
    } catch (error) {
      if (isLeaseError(error as Error)) return { status:'lease_lost', errorCode:'lease_lost' };
      if (commitDispatched) return { status:'failed', errorCode:'commit_unknown' };
      throw error;
    }
  } catch (cause) {
    if (guard.lost) return { status:'lease_lost', errorCode:errorCode(cause) };
    if (timedOut) {
      try { await rpc(client, 'world_settlement_fail', { p_settlement_id:claim.settlementId, p_job_id:claim.jobId, p_fence:claim.fence, p_failure_code:'provider_timeout' }); } catch { /* A competing fence won safely. */ }
      return { status:'failed', errorCode:'provider_timeout' };
    }
    try { await rpc(client, 'world_settlement_fail', { p_settlement_id:claim.settlementId, p_job_id:claim.jobId, p_fence:claim.fence, p_failure_code:errorCode(cause).slice(0,80) }); } catch (error) { if (isLeaseError(error as Error)) return { status:'lease_lost', errorCode:errorCode(cause) }; }
    return { status:'failed', errorCode:errorCode(cause) };
  } finally { guard.stop(); clearTimeout(timeout); }
}

/** Serial claim processing makes the DB fence the only concurrency authority. */
export async function drainWorldSettlementQueue(limit = 4, client = serviceClient(), runtime: SettlementRuntime = {}): Promise<SettlementOutcome[]> {
  if (!client) return []; const outcomes: SettlementOutcome[]=[];
  const capacity=Math.max(1,Math.min(limit,4));
  const unattendedRuntime = { ...runtime, observability: runtime.observability ?? localAiObservabilitySink, promptRegistry: runtime.promptRegistry ?? promptRegistryService(client) };
  for (let index=0; index<capacity; index+=1) {
    const next = await client.rpc('world_settlement_claim_next', {}); if (next.error) break;
    const outcome = await runSettlementClaim(client, next.data, unattendedRuntime); outcomes.push(outcome); if (outcome.status==='idle') break;
  }
  // A terminal quest is created by a completed settlement. Drain a small
  // separate batch after normal settlement work so a slow model never holds a
  // day-close transaction or starves the settlement queue.
  const remaining=capacity-outcomes.length;
  if(remaining>0) outcomes.push(...await drainQuestTransitionQueue(remaining, client, unattendedRuntime));
  return outcomes;
}
type WorkerState = { running:boolean; timer:ReturnType<typeof setInterval>|null };
const key = Symbol.for('brac.world-settlement-worker');
function state(): WorkerState { const target=globalThis as typeof globalThis & { [key]?:WorkerState }; return target[key] ??= { running:false,timer:null }; }
export function wakeWorldSettlementWorker(): void { const current=state(); if(current.running) return; current.running=true; void drainWorldSettlementQueue().catch(()=>undefined).finally(()=>{current.running=false;}); }
export function startWorldSettlementWorker(intervalMs=15_000): void { const current=state(); if(current.timer || process.env.NODE_ENV==='test' || process.env.VITEST || !runtimeConfig().SUPABASE_SERVICE_ROLE_KEY) return; current.timer=setInterval(wakeWorldSettlementWorker,Math.max(5_000,Math.min(intervalMs,60_000))); current.timer.unref?.(); wakeWorldSettlementWorker(); }
export function stopWorldSettlementWorker(): void { const current=state(); if(current.timer) clearInterval(current.timer); current.timer=null; }
