import {
  EVOLVING_WORLD_RULES_VERSION,
  PERSONALITY_SCHEMA_VERSION,
  PROFILE_ENTRY_KINDS,
  SALIENCE_BANDS,
  type CapabilityEnvelope,
  type BeliefOperation,
  type ContractIssue,
  type DimensionMutationReceipt,
  type MutationReceipt,
  type PersonalityDimensionDefinition,
  type PersonalityMutationProposal,
  type PersonalityProfile,
  type PersonalitySchema,
  type SalienceBand,
  type WorldEffectCommand,
  type WorldValidationSnapshot
} from './contracts';
import { primitiveRegistry, type PrimitiveRegistry } from './registry';

export const DEFAULT_SALIENCE_PRESSURE: Record<SalienceBand, number> = {
  minor: 5,
  meaningful: 15,
  major: 30,
  defining: 60
};

export const DEFAULT_MUTATION_CHANCE: Record<SalienceBand, number> = {
  minor: 15,
  meaningful: 35,
  major: 65,
  defining: 90
};

export const DEFAULT_ORDINARY_CHANGE_THRESHOLD = 25;
export const DEFAULT_DEFINING_RUPTURE_THRESHOLD = 100;
export const MAX_DIMENSION_CHANGES_PER_JOB = 3;
export const MAX_ENTRY_OPERATIONS_PER_JOB = 2;
export const MAX_BELIEF_OPERATIONS_PER_JOB = 2;
export const MIN_TRAIT_VALUE = -100;
export const MAX_TRAIT_VALUE = 100;

export function clampTrait(value: number): number {
  return Math.max(MIN_TRAIT_VALUE, Math.min(MAX_TRAIT_VALUE, Math.round(value)));
}

export function pressureContribution(salience: SalienceBand, volatility: number, direction: -1 | 1): number {
  if (!Number.isFinite(volatility) || volatility < 0) throw new RangeError('Volatility must be a non-negative finite number.');
  return Math.round(DEFAULT_SALIENCE_PRESSURE[salience] * volatility) * direction;
}

export function thresholdForDimension(dimension: PersonalityDimensionDefinition): number {
  const threshold = dimension.core
    ? (dimension.definingRuptureThreshold ?? DEFAULT_DEFINING_RUPTURE_THRESHOLD)
    : (dimension.ordinaryChangeThreshold ?? DEFAULT_ORDINARY_CHANGE_THRESHOLD);
  if (!Number.isInteger(threshold) || threshold <= 0) throw new RangeError('Personality thresholds must be positive integers.');
  return threshold;
}

export function crossesSignedThreshold(pressure: number, threshold: number): boolean {
  return Math.abs(pressure) >= threshold;
}

export function consumeSignedThreshold(pressure: number, threshold: number): number {
  if (!crossesSignedThreshold(pressure, threshold)) return pressure;
  return pressure - Math.sign(pressure) * threshold;
}

export function rollPasses(roll: number, chancePercent: number): boolean {
  if (!Number.isInteger(roll) || roll < 0 || roll > 99) throw new RangeError('Mutation roll must be an integer from 0 to 99.');
  if (!Number.isInteger(chancePercent) || chancePercent < 0 || chancePercent > 100) throw new RangeError('Chance must be an integer percentage.');
  return roll < chancePercent;
}

