import { primitiveRegistry } from './registry';
import { WORLD_ENTITY_KINDS, type CapabilityEnvelope, type ContractIssue, type SocialCapability, type WorldEffectKind, type WorldEntityKind } from './contracts';

/** The finite command language committed by the server-only procedural seam. */
export const PROCEDURAL_WORLD_VERSION = 'procedural-world-v1' as const;
export type ProceduralWorldOperation = 'entity' | 'quest' | 'public_event' | 'gameplay_unlock';

export type ProceduralWorldCommand =
  | { operation: 'entity'; effectKind: 'create_entity'; sourceResidentId: string; entityKind: WorldEntityKind; entityKey: string; archetypeKey: string; proposedName: string; payload: Record<string, unknown> }
  | { operation: 'quest'; effectKind: 'create_quest' | 'update_quest'; ownerResidentId: string; primitiveKey: string; action: string; approach: string; targetEntityRefs: string[]; motivation: string }
  | { operation: 'public_event'; effectKind: 'record_world_event'; sourceResidentId: string; templateKey: string; participantEntityRefs: string[]; title: string; summary: string; reuseKey: string }
  | { operation: 'gameplay_unlock'; effectKind: 'unlock_gameplay'; sourceResidentId: string; entityRef: string; family: 'herb_loaf_variant'; definition: { displayName: string } }
  | { operation: 'gameplay_unlock'; effectKind: 'unlock_gameplay'; sourceResidentId: string; entityRef: string; family: 'successor_provisions'; definition: { displayName: string; price: number; dailyStock: number } };

export interface ProceduralWorldProposal {
  version: typeof PROCEDURAL_WORLD_VERSION;
  commands: ProceduralWorldCommand[];
}

export interface ProceduralWorldValidationContext {
  entityKinds: Readonly<Record<string, WorldEntityKind>>;
  activeGeneratedEntityCount: number;
  activeQuestByResident: Readonly<Record<string, { id: string; primitiveKey: string }>>;
  capabilities: Readonly<Record<string, CapabilityEnvelope>>;
}

/** This is the exact five-field server snapshot queued by migration 051. */
export interface FrozenProceduralWorldContext extends ProceduralWorldValidationContext {
  version: typeof PROCEDURAL_WORLD_VERSION;
}

export const PROCEDURAL_WORLD_CRITIC_CODES = ['proposal_shape','command_shape','entity_registry','quest_capability','event_registry','gameplay_unlock','budget'] as const;
export type ProceduralWorldCriticCode = (typeof PROCEDURAL_WORLD_CRITIC_CODES)[number];
export const PROCEDURAL_WORLD_CRITIC_PATHS = ['commands','commands.entity','commands.quest','commands.public_event','commands.gameplay_unlock'] as const;
export type ProceduralWorldCriticPath = (typeof PROCEDURAL_WORLD_CRITIC_PATHS)[number];
export type ProceduralWorldCriticInstruction = { code: ProceduralWorldCriticCode; path: ProceduralWorldCriticPath };
export type ProceduralWorldCriticDecision =
  | { decision:'accept' | 'reject'; instructions:[] }
  | { decision:'repair'; instructions:ProceduralWorldCriticInstruction[] };

