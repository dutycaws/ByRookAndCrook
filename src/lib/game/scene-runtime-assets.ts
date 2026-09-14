import { LOCAL_SHOP_RUNTIME_ASSET_BUCKET } from './shop-runtime-assets.js';

/**
 * Optional scene-composition artwork for local prototype fixtures. The source
 * masters and derived bytes stay in `.local`; a fresh checkout intentionally
 * returns null so the compositor can render its styled fallback surface.
 */
export const LOCAL_SCENE_RUNTIME_ASSET_BUCKET = LOCAL_SHOP_RUNTIME_ASSET_BUCKET;
export const LOCAL_SCENE_RUNTIME_ASSET_DIRECTORY = '.local/media/runtime-derivatives/scene-compositions';

export const SCENE_RUNTIME_ASSETS = [
  { id: 'shop-background', scene: 'shop', filename: 'shop/v1/shop-background.webp', key: 'scenes/shop/v1/shop-background.webp', width: 1200, height: 900, alpha: false },
  { id: 'shop-elara', scene: 'shop', filename: 'shop/v1/shop-elara.webp', key: 'scenes/shop/v1/shop-elara.webp', width: 600, height: 900, alpha: true },
  { id: 'shop-counter-occlusion', scene: 'shop', filename: 'shop/v1/shop-counter-occlusion.webp', key: 'scenes/shop/v1/shop-counter-occlusion.webp', width: 1200, height: 350, alpha: true },
  { id: 'bar-background', scene: 'bar', filename: 'bar/v1/bar-background.webp', key: 'scenes/bar/v1/bar-background.webp', width: 1672, height: 941, alpha: false },
  { id: 'bar-lira', scene: 'bar', filename: 'bar/v1/bar-lira.webp', key: 'scenes/bar/v1/bar-lira.webp', width: 600, height: 900, alpha: true },
  { id: 'bar-torvin', scene: 'bar', filename: 'bar/v1/bar-torvin.webp', key: 'scenes/bar/v1/bar-torvin.webp', width: 600, height: 900, alpha: true },
  { id: 'bar-counter-occlusion', scene: 'bar', filename: 'bar/v1/bar-counter-occlusion.webp', key: 'scenes/bar/v1/bar-counter-occlusion.webp', width: 1672, height: 460, alpha: true }
] as const;

export type SceneRuntimeAssetId = (typeof SCENE_RUNTIME_ASSETS)[number]['id'];
export type SceneRuntimeAsset = (typeof SCENE_RUNTIME_ASSETS)[number];

function isLocalSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '57321';
  } catch {
    return false;
  }
}

/** Returns an optional fixture URL and never points production clients at local media. */
export function sceneRuntimeAssetPublicUrl(id: SceneRuntimeAssetId, supabaseUrl: string | null | undefined): string | null {
  const asset = SCENE_RUNTIME_ASSETS.find((candidate) => candidate.id === id);
  if (!asset || !supabaseUrl || !isLocalSupabaseUrl(supabaseUrl)) return null;
  return new URL(`/storage/v1/object/public/${LOCAL_SCENE_RUNTIME_ASSET_BUCKET}/${asset.key}`, supabaseUrl).toString();
}

export function sceneRuntimeAssetsFor(scene: 'shop' | 'bar'): readonly SceneRuntimeAsset[] {
  return SCENE_RUNTIME_ASSETS.filter((asset) => asset.scene === scene);
}
