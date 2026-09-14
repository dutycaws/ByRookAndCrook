import type { NpcFact, NpcMilestone, NpcPlanStep, NpcRelationship, NpcSheet, NpcSupportingEntity } from './npc-sheet';

/**
 * The authoring screen deliberately has a richer, friendlier model than the
 * persisted sheet.  Keeping this translation here makes the form a replaceable
 * view: routes submit a normal NpcSheet and the database remains authoritative.
 */
export type DisclosureLevel = 'immediate' | 'trusted' | 'close' | 'guarded';

export type GuidedEntity = NpcSupportingEntity;
export type GuidedFact = Omit<NpcFact, 'trustThreshold'> & { disclosure: DisclosureLevel };
export type GuidedRelationship = Omit<NpcRelationship, 'trustThreshold'> & { disclosure: DisclosureLevel };
export type GuidedMilestone = Omit<NpcMilestone, 'difficulty'> & { difficulty: 'quiet' | 'steady' | 'risky' | 'daunting' | 'legendary' };

export interface GuidedNpcSheet {
  rating: NpcSheet['rating'];
  identity: NpcSheet['identity'];
  appearance: NpcSheet['appearance'];
  personality: NpcSheet['personality'];
  skills: NpcSheet['skills'];
  world: {
    entities: GuidedEntity[];
    npcReferences: string[];
    relationships: GuidedRelationship[];
    facts: GuidedFact[];
  };
  story: { durableGoal: string; milestones: GuidedMilestone[] };
}

export const DISCLOSURE_LEVELS: readonly { value: DisclosureLevel; label: string; threshold: number; help: string }[] = [
  { value: 'immediate', label: 'Openly shared', threshold: 0, help: 'They can mention this right away.' },
  { value: 'trusted', label: 'After trust grows', threshold: 25, help: 'They share this once the keeper has earned some trust.' },
  { value: 'close', label: 'With close friends', threshold: 60, help: 'They reserve this for a close relationship.' },
  { value: 'guarded', label: 'Closely guarded', threshold: 85, help: 'They reveal this only in exceptional confidence.' }
] as const;

export const DIFFICULTY_LEVELS: readonly { value: GuidedMilestone['difficulty']; label: string; score: number; help: string }[] = [
  { value: 'quiet', label: 'Quiet start', score: 0, help: 'A low-risk first step.' },
  { value: 'steady', label: 'Steady challenge', score: 1, help: 'Requires ordinary preparation.' },
  { value: 'risky', label: 'Risky undertaking', score: 2, help: 'Setbacks are likely without support.' },
  { value: 'daunting', label: 'Daunting pursuit', score: 3, help: 'A serious obstacle with lasting stakes.' },
  { value: 'legendary', label: 'Legendary trial', score: 4, help: 'A rare and dangerous turning point.' }
] as const;

const disclosureByThreshold = (threshold: number): DisclosureLevel => {
  if (threshold >= 85) return 'guarded';
  if (threshold >= 60) return 'close';
  if (threshold >= 25) return 'trusted';
  return 'immediate';
};
const thresholdFor = (level: DisclosureLevel) => DISCLOSURE_LEVELS.find((entry) => entry.value === level)?.threshold ?? 0;
const difficultyByScore = (score: number): GuidedMilestone['difficulty'] => DIFFICULTY_LEVELS.find((entry) => entry.score === score)?.value ?? 'steady';
const scoreFor = (difficulty: GuidedMilestone['difficulty']) => DIFFICULTY_SCORE[difficulty] ?? 1;
const DIFFICULTY_SCORE: Record<GuidedMilestone['difficulty'], number> = Object.fromEntries(DIFFICULTY_LEVELS.map((entry) => [entry.value, entry.score])) as Record<GuidedMilestone['difficulty'], number>;

// The guided editor passes Svelte's deep state proxies through this codec in
// the browser. NPC sheets are JSON contracts, so a JSON clone safely unwraps
// those proxies while preserving the complete persisted shape.
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }

