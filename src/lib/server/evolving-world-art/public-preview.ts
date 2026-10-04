import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import type { Database } from '$lib/database.types';
import type { PublicCodexArt, RuntimeArtProjection } from '$lib/game/evolving-world';
import { getSupabaseConfig } from '$lib/server/config';
import { privateRuntimeEnvironment } from '$lib/server/private-runtime-environment';
import { authorizedRuntimeArtPreview, type RuntimeArtRpc, type RuntimeArtStorage } from './index';

type Viewer = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data?: unknown; error: { message: string } | null }> };
type Service = RuntimeArtRpc & { storage: RuntimeArtStorage };
const PREVIEW_BUDGET = 18;
const PREVIEW_CONCURRENCY = 3;

function serviceClient(): Service | null {
  const config = privateRuntimeEnvironment(env);
  if (!config.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient<Database>(getSupabaseConfig().url, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as Service;
}

const placeholder = (): PublicCodexArt => ({ status: 'placeholder', placeholder: { style: 'world-runtime-art-v1' } });

/** Resolves only already-validated opaque IDs; every failure remains a card-level placeholder. */
export async function resolvePublicRuntimeArtPreviews(viewer: Viewer, saveId: string, projections: RuntimeArtProjection[], runtime: { service?: Service | null } = {}): Promise<Map<string, PublicCodexArt>> {
  const output = new Map(projections.map((projection) => [projection.entityId, placeholder()]));
  if (projections.length === 0) return output;
  const service = runtime.service === undefined ? serviceClient() : runtime.service;
  if (!service) return output;
  const activeService = service;
  // Projection order comes from the public codex's entity order. Keep URL minting
  // bounded so a large history cannot fan out owner/service/storage requests.
  const candidates = projections.filter((projection) => projection.status === 'accepted' && projection.renderId).slice(0, PREVIEW_BUDGET);
  let next = 0;
  async function resolveOne(): Promise<void> {
    const projection = candidates[next++];
    if (!projection) return;
    try {
      const previewUrl = await authorizedRuntimeArtPreview(
        activeService.storage,
        viewer as unknown as RuntimeArtRpc,
        activeService,
        { saveId, entityId: projection.entityId, renderId: projection.renderId! }
      );
      if (previewUrl) output.set(projection.entityId, { status: 'accepted', placeholder: { style: 'world-runtime-art-v1' }, mimeType: 'image/png', previewUrl });
    } catch {
      // Private storage or a signing failure cannot make the codex unavailable.
    }
    await resolveOne();
  }
  await Promise.all(Array.from({ length: Math.min(PREVIEW_CONCURRENCY, candidates.length) }, () => resolveOne()));
  return output;
}
