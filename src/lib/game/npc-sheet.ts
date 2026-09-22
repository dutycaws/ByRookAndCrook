import type { ActionKind, Approach, Intention } from './dialogue';

export type NpcId = string;
export type NpcVersionId = string;
export type NpcRating = 'standard' | 'mature';
export type NpcOrigin = 'first_party' | 'community' | 'promoted';
export const NPC_SKILLS = ['scouting', 'combat', 'diplomacy', 'trade'] as const;
export const NPC_ACTIONS = ['prepare', 'wait', 'attempt', 'abandon'] as const satisfies readonly ActionKind[];
export const NPC_APPROACHES = ['scouting', 'combat', 'diplomacy', 'trade'] as const satisfies readonly Approach[];
export const NPC_PROFILE_ENTRY_KINDS = ['value', 'boundary', 'preference', 'aversion', 'motive', 'fear', 'coping_pattern', 'voice_trait'] as const;
export const REQUIRED_NPC_PROFILE_ENTRY_KINDS = ['value', 'boundary', 'preference', 'aversion', 'voice_trait'] as const;
export type NpcProfileEntryKind = (typeof NPC_PROFILE_ENTRY_KINDS)[number];

export interface NpcSupportingEntity { id: string; namespace: string; name: string; description: string; }
export interface NpcRelationship { subject: { kind: 'entity'; entityId: string } | { kind: 'npc'; npcId: NpcId }; description: string; trustThreshold: number; }
export interface NpcFact { id: string; category: 'history' | 'relationship' | 'goal' | 'secret'; text: string; trustThreshold: number; entityRefs: string[]; npcRefs: NpcId[]; }
export interface NpcPlanStep { action: ActionKind; approach: Approach; }
export interface NpcMilestone { id: string; title: string; outcome: string; motivation: string; constraints: string[]; allowedTargets: string[]; difficulty: number; successNews: string; nonSuccessNews: string; retiredTargets: string[]; permanentLoss: null | { kind: 'dead' | 'departed'; warning: string; outcome: string; }; startingPlan: NpcPlanStep[] | null; }
export interface NpcPersonalityDimension { key: string; label: string; negativeAnchor: string; positiveAnchor: string; initialValue: number; volatility: number; ordinaryChangeThreshold: number; definingRuptureThreshold: number; }
export interface NpcPersonalityCollection { kind: NpcProfileEntryKind; maximumEntries: number; }
export interface NpcInitialPersonalityEntry { id: string; kind: NpcProfileEntryKind; text: string; core: boolean; active: true; }
export interface NpcSheet {
  schemaVersion: 'npc-sheet-v2'; rating: NpcRating;
  identity: { name: string; title: string; shortDescription: string; voice: string; };
  appearance: { physicalAppearance: string; silhouette: string; palette: string[]; attire: string; notableFeatures: string; mood: string; };
  personality: { dimensions: NpcPersonalityDimension[]; collections: NpcPersonalityCollection[]; initialEntries: NpcInitialPersonalityEntry[]; };
  lore: { entities: NpcSupportingEntity[]; npcReferences: NpcId[]; relationships: NpcRelationship[]; facts: NpcFact[]; };
  skills: Record<(typeof NPC_SKILLS)[number], number>; campaign: { durableGoal: string; milestones: NpcMilestone[]; };
}
export interface NpcSheetIssue { path: string; code: string; message: string; }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const profileKey = /^[a-z][a-z0-9_]{1,63}$/;
const paletteValue = /^[a-z][a-z0-9-]{0,63}$/;
const reservedProfileKeyPrefix = /^(system_|world_|internal_)/;
const profileKinds = new Set<string>(NPC_PROFILE_ENTRY_KINDS);
const issue = (issues: NpcSheetIssue[], path: string, code: string, message: string) => issues.push({ path, code, message });
const text = (value: unknown, min: number, max: number): value is string => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
const textList = (value: unknown, min = 1, max = 10): value is string[] => Array.isArray(value) && value.length >= min && value.length <= max && value.every((entry) => text(entry, 1, 200));

/** Normalized values are only used for collision detection; persisted keys stay strict ASCII. */
export function normalizeNpcProfileKey(value: string): string { return value.trim().toLocaleLowerCase('en-US').replace(/-/g, '_'); }
export function normalizeNpcPaletteValue(value: string): string { return value.trim().toLocaleLowerCase('en-US'); }
export function normalizeNpcName(name: string): string { return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }

