import { primitiveRegistry } from './registry';
import {
  SALIENCE_BANDS,
  SOCIAL_AXES,
  WORLD_ENTITY_KINDS,
  type BeliefProvenanceLink,
  type CapabilityEnvelope,
  type DirectedSocialEdge,
  type EvolutionEvidenceKind,
  type NpcBelief,
  type PersonalityProfile,
  type SocialAxis,
  type SocialCapability,
  type WorldEntityKind
} from './contracts';

export const SOCIAL_ENCOUNTER_VERSION = 'social-encounter-v1' as const;
export const SOCIAL_ENCOUNTER_INTENT_MODES = ['honest', 'withhold', 'misdirect', 'fabricate'] as const;
export type SocialEncounterIntentMode = (typeof SOCIAL_ENCOUNTER_INTENT_MODES)[number];

export const SOCIAL_ENCOUNTER_CRITIC_PATHS = [
  'privateCommunicativeIntents', 'privateExchangeSummary', 'evidenceIds', 'causalExplanation',
  'relationshipEffects', 'gossipBeliefAdditions', 'publicSummary'
] as const;
export type SocialEncounterCriticPath = (typeof SOCIAL_ENCOUNTER_CRITIC_PATHS)[number];
export const SOCIAL_ENCOUNTER_CRITIC_CODES = [
  'intent_capability', 'private_summary', 'evidence_grounding', 'causal_grounding',
  'relationship_direction', 'gossip_attribution', 'public_projection'
] as const;
export type SocialEncounterCriticCode = (typeof SOCIAL_ENCOUNTER_CRITIC_CODES)[number];
export type SocialEncounterCriticInstruction = { code: SocialEncounterCriticCode; path: SocialEncounterCriticPath };
export type SocialEncounterCriticDecision =
  | { decision: 'accept' | 'reject'; instructions: [] }
  | { decision: 'repair'; instructions: SocialEncounterCriticInstruction[] };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fingerprint = /^[0-9a-f]{64}$/i;
const forbiddenKey = /(?:^|_)(?:sql|query|route|url|endpoint|code|function|handler|script|executable)(?:$|_)/i;
const forbiddenObjectKeys = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_BYTES = 12_000;
const MAX_DEPTH = 6;
const MAX_NODES = 256;

export type SocialEncounterEvidence = {
  id: string;
  kind: EvolutionEvidenceKind;
  sourceFingerprint: string;
  summary: string;
};

export type FrozenSocialEncounterResident = {
  residentId: string;
  npcId: string;
  profileRevision: number;
  profile: PersonalityProfile;
  beliefs: NpcBelief[];
  edges: DirectedSocialEdge[];
  capability: CapabilityEnvelope;
};

/** Public canon is intentionally distinct from private resident cognition. */
export type FrozenSocialEncounterContext = {
  version: typeof SOCIAL_ENCOUNTER_VERSION;
  templateKey: string;
  participantResidentIds: [string, string];
  publicCanon: {
    currentDay: number;
    entityKinds: Record<string, WorldEntityKind>;
  };
  /** Frozen attributable sources, deliberately separate from established public canon. */
  authorizedEvidence: SocialEncounterEvidence[];
  participants: [FrozenSocialEncounterResident, FrozenSocialEncounterResident];
};

export type PrivateCommunicativeIntent = {
  speakerResidentId: string;
  recipientResidentId: string;
  mode: SocialEncounterIntentMode;
  message: string;
};

export type RecipientRelationshipEffect = {
  recipientResidentId: string;
  sourceResidentId: string;
  axis: SocialAxis;
  delta: number;
};

export type GossipBeliefAddition = {
  recipientResidentId: string;
  sourceResidentId: string;
  sourceBeliefId: string;
  sourceEvidenceId: string;
  originalClaimFingerprint: string;
  content: string;
  confidence: number;
  provenance: BeliefProvenanceLink[];
};

/**
 * The private fields are server-only input to later stages. They never become
 * part of the public encounter projection or establish world canon.
 */
