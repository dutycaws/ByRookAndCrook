import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOCAL_SCENE_RUNTIME_ASSET_BUCKET,
  LOCAL_SCENE_RUNTIME_ASSET_DIRECTORY,
  SCENE_RUNTIME_ASSETS,
  sceneRuntimeAssetPublicUrl,
  sceneRuntimeAssetsFor
} from '../../src/lib/game/scene-runtime-assets.js';
import { deriveLocalSceneRuntimeAssets } from '../../scripts/local-scene-runtime-assets.js';

describe('local layered-scene asset contract', () => {
  it('keeps all issue #24 art local-only and exposes stable local Storage URLs', () => {
    expect(LOCAL_SCENE_RUNTIME_ASSET_BUCKET).toBe('prototype-runtime-media');
    expect(LOCAL_SCENE_RUNTIME_ASSET_DIRECTORY).toBe('.local/media/runtime-derivatives/scene-compositions');
    expect(SCENE_RUNTIME_ASSETS.map((asset) => asset.id)).toEqual([
      'shop-background', 'shop-elara', 'shop-counter-occlusion',
      'bar-background', 'bar-lira', 'bar-torvin', 'bar-counter-occlusion'
    ]);
    expect(sceneRuntimeAssetPublicUrl('bar-lira', undefined)).toBeNull();
    expect(sceneRuntimeAssetPublicUrl('bar-lira', 'https://example.supabase.co')).toBeNull();
    expect(sceneRuntimeAssetPublicUrl('bar-lira', 'http://127.0.0.1:57321')).toBe(
      'http://127.0.0.1:57321/storage/v1/object/public/prototype-runtime-media/scenes/bar/v1/bar-lira.webp'
    );
  });

  it('declares exact design-plane derivatives with real-alpha foreground and sprites', () => {
    expect(sceneRuntimeAssetsFor('shop').map((asset) => [asset.id, asset.width, asset.height, asset.alpha])).toEqual([
      ['shop-background', 1200, 900, false], ['shop-elara', 600, 900, true], ['shop-counter-occlusion', 1200, 350, true]
    ]);
    expect(sceneRuntimeAssetsFor('bar').map((asset) => [asset.id, asset.width, asset.height, asset.alpha])).toEqual([
      ['bar-background', 1672, 941, false], ['bar-lira', 600, 900, true], ['bar-torvin', 600, 900, true], ['bar-counter-occlusion', 1672, 460, true]
    ]);
  });

  it('makes a clean checkout recoverable when local source masters are absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brac-scene-assets-'));
    try {
      await expect(deriveLocalSceneRuntimeAssets(root)).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
