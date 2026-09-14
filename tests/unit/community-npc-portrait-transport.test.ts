import { describe, expect, it } from 'vitest';
import { portraitJobIsTerminal, safePortraitJobSnapshot } from '$lib/server/community-npc-workspace';
import { decodeAuthoringWorkspace } from '$lib/game/authoring-workspace';
import { createNpcSheet } from '$lib/game/community-npc-ui';
import { portraitJobEventSnapshot, portraitJobSnapshot } from '../../src/lib/server/community-npc-jobs/portrait-status';
import { _applyExpressionSpriteWorkspace } from '../../src/routes/(game)/authoring/npcs/[npcId]/+page.server';

describe('portrait job transport boundary', () => {
  it('keeps the polling snapshot useful while stripping private job fields', () => {
    const snapshot = safePortraitJobSnapshot({
      jobId: '11111111-1111-4111-8111-111111111111', slot: 'happy', status: 'running',
      visualInputHash: 'never-expose', prompt: 'private prompt', storageKey: 'private/key.webp',
      alternatives: [{ ordinal: 1, stage: 'generating', status: 'dispatched', candidateId: '22222222-2222-4222-8222-222222222222', errorCode: null, leaseToken: 'secret' }],
      candidates: [{
        candidateId: '22222222-2222-4222-8222-222222222222', slot: 'happy', source: 'ai_generated', state: 'ready',
        previewToken: 'opaque-but-private', visualInputHash: 'never-expose', masterStorageKey: 'private/master.png',
        altText: 'A warm expression sprite.', width: 1024, height: 1536, hasAlpha: true, mimeType: 'image/webp', staleNeutralAnchor: false
      }]
    });
    expect(snapshot).toEqual({
      jobId: '11111111-1111-4111-8111-111111111111', slot: 'happy', status: 'running', pollAfterMs: 2_000,
      alternatives: [{ ordinal: 1, stage: 'generating', status: 'dispatched', candidateId: '22222222-2222-4222-8222-222222222222', errorCode: null }],
      candidates: [{
        candidateId: '22222222-2222-4222-8222-222222222222', slot: 'happy', source: 'ai_generated', state: 'ready', previewUrl: null,
        altText: 'A warm expression sprite.', width: 1024, height: 1536, hasAlpha: true, mimeType: 'image/webp', staleNeutralAnchor: false
      }]
    });
    expect(JSON.stringify(snapshot)).not.toContain('private');
    expect(JSON.stringify(snapshot)).not.toContain('never-expose');
    expect(JSON.stringify(snapshot)).not.toContain('opaque-but-private');
  });

  it('recognizes every terminal status so SSE can close and polling can stop', () => {
    for (const status of ['completed', 'failed', 'cancelled', 'expired']) expect(portraitJobIsTerminal(status)).toBe(true);
    expect(portraitJobIsTerminal('running')).toBe(false);
  });

  it('rejects a same-owner job addressed through a different NPC path before preview authorization', async () => {
    const calls: string[] = [];
    const locals = {
      supabase: {
        rpc: async (name: string) => {
          calls.push(name);
          if (name === 'npc_profile_me') return { data: { id: 'keeper' }, error: null };
          if (name === 'npc_my_capabilities') return { data: ['npc_author'], error: null };
          if (name === 'npc_author_portrait_status') return {
            data: { jobId: '11111111-1111-4111-8111-111111111111', npcId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slot: 'neutral', status: 'running', alternatives: [], candidates: [] }, error: null
          };
          throw new Error(`unexpected RPC: ${name}`);
        }
      },
      getVerifiedUser: async () => ({ id: 'keeper' })
    } as unknown as App.Locals;
    await expect(portraitJobSnapshot(locals, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111')).resolves.toBeNull();
    expect(calls).toEqual(['npc_profile_me', 'npc_my_capabilities', 'npc_author_portrait_status']);
  });

  it('uses an event-only job read without redeeming preview grants', async () => {
    const calls: string[] = [];
    const locals = {
      supabase: {
        rpc: async (name: string) => {
          calls.push(name);
          if (name === 'npc_profile_me') return { data: { id: 'keeper' }, error: null };
          if (name === 'npc_my_capabilities') return { data: ['npc_author'], error: null };
          if (name === 'npc_author_portrait_event_status') return {
            data: {
              jobId: '11111111-1111-4111-8111-111111111111', npcId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slot: 'happy', status: 'running',
              alternatives: [{ ordinal: 1, stage: 'generating', status: 'dispatched', candidateId: 'candidate', errorCode: null }]
            }, error: null
          };
          throw new Error(`preview RPC should not run: ${name}`);
        }
      }, getVerifiedUser: async () => ({ id: 'keeper' })
    } as unknown as App.Locals;
    await expect(portraitJobEventSnapshot(locals, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111')).resolves.toEqual({
      jobId: '11111111-1111-4111-8111-111111111111', slot: 'happy', status: 'running',
      alternatives: [{ ordinal: 1, stage: 'generating', status: 'dispatched', candidateId: 'candidate', errorCode: null }]
    });
    expect(calls).toEqual(['npc_profile_me', 'npc_my_capabilities', 'npc_author_portrait_event_status']);
  });

  it('overlays a selected optional slot and retains a Neutral fallback after reload', () => {
    const detail = decodeAuthoringWorkspace({
      npcId: 'npc', draft: { id: 'draft', revision: 3, lifecycle: 'open', editable: true, sheet: createNpcSheet('Mira') },
      capabilities: {}, scenes: { selectedAssetId: null, candidates: [] }, assistance: [], versions: [], retirement: null, eligibleNpcs: [], sandbox: {}, portrait: { candidates: [] }
    }, { available: true, reason: null });
    _applyExpressionSpriteWorkspace(detail, {
      revision: 3, editable: true,
      selectedCandidateIds: { neutral: 'neutral-candidate', happy: 'happy-candidate' },
      resolvedCandidateIds: { neutral: 'neutral-asset', happy: 'happy-asset', sad: 'neutral-asset' },
      candidates: [
        { id: 'neutral-candidate', assetId: 'neutral-asset', ordinal: 1, slot: 'neutral', source: 'author_upload', state: 'selected', previewUrl: '/portrait/neutral', altText: 'Neutral Mira', width: 1024, height: 1536, hasAlpha: true, mimeType: 'image/webp', staleNeutralAnchor: false },
        { id: 'happy-candidate', assetId: 'happy-asset', ordinal: 1, slot: 'happy', source: 'ai_generated', state: 'selected', previewUrl: '/portrait/happy', altText: 'Happy Mira', width: 1024, height: 1536, hasAlpha: true, mimeType: 'image/webp', staleNeutralAnchor: false }
      ], activeBatch: null, remainingCredits: 8
    });
    expect(detail.portrait.selectedCandidateIds).toEqual({ neutral: 'neutral-candidate', happy: 'happy-candidate' });
    expect(detail.portrait.resolvedCandidateIds).toMatchObject({ happy: 'happy-asset', sad: 'neutral-asset' });
    expect(detail.portrait.candidates.map((candidate) => candidate.slot)).toEqual(['neutral', 'happy']);
  });
});