export type SocialEncounterProposal = {
  version: typeof SOCIAL_ENCOUNTER_VERSION;
  templateKey: string;
  participantResidentIds: [string, string];
  privateCommunicativeIntents: PrivateCommunicativeIntent[];
  /** A compact server-only abstract of the exchange, distinct from intent and public news. */
  privateExchangeSummary: string;
  evidenceIds: string[];
  causalExplanation: string;
  relationshipEffects: RecipientRelationshipEffect[];
  gossipBeliefAdditions: GossipBeliefAddition[];
  /** Null means the encounter remains private and creates no player-visible news. */
  publicSummary: string | null;
};

export type PublicSocialEncounterSummary = {
  version: typeof SOCIAL_ENCOUNTER_VERSION;
  templateKey: string;
  participantResidentIds: [string, string];
  publicSummary: string;
};

export type SocialEncounterParseResult =
  | { ok: true; value: SocialEncounterProposal }
  | { ok: false; issues: SocialEncounterContractIssue[] };
export type PublicSocialEncounterParseResult =
  | { ok: true; value: PublicSocialEncounterSummary }
  | { ok: false; issues: SocialEncounterContractIssue[] };
export type SocialEncounterContractIssue = { path: string; code: string; message: string };

/** A critic can name only repairable proposal fields and finite error codes. */
export function parseSocialEncounterCriticDecision(value: unknown): SocialEncounterCriticDecision | null {
  if (!object(value) || !exact(value, ['decision', 'instructions']) || !['accept', 'reject', 'repair'].includes(String(value.decision)) || !Array.isArray(value.instructions)) return null;
  const instructions=value.instructions;
  if ((value.decision === 'accept' || value.decision === 'reject') && instructions.length !== 0) return null;
  if (value.decision === 'repair' && (instructions.length < 1 || instructions.length > 4)) return null;
  const parsed: SocialEncounterCriticInstruction[]=[];
  for (const instruction of instructions) {
    if (!object(instruction) || !exact(instruction, ['code', 'path'])
      || !SOCIAL_ENCOUNTER_CRITIC_CODES.includes(instruction.code as SocialEncounterCriticCode)
      || !SOCIAL_ENCOUNTER_CRITIC_PATHS.includes(instruction.path as SocialEncounterCriticPath)) return null;
    parsed.push({ code:instruction.code as SocialEncounterCriticCode, path:instruction.path as SocialEncounterCriticPath });
  }
  if (new Set(parsed.map((instruction) => `${instruction.code}:${instruction.path}`)).size !== parsed.length) return null;
  return value.decision === 'repair' ? { decision:'repair', instructions:parsed } : { decision:value.decision as 'accept' | 'reject', instructions:[] };
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function text(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum;
}
function integerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
function issue(path: string, code: string, message: string): SocialEncounterContractIssue[] {
  return [{ path, code, message }];
}
function byteSize(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  catch { return Number.POSITIVE_INFINITY; }
}
function safeJson(value: unknown, depth = 0, tally = { nodes: 0 }): boolean {
  if (depth > MAX_DEPTH || ++tally.nodes > MAX_NODES) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 2_000;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 64 && value.every((entry) => safeJson(entry, depth + 1, tally));
  if (!object(value)) return false;
  return Object.entries(value).every(([key, entry]) => key.length <= 80 && !forbiddenObjectKeys.has(key) && !forbiddenKey.test(key) && safeJson(entry, depth + 1, tally));
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
}
function residentIds(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && value.every((id) => typeof id === 'string' && uuid.test(id)) && value[0] !== value[1];
}
function entityKinds(value: unknown): value is Record<string, WorldEntityKind> {
  return object(value) && Object.keys(value).length <= 128 && Object.entries(value).every(([id, kind]) => id.length > 0 && id.length <= 128 && WORLD_ENTITY_KINDS.includes(kind as WorldEntityKind));
}
function isCapability(value: unknown): value is CapabilityEnvelope {
  if (!object(value) || !exact(value, ['version', 'allowedActions', 'allowedApproaches', 'allowedWorldEffects', 'allowedTargetKinds', 'socialCapabilities', 'irreversibleEffects'])) return false;
  return text(value.version, 128) && Array.isArray(value.allowedActions) && Array.isArray(value.allowedApproaches)
    && Array.isArray(value.allowedWorldEffects) && Array.isArray(value.allowedTargetKinds) && Array.isArray(value.socialCapabilities)
    && Array.isArray(value.irreversibleEffects) && value.socialCapabilities.length <= 16
    && value.socialCapabilities.every((capability) => primitiveRegistry.socialCapabilities.some((registered) => registered.key === capability));
}
function isProvenanceLink(value: unknown): value is BeliefProvenanceLink {
  return object(value) && exact(value, Object.prototype.hasOwnProperty.call(value, 'speakerNpcId') ? ['sourceKind','sourceId','speakerNpcId'] : ['sourceKind','sourceId'])
    && ['direct_evidence','dialogue_claim','gossip','inference'].includes(String(value.sourceKind)) && text(value.sourceId, 128)
    && (value.speakerNpcId === undefined || text(value.speakerNpcId, 128));
}
function isBelief(value: unknown): value is NpcBelief {
  if (!object(value) || !exact(value, ['id', 'subjectEntityId', 'content', 'confidence', 'provenance', 'originalClaimFingerprint', 'contradictionStatus', 'state'])) return false;
  const confidence=value.confidence;
  return typeof value.id === 'string' && uuid.test(value.id) && text(value.subjectEntityId, 128) && text(value.content, 1_000)
    && integerBetween(confidence, 0, 100) && Array.isArray(value.provenance) && value.provenance.length <= 8 && value.provenance.every(isProvenanceLink)
    && fingerprint.test(String(value.originalClaimFingerprint)) && ['uncontested', 'contested', 'contradicted'].includes(String(value.contradictionStatus))
    && ['active', 'retracted'].includes(String(value.state));
}
function isEdge(value: unknown): value is DirectedSocialEdge {
  if (!object(value) || !exact(value, ['subjectNpcId', 'objectEntityId', 'axes']) || !object(value.axes)) return false;
  const axes=value.axes;
  return text(value.subjectNpcId, 128) && text(value.objectEntityId, 128) && Object.keys(axes).length === SOCIAL_AXES.length
    && SOCIAL_AXES.every((axis) => Number.isInteger(axes[axis]) && Math.abs(axes[axis] as number) <= 100);
}
function isProfile(value: unknown): value is PersonalityProfile {
  return object(value) && exact(value, ['dimensions', 'entries']) && object(value.dimensions) && Array.isArray(value.entries)
    && Object.keys(value.dimensions).length <= 16 && value.entries.length <= 64;
}
function isResident(value: unknown): value is FrozenSocialEncounterResident {
  if (!object(value) || !exact(value, ['residentId', 'npcId', 'profileRevision', 'profile', 'beliefs', 'edges', 'capability'])) return false;
  const profileRevision=value.profileRevision;
  return typeof value.residentId === 'string' && uuid.test(value.residentId) && typeof value.npcId === 'string' && uuid.test(value.npcId)
    && integerBetween(profileRevision, 1, 1_000_000) && isProfile(value.profile)
    && Array.isArray(value.beliefs) && value.beliefs.length <= 64 && value.beliefs.every(isBelief)
    && Array.isArray(value.edges) && value.edges.length <= 64 && value.edges.every(isEdge) && isCapability(value.capability);
}

/** Strictly parse the frozen server snapshot before any model is allowed to use it. */
export function parseFrozenSocialEncounterContext(value: unknown): FrozenSocialEncounterContext | null {
  if (!object(value)) return null;
  const publicCanon=object(value.publicCanon) ? value.publicCanon : null;
  const currentDay=publicCanon?.currentDay;
  if (!exact(value, ['version', 'templateKey', 'participantResidentIds', 'publicCanon', 'authorizedEvidence', 'participants'])
    || value.version !== SOCIAL_ENCOUNTER_VERSION || !text(value.templateKey, 80) || !primitiveRegistry.encounterTemplates.includes(value.templateKey)
    || !residentIds(value.participantResidentIds) || !publicCanon || !exact(publicCanon, ['currentDay', 'entityKinds'])
    || !integerBetween(currentDay, 1, 1_000_000)
    || !entityKinds(publicCanon.entityKinds) || !Array.isArray(value.authorizedEvidence) || value.authorizedEvidence.length < 1 || value.authorizedEvidence.length > 64
    || !value.authorizedEvidence.every((entry) => object(entry) && exact(entry, ['id', 'kind', 'sourceFingerprint', 'summary'])
      && text(entry.id, 128) && ['dialogue','quest_outcome','world_event','hospitality_reaction','social_encounter','gossip'].includes(String(entry.kind))
      && fingerprint.test(String(entry.sourceFingerprint)) && text(entry.summary, 1_000))
    || new Set(value.authorizedEvidence.map((entry) => (entry as Record<string, unknown>).id)).size !== value.authorizedEvidence.length
    || !Array.isArray(value.participants) || value.participants.length !== 2 || !value.participants.every(isResident)) return null;
  const participants=value.participants as [FrozenSocialEncounterResident, FrozenSocialEncounterResident];
  if (participants[0].residentId !== value.participantResidentIds[0] || participants[1].residentId !== value.participantResidentIds[1]
    || participants[0].residentId === participants[1].residentId || participants[0].npcId === participants[1].npcId) return null;
  return {
    version: SOCIAL_ENCOUNTER_VERSION, templateKey: value.templateKey.trim(), participantResidentIds: [...value.participantResidentIds] as [string, string],
    publicCanon: {
      currentDay:currentDay, entityKinds:{...publicCanon.entityKinds as Record<string, WorldEntityKind>}
    },
    authorizedEvidence:(value.authorizedEvidence as SocialEncounterEvidence[]).map((entry) => ({...entry, summary:entry.summary.trim()})),
    participants: participants.map((participant) => ({
      ...participant,
      beliefs: participant.beliefs.map((belief) => ({
        ...belief,
        provenance: belief.provenance.map((link) => ({ ...link }))
      })),
      edges: participant.edges.map((edge) => ({ ...edge, axes:{ ...edge.axes } }))
    })) as [FrozenSocialEncounterResident, FrozenSocialEncounterResident]
  };
}

function participant(context: FrozenSocialEncounterContext, id: string): FrozenSocialEncounterResident | undefined {
  return context.participants.find((entry) => entry.residentId === id);
}
function otherParticipant(context: FrozenSocialEncounterContext, recipient: string, source: string): boolean {
  return context.participantResidentIds.includes(recipient) && context.participantResidentIds.includes(source) && recipient !== source;
}
function parseIntent(value: unknown, context: FrozenSocialEncounterContext): PrivateCommunicativeIntent | null {
  if (!object(value) || !exact(value, ['speakerResidentId', 'recipientResidentId', 'mode', 'message'])
    || typeof value.speakerResidentId !== 'string' || typeof value.recipientResidentId !== 'string' || !otherParticipant(context, value.recipientResidentId, value.speakerResidentId)
    || !SOCIAL_ENCOUNTER_INTENT_MODES.includes(value.mode as SocialEncounterIntentMode) || !text(value.message, 500)) return null;
  const capabilityByMode: Record<SocialEncounterIntentMode, SocialCapability | null> = { honest:null, withhold:'conceal', misdirect:'misdirect', fabricate:'deceive' };
  const required=capabilityByMode[value.mode as SocialEncounterIntentMode];
  if (required && !participant(context, value.speakerResidentId)?.capability.socialCapabilities.includes(required)) return null;
  return { speakerResidentId:value.speakerResidentId, recipientResidentId:value.recipientResidentId, mode:value.mode as SocialEncounterIntentMode, message:value.message.trim() };
}
function parseEffect(value: unknown, context: FrozenSocialEncounterContext): RecipientRelationshipEffect | null {
  if (!object(value) || !exact(value, ['recipientResidentId', 'sourceResidentId', 'axis', 'delta'])) return null;
  const delta=value.delta;
  if (typeof value.recipientResidentId !== 'string' || typeof value.sourceResidentId !== 'string' || !otherParticipant(context, value.recipientResidentId, value.sourceResidentId)
    || !SOCIAL_AXES.includes(value.axis as SocialAxis) || !integerBetween(delta, -4, 4) || delta === 0) return null;
  const recipient=participant(context, value.recipientResidentId);
  const source=participant(context, value.sourceResidentId);
  if (!recipient || !source || !recipient.edges.some((edge) => edge.subjectNpcId === recipient.npcId && edge.objectEntityId === source.npcId)) return null;
  return { recipientResidentId:value.recipientResidentId, sourceResidentId:value.sourceResidentId, axis:value.axis as SocialAxis, delta };
}
function parseGossip(value: unknown, context: FrozenSocialEncounterContext): GossipBeliefAddition | null {
  if (!object(value) || !exact(value, ['recipientResidentId', 'sourceResidentId', 'sourceBeliefId', 'sourceEvidenceId', 'originalClaimFingerprint', 'content', 'confidence', 'provenance'])) return null;
  const confidence=value.confidence;
  if (typeof value.recipientResidentId !== 'string' || typeof value.sourceResidentId !== 'string' || !otherParticipant(context, value.recipientResidentId, value.sourceResidentId)
    || typeof value.sourceBeliefId !== 'string' || !uuid.test(value.sourceBeliefId) || typeof value.sourceEvidenceId !== 'string' || !text(value.sourceEvidenceId, 128)
    || !fingerprint.test(String(value.originalClaimFingerprint)) || !text(value.content, 1_000) || !integerBetween(confidence, 0, 100)
    || !Array.isArray(value.provenance) || value.provenance.length < 1 || value.provenance.length > 8) return null;
  const source=participant(context, value.sourceResidentId);
  const sourceBelief=source?.beliefs.find((belief) => belief.id === value.sourceBeliefId && belief.state === 'active');
  const evidence=context.authorizedEvidence.find((entry) => entry.id === value.sourceEvidenceId);
  if (!source || !sourceBelief || !evidence || sourceBelief.content !== value.content || sourceBelief.originalClaimFingerprint !== value.originalClaimFingerprint || evidence.sourceFingerprint !== value.originalClaimFingerprint) return null;
  const provenance=value.provenance as BeliefProvenanceLink[];
  const requiredProvenance=[...sourceBelief.provenance, {sourceKind:'gossip' as const, sourceId:value.sourceBeliefId, speakerNpcId:source.npcId}];
  if (provenance.length !== requiredProvenance.length || !provenance.every(isProvenanceLink)
    || canonical(provenance) !== canonical(requiredProvenance)) return null;
  if (!participant(context, value.sourceResidentId)?.capability.socialCapabilities.includes('share_gossip')) return null;
  return {
    recipientResidentId:value.recipientResidentId, sourceResidentId:value.sourceResidentId, sourceBeliefId:value.sourceBeliefId,
    sourceEvidenceId:value.sourceEvidenceId, originalClaimFingerprint:value.originalClaimFingerprint, content:value.content.trim(), confidence,
    provenance:provenance.map((link) => ({...link}))
  };
}

/** Validate the proposal without accepting any canon, quest, entity, inventory, or irreversible mutation fields. */
export function parseSocialEncounterProposal(value: unknown, frozen: FrozenSocialEncounterContext): SocialEncounterParseResult {
  const keys=['version','templateKey','participantResidentIds','privateCommunicativeIntents','privateExchangeSummary','evidenceIds','causalExplanation','relationshipEffects','gossipBeliefAdditions','publicSummary'];
  if (!object(value) || !exact(value, keys) || !safeJson(value) || byteSize(value) > MAX_BYTES
    || value.version !== SOCIAL_ENCOUNTER_VERSION || value.templateKey !== frozen.templateKey || !residentIds(value.participantResidentIds)
    || value.participantResidentIds[0] !== frozen.participantResidentIds[0] || value.participantResidentIds[1] !== frozen.participantResidentIds[1]
    || !Array.isArray(value.privateCommunicativeIntents) || value.privateCommunicativeIntents.length > 2 || !text(value.privateExchangeSummary, 1_000)
    || !Array.isArray(value.evidenceIds) || value.evidenceIds.length < 1 || value.evidenceIds.length > 8 || !value.evidenceIds.every((id) => typeof id === 'string' && frozen.authorizedEvidence.some((entry) => entry.id === id)) || new Set(value.evidenceIds).size !== value.evidenceIds.length
    || !text(value.causalExplanation, 1_000)
    || !Array.isArray(value.relationshipEffects) || value.relationshipEffects.length > 4
    || !Array.isArray(value.gossipBeliefAdditions) || value.gossipBeliefAdditions.length > 2 || (value.publicSummary !== null && !text(value.publicSummary, 500))) {
    return { ok:false, issues:issue('', 'encounter_shape', 'A social encounter must use the exact bounded versioned shape.') };
  }
  const intents=value.privateCommunicativeIntents.map((entry) => parseIntent(entry, frozen));
  if (intents.some((entry) => entry === null) || new Set(intents.map((entry) => `${entry!.speakerResidentId}:${entry!.recipientResidentId}`)).size !== intents.length) return { ok:false, issues:issue('privateCommunicativeIntents', 'intent', 'Private communicative intents must be supported, directed, and unique.') };
  const effects=value.relationshipEffects.map((entry) => parseEffect(entry, frozen));
  if (effects.some((entry) => entry === null) || new Set(effects.map((entry) => `${entry!.recipientResidentId}:${entry!.sourceResidentId}:${entry!.axis}`)).size !== effects.length) return { ok:false, issues:issue('relationshipEffects', 'relationship_effect', 'Relationship effects must be unique directed recipient changes.') };
  const gossip=value.gossipBeliefAdditions.map((entry) => parseGossip(entry, frozen));
  if (gossip.some((entry) => entry === null) || new Set(gossip.map((entry) => `${entry!.recipientResidentId}:${entry!.sourceBeliefId}`)).size !== gossip.length) return { ok:false, issues:issue('gossipBeliefAdditions', 'gossip', 'Gossip must cite a distinct frozen source belief and evidence.') };
  return { ok:true, value:{
    version:SOCIAL_ENCOUNTER_VERSION, templateKey:frozen.templateKey, participantResidentIds:[...frozen.participantResidentIds],
    privateCommunicativeIntents:intents as PrivateCommunicativeIntent[], relationshipEffects:effects as RecipientRelationshipEffect[],
    gossipBeliefAdditions:gossip as GossipBeliefAddition[], privateExchangeSummary:value.privateExchangeSummary.trim(),
    evidenceIds:[...value.evidenceIds], causalExplanation:value.causalExplanation.trim(),
    publicSummary:value.publicSummary === null ? null : value.publicSummary.trim()
  } };
}

/** The only player-safe encounter output: no cognition, belief, edge, or private intent data crosses this boundary. */
export function toPublicSocialEncounterSummary(proposal: SocialEncounterProposal): PublicSocialEncounterSummary | null {
  if (proposal.publicSummary === null) return null;
  return { version:SOCIAL_ENCOUNTER_VERSION, templateKey:proposal.templateKey, participantResidentIds:[...proposal.participantResidentIds] as [string, string], publicSummary:proposal.publicSummary };
}

export function parsePublicSocialEncounterSummary(value: unknown): PublicSocialEncounterParseResult {
  if (!object(value) || !exact(value, ['version','templateKey','participantResidentIds','publicSummary'])
    || value.version !== SOCIAL_ENCOUNTER_VERSION || !text(value.templateKey, 80) || !primitiveRegistry.encounterTemplates.includes(value.templateKey)
    || !residentIds(value.participantResidentIds) || !text(value.publicSummary, 500) || !safeJson(value)) {
    return { ok:false, issues:issue('', 'public_encounter_shape', 'A public encounter summary must be bounded and exact.') };
  }
  return { ok:true, value:{version:SOCIAL_ENCOUNTER_VERSION,templateKey:value.templateKey.trim(),participantResidentIds:[...value.participantResidentIds] as [string,string],publicSummary:value.publicSummary.trim()} };
}

/** Canonical output is ready for a SHA-256 idempotency fingerprint without exposing a public projection by accident. */
export function canonicalizeSocialEncounterProposal(value: unknown, frozen: FrozenSocialEncounterContext): string | null {
  const parsed=parseSocialEncounterProposal(value, frozen);
  return parsed.ok ? canonical(parsed.value) : null;
}
export async function fingerprintSocialEncounterProposal(value: unknown, frozen: FrozenSocialEncounterContext): Promise<string | null> {
  const normalized=canonicalizeSocialEncounterProposal(value, frozen);
  if (!normalized || !globalThis.crypto?.subtle) return null;
  const bytes=new TextEncoder().encode(normalized);
  const digest=await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