function validatePlan(steps: unknown, path: string, required: boolean, issues: NpcSheetIssue[]): void {
  if (steps === null && !required) return;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 3) { issue(issues, path, 'plan_length', 'Plans require one to three ordered steps.'); return; }
  steps.forEach((step, index) => {
    const value = step as Partial<NpcPlanStep>;
    if (!NPC_ACTIONS.includes(value.action as ActionKind)) issue(issues, `${path}.${index}.action`, 'plan_action', 'Choose a supported action.');
    if (!NPC_APPROACHES.includes(value.approach as Approach)) issue(issues, `${path}.${index}.approach`, 'plan_approach', 'Choose a supported approach.');
    if (index < steps.length - 1 && !['prepare', 'wait'].includes(String(value.action))) issue(issues, `${path}.${index}.action`, 'plan_terminal_order', 'Only the final step may attempt or abandon.');
    if (index === steps.length - 1 && !['attempt', 'abandon'].includes(String(value.action))) issue(issues, `${path}.${index}.action`, 'plan_terminal_missing', 'The final step must attempt or abandon.');
  });
}

function validatePersonality(value: unknown, issues: NpcSheetIssue[]): void {
  const personality = value as Partial<NpcSheet['personality']> | undefined;
  if (!Array.isArray(personality?.dimensions) || personality.dimensions.length < 1 || personality.dimensions.length > 8) issue(issues, 'personality.dimensions', 'dimension_count', 'Use one to eight personality dimensions.');
  else {
    const keys = new Set<string>();
    personality.dimensions.forEach((dimension, index) => {
      const path = `personality.dimensions.${index}`; const key = normalizeNpcProfileKey(String(dimension?.key ?? ''));
      if (!profileKey.test(String(dimension?.key ?? '')) || reservedProfileKeyPrefix.test(key) || keys.has(key)) issue(issues, `${path}.key`, 'dimension_key', 'Dimension keys must be unique normalized keys and cannot use reserved prefixes.');
      keys.add(key);
      if (!text(dimension?.label, 1, 120) || !text(dimension?.negativeAnchor, 1, 120) || !text(dimension?.positiveAnchor, 1, 120)) issue(issues, path, 'dimension_text', 'Dimension labels and semantic anchors must contain 1–120 characters.');
      if (!Number.isInteger(dimension?.initialValue) || Number(dimension.initialValue) < -100 || Number(dimension.initialValue) > 100) issue(issues, `${path}.initialValue`, 'dimension_value', 'Initial dimension values must be integers from -100 to 100.');
      if (!Number.isFinite(dimension?.volatility) || Number(dimension.volatility) < .25 || Number(dimension.volatility) > 2) issue(issues, `${path}.volatility`, 'dimension_volatility', 'Volatility must be finite from 0.25 to 2.0.');
      if (!Number.isInteger(dimension?.ordinaryChangeThreshold) || Number(dimension.ordinaryChangeThreshold) < 5 || Number(dimension.ordinaryChangeThreshold) > 200 || !Number.isInteger(dimension?.definingRuptureThreshold) || Number(dimension.definingRuptureThreshold) < 5 || Number(dimension.definingRuptureThreshold) > 200 || Number(dimension.definingRuptureThreshold) < Number(dimension.ordinaryChangeThreshold)) issue(issues, path, 'dimension_threshold', 'Thresholds must be integers from 5–200 and the defining threshold cannot be lower.');
    });
  }
  const caps = new Map<NpcProfileEntryKind, number>();
  if (!Array.isArray(personality?.collections) || personality.collections.length < 1 || personality.collections.length > NPC_PROFILE_ENTRY_KINDS.length) issue(issues, 'personality.collections', 'collection_count', 'Define one collection cap for each used profile kind.');
  else personality.collections.forEach((collection, index) => { const kind = collection?.kind as NpcProfileEntryKind; if (!profileKinds.has(kind) || caps.has(kind) || !Number.isInteger(collection?.maximumEntries) || Number(collection.maximumEntries) < 0 || Number(collection.maximumEntries) > 10) issue(issues, `personality.collections.${index}`, 'collection', 'Collections need a unique supported kind and a cap from 0–10.'); else caps.set(kind, collection.maximumEntries); });
  if (!Array.isArray(personality?.initialEntries) || personality.initialEntries.length < REQUIRED_NPC_PROFILE_ENTRY_KINDS.length || personality.initialEntries.length > 80) issue(issues, 'personality.initialEntries', 'entry_count', 'Starting profile entries must include every required kind.');
  else {
    const ids = new Set<string>(); const counts = new Map<NpcProfileEntryKind, number>(); const kinds = new Set<NpcProfileEntryKind>();
    personality.initialEntries.forEach((entry, index) => { const path = `personality.initialEntries.${index}`; const id = normalizeNpcProfileKey(String(entry?.id ?? '')); const kind = entry?.kind as NpcProfileEntryKind; if (!profileKey.test(String(entry?.id ?? '')) || reservedProfileKeyPrefix.test(id) || ids.has(id)) issue(issues, `${path}.id`, 'entry_id', 'Entry IDs must be unique normalized keys and cannot use reserved prefixes.'); ids.add(id); if (!profileKinds.has(kind) || !caps.has(kind) || !text(entry?.text, 1, 1000) || typeof entry?.core !== 'boolean' || entry?.active !== true) issue(issues, path, 'entry', 'Entries require a declared collection, text, authorable core flag, and active=true.'); counts.set(kind, (counts.get(kind) ?? 0) + 1); kinds.add(kind); });
    REQUIRED_NPC_PROFILE_ENTRY_KINDS.forEach((kind) => { if (!kinds.has(kind)) issue(issues, 'personality.initialEntries', 'required_entry_kind', `A published profile requires a ${kind} entry.`); });
    counts.forEach((count, kind) => { if (count > (caps.get(kind) ?? -1)) issue(issues, 'personality.initialEntries', 'collection_cap', `The ${kind} collection exceeds its declared cap.`); });
  }
}

