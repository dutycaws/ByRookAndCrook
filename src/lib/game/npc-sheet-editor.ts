import type { NpcFact, NpcInitialPersonalityEntry, NpcMilestone, NpcPlanStep, NpcProfileEntryKind, NpcRelationship, NpcSheet, NpcSupportingEntity } from './npc-sheet';

/**
 * The form model is deliberately a JSON-safe projection of npc-sheet-v2. It
 * keeps editor-only labels at the edge while drafts remain one complete sheet.
 */
export type DisclosureLevel = 'immediate' | 'trusted' | 'close' | 'guarded';
export type GuidedEntity = NpcSupportingEntity;
export type GuidedFact = Omit<NpcFact, 'trustThreshold'> & { disclosure: DisclosureLevel };
export type GuidedRelationship = Omit<NpcRelationship, 'trustThreshold'> & { disclosure: DisclosureLevel };
export type GuidedMilestone = Omit<NpcMilestone, 'difficulty'> & { difficulty: 'quiet' | 'steady' | 'risky' | 'daunting' | 'legendary' };
export type GuidedNpcSheet = {
  rating: NpcSheet['rating']; identity: NpcSheet['identity']; appearance: NpcSheet['appearance']; personality: NpcSheet['personality']; skills: NpcSheet['skills'];
  world: { entities: GuidedEntity[]; npcReferences: string[]; relationships: GuidedRelationship[]; facts: GuidedFact[]; };
  story: { durableGoal: string; milestones: GuidedMilestone[]; };
};

export const DISCLOSURE_LEVELS: readonly { value: DisclosureLevel; label: string; threshold: number; help: string }[] = [
  { value: 'immediate', label: 'Openly shared', threshold: 0, help: 'They can mention this right away.' }, { value: 'trusted', label: 'After trust grows', threshold: 25, help: 'They share this once the keeper has earned some trust.' }, { value: 'close', label: 'With close friends', threshold: 60, help: 'They reserve this for a close relationship.' }, { value: 'guarded', label: 'Closely guarded', threshold: 85, help: 'They reveal this only in exceptional confidence.' }
] as const;
export const DIFFICULTY_LEVELS: readonly { value: GuidedMilestone['difficulty']; label: string; score: number; help: string }[] = [
  { value: 'quiet', label: 'Quiet start', score: 0, help: 'A low-risk first step.' }, { value: 'steady', label: 'Steady challenge', score: 1, help: 'Requires ordinary preparation.' }, { value: 'risky', label: 'Risky undertaking', score: 2, help: 'Setbacks are likely without support.' }, { value: 'daunting', label: 'Daunting pursuit', score: 3, help: 'A serious obstacle with lasting stakes.' }, { value: 'legendary', label: 'Legendary trial', score: 4, help: 'A rare and dangerous turning point.' }
] as const;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const thresholdFor = (level: DisclosureLevel) => DISCLOSURE_LEVELS.find((entry) => entry.value === level)?.threshold ?? 0;
const disclosureByThreshold = (threshold: number): DisclosureLevel => threshold >= 85 ? 'guarded' : threshold >= 60 ? 'close' : threshold >= 25 ? 'trusted' : 'immediate';
const scoreFor = (value: GuidedMilestone['difficulty']) => DIFFICULTY_LEVELS.find((entry) => entry.value === value)?.score ?? 1;
const difficultyByScore = (value: number): GuidedMilestone['difficulty'] => DIFFICULTY_LEVELS.find((entry) => entry.score === value)?.value ?? 'steady';

export function toGuidedNpcSheet(sheet: NpcSheet): GuidedNpcSheet {
  return { rating: sheet.rating, identity: clone(sheet.identity), appearance: clone(sheet.appearance), personality: clone(sheet.personality), skills: clone(sheet.skills), world: { entities: clone(sheet.lore.entities), npcReferences: unique(sheet.lore.npcReferences), relationships: sheet.lore.relationships.map((entry) => ({ ...clone(entry), disclosure: disclosureByThreshold(entry.trustThreshold) })), facts: sheet.lore.facts.map((entry) => ({ ...clone(entry), disclosure: disclosureByThreshold(entry.trustThreshold) })) }, story: { durableGoal: sheet.campaign.durableGoal, milestones: sheet.campaign.milestones.map((entry) => ({ ...clone(entry), difficulty: difficultyByScore(entry.difficulty) })) } };
}
export function fromGuidedNpcSheet(form: GuidedNpcSheet): NpcSheet {
  const entityIds = new Set(form.world.entities.map((entity) => entity.id));
  const relationshipRefs = form.world.relationships.flatMap((entry) => entry.subject.kind === 'npc' ? [entry.subject.npcId] : []);
  const factRefs = form.world.facts.flatMap((entry) => entry.npcRefs);
  return { schemaVersion: 'npc-sheet-v2', rating: form.rating, identity: clone(form.identity), appearance: clone(form.appearance), personality: clone(form.personality), skills: clone(form.skills), lore: { entities: clone(form.world.entities), npcReferences: unique([...form.world.npcReferences, ...relationshipRefs, ...factRefs]), relationships: form.world.relationships.filter((entry) => entry.subject.kind === 'npc' || entityIds.has(entry.subject.entityId)).map(({ disclosure, ...entry }) => ({ ...clone(entry), trustThreshold: thresholdFor(disclosure) })), facts: form.world.facts.map(({ disclosure, entityRefs, npcRefs, ...entry }) => ({ ...clone(entry), trustThreshold: thresholdFor(disclosure), entityRefs: unique(entityRefs.filter((id) => entityIds.has(id))), npcRefs: unique(npcRefs) })) }, campaign: { durableGoal: form.story.durableGoal, milestones: form.story.milestones.map(({ difficulty, ...entry }, index) => ({ ...clone(entry), difficulty: scoreFor(difficulty), startingPlan: index === 0 ? clone(entry.startingPlan) : null })) } };
}

