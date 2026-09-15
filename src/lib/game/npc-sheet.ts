import type { ActionKind, Approach, Intention } from './dialogue';

export type NpcId = string;
export type NpcVersionId = string;
export type NpcRating = 'standard' | 'mature';
export type NpcOrigin = 'first_party' | 'community' | 'procedural';

export const NPC_SKILLS = ['scouting', 'combat', 'diplomacy', 'trade'] as const;
export const NPC_ACTIONS = ['prepare', 'wait', 'attempt', 'abandon'] as const satisfies readonly ActionKind[];
export const NPC_APPROACHES = ['scouting', 'combat', 'diplomacy', 'trade'] as const satisfies readonly Approach[];

export interface NpcSupportingEntity {
  id: string;
  namespace: string;
  name: string;
  description: string;
}

export interface NpcRelationship {
  subject: { kind: 'entity'; entityId: string } | { kind: 'npc'; npcId: NpcId };
  description: string;
  trustThreshold: number;
}

export interface NpcFact {
  id: string;
  category: 'history' | 'relationship' | 'goal' | 'secret';
  text: string;
  trustThreshold: number;
  entityRefs: string[];
  npcRefs: NpcId[];
}

export interface NpcPlanStep {
  action: ActionKind;
  approach: Approach;
}

export interface NpcMilestone {
  id: string;
  title: string;
  outcome: string;
  motivation: string;
  constraints: string[];
  allowedTargets: string[];
  difficulty: number;
  successNews: string;
  nonSuccessNews: string;
  retiredTargets: string[];
  permanentLoss: null | {
    kind: 'dead' | 'departed';
    warning: string;
    outcome: string;
  };
  startingPlan: NpcPlanStep[] | null;
}

export interface NpcSheet {
  schemaVersion: 'npc-sheet-v1';
  rating: NpcRating;
  identity: {
    name: string;
    title: string;
    shortDescription: string;
    voice: string;
  };
  appearance: {
    physicalAppearance: string;
    attire: string;
    notableFeatures: string;
    mood: string;
  };
  personality: {
    values: string[];
    likes: string[];
    dislikes: string[];
    boundaries: string[];
  };
  lore: {
    entities: NpcSupportingEntity[];
    npcReferences: NpcId[];
    relationships: NpcRelationship[];
    facts: NpcFact[];
  };
  skills: Record<(typeof NPC_SKILLS)[number], number>;
  campaign: {
    durableGoal: string;
    milestones: NpcMilestone[];
  };
}

