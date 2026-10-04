import {
  parseQuestTransitionCriticDecision,
  parseQuestTransitionProposal,
  validateQuestTransitionProposal,
  type QuestTransitionValidationContext
} from '$lib/game/evolving-world';
import { emitAiObservability, type AiFailureDiagnostic, type AiObservabilitySink } from '$lib/server/observability/ai-events';
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
import { createHash } from 'node:crypto';
import { retrieveNpcMemoryEvidence, type NpcMemoryEvidenceClient } from '$lib/server/npc-memory/retrieval';
import { createNpcMemoryEmbeddingProvider } from '$lib/server/npc-memory/provider';
import type { NpcMemoryEmbeddingProvider } from '$lib/server/npc-memory/contracts';
import { assembleNpcMemoryContext, canonicalJson, canonicalNpcMemoryContextPayload, sha256Hex, TRANSITION_CONTEXT_TIERS, transitionContextTier, type NpcMemoryContextArtifact } from '$lib/server/npc-memory/context';
import { invalidateProjectionInstance } from '$lib/server/npc-memory/projection-cache';

type QuestTransitionCheckpoint = { stage: 'memory_context' | 'proposer' | 'critic' | 'repair' | 'final_critic'; payload: Record<string, unknown> };
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
type QuestTransitionRuntime = SettlementRuntime & {
  embeddingProvider?: NpcMemoryEmbeddingProvider;
  /** A server-owned token counter/preflight.  No provider call is made without it. */
  countMemoryContext?: (canonicalContext: string, signal: AbortSignal) => Promise<{ model:string; counterId:string; inputTokens:number; durationMs:number }>;
};
type QuestTransitionMemoryDossier = Readonly<{
  version: 'quest-transition-memory-dossier-v1';
  fingerprint: string;
  manifest: Readonly<{
    transitionId: string;
    terminalEventId: string;
    sourceFingerprint: string;
    sourceVersions: readonly Readonly<{ path: string; id: string; version?: string; hash?: string }>[];
  }>;
  coverage: Readonly<{
    terminalEvent: boolean;
    eventHistory: number;
    dialogueEvidence: number;
    beliefs: number;
    socialEdges: number;
    sourceVersions: number;
  }>;
  bytes: Readonly<{ frozenContext: number; dossier: number }>;
  evidence: Record<string, unknown>;
}>;

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
  constructor(message: string, readonly reasonCode: AiFailureDiagnostic['reasonCode'] = 'unclassified', readonly tokenBudget?: { inputTokens: number; maxTokens: number }) { super(message); this.name = 'TransitionValidationError'; }
}
function failureDiagnostic(cause: unknown, stage: AiFailureDiagnostic['stage']): AiFailureDiagnostic {
  if (cause instanceof TransitionValidationError) return { stage, errorClass: 'transition_validation', reasonCode: cause.reasonCode, ...(cause.tokenBudget ?? {}) };
  if (cause instanceof SettlementProviderError) return { stage, errorClass: 'settlement_provider', reasonCode: cause.diagnosticReason ?? cause.code };
  return { stage, errorClass: cause instanceof Error ? 'ordinary_error' : 'unknown', reasonCode: 'unclassified' };
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
function serializedUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
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
    if (!object(raw) || !['memory_context', 'proposer', 'critic', 'repair', 'final_critic'].includes(String(raw.stage)) || !object(raw.payload)) return null;
    try { if (serializedUtf8Bytes(raw.payload) > (raw.stage==='memory_context' ? 512 * 1024 : 16 * 1024)) return null; } catch { return null; }
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
    || !envelope.allowedActions.every((value) => typeof value === 'string')
    || !envelope.allowedApproaches.every((value) => typeof value === 'string')
    || ('allowedWorldEffects' in envelope && (!Array.isArray(envelope.allowedWorldEffects) || !envelope.allowedWorldEffects.every((value) => typeof value === 'string')))
    || ('allowGeneratedSuccessor' in envelope && typeof envelope.allowGeneratedSuccessor !== 'boolean')
    || ('allowDeparture' in envelope && typeof envelope.allowDeparture !== 'boolean')) return null;
  // 077 supplies the explicit booleans. Keep old frozen claims replayable by
  // deriving their gates from the historical effect envelope instead of
  // granting departure implicitly.
  const legacyEffects = Array.isArray(envelope.allowedWorldEffects) ? envelope.allowedWorldEffects as string[] : [];
  const allowGeneratedSuccessor = typeof envelope.allowGeneratedSuccessor === 'boolean'
    ? envelope.allowGeneratedSuccessor : legacyEffects.includes('create_quest');
  const allowDeparture = typeof envelope.allowDeparture === 'boolean'
    ? envelope.allowDeparture : legacyEffects.includes('departure');
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
      allowGeneratedSuccessor, allowDeparture
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
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function utf8Bytes(value: unknown): number { return new TextEncoder().encode(canonical(value)).byteLength; }
function sourceVersions(value: unknown, path = '$', results: Array<{ path: string; id: string; version?: string; hash?: string }> = []): Array<{ path: string; id: string; version?: string; hash?: string }> {
  if (Array.isArray(value)) { value.forEach((item, index) => sourceVersions(item, `${path}[${index}]`, results)); return results; }
  if (!object(value)) return results;
  const id = typeof value.id === 'string' ? value.id : typeof value.sourceId==='string' ? value.sourceId : undefined;
  const version = typeof value.versionId === 'string' ? value.versionId : typeof value.version === 'string' ? value.version : Number.isSafeInteger(value.sourceVersion) ? String(value.sourceVersion) : undefined;
  const hash = typeof value.packageHash === 'string' ? value.packageHash : typeof value.contentHash === 'string' ? value.contentHash : typeof value.sourceHash==='string' ? value.sourceHash : undefined;
  if (id && (version || hash || path === '$.terminalEvent')) results.push({ path, id, ...(version ? { version } : {}), ...(hash ? { hash } : {}) });
  Object.keys(value).sort().forEach((key) => sourceVersions(value[key], `${path}.${key}`, results));
  return results;
}
function freeze<T>(value: T): T {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (object(value)) Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
/**
 * The context is already terminal-bound and durable.  This wrapper gives every
 * model stage an explicit, replayable evidence dossier without re-querying a
 * mutable memory index on a later settlement attempt.
 */
const TRANSITION_EVIDENCE_PROJECTION_VERSION = 'npc-transition-evidence-v2';
const TRANSITION_EVIDENCE_SEMANTICS = 'A bundle selectedItemRef points to the matching full item by id. bundleMemberDictionary stores each exact canonical member object once; memberRefs expand in order and preserve repeated occurrences. Include the selected item once alongside expanded members when reasoning about coverage. channelRanks, fusedScore, and selectionReasons are retrieval ranking metadata, not facts.';
const LEGACY_TRANSITION_EVIDENCE_PROJECTION_VERSION = 'npc-transition-evidence-v1';
const LEGACY_TRANSITION_EVIDENCE_SEMANTICS = 'A bundle selectedItemRef points to the matching full item by id; include that selected item once alongside the literal bundle members when reasoning about coverage. channelRanks, fusedScore, and selectionReasons are retrieval ranking metadata, not facts.';
function projectTransitionEvidence(evidence: Record<string, unknown>, projectionVersion = TRANSITION_EVIDENCE_PROJECTION_VERSION): Record<string, unknown> | null {
  if (!Array.isArray(evidence.items) || !Array.isArray(evidence.bundles)) return null;
  if (projectionVersion !== TRANSITION_EVIDENCE_PROJECTION_VERSION && projectionVersion !== LEGACY_TRANSITION_EVIDENCE_PROJECTION_VERSION) return null;
  const items = evidence.items as unknown[];
  const itemById = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    if (!object(item) || typeof item.id !== 'string' || itemById.has(item.id)) return null;
    itemById.set(item.id, item);
  }
  const bundles: Record<string, unknown>[] = [];
  const memberDictionary: Record<string, unknown>[] = [];
  const memberRefByCanonical = new Map<string, number>();
  for (const value of evidence.bundles as unknown[]) {
    if (!object(value) || typeof value.selectedId !== 'string' || !Array.isArray(value.members)) return null;
    const selected = itemById.get(value.selectedId);
    const selectedFacts = selected ? Object.fromEntries(Object.entries(selected).filter(([key]) => !['channelRanks', 'fusedScore', 'selectionReasons'].includes(key))) : null;
    const matches = selectedFacts ? value.members.map((member, index) => ({ member, index })).filter(({ member }) => object(member) && canonical(member) === canonical(selectedFacts)) : [];
    if (matches.length > 1) return null;
    const match = matches[0];
    const members = match ? value.members.filter((_member, index) => index !== match.index) : value.members;
    if (projectionVersion === LEGACY_TRANSITION_EVIDENCE_PROJECTION_VERSION) {
      bundles.push({
        ...value,
        selectedItemRef: match ? value.selectedId : null,
        members
      });
      continue;
    }
    const memberRefs: number[] = [];
    for (const member of members) {
      if (!object(member)) return null;
      // Canonical full payload keys deduplicate only semantically exact JSON
      // objects. IDs alone are insufficient because a single ID can carry
      // distinct evidence variants.
      const key = canonical(member);
      let reference = memberRefByCanonical.get(key);
      if (reference === undefined) {
        reference = memberDictionary.length;
        memberRefByCanonical.set(key, reference);
        memberDictionary.push(member);
      }
      memberRefs.push(reference);
    }
    const { members: _members, ...bundle } = value;
    bundles.push({ ...bundle, selectedItemRef: match ? value.selectedId : null, memberRefs });
  }
  return projectionVersion === LEGACY_TRANSITION_EVIDENCE_PROJECTION_VERSION
    ? { ...evidence, transitionProjectionVersion: projectionVersion, bundles }
    : { ...evidence, transitionProjectionVersion: projectionVersion, bundleMemberDictionary: memberDictionary, bundles };
}