export function validatePersonalitySchema(schema: PersonalitySchema): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (schema.version !== PERSONALITY_SCHEMA_VERSION) {
    issues.push({ path: 'version', code: 'schema_version', message: 'The personality schema version is unsupported.' });
  }
  if (schema.dimensions.length === 0) {
    issues.push({ path: 'dimensions', code: 'dimension_count', message: 'A deep NPC requires at least one personality dimension.' });
  }
  const dimensionKeys = new Set<string>();
  for (const [index, dimension] of schema.dimensions.entries()) {
    const path = `dimensions.${index}`;
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(dimension.key) || dimensionKeys.has(dimension.key)) {
      issues.push({ path: `${path}.key`, code: 'dimension_key', message: 'Dimension keys must be unique stable identifiers.' });
    }
    dimensionKeys.add(dimension.key);
    if (!dimension.label.trim() || !dimension.negativeAnchor.trim() || !dimension.positiveAnchor.trim()) {
      issues.push({ path, code: 'dimension_description', message: 'Dimensions require a label and both semantic anchors.' });
    }
    if (!Number.isInteger(dimension.initialValue) || dimension.initialValue < MIN_TRAIT_VALUE || dimension.initialValue > MAX_TRAIT_VALUE) {
      issues.push({ path: `${path}.initialValue`, code: 'trait_bounds', message: 'Initial values must be integers from -100 to 100.' });
    }
    if (!Number.isFinite(dimension.volatility) || dimension.volatility < 0) {
      issues.push({ path: `${path}.volatility`, code: 'volatility', message: 'Volatility must be a non-negative finite multiplier.' });
    }
    try {
      thresholdForDimension(dimension);
    } catch {
      issues.push({ path, code: 'threshold', message: 'Configured thresholds must be positive integers.' });
    }
  }

  const collectionKinds = new Set<string>();
  for (const [index, collection] of schema.collections.entries()) {
    if (!PROFILE_ENTRY_KINDS.includes(collection.kind) || collectionKinds.has(collection.kind)) {
      issues.push({ path: `collections.${index}.kind`, code: 'collection_kind', message: 'Collection kinds must be supported and unique.' });
    }
    collectionKinds.add(collection.kind);
    if (!Number.isInteger(collection.maximumEntries) || collection.maximumEntries < 0) {
      issues.push({ path: `collections.${index}.maximumEntries`, code: 'collection_limit', message: 'Collection limits must be non-negative integers.' });
    }
  }
  return issues;
}

export function validatePersonalityProfile(profile: PersonalityProfile, schema: PersonalitySchema): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const dimensionKeys = new Set(schema.dimensions.map((dimension) => dimension.key));
  for (const key of dimensionKeys) {
    const value = profile.dimensions[key];
    if (!Number.isInteger(value) || value < MIN_TRAIT_VALUE || value > MAX_TRAIT_VALUE) {
      issues.push({ path: `dimensions.${key}`, code: 'trait_bounds', message: 'Profile dimensions must be integers from -100 to 100.' });
    }
  }
  for (const key of Object.keys(profile.dimensions)) {
    if (!dimensionKeys.has(key)) issues.push({ path: `dimensions.${key}`, code: 'unknown_dimension', message: 'Profiles cannot add dimensions outside their immutable schema.' });
  }

  const entryIds = new Set<string>();
  const collectionLimits = new Map(schema.collections.map((collection) => [collection.kind, collection.maximumEntries]));
  const counts = new Map<string, number>();
  profile.entries.forEach((entry, index) => {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(entry.id) || entryIds.has(entry.id)) {
      issues.push({ path: `entries.${index}.id`, code: 'entry_id', message: 'Profile entry IDs must be unique stable identifiers.' });
    }
    entryIds.add(entry.id);
    if (!collectionLimits.has(entry.kind)) {
      issues.push({ path: `entries.${index}.kind`, code: 'entry_kind', message: 'Profile entries must use a collection allowed by the immutable schema.' });
    }
    if (!entry.text.trim() || entry.text.length > 1000) {
      issues.push({ path: `entries.${index}.text`, code: 'entry_text', message: 'Profile entry text must contain 1–1,000 characters.' });
    }
    if (entry.active) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  });
  for (const [kind, count] of counts) {
    if (count > (collectionLimits.get(kind as never) ?? 0)) {
      issues.push({ path: 'entries', code: 'collection_limit', message: `The ${kind} collection exceeds its immutable maximum.` });
    }
  }
  return issues;
}

