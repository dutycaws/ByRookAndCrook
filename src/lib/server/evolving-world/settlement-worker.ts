import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { parseMutationProposal, validatePersonalityProfile, validatePersonalitySchema, validateMutationProposal, validateQuestChanges, validateWorldEffectCommands } from '$lib/game/evolving-world';
import type { Database } from '$lib/database.types';
import { getSupabaseConfig } from '$lib/server/config';
import { privateRuntimeEnvironment } from '$lib/server/private-runtime-environment';
import { createSettlementProvider } from './provider';
import {
  frozenEvolutionContext, parseCriticOutput, parsePublicDigest, parseSettlementClaim, proposalBeliefsAreAttributed, proposalEvidenceIsAuthorized, SettlementProviderError,
  type ProviderResult, type ProviderStage, type SettlementClaim, type SettlementProvider
} from './settlement-contracts';

type RpcResult = { data: unknown; error: { message: string } | null };
export type SettlementWorkerClient = { rpc(name: string, args?: Record<string, unknown>): Promise<RpcResult> };
export type SettlementOutcome = { status: 'idle' | 'completed' | 'lease_lost' | 'failed'; kind?: string; errorCode?: string };
export type SettlementRuntime = { provider?: SettlementProvider; now?: () => number; timeoutMs?: number; heartbeatMs?: number };
const MAX_CALLS = 5;
const MAX_TOTAL_MS = 90_000;

function runtimeConfig() { return privateRuntimeEnvironment(env); }
function serviceClient(config = runtimeConfig()): SettlementWorkerClient | null {
  if (!config.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient<Database>(getSupabaseConfig().url, config.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false,autoRefreshToken:false} }) as unknown as SettlementWorkerClient;
}
function clip(value: string, limit: number): string { return value.replace(/\s+/g, ' ').trim().slice(0, limit); }
function errorCode(cause: unknown): string { return cause instanceof SettlementProviderError ? cause.code : 'worker_failed'; }
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