function memoryDossier(claim: QuestTransitionClaim, memoryContext?: Record<string, unknown>): QuestTransitionMemoryDossier {
  // The historical terminal snapshot remains authoritative context; v4
  // evidence is a separately frozen, source-manifested attachment.  The
  // durable checkpoint deliberately stores raw evidence plus its canonical
  // representation for replay integrity; only one compact authorized copy is
  // allowed into a model request.
  const attachment=memoryContext?.attachment as Partial<NpcMemoryContextArtifact> | undefined;
  const compactAttachment=attachment ? {
    tier: memoryContext?.tier,
    policyVersion: attachment.policyVersion,
    projectionVersion: attachment.projectionVersion,
    ...(attachment.projectionVersion === TRANSITION_EVIDENCE_PROJECTION_VERSION ? { projectionSemantics: TRANSITION_EVIDENCE_SEMANTICS } : attachment.projectionVersion === LEGACY_TRANSITION_EVIDENCE_PROJECTION_VERSION ? { projectionSemantics: LEGACY_TRANSITION_EVIDENCE_SEMANTICS } : {}),
    sourceManifest: attachment.sourceManifest,
    coverage: attachment.coverage,
    payload: attachment.payload,
    hash: attachment.hash,
    utf8Bytes: attachment.utf8Bytes,
    tokens: attachment.tokens,
    cutoffSequence: attachment.cutoffSequence,
    view: attachment.view
  } : undefined;
  const evidence = compactAttachment ? {...claim.frozenContext,memoryContext:compactAttachment} : claim.frozenContext;
  const versions = sourceVersions(evidence);
  const sourceFingerprint = createHash('sha256').update(canonical(evidence)).digest('hex');
  const manifest = { transitionId: claim.transitionId, terminalEventId: claim.terminalEventId, sourceFingerprint, sourceVersions: versions };
  const coverage = {
    terminalEvent: object(evidence.terminalEvent) && evidence.terminalEvent.id === claim.terminalEventId,
    eventHistory: Array.isArray(evidence.eventHistory) ? evidence.eventHistory.length : 0,
    dialogueEvidence: Array.isArray(evidence.dialogueEvidence) ? evidence.dialogueEvidence.length : 0,
    beliefs: Array.isArray(evidence.beliefs) ? evidence.beliefs.length : 0,
    socialEdges: Array.isArray(evidence.socialEdges) ? evidence.socialEdges.length : 0,
    sourceVersions: versions.length
  };
  const metadata = { version: 'quest-transition-memory-dossier-v1' as const, manifest, coverage, evidence };
  const bytes = { frozenContext: utf8Bytes(evidence), dossier: utf8Bytes(metadata) };
  const fingerprint = createHash('sha256').update(canonical({ ...metadata, bytes })).digest('hex');
  return freeze({ version: metadata.version, fingerprint, manifest: freeze(manifest), coverage: freeze(coverage), bytes: freeze(bytes), evidence });
}

