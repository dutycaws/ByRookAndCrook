import { describe, expect, it } from 'vitest';
import { canonicalNpcSheet, milestoneIntention, normalizeNpcName, validateNpcSheet, type NpcSheet } from '../../src/lib/game/npc-sheet';
import { applyNpcSection, npcContentHash } from '../../src/lib/server/npc-content';

function sheet(): NpcSheet {
  return {
    schemaVersion: 'npc-sheet-v1', rating: 'standard',
    identity: {
      name: 'Mara Reed', title: 'Roadside Scout',
      shortDescription: 'A patient local scout who watches the old road.',
      voice: 'Plain-spoken, observant, and careful with any promise she makes.'
    },
    appearance: {
      physicalAppearance: 'A wiry human traveler with wind-burned cheeks and steady grey eyes.',
      attire: 'A weathered green cloak over practical road leathers and worn boots.',
      notableFeatures: 'A small brass compass hangs at her belt beside a field notebook.',
      mood: 'Alert in crowds, at ease outdoors, and quietly amused by tavern boasting.'
    },
    personality: {
      values: ['Reliable evidence'], likes: ['Quiet roads'], dislikes: ['Careless accusations'], boundaries: ['Will not endanger civilians']
    },
    lore: {
      entities: [{ id: 'old-road', namespace: 'millhaven', name: 'Old Road', description: 'The wooded trade road east of Millhaven.' }],
      npcReferences: [],
      relationships: [{ subject: { kind: 'entity', entityId: 'old-road' }, description: 'Knows its hidden paths.', trustThreshold: 0 }],
      facts: [{ id: 'first-patrol', category: 'history', text: 'Mara learned the road while carrying messages as a child.', trustThreshold: 25, entityRefs: ['old-road'], npcRefs: [] }]
    },
    skills: { scouting: 4, combat: 3, diplomacy: 2, trade: 1 },
    campaign: {
      durableGoal: 'Keep travel between Millhaven and its neighbors safe and dependable.',
      milestones: [
        {
          id: 'map-road', title: 'Map the Old Road', outcome: 'Identify every unsafe stretch of the old road.',
          motivation: 'Travelers need a dependable map before anyone can secure the route.', constraints: ['Protect uninvolved travelers'],
          allowedTargets: ['old-road'], difficulty: 2,
          successNews: 'Mara returns with a reliable map of the old road and its hazards.',
          nonSuccessNews: 'Mara loses the trail, and the dangerous stretches remain unmapped.', retiredTargets: [], permanentLoss: null,
          startingPlan: [{ action: 'prepare', approach: 'scouting' }, { action: 'attempt', approach: 'scouting' }]
        },
        {
          id: 'secure-road', title: 'Secure the Route', outcome: 'Establish a lasting patrol along the old road.',
          motivation: 'A map only matters if someone uses it to keep travelers safe.', constraints: ['Work with local people'],
          allowedTargets: ['old-road'], difficulty: 3,
          successNews: 'A lasting patrol now keeps watch along the old road.',
          nonSuccessNews: 'The proposed patrol dissolves before it can secure the route.', retiredTargets: [], permanentLoss: null, startingPlan: null
        }
      ]
    }
  };
}

describe('NpcSheet', () => {
  it('accepts the shared campaign contract and derives the first intention', () => {
    const value = sheet();
    expect(validateNpcSheet(value)).toEqual([]);
    expect(milestoneIntention(value, 0)).toMatchObject({ goal: value.campaign.milestones[0].outcome, targets: ['old-road'] });
    expect(milestoneIntention(value, 1)).toBeNull();
  });

  it('enforces skill budget, campaign bounds, plan order, and references', () => {
    const value = sheet();
    value.skills.trade = 2;
    value.campaign.milestones[0].startingPlan = [{ action: 'attempt', approach: 'scouting' }, { action: 'wait', approach: 'scouting' }];
    value.lore.npcReferences = ['not-a-uuid'];
    value.lore.facts.push({ ...value.lore.facts[0] });
    value.lore.relationships[0].subject = { kind: 'entity', entityId: 'missing-place' };
    expect(validateNpcSheet(value).map((entry) => entry.code)).toEqual(expect.arrayContaining(['skill_budget', 'plan_terminal_order', 'plan_terminal_missing', 'npc_reference', 'fact', 'relationship']));
  });

  it('normalizes names and hashes canonical content deterministically', () => {
    const value = sheet();
    const reordered = Object.fromEntries(Object.entries(value).reverse()) as unknown as NpcSheet;
    expect(normalizeNpcName('  MÁRA   Reed ')).toBe('mára reed');
    expect(canonicalNpcSheet(value)).toContain('"schemaVersion":"npc-sheet-v1"');
    expect(npcContentHash(value)).toHaveLength(64);
    expect(npcContentHash(value)).toBe(npcContentHash(structuredClone(value)));
    expect(canonicalNpcSheet(reordered)).toBe(canonicalNpcSheet(value));
  });

  it('applies field assistance as a proposal without mutating the draft', () => {
    const original = sheet();
    const next = applyNpcSection(original, 'identity', { ...original.identity, title: 'Master Scout' });
    expect(next.identity.title).toBe('Master Scout');
    expect(original.identity.title).toBe('Roadside Scout');
  });
});