export type ProceduralWorldParseResult = { ok: true; value: ProceduralWorldProposal } | { ok: false; issues: ContractIssue[] };
const keyPattern = /^[a-z][a-z0-9_-]{1,79}$/;
const publicKeyPattern = /^[a-z][a-z0-9-]{1,63}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const forbidden = /(?:^|_)(?:sql|query|route|url|endpoint|code|function|handler|script|executable)(?:$|_)/i;
const aliases: Record<string, WorldEntityKind> = { ...primitiveRegistry.entityKindAliases };
const socialCapabilities = new Set<SocialCapability>(['conceal','misdirect','deceive','share_gossip']);
const worldEffects = new Set<WorldEffectKind>(['adjust_relationship','create_quest','update_quest','create_entity','retire_entity','record_world_event','apply_location_modifier','transfer_inventory','unlock_recipe','apply_economy_modifier','set_availability']);

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => key in value) && Object.keys(value).every((key) => keys.includes(key));
}
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max; }
function issue(path: string, code: string, message: string): ContractIssue[] { return [{ path, code, message }]; }
function normalizeKey(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function normalizedKind(value: string): WorldEntityKind | null {
  const normalized = aliases[value.trim().toLowerCase()] ?? value.trim().toLowerCase();
  return primitiveRegistry.entityArchetypes.some((entry) => entry.kind === normalized) ? normalized as WorldEntityKind : null;
}
function safePayload(value: unknown): value is Record<string, unknown> {
  if (!object(value)) return false;
  try { if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 2048) return false; } catch { return false; }
  return Object.entries(value).every(([key, entry]) => !forbidden.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key) && safeValue(entry, 1));
}
function safeValue(value: unknown, depth: number): boolean {
  if (depth > 3 || value === null || ['string', 'number', 'boolean'].includes(typeof value)) return depth <= 3;
  if (Array.isArray(value)) return value.length <= 16 && value.every((entry) => safeValue(entry, depth + 1));
  return object(value) && Object.keys(value).length <= 16 && Object.entries(value).every(([key, entry]) => !forbidden.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key) && safeValue(entry, depth + 1));
}
function resolveReference(reference: string, context: ProceduralWorldValidationContext): { id: string; kind: WorldEntityKind } | null {
  if (context.entityKinds[reference]) return { id: reference, kind: context.entityKinds[reference] };
  const normalized = normalizeKey(reference);
  const id = Object.keys(context.entityKinds).find((candidate) => candidate === normalized);
  return id ? { id, kind: context.entityKinds[id] } : null;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function capability(value: unknown): value is CapabilityEnvelope {
  if (!object(value) || !exact(value, ['version','allowedActions','allowedApproaches','allowedWorldEffects','allowedTargetKinds','socialCapabilities','irreversibleEffects']) || !text(value.version, 128)
    || !Array.isArray(value.allowedActions) || !Array.isArray(value.allowedApproaches) || !Array.isArray(value.allowedWorldEffects) || !Array.isArray(value.allowedTargetKinds) || !Array.isArray(value.socialCapabilities) || !Array.isArray(value.irreversibleEffects)
    || value.allowedActions.length > 32 || value.allowedApproaches.length > 32 || value.allowedWorldEffects.length > 16 || value.allowedTargetKinds.length > WORLD_ENTITY_KINDS.length || value.socialCapabilities.length > 4 || value.irreversibleEffects.length > 8
    || !value.allowedActions.every((entry) => text(entry, 40)) || !value.allowedApproaches.every((entry) => text(entry, 40))
    || !value.allowedWorldEffects.every((entry) => worldEffects.has(entry as WorldEffectKind)) || !value.allowedTargetKinds.every((entry) => WORLD_ENTITY_KINDS.includes(entry as WorldEntityKind)) || !value.socialCapabilities.every((entry) => socialCapabilities.has(entry as SocialCapability))) return false;
  return value.irreversibleEffects.every((entry) => object(entry) && exact(entry, ['effectKey','targetKinds']) && text(entry.effectKey, 80) && Array.isArray(entry.targetKinds) && entry.targetKinds.length > 0 && entry.targetKinds.length <= WORLD_ENTITY_KINDS.length && entry.targetKinds.every((kind) => WORLD_ENTITY_KINDS.includes(kind as WorldEntityKind)));
}

/** Parse the queued DB JSON before it can reach a model or validate model output. */
export function parseFrozenProceduralWorldContext(value: unknown): FrozenProceduralWorldContext | null {
  const activeGeneratedEntityCount=object(value) ? value.activeGeneratedEntityCount : undefined;
  if (!object(value) || !exact(value, ['version','entityKinds','activeGeneratedEntityCount','activeQuestByResident','capabilities']) || value.version !== PROCEDURAL_WORLD_VERSION
    || !object(value.entityKinds) || typeof activeGeneratedEntityCount !== 'number' || !Number.isSafeInteger(activeGeneratedEntityCount) || activeGeneratedEntityCount < 0 || activeGeneratedEntityCount > primitiveRegistry.worldBudgets.activeGeneratedEntities
    || !object(value.activeQuestByResident) || !object(value.capabilities)) return null;
  try { if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 16_384) return null; } catch { return null; }
  const entityEntries=Object.entries(value.entityKinds); const questEntries=Object.entries(value.activeQuestByResident); const capabilityEntries=Object.entries(value.capabilities);
  if (entityEntries.length > 512 || questEntries.length > 128 || capabilityEntries.length > 128
    || !entityEntries.every(([id, kind]) => text(id, 128) && WORLD_ENTITY_KINDS.includes(kind as WorldEntityKind))
    || !questEntries.every(([residentId, quest]) => uuidPattern.test(residentId) && object(quest) && exact(quest, ['id','primitiveKey']) && uuidPattern.test(String(quest.id)) && text(quest.primitiveKey, 80))
    || !capabilityEntries.every(([residentId, entry]) => uuidPattern.test(residentId) && capability(entry))) return null;
  return {
    version:PROCEDURAL_WORLD_VERSION,
    entityKinds:Object.fromEntries(entityEntries) as Record<string, WorldEntityKind>,
    activeGeneratedEntityCount,
    activeQuestByResident:Object.fromEntries(questEntries.map(([residentId, quest]) => [residentId, {id:(quest as Record<string, unknown>).id as string,primitiveKey:(quest as Record<string, unknown>).primitiveKey as string}])),
    capabilities:Object.fromEntries(capabilityEntries.map(([residentId, entry]) => [residentId, {...entry as CapabilityEnvelope, allowedActions:[...(entry as CapabilityEnvelope).allowedActions], allowedApproaches:[...(entry as CapabilityEnvelope).allowedApproaches], allowedWorldEffects:[...(entry as CapabilityEnvelope).allowedWorldEffects], allowedTargetKinds:[...(entry as CapabilityEnvelope).allowedTargetKinds], socialCapabilities:[...(entry as CapabilityEnvelope).socialCapabilities], irreversibleEffects:(entry as CapabilityEnvelope).irreversibleEffects.map((effect) => ({...effect,targetKinds:[...effect.targetKinds]}))}]))
  };
}

