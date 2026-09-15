import { error } from '@sveltejs/kit';
import { getSnapshot } from '$lib/server/game';
import { parsePublicWorldCodex, parseRuntimeArtProjection, publicCodexArtPlaceholder } from '$lib/game/evolving-world';
import { resolvePublicRuntimeArtPreviews } from '$lib/server/evolving-world-art/public-preview';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  const user = await locals.getVerifiedUser();
  if (!user) error(401, 'Sign in to read the codex.');
  setHeaders({ 'cache-control': 'private, no-store' });

  try {
    const snapshot = await getSnapshot(locals.supabase);
    if (!snapshot) return { snapshot: null, codex: null };
    const rpc = locals.supabase.rpc.bind(locals.supabase) as any;
    const result = await rpc('world_public_codex', { p_save_id: snapshot.save.id });
    if (result.error) throw result.error;
    const codex = parsePublicWorldCodex(result.data);
    const artResult = await rpc('world_runtime_art_projection', { p_save_id: snapshot.save.id });
    const projections = !artResult || artResult.error ? [] : parseRuntimeArtProjection(artResult.data);
    const projectionByEntityId = new Map(projections.map((projection) => [projection.entityId, projection]));
    const art = await resolvePublicRuntimeArtPreviews(locals.supabase, snapshot.save.id, codex.entities.flatMap((entity) => {
      const projection = projectionByEntityId.get(entity.id);
      return projection ? [projection] : [];
    }));
    return { snapshot, codex: { ...codex, entities: codex.entities.map((entity) => ({ ...entity, art: art.get(entity.id) ?? publicCodexArtPlaceholder() })) } };
  } catch (cause) {
    console.error('world_public_codex_failed', { cause: cause instanceof Error ? cause.name : 'unknown' });
    error(500, 'The world codex is unavailable. Please try again.');
  }
};
