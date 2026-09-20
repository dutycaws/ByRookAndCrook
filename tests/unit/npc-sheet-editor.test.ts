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
