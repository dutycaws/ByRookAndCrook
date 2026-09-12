/**
 * Public contract for optional, locally seeded Shop art. The application can
 * render its built-in fallback when the local fixture bucket has not been
 * loaded, so neither builds nor CI require these generated image bytes.
 */
export const LOCAL_SHOP_RUNTIME_ASSET_BUCKET = 'prototype-runtime-media';
export const LOCAL_SHOP_RUNTIME_ASSET_DIRECTORY = '.local/media/runtime-derivatives';

export const SHOP_RUNTIME_ASSETS = [
  {
    id: 'elara-counter-hero',
    filename: 'v1/sha256/90/90a8aea1cd4fbd9b61364a953ace689c0e96126d0762a8e262131255ed7586fc.webp',
    key: 'shop/v1/sha256/90/90a8aea1cd4fbd9b61364a953ace689c0e96126d0762a8e262131255ed7586fc.webp',
    sha256: '90a8aea1cd4fbd9b61364a953ace689c0e96126d0762a8e262131255ed7586fc'
  },
  { id: 'seed_clover', filename: 'v1/sha256/62/6272e2b1874ace058da2f7ad224806c676e5bd6d5ad0e88cf0902d4e53c15977.webp', key: 'shop/v1/sha256/62/6272e2b1874ace058da2f7ad224806c676e5bd6d5ad0e88cf0902d4e53c15977.webp', sha256: '6272e2b1874ace058da2f7ad224806c676e5bd6d5ad0e88cf0902d4e53c15977' },
  { id: 'amendment_n', filename: 'v1/sha256/4c/4cb5e73cb9e9d31fbd4585c342d2730adf8c38607597be4426c49c46860ed69f.webp', key: 'shop/v1/sha256/4c/4cb5e73cb9e9d31fbd4585c342d2730adf8c38607597be4426c49c46860ed69f.webp', sha256: '4cb5e73cb9e9d31fbd4585c342d2730adf8c38607597be4426c49c46860ed69f' },
  { id: 'amendment_p', filename: 'v1/sha256/22/228d283d1f5d53a9c1a432887df0e548878f1f67f89188382097b924ddc3c1d2.webp', key: 'shop/v1/sha256/22/228d283d1f5d53a9c1a432887df0e548878f1f67f89188382097b924ddc3c1d2.webp', sha256: '228d283d1f5d53a9c1a432887df0e548878f1f67f89188382097b924ddc3c1d2' },
  { id: 'amendment_k', filename: 'v1/sha256/ff/ff992107cccd708f02af7b55577ee1c6ad69ea9bceaa97f4bd94b6149ef5ad76.webp', key: 'shop/v1/sha256/ff/ff992107cccd708f02af7b55577ee1c6ad69ea9bceaa97f4bd94b6149ef5ad76.webp', sha256: 'ff992107cccd708f02af7b55577ee1c6ad69ea9bceaa97f4bd94b6149ef5ad76' },
  { id: 'soil_builder', filename: 'v1/sha256/7b/7b44c7945b32a129429b21d614d4d5d366063035e8ccd42a1d5d08cdab31a91f.webp', key: 'shop/v1/sha256/7b/7b44c7945b32a129429b21d614d4d5d366063035e8ccd42a1d5d08cdab31a91f.webp', sha256: '7b44c7945b32a129429b21d614d4d5d366063035e8ccd42a1d5d08cdab31a91f' },
  { id: 'bee_feed', filename: 'v1/sha256/8a/8a565e523438c2833a9ec2a225b2f0847413022aa452307b272cc8aba8d8984e.webp', key: 'shop/v1/sha256/8a/8a565e523438c2833a9ec2a225b2f0847413022aa452307b272cc8aba8d8984e.webp', sha256: '8a565e523438c2833a9ec2a225b2f0847413022aa452307b272cc8aba8d8984e' },
  { id: 'treatment_varroa', filename: 'v1/sha256/fa/faefc593fb1c773caa2826b32fae6933a2f2eded495b2ee94720e59f7831f4f5.webp', key: 'shop/v1/sha256/fa/faefc593fb1c773caa2826b32fae6933a2f2eded495b2ee94720e59f7831f4f5.webp', sha256: 'faefc593fb1c773caa2826b32fae6933a2f2eded495b2ee94720e59f7831f4f5' },
  { id: 'treatment_chalkbrood', filename: 'v1/sha256/95/957e75fa98531580d3c75ab9a3c1007aaad0fe6e161687d92072f7d13f821f43.webp', key: 'shop/v1/sha256/95/957e75fa98531580d3c75ab9a3c1007aaad0fe6e161687d92072f7d13f821f43.webp', sha256: '957e75fa98531580d3c75ab9a3c1007aaad0fe6e161687d92072f7d13f821f43' },
  { id: 'treatment_nosema', filename: 'v1/sha256/38/38036d51641ddfcf4c58f92362e3c550f6ea9776c1f7d4c2268fb998e6a501a6.webp', key: 'shop/v1/sha256/38/38036d51641ddfcf4c58f92362e3c550f6ea9776c1f7d4c2268fb998e6a501a6.webp', sha256: '38036d51641ddfcf4c58f92362e3c550f6ea9776c1f7d4c2268fb998e6a501a6' },
  { id: 'replacement_colony', filename: 'v1/sha256/49/49b90970e3f0b9724f8bca0e196cec5d030272f602866adbf9ff8efbb8580945.webp', key: 'shop/v1/sha256/49/49b90970e3f0b9724f8bca0e196cec5d030272f602866adbf9ff8efbb8580945.webp', sha256: '49b90970e3f0b9724f8bca0e196cec5d030272f602866adbf9ff8efbb8580945' }
] as const;