export function validateMutationProposal(proposal: PersonalityMutationProposal, schema: PersonalitySchema, profile: PersonalityProfile, snapshot?: WorldValidationSnapshot): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (proposal.rulesVersion !== EVOLVING_WORLD_RULES_VERSION) {
    issues.push({ path: 'rulesVersion', code: 'rules_version', message: 'The proposal must use the active evolution rules.' });
  }
  if (!SALIENCE_BANDS.includes(proposal.salience)) {
    issues.push({ path: 'salience', code: 'salience', message: 'The proposal must use a supported salience band.' });
  }
  if (proposal.evidenceIds.length === 0 || new Set(proposal.evidenceIds).size !== proposal.evidenceIds.length) {
    issues.push({ path: 'evidenceIds', code: 'evidence', message: 'A proposal requires unique supporting evidence.' });
  }
  if (!proposal.causalExplanation.trim()) {
    issues.push({ path: 'causalExplanation', code: 'causal_explanation', message: 'A proposal requires one shared causal explanation.' });
  }
  if (proposal.dimensionChanges.length > MAX_DIMENSION_CHANGES_PER_JOB) {
    issues.push({ path: 'dimensionChanges', code: 'dimension_width', message: `A proposal may change at most ${MAX_DIMENSION_CHANGES_PER_JOB} dimensions.` });
  }
  if (proposal.entryOperations.length > MAX_ENTRY_OPERATIONS_PER_JOB) {
    issues.push({ path: 'entryOperations', code: 'entry_width', message: `A proposal may contain at most ${MAX_ENTRY_OPERATIONS_PER_JOB} typed-entry operations.` });
  }
  issues.push(...validateBeliefOperations(proposal.beliefOperations, snapshot));

  const dimensions = new Set(schema.dimensions.map((dimension) => dimension.key));
  const proposedDimensions = new Set<string>();
  for (const [index, change] of proposal.dimensionChanges.entries()) {
    if (!dimensions.has(change.dimensionKey) || proposedDimensions.has(change.dimensionKey)) {
      issues.push({ path: `dimensionChanges.${index}.dimensionKey`, code: 'dimension_reference', message: 'Dimension changes must reference distinct schema dimensions.' });
    }
    proposedDimensions.add(change.dimensionKey);
    if ((change.direction !== -1 && change.direction !== 1) || !Number.isInteger(change.intendedDelta) || change.intendedDelta === 0) {
      issues.push({ path: `dimensionChanges.${index}`, code: 'dimension_delta', message: 'Dimension changes require a direction and non-zero integer delta.' });
    }
    if (Math.sign(change.intendedDelta) !== change.direction) {
      issues.push({ path: `dimensionChanges.${index}.intendedDelta`, code: 'direction_mismatch', message: 'The intended delta must match the pressure direction.' });
    }
  }

  const entries = new Map(profile.entries.map((entry) => [entry.id, entry]));
  const resultingActiveCounts = new Map(schema.collections.map((collection) => [collection.kind, profile.entries.filter((entry) => entry.active && entry.kind === collection.kind).length]));
  const addedIds = new Set<string>();
  for (const [index, operation] of proposal.entryOperations.entries()) {
    if (operation.operation === 'add') {
      const entry = operation.entry;
      const collection = schema.collections.find((candidate) => candidate.kind === entry.kind);
      if (!collection || !/^[a-z][a-z0-9_]{1,63}$/.test(entry.id) || entries.has(entry.id) || addedIds.has(entry.id)
        || !entry.text.trim() || entry.text.length > 1000 || !entry.active) {
        issues.push({ path: `entryOperations.${index}`, code: 'entry_add', message: 'Added entries must be new, active, bounded, and permitted by the immutable schema.' });
      } else {
        addedIds.add(entry.id);
        const count = (resultingActiveCounts.get(entry.kind) ?? 0) + 1;
        resultingActiveCounts.set(entry.kind, count);
        if (count > collection.maximumEntries) {
          issues.push({ path: `entryOperations.${index}`, code: 'collection_limit', message: `The ${entry.kind} collection would exceed its immutable maximum.` });
        }
      }
      continue;
    }
    const existing = entries.get(operation.entryId);
    if (!existing || !existing.active) {
      issues.push({ path: `entryOperations.${index}.entryId`, code: 'entry_reference', message: 'Entry changes must reference an active current-profile entry.' });
      continue;
    }
    if (operation.operation === 'revise' && (!operation.text.trim() || operation.text.length > 1000)) {
      issues.push({ path: `entryOperations.${index}.text`, code: 'entry_text', message: 'Revised entry text must contain 1–1,000 characters.' });
    }
  }
  return issues;
}

