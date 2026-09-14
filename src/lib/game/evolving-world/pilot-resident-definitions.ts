import pilotResidentsJson from '../../../../supabase/content/evolving-world/pilot-residents-v1.json';
import {
  PERSONALITY_SCHEMA_VERSION,
  PROFILE_ENTRY_KINDS,
  WORLD_ENTITY_KINDS,
  type AppearanceSpecification,
  type CapabilityEnvelope,
  type ContractIssue,
  type DeepNpcEvolutionDefinition,
  type PersonalityProfile,
  type PersonalitySchema,
  type SocialCapability,
  type WorldEffectKind
} from './contracts';
import { validatePersonalityProfile, validatePersonalitySchema } from './rules';

export const PILOT_RESIDENTS_VERSION = 'pilot-residents-v1' as const;
export const PILOT_RESIDENT_DEFINITION_VERSION = 'pilot-resident-v1' as const;

export type PilotResidentKey = 'lira' | 'torvin';

export interface PilotResidentDefinition extends DeepNpcEvolutionDefinition {
  key: PilotResidentKey;
  definitionVersion: typeof PILOT_RESIDENT_DEFINITION_VERSION;
  sourceIdentity: { npcId: string; npcVersionId: string; npcKey: PilotResidentKey };
  appearanceSource: { npcVersionId: string; schemaVersion: 'npc-sheet-v1' };
}

export type PilotResidentDefinitionsParseResult =
  | { ok: true; value: Readonly<Record<PilotResidentKey, Readonly<PilotResidentDefinition>>> }
  | { ok: false; issues: ContractIssue[] };