export function validateNpcSheet(value: unknown): NpcSheetIssue[] {
  const issues: NpcSheetIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [{ path: '', code: 'sheet_type', message: 'The NPC sheet must be an object.' }];
  const sheet = value as Partial<NpcSheet>;
  if (sheet.schemaVersion !== 'npc-sheet-v2') issue(issues, 'schemaVersion', 'schema_version', 'Use npc-sheet-v2.');
  if (!['standard', 'mature'].includes(String(sheet.rating))) issue(issues, 'rating', 'rating', 'Choose standard or mature.');
  const identity = sheet.identity as Partial<NpcSheet['identity']> | undefined;
  if (!text(identity?.name, 1, 80)) issue(issues, 'identity.name', 'text_length', 'Name must be 1–80 characters.'); if (!text(identity?.title, 1, 80)) issue(issues, 'identity.title', 'text_length', 'Title must be 1–80 characters.'); if (!text(identity?.shortDescription, 20, 300)) issue(issues, 'identity.shortDescription', 'text_length', 'Description must be 20–300 characters.'); if (!text(identity?.voice, 20, 1000)) issue(issues, 'identity.voice', 'text_length', 'Voice must be 20–1,000 characters.');
  const appearance = sheet.appearance as Partial<NpcSheet['appearance']> | undefined;
  for (const key of ['physicalAppearance', 'silhouette', 'attire', 'notableFeatures', 'mood'] as const) if (!text(appearance?.[key], 20, 1000)) issue(issues, `appearance.${key}`, 'text_length', 'Appearance sections must be 20–1,000 characters.');
  if (!Array.isArray(appearance?.palette) || appearance.palette.length < 1 || appearance.palette.length > 5 || appearance.palette.some((entry) => !paletteValue.test(entry)) || new Set(appearance.palette.map(normalizeNpcPaletteValue)).size !== appearance.palette.length) issue(issues, 'appearance.palette', 'palette', 'Palette values must be one to five unique normalized color/style keys.');
  validatePersonality(sheet.personality, issues);
  const lore = sheet.lore as Partial<NpcSheet['lore']> | undefined;
  if (!Array.isArray(lore?.entities) || lore.entities.length > 20) issue(issues, 'lore.entities', 'entity_count', 'Use at most 20 supporting entities.'); else { const ids = new Set<string>(); lore.entities.forEach((entry, index) => { if (!slug.test(entry.id) || ids.has(entry.id)) issue(issues, `lore.entities.${index}.id`, 'entity_id', 'Entity IDs must be unique slugs.'); ids.add(entry.id); if (!slug.test(entry.namespace)) issue(issues, `lore.entities.${index}.namespace`, 'entity_namespace', 'Entity namespaces must be slugs.'); if (!text(entry.name, 1, 80) || !text(entry.description, 1, 300)) issue(issues, `lore.entities.${index}`, 'entity_text', 'Entities require a name and description.'); }); }
  if (!Array.isArray(lore?.npcReferences) || lore.npcReferences.length > 20 || lore.npcReferences.some((id) => !uuid.test(id))) issue(issues, 'lore.npcReferences', 'npc_reference', 'Use at most 20 valid NPC UUID references.');
  if (!Array.isArray(lore?.relationships) || lore.relationships.length > 20) issue(issues, 'lore.relationships', 'relationship_count', 'Use at most 20 relationships.'); else lore.relationships.forEach((entry, index) => { const entityId = entry?.subject?.kind === 'entity' ? entry.subject.entityId : null; const validSubject = entityId !== null ? slug.test(entityId) && !!lore?.entities?.some((entity) => entity.id === entityId) : entry?.subject?.kind === 'npc' && uuid.test(entry.subject.npcId); if (!validSubject || !text(entry.description, 1, 200) || !Number.isInteger(entry.trustThreshold) || entry.trustThreshold < 0 || entry.trustThreshold > 100) issue(issues, `lore.relationships.${index}`, 'relationship', 'Relationships require a valid subject, description, and trust threshold from 0–100.'); });
  if (!Array.isArray(lore?.facts) || lore.facts.length > 20) issue(issues, 'lore.facts', 'fact_count', 'Use at most 20 facts.'); else { const factIds = new Set<string>(); lore.facts.forEach((entry, index) => { if (!slug.test(entry.id) || factIds.has(entry.id) || !['history', 'relationship', 'goal', 'secret'].includes(entry.category) || !text(entry.text, 1, 1000) || !Number.isInteger(entry.trustThreshold) || entry.trustThreshold < 0 || entry.trustThreshold > 100 || !Array.isArray(entry.entityRefs) || entry.entityRefs.length > 20 || entry.entityRefs.some((id) => !lore?.entities?.some((entity) => entity.id === id)) || !Array.isArray(entry.npcRefs) || entry.npcRefs.length > 20 || entry.npcRefs.some((id) => !uuid.test(id))) issue(issues, `lore.facts.${index}`, 'fact', 'Facts require a unique slug, supported category, bounded references, text, and trust threshold from 0–100.'); factIds.add(entry.id); }); }
  const skills = sheet.skills as NpcSheet['skills'] | undefined; const values = NPC_SKILLS.map((key) => skills?.[key]); if (values.some((score) => !Number.isInteger(score) || Number(score) < 0 || Number(score) > 4)) issue(issues, 'skills', 'skill_range', 'Every skill must be an integer from 0–4.'); else if (values.reduce<number>((sum, score) => sum + Number(score), 0) !== 10 || !values.includes(4) || !values.some((score) => Number(score) <= 1)) issue(issues, 'skills', 'skill_budget', 'Skills must total 10, include one 4, and include one score of 1 or below.');
  const campaign = sheet.campaign as Partial<NpcSheet['campaign']> | undefined; if (!text(campaign?.durableGoal, 20, 300)) issue(issues, 'campaign.durableGoal', 'text_length', 'The durable goal must be 20–300 characters.'); if (!Array.isArray(campaign?.milestones) || campaign.milestones.length < 2 || campaign.milestones.length > 10) issue(issues, 'campaign.milestones', 'milestone_count', 'Campaigns require 2–10 ordered milestones.'); else campaign.milestones.forEach((milestone, index) => { const path = `campaign.milestones.${index}`; if (!slug.test(milestone.id) || !text(milestone.title, 1, 80) || !text(milestone.outcome, 20, 500) || !text(milestone.motivation, 20, 500) || !textList(milestone.constraints, 1, 10) || !textList(milestone.allowedTargets, 1, 20) || !Number.isInteger(milestone.difficulty) || milestone.difficulty < 0 || milestone.difficulty > 4 || !text(milestone.successNews, 20, 500) || !text(milestone.nonSuccessNews, 20, 500) || !Array.isArray(milestone.retiredTargets) || milestone.retiredTargets.length > 20 || milestone.retiredTargets.some((target) => !milestone.allowedTargets.includes(target))) issue(issues, path, 'milestone', 'Milestone content, targets, difficulty, news, and retired targets must satisfy the campaign contract.'); if (milestone.permanentLoss !== null && (!['dead', 'departed'].includes(milestone.permanentLoss?.kind) || !text(milestone.permanentLoss?.warning, 20, 500) || !text(milestone.permanentLoss?.outcome, 20, 500))) issue(issues, `${path}.permanentLoss`, 'permanent_loss', 'Permanent loss requires a type, visible warning, and reviewed outcome.'); validatePlan(milestone.startingPlan, `${path}.startingPlan`, index === 0, issues); });
  return issues;
}

export function milestoneIntention(sheet: NpcSheet, index: number): Intention | null { const milestone = sheet.campaign.milestones[index]; return milestone?.startingPlan ? { goal: milestone.outcome, motivation: milestone.motivation, targets: [...milestone.allowedTargets], steps: structuredClone(milestone.startingPlan) } : null; }
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)])); return value; }
export function canonicalNpcSheet(sheet: NpcSheet): string { return JSON.stringify(canonical(sheet)); }