export function parseProceduralWorldCriticDecision(value: unknown): ProceduralWorldCriticDecision | null {
  if (!object(value) || !exact(value, ['decision','instructions']) || !['accept','reject','repair'].includes(String(value.decision)) || !Array.isArray(value.instructions)) return null;
  if ((value.decision === 'accept' || value.decision === 'reject') && value.instructions.length !== 0) return null;
  if (value.decision === 'repair' && (value.instructions.length < 1 || value.instructions.length > 4)) return null;
  const instructions:ProceduralWorldCriticInstruction[]=[];
  for (const instruction of value.instructions) {
    if (!object(instruction) || !exact(instruction, ['code','path']) || !PROCEDURAL_WORLD_CRITIC_CODES.includes(instruction.code as ProceduralWorldCriticCode) || !PROCEDURAL_WORLD_CRITIC_PATHS.includes(instruction.path as ProceduralWorldCriticPath)) return null;
    instructions.push({code:instruction.code as ProceduralWorldCriticCode,path:instruction.path as ProceduralWorldCriticPath});
  }
  if (new Set(instructions.map((instruction) => `${instruction.code}:${instruction.path}`)).size !== instructions.length) return null;
  return value.decision === 'repair' ? {decision:'repair',instructions} : {decision:value.decision as 'accept'|'reject',instructions:[]};
}

