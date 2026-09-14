import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSnapshot = vi.fn();
const resolvePublicRuntimeArtPreviews = vi.fn();
vi.mock('$lib/server/game', () => ({ getSnapshot }));
vi.mock('$lib/server/evolving-world-art/public-preview', () => ({ resolvePublicRuntimeArtPreviews }));

const saveId = '33333333-3333-4333-8333-333333333333';
const entityId = '44444444-4444-4444-8444-444444444444';
const secondEntityId = '55555555-5555-4555-8555-555555555555';
const projection = {
  version: 'world-public-codex-v1',
  entities: [{ id: entityId, kind: 'location', title: 'Old Mill', summary: 'A landmark.', day: 2, provenance: { kind: 'canonical_discovery', day: 2 } }],
  publicEvents: [], dispositions: []
};

describe('world codex page load', () => {
  beforeEach(() => getSnapshot.mockReset());

  it('loads the owner save server-side and exposes only the parsed public projection', async () => {
    getSnapshot.mockResolvedValue({ save: { id: saveId } });
    const { load } = await import('../../src/routes/(game)/codex/+page.server');
    resolvePublicRuntimeArtPreviews.mockReset().mockResolvedValue(new Map([[entityId, { status: 'accepted', placeholder: { style: 'world-runtime-art-v1' }, mimeType: 'image/png', previewUrl: 'https://signed.test/opaque' }]]));
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: projection, error: null })
      .mockResolvedValueOnce({ data: [{ entityId, appearanceVersion: 'world-v1', status: 'accepted', placeholder: { style: 'world-runtime-art-v1' }, render: { renderId: saveId, mimeType: 'image/png' } }], error: null });
    const headers = vi.fn();
    const result = await load({ locals: { getVerifiedUser: async () => ({ id: 'keeper' }), supabase: { rpc } }, setHeaders: headers } as any);
    expect(headers).toHaveBeenCalledWith({ 'cache-control': 'private, no-store' });
    expect(rpc).toHaveBeenNthCalledWith(1, 'world_public_codex', { p_save_id: saveId });
    expect(rpc).toHaveBeenNthCalledWith(2, 'world_runtime_art_projection', { p_save_id: saveId });
    expect(resolvePublicRuntimeArtPreviews).toHaveBeenCalledWith(expect.anything(), saveId, [{ entityId, appearanceVersion: 'world-v1', status: 'accepted', placeholder: { style: 'world-runtime-art-v1' }, renderId: saveId, mimeType: 'image/png' }]);
    expect(result).toEqual({ snapshot: { save: { id: saveId } }, codex: { ...projection, entities: [{ ...projection.entities[0], art: { status: 'accepted', placeholder: { style: 'world-runtime-art-v1' }, mimeType: 'image/png', previewUrl: 'https://signed.test/opaque' } }] } });
    expect(JSON.stringify(result)).not.toContain('payload');
    expect(JSON.stringify(result)).not.toContain('renderId');
  });

  it('keeps malformed art data as a stable placeholder instead of failing the codex', async () => {
    getSnapshot.mockResolvedValue({ save: { id: saveId } });
    resolvePublicRuntimeArtPreviews.mockReset().mockResolvedValue(new Map());
    const { load } = await import('../../src/routes/(game)/codex/+page.server');
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: projection, error: null })
      .mockResolvedValueOnce({ data: [{ entityId, status: 'accepted', promptHash: 'private' }], error: null });
    const result = await load({ locals: { getVerifiedUser: async () => ({ id: 'keeper' }), supabase: { rpc } }, setHeaders: vi.fn() } as any) as any;
    expect(result.codex.entities[0].art).toEqual({ status: 'placeholder', placeholder: { style: 'world-runtime-art-v1' } });
    expect(resolvePublicRuntimeArtPreviews).toHaveBeenCalledWith(expect.anything(), saveId, []);
  });

  it('resolves bounded art previews in public codex order', async () => {
    getSnapshot.mockResolvedValue({ save: { id: saveId } });
    resolvePublicRuntimeArtPreviews.mockReset().mockResolvedValue(new Map());
    const { load } = await import('../../src/routes/(game)/codex/+page.server');
    const orderedProjection = {
      ...projection,
      entities: [
        projection.entities[0],
        { id: secondEntityId, kind: 'npc', title: 'Mara Vale', summary: 'A traveler.', day: 3, provenance: { kind: 'canonical_discovery', day: 3 } }
      ]
    };
    const firstArt = { entityId, appearanceVersion: 'world-v1', status: 'accepted', placeholder: { style: 'world-runtime-art-v1' }, render: { renderId: saveId, mimeType: 'image/png' } };
    const secondArt = { entityId: secondEntityId, appearanceVersion: 'world-v2', status: 'accepted', placeholder: { style: 'world-runtime-art-v1' }, render: { renderId: secondEntityId, mimeType: 'image/png' } };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: orderedProjection, error: null })
      .mockResolvedValueOnce({ data: [secondArt, firstArt], error: null });

    await load({ locals: { getVerifiedUser: async () => ({ id: 'keeper' }), supabase: { rpc } }, setHeaders: vi.fn() } as any);

    expect(resolvePublicRuntimeArtPreviews).toHaveBeenCalledWith(expect.anything(), saveId, [
      { entityId, appearanceVersion: 'world-v1', status: 'accepted', placeholder: { style: 'world-runtime-art-v1' }, renderId: saveId, mimeType: 'image/png' },
      { entityId: secondEntityId, appearanceVersion: 'world-v2', status: 'accepted', placeholder: { style: 'world-runtime-art-v1' }, renderId: secondEntityId, mimeType: 'image/png' }
    ]);
  });

  it('keeps a player without a tavern on the safe placeholder path', async () => {
    getSnapshot.mockResolvedValue(null);
    const { load } = await import('../../src/routes/(game)/codex/+page.server');
    const rpc = vi.fn();
    await expect(load({ locals: { getVerifiedUser: async () => ({ id: 'keeper' }), supabase: { rpc } }, setHeaders: vi.fn() } as any))
      .resolves.toEqual({ snapshot: null, codex: null });
    expect(rpc).not.toHaveBeenCalled();
  });
});
