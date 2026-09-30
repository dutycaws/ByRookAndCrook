import primitiveRegistryJson from '../../../../supabase/content/evolving-world/primitive-registry-v1.json';
import {
  SOCIAL_AXES,
  WORLD_ENTITY_KINDS,
  type SocialCapability,
  type WorldEffectKind,
  type WorldEntityKind
} from './contracts';

export const PRIMITIVE_REGISTRY_VERSION = 'primitive-registry-v1' as const;

export interface RegistryIssue {
  path: string;
  code: string;
  message: string;
}

export interface PrimitiveRegistry {
  version: typeof PRIMITIVE_REGISTRY_VERSION;
  worldBudgets: {
    deepNpcs: number;
    supportingActors: number;
    activeLocations: number;
    activeGeneratedEntities: number;
  };
  entityKindAliases: Record<string, WorldEntityKind>;
  entitySchemas: Array<{ key: string; fields: Array<{ key: string; type: 'text' | 'integer' | 'boolean' | 'record' | 'list' | 'reference'; required: boolean }> }>;
  entityArchetypes: Array<{ key: string; kind: WorldEntityKind; schemaKey: string }>;
  quest: { actions: string[]; approaches: string[] };
  worldEffects: Array<{
    kind: WorldEffectKind;
    targetKinds: WorldEntityKind[];
    bounds: { min: number; max: number };
    irreversible: boolean;
  }>;
  socialCapabilities: Array<{ key: SocialCapability; description: string }>;
  npcArchetypes: Array<{ key: string; capabilities: SocialCapability[] }>;
  locationModifiers: string[];
  economyModifiers: string[];
  itemComponents: string[];
  recipeComponents: string[];
  encounterTemplates: string[];
  worldEventTemplates: string[];
  renderingTemplates: string[];
  artDirection: { key: string; description: string };
}

const effectKinds = [
  'adjust_relationship', 'create_quest', 'update_quest', 'create_entity', 'retire_entity',
  'record_world_event', 'apply_location_modifier', 'transfer_inventory', 'unlock_recipe',
  'apply_economy_modifier', 'set_availability'
] as const satisfies readonly WorldEffectKind[];
const socialCapabilities = ['conceal', 'misdirect', 'deceive', 'share_gossip'] as const satisfies readonly SocialCapability[];
const fieldTypes = ['text', 'integer', 'boolean', 'record', 'list', 'reference'] as const;
const expectedEffects: Readonly<Record<WorldEffectKind, { targetKinds: readonly WorldEntityKind[]; min: number; max: number; irreversible: boolean }>> = {
  adjust_relationship: { targetKinds: ['npc', 'faction'], min: -25, max: 25, irreversible: false },
  create_quest: { targetKinds: ['npc', 'location', 'faction', 'item'], min: 1, max: 3, irreversible: false },
  update_quest: { targetKinds: ['npc', 'location', 'faction', 'item'], min: 1, max: 3, irreversible: false },
  create_entity: { targetKinds: ['npc', 'location', 'faction', 'item', 'recipe', 'world_event'], min: 1, max: 1, irreversible: false },
  retire_entity: { targetKinds: ['npc', 'location', 'faction', 'item', 'recipe', 'world_event'], min: 1, max: 1, irreversible: true },
  record_world_event: { targetKinds: ['npc', 'location', 'faction', 'item', 'world_event'], min: 1, max: 8, irreversible: false },
  apply_location_modifier: { targetKinds: ['location'], min: -3, max: 3, irreversible: false },
  transfer_inventory: { targetKinds: ['npc', 'faction', 'item'], min: 1, max: 99, irreversible: false },
  unlock_recipe: { targetKinds: ['recipe'], min: 1, max: 1, irreversible: false },
  apply_economy_modifier: { targetKinds: ['location', 'faction', 'item'], min: -3, max: 3, irreversible: false },
  set_availability: { targetKinds: ['npc'], min: 0, max: 1, irreversible: false }
};
const forbiddenKeys = /(?:^|_)(?:sql|query|route|url|endpoint|code|function|handler|script|executable)(?:$|_)/i;
const keyPattern = /^[a-z][a-z0-9-]*$/;