export type ShopRuntimeAssetId = (typeof SHOP_RUNTIME_ASSETS)[number]['id'];

/** Returns null when no valid local Supabase URL is configured. */
export function shopRuntimeAssetPublicUrl(id: ShopRuntimeAssetId, supabaseUrl: string | null | undefined): string | null {
  const asset = SHOP_RUNTIME_ASSETS.find((candidate) => candidate.id === id);
  if (!asset || !supabaseUrl) return null;
  try {
    const base = new URL(supabaseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.port !== '57321') return null;
    return new URL(`/storage/v1/object/public/${LOCAL_SHOP_RUNTIME_ASSET_BUCKET}/${asset.key}`, base).toString();
  } catch {
    return null;
  }
}

const REVIEWED_STATIC_SKU_ASSETS: Record<string, string> = {
  seed_chamomile: '/assets/scenes/garden/garden-crop-chamomile-stage-3.webp',
  seed_fennel: '/assets/scenes/garden/garden-crop-fennel-stage-3.webp',
  seed_hops: '/assets/scenes/garden/garden-crop-hops-stage-3.webp',
  seed_lavender: '/assets/scenes/garden/garden-crop-lavender-stage-3.webp',
  seed_sage: '/assets/scenes/garden/garden-crop-sage-stage-3.webp',
  seed_pepper: '/assets/scenes/garden/garden-crop-pepper-stage-3.webp',
  seed_tomatoes: '/assets/scenes/garden/garden-crop-tomatoes-stage-3.webp',
  hive_equipment: '/assets/scenes/garden/garden-beehive.webp'
};

/** Resolves generated local fixtures and reviewed static SKU art; unknown SKUs stay unillustrated. */
export function shopItemAssetPublicUrl(itemKey: string, supabaseUrl: string | null | undefined): string | null {
  const generated = SHOP_RUNTIME_ASSETS.find((candidate) => candidate.id === itemKey);
  return generated ? shopRuntimeAssetPublicUrl(generated.id, supabaseUrl) : REVIEWED_STATIC_SKU_ASSETS[itemKey] ?? null;
}
