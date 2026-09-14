import {
  SALIENCE_BANDS, WORLD_ENTITY_KINDS, primitiveRegistry,
  validatePersonalityProfile, validatePersonalitySchema,
  type BeliefOperation, type CapabilityEnvelope, type EvolutionEvidenceKind, type PersonalityProfile, type PersonalitySchema, type SalienceBand, type WorldEntityKind, type WorldValidationSnapshot
} from '$lib/game/evolving-world';

export const SETTLEMENT_PROMPT_VERSION = 'world-settlement-v1' as const;
export const SETTLEMENT_STAGES = ['proposer', 'critic', 'repair', 'final_critic', 'digest', 'validated'] as const;
export type SettlementStage = (typeof SETTLEMENT_STAGES)[number];
export type ProviderStage = Exclude<SettlementStage, 'validated'>;
export type SettlementJobKind = 'snapshot' | 'canon' | 'resident' | 'quest' | 'effects' | 'news' | 'finalize';

export type ProviderUsage = { input: number; output: number };
export type ProviderResult = { value: unknown; model: string; usage: ProviderUsage; durationMs: number; promptVersion: string };
export interface SettlementProvider { generate(stage: ProviderStage, payload: unknown, signal: AbortSignal): Promise<ProviderResult>; }

export class SettlementProviderError extends Error {
  constructor(public readonly code: 'provider_unavailable' | 'provider_timeout' | 'provider_malformed' | 'provider_failed', message: string) {
    super(message); this.name = 'SettlementProviderError';
  }
}