function issue(issues: RegistryIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function string(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function listOfStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(string);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string, issues: RegistryIssue[]): void {
  for (const key of Object.keys(value)) {
    if (forbiddenKeys.test(key)) issue(issues, `${path}.${key}`, 'forbidden_field', 'Registry data cannot contain executable, SQL, route, or code fields.');
    else if (!keys.includes(key)) issue(issues, `${path}.${key}`, 'unknown_field', 'Registry data contains an unknown field.');
  }
  for (const key of keys) if (!(key in value)) issue(issues, `${path}.${key}`, 'required_field', 'Registry data is missing a required field.');
}

function unique(values: readonly string[], path: string, issues: RegistryIssue[], pattern = keyPattern): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (!pattern.test(value)) issue(issues, `${path}.${index}`, 'key_format', 'Registry keys must use the expected stable format.');
    if (seen.has(value)) issue(issues, `${path}.${index}`, 'duplicate_key', 'Registry keys must be unique.');
    seen.add(value);
  });
}

function scanForbidden(value: unknown, path: string, issues: RegistryIssue[]): void {
  if (Array.isArray(value)) value.forEach((entry, index) => scanForbidden(entry, `${path}.${index}`, issues));
  else if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (forbiddenKeys.test(key)) issue(issues, `${path}.${key}`, 'forbidden_field', 'Registry data cannot contain executable, SQL, route, or code fields.');
      scanForbidden(entry, `${path}.${key}`, issues);
    }
  }
}

