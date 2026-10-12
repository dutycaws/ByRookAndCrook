import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import NpcHistory from '$lib/components/tavern/NpcHistory.svelte';
import type { Journal } from '$lib/game/dialogue';
import type { ServeReceipt } from '$lib/game/serving';

const instanceId = '11111111-1111-4111-8111-111111111111';
const otherInstanceId = '22222222-2222-4222-8222-222222222222';

const journal: Journal = {
  instanceId,
  npcId: '33333333-3333-4333-8333-333333333333',
  sequence: 1,
  availability: 'departed',
  questLifecycleStatus: 'departed',
  currentQuest: null,
  questHistory: [],
  questArchive: {
    items: [{
      id: 'quest-old-road',
      origin: 'authored_milestone',
      title: 'The Old Road',
      objective: 'Find a safe route through the pass.',
      outcome: 'succeeded',
      activationDay: 2,
      terminalDay: 4,
      events: [{ id: 'event-road', day: 4, outcome: 'succeeded', text: 'The route is safe.', publicNews: true }]
    }],
    nextCursor: 'older-quest-cursor'
  },
  farewellText: 'I will remember the warm room.',
  turns: [{ id: 'turn-1', message: 'How is the road?', reply: 'Clear beyond the ridge.', day: 4 }],
  pending: null,
  disposition: { summary: 'More at ease after the journey.', state: 'settled', version: 'public-v1' },
  evolution: [{ day: 4, profileRevision: 1, createdAt: '2026-10-01T00:00:00Z', disposition: { summary: 'More at ease after the journey.', state: 'settled', version: 'public-v1' } }]
};

function receipt(overrides: Partial<ServeReceipt> = {}): ServeReceipt {
  return {
    actionId: 'action-1',
    instanceId,
    itemKind: 'beverage',
    itemId: 'item-1',
    itemName: 'Honest Mead',
    qualityIndex: 3,
    goldEarned: 5,
    goldBalance: 12,
    relationshipChange: 1,
    relationship: 42,
    dayNumber: 4,
    committedRevision: 7,
    rulesVersion: 'hospitality-v1',
    ...overrides
  };
}

describe('NpcHistory', () => {
  it('renders the same resident-safe journal, conversations, and matching hospitality outcomes', () => {
    const { body } = render(NpcHistory, {
      props: {
        name: 'Mara Vale',
        instanceId,
        journal,
        description: 'A traveler who knows the mountain paths.',
        relationshipStage: 'familiar',
        archiveHref: '/codex?resident=example&questCursor=older',
        history: [receipt(), receipt({ actionId: 'other-action', instanceId: otherInstanceId, itemName: 'Other resident meal' })]
      }
    });

    expect(body).toContain('Journal');
    expect(body).toContain('Departed');
    expect(body).toContain('familiar');
    expect(body).toContain('The Old Road');
    expect(body).toContain('The route is safe.');
    expect(body).toContain('Clear beyond the ridge.');
    expect(body).toContain('Honest Mead');
    expect(body).toContain('Decent quality');
    expect(body).toContain('+5 gold · +1 relationship');
    expect(body).toContain('Earlier quest records');
    expect(body).not.toContain('Other resident meal');
    expect(body).not.toContain('hospitality-v1');
  });

  it('keeps a missing journal readable as an explicit retry-later state', () => {
    const { body } = render(NpcHistory, { props: { name: 'Mara Vale', instanceId, journal: null, history: [] } });
    expect(body).toContain('journal is unavailable right now');
    expect(body).toContain('Try again later');
  });
});
