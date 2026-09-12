import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LOCAL_SHOP_RUNTIME_ASSET_BUCKET, LOCAL_SHOP_RUNTIME_ASSET_DIRECTORY, SHOP_RUNTIME_ASSETS, shopItemAssetPublicUrl, shopRuntimeAssetPublicUrl } from '../../src/lib/game/shop-runtime-assets.js';
import { assertLocalSupabaseUrl, seedLocalShopRuntimeAssets, type LocalAssetStorage, type ShopRuntimeAssetFixture } from '../../scripts/local-shop-runtime-assets.js';

const fixtureBytes = Buffer.from('generated-Shop-asset');
const fixtureAssets: ShopRuntimeAssetFixture[] = [{ id: 'fixture', filename: 'v1/sha256/aa/fixture.webp', key: 'shop/v1/sha256/aa/fixture.webp', sha256: createHash('sha256').update(fixtureBytes).digest('hex') }];

function fakeStorage(options: { corruptDownload?: boolean } = {}) {
  const objects = new Map<string, Buffer>();
  const uploads: Array<{ key: string; options: { contentType: string; cacheControl: string; upsert: boolean } }> = [];
  const storage: LocalAssetStorage = {
    async createBucket() { return { error: null }; },
    async updateBucket() { return { error: null }; },
    from(bucket) {
      expect(bucket).toBe(LOCAL_SHOP_RUNTIME_ASSET_BUCKET);
      return {
        async upload(key, body, uploadOptions) { objects.set(key, Buffer.from(body)); uploads.push({ key, options: uploadOptions }); return { error: null }; },
        async download(key) {
          const value = objects.get(key);
          return { data: value ? new Blob([options.corruptDownload ? 'tampered' : value.toString('utf8')]) : null, error: value ? null : { message: 'not found' } };
        }
      };
    }
  };
  return { storage, uploads };
}

describe('local Shop runtime asset fixture uploader', () => {
  it('rejects hosted endpoints and exposes no public URL without configuration', () => {
    expect(() => assertLocalSupabaseUrl('https://example.supabase.co')).toThrow('non-local');
    expect(assertLocalSupabaseUrl('http://127.0.0.1:57321').hostname).toBe('127.0.0.1');
    expect(shopRuntimeAssetPublicUrl('elara-counter-hero', undefined)).toBeNull();
    expect(shopRuntimeAssetPublicUrl('elara-counter-hero', 'https://example.supabase.co')).toBeNull();
    expect(shopRuntimeAssetPublicUrl('elara-counter-hero', 'http://127.0.0.1:57321')).toBe(`http://127.0.0.1:57321/storage/v1/object/public/${LOCAL_SHOP_RUNTIME_ASSET_BUCKET}/${SHOP_RUNTIME_ASSETS[0].key}`);
    expect(shopItemAssetPublicUrl('seed_clover', 'http://127.0.0.1:57321')).toContain(`/storage/v1/object/public/${LOCAL_SHOP_RUNTIME_ASSET_BUCKET}/shop/v1/sha256/62/`);
    expect(shopItemAssetPublicUrl('seed_hops', undefined)).toBe('/assets/scenes/garden/garden-crop-hops-stage-3.webp');
    expect(shopItemAssetPublicUrl('hive_equipment', undefined)).toBe('/assets/scenes/garden/garden-beehive.webp');
    expect(shopItemAssetPublicUrl('unknown_sku', 'http://127.0.0.1:57321')).toBeNull();
  });

  it('registers each generated SKU with matching content-addressed local and public keys', () => {
    expect(SHOP_RUNTIME_ASSETS.map((asset) => asset.id)).toEqual(['elara-counter-hero', 'seed_clover', 'amendment_n', 'amendment_p', 'amendment_k', 'soil_builder', 'bee_feed', 'treatment_varroa', 'treatment_chalkbrood', 'treatment_nosema', 'replacement_colony']);
    for (const asset of SHOP_RUNTIME_ASSETS) {
      expect(asset.filename).toBe(`v1/sha256/${asset.sha256.slice(0, 2)}/${asset.sha256}.webp`);
      expect(asset.key).toBe(`shop/${asset.filename}`);
    }
  });

  it('uploads every manifest object with immutable cache metadata and verifies read-back bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brac-shop-runtime-assets-'));
    const { storage, uploads } = fakeStorage();
    try {
      for (const asset of fixtureAssets) {
        const source = join(root, LOCAL_SHOP_RUNTIME_ASSET_DIRECTORY, asset.filename);
        await mkdir(dirname(source), { recursive: true });
        await writeFile(source, fixtureBytes);
      }
      const uploaded = await seedLocalShopRuntimeAssets(storage, root, fixtureAssets);
      expect(uploaded.map((entry) => entry.key)).toEqual(fixtureAssets.map((asset) => asset.key));
      expect(uploads).toEqual(fixtureAssets.map((asset) => ({ key: asset.key, options: { contentType: 'image/webp', cacheControl: '31536000', upsert: true } })));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('skips a missing optional fixture input and rejects a tampered read-back object', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brac-shop-runtime-assets-missing-'));
    try {
      await expect(seedLocalShopRuntimeAssets(fakeStorage().storage, root, fixtureAssets)).resolves.toEqual([]);
      const asset = fixtureAssets[0]; const source = join(root, LOCAL_SHOP_RUNTIME_ASSET_DIRECTORY, asset.filename);
      await mkdir(dirname(source), { recursive: true }); await writeFile(source, fixtureBytes);
      await expect(seedLocalShopRuntimeAssets(fakeStorage({ corruptDownload: true }).storage, root, fixtureAssets)).rejects.toThrow('read-back hash mismatch');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