/** Runs one fenced job. Accepted proposals are checkpointed privately, then end in safe_result until Gate E owns mechanical commits. */
export async function runSettlementClaim(client: SettlementWorkerClient, rawClaim: unknown, runtime: SettlementRuntime = {}): Promise<SettlementOutcome> {
  let parsed; try { parsed = parseSettlementClaim(rawClaim); } catch { return { status:'failed', errorCode:'claim_malformed' }; }
  if ('status' in parsed) return { status:'idle' };
  const claim = parsed; const deadline = Math.min(Math.max(1_000, runtime.timeoutMs ?? MAX_TOTAL_MS), MAX_TOTAL_MS);
  const controller = new AbortController(); let timedOut = false; const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, deadline);
  const guard = new LeaseGuard(client, claim, controller, Math.max(1_000, Math.min(runtime.heartbeatMs ?? 20_000, 45_000)));
  const provider = runtime.provider ?? createSettlementProvider(runtimeConfig()); let calls = 0;
  const generate = async (stage: ProviderStage, payload: unknown): Promise<ProviderResult> => {
    if (calls >= MAX_CALLS) throw new SettlementProviderError('provider_failed', 'Settlement model-call budget exhausted.');
    if (!guard.canCall() || !await guard.establish()) throw new SettlementProviderError('provider_timeout', 'Settlement lease was lost.');
    calls += 1; return provider.generate(stage, payload, controller.signal);
  };
  try {
    if (!await guard.establish()) return { status:'lease_lost', errorCode:'lease_unavailable' };
    const context = frozenEvolutionContext(claim.jobInputSnapshot);
    if (!context) { await saveCheckpoint(client, claim, 'validated', { accepted:false, reason:'frozen_context_missing' }); await safeResult(client, claim, 'rejected', 'The day settled without new world changes.'); return { status:'completed', kind:'rejected' }; }
    let proposal = checkpoint(claim, 'proposer')?.proposal;
    if (!proposal) {
      const result = await generate('proposer', { version:claim.jobInputVersion, jobKind:claim.kind, schema:context.schema, profile:context.profile, capability:context.capability, worldSnapshot:context.worldSnapshot, authorizedEvidence:context.authorizedEvidence });
      proposal = result.value; await saveCheckpoint(client, claim, 'proposer', { proposal }, result);
    }
    if (proposalValidationIssues(proposal,context)) { await saveCheckpoint(client, claim, 'validated', { accepted:false, reason:'proposal_invalid' }); await safeResult(client, claim, 'rejected', 'The day settled without new world changes.'); return { status:'completed', kind:'rejected' }; }
    let critic = checkpoint(claim, 'critic')?.decision;
    if (!critic) { const result = await generate('critic', { proposal, schema:context.schema, profile:context.profile, capability:context.capability, worldSnapshot:context.worldSnapshot }); critic=result.value; await saveCheckpoint(client, claim, 'critic', { decision:critic }, result); }
    let decision = parseCriticOutput(critic);
    if (!decision) { await saveCheckpoint(client, claim, 'validated', { accepted:false, reason:'critic_malformed' }); await safeResult(client, claim, 'rejected', 'The day settled without new world changes.'); return { status:'completed',kind:'rejected' }; }
    if (decision.outcome === 'repair') {
      let repaired = checkpoint(claim, 'repair')?.proposal;
      if (!repaired) { const result = await generate('repair', { proposal, instructions:decision.instructions, schema:context.schema, profile:context.profile, capability:context.capability, worldSnapshot:context.worldSnapshot, authorizedEvidence:context.authorizedEvidence }); repaired=result.value; await saveCheckpoint(client, claim, 'repair', { proposal:repaired }, result); }
      if (proposalValidationIssues(repaired,context)) { await saveCheckpoint(client, claim, 'validated', { accepted:false, reason:'repair_invalid' }); await safeResult(client, claim, 'rejected', 'The day settled without new world changes.'); return { status:'completed',kind:'rejected' }; }
      proposal = repaired;
      let final = checkpoint(claim, 'final_critic')?.decision;
      if (!final) { const result = await generate('final_critic', { proposal, schema:context.schema, profile:context.profile, capability:context.capability, worldSnapshot:context.worldSnapshot }); final=result.value; await saveCheckpoint(client, claim, 'final_critic', { decision:final }, result); }
      decision = parseCriticOutput(final); if (!decision || decision.outcome !== 'accept') { await saveCheckpoint(client, claim, 'validated', { accepted:false, reason:'repair_rejected' }); await safeResult(client, claim, 'rejected', 'The day settled without new world changes.'); return { status:'completed',kind:'rejected' }; }
    }
    if (decision.outcome !== 'accept') { await saveCheckpoint(client, claim, 'validated', { accepted:false, reason:'critic_rejected' }); await safeResult(client, claim, 'rejected', 'The day settled without new world changes.'); return { status:'completed',kind:'rejected' }; }
    await saveCheckpoint(client, claim, 'validated', { accepted:true, proposal, note:'Proposal is retained for Gate E; no mechanics were applied.' });
    let digest = checkpoint(claim, 'digest')?.digest;
    if (!digest) { const result = await generate('digest', publicFacts(claim, true)); digest=result.value; await saveCheckpoint(client, claim, 'digest', { digest }, result); }
    if (guard.lost) return { status:'lease_lost' };
    await safeResult(client, claim, 'no_changes', digestText(digest)); return { status:'completed',kind:'no_changes' };
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
  for (let index=0; index<Math.max(1,Math.min(limit,4)); index+=1) {
    const next = await client.rpc('world_settlement_claim_next', {}); if (next.error) break;
    const outcome = await runSettlementClaim(client, next.data, runtime); outcomes.push(outcome); if (outcome.status==='idle') break;
  }
  return outcomes;
}
type WorkerState = { running:boolean; timer:ReturnType<typeof setInterval>|null };
const key = Symbol.for('brac.world-settlement-worker');
function state(): WorkerState { const target=globalThis as typeof globalThis & { [key]?:WorkerState }; return target[key] ??= { running:false,timer:null }; }
export function wakeWorldSettlementWorker(): void { const current=state(); if(current.running) return; current.running=true; void drainWorldSettlementQueue().catch(()=>undefined).finally(()=>{current.running=false;}); }
export function startWorldSettlementWorker(intervalMs=15_000): void { const current=state(); if(current.timer || process.env.NODE_ENV==='test' || process.env.VITEST || !runtimeConfig().SUPABASE_SERVICE_ROLE_KEY) return; current.timer=setInterval(wakeWorldSettlementWorker,Math.max(5_000,Math.min(intervalMs,60_000))); current.timer.unref?.(); wakeWorldSettlementWorker(); }
export function stopWorldSettlementWorker(): void { const current=state(); if(current.timer) clearInterval(current.timer); current.timer=null; }