const slugify = (value: string, fallback: string) => value.trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || fallback;
function nextId(value: string, existing: Iterable<string>, fallback: string): string { const ids = new Set(existing); const root = slugify(value, fallback); if (!ids.has(root)) return root; for (let index = 2; ; index += 1) if (!ids.has(`${root}-${index}`)) return `${root}-${index}`; }
export function newGuidedEntity(model: GuidedNpcSheet): GuidedEntity { return { id: nextId('new detail', model.world.entities.map((entry) => entry.id), 'story-detail'), namespace: 'tavern', name: 'New story detail', description: 'A setting detail this character knows well.' }; }
export function newGuidedFact(model: GuidedNpcSheet): GuidedFact { return { id: nextId('new fact', model.world.facts.map((entry) => entry.id), 'fact'), category: 'history', text: 'A meaningful thing this character knows.', disclosure: 'trusted', entityRefs: [], npcRefs: [] }; }
export function newGuidedMilestone(model: GuidedNpcSheet): GuidedMilestone { return { id: nextId('new chapter', model.story.milestones.map((entry) => entry.id), 'chapter'), title: 'New chapter', outcome: 'Describe what success looks like for this chapter.', motivation: 'Describe why this matters to the character.', constraints: ['Name a boundary they will not cross'], allowedTargets: ['tavern'], difficulty: 'steady', successNews: 'Good news reaches the tavern.', nonSuccessNews: 'The chapter ends with a setback.', retiredTargets: [], permanentLoss: null, startingPlan: null }; }
export function newInitialPersonalityEntry(model: GuidedNpcSheet, kind: NpcProfileEntryKind): NpcInitialPersonalityEntry { const ids = new Set(model.personality.initialEntries.map((entry) => entry.id)); const root = `new_${kind}`; let id = root; for (let index = 2; ids.has(id); index += 1) id = `${root}_${index}`; return { id, kind, text: `Describe this ${kind.replace('_', ' ')}.`, core: false, active: true }; }
export type EntityDeletionResult = { ok: true } | { ok: false; message: string };
export function removeGuidedEntity(model: GuidedNpcSheet, entityId: string): EntityDeletionResult { const facts = model.world.facts.filter((entry) => entry.entityRefs.includes(entityId)).length; const relationships = model.world.relationships.filter((entry) => entry.subject.kind === 'entity' && entry.subject.entityId === entityId).length; if (facts || relationships) return { ok: false, message: `Remove ${facts ? `${facts} linked fact${facts === 1 ? '' : 's'}` : ''}${facts && relationships ? ' and ' : ''}${relationships ? `${relationships} connection${relationships === 1 ? '' : 's'}` : ''} first.` }; model.world.entities = model.world.entities.filter((entry) => entry.id !== entityId); return { ok: true }; }
export function removeGuidedNpcReference(model: GuidedNpcSheet, npcId: string): void { model.world.npcReferences = model.world.npcReferences.filter((id) => id !== npcId); model.world.facts.forEach((entry) => { entry.npcRefs = entry.npcRefs.filter((id) => id !== npcId); }); model.world.relationships = model.world.relationships.filter((entry) => entry.subject.kind !== 'npc' || entry.subject.npcId !== npcId); }
export function setOpeningPlan(milestone: GuidedMilestone, steps: NpcPlanStep[]): void { milestone.startingPlan = steps.length ? steps.slice(0, 3) : null; }
function json<T>(form: FormData, name: string, fallback: T): T { const value = String(form.get(name) ?? '').trim(); if (!value) return fallback; try { return JSON.parse(value) as T; } catch { throw new Error(`Please correct the ${name} section before saving.`); } }
/** Route adapter. Personality is one structured V2 field so the author cannot accidentally desynchronise its three collections. */
export function npcSheetFromAuthoringForm(form: FormData, current: NpcSheet): NpcSheet { return { ...current, rating: String(form.get('rating') ?? current.rating) as NpcSheet['rating'], identity: { name: String(form.get('name') ?? current.identity.name), title: String(form.get('title') ?? current.identity.title), shortDescription: String(form.get('shortDescription') ?? current.identity.shortDescription), voice: String(form.get('voice') ?? current.identity.voice) }, appearance: json(form, 'appearance', current.appearance), personality: json(form, 'personality', current.personality), lore: { entities: json(form, 'entities', current.lore.entities), facts: json(form, 'facts', current.lore.facts), relationships: json(form, 'relationships', current.lore.relationships), npcReferences: json(form, 'npcReferences', current.lore.npcReferences) }, skills: json(form, 'skills', current.skills), campaign: { durableGoal: String(form.get('durableGoal') ?? current.campaign.durableGoal), milestones: json(form, 'milestones', current.campaign.milestones) } }; }
