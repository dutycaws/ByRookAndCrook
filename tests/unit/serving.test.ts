import { describe, expect, it } from 'vitest';
import type { Json } from '../../src/lib/database.types';
import { parseBarSnapshot } from '../../src/lib/game/serving';

const snapshot = {
  save: { id: crypto.randomUUID(), revision: 1, gold: 20, currentDay: 1 },
  roster: [{
    instanceId: crypto.randomUUID(), npcId: crypto.randomUUID(), versionId: crypto.randomUUID(),
    name: 'Ada Bramble', title: 'Wayfinder', description: 'A careful traveler.', relationship: 25,
    status: 'active', rating: 'standard', origin: 'community', sceneStorageKey: null,
    creator: { displayName: 'Keeper One', profile: 'keeper-one' }, sequence: 0
  }],
  offerings: { beverages: [], foods: [], intentCards: [] },
  recent: { hospitality: [], news: [], latestArrival: null }
};

describe('bar snapshot boundary', () => {
  it('accepts a generated promoted resident through the same roster contract', () => {
    const promoted: any = structuredClone(snapshot);
    promoted.roster[0]!.origin = 'procedural';
    promoted.roster[0]!.creator = null;
    expect(parseBarSnapshot(promoted as Json)?.roster[0]).toMatchObject({ origin: 'procedural', rating: 'standard' });
  });

  it('rejects malformed resident projections', () => {
    const malformed = structuredClone(snapshot);
    malformed.roster[0]!.rating = 'general';
    expect(() => parseBarSnapshot(malformed as Json)).toThrow('Invalid bar snapshot');
  });
});
