import { existsSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { LOCAL_SHOP_RUNTIME_ASSET_BUCKET, LOCAL_SHOP_RUNTIME_ASSET_DIRECTORY } from '$lib/game/shop-runtime-assets';

const localRoot = resolve(LOCAL_SHOP_RUNTIME_ASSET_DIRECTORY);
const communityNpcRoot = resolve(localRoot, 'community-npcs');
const supportedExtensions = new Set(['.webp', '.jpg', '.jpeg', '.avif']);

export type LocalSceneAsset = {
  /** Immutable object key uploaded by the local fixture command. */
  storageKey: string;
  /** Relative path within the ignored derivative folder; never sent to the browser. */
  localFilename: string;
};

function validRelativePath(filename: string): boolean {
  const target = resolve(localRoot, filename);
  return target === localRoot || target.startsWith(`${localRoot}${sep}`);
}

function filesAt(directory: string, relative = ''): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const child = resolve(directory, entry.name);
    if (!validRelativePath(childRelative)) return [];
    return entry.isDirectory() ? filesAt(child, childRelative) : [childRelative];
  });
}

/** Lists only real, ignored fixture derivatives in stable order. */
export function listLocalSceneAssets(): LocalSceneAsset[] {
  return filesAt(communityNpcRoot)
    .filter((filename) => supportedExtensions.has(filename.slice(filename.lastIndexOf('.')).toLowerCase()))
    .sort()
    .map((localFilename) => ({ localFilename: `community-npcs/${localFilename}`, storageKey: `community-npcs/${localFilename}` }));
}

/**
 * A stored scene key is displayable only when it maps to a current local
 * fixture. This keeps arbitrary object keys and workstation paths out of the
 * page contract.
 */
export function localScenePublicUrl(storageKey: string, supabaseUrl: string | null | undefined): string | null {
  if (!storageKey.startsWith('community-npcs/')) return null;
  const filename = storageKey.slice('community-npcs/'.length);
  if (!filename || !validRelativePath(filename) || !listLocalSceneAssets().some((asset) => asset.storageKey === storageKey)) return null;
  if (!supabaseUrl) return null;
  try {
    const base = new URL(supabaseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.port !== '57321') return null;
    return new URL(`/storage/v1/object/public/${LOCAL_SHOP_RUNTIME_ASSET_BUCKET}/${storageKey}`, base).toString();
  } catch {
    return null;
  }
}
