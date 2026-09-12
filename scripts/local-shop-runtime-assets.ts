import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  LOCAL_SHOP_RUNTIME_ASSET_BUCKET,
  LOCAL_SHOP_RUNTIME_ASSET_DIRECTORY,
  SHOP_RUNTIME_ASSETS
} from '../src/lib/game/shop-runtime-assets.js';

type StorageError = { message: string } | null;
export type LocalAssetStorage = {
  createBucket: (name: string, options: { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] }) => Promise<{ error: StorageError }>;
  updateBucket: (name: string, options: { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] }) => Promise<{ error: StorageError }>;
  from: (name: string) => {
    upload: (key: string, body: Buffer, options: { contentType: string; cacheControl: string; upsert: boolean }) => Promise<{ error: StorageError }>;
    download: (key: string) => Promise<{ data: Blob | null; error: StorageError }>;
  };
};

const BUCKET_OPTIONS = { public: true, fileSizeLimit: 2 * 1024 * 1024, allowedMimeTypes: ['image/webp'] };
const UPLOAD_OPTIONS = { contentType: 'image/webp', cacheControl: '31536000', upsert: true };
export type ShopRuntimeAssetFixture = { id: string; filename: string; key: string; sha256: string };

export function assertLocalSupabaseUrl(value: string): URL {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '57321') {
    throw new Error(`Refusing to seed non-local Supabase target: ${url.toString()}`);
  }
  return url;
}

function hash(value: Buffer) { return createHash('sha256').update(value).digest('hex'); }
function alreadyExists(error: StorageError) { return Boolean(error && /already exists|duplicate|exists/i.test(error.message)); }

export async function ensureLocalShopRuntimeAssetBucket(storage: LocalAssetStorage) {
  const created = await storage.createBucket(LOCAL_SHOP_RUNTIME_ASSET_BUCKET, BUCKET_OPTIONS);
  if (created.error && !alreadyExists(created.error)) throw new Error(`Unable to create local Shop asset bucket: ${created.error.message}`);
  const updated = await storage.updateBucket(LOCAL_SHOP_RUNTIME_ASSET_BUCKET, BUCKET_OPTIONS);
  if (updated.error) throw new Error(`Unable to configure local Shop asset bucket: ${updated.error.message}`);
}

export async function seedLocalShopRuntimeAssets(storage: LocalAssetStorage, projectRoot = process.cwd(), assets: readonly ShopRuntimeAssetFixture[] = SHOP_RUNTIME_ASSETS) {
  await ensureLocalShopRuntimeAssetBucket(storage);
  const bucket = storage.from(LOCAL_SHOP_RUNTIME_ASSET_BUCKET);
  const uploaded: Array<{ key: string; sha256: string }> = [];
  for (const asset of assets) {
    const path = resolve(projectRoot, LOCAL_SHOP_RUNTIME_ASSET_DIRECTORY, asset.filename);
    let bytes: Buffer;
    try { bytes = await readFile(path); }
    catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`Skipping optional local Shop runtime asset ${asset.id}: ${path} is unavailable.`);
        continue;
      }
      throw error;
    }
    const sourceHash = hash(bytes);
    if (sourceHash !== asset.sha256) throw new Error(`Local Shop runtime asset hash mismatch for ${asset.key}: expected ${asset.sha256}, found ${sourceHash}`);
    const upload = await bucket.upload(asset.key, bytes, UPLOAD_OPTIONS);
    if (upload.error) throw new Error(`Unable to upload local Shop runtime asset ${asset.key}: ${upload.error.message}`);
    const downloaded = await bucket.download(asset.key);
    if (downloaded.error || !downloaded.data) throw new Error(`Unable to verify local Shop runtime asset ${asset.key}: ${downloaded.error?.message ?? 'empty response'}`);
    const verified = Buffer.from(await downloaded.data.arrayBuffer());
    if (hash(verified) !== asset.sha256) throw new Error(`Local Shop runtime asset read-back hash mismatch for ${asset.key}`);
    uploaded.push({ key: asset.key, sha256: asset.sha256 });
  }
  return uploaded;
}
