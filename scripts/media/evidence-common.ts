import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { mimeFor, runtimeAssetHashes, type CaptureManifest } from './capture-artifacts';
import { mediaPolicy } from './policy.js';

export const maxStillBytes = mediaPolicy.evidence.maxStillBytes;
export const maxCuratedStills = mediaPolicy.evidence.maxStillsPerSet;
export const maxCuratedStillBytes = mediaPolicy.evidence.maxStillSetBytes;
export const maxClipBytes = mediaPolicy.evidence.maxClipBytes;
export const supportedStills = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const supportedClips = new Set(['video/webm']);

export function sha256(data: Buffer) { return createHash('sha256').update(data).digest('hex'); }

export function containsServerCredential(value: string) {
  if (serverCredential.test(value) || /https?:\/\/[^\s/:@]+:[^\s/@]+@/i.test(value)) return true;
  for (const token of value.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    try {
      if ((JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { role?: unknown }).role === 'service_role') return true;
    } catch { /* JWT-shaped plain text is not necessarily a credential. */ }
  }
  return false;
}

const knownKinds = new Set(['screenshots', 'motion-proofs', 'scene-acceptance']);
const knownMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'video/webm', 'application/json']);
const serverCredential = /(?:sb_secret_|sk-)[A-Za-z0-9_-]{16,}|MEDIA_SUPABASE_(?:SECRET|SERVICE_ROLE)_KEY/i;
const requiredOutputsByKind: Record<string, readonly string[]> = {
  screenshots: ['garden.png', 'ingredients.png', 'brewery-setup.png', 'brewery-active.png', 'brewery-result.png', 'bar-1440.png', 'bar-1672.png', 'bar-768.png', 'bar-result.png', 'bar-390.png'],
  'motion-proofs': ['brewery-desktop-1x.png', 'brewery-desktop-2x.png', 'brewery-phone-1x.png', 'brewery-phone-2x.png', 'brewery-demo.webm', 'bakery-fold-desktop-1x.png', 'bakery-score-desktop-2x.png', 'bakery-score-phone-1x.png', 'bakery-score-phone-2x.png', 'bakery-demo.webm'],
  'scene-acceptance': ['garden-1672x941.png', 'garden-1440x900.png', 'garden-768x1024.png', 'garden-390x844.png', 'brewery-1672x941.png', 'brewery-1440x900.png', 'brewery-768x1024.png', 'brewery-390x844.png', 'bakery-1672x941.png', 'bakery-1440x900.png', 'bakery-768x1024.png', 'bakery-390x844.png', 'garden-interaction.webm', 'brewery-interaction.webm', 'bakery-interaction.webm', 'acceptance-results.json']
};

export function requiredOutputsFor(kind: string) { return requiredOutputsByKind[kind] ?? []; }

function contractError(path: string, problem: string): never { throw new Error(`Invalid capture manifest ${path}: ${problem}`); }

function validateContract(path: string, manifest: CaptureManifest) {
  if (manifest.schemaVersion !== 1 || !knownKinds.has(manifest.kind)) contractError(path, 'unsupported schema version or capture kind');
  if (!manifest.command?.trim() || !manifest.serverMode?.trim() || !manifest.browser?.trim()) contractError(path, 'command, serverMode, and browser are required');
  if (!Number.isFinite(Date.parse(manifest.capturedAt))) contractError(path, 'capturedAt must be an ISO timestamp');
  if (!/^[a-f0-9]{40}$/i.test(manifest.git?.commit ?? '') || typeof manifest.git.clean !== 'boolean') contractError(path, 'git commit must be a full SHA and clean must be boolean');
  if (!manifest.appUrl || !Number.isInteger(manifest.viewport?.width) || manifest.viewport.width <= 0 || !Number.isInteger(manifest.viewport.height) || manifest.viewport.height <= 0 || typeof manifest.viewport.deviceScaleFactor !== 'number' || manifest.viewport.deviceScaleFactor <= 0) contractError(path, 'app URL and positive viewport/DPR are required');
  try { new URL(manifest.appUrl); } catch { contractError(path, 'appUrl must be a URL'); }
  if (!Array.isArray(manifest.outputs) || manifest.outputs.length === 0) contractError(path, 'at least one output is required');
  const outputPaths = new Set<string>();
  for (const output of manifest.outputs) {
    if (!output.path || output.path.startsWith('/') || output.path.split('/').includes('..') || outputPaths.has(output.path)) contractError(path, 'output paths must be unique relative paths');
    outputPaths.add(output.path);
    if (!/^[a-f0-9]{64}$/i.test(output.sha256) || !Number.isSafeInteger(output.bytes) || output.bytes < 0 || !knownMimeTypes.has(output.mimeType)) contractError(path, `invalid output metadata for ${output.path}`);
    if (supportedStills.has(output.mimeType) && (typeof output.width !== 'number' || !Number.isInteger(output.width) || output.width <= 0 || typeof output.height !== 'number' || !Number.isInteger(output.height) || output.height <= 0)) contractError(path, `image dimensions are required for ${output.path}`);
    if (output.mimeType === 'video/webm' && (typeof output.durationMs !== 'number' || !Number.isSafeInteger(output.durationMs) || output.durationMs <= 0)) contractError(path, `WebM duration is required for ${output.path}`);
    if (output.mimeType === 'video/webm' && output.bytes > maxClipBytes) contractError(path, `WebM exceeds the ${maxClipBytes}-byte candidate limit: ${output.path}`);
  }
}