export function validatePrimitiveRegistry(value: unknown): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  if (!isObject(value)) return [{ path: '', code: 'registry_type', message: 'The primitive registry must be an object.' }];
  scanForbidden(value, '', issues);
  exactKeys(value, ['version', 'worldBudgets', 'entityKindAliases', 'entitySchemas', 'entityArchetypes', 'quest', 'worldEffects', 'socialCapabilities', 'npcArchetypes', 'locationModifiers', 'economyModifiers', 'itemComponents', 'recipeComponents', 'encounterTemplates', 'worldEventTemplates', 'renderingTemplates', 'artDirection'], '', issues);
  if (value.version !== PRIMITIVE_REGISTRY_VERSION) issue(issues, 'version', 'version', `Use ${PRIMITIVE_REGISTRY_VERSION}.`);

  const budgets = value.worldBudgets;
  if (!isObject(budgets)) issue(issues, 'worldBudgets', 'type', 'World budgets must be an object.');
  else {
    exactKeys(budgets, ['deepNpcs', 'supportingActors', 'activeLocations', 'activeGeneratedEntities'], 'worldBudgets', issues);
    const required = { deepNpcs: 8, supportingActors: 40, activeLocations: 8, activeGeneratedEntities: 150 } as const;
    for (const [key, expected] of Object.entries(required)) if (budgets[key] !== expected) issue(issues, `worldBudgets.${key}`, 'budget', `This initial registry fixes ${key} at ${expected}.`);
  }

  const aliases = value.entityKindAliases;
  if (!isObject(aliases) || aliases.place !== 'location' || Object.keys(aliases).length !== 1) issue(issues, 'entityKindAliases', 'alias', 'Only the legacy place → location import alias is supported.');

  const schemas = value.entitySchemas;
  const schemaKeys = new Set<string>();
  if (!Array.isArray(schemas)) issue(issues, 'entitySchemas', 'type', 'Entity schemas must be an array.');
  else schemas.forEach((entry, index) => {
    const path = `entitySchemas.${index}`;
    if (!isObject(entry)) return issue(issues, path, 'type', 'An entity schema must be an object.');
    exactKeys(entry, ['key', 'fields'], path, issues);
    if (!string(entry.key) || !keyPattern.test(entry.key)) issue(issues, `${path}.key`, 'key_format', 'An entity schema needs a stable key.');
    else if (schemaKeys.has(entry.key)) issue(issues, `${path}.key`, 'duplicate_key', 'Entity schema keys must be unique.'); else schemaKeys.add(entry.key);
    if (!Array.isArray(entry.fields) || entry.fields.length === 0) return issue(issues, `${path}.fields`, 'schema_fields', 'Entity schemas require typed fields.');
    const fieldKeys: string[] = [];
    entry.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${path}.fields.${fieldIndex}`;
      if (!isObject(field)) return issue(issues, fieldPath, 'type', 'A schema field must be an object.');
      exactKeys(field, ['key', 'type', 'required'], fieldPath, issues);
      if (!string(field.key)) issue(issues, `${fieldPath}.key`, 'key_format', 'A schema field needs a key.'); else fieldKeys.push(field.key);
      if (!fieldTypes.includes(field.type as (typeof fieldTypes)[number])) issue(issues, `${fieldPath}.type`, 'field_type', 'Use a supported schema field type.');
      if (typeof field.required !== 'boolean') issue(issues, `${fieldPath}.required`, 'field_required', 'Schema fields must declare requiredness.');
    });
    unique(fieldKeys, `${path}.fields`, issues, /^[a-z][A-Za-z0-9]*$/);
  });

  const archetypes = value.entityArchetypes;
  if (!Array.isArray(archetypes)) issue(issues, 'entityArchetypes', 'type', 'Entity archetypes must be an array.');
  else {
    const keys: string[] = [];
    const represented = new Set<string>();
    archetypes.forEach((entry, index) => {
      const path = `entityArchetypes.${index}`;
      if (!isObject(entry)) return issue(issues, path, 'type', 'An entity archetype must be an object.');
      exactKeys(entry, ['key', 'kind', 'schemaKey'], path, issues);
      if (!string(entry.key)) issue(issues, `${path}.key`, 'key_format', 'An archetype needs a key.'); else keys.push(entry.key);
      if (!WORLD_ENTITY_KINDS.includes(entry.kind as WorldEntityKind)) issue(issues, `${path}.kind`, 'entity_kind', 'Use a supported entity kind.'); else represented.add(entry.kind as string);
      if (!string(entry.schemaKey) || !schemaKeys.has(entry.schemaKey)) issue(issues, `${path}.schemaKey`, 'schema_reference', 'Archetypes must reference a known entity schema.');
    });
    unique(keys, 'entityArchetypes', issues);
    for (const kind of WORLD_ENTITY_KINDS) if (!represented.has(kind)) issue(issues, 'entityArchetypes', 'missing_kind', `Add an archetype for ${kind}.`);
  }

  const quest = value.quest;
  if (!isObject(quest)) issue(issues, 'quest', 'type', 'Quest primitives must be an object.');
  else {
    exactKeys(quest, ['actions', 'approaches'], 'quest', issues);
    if (!Array.isArray(quest.actions) || quest.actions.join('|') !== 'prepare|attempt|wait|abandon') issue(issues, 'quest.actions', 'quest_actions', 'Quest actions must preserve the existing action vocabulary.');
    if (!Array.isArray(quest.approaches) || quest.approaches.join('|') !== 'scouting|combat|diplomacy|trade') issue(issues, 'quest.approaches', 'quest_approaches', 'Quest approaches must preserve the existing approach vocabulary.');
  }

  const effects = value.worldEffects;
  if (!Array.isArray(effects)) issue(issues, 'worldEffects', 'type', 'World effects must be an array.');
  else {
    const kinds: string[] = [];
    effects.forEach((entry, index) => {
      const path = `worldEffects.${index}`;
      if (!isObject(entry)) return issue(issues, path, 'type', 'A world effect must be an object.');
      exactKeys(entry, ['kind', 'targetKinds', 'bounds', 'irreversible'], path, issues);
      if (!effectKinds.includes(entry.kind as WorldEffectKind)) issue(issues, `${path}.kind`, 'effect_kind', 'Use a supported effect kind.'); else kinds.push(entry.kind as string);
      if (!Array.isArray(entry.targetKinds) || entry.targetKinds.length === 0 || !entry.targetKinds.every((kind) => WORLD_ENTITY_KINDS.includes(kind as WorldEntityKind))) issue(issues, `${path}.targetKinds`, 'effect_target_kind', 'Effects must name supported target kinds.');
      if (!isObject(entry.bounds)) issue(issues, `${path}.bounds`, 'effect_bounds', 'Effects must define ordered integer bounds.');
      else {
        exactKeys(entry.bounds, ['min', 'max'], `${path}.bounds`, issues);
        if (!Number.isInteger(entry.bounds.min) || !Number.isInteger(entry.bounds.max) || (entry.bounds.min as number) > (entry.bounds.max as number)) issue(issues, `${path}.bounds`, 'effect_bounds', 'Effects must define ordered integer bounds.');
      }
      if (typeof entry.irreversible !== 'boolean') issue(issues, `${path}.irreversible`, 'irreversible', 'Effects must declare whether they are irreversible.');
      const expected = expectedEffects[entry.kind as WorldEffectKind];
      if (expected && (entry.targetKinds as unknown[]).join('|') !== expected.targetKinds.join('|')) issue(issues, `${path}.targetKinds`, 'effect_metadata', 'Effect target kinds must match the versioned registry contract.');
      if (expected && isObject(entry.bounds) && (entry.bounds.min !== expected.min || entry.bounds.max !== expected.max || entry.irreversible !== expected.irreversible)) issue(issues, path, 'effect_metadata', 'Effect bounds and irreversible metadata must match the versioned registry contract.');
    });
    unique(kinds, 'worldEffects', issues, /^[a-z][a-z0-9_]*$/);
    for (const kind of effectKinds) if (!kinds.includes(kind)) issue(issues, 'worldEffects', 'missing_effect', `Add metadata for ${kind}.`);
  }

  const capabilityKeys = new Set<string>();
  const capabilityRegistry = value.socialCapabilities;
  if (!Array.isArray(capabilityRegistry)) issue(issues, 'socialCapabilities', 'type', 'Social capabilities must be an array.');
  else {
    capabilityRegistry.forEach((entry, index) => {
      const path = `socialCapabilities.${index}`;
      if (!isObject(entry)) return issue(issues, path, 'type', 'A social capability must be an object.');
      exactKeys(entry, ['key', 'description'], path, issues);
      if (!socialCapabilities.includes(entry.key as SocialCapability)) issue(issues, `${path}.key`, 'social_capability', 'Use a supported social capability key.');
      else if (capabilityKeys.has(entry.key as string)) issue(issues, `${path}.key`, 'duplicate_key', 'Social capability keys must be unique.'); else capabilityKeys.add(entry.key as string);
      if (!string(entry.description)) issue(issues, `${path}.description`, 'description', 'Social capabilities need an authored description.');
    });
    for (const key of socialCapabilities) if (!capabilityKeys.has(key)) issue(issues, 'socialCapabilities', 'missing_capability', `Add ${key} to the authored social capability registry.`);
  }
  const npcArchetypes = value.npcArchetypes;
  if (!Array.isArray(npcArchetypes)) issue(issues, 'npcArchetypes', 'type', 'NPC archetypes must be an array.');
  else {
    const keys: string[] = [];
    npcArchetypes.forEach((entry, index) => {
      const path = `npcArchetypes.${index}`;
      if (!isObject(entry)) return issue(issues, path, 'type', 'An NPC archetype must be an object.');
      exactKeys(entry, ['key', 'capabilities'], path, issues);
      if (!string(entry.key)) issue(issues, `${path}.key`, 'key_format', 'An NPC archetype needs a key.'); else keys.push(entry.key);
      if (!Array.isArray(entry.capabilities) || !entry.capabilities.every((capability) => capabilityKeys.has(capability as string))) issue(issues, `${path}.capabilities`, 'social_capability', 'NPC archetypes may only name authored social capabilities.');
    });
    unique(keys, 'npcArchetypes', issues);
  }

  for (const field of ['locationModifiers', 'economyModifiers', 'itemComponents', 'recipeComponents', 'encounterTemplates', 'worldEventTemplates', 'renderingTemplates'] as const) {
    if (!listOfStrings(value[field])) issue(issues, field, 'string_list', `${field} must be a non-empty string list.`);
    else unique(value[field] as string[], field, issues);
  }
  if (Array.isArray(value.recipeComponents) && !value.recipeComponents.includes('herb-loaf')) issue(issues, 'recipeComponents', 'legacy_recipe', 'The registry must retain the herb-loaf reference.');
  const artDirection = value.artDirection;
  if (!isObject(artDirection)) issue(issues, 'artDirection', 'type', 'Art direction must be an object.');
  else {
    exactKeys(artDirection, ['key', 'description'], 'artDirection', issues);
    if (!string(artDirection.key) || !string(artDirection.description)) issue(issues, 'artDirection', 'art_direction', 'Art direction needs a key and description.');
  }
  return issues;
}

export type PrimitiveRegistryParseResult = { ok: true; value: PrimitiveRegistry } | { ok: false; issues: RegistryIssue[] };

function normalizedPrimitiveRegistry(value: Record<string, unknown>): PrimitiveRegistry {
  const budgets = value.worldBudgets as Record<string, unknown>;
  const aliases = value.entityKindAliases as Record<string, unknown>;
  const schemas = value.entitySchemas as Array<Record<string, unknown>>;
  const archetypes = value.entityArchetypes as Array<Record<string, unknown>>;
  const quest = value.quest as Record<string, unknown>;
  const effects = value.worldEffects as Array<Record<string, unknown>>;
  const capabilities = value.socialCapabilities as Array<Record<string, unknown>>;
  const npcArchetypes = value.npcArchetypes as Array<Record<string, unknown>>;
  const strings = (field: string) => [...(value[field] as string[])];
  return {
    version: PRIMITIVE_REGISTRY_VERSION,
    worldBudgets: {
      deepNpcs: budgets.deepNpcs as number,
      supportingActors: budgets.supportingActors as number,
      activeLocations: budgets.activeLocations as number,
      activeGeneratedEntities: budgets.activeGeneratedEntities as number
    },
    entityKindAliases: Object.fromEntries(Object.entries(aliases).map(([key, entry]) => [key, entry as WorldEntityKind])),
    entitySchemas: schemas.map((schema) => ({
      key: schema.key as string,
      fields: (schema.fields as Array<Record<string, unknown>>).map((field) => ({
        key: field.key as string,
        type: field.type as PrimitiveRegistry['entitySchemas'][number]['fields'][number]['type'],
        required: field.required as boolean
      }))
    })),
    entityArchetypes: archetypes.map((archetype) => ({ key: archetype.key as string, kind: archetype.kind as WorldEntityKind, schemaKey: archetype.schemaKey as string })),
    quest: { actions: [...(quest.actions as string[])], approaches: [...(quest.approaches as string[])] },
    worldEffects: effects.map((effect) => {
      const bounds = effect.bounds as Record<string, unknown>;
      return {
        kind: effect.kind as WorldEffectKind,
        targetKinds: [...(effect.targetKinds as WorldEntityKind[])],
        bounds: { min: bounds.min as number, max: bounds.max as number },
        irreversible: effect.irreversible as boolean
      };
    }),
    socialCapabilities: capabilities.map((capability) => ({ key: capability.key as SocialCapability, description: capability.description as string })),
    npcArchetypes: npcArchetypes.map((archetype) => ({ key: archetype.key as string, capabilities: [...(archetype.capabilities as SocialCapability[])] })),
    locationModifiers: strings('locationModifiers'),
    economyModifiers: strings('economyModifiers'),
    itemComponents: strings('itemComponents'),
    recipeComponents: strings('recipeComponents'),
    encounterTemplates: strings('encounterTemplates'),
    worldEventTemplates: strings('worldEventTemplates'),
    renderingTemplates: strings('renderingTemplates'),
    artDirection: {
      key: (value.artDirection as Record<string, unknown>).key as string,
      description: (value.artDirection as Record<string, unknown>).description as string
    }
  };
}

export function parsePrimitiveRegistry(value: unknown): PrimitiveRegistryParseResult {
  const issues = validatePrimitiveRegistry(value);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: normalizedPrimitiveRegistry(value as Record<string, unknown>) };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value as Readonly<T>;
}

const parsedRegistry = parsePrimitiveRegistry(primitiveRegistryJson);
if (!parsedRegistry.ok) throw new Error(`Invalid bundled primitive registry: ${parsedRegistry.issues.map((entry) => `${entry.path}:${entry.code}`).join(', ')}`);
export const primitiveRegistry = deepFreeze(structuredClone(parsedRegistry.value));

export function normalizeWorldEntityKind(value: string): WorldEntityKind | undefined {
  const normalized = primitiveRegistry.entityKindAliases[value] ?? value;
  return WORLD_ENTITY_KINDS.includes(normalized as WorldEntityKind) ? normalized as WorldEntityKind : undefined;
}

export function getWorldEffectDefinition(kind: WorldEffectKind) {
  return primitiveRegistry.worldEffects.find((effect) => effect.kind === kind);
}

export function getEntityArchetype(key: string) {
  return primitiveRegistry.entityArchetypes.find((archetype) => archetype.key === key);
}

export function hasSocialAxis(axis: string): axis is (typeof SOCIAL_AXES)[number] {
  return SOCIAL_AXES.includes(axis as (typeof SOCIAL_AXES)[number]);
}