/** Validates only finite commands and frozen context; it cannot create arbitrary actions. */
export function validateProceduralWorldProposal(value: unknown, context: ProceduralWorldValidationContext): ContractIssue[] {
  if (!object(value) || !exact(value, ['version', 'commands']) || value.version !== PROCEDURAL_WORLD_VERSION || !Array.isArray(value.commands) || value.commands.length < 1 || value.commands.length > 8) return issue('', 'proposal_shape', 'A procedural proposal must use the bounded versioned command envelope.');
  if (!Number.isSafeInteger(context.activeGeneratedEntityCount) || context.activeGeneratedEntityCount < 0 || context.activeGeneratedEntityCount > primitiveRegistry.worldBudgets.activeGeneratedEntities) return issue('activeGeneratedEntityCount', 'budget', 'The frozen generated-entity count is invalid.');
  let plannedCanonicalEntities = 0;
  const plannedCanonicalKeys = new Set<string>();
  for (const [index, command] of value.commands.entries()) {
    const path = `commands.${index}`;
    if (!object(command) || !text(command.operation, 32) || !text(command.effectKind, 32)) return issue(path, 'command_shape', 'Every command needs a finite operation and registered effect kind.');
    if (command.operation === 'entity') {
      if (!exact(command, ['operation','effectKind','sourceResidentId','entityKind','entityKey','archetypeKey','proposedName','payload']) || command.effectKind !== 'create_entity' || !text(command.sourceResidentId, 128) || !uuidPattern.test(command.sourceResidentId) || !text(command.entityKind, 30) || !text(command.entityKey, 120) || !text(command.archetypeKey, 80) || !text(command.proposedName, 120) || !safePayload(command.payload)) return issue(path, 'entity_shape', 'Entity commands require a bounded registered archetype payload and initiating resident.');
      const kind = normalizedKind(command.entityKind as string); const archetype = primitiveRegistry.entityArchetypes.find((entry) => entry.key === normalizeKey(command.archetypeKey as string));
      const capability = context.capabilities[command.sourceResidentId];
      if (!kind || !keyPattern.test(normalizeKey(command.entityKey)) || !archetype || archetype.kind !== kind || !capability || !capability.allowedWorldEffects.includes('create_entity') || !capability.allowedTargetKinds.includes(kind)) return issue(path, 'entity_registry', 'Entity kind, archetype, and initiating capability must be registered.');
      const canonicalKey = `${kind}:${normalizeKey(command.entityKey)}`;
      if (plannedCanonicalKeys.has(canonicalKey)) return issue(path, 'entity_duplicate', 'A proposal cannot define the same new canonical entity more than once.');
      if (context.entityKinds[normalizeKey(command.entityKey)] !== kind) {
        plannedCanonicalKeys.add(canonicalKey); plannedCanonicalEntities += 1;
      }
    } else if (command.operation === 'quest') {
      if (!exact(command, ['operation','effectKind','ownerResidentId','primitiveKey','action','approach','targetEntityRefs','motivation']) || !['create_quest','update_quest'].includes(String(command.effectKind)) || !text(command.ownerResidentId, 128) || !uuidPattern.test(command.ownerResidentId) || !text(command.primitiveKey, 80) || !text(command.action, 40) || !text(command.approach, 40) || !Array.isArray(command.targetEntityRefs) || command.targetEntityRefs.length < 1 || command.targetEntityRefs.length > 3 || !command.targetEntityRefs.every((entry) => text(entry, 128)) || !text(command.motivation, 500)) return issue(path, 'quest_shape', 'Successor quest commands require finite action, approach, and targets.');
      const capability = context.capabilities[command.ownerResidentId];
      const targets = command.targetEntityRefs.map((entry) => resolveReference(entry, context));
      if (!capability || !capability.allowedWorldEffects.includes(command.effectKind as 'create_quest' | 'update_quest') || !capability.allowedActions.includes(command.action) || !capability.allowedApproaches.includes(command.approach) || normalizeKey(command.primitiveKey) !== 'successor-quest' || targets.some((entry) => !entry || !capability.allowedTargetKinds.includes(entry.kind)) || new Set(targets.map((entry) => entry?.id)).size !== targets.length) return issue(path, 'quest_capability', 'The frozen resident capability and registered quest grammar must authorize this quest.');
      const existing = context.activeQuestByResident[command.ownerResidentId];
      if ((existing && (command.effectKind !== 'update_quest' || existing.primitiveKey !== normalizeKey(command.primitiveKey))) || (!existing && (command.effectKind !== 'create_quest' || command.action === 'abandon'))) return issue(path, 'quest_lifecycle', 'A resident has at most one active successor quest and updates must target it.');
    } else if (command.operation === 'public_event') {
      if (!exact(command, ['operation','effectKind','sourceResidentId','templateKey','participantEntityRefs','title','summary','reuseKey']) || command.effectKind !== 'record_world_event' || !text(command.sourceResidentId, 128) || !uuidPattern.test(command.sourceResidentId) || !text(command.templateKey, 80) || !Array.isArray(command.participantEntityRefs) || command.participantEntityRefs.length < 1 || command.participantEntityRefs.length > 8 || !command.participantEntityRefs.every((entry) => text(entry, 128)) || !text(command.title, 120) || !text(command.summary, 500) || !text(command.reuseKey, 64)) return issue(path, 'event_shape', 'Public world events use a bounded registered template, initiating resident, and public projection.');
      const template = normalizeKey(command.templateKey); const allowed = primitiveRegistry.worldEffects.find((entry) => entry.kind === 'record_world_event')!.targetKinds;
      const participants = command.participantEntityRefs.map((entry) => resolveReference(entry, context));
      const capability = context.capabilities[command.sourceResidentId];
      if (!primitiveRegistry.worldEventTemplates.includes(template) || !publicKeyPattern.test(normalizeKey(command.reuseKey)) || !capability || !capability.allowedWorldEffects.includes('record_world_event') || participants.some((entry) => !entry || !allowed.includes(entry.kind) || !capability.allowedTargetKinds.includes(entry.kind)) || new Set(participants.map((entry) => entry?.id)).size !== participants.length) return issue(path, 'event_registry', 'Public event participants, template, and initiating capability must be frozen registered references.');
      const canonicalKey = `world_event:${normalizeKey(command.reuseKey)}`;
      if (plannedCanonicalKeys.has(canonicalKey)) return issue(path, 'event_duplicate', 'A proposal cannot define the same public event more than once.');
      if (context.entityKinds[normalizeKey(command.reuseKey)] !== 'world_event') {
        plannedCanonicalKeys.add(canonicalKey); plannedCanonicalEntities += 1;
      }
    } else if (command.operation === 'gameplay_unlock') {
      if (!exact(command, ['operation','effectKind','sourceResidentId','entityRef','family','definition']) || command.effectKind !== 'unlock_gameplay' || !text(command.sourceResidentId, 128) || !uuidPattern.test(command.sourceResidentId) || !text(command.entityRef, 128)
        || !object(command.definition)) return issue(path, 'gameplay_unlock', 'Gameplay unlocks require an exact registered family and bounded definition.');
      const recipeFamily = command.family === 'herb_loaf_variant'
        && exact(command.definition, ['displayName']) && text(command.definition.displayName, 120);
      const supplyDefinition = command.definition as Record<string, unknown>;
      const supplyFamily = command.family === 'successor_provisions'
        && exact(command.definition, ['displayName','price','dailyStock']) && text(command.definition.displayName, 120)
        && Number.isSafeInteger(supplyDefinition.price) && (supplyDefinition.price as number) >= 1 && (supplyDefinition.price as number) <= 100
        && Number.isSafeInteger(supplyDefinition.dailyStock) && (supplyDefinition.dailyStock as number) >= 1 && (supplyDefinition.dailyStock as number) <= 10;
      if (!recipeFamily && !supplyFamily) return issue(path, 'gameplay_unlock', 'Gameplay unlocks require an exact registered family and bounded definition.');
      const key = normalizeKey(command.entityRef as string);
      const created = value.commands.find((candidate) => object(candidate) && candidate.operation === 'entity' && candidate.sourceResidentId === command.sourceResidentId && normalizeKey(String(candidate.entityKey ?? '')) === key);
      const targetKind = command.family === 'herb_loaf_variant' ? 'recipe' : 'item';
      const target = created && created.entityKind === targetKind ? { id:key, kind:created.entityKind as WorldEntityKind } : null;
      const capability = context.capabilities[command.sourceResidentId as string];
      if (!target || !capability || !capability.allowedWorldEffects.includes('create_entity') || !capability.allowedTargetKinds.includes(target.kind) || target.kind !== targetKind) return issue(path, 'gameplay_unlock', 'Gameplay unlocks must follow a matching canonical entity and frozen initiating capability.');
    } else return issue(path, 'operation', 'The command operation is not in the finite procedural algebra.');
  }
  if (context.activeGeneratedEntityCount + plannedCanonicalEntities > primitiveRegistry.worldBudgets.activeGeneratedEntities) return issue('commands', 'budget', 'New canonical entities would exceed the frozen generated-entity budget.');
  return [];
}

