import { describe, expect, it } from 'vitest';
import { decodeAuthoringWorkspace, normalizeAuthoringError, providerFailure } from '../../src/lib/game/authoring-workspace';
import { createNpcSheet } from '../../src/lib/game/community-npc-ui';

describe('authoring workspace view model', () => {
  it('decodes the active and preserved revision-pinned sandbox transcripts', () => {
    const sheet = createNpcSheet('Tormund');
    const detail = decodeAuthoringWorkspace({
      npcId: 'npc-id',
      draft: { id: 'draft-id', revision: 4, lifecycle: 'open', editable: true, sheet, fieldPaths: ['identity.name'] },
      capabilities: {
        canEdit: true, canSubmit: false, canRequestAssistance: true, canUseSandbox: true, canRequestRetirement: true,
        submitReason: 'Choose a scene before submitting.'
      },
      scenes: { selectedAssetId: null, candidates: [] },
      assistance: [], versions: [], retirement: null, eligibleNpcs: [],
      sandbox: {
        active: {
          id: 'active', draftRevision: 4, active: true, pending: false,
          turns: [
            { id: 'turn-1', ordinal: 1, role: 'keeper', content: 'What brought you here?', status: 'completed' },
            { id: 'turn-2', ordinal: 2, role: 'npc', content: 'A promise on the old road.', status: 'completed' }
          ]
        },
        preserved: [{
          id: 'old', draftRevision: 3, active: false, invalidatedAt: '2026-09-12T00:00:00Z', pending: false,
          turns: [{ id: 'old-turn', ordinal: 1, role: 'keeper', content: 'Earlier question', status: 'completed' }]
        }]
      }
    }, { available: true, reason: null });

    expect(detail.sandbox.active?.turns.map((turn) => turn.content)).toEqual([
      'What brought you here?', 'A promise on the old road.'
    ]);
    expect(detail.sandbox.preserved).toHaveLength(1);
    expect(detail.sandbox.preserved[0]).toMatchObject({ draftRevision: 3, active: false });
    expect(detail.capabilities.reasons.submit).toBe('Choose a scene before submitting.');
    expect(detail.preflight.some((issue) => issue.path === 'scene')).toBe(true);
  });

  it('turns section proposals into a readable comparison without exposing raw JSON to components', () => {
    const sheet = createNpcSheet('Tormund');
    const detail = decodeAuthoringWorkspace({
      npcId: 'npc-id', draft: { id: 'draft-id', revision: 2, lifecycle: 'open', editable: true, sheet },
      capabilities: {}, scenes: { selectedAssetId: null, candidates: [] }, eligibleNpcs: [], sandbox: { active: null, preserved: [] },
      versions: [], retirement: null,
      assistance: [{
        id: 'suggestion', sectionPath: 'identity', sourceRevision: 2, disposition: 'proposed', actionable: true,
        proposal: { replacement: { ...sheet.identity, title: 'Road Warden' }, explanation: 'Clarifies the role.' }
      }]
    }, { available: true, reason: null });

    expect(detail.assistance[0]).toMatchObject({ state: 'suggested', explanation: 'Clarifies the role.' });
    expect(detail.assistance[0].comparison.find((row) => row.label === 'Name and role')).toEqual({
      label: 'Name and role', current: ['Tormund', 'Wayfarer'], suggested: ['Tormund', 'Road Warden']
    });
  });

  it('normalizes database and provider failures into actionable categories', () => {
    expect(normalizeAuthoringError({ code: 'PT409', message: 'Draft revision changed' }, 'Failed')).toMatchObject({ category: 'stale_revision', status: 'stale', conflict: true });
    expect(normalizeAuthoringError({ code: 'PT422', message: 'Select a scene first' }, 'Failed')).toMatchObject({ category: 'missing_prerequisite', status: 'failure' });
    expect(providerFailure('provider_no_change')).toMatchObject({ category: 'provider_no_change' });
    expect(providerFailure('provider_unavailable')).toMatchObject({ category: 'provider_unavailable', status: 'unavailable' });
  });
});