export async function loadManifest(path: string) {
  const source = await readFile(path, 'utf8');
  if (containsServerCredential(source)) {
    throw new Error('Capture manifest appears to contain a server-only media credential.');
  }
  const parsed = JSON.parse(source) as CaptureManifest;
  validateContract(path, parsed);
  return parsed;
}

export async function validateManifest(path: string, { requireClean = true, verifyRuntimeAssets = true } = {}) {
  const manifest = await loadManifest(path);
  if (requireClean && !manifest.git.clean) throw new Error('Capture was made from a dirty worktree and cannot be promoted.');
  const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (manifest.git.commit !== currentCommit) throw new Error(`Capture commit ${manifest.git.commit} does not match checked-out commit ${currentCommit}.`);
  if (!Array.isArray(manifest.runtimeAssets)) throw new Error('Capture manifest is missing runtime asset hashes.');
  if (verifyRuntimeAssets) {
    const expected = await runtimeAssetHashes();
    const actualByPath = new Map(manifest.runtimeAssets.map((asset) => [asset.path, asset.sha256]));
    if (expected.length !== actualByPath.size || expected.some((asset) => actualByPath.get(asset.path) !== asset.sha256)) {
      throw new Error('Capture runtime asset hashes do not match the checked-out commit.');
    }
  }
  const root = resolve(path, '..');
  const realRoot = await realpath(root);
  for (const output of manifest.outputs) {
    const file = resolve(root, output.path);
    if (!file.startsWith(`${root}${sep}`)) throw new Error(`Capture output escapes manifest directory: ${output.path}`);
    let component = root;
    for (const part of output.path.split('/')) {
      component = resolve(component, part);
      if ((await lstat(component)).isSymbolicLink()) throw new Error(`Capture output path contains a symlink: ${output.path}`);
    }
    const details = await lstat(file);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Capture output must be a regular file: ${output.path}`);
    const realFile = await realpath(file);
    if (!realFile.startsWith(`${realRoot}${sep}`)) throw new Error(`Capture output resolves outside manifest directory: ${output.path}`);
    const body = await readFile(file);
    if (details.size !== output.bytes || sha256(body) !== output.sha256) throw new Error(`Capture output hash mismatch: ${output.path}`);
    const detectedMime = mimeFor(file, body);
    if (detectedMime !== output.mimeType) throw new Error(`Capture output MIME mismatch: ${output.path}`);
    if (containsServerCredential(body.toString('utf8'))) throw new Error(`Capture output appears to contain a server-only credential: ${output.path}`);
  }
  const present = new Set(manifest.outputs.map((output) => output.path));
  const missing = requiredOutputsFor(manifest.kind).filter((output) => !present.has(output));
  if (missing.length > 0) throw new Error(`Capture ${manifest.kind} is missing required outputs: ${missing.join(', ')}`);
  return { manifest, root };
}

export function safeScope(scope: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(scope)) throw new Error('Scope must contain only letters, numbers, and hyphens.');
  return scope;
}

const extensionsForMime: Record<string, readonly string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'video/webm': ['webm']
};

/** A portable object/file leaf name: no URL, control, or path-special characters. */
export function safeEvidenceFileName(value: string, mimeType: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value.includes('..')) throw new Error(`Unsafe evidence filename: ${value}`);
  const extension = value.split('.').pop()?.toLowerCase();
  if (!extension || !extensionsForMime[mimeType]?.includes(extension)) throw new Error(`Evidence filename extension does not match ${mimeType}: ${value}`);
  return value;
}

export function manifestOutput(manifest: CaptureManifest, root: string, value: string, supported: Set<string>) {
  const output = manifest.outputs.find((item) => item.path === value);
  if (!output) throw new Error(`Not listed by capture manifest: ${value}`);
  if (!supported.has(output.mimeType)) throw new Error(`Unsupported evidence MIME type for ${value}: ${output.mimeType}`);
  return { ...output, source: resolve(root, output.path) };
}
