import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import {
  LOCAL_SCENE_RUNTIME_ASSET_DIRECTORY,
  LOCAL_SCENE_RUNTIME_ASSET_BUCKET,
  SCENE_RUNTIME_ASSETS,
  type SceneRuntimeAsset
} from '../src/lib/game/scene-runtime-assets.js';
import { ensureLocalShopRuntimeAssetBucket, type LocalAssetStorage } from './local-shop-runtime-assets.js';

const SOURCE_ROOT = '.local/media/source-masters';
const BACKGROUND_SOURCE = `${SOURCE_ROOT}/community-npcs/settings/CozyTavernBackground.png`;
const SHOP_BACKGROUND_SOURCE = 'static/assets/scenes/shop-environment.webp';
const GENERATED_SOURCES: Record<Exclude<SceneRuntimeAsset['id'], 'shop-background' | 'bar-background'>, string> = {
  'shop-elara': `${SOURCE_ROOT}/scene-compositions/shop/elara-greenbloom-sprite-v1.png`,
  'shop-counter-occlusion': `${SOURCE_ROOT}/scene-compositions/shop/shop-counter-occlusion-v1.png`,
  'bar-lira': `${SOURCE_ROOT}/scene-compositions/bar/lira-nightwind-sprite-v1.png`,
  'bar-torvin': `${SOURCE_ROOT}/scene-compositions/bar/torvin-ashbeard-sprite-v1.png`,
  'bar-counter-occlusion': `${SOURCE_ROOT}/scene-compositions/bar/bar-counter-occlusion-v1.png`
};
const MAX_RUNTIME_BYTES = 500_000;
const RUNTIME_MANIFEST_FILENAME = 'scene-runtime-assets.v1.json';

export type SeededSceneRuntimeAsset = SceneRuntimeAsset & { sha256: string };

function sha256(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function runtimePath(projectRoot: string, asset: SceneRuntimeAsset): string {
  return resolve(projectRoot, LOCAL_SCENE_RUNTIME_ASSET_DIRECTORY, asset.filename);
}
function sourcePath(projectRoot: string, asset: SceneRuntimeAsset): string {
  if (asset.id === 'shop-background') return resolve(projectRoot, SHOP_BACKGROUND_SOURCE);
  if (asset.id === 'bar-background') return resolve(projectRoot, BACKGROUND_SOURCE);
  return resolve(projectRoot, GENERATED_SOURCES[asset.id]);
}

async function renderAsset(source: string, asset: SceneRuntimeAsset): Promise<Buffer> {
  if (asset.id === 'shop-background') {
    return sharp(source).resize(asset.width, asset.height, { fit: 'cover', position: 'centre' }).webp({ quality: 84 }).toBuffer();
  }
  if (asset.id === 'bar-background') {
    return sharp(source).resize(asset.width, asset.height, { fit: 'fill' }).webp({ quality: 84 }).toBuffer();
  }
  if (asset.id === 'shop-counter-occlusion') {
    const sourceMetadata = await sharp(source).metadata();
    const sourceHeight = sourceMetadata.height ?? 0;
    return sharp(source).extract({ left: 0, top: Math.max(0, sourceHeight - 590), width: sourceMetadata.width ?? 2014, height: Math.min(590, sourceHeight) })
      .resize(asset.width, asset.height, { fit: 'fill' }).webp({ quality: 84, alphaQuality: 100, effort: 6 }).toBuffer();
  }
  if (asset.id === 'bar-counter-occlusion') {
    const sourceMetadata = await sharp(source).metadata();
    const sourceHeight = sourceMetadata.height ?? 0;
    return sharp(source).extract({ left: 0, top: Math.max(0, sourceHeight - 520), width: sourceMetadata.width ?? 1671, height: Math.min(520, sourceHeight) })
      .resize(asset.width, asset.height, { fit: 'fill' }).webp({ quality: 84, alphaQuality: 100, effort: 6 }).toBuffer();
  }
  return sharp(source).resize(asset.width, asset.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 82, alphaQuality: 100, effort: 6 }).toBuffer();
}