/** Convert stored threshold numbers into words that make sense to an author. */
export function toGuidedNpcSheet(sheet: NpcSheet): GuidedNpcSheet {
  return {
    rating: sheet.rating,
    identity: clone(sheet.identity), appearance: clone(sheet.appearance), personality: clone(sheet.personality), skills: clone(sheet.skills),
    world: {
      entities: clone(sheet.lore.entities), npcReferences: unique(sheet.lore.npcReferences),
      relationships: sheet.lore.relationships.map((relationship) => ({ ...clone(relationship), disclosure: disclosureByThreshold(relationship.trustThreshold) })),
      facts: sheet.lore.facts.map((fact) => ({ ...clone(fact), disclosure: disclosureByThreshold(fact.trustThreshold) }))
    },
    story: {
      durableGoal: sheet.campaign.durableGoal,
      milestones: sheet.campaign.milestones.map((milestone) => ({ ...clone(milestone), difficulty: difficultyByScore(milestone.difficulty) }))
    }
  };
}

/** Convert guided form data back to the exact v1 contract, preserving stable IDs. */
export function fromGuidedNpcSheet(form: GuidedNpcSheet): NpcSheet {
  const entityIds = new Set(form.world.entities.map((entity) => entity.id));
  const relationshipNpcRefs = form.world.relationships.flatMap((relationship) => relationship.subject.kind === 'npc' ? [relationship.subject.npcId] : []);
  const factNpcRefs = form.world.facts.flatMap((fact) => fact.npcRefs);
  return {
    schemaVersion: 'npc-sheet-v1', rating: form.rating,
    identity: clone(form.identity), appearance: clone(form.appearance), personality: clone(form.personality), skills: clone(form.skills),
    lore: {
      entities: clone(form.world.entities),
      // Preserve an existing manual reference but also include every explicit guided link.
      npcReferences: unique([...form.world.npcReferences, ...relationshipNpcRefs, ...factNpcRefs]),
      relationships: form.world.relationships
        .filter((relationship) => relationship.subject.kind === 'npc' || entityIds.has(relationship.subject.entityId))
        .map(({ disclosure, ...relationship }) => ({ ...clone(relationship), trustThreshold: thresholdFor(disclosure) })),
      facts: form.world.facts.map(({ disclosure, entityRefs, npcRefs, ...fact }) => ({
        ...clone(fact), trustThreshold: thresholdFor(disclosure),
        entityRefs: unique(entityRefs.filter((id) => entityIds.has(id))), npcRefs: unique(npcRefs)
      }))
    },
    campaign: {
      durableGoal: form.story.durableGoal,
      milestones: form.story.milestones.map(({ difficulty, ...milestone }, index) => ({
        ...clone(milestone), difficulty: scoreFor(difficulty), startingPlan: index === 0 ? clone(milestone.startingPlan) : null
      }))
    }
  };
}

function slugify(value: string, fallback: string): string {
  const base = value.trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return base || fallback;
}
function nextId(value: string, existing: Iterable<string>, fallback: string): string {
  const ids = new Set(existing); const root = slugify(value, fallback);
  if (!ids.has(root)) return root;
  for (let number = 2; ; number += 1) if (!ids.has(`${root}-${number}`)) return `${root}-${number}`;
}

export function newGuidedEntity(model: GuidedNpcSheet): GuidedEntity {
  return { id: nextId('new detail', model.world.entities.map((entity) => entity.id), 'story-detail'), namespace: 'tavern', name: 'New story detail', description: 'A setting detail this character knows well.' };
}
export function newGuidedFact(model: GuidedNpcSheet): GuidedFact {
  return { id: nextId('new fact', model.world.facts.map((fact) => fact.id), 'fact'), category: 'history', text: 'A meaningful thing this character knows.', disclosure: 'trusted', entityRefs: [], npcRefs: [] };
}
export function newGuidedMilestone(model: GuidedNpcSheet): GuidedMilestone {
  return { id: nextId('new chapter', model.story.milestones.map((milestone) => milestone.id), 'chapter'), title: 'New chapter', outcome: 'Describe what success looks like for this chapter.', motivation: 'Describe why this matters to the character.', constraints: ['Name a boundary they will not cross'], allowedTargets: ['tavern'], difficulty: 'steady', successNews: 'Good news reaches the tavern.', nonSuccessNews: 'The chapter ends with a setback.', retiredTargets: [], permanentLoss: null, startingPlan: null };
}