export interface NpcSheetIssue {
  path: string;
  code: string;
  message: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function text(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

function textList(value: unknown, min = 1, max = 10): value is string[] {
  return Array.isArray(value) && value.length >= min && value.length <= max && value.every((entry) => text(entry, 1, 200));
}

function issue(issues: NpcSheetIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function validatePlan(steps: unknown, path: string, required: boolean, issues: NpcSheetIssue[]): void {
  if (steps === null && !required) return;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 3) {
    issue(issues, path, 'plan_length', 'Plans require one to three ordered steps.');
    return;
  }
  steps.forEach((step, index) => {
    const value = step as Partial<NpcPlanStep>;
    if (!NPC_ACTIONS.includes(value.action as ActionKind)) issue(issues, `${path}.${index}.action`, 'plan_action', 'Choose a supported action.');
    if (!NPC_APPROACHES.includes(value.approach as Approach)) issue(issues, `${path}.${index}.approach`, 'plan_approach', 'Choose a supported approach.');
    if (index < steps.length - 1 && !['prepare', 'wait'].includes(String(value.action))) {
      issue(issues, `${path}.${index}.action`, 'plan_terminal_order', 'Only the final step may attempt or abandon.');
    }
    if (index === steps.length - 1 && !['attempt', 'abandon'].includes(String(value.action))) {
      issue(issues, `${path}.${index}.action`, 'plan_terminal_missing', 'The final step must attempt or abandon.');
    }
  });
}

export function normalizeNpcName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function validateNpcSheet(value: unknown): NpcSheetIssue[] {
  const issues: NpcSheetIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [{ path: '', code: 'sheet_type', message: 'The NPC sheet must be an object.' }];
  }
  const sheet = value as Partial<NpcSheet>;
  if (sheet.schemaVersion !== 'npc-sheet-v1') issue(issues, 'schemaVersion', 'schema_version', 'Use npc-sheet-v1.');
  if (!['standard', 'mature'].includes(String(sheet.rating))) issue(issues, 'rating', 'rating', 'Choose standard or mature.');

  const identity = sheet.identity as Partial<NpcSheet['identity']> | undefined;
  if (!text(identity?.name, 1, 80)) issue(issues, 'identity.name', 'text_length', 'Name must be 1–80 characters.');
  if (!text(identity?.title, 1, 80)) issue(issues, 'identity.title', 'text_length', 'Title must be 1–80 characters.');
  if (!text(identity?.shortDescription, 20, 300)) issue(issues, 'identity.shortDescription', 'text_length', 'Description must be 20–300 characters.');
  if (!text(identity?.voice, 20, 1000)) issue(issues, 'identity.voice', 'text_length', 'Voice must be 20–1,000 characters.');

  const appearance = sheet.appearance as Partial<NpcSheet['appearance']> | undefined;
  for (const key of ['physicalAppearance', 'attire', 'notableFeatures', 'mood'] as const) {
    if (!text(appearance?.[key], 20, 1000)) issue(issues, `appearance.${key}`, 'text_length', 'Appearance sections must be 20–1,000 characters.');
  }

  const personality = sheet.personality as Partial<NpcSheet['personality']> | undefined;
  for (const key of ['values', 'likes', 'dislikes', 'boundaries'] as const) {
    if (!textList(personality?.[key])) issue(issues, `personality.${key}`, 'list_length', 'Use 1–10 entries of at most 200 characters.');
  }

  const lore = sheet.lore as Partial<NpcSheet['lore']> | undefined;
  if (!Array.isArray(lore?.entities) || lore.entities.length > 20) issue(issues, 'lore.entities', 'entity_count', 'Use at most 20 supporting entities.');
  else {
    const ids = new Set<string>();
    lore.entities.forEach((entry, index) => {
      if (!slug.test(entry.id) || ids.has(entry.id)) issue(issues, `lore.entities.${index}.id`, 'entity_id', 'Entity IDs must be unique slugs.');
      ids.add(entry.id);
      if (!slug.test(entry.namespace)) issue(issues, `lore.entities.${index}.namespace`, 'entity_namespace', 'Entity namespaces must be slugs.');
      if (!text(entry.name, 1, 80) || !text(entry.description, 1, 300)) issue(issues, `lore.entities.${index}`, 'entity_text', 'Entities require a name and description.');
    });
  }
  if (!Array.isArray(lore?.npcReferences) || lore.npcReferences.length > 20 || lore.npcReferences.some((id) => !uuid.test(id))) {
    issue(issues, 'lore.npcReferences', 'npc_reference', 'Use at most 20 valid NPC UUID references.');
  }
  if (!Array.isArray(lore?.relationships) || lore.relationships.length > 20) issue(issues, 'lore.relationships', 'relationship_count', 'Use at most 20 relationships.');
  else lore.relationships.forEach((entry, index) => {
    const entityId = entry?.subject?.kind === 'entity' ? entry.subject.entityId : null;
    const validSubject = entityId !== null
      ? slug.test(entityId) && !!lore?.entities?.some((entity) => entity.id === entityId)
      : entry?.subject?.kind === 'npc' && uuid.test(entry.subject.npcId);
    if (!validSubject || !text(entry.description, 1, 200) || !Number.isInteger(entry.trustThreshold) || entry.trustThreshold < 0 || entry.trustThreshold > 100) {
      issue(issues, `lore.relationships.${index}`, 'relationship', 'Relationships require a valid subject, description, and trust threshold from 0–100.');
    }
  });
  if (!Array.isArray(lore?.facts) || lore.facts.length > 20) issue(issues, 'lore.facts', 'fact_count', 'Use at most 20 facts.');
  else {
    const factIds = new Set<string>();
    lore.facts.forEach((entry, index) => {
    if (!slug.test(entry.id) || factIds.has(entry.id) || !['history', 'relationship', 'goal', 'secret'].includes(entry.category) || !text(entry.text, 1, 1000)
      || !Number.isInteger(entry.trustThreshold) || entry.trustThreshold < 0 || entry.trustThreshold > 100
      || !Array.isArray(entry.entityRefs) || entry.entityRefs.length > 20 || entry.entityRefs.some((id) => !lore?.entities?.some((entity) => entity.id === id))
      || !Array.isArray(entry.npcRefs) || entry.npcRefs.length > 20 || entry.npcRefs.some((id) => !uuid.test(id))) {
      issue(issues, `lore.facts.${index}`, 'fact', 'Facts require a unique slug, supported category, bounded references, text, and trust threshold from 0–100.');
    }
    factIds.add(entry.id);
  });
  }

  const skills = sheet.skills as NpcSheet['skills'] | undefined;
  const values = NPC_SKILLS.map((key) => skills?.[key]);
  if (values.some((score) => !Number.isInteger(score) || Number(score) < 0 || Number(score) > 4)) issue(issues, 'skills', 'skill_range', 'Every skill must be an integer from 0–4.');
  else if (values.reduce<number>((sum, score) => sum + Number(score), 0) !== 10 || !values.includes(4) || !values.some((score) => Number(score) <= 1)) {
    issue(issues, 'skills', 'skill_budget', 'Skills must total 10, include one 4, and include one score of 1 or below.');
  }

  const campaign = sheet.campaign as Partial<NpcSheet['campaign']> | undefined;
  if (!text(campaign?.durableGoal, 20, 300)) issue(issues, 'campaign.durableGoal', 'text_length', 'The durable goal must be 20–300 characters.');
  if (!Array.isArray(campaign?.milestones) || campaign.milestones.length < 2 || campaign.milestones.length > 10) {
    issue(issues, 'campaign.milestones', 'milestone_count', 'Campaigns require 2–10 ordered milestones.');
  } else campaign.milestones.forEach((milestone, index) => {
    const path = `campaign.milestones.${index}`;
    if (!slug.test(milestone.id) || !text(milestone.title, 1, 80) || !text(milestone.outcome, 20, 500)
      || !text(milestone.motivation, 20, 500) || !textList(milestone.constraints, 1, 10)
      || !textList(milestone.allowedTargets, 1, 20) || !Number.isInteger(milestone.difficulty) || milestone.difficulty < 0 || milestone.difficulty > 4
      || !text(milestone.successNews, 20, 500) || !text(milestone.nonSuccessNews, 20, 500)
      || !Array.isArray(milestone.retiredTargets) || milestone.retiredTargets.length > 20 || milestone.retiredTargets.some((target) => !milestone.allowedTargets.includes(target))) {
      issue(issues, path, 'milestone', 'Milestone content, targets, difficulty, news, and retired targets must satisfy the campaign contract.');
    }
    if (milestone.permanentLoss !== null && (!['dead', 'departed'].includes(milestone.permanentLoss?.kind)
      || !text(milestone.permanentLoss?.warning, 20, 500) || !text(milestone.permanentLoss?.outcome, 20, 500))) {
      issue(issues, `${path}.permanentLoss`, 'permanent_loss', 'Permanent loss requires a type, visible warning, and reviewed outcome.');
    }
    validatePlan(milestone.startingPlan, `${path}.startingPlan`, index === 0, issues);
  });
  return issues;
}

export function milestoneIntention(sheet: NpcSheet, index: number): Intention | null {
  const milestone = sheet.campaign.milestones[index];
  if (!milestone?.startingPlan) return null;
  return {
    goal: milestone.outcome,
    motivation: milestone.motivation,
    targets: [...milestone.allowedTargets],
    steps: structuredClone(milestone.startingPlan)
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export function canonicalNpcSheet(sheet: NpcSheet): string {
  return JSON.stringify(canonical(sheet));
}
