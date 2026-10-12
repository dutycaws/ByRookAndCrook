import { describe, expect, it } from 'vitest';
import { createNpcSheet } from '../../src/lib/game/community-npc-ui';
import { fromGuidedNpcSheet, newGuidedEntity, newGuidedFact, newGuidedMilestone, newInitialPersonalityEntry, npcSheetFromAuthoringForm, removeGuidedEntity, removeGuidedNpcReference, toGuidedNpcSheet } from '../../src/lib/game/npc-sheet-editor';
import { validateNpcSheet } from '../../src/lib/game/npc-sheet';

const lira = '18181818-1818-4181-8181-181818181818';

describe('npc-sheet-v2 guided editor codec', () => {
  it('round-trips V2 personality dimensions, collections, and typed entries without a V1 conversion', () => {
    const original = createNpcSheet('Mara Reed'); const roundTrip = fromGuidedNpcSheet(toGuidedNpcSheet(original));
    expect(roundTrip).toEqual(original); expect(validateNpcSheet(roundTrip)).toEqual([]);
  });

  it('preserves authored first-quest keepsakes and gated setback warnings while editing a sheet', () => {
    const original = createNpcSheet('Mara Reed');
    original.campaign.initialQuestTrinket = {
      catalogId: 'harvest_quality', artworkId: 'seed-glass', name: 'Glass Seed',
      dedication: 'A little green promise carried safely through the longest road home.'
    };
    const finalChapter = original.campaign.milestones[1];
    finalChapter.permanentLoss = {
      kind: 'departed', warning: 'A clear last warning before the character takes another road.',
      outcome: 'They leave the tavern to return to the northern road.'
    };
    finalChapter.failureCondition = { type: 'attempt_allowance_exhausted', maxAttempts: 3 };
    finalChapter.warnings = [
      { afterSetbacks: 1, text: 'The first setback warns that another failure may force a change of course.' },
      { afterSetbacks: 2, text: 'Another setback warns that this chapter could end for good.' }
    ];

    const roundTrip = fromGuidedNpcSheet(toGuidedNpcSheet(original));
    expect(roundTrip).toEqual(original);
    expect(validateNpcSheet(roundTrip)).toEqual([]);

    const form = new FormData();
    form.set('name', 'Mara Reed, Road Guide');
    form.set('initialQuestTrinket', JSON.stringify(original.campaign.initialQuestTrinket));
    form.set('milestones', JSON.stringify(original.campaign.milestones));
    const edited = npcSheetFromAuthoringForm(form, original);
    expect(edited.identity.name).toBe('Mara Reed, Road Guide');
    expect(edited.campaign.initialQuestTrinket).toEqual(original.campaign.initialQuestTrinket);
    expect(edited.campaign.milestones).toEqual(original.campaign.milestones);
  });

  it('adds stable authorable typed entries and preserves active published defaults', () => {
    const guided = toGuidedNpcSheet(createNpcSheet()); const entry = newInitialPersonalityEntry(guided, 'fear');
    expect(entry).toMatchObject({ id: 'new_fear', kind: 'fear', core: false, active: true });
    guided.personality.initialEntries.push(entry);
    expect(fromGuidedNpcSheet(guided).personality.initialEntries.at(-1)).toEqual(entry);
  });

  it('keeps generated IDs and blocks entity deletion until linked content is removed', () => {
    const guided = toGuidedNpcSheet(createNpcSheet()); const entity = newGuidedEntity(guided); const fact = newGuidedFact(guided); const milestone = newGuidedMilestone(guided);
    expect([entity.id, fact.id, milestone.id]).toEqual(['new-detail', 'new-fact', 'new-chapter']);
    guided.world.entities.push(entity); guided.world.facts.push({ ...fact, entityRefs: [entity.id] });
    expect(removeGuidedEntity(guided, entity.id)).toMatchObject({ ok: false });
    guided.world.facts[0].entityRefs = []; expect(removeGuidedEntity(guided, entity.id)).toEqual({ ok: true });
  });

  it('removes linked NPC references from each guided section', () => {
    const guided = toGuidedNpcSheet(createNpcSheet()); guided.world.npcReferences = [lira]; guided.world.facts.push({ ...newGuidedFact(guided), npcRefs: [lira] });
    removeGuidedNpcReference(guided, lira); const output = fromGuidedNpcSheet(guided);
    expect(output.lore.npcReferences).toEqual([]); expect(output.lore.facts[0].npcRefs).toEqual([]);
  });

  it('reads the V2 structured personality field from an authoring form', () => {
    const original = createNpcSheet(); const form = new FormData(); form.set('personality', JSON.stringify(original.personality)); form.set('appearance', JSON.stringify(original.appearance)); form.set('skills', JSON.stringify(original.skills));
    expect(npcSheetFromAuthoringForm(form, original).personality).toEqual(original.personality);
  });
});