const EXPECTED_SOURCES: Readonly<Record<PilotResidentKey, Readonly<PilotResidentDefinition['sourceIdentity']>>> = {
  lira: { npcId: '18181818-1818-4181-8181-181818181818', npcVersionId: '18181818-1818-4181-8181-181818181819', npcKey: 'lira' },
  torvin: { npcId: '28282828-2828-4282-8282-282828282828', npcVersionId: '28282828-2828-4282-8282-282828282829', npcKey: 'torvin' }
};
const expectedCollections = [
  ['value', 6], ['boundary', 4], ['preference', 6], ['aversion', 6],
  ['motive', 4], ['fear', 4], ['coping_pattern', 4], ['voice_trait', 4]
] as const;
const expectedActions = ['prepare', 'attempt', 'wait', 'abandon'];
const expectedApproaches = ['scouting', 'combat', 'diplomacy', 'trade'];
const expectedTargetKinds = ['npc', 'location', 'faction', 'item'];
const expectedSocial: Readonly<Record<PilotResidentKey, readonly SocialCapability[]>> = {
  lira: ['conceal', 'share_gossip'], torvin: ['misdirect', 'share_gossip']
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function issue(issues: ContractIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function exactKeys(value: unknown, keys: readonly string[], path: string, issues: ContractIssue[]): value is Record<string, unknown> {
  if (!record(value)) {
    issue(issues, path, 'shape', 'Expected an object.');
    return false;
  }
  for (const key of Object.keys(value)) if (!keys.includes(key)) issue(issues, `${path}.${key}`, 'unknown_field', 'Pilot resident definitions reject unknown fields.');
  for (const key of keys) if (!(key in value)) issue(issues, `${path}.${key}`, 'required_field', 'Pilot resident definitions require this field.');
  return true;
}

function list(value: unknown, path: string, issues: ContractIssue[]): value is unknown[] {
  if (!Array.isArray(value)) {
    issue(issues, path, 'shape', 'Expected an array.');
    return false;
  }
  return true;
}

function string(value: unknown, path: string, issues: ContractIssue[]): value is string {
  if (typeof value !== 'string' || !value.trim()) {
    issue(issues, path, 'text', 'Expected non-empty text.');
    return false;
  }
  return true;
}

function sameList(actual: unknown, expected: readonly string[], path: string, issues: ContractIssue[], code: string): void {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    issue(issues, path, code, 'This pilot contract has a fixed ordered vocabulary.');
  }
}

function validateSchemaShape(value: unknown, path: string, issues: ContractIssue[]): value is PersonalitySchema {
  if (!exactKeys(value, ['version', 'dimensions', 'collections'], path, issues)) return false;
  if (value.version !== PERSONALITY_SCHEMA_VERSION) issue(issues, `${path}.version`, 'schema_version', 'Use the active personality schema version.');
  if (!list(value.dimensions, `${path}.dimensions`, issues) || !list(value.collections, `${path}.collections`, issues)) return false;
  value.dimensions.forEach((dimension, index) => {
    if (!exactKeys(dimension, ['key', 'label', 'negativeAnchor', 'positiveAnchor', 'initialValue', 'volatility', 'ordinaryChangeThreshold', 'definingRuptureThreshold', 'core'], `${path}.dimensions.${index}`, issues)) return;
    for (const key of ['key', 'label', 'negativeAnchor', 'positiveAnchor'] as const) string(dimension[key], `${path}.dimensions.${index}.${key}`, issues);
    if (!Number.isInteger(dimension.initialValue) || !Number.isFinite(dimension.volatility) || !Number.isInteger(dimension.ordinaryChangeThreshold) || !Number.isInteger(dimension.definingRuptureThreshold) || typeof dimension.core !== 'boolean') issue(issues, `${path}.dimensions.${index}`, 'dimension_shape', 'Dimensions require typed scalar fields.');
  });
  value.collections.forEach((collection, index) => {
    if (!exactKeys(collection, ['kind', 'maximumEntries'], `${path}.collections.${index}`, issues)) return;
    if (typeof collection.kind !== 'string' || !PROFILE_ENTRY_KINDS.includes(collection.kind as never) || !Number.isInteger(collection.maximumEntries)) issue(issues, `${path}.collections.${index}`, 'collection_shape', 'Collections require a supported kind and integer cap.');
  });
  return true;
}

function validateProfileShape(value: unknown, path: string, issues: ContractIssue[]): value is PersonalityProfile {
  if (!exactKeys(value, ['dimensions', 'entries'], path, issues)) return false;
  if (!record(value.dimensions) || !list(value.entries, `${path}.entries`, issues)) {
    issue(issues, `${path}.dimensions`, 'shape', 'Profiles require a dimension record.');
    return false;
  }
  for (const [key, dimension] of Object.entries(value.dimensions)) if (!Number.isInteger(dimension)) issue(issues, `${path}.dimensions.${key}`, 'trait_bounds', 'Profile dimensions must be integers.');
  value.entries.forEach((entry, index) => {
    if (!exactKeys(entry, ['id', 'kind', 'text', 'core', 'active'], `${path}.entries.${index}`, issues)) return;
    if (!string(entry.id, `${path}.entries.${index}.id`, issues) || typeof entry.kind !== 'string' || !PROFILE_ENTRY_KINDS.includes(entry.kind as never) || !string(entry.text, `${path}.entries.${index}.text`, issues) || typeof entry.core !== 'boolean' || typeof entry.active !== 'boolean') issue(issues, `${path}.entries.${index}`, 'entry_shape', 'Profile entries require supported typed fields.');
  });
  return true;
}

function validateCapability(value: unknown, key: PilotResidentKey, path: string, issues: ContractIssue[]): value is CapabilityEnvelope {
  if (!exactKeys(value, ['version', 'allowedActions', 'allowedApproaches', 'allowedWorldEffects', 'allowedTargetKinds', 'socialCapabilities', 'irreversibleEffects'], path, issues)) return false;
  if (value.version !== 'capabilities-v1') issue(issues, `${path}.version`, 'capability_version', 'Use capabilities-v1.');
  sameList(value.allowedActions, expectedActions, `${path}.allowedActions`, issues, 'capability_actions');
  sameList(value.allowedApproaches, expectedApproaches, `${path}.allowedApproaches`, issues, 'capability_approaches');
  sameList(value.allowedWorldEffects, ['adjust_relationship'], `${path}.allowedWorldEffects`, issues, 'capability_effects');
  sameList(value.allowedTargetKinds, expectedTargetKinds, `${path}.allowedTargetKinds`, issues, 'capability_targets');
  sameList(value.socialCapabilities, expectedSocial[key], `${path}.socialCapabilities`, issues, 'capability_social');
  if (!Array.isArray(value.irreversibleEffects) || value.irreversibleEffects.length !== 0) issue(issues, `${path}.irreversibleEffects`, 'capability_irreversible', 'Pilot residents cannot authorize irreversible effects.');
  return true;
}

function validateAppearance(value: unknown, path: string, issues: ContractIssue[]): value is AppearanceSpecification {
  if (!exactKeys(value, ['version', 'physicalIdentity', 'silhouette', 'attire', 'distinguishingFeatures', 'palette', 'renderingTemplateKey'], path, issues)) return false;
  if (value.version !== 'npc-sheet-v1') issue(issues, `${path}.version`, 'appearance_version', 'Appearance must use the pinned NPC sheet version.');
  for (const key of ['physicalIdentity', 'silhouette', 'attire', 'renderingTemplateKey'] as const) string(value[key], `${path}.${key}`, issues);
  for (const key of ['distinguishingFeatures', 'palette'] as const) if (!Array.isArray(value[key]) || value[key].length === 0 || !value[key].every((entry) => typeof entry === 'string' && entry.trim())) issue(issues, `${path}.${key}`, 'appearance_shape', 'Appearance lists require authored text.');
  return true;
}

function validateDefinition(value: unknown, residentKey: PilotResidentKey, path: string, issues: ContractIssue[]): value is PilotResidentDefinition {
  if (!exactKeys(value, ['key', 'definitionVersion', 'sourceIdentity', 'personalitySchema', 'initialProfile', 'capabilityEnvelope', 'appearanceSource', 'appearanceSpec'], path, issues)) return false;
  if (value.key !== residentKey) issue(issues, `${path}.key`, 'resident_key', 'Resident keys must match their authored map key.');
  if (value.definitionVersion !== PILOT_RESIDENT_DEFINITION_VERSION) issue(issues, `${path}.definitionVersion`, 'definition_version', 'Use the active pilot resident definition version.');
  if (exactKeys(value.sourceIdentity, ['npcId', 'npcVersionId', 'npcKey'], `${path}.sourceIdentity`, issues)) {
    const source = value.sourceIdentity;
    for (const field of ['npcId', 'npcVersionId', 'npcKey'] as const) string(source[field], `${path}.sourceIdentity.${field}`, issues);
    const expected = EXPECTED_SOURCES[residentKey];
    if (!uuid.test(String(source.npcId)) || !uuid.test(String(source.npcVersionId)) || source.npcId !== expected.npcId || source.npcVersionId !== expected.npcVersionId || source.npcKey !== expected.npcKey) issue(issues, `${path}.sourceIdentity`, 'source_identity', 'Resident definitions must pin the current immutable first-party NPC identity and version.');
  }
  const schemaOk = validateSchemaShape(value.personalitySchema, `${path}.personalitySchema`, issues);
  const profileOk = validateProfileShape(value.initialProfile, `${path}.initialProfile`, issues);
  const schema = schemaOk ? value.personalitySchema as PersonalitySchema : undefined;
  const profile = profileOk ? value.initialProfile as PersonalityProfile : undefined;
  validateCapability(value.capabilityEnvelope, residentKey, `${path}.capabilityEnvelope`, issues);
  if (exactKeys(value.appearanceSource, ['npcVersionId', 'schemaVersion'], `${path}.appearanceSource`, issues)) {
    if (value.appearanceSource.npcVersionId !== EXPECTED_SOURCES[residentKey].npcVersionId || value.appearanceSource.schemaVersion !== 'npc-sheet-v1') issue(issues, `${path}.appearanceSource`, 'appearance_source', 'Appearance must pin the same immutable NPC sheet version.');
  }
  validateAppearance(value.appearanceSpec, `${path}.appearanceSpec`, issues);
  if (schema) {
    issues.push(...validatePersonalitySchema(schema).map((entry) => ({ ...entry, path: `${path}.personalitySchema.${entry.path}` })));
    const actualCollections = schema.collections.map((collection) => [collection.kind, collection.maximumEntries]);
    if (JSON.stringify(actualCollections) !== JSON.stringify(expectedCollections)) issue(issues, `${path}.personalitySchema.collections`, 'collection_contract', 'Pilot collection caps are fixed by the E1 contract.');
  }
  if (schema && profile) issues.push(...validatePersonalityProfile(profile, schema).map((entry) => ({ ...entry, path: `${path}.initialProfile.${entry.path}` })));
  return schemaOk && profileOk;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value as Readonly<T>;
}

export function parsePilotResidentDefinitions(value: unknown): PilotResidentDefinitionsParseResult {
  const issues: ContractIssue[] = [];
  if (!exactKeys(value, ['version', 'residents'], '', issues)) return { ok: false, issues };
  if (value.version !== PILOT_RESIDENTS_VERSION) issue(issues, 'version', 'version', 'Use pilot-residents-v1.');
  if (!exactKeys(value.residents, ['lira', 'torvin'], 'residents', issues)) return { ok: false, issues };
  validateDefinition(value.residents.lira, 'lira', 'residents.lira', issues);
  validateDefinition(value.residents.torvin, 'torvin', 'residents.torvin', issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: deepFreeze(structuredClone(value.residents as Record<PilotResidentKey, PilotResidentDefinition>)) };
}

const parsedPilotResidents = parsePilotResidentDefinitions(pilotResidentsJson);
if (!parsedPilotResidents.ok) throw new Error(`Invalid bundled pilot residents: ${parsedPilotResidents.issues.map((entry) => `${entry.path}:${entry.code}`).join(', ')}`);
export const pilotResidentDefinitions = parsedPilotResidents.value;