const MEMORY_CONTEXT_BYTES=512*1024;
function validMemoryContext(value: unknown): value is Record<string, unknown> {
  if (!object(value) || !object(value.evidence) || typeof value.querySemantic!=='string' || !Number.isSafeInteger(value.cutoffLedgerSequence)
    || typeof value.manifestHash!=='string' || !/^[0-9a-f]{64}$/i.test(value.manifestHash) || typeof value.contextFingerprint!=='string' || !/^[0-9a-f]{64}$/i.test(value.contextFingerprint) || !object(value.budget)) return false;
  const budget=value.budget as Record<string,unknown>;
  const evidence=value.evidence as Record<string,unknown>;
  const manifest=value.sourceManifest;
  const tier=value.tier==='ordinary' ? TRANSITION_CONTEXT_TIERS.ordinary : value.tier==='rich' ? TRANSITION_CONTEXT_TIERS.rich : null;
  const attachment=value.attachment as Partial<NpcMemoryContextArtifact> | undefined;
  const normalizedManifest=Array.isArray(manifest) ? manifest.map((source:any)=>({id:source?.sourceId,version:source?.sourceVersion,hash:source?.sourceHash,kind:source?.sourceKind,ledgerSequence:source?.ledgerSequence})) : [];
  const attachmentEvidence = attachment?.projectionVersion === TRANSITION_EVIDENCE_PROJECTION_VERSION || attachment?.projectionVersion === LEGACY_TRANSITION_EVIDENCE_PROJECTION_VERSION
    ? projectTransitionEvidence(evidence, attachment.projectionVersion)
    : attachment?.projectionVersion === 'npc-memory-evidence-v4' ? evidence : null;
  if (!attachmentEvidence) return false;
  const expectedAttachmentPayload={evidence:attachmentEvidence,querySemantic:value.querySemantic,cutoffLedgerSequence:value.cutoffLedgerSequence};
  if (!Array.isArray(manifest) || !tier || !attachment || attachment.tier!==tier.tier || attachment.overallMaxBytes!==tier.overallMaxBytes || attachment.overallMaxTokens!==tier.overallMaxTokens
    || !Number.isSafeInteger(evidence.cutoffLedgerSequence) || evidence.cutoffLedgerSequence!==value.cutoffLedgerSequence
    || attachment.cutoffSequence!==value.cutoffLedgerSequence || attachment.view!=='transition'
    || canonicalJson(attachment.payload) !== canonicalJson(expectedAttachmentPayload)
    || canonicalJson(attachment.sourceManifest) !== canonicalJson(normalizedManifest)
    || createHash('sha256').update(canonical(manifest)).digest('hex')!==value.manifestHash || createHash('sha256').update(canonical(evidence)).digest('hex')!==value.contextFingerprint
    || attachment.canonicalJson!==canonicalNpcMemoryContextPayload({sources:attachment.sourceManifest ?? [],requiredSourceIds:(attachment.coverage as any)?.required ?? [],payload:attachment.payload as Record<string,unknown>})
    || attachment.hash!==sha256Hex(attachment.canonicalJson ?? '') || attachment.utf8Bytes!==budget.utf8Bytes || attachment.tokens!==budget.inputTokens
    || !Number.isSafeInteger(attachment.utf8Bytes) || (attachment.utf8Bytes as number)<0 || (attachment.utf8Bytes as number)>tier.maxBytes
    || !Number.isSafeInteger(attachment.tokens) || (attachment.tokens as number)<0 || (attachment.tokens as number)>tier.maxTokens) return false;
  return Number.isSafeInteger(budget.utf8Bytes) && (budget.utf8Bytes as number)>=0 && (budget.utf8Bytes as number)<=MEMORY_CONTEXT_BYTES
    && Number.isSafeInteger(budget.inputTokens) && (budget.inputTokens as number)>=0 && (budget.inputTokens as number)<=tier.maxTokens
    && typeof budget.model==='string' && typeof budget.counterId==='string';
}
async function captureMemoryContext(client: SettlementWorkerClient, claim: QuestTransitionClaim, runtime: QuestTransitionRuntime, provider: SettlementProvider, signal: AbortSignal): Promise<Record<string,unknown> | null> {
  const replay=checkpoint(claim,'memory_context');
  if (replay) {
    const expectedTier = transitionContextTier(claim.frozenContext).tier;
    return validMemoryContext(replay) && replay.tier === expectedTier ? replay : null;
  }
  const scope=await rpc(client,'world_quest_transition_memory_scope',{p_transition_id:claim.transitionId,p_fence:claim.fence});
  if (!object(scope) || !uuid.test(String(scope.actorId)) || !uuid.test(String(scope.instanceId)) || !Number.isSafeInteger(scope.cutoffLedgerSequence)) {
    throw new TransitionValidationError('Transition memory scope is unavailable.', 'scope_invalid');
  }
  const evidenceClient: NpcMemoryEvidenceClient={rpc:async(name,args)=>{
    const result=await client.rpc(name,args);
    return result as any;
  }};
  const config=privateRuntimeEnvironment(env);
  const embedding=runtime.embeddingProvider ?? (config.OPENAI_API_KEY&&config.NPC_EMBEDDING_MODEL&&config.NPC_EMBEDDING_DIMENSIONS ? createNpcMemoryEmbeddingProvider(config) : undefined);
  const tier=transitionContextTier(claim.frozenContext);
  const result=await retrieveNpcMemoryEvidence(evidenceClient,{actorId:scope.actorId as string,instanceId:scope.instanceId as string,view:'transition',cutoffLedgerSequence:scope.cutoffLedgerSequence as number,
    query:`Quest transition ${claim.terminalEventId}`,knownRefs:[claim.terminalEventId],budget:{limit:tier.limit,candidateLimit:tier.candidateLimit,fallbackLimit:16},signal},embedding);
  const raw=result.evidence as Record<string,unknown>;
  if (!object(raw.coverage) || raw.coverage.complete!==true) throw new TransitionValidationError('Transition evidence coverage is incomplete.', 'coverage_incomplete');
  const manifest=Array.isArray(raw.sourceManifest)?raw.sourceManifest:[];
  const sources=manifest.map((source:any)=>({id:source.sourceId,version:source.sourceVersion,hash:source.sourceHash,kind:source.sourceKind,ledgerSequence:source.ledgerSequence}));
  if (!sources.every(source=>typeof source.id==='string'&&Number.isSafeInteger(source.version)&&typeof source.hash==='string'&&typeof source.kind==='string'&&Number.isSafeInteger(source.ledgerSequence))) throw new TransitionValidationError('Transition evidence manifest is invalid.', 'manifest_invalid');
  const projectedEvidence=projectTransitionEvidence(raw);
  if (!projectedEvidence) throw new TransitionValidationError('Transition evidence projection is invalid.', 'evidence_projection_invalid');
  const attachmentPayload={evidence:projectedEvidence,querySemantic:result.querySemantic,cutoffLedgerSequence:scope.cutoffLedgerSequence};
  const canonicalEvidence=canonicalNpcMemoryContextPayload({sources,requiredSourceIds:sources.map(source=>source.id),payload:attachmentPayload});
  const counter=runtime.countMemoryContext ?? provider.countMemoryContext;
  if (!counter) throw new TransitionValidationError('Transition evidence token counter is unavailable.', 'counter_unavailable');
  const counted=await counter(canonicalEvidence,signal);
  if (!string(counted.model,120)||!string(counted.counterId,120)||!Number.isSafeInteger(counted.inputTokens)||counted.inputTokens<0||!Number.isSafeInteger(counted.durationMs)||counted.durationMs<0) throw new TransitionValidationError('Transition evidence token count is invalid.', 'counter_result_invalid');
  if (counted.inputTokens>tier.maxTokens) throw new TransitionValidationError('Transition evidence token count is invalid.', 'counter_budget_exceeded', { inputTokens: counted.inputTokens, maxTokens: tier.maxTokens });
  const attachment=assembleNpcMemoryContext({policyVersion:'npc-transition-evidence-v1',projectionVersion:TRANSITION_EVIDENCE_PROJECTION_VERSION,maxBytes:tier.maxBytes,maxTokens:tier.maxTokens,tier:tier.tier,overallMaxBytes:tier.overallMaxBytes,overallMaxTokens:tier.overallMaxTokens,sources,requiredSourceIds:sources.map(source=>source.id),payload:attachmentPayload,tokenCount:counted.inputTokens,tokenizerId:counted.counterId,counterId:counted.counterId,counterDurationMs:counted.durationMs,model:counted.model,cutoffSequence:scope.cutoffLedgerSequence as number,view:'transition'});
  const payload={tier:tier.tier,evidence:raw,querySemantic:result.querySemantic,cutoffLedgerSequence:scope.cutoffLedgerSequence,sourceManifest:manifest,manifestHash:createHash('sha256').update(canonical(manifest)).digest('hex'),contextFingerprint:createHash('sha256').update(canonical(raw)).digest('hex'),attachment,budget:{utf8Bytes:attachment.utf8Bytes,inputTokens:counted.inputTokens,model:counted.model,counterId:counted.counterId,durationMs:counted.durationMs}};
  if (utf8Bytes(payload)>MEMORY_CONTEXT_BYTES) throw new TransitionValidationError('Transition memory artifact exceeds its byte budget.', 'artifact_budget_exceeded');
  await rpc(client,'world_quest_transition_checkpoint',{p_transition_id:claim.transitionId,p_fence:claim.fence,p_stage:'memory_context',p_payload:payload});
  return payload;
}
function dossierMeasurements(dossier: QuestTransitionMemoryDossier, reuse: 'fresh' | 'replayed'): { selectedRecordCount: number; sourceRecordCount: number; utf8Bytes: number; coverageGapCount: number; reuse: 'fresh' | 'replayed' } {
  return {
    selectedRecordCount: dossier.coverage.dialogueEvidence,
    sourceRecordCount: dossier.coverage.eventHistory + dossier.coverage.dialogueEvidence + dossier.coverage.beliefs + dossier.coverage.socialEdges,
    utf8Bytes: dossier.bytes.dossier,
    coverageGapCount: dossier.coverage.terminalEvent ? 0 : 1,
    reuse
  };
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
  let failureStage: AiFailureDiagnostic['stage'] = 'memory_context';
  try {
    // Capture before any model work. Reclaims replay memory_context exactly and
    // therefore never touch retrieval, profile lookup, or embedding again.
    if (!await guard.beat()) return {status:'lease_lost'};
    const captured=await captureMemoryContext(client,claim,runtime,provider,controller.signal);
    if (captured===null) throw new TransitionValidationError('Transition memory context is malformed.');
    const dossier = memoryDossier(claim,Object.keys(captured).length ? captured : undefined);
    const freshMemoryContext = dossierMeasurements(dossier, checkpoint(claim,'memory_context') ? 'replayed' : 'fresh');
    const replayedMemoryContext = dossierMeasurements(dossier, 'replayed');
    const registry = runtime.promptRegistry;
    failureStage = 'prompt_registry';
    if (!registry) throw new Error('Prompt registry is required for quest transition execution');
    const release = await registry.resolveForWork('quest_transition', claim.transitionId);
    const generate = async (stage: QuestTransitionProviderStage, payload: unknown): Promise<ProviderResult> => {
      failureStage = stage;
      const prompt = releaseTextPrompt(release, SETTLEMENT_PROMPT_KEY[stage]);
      if (calls >= SETTLEMENT_PROVIDER_CALL_BUDGETS.quest_transition.maximum) throw new SettlementProviderError('provider_failed', 'Quest transition model-call budget exhausted.');
      if (!guard.canCall() || !await guard.beat()) throw new SettlementProviderError('provider_timeout', 'Quest transition lease was lost.');
      calls += 1;
      await registry.recordSafeRun({ executionId: correlationId, attempt: claim.attempt, workflow: 'quest_transition', nodeKey: stage, prompt, status: 'started' }).catch(() => undefined);
      await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage, status: 'started', attempt: claim.attempt, memoryContext: freshMemoryContext });
      try {
        const result = await provider.generate(stage, payload, controller.signal, prompt);
        await registry.recordSafeRun({ executionId: correlationId, attempt: claim.attempt, workflow: 'quest_transition', nodeKey: stage, prompt, status: 'completed', model: result.model, durationMs: result.durationMs, inputTokens: result.usage.input, outputTokens: result.usage.output }).catch(() => undefined);
        await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage, status: 'completed', attempt: claim.attempt, durationMs: result.durationMs, model: result.model, tokenUsage: result.usage, memoryContext: freshMemoryContext });
        return result;
      } catch (cause) {
        await registry.recordSafeRun({ executionId: correlationId, attempt: claim.attempt, workflow: 'quest_transition', nodeKey: stage, prompt, status: 'failed', errorCode: errorCode(cause) }).catch(() => undefined);
        await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage, status: 'failed', attempt: claim.attempt, errorCode: controller.signal.aborted ? 'provider_timeout' : errorCode(cause), memoryContext: freshMemoryContext });
        throw cause;
      }
    };
    if (!await guard.beat()) return { status: 'lease_lost', errorCode: 'lease_unavailable' };
    // Constructed once per claim. Checkpoints preserve model outputs, while this
    // deterministic artifact guarantees that stages resumed after a lease loss
    // still see exactly the terminal-bound evidence they were originally given.
    const payloadBase = { context, frozenContext: claim.frozenContext, memoryDossier: dossier };
    let proposal = checkpoint(claim, 'proposer')?.proposal;
    if (!proposal) {
      const result = await generate('quest_transition_proposer', payloadBase);
      proposal = result.value;
      await rpc(client, 'world_quest_transition_checkpoint', { p_transition_id: claim.transitionId, p_fence: claim.fence, p_stage: 'proposer', p_payload: { proposal } });
    } else {
      await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_proposer', status: 'reused', attempt: claim.attempt, memoryContext: replayedMemoryContext });
    }
    const parsedProposal = parseQuestTransitionProposal(proposal, context);
    if (!parsedProposal.ok) throw new TransitionValidationError('Quest transition proposal does not validate.');
    proposal = parsedProposal.value;
    let critic = checkpoint(claim, 'critic')?.decision;
    if (!critic) {
      const result = await generate('quest_transition_critic', { ...payloadBase, proposal }); critic = result.value;
      await rpc(client, 'world_quest_transition_checkpoint', { p_transition_id: claim.transitionId, p_fence: claim.fence, p_stage: 'critic', p_payload: { decision: critic } });
    } else await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_critic', status: 'reused', attempt: claim.attempt, memoryContext: replayedMemoryContext });
    let decision = parseQuestTransitionCriticDecision(critic);
    if (!decision || decision.decision === 'reject') throw new TransitionValidationError('Quest transition was rejected.');
    if (decision.decision === 'repair') {
      let repaired = checkpoint(claim, 'repair')?.proposal;
      if (!repaired) {
        const result = await generate('quest_transition_repair', { ...payloadBase, proposal, instructions: decision.instructions }); repaired = result.value;
        await rpc(client, 'world_quest_transition_checkpoint', { p_transition_id: claim.transitionId, p_fence: claim.fence, p_stage: 'repair', p_payload: { proposal: repaired } });
      } else await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_repair', status: 'reused', attempt: claim.attempt, memoryContext: replayedMemoryContext });
      const parsedRepair = parseQuestTransitionProposal(repaired, context);
      if (!parsedRepair.ok) throw new TransitionValidationError('Repaired quest transition does not validate.');
      proposal = parsedRepair.value;
      let final = checkpoint(claim, 'final_critic')?.decision;
      if (!final) {
        const result = await generate('quest_transition_final_critic', { ...payloadBase, proposal }); final = result.value;
        await rpc(client, 'world_quest_transition_checkpoint', { p_transition_id: claim.transitionId, p_fence: claim.fence, p_stage: 'final_critic', p_payload: { decision: final } });
      } else await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_final_critic', status: 'reused', attempt: claim.attempt, memoryContext: replayedMemoryContext });
      decision = parseQuestTransitionCriticDecision(final);
      if (!decision || decision.decision !== 'accept') throw new TransitionValidationError('Repaired quest transition was rejected.');
    }
    failureStage = 'quest_transition_validate';
    await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_validate', status: 'started', attempt: claim.attempt });
    if (validateQuestTransitionProposal(proposal, context).length > 0) {
      await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_validate', status: 'failed', attempt: claim.attempt, errorCode: 'validation_rejected' });
      throw new TransitionValidationError('Validated quest transition is invalid.');
    }
    await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_validate', status: 'completed', attempt: claim.attempt });
    if (!guard.canCall()) return { status: 'lease_lost', errorCode: 'lease_lost' };
    failureStage = 'quest_transition_commit';
    await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_commit', status: 'started', attempt: claim.attempt });
    const result = await rpc(client, 'world_quest_transition_commit', { p_transition_id: claim.transitionId, p_fence: claim.fence, p_proposal: proposal });
    const kind = committed(result, claim);
    await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_commit', status: kind ? 'completed' : 'failed', attempt: claim.attempt, errorCode: kind ? undefined : 'commit_unknown' });
    if (kind) invalidateProjectionInstance(claim.instanceId);
    return kind ? { status: 'completed', kind } : { status: 'failed', errorCode: 'commit_unknown' };
  } catch (cause) {
    if (guard.lost || isLeaseError(cause)) return { status: 'lease_lost', errorCode: errorCode(cause) };
    const failure = timedOut ? 'provider_timeout' : errorCode(cause);
    await emitAiObservability(observability, { correlationId, workflow: 'world_settlement', stage: 'quest_transition_fallback', status: 'started', attempt: claim.attempt, errorCode: failure, failureDiagnostic: failureDiagnostic(cause, failureStage) });
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
