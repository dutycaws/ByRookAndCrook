import { describe, expect, it } from 'vitest';
import { resolvePublicRuntimeArtPreviews } from '$lib/server/evolving-world-art/public-preview';
import type { RuntimeArtProjection } from '$lib/game/evolving-world';

const saveId = '11111111-1111-4111-8111-111111111111';
const renderId = '22222222-2222-4222-8222-222222222222';
function uuid(index: number) { return `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`; }

describe('public runtime-art previews', () => {
  it('resolves only the first 18 codex-ordered accepted renders with bounded concurrency', async () => {
    let inFlight = 0; let maximum = 0; const ownerCalls: string[] = []; const serviceCalls: string[] = [];
    const viewer = { async rpc(_name: string, args: Record<string, unknown>) { ownerCalls.push(args.p_entity_id as string); return { data: { renderId }, error: null }; } };
    const service = {
      storage: { from: () => ({ async createSignedUrl() { maximum = Math.max(maximum, ++inFlight); await new Promise((resolve) => setTimeout(resolve, 1)); inFlight--; return { data: { signedUrl: 'https://signed.test/opaque' }, error: null }; } }) },
      async rpc(_name: string) { serviceCalls.push('key'); return { data: { runtimeKey: `accepted/${saveId}/world-v1/${'a'.repeat(64)}.png` }, error: null }; }
    };
    const projections: RuntimeArtProjection[] = Array.from({ length: 20 }, (_, index) => ({ entityId: uuid(index + 1), appearanceVersion: 'world-v1', status: 'accepted', placeholder: { style: 'world-runtime-art-v1' }, renderId, mimeType: 'image/png' }));
    const result = await resolvePublicRuntimeArtPreviews(viewer, saveId, projections, { service: service as any });
    expect(ownerCalls).toEqual(projections.slice(0, 18).map((projection) => projection.entityId));
    expect(serviceCalls).toHaveLength(18);
    expect(maximum).toBeLessThanOrEqual(3);
    expect(result.get(projections[17].entityId)?.status).toBe('accepted');
    expect(result.get(projections[18].entityId)).toEqual({ status: 'placeholder', placeholder: { style: 'world-runtime-art-v1' } });
    expect(result.get(projections[19].entityId)).toEqual({ status: 'placeholder', placeholder: { style: 'world-runtime-art-v1' } });
  });
});