export function parseProceduralWorldProposal(value: unknown, context: ProceduralWorldValidationContext): ProceduralWorldParseResult {
  const issues = validateProceduralWorldProposal(value, context);
  if (issues.length) return { ok: false, issues };
  const proposal = value as { commands: Array<Record<string, unknown>> };
  return { ok: true, value: { version: PROCEDURAL_WORLD_VERSION, commands: proposal.commands.map((command) => {
    if (command.operation === 'entity') return { operation:'entity', effectKind:'create_entity', sourceResidentId:command.sourceResidentId as string, entityKind:normalizedKind(command.entityKind as string)!, entityKey:normalizeKey(command.entityKey as string), archetypeKey:normalizeKey(command.archetypeKey as string), proposedName:(command.proposedName as string).trim(), payload:command.payload as Record<string, unknown> };
    if (command.operation === 'quest') return { operation:'quest', effectKind:command.effectKind as 'create_quest' | 'update_quest', ownerResidentId:command.ownerResidentId as string, primitiveKey:normalizeKey(command.primitiveKey as string), action:command.action as string, approach:command.approach as string, targetEntityRefs:(command.targetEntityRefs as string[]).map((entry) => resolveReference(entry, context)!.id), motivation:(command.motivation as string).trim() };
    if (command.operation === 'public_event') return { operation:'public_event', effectKind:'record_world_event', sourceResidentId:command.sourceResidentId as string, templateKey:normalizeKey(command.templateKey as string), participantEntityRefs:(command.participantEntityRefs as string[]).map((entry) => resolveReference(entry, context)!.id), title:(command.title as string).trim(), summary:(command.summary as string).trim(), reuseKey:normalizeKey(command.reuseKey as string) };
    const definition = command.definition as Record<string, unknown>;
    if (command.family === 'successor_provisions') return { operation:'gameplay_unlock', effectKind:'unlock_gameplay', sourceResidentId:command.sourceResidentId as string, entityRef:normalizeKey(command.entityRef as string), family:'successor_provisions', definition:{ displayName:(definition.displayName as string).trim(), price:definition.price as number, dailyStock:definition.dailyStock as number } };
    return { operation:'gameplay_unlock', effectKind:'unlock_gameplay', sourceResidentId:command.sourceResidentId as string, entityRef:normalizeKey(command.entityRef as string), family:'herb_loaf_variant', definition:{ displayName:(definition.displayName as string).trim() } };
  }) } };
}

export function canonicalizeProceduralWorldProposal(value: unknown, context: ProceduralWorldValidationContext): string | null {
  const parsed = parseProceduralWorldProposal(value, context); if (!parsed.ok) return null;
  return canonical(parsed.value);
}