export type SettlementCheckpoint = { stage: SettlementStage; payload: Record<string, unknown>; usage: Record<string, unknown>; model: string; promptVersion: string; sourceFence: string };
export type SettlementClaim = {
  settlementId: string; jobId: string; fence: string; kind: SettlementJobKind; ordinal: number; attempt: number;
  subjectInstanceId: string | null;
  leaseUntil: string; leaseUntilMs: number;
  inputFingerprint: string; inputVersion: string; inputSnapshot: Record<string, unknown>;
  jobInputVersion: string; jobInputSnapshot: Record<string, unknown>; checkpoints: SettlementCheckpoint[];
};
export type IdleClaim = { status: 'idle' | 'terminal' };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const jobKinds = new Set<SettlementJobKind>(['snapshot', 'canon', 'resident', 'quest', 'effects', 'news', 'finalize']);
const stages = new Set<string>(SETTLEMENT_STAGES);
const terminalStatuses = new Set(['completed', 'failed', 'skipped', 'expired']);
const fingerprint = /^[0-9a-f]{64}$/i;
export function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function string(value: unknown, max = 16_384): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function byteSize(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function futureIso(value: unknown): { text: string; ms: number } | null {
  if (!string(value, 64)) return null; const ms = Date.parse(value); return Number.isFinite(ms) && ms > Date.now() ? { text:value, ms } : null;
}

/** Reject untrusted RPC JSON before any provider call or completion side effect. */
export function parseSettlementClaim(value: unknown): SettlementClaim | IdleClaim {
  if (!object(value)) throw new SettlementProviderError('provider_malformed', 'Settlement claim was not an object.');
  if (value.status === 'idle' && Object.keys(value).length === 1) return { status: 'idle' };
  if (typeof value.status === 'string' && terminalStatuses.has(value.status) && !('jobId' in value)) return { status: 'terminal' };
  const lease = futureIso(value.leaseUntil);
  const ordinal = value.ordinal; const attempt = value.attempt;
  const subjectInstanceId = value.subjectInstanceId;
  if (!uuid.test(String(value.settlementId)) || !uuid.test(String(value.jobId)) || !uuid.test(String(value.fence))
    || !jobKinds.has(value.kind as SettlementJobKind) || !Number.isInteger(ordinal) || (ordinal as number) < 1 || (ordinal as number) > 64 || !Number.isInteger(attempt) || (attempt as number) < 1 || (attempt as number) > 3
    || (subjectInstanceId !== undefined && subjectInstanceId !== null && !uuid.test(String(subjectInstanceId)))
    || !fingerprint.test(String(value.inputFingerprint)) || !string(value.inputVersion, 80) || !object(value.inputSnapshot) || byteSize(value.inputSnapshot) > 32_768
    || !string(value.jobInputVersion, 80) || !object(value.jobInputSnapshot) || byteSize(value.jobInputSnapshot) > 16_384 || !lease || !Array.isArray(value.checkpoints) || value.checkpoints.length > 6) {
    throw new SettlementProviderError('provider_malformed', 'Settlement claim was incomplete or invalid.');
  }
  const checkpoints: SettlementCheckpoint[] = [];
  const seenStages = new Set<string>();
  for (const checkpoint of value.checkpoints) {
    if (!object(checkpoint) || !stages.has(String(checkpoint.stage)) || seenStages.has(String(checkpoint.stage)) || !object(checkpoint.payload) || byteSize(checkpoint.payload) > 16_384 || !object(checkpoint.usage) || byteSize(checkpoint.usage) > 4_096
      || !string(checkpoint.model, 160) || !string(checkpoint.promptVersion, 160) || !uuid.test(String(checkpoint.sourceFence))) {
      throw new SettlementProviderError('provider_malformed', 'Settlement checkpoints were malformed or duplicated.');
    }
    seenStages.add(String(checkpoint.stage));
    checkpoints.push({ stage: checkpoint.stage as SettlementStage, payload: checkpoint.payload, usage: checkpoint.usage, model: checkpoint.model as string, promptVersion: checkpoint.promptVersion as string, sourceFence: checkpoint.sourceFence as string });
  }
  return {
    settlementId: value.settlementId as string, jobId: value.jobId as string, fence: value.fence as string, kind: value.kind as SettlementJobKind, subjectInstanceId: subjectInstanceId === undefined ? null : subjectInstanceId as string | null, leaseUntil:lease.text, leaseUntilMs:lease.ms,
    ordinal: value.ordinal as number, attempt: value.attempt as number, inputFingerprint: value.inputFingerprint as string, inputVersion: value.inputVersion as string,
    inputSnapshot: value.inputSnapshot, jobInputVersion: value.jobInputVersion as string, jobInputSnapshot: value.jobInputSnapshot, checkpoints
  };
}

export type AuthorizedEvidence = { id: string; kind: EvolutionEvidenceKind; happenedOnDay: number; sequence: number; sourceFingerprint: string; salience: SalienceBand; summary: string };
export type FrozenEvolutionContext = {
  residentId: string;
  npcId: string;
  profileRevision: number;
  schema: PersonalitySchema;
  profile: PersonalityProfile;
  capability: CapabilityEnvelope;
  worldSnapshot: WorldValidationSnapshot;
  pressureByDimension: Record<string, number>;
  authorizedEvidence: AuthorizedEvidence[];
};
const evolutionKeys = new Set(['authorizedEvidence', 'capability', 'npcId', 'pressureByDimension', 'profile', 'profileRevision', 'residentId', 'schema', 'worldSnapshot']);
const capabilityKeys = new Set(['version', 'allowedActions', 'allowedApproaches', 'allowedWorldEffects', 'allowedTargetKinds', 'socialCapabilities', 'irreversibleEffects']);
const worldSnapshotKeys = new Set(['currentDay', 'entityKinds', 'activeQuestIds', 'authorizedIrreversibleEffects']);
const irreversibleEffectKeys = new Set(['effectKey', 'targetEntityId', 'criticApproved', 'visibleSinceDay']);
const entityRef = /^(?:[a-z][a-z0-9_-]{1,127}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
function exactObjectKeys(value: Record<string, unknown>, keys: Set<string>): boolean { return Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key)); }
function stringList(value: unknown, limit: number): value is string[] { return Array.isArray(value) && value.length <= limit && value.every((entry) => string(entry, 128)) && new Set(value).size === value.length; }
function schemaAndProfileAreValid(schema: Record<string, unknown>, profile: Record<string, unknown>): boolean {
  if (!exactObjectKeys(schema, new Set(['version', 'dimensions', 'collections'])) || !Array.isArray(schema.dimensions) || !Array.isArray(schema.collections)
    || !exactObjectKeys(profile, new Set(['dimensions', 'entries'])) || !object(profile.dimensions) || !Array.isArray(profile.entries)) return false;
  if (!schema.dimensions.every(object) || !schema.collections.every(object) || !profile.entries.every(object)) return false;
  const typedSchema = schema as unknown as PersonalitySchema;
  const typedProfile = profile as unknown as PersonalityProfile;
  return validatePersonalitySchema(typedSchema).length === 0 && validatePersonalityProfile(typedProfile, typedSchema).length === 0;
}
function capabilityIsValid(value: Record<string, unknown>): boolean {
  if (!exactObjectKeys(value, capabilityKeys) || !string(value.version, 128)
    || !stringList(value.allowedActions, 16) || !stringList(value.allowedApproaches, 16) || !stringList(value.allowedWorldEffects, 16)
    || !stringList(value.allowedTargetKinds, 16) || !stringList(value.socialCapabilities, 16) || !Array.isArray(value.irreversibleEffects) || value.irreversibleEffects.length > 16) return false;
  if (!value.allowedActions.every((entry) => primitiveRegistry.quest.actions.includes(entry))
    || !value.allowedApproaches.every((entry) => primitiveRegistry.quest.approaches.includes(entry))
    || !value.allowedWorldEffects.every((entry) => primitiveRegistry.worldEffects.some((effect) => effect.kind === entry))
    || !value.allowedTargetKinds.every((entry) => WORLD_ENTITY_KINDS.includes(entry as WorldEntityKind))
    || !value.socialCapabilities.every((entry) => primitiveRegistry.socialCapabilities.some((capability) => capability.key === entry))) return false;
  return value.irreversibleEffects.every((raw) => {
    if (!object(raw) || !exactObjectKeys(raw, new Set(['effectKey', 'targetKinds'])) || !string(raw.effectKey, 128) || !stringList(raw.targetKinds, 16)) return false;
    const effect = primitiveRegistry.worldEffects.find((candidate) => candidate.kind === raw.effectKey);
    return !!effect && effect.irreversible && raw.targetKinds.every((kind) => effect.targetKinds.includes(kind as WorldEntityKind));
  });
}
function worldSnapshotIsValid(value: Record<string, unknown>): boolean {
  if (!exactObjectKeys(value, worldSnapshotKeys) || !Number.isSafeInteger(value.currentDay) || (value.currentDay as number) < 1 || (value.currentDay as number) > 1_000_000
    || !object(value.entityKinds) || Object.keys(value.entityKinds).length > 256 || !stringList(value.activeQuestIds, 64)
    || !Array.isArray(value.authorizedIrreversibleEffects) || value.authorizedIrreversibleEffects.length > 64) return false;
  if (!Object.entries(value.entityKinds).every(([id, kind]) => entityRef.test(id) && WORLD_ENTITY_KINDS.includes(kind as WorldEntityKind))) return false;
  const entityKinds = value.entityKinds as Record<string, unknown>;
  return value.activeQuestIds.every((id) => entityRef.test(id)) && value.authorizedIrreversibleEffects.every((raw) => {
    if (!object(raw) || !exactObjectKeys(raw, irreversibleEffectKeys) || !string(raw.effectKey, 128) || !entityRef.test(String(raw.targetEntityId))
      || typeof raw.criticApproved !== 'boolean' || !Number.isSafeInteger(raw.visibleSinceDay) || (raw.visibleSinceDay as number) < 1 || (raw.visibleSinceDay as number) > (value.currentDay as number)) return false;
    const effect = primitiveRegistry.worldEffects.find((candidate) => candidate.kind === raw.effectKey);
    return !!effect && effect.irreversible && effect.targetKinds.includes(entityKinds[raw.targetEntityId as string] as WorldEntityKind);
  });
}
/** The settlement input is a frozen database snapshot. This deliberately accepts only the explicitly versioned evolution envelope. */
export function frozenEvolutionContext(snapshot: Record<string, unknown>): FrozenEvolutionContext | null {
  const candidate = object(snapshot.evolution) ? snapshot.evolution : snapshot;
  if (!exactObjectKeys(candidate, evolutionKeys)
    || !uuid.test(String(candidate.residentId)) || !uuid.test(String(candidate.npcId)) || !Number.isSafeInteger(candidate.profileRevision) || (candidate.profileRevision as number) < 1
    || !object(candidate.schema) || !object(candidate.profile) || !object(candidate.capability) || !object(candidate.worldSnapshot)
    || !object(candidate.pressureByDimension) || !Array.isArray(candidate.authorizedEvidence) || candidate.authorizedEvidence.length < 1 || candidate.authorizedEvidence.length > 64) return null;
  const schema = candidate.schema as Record<string, unknown>;
  const profile = candidate.profile as Record<string, unknown>;
  const capability = candidate.capability as Record<string, unknown>;
  const worldSnapshot = candidate.worldSnapshot as Record<string, unknown>;
  const pressureByDimension = candidate.pressureByDimension as Record<string, unknown>;
  if (!schemaAndProfileAreValid(schema, profile) || !capabilityIsValid(capability) || !worldSnapshotIsValid(worldSnapshot)
    || !Object.values(pressureByDimension).every((value) => Number.isSafeInteger(value) && Math.abs(value as number) <= 1_000_000)
    || Object.keys(pressureByDimension).length !== (schema.dimensions as unknown[]).length
    || !Object.keys(pressureByDimension).every((key) => (schema.dimensions as Array<Record<string, unknown>>).some((dimension) => dimension.key === key))) return null;
  const authorizedEvidence: AuthorizedEvidence[] = [];
  for (const raw of candidate.authorizedEvidence) {
    if (!object(raw) || !Object.keys(raw).every((key) => ['id','kind','happenedOnDay','sequence','sourceFingerprint','salience','summary'].includes(key))
      || !string(raw.id,128) || !['dialogue','quest_outcome','world_event','hospitality_reaction','social_encounter','gossip'].includes(String(raw.kind))
      || !Number.isInteger(raw.happenedOnDay) || (raw.happenedOnDay as number) < 0 || !Number.isInteger(raw.sequence) || (raw.sequence as number) < 0
      || !fingerprint.test(String(raw.sourceFingerprint)) || !SALIENCE_BANDS.includes(raw.salience as SalienceBand) || !string(raw.summary,1_000)) return null;
    authorizedEvidence.push({ id:raw.id as string,kind:raw.kind as EvolutionEvidenceKind,happenedOnDay:raw.happenedOnDay as number,sequence:raw.sequence as number,sourceFingerprint:raw.sourceFingerprint as string,salience:raw.salience as SalienceBand,summary:raw.summary as string });
  }
  if (new Set(authorizedEvidence.map((entry)=>entry.id)).size !== authorizedEvidence.length) return null;
  return {
    residentId: candidate.residentId as string,
    npcId: candidate.npcId as string,
    profileRevision: candidate.profileRevision as number,
    schema: schema as unknown as PersonalitySchema,
    profile: profile as unknown as PersonalityProfile,
    capability: capability as unknown as CapabilityEnvelope,
    worldSnapshot: worldSnapshot as unknown as WorldValidationSnapshot,
    pressureByDimension: pressureByDimension as Record<string, number>,
    authorizedEvidence
  };
}