export type EntityDeletionResult = { ok: true } | { ok: false; message: string };
/** Never silently sever authored facts/relationships when removing a world detail. */
export function removeGuidedEntity(model: GuidedNpcSheet, entityId: string): EntityDeletionResult {
  const linkedFacts = model.world.facts.filter((fact) => fact.entityRefs.includes(entityId)).length;
  const linkedConnections = model.world.relationships.filter((relationship) => relationship.subject.kind === 'entity' && relationship.subject.entityId === entityId).length;
  if (linkedFacts || linkedConnections) return { ok: false, message: `Remove ${linkedFacts ? `${linkedFacts} thing${linkedFacts === 1 ? '' : 's'} they know` : ''}${linkedFacts && linkedConnections ? ' and ' : ''}${linkedConnections ? `${linkedConnections} connection${linkedConnections === 1 ? '' : 's'}` : ''} first.` };
  model.world.entities = model.world.entities.filter((entity) => entity.id !== entityId);
  return { ok: true };
}

export function removeGuidedNpcReference(model: GuidedNpcSheet, npcId: string): void {
  model.world.npcReferences = model.world.npcReferences.filter((id) => id !== npcId);
  model.world.facts.forEach((fact) => { fact.npcRefs = fact.npcRefs.filter((id) => id !== npcId); });
  model.world.relationships = model.world.relationships.filter((relationship) => relationship.subject.kind !== 'npc' || relationship.subject.npcId !== npcId);
}

export function setOpeningPlan(milestone: GuidedMilestone, steps: NpcPlanStep[]): void {
  milestone.startingPlan = steps.length ? steps.slice(0, 3) : null;
}

function formLines(data: FormData, name: string): string[] {
  return String(data.get(name) ?? '').split('\n').map((entry) => entry.trim()).filter(Boolean);
}
function formJson<T>(data: FormData, name: string): T {
  const value = String(data.get(name) ?? '').trim();
  if (!value) return [] as T;
  try { return JSON.parse(value) as T; } catch { throw new Error(`Please correct the ${name} section before saving.`); }
}

/** The route adapter for the guided editor. Its public field names are stable. */
export function npcSheetFromAuthoringForm(data: FormData, current: NpcSheet): NpcSheet {
  return {
    ...current,
    rating: String(data.get('rating')) as NpcSheet['rating'],
    identity: { name: String(data.get('name')), title: String(data.get('title')), shortDescription: String(data.get('shortDescription')), voice: String(data.get('voice')) },
    appearance: { physicalAppearance: String(data.get('physicalAppearance')), attire: String(data.get('attire')), notableFeatures: String(data.get('notableFeatures')), mood: String(data.get('mood')) },
    personality: { values: formLines(data, 'values'), likes: formLines(data, 'likes'), dislikes: formLines(data, 'dislikes'), boundaries: formLines(data, 'boundaries') },
    lore: {
      entities: formJson<NpcSheet['lore']['entities']>(data, 'entities'), facts: formJson<NpcSheet['lore']['facts']>(data, 'facts'),
      relationships: formJson<NpcSheet['lore']['relationships']>(data, 'relationships'), npcReferences: formJson<string[]>(data, 'npcReferences')
    },
    skills: { scouting: Number(data.get('skill-scouting')), combat: Number(data.get('skill-combat')), diplomacy: Number(data.get('skill-diplomacy')), trade: Number(data.get('skill-trade')) },
    campaign: { durableGoal: String(data.get('durableGoal')), milestones: formJson<NpcSheet['campaign']['milestones']>(data, 'milestones') }
  };
}