async function assertRenderedAsset(asset: SceneRuntimeAsset, bytes: Buffer): Promise<void> {
  const metadata = await sharp(bytes).metadata();
  if (bytes.length > MAX_RUNTIME_BYTES) throw new Error(`${asset.id} is ${bytes.length} bytes; local scene runtime assets must stay below ${MAX_RUNTIME_BYTES}`);
  if (metadata.width !== asset.width || metadata.height !== asset.height || metadata.hasAlpha !== asset.alpha) {
    throw new Error(`${asset.id} derivative does not match its ${asset.width}x${asset.height} alpha=${asset.alpha} contract`);
  }
  if (asset.alpha) {
    const raw = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const channels = raw.info.channels;
    let transparent = false;
    let visible = false;
    for (let offset = channels - 1; offset < raw.data.length; offset += channels) {
      if (raw.data[offset] < 255) transparent = true;
      if (raw.data[offset] > 0) visible = true;
      if (transparent && visible) break;
    }
    if (!transparent || !visible) throw new Error(`${asset.id} must contain visible pixels and genuine transparency`);
  }
}

/** Derives local-only WebPs. Missing source masters are normal in a clean checkout. */
export async function deriveLocalSceneRuntimeAssets(projectRoot = process.cwd()): Promise<SeededSceneRuntimeAsset[]> {
  const derived: SeededSceneRuntimeAsset[] = [];
  for (const asset of SCENE_RUNTIME_ASSETS) {
    const source = sourcePath(projectRoot, asset);
    if (!existsSync(source)) {
      console.warn(`Skipping optional scene runtime asset ${asset.id}: ${source} is unavailable.`);
      continue;
    }
    const bytes = await renderAsset(source, asset);
    await assertRenderedAsset(asset, bytes);
    const output = runtimePath(projectRoot, asset);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes);
    derived.push({ ...asset, sha256: sha256(bytes) });
  }
  const manifest = resolve(projectRoot, LOCAL_SCENE_RUNTIME_ASSET_DIRECTORY, RUNTIME_MANIFEST_FILENAME);
  await mkdir(dirname(manifest), { recursive: true });
  await writeFile(manifest, `${JSON.stringify({ version: 1, assets: derived }, null, 2)}\n`);
  return derived;
}

/** Uploads only locally-derived, checksum-verified WebPs to the local fixture bucket. */
export async function seedLocalSceneRuntimeAssets(storage: LocalAssetStorage, projectRoot = process.cwd()): Promise<SeededSceneRuntimeAsset[]> {
  await ensureLocalShopRuntimeAssetBucket(storage);
  const derived = await deriveLocalSceneRuntimeAssets(projectRoot);
  const bucket = storage.from(LOCAL_SCENE_RUNTIME_ASSET_BUCKET);
  for (const asset of derived) {
    const bytes = await readFile(runtimePath(projectRoot, asset));
    if (sha256(bytes) !== asset.sha256) throw new Error(`Scene runtime asset changed before upload: ${asset.id}`);
    const upload = await bucket.upload(asset.key, bytes, { contentType: 'image/webp', cacheControl: '31536000', upsert: true });
    if (upload.error) throw new Error(`Unable to upload local scene runtime asset ${asset.id}: ${upload.error.message}`);
    const downloaded = await bucket.download(asset.key);
    if (downloaded.error || !downloaded.data) throw new Error(`Unable to verify local scene runtime asset ${asset.id}: ${downloaded.error?.message ?? 'empty response'}`);
    if (sha256(Buffer.from(await downloaded.data.arrayBuffer())) !== asset.sha256) throw new Error(`Local scene runtime asset read-back hash mismatch for ${asset.id}`);
  }
  return derived;
}