export type CriticOutput = { outcome: 'accept' | 'reject' | 'repair'; rationale: string; instructions: string[] };
export function parseCriticOutput(value: unknown): CriticOutput | null {
  if (!object(value) || !['accept', 'reject', 'repair'].includes(String(value.outcome)) || !string(value.rationale, 1_000) || !('instructions' in value)) return null;
  if (!Object.keys(value).every((key) => ['outcome', 'rationale', 'instructions'].includes(key))) return null;
  if (!Array.isArray(value.instructions) || value.instructions.length > 8 || !value.instructions.every((item) => string(item, 500)) || (value.outcome === 'repair' && value.instructions.length === 0)) return null;
  return { outcome: value.outcome as CriticOutput['outcome'], rationale: value.rationale as string, instructions: value.instructions as string[] };
}

export function proposalEvidenceIsAuthorized(evidenceIds: readonly string[], context: FrozenEvolutionContext): boolean {
  return evidenceIds.length > 0 && evidenceIds.every((id) => context.authorizedEvidence.some((entry) => entry.id === id));
}

/** Belief sources must point at this frozen evidence set; attributed knowledge cannot mint canon. */
export function proposalBeliefsAreAttributed(operations: readonly BeliefOperation[], context: FrozenEvolutionContext): boolean {
  const evidenceById = new Map(context.authorizedEvidence.map((entry) => [entry.id, entry]));
  return operations.every((operation) => {
    if (operation.operation === 'retract') {
      return context.authorizedEvidence.some((entry) => entry.sourceFingerprint === operation.sourceFingerprint);
    }
    const citedEvidence = operation.provenance.map((link) => evidenceById.get(link.sourceId));
    return citedEvidence.every(Boolean) && citedEvidence.some((entry) => entry?.sourceFingerprint === operation.originalClaimFingerprint);
  });
}

export type PublicDigest = { summary: string; journalEntries: string[]; discoveredEntityIds: string[] };
export function parsePublicDigest(value: unknown): PublicDigest | null {
  if (!object(value) || !string(value.summary, 500) || !Array.isArray(value.journalEntries) || !Array.isArray(value.discoveredEntityIds)
    || !value.journalEntries.every((entry) => string(entry, 280)) || !value.discoveredEntityIds.every((id) => string(id, 128))
    || value.journalEntries.length > 5 || value.discoveredEntityIds.length > 12
    || !Object.keys(value).every((key) => ['summary', 'journalEntries', 'discoveredEntityIds'].includes(key))) return null;
  return { summary: value.summary.trim(), journalEntries: value.journalEntries.map((entry) => entry.trim()), discoveredEntityIds: value.discoveredEntityIds };
}
