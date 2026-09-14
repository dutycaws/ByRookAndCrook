import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSnapshot = vi.fn();
vi.mock('$lib/server/game', () => ({ getSnapshot }));

const saveId = '33333333-3333-4333-8333-333333333333';
const entityId = '44444444-4444-4444-8444-444444444444';
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
    const rpc = vi.fn().mockResolvedValue({ data: projection, error: null });
    const headers = vi.fn();
    const result = await load({ locals: { getVerifiedUser: async () => ({ id: 'keeper' }), supabase: { rpc } }, setHeaders: headers } as any);
    expect(headers).toHaveBeenCalledWith({ 'cache-control': 'private, no-store' });
    expect(rpc).toHaveBeenCalledWith('world_public_codex', { p_save_id: saveId });
    expect(result).toEqual({ snapshot: { save: { id: saveId } }, codex: projection });
    expect(JSON.stringify(result)).not.toContain('payload');
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
