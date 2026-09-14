import { describe, expect, it } from 'vitest';
import { parsePublicWorldCodex, publicCodexGroup } from '$lib/game/evolving-world';

const entityId = '11111111-1111-4111-8111-111111111111';
const residentId = '22222222-2222-4222-8222-222222222222';
const projection = {
  version: 'world-public-codex-v1',
  entities: [{ id: entityId, kind: 'location', title: 'Old Mill', summary: 'A weathered landmark on the north road.', day: 3, provenance: { kind: 'canonical_discovery', day: 3 } }],
  publicEvents: [{ id: entityId, templateKey: 'market-day', title: 'Market day returns', summary: 'Merchants gather by the old mill.', day: 3, provenance: { kind: 'procedural_public_event', day: 3 } }],
  dispositions: [{ instanceId: residentId, name: 'Keeper Rowan', title: 'Scout', state: 'changed', summary: 'Rowan has become more watchful.', day: 3, provenance: { kind: 'resident_evolution', day: 3, profileRevision: 2 } }]
};

describe('public world codex projection', () => {
  it('parses only the exact player-safe allow-list', () => {
    expect(parsePublicWorldCodex(projection)).toEqual(projection);
    expect(publicCodexGroup('location')).toBe('locations');
    expect(publicCodexGroup('npc')).toBe('people');
  });

  it('accepts a generated entity only through explicit public-outcome provenance', () => {
    const parsed = parsePublicWorldCodex({
      ...projection,
      entities: [{ ...projection.entities[0], provenance: { kind: 'procedural_entity_outcome', day: 3 } }]
    });
    expect(parsed.entities[0].provenance.kind).toBe('procedural_entity_outcome');
  });

  it('rejects private or operational fields rather than silently passing them through', () => {
    expect(() => parsePublicWorldCodex({ ...projection, jobs: [] })).toThrow('Invalid world codex projection');
    expect(() => parsePublicWorldCodex({ ...projection, entities: [{ ...projection.entities[0], payload: { private: true } }] })).toThrow('Invalid world codex projection');
    expect(() => parsePublicWorldCodex({ ...projection, dispositions: [{ ...projection.dispositions[0], provenance: { kind: 'resident_evolution', day: 3, profileRevision: 2, fingerprint: 'secret' } }] })).toThrow('Invalid world codex projection');
  });
});