/** Validates attributed knowledge only. It never treats a belief as a canonical world assertion. */
const REFERENCE_ID = /^(?:[a-z][a-z0-9_-]{1,127}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
function referenceId(value: unknown): value is string { return typeof value === 'string' && REFERENCE_ID.test(value); }

export function validateBeliefOperations(operations: readonly BeliefOperation[], snapshot?: WorldValidationSnapshot): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (operations.length > MAX_BELIEF_OPERATIONS_PER_JOB) {
    issues.push({ path: 'beliefOperations', code: 'belief_width', message: `A proposal may contain at most ${MAX_BELIEF_OPERATIONS_PER_JOB} belief operations.` });
  }
  const retracted = new Set<string>();
  operations.forEach((operation, index) => {
    const path = `beliefOperations.${index}`;
    if (operation.operation === 'add') {
      if (!referenceId(operation.subjectEntityId) || (snapshot && !knownEntity(snapshot, operation.subjectEntityId)) || !operation.content.trim() || operation.content.length > 1_000
        || !Number.isInteger(operation.confidence) || operation.confidence < 0 || operation.confidence > 100
        || !/^[a-f0-9]{64}$/i.test(operation.originalClaimFingerprint)
        || operation.provenance.length < 1 || operation.provenance.length > 4) {
        issues.push({ path, code: 'belief_add', message: 'A new belief requires bounded attributed content, confidence, provenance, and claim fingerprint.' });
        return;
      }
      operation.provenance.forEach((link, provenanceIndex) => {
        if (!['direct_evidence', 'dialogue_claim', 'gossip', 'inference'].includes(link.sourceKind)
          || !referenceId(link.sourceId) || (link.speakerNpcId !== undefined && !referenceId(link.speakerNpcId))) {
          issues.push({ path: `${path}.provenance.${provenanceIndex}`, code: 'belief_provenance', message: 'Belief provenance must use the typed, bounded attribution contract.' });
        }
      });
      return;
    }
    if (!referenceId(operation.beliefId) || retracted.has(operation.beliefId) || !operation.reason.trim() || operation.reason.length > 500
      || !/^[a-f0-9]{64}$/i.test(operation.sourceFingerprint)) {
      issues.push({ path, code: 'belief_retract', message: 'A belief retraction requires one existing belief reference, a bounded reason, and source fingerprint.' });
    }
    retracted.add(operation.beliefId);
  });
  return issues;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const FORBIDDEN_PROPOSAL_SEGMENT = /(?:^|_)(?:sql|query|route|url|endpoint|code|function|handler|script|executable)(?:$|_)/;
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_PROPOSAL_DEPTH = 6;
const MAX_PROPOSAL_NODES = 160;
const MAX_PROPOSAL_STRING = 1_000;
const MAX_PROPOSAL_BYTES = 15_000;

function normalizedKey(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function proposalFitsByteBudget(value: unknown): boolean {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_PROPOSAL_BYTES; }
  catch { return false; }
}

function safeProposalJson(value: unknown, depth = 0, tally = { count: 0 }): boolean {
  if (depth > MAX_PROPOSAL_DEPTH || ++tally.count > MAX_PROPOSAL_NODES) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= MAX_PROPOSAL_STRING;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 32 && value.every((entry) => safeProposalJson(entry, depth + 1, tally));
  if (!record(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(([key, entry]) => !FORBIDDEN_OBJECT_KEYS.has(key) && !FORBIDDEN_PROPOSAL_SEGMENT.test(normalizedKey(key)) && key.length <= 80 && safeProposalJson(entry, depth + 1, tally));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

export type ParsedMutationProposal =
  | { ok: true; value: PersonalityMutationProposal }
  | { ok: false; issues: ContractIssue[] };

export function parseMutationProposal(value: unknown): ParsedMutationProposal {
  const issue = (path: string, code: string, message: string): ParsedMutationProposal => ({ ok: false, issues: [{ path, code, message }] });
  if (!record(value) || !hasOnlyKeys(value, [
    'rulesVersion', 'evidenceIds', 'salience', 'dimensionChanges', 'entryOperations',
    'beliefOperations', 'causalExplanation', 'questChanges', 'worldEffects'
  ])) return issue('', 'proposal_shape', 'A mutation proposal must contain only the versioned contract fields.');
  if (value.rulesVersion !== EVOLVING_WORLD_RULES_VERSION || !SALIENCE_BANDS.includes(value.salience as never)
    || !Array.isArray(value.evidenceIds) || !value.evidenceIds.every((id) => typeof id === 'string')
    || typeof value.causalExplanation !== 'string' || !Array.isArray(value.dimensionChanges)
    || !Array.isArray(value.entryOperations) || !Array.isArray(value.beliefOperations)
    || !Array.isArray(value.questChanges) || !Array.isArray(value.worldEffects) || !proposalFitsByteBudget(value) || !safeProposalJson(value)) {
    return issue('', 'proposal_shape', 'The mutation proposal has missing or invalid top-level fields.');
  }
  if (!value.dimensionChanges.every((change) => record(change) && hasOnlyKeys(change, ['dimensionKey', 'direction', 'intendedDelta'])
    && typeof change.dimensionKey === 'string' && (change.direction === -1 || change.direction === 1) && typeof change.intendedDelta === 'number')) {
    return issue('dimensionChanges', 'dimension_shape', 'Dimension changes must use the strict structured shape.');
  }
  if (!value.entryOperations.every((operation) => {
    if (!record(operation) || typeof operation.operation !== 'string') return false;
    if (operation.operation === 'add') return hasOnlyKeys(operation, ['operation', 'entry']) && record(operation.entry)
      && hasOnlyKeys(operation.entry, ['id', 'kind', 'text', 'core', 'active'])
      && typeof operation.entry.id === 'string' && PROFILE_ENTRY_KINDS.includes(operation.entry.kind as never)
      && typeof operation.entry.text === 'string' && typeof operation.entry.core === 'boolean'
      && typeof operation.entry.active === 'boolean';
    if (operation.operation === 'revise') return hasOnlyKeys(operation, ['operation', 'entryId', 'text'])
      && typeof operation.entryId === 'string' && typeof operation.text === 'string';
    return operation.operation === 'retract' && hasOnlyKeys(operation, ['operation', 'entryId']) && typeof operation.entryId === 'string';
  })) return issue('entryOperations', 'entry_shape', 'Entry operations must use a supported strict structured shape.');
  if (!value.beliefOperations.every((operation) => {
    if (!record(operation) || typeof operation.operation !== 'string') return false;
    if (operation.operation === 'add') {
      return hasOnlyKeys(operation, ['operation', 'subjectEntityId', 'content', 'confidence', 'provenance', 'originalClaimFingerprint'])
        && typeof operation.subjectEntityId === 'string' && typeof operation.content === 'string' && typeof operation.confidence === 'number'
        && typeof operation.originalClaimFingerprint === 'string' && Array.isArray(operation.provenance)
        && operation.provenance.every((link) => record(link) && hasOnlyKeys(link, ['sourceKind', 'sourceId', 'speakerNpcId'])
          && typeof link.sourceKind === 'string' && typeof link.sourceId === 'string'
          && (link.speakerNpcId === undefined || typeof link.speakerNpcId === 'string'));
    }
    return operation.operation === 'retract' && hasOnlyKeys(operation, ['operation', 'beliefId', 'reason', 'sourceFingerprint'])
      && typeof operation.beliefId === 'string' && typeof operation.reason === 'string' && typeof operation.sourceFingerprint === 'string';
  })) return issue('beliefOperations', 'belief_shape', 'Belief operations must be strict attributed additions or retractions.');
  if (!value.questChanges.every((change) => record(change) && hasOnlyKeys(change, ['questId', 'action', 'motivation'])
    && typeof change.questId === 'string' && typeof change.action === 'string' && typeof change.motivation === 'string')) {
    return issue('questChanges', 'quest_shape', 'Quest changes must use the strict structured shape.');
  }
  return { ok: true, value: value as unknown as PersonalityMutationProposal };
}

/** A sorted, bounded canonical representation for exact action replay. */
export function canonicalizeMutationProposal(value: unknown): string | null {
  const parsed = parseMutationProposal(value);
  return parsed.ok ? canonicalJson(parsed.value) : null;
}

/** SHA-256 of the canonical proposal; the database may persist this as its exact replay key. */
export async function fingerprintMutationProposal(value: unknown): Promise<string | null> {
  const canonical = canonicalizeMutationProposal(value);
  if (!canonical || !globalThis.crypto?.subtle) return null;
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stableKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{1,127}$/.test(value);
}

function knownEntity(snapshot: WorldValidationSnapshot, id: unknown, expectedKind?: string): boolean {
  return typeof id === 'string' && id in snapshot.entityKinds && (!expectedKind || snapshot.entityKinds[id] === expectedKind);
}

export function validateWorldEffectCommands(
  commands: unknown,
  capability: CapabilityEnvelope,
  snapshot: WorldValidationSnapshot,
  definitions: Pick<PrimitiveRegistry, 'worldEffects' | 'entityArchetypes' | 'locationModifiers' | 'economyModifiers' | 'worldEventTemplates'> = primitiveRegistry
): ContractIssue[] {
  if (!Array.isArray(commands)) return [{ path: 'worldEffects', code: 'effect_shape', message: 'World effects must be an array.' }];
  const issues: ContractIssue[] = [];
  commands.forEach((unknownCommand, index) => {
    const path = `worldEffects.${index}`;
    if (!unknownCommand || typeof unknownCommand !== 'object' || Array.isArray(unknownCommand)) {
      issues.push({ path, code: 'effect_shape', message: 'Every world effect must be a structured command.' });
      return;
    }
    const command = unknownCommand as Record<string, unknown>;
    if (typeof command.kind !== 'string' || !capability.allowedWorldEffects.includes(command.kind as never)) {
      issues.push({ path: `${path}.kind`, code: 'effect_capability', message: 'The immutable capability envelope does not allow this effect.' });
      return;
    }
    const invalid = (allowed: string[], condition: boolean, code = 'effect_payload') => {
      if (!hasOnlyKeys(command, ['kind', ...allowed]) || !condition) issues.push({ path, code, message: 'The effect payload is malformed or references unsupported state.' });
    };
    const metadata = definitions.worldEffects.find((effect) => effect.kind === command.kind);
    if (!metadata) {
      issues.push({ path: `${path}.kind`, code: 'effect_registry', message: 'The effect kind is missing from the immutable primitive registry.' });
      return;
    }
    const targetAllowed = (id: unknown) => knownEntity(snapshot, id) && metadata.targetKinds.includes(snapshot.entityKinds[String(id)]);
    const quantity = (value: unknown) => Number.isInteger(value) && Number(value) >= metadata.bounds.min && Number(value) <= metadata.bounds.max;
    switch (command.kind as WorldEffectCommand['kind']) {
      case 'adjust_relationship':
        invalid(['subjectNpcId', 'objectEntityId', 'axis', 'delta'], knownEntity(snapshot, command.subjectNpcId, 'npc') && knownEntity(snapshot, command.objectEntityId)
          && targetAllowed(command.objectEntityId) && ['trust', 'affection', 'respect', 'fear', 'obligation'].includes(String(command.axis))
          && quantity(command.delta));
        break;
      case 'create_quest':
        invalid(['ownerNpcId', 'templateKey', 'targetEntityIds'], knownEntity(snapshot, command.ownerNpcId, 'npc') && stableKey(command.templateKey)
          && Array.isArray(command.targetEntityIds) && command.targetEntityIds.length >= metadata.bounds.min && command.targetEntityIds.length <= metadata.bounds.max && command.targetEntityIds.every(targetAllowed));
        break;
      case 'update_quest':
        invalid(['questId', 'action', 'approach', 'targetEntityIds'], typeof command.questId === 'string' && snapshot.activeQuestIds.includes(command.questId)
          && typeof command.action === 'string' && capability.allowedActions.includes(command.action)
          && (command.approach === undefined || (typeof command.approach === 'string' && capability.allowedApproaches.includes(command.approach)))
          && (command.targetEntityIds === undefined || (Array.isArray(command.targetEntityIds) && command.targetEntityIds.length >= metadata.bounds.min && command.targetEntityIds.length <= metadata.bounds.max && command.targetEntityIds.every(targetAllowed))));
        break;
      case 'create_entity':
        invalid(['entityKind', 'archetypeKey', 'proposedName', 'payload'], capability.allowedTargetKinds.includes(command.entityKind as never)
          && metadata.targetKinds.includes(command.entityKind as never) && stableKey(command.archetypeKey)
          && definitions.entityArchetypes.some((archetype) => archetype.key === command.archetypeKey && archetype.kind === command.entityKind)
          && typeof command.proposedName === 'string' && command.proposedName.trim().length > 0 && command.proposedName.length <= 120
          && record(command.payload) && safeProposalJson(command.payload));
        break;
      case 'retire_entity': {
        const targetKind = snapshot.entityKinds[String(command.entityId)];
        const authorization = typeof command.irreversibleEffectKey === 'string'
          ? snapshot.authorizedIrreversibleEffects.find((entry) => entry.effectKey === command.irreversibleEffectKey && entry.targetEntityId === command.entityId)
          : undefined;
        const capabilityRule = typeof command.irreversibleEffectKey === 'string'
          ? capability.irreversibleEffects.find((entry) => entry.effectKey === command.irreversibleEffectKey)
          : undefined;
        const irreversibleAllowed = !!targetKind && !!authorization && authorization.criticApproved
          && snapshot.currentDay - authorization.visibleSinceDay >= 1 && !!capabilityRule
          && capabilityRule.targetKinds.includes(targetKind);
        invalid(['entityId', 'reason', 'irreversibleEffectKey'], knownEntity(snapshot, command.entityId) && targetAllowed(command.entityId) && metadata.irreversible && typeof command.reason === 'string'
          && command.reason.trim().length > 0 && irreversibleAllowed, 'irreversible_authorization');
        break;
      }
      case 'record_world_event':
        invalid(['templateKey', 'participantEntityIds', 'payload'], stableKey(command.templateKey) && definitions.worldEventTemplates.includes(command.templateKey)
          && Array.isArray(command.participantEntityIds) && command.participantEntityIds.length >= metadata.bounds.min && command.participantEntityIds.length <= metadata.bounds.max
          && command.participantEntityIds.every(targetAllowed) && record(command.payload) && safeProposalJson(command.payload));
        break;
      case 'apply_location_modifier':
        invalid(['locationId', 'modifierKey', 'magnitude', 'durationDays'], knownEntity(snapshot, command.locationId, 'location') && targetAllowed(command.locationId) && definitions.locationModifiers.includes(String(command.modifierKey))
          && quantity(command.magnitude)
          && Number.isInteger(command.durationDays) && Number(command.durationDays) > 0 && Number(command.durationDays) <= 365);
        break;
      case 'transfer_inventory':
        invalid(['itemEntityId', 'fromEntityId', 'toEntityId', 'quantity'], knownEntity(snapshot, command.itemEntityId, 'item')
          && targetAllowed(command.itemEntityId) && targetAllowed(command.fromEntityId) && targetAllowed(command.toEntityId)
          && quantity(command.quantity));
        break;
      case 'unlock_recipe':
        invalid(['recipeEntityId'], knownEntity(snapshot, command.recipeEntityId, 'recipe') && targetAllowed(command.recipeEntityId));
        break;
      case 'apply_economy_modifier':
        invalid(['modifierKey', 'magnitude', 'durationDays'], definitions.economyModifiers.includes(String(command.modifierKey)) && quantity(command.magnitude) && Number.isInteger(command.durationDays)
          && Number(command.durationDays) > 0 && Number(command.durationDays) <= 365);
        break;
      case 'set_availability':
        invalid(['npcId', 'available', 'reason'], knownEntity(snapshot, command.npcId, 'npc') && targetAllowed(command.npcId) && typeof command.available === 'boolean'
          && typeof command.reason === 'string' && command.reason.trim().length > 0);
        break;
      default:
        issues.push({ path: `${path}.kind`, code: 'effect_kind', message: 'The command kind is not registered.' });
    }
  });
  return issues;
}

export function validateQuestChanges(
  questChanges: PersonalityMutationProposal['questChanges'],
  capability: CapabilityEnvelope,
  snapshot: WorldValidationSnapshot
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  questChanges.forEach((change, index) => {
    const path = `questChanges.${index}`;
    if (!snapshot.activeQuestIds.includes(change.questId)) {
      issues.push({ path: `${path}.questId`, code: 'quest_reference', message: 'Quest changes must reference a current active quest.' });
    }
    if (!capability.allowedActions.includes(change.action)) {
      issues.push({ path: `${path}.action`, code: 'quest_capability', message: 'The immutable capability envelope does not allow this quest action.' });
    }
    if (!change.motivation.trim() || change.motivation.length > 500) {
      issues.push({ path: `${path}.motivation`, code: 'quest_motivation', message: 'Quest changes require a bounded motivation.' });
    }
  });
  return issues;
}

export function createMutationReceipt(args: {
  schema: PersonalitySchema;
  proposal: unknown;
  currentProfile: PersonalityProfile;
  capabilityEnvelope: CapabilityEnvelope;
  worldSnapshot: WorldValidationSnapshot;
  pressureByDimension: Record<string, number>;
  roll?: number;
}): MutationReceipt {
  const parsed = parseMutationProposal(args.proposal);
  if (!parsed.ok) throw new Error(`Invalid mutation input: ${parsed.issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
  const proposal = parsed.value;
  const issues = [
    ...validatePersonalitySchema(args.schema),
    ...validatePersonalityProfile(args.currentProfile, args.schema),
    ...validateMutationProposal(proposal, args.schema, args.currentProfile, args.worldSnapshot),
    ...validateQuestChanges(proposal.questChanges, args.capabilityEnvelope, args.worldSnapshot),
    ...validateWorldEffectCommands(proposal.worldEffects, args.capabilityEnvelope, args.worldSnapshot)
  ];
  if (issues.length > 0) throw new Error(`Invalid mutation input: ${issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);

  const definitions = new Map(args.schema.dimensions.map((dimension) => [dimension.key, dimension]));
  const entryOperationIsCore = (operation: PersonalityMutationProposal['entryOperations'][number]): boolean => {
    if (operation.operation === 'add') return operation.entry.core;
    return args.currentProfile.entries.find((entry) => entry.id === operation.entryId)?.core === true;
  };
  const dimensions: DimensionMutationReceipt[] = proposal.dimensionChanges.map((change) => {
    const definition = definitions.get(change.dimensionKey)!;
    const pressureBefore = args.pressureByDimension[change.dimensionKey] ?? 0;
    if (!Number.isSafeInteger(pressureBefore)) throw new Error(`Pressure for ${change.dimensionKey} must be a safe integer.`);
    const pressureAdded = pressureContribution(proposal.salience, definition.volatility, change.direction);
    const pressureAfterApproval = pressureBefore + pressureAdded;
    const threshold = thresholdForDimension(definition);
    return {
      dimensionKey: change.dimensionKey,
      pressureBefore,
      pressureAdded,
      pressureAfterApproval,
      threshold,
      crossedThreshold: crossesSignedThreshold(pressureAfterApproval, threshold),
      pressureAfterCommit: pressureAfterApproval,
      intendedDelta: change.intendedDelta,
      appliedDelta: 0,
      valueBefore: args.currentProfile.dimensions[change.dimensionKey],
      valueAfter: args.currentProfile.dimensions[change.dimensionKey]
    };
  });

  const thresholdQualified = dimensions.some((dimension) => dimension.crossedThreshold);
  if (!thresholdQualified) {
    return { rulesVersion: EVOLVING_WORLD_RULES_VERSION, outcome: 'pressure_only', chancePercent: null, roll: null, dimensions, appliedEntryOperationIndexes: [] };
  }

  if (args.roll === undefined) throw new Error('A persisted 0–99 roll is required for a threshold-qualified proposal.');
  const chancePercent = DEFAULT_MUTATION_CHANCE[proposal.salience];
  const changed = rollPasses(args.roll, chancePercent);
  if (!changed) {
    return { rulesVersion: EVOLVING_WORLD_RULES_VERSION, outcome: 'roll_failed', chancePercent, roll: args.roll, dimensions, appliedEntryOperationIndexes: [] };
  }

  for (const dimension of dimensions) {
    const definition = definitions.get(dimension.dimensionKey)!;
    if (definition.core && !dimension.crossedThreshold) continue;
    if (dimension.crossedThreshold) dimension.pressureAfterCommit = consumeSignedThreshold(dimension.pressureAfterApproval, dimension.threshold);
    dimension.valueAfter = clampTrait(dimension.valueBefore + dimension.intendedDelta);
    dimension.appliedDelta = dimension.valueAfter - dimension.valueBefore;
  }
  const definingCoreThresholdCrossed = dimensions.some((dimension) => definitions.get(dimension.dimensionKey)?.core && dimension.crossedThreshold);
  const appliedEntryOperationIndexes = proposal.entryOperations.flatMap((operation, index) => !entryOperationIsCore(operation) || definingCoreThresholdCrossed ? [index] : []);
  return { rulesVersion: EVOLVING_WORLD_RULES_VERSION, outcome: 'changed', chancePercent, roll: args.roll, dimensions, appliedEntryOperationIndexes };
}
