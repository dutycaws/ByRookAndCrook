import { describe, expect, it } from 'vitest';
import { parsePublicSettlementStatus } from '$lib/game/evolving-world';
import { GET } from '../../src/routes/api/world-settlements/[settlementId]/+server';

const settlementId = '11111111-1111-4111-8111-111111111111';
const saveId = '22222222-2222-4222-8222-222222222222';

function rawStatus(overrides: Record<string, unknown> = {}) {
  return {
    id: settlementId,
    dayNumber: 3,
    status: 'processing',
    deadlineAt: '2026-09-14T12:00:00.000Z',
    failureCode: null,
    skipReason: null,
    publicDigest: 'The tavern settles for the evening.',
    publicSummary: null,
    morningNews: null,
    progress: { completed: 2, total: 7 },
    ...overrides
  };
}

const barSnapshot = {
  save: { id: saveId, revision: 1, gold: 20, currentDay: 3 },
  roster: [],
  offerings: { beverages: [], foods: [], intentCards: [] },
  recent: { hospitality: [], news: [], latestArrival: null }
};

describe('public world settlement status', () => {
  it('uses an exact allow-list and omits operational failure fields', () => {
    const status = parsePublicSettlementStatus(rawStatus({
      status: 'failed', failureCode: 'provider_timeout', skipReason: 'deadline_noop'
    }));
    expect(status).toEqual({
      id: settlementId, dayNumber: 3, status: 'unavailable', progress: { completed: 2, total: 7 },
      publicDigest: null, publicSummary: null, morningNews: null
    });
    expect(JSON.stringify(status)).not.toContain('provider_timeout');
    expect(() => parsePublicSettlementStatus({ ...rawStatus(), fence: 'private' })).toThrow('Invalid settlement status');
    expect(() => parsePublicSettlementStatus(rawStatus({ progress: { completed: 8, total: 7 } }))).toThrow('Invalid settlement status');
  });

  it('loads the authenticated player save server-side and returns only the public projection', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const supabase = {
      rpc: async (name: string, args?: unknown) => {
        calls.push({ name, args });
        if (name === 'npc_bar_summary') return { data: barSnapshot, error: null };
        if (name === 'world_settlement_status') return { data: rawStatus({ status: 'expired', failureCode: 'private' }), error: null };
        return { data: null, error: { message: 'Unexpected RPC' } };
      }
    };
    const response = await GET({
      locals: { getVerifiedUser: async () => ({ id: 'keeper' }), supabase },
      params: { settlementId },
    } as any);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      settlement: expect.objectContaining({ id: settlementId, status: 'unavailable', publicDigest: null })
    });
    expect(calls).toEqual([
      { name: 'npc_bar_summary', args: undefined },
      { name: 'world_settlement_status', args: { p_save_id: saveId, p_settlement_id: settlementId } }
    ]);
  });

  it('rejects malformed settlement identifiers before any database access', async () => {
    let called = false;
    const response = await GET({
      locals: { getVerifiedUser: async () => ({ id: 'keeper' }), supabase: { rpc: async () => { called = true; return { data: null, error: null }; } } },
      params: { settlementId: 'not-a-uuid' }
    } as any);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(called).toBe(false);
  });
});
