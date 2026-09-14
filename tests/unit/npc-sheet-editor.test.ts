import { describe, expect, it } from 'vitest';
import { fromGuidedNpcSheet, newGuidedEntity, newGuidedFact, newGuidedMilestone, npcSheetFromAuthoringForm, removeGuidedEntity, removeGuidedNpcReference, toGuidedNpcSheet } from '../../src/lib/game/npc-sheet-editor';
import { validateNpcSheet, type NpcSheet } from '../../src/lib/game/npc-sheet';

const lira = '18181818-1818-4181-8181-181818181818';

function sheet(): NpcSheet {
  return {
    schemaVersion: 'npc-sheet-v1', rating: 'standard',
    identity: { name: 'Mara Reed', title: 'Scout', shortDescription: 'A thoughtful scout who knows the wooded road outside town.', voice: 'Plain spoken, careful, and slow to make a promise.' },
    appearance: { physicalAppearance: 'A wiry traveler with steady grey eyes and wind-burned cheeks.', attire: 'A repaired green cloak over practical road leathers and worn boots.', notableFeatures: 'A brass compass and a field notebook, both carried with care.', mood: 'Alert in crowds and at ease on a quiet road.' },
    personality: { values: ['Reliable evidence'], likes: ['Quiet roads'], dislikes: ['Careless accusations'], boundaries: ['Will not endanger civilians'] },
    lore: {
      entities: [{ id: 'old-road', namespace: 'millhaven', name: 'Old Road', description: 'The wooded trade road east of Millhaven.' }], npcReferences: [lira],
      relationships: [{ subject: { kind: 'entity', entityId: 'old-road' }, description: 'Knows every safe turn.', trustThreshold: 25 }],
      facts: [{ id: 'first-patrol', category: 'history', text: 'Mara carried messages along the road as a child.', trustThreshold: 60, entityRefs: ['old-road'], npcRefs: [lira] }]
    }, skills: { scouting: 4, combat: 3, diplomacy: 2, trade: 1 },
    campaign: { durableGoal: 'Keep travel through Millhaven safe without leaving friends behind.', milestones: [
      { id: 'map-road', title: 'Map the road', outcome: 'Identify every unsafe stretch of the road.', motivation: 'Travelers need a dependable map before the road can be secured.', constraints: ['Protect travelers'], allowedTargets: ['old-road'], difficulty: 2, successNews: 'A useful road map reaches the tavern.', nonSuccessNews: 'The lead goes cold and the road remains unsafe.', retiredTargets: [], permanentLoss: null, startingPlan: [{ action: 'prepare', approach: 'scouting' }, { action: 'attempt', approach: 'scouting' }] },
      { id: 'secure-road', title: 'Secure the route', outcome: 'Establish a lasting watch along the road.', motivation: 'A map matters only if someone keeps travelers safe.', constraints: ['Work with locals'], allowedTargets: ['old-road'], difficulty: 3, successNews: 'A lasting patrol keeps the road safe.', nonSuccessNews: 'The proposed patrol falls apart before it can help.', retiredTargets: [], permanentLoss: null, startingPlan: null }
    ] }
  };
}

describe('guided NPC sheet editor codec', () => {
  it('round-trips the canonical contract while translating named difficulty and disclosure', () => {
    const original = sheet(); const guided = toGuidedNpcSheet(original); const roundTrip = fromGuidedNpcSheet(guided);
    expect(roundTrip).toEqual(original);
    expect(guided.world.facts[0].disclosure).toBe('close');
    expect(guided.story.milestones[0].difficulty).toBe('risky');
    expect(validateNpcSheet(roundTrip)).toEqual([]);
  });

  it('keeps generated IDs and strips dangling links only when they are no longer valid', () => {
    const guided = toGuidedNpcSheet(sheet());
    const entity = newGuidedEntity(guided); const fact = newGuidedFact(guided); const milestone = newGuidedMilestone(guided);
    expect(entity.id).toBe('new-detail'); expect(fact.id).toBe('new-fact'); expect(milestone.id).toBe('new-chapter');
    guided.world.facts[0].entityRefs.push('missing');
    expect(fromGuidedNpcSheet(guided).lore.facts[0].entityRefs).toEqual(['old-road']);
  });

  it('will not delete a story detail while authored links still depend on it', () => {
    const guided = toGuidedNpcSheet(sheet());
    expect(removeGuidedEntity(guided, 'old-road')).toMatchObject({ ok: false });
    guided.world.facts[0].entityRefs = [];
    guided.world.relationships = [];
    expect(removeGuidedEntity(guided, 'old-road')).toEqual({ ok: true });
  });

  it('deduplicates NPC links and safely cleans references when a linked character is removed', () => {
    const guided = toGuidedNpcSheet(sheet());
    guided.world.npcReferences.push(lira);
    guided.world.relationships.push({ subject: { kind: 'npc', npcId: lira }, description: 'Trades rumors with her.', disclosure: 'trusted' });
    expect(fromGuidedNpcSheet(guided).lore.npcReferences).toEqual([lira]);
    removeGuidedNpcReference(guided, lira);
    const output = fromGuidedNpcSheet(guided);
    expect(output.lore.npcReferences).toEqual([]);
    expect(output.lore.facts[0].npcRefs).toEqual([]);
    expect(output.lore.relationships).toHaveLength(1);
    expect(output.lore.relationships[0].subject).toEqual({ kind: 'entity', entityId: 'old-road' });
  });

  it('accepts the hidden canonical form fields without exposing editor IDs to the route', () => {
    const original = sheet(); const form = new FormData();
    form.set('rating', original.rating); form.set('name', original.identity.name); form.set('title', original.identity.title); form.set('shortDescription', original.identity.shortDescription); form.set('voice', original.identity.voice);
    form.set('physicalAppearance', original.appearance.physicalAppearance); form.set('attire', original.appearance.attire); form.set('notableFeatures', original.appearance.notableFeatures); form.set('mood', original.appearance.mood);
    for (const key of ['values', 'likes', 'dislikes', 'boundaries'] as const) form.set(key, original.personality[key].join('\n'));
    for (const key of ['scouting', 'combat', 'diplomacy', 'trade'] as const) form.set(`skill-${key}`, String(original.skills[key]));
    form.set('durableGoal', original.campaign.durableGoal); form.set('entities', JSON.stringify(original.lore.entities)); form.set('facts', JSON.stringify(original.lore.facts)); form.set('relationships', JSON.stringify(original.lore.relationships)); form.set('npcReferences', JSON.stringify(original.lore.npcReferences)); form.set('milestones', JSON.stringify(original.campaign.milestones));
    expect(npcSheetFromAuthoringForm(form, original)).toEqual(original);
  });
});
