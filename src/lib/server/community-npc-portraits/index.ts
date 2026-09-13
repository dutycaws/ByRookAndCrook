/**
 * Server-only portrait generation primitives.  This module deliberately owns
 * private references and object keys; routes only receive safe summaries from
 * the database contract.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import type { NpcSheet } from '$lib/game/npc-sheet';

export const PORTRAIT_STYLE_VERSION = 'community-npc-portrait-sprite-v1';
export const PORTRAIT_REFERENCE_SET = 'brac-character-look-v1';
export const PORTRAIT_REFERENCE_REVISION = 'brac-character-look-v1@private-v1';
export const PORTRAIT_WIDTH = 1024;
export const PORTRAIT_HEIGHT = 1536;
export const PORTRAIT_RUNTIME_MAX_BYTES = 500 * 1024;
export const PRIVATE_PORTRAIT_BUCKET = 'community-npc-portraits';
export const PRIVATE_PORTRAIT_MASTER_BUCKET = 'community-npc-portrait-masters';
export const PORTRAIT_REFERENCE_DIRECTORY = '.local/media/source-masters/community-npcs/style-references/brac-character-look-v1';
/** Private approved reference manifest. Do not serialize this into a workspace DTO. */
const PRIVATE_REFERENCE_MANIFEST = {
  'Elara_Happy.png': '86d4185d80745dfcb555884a5c67f5d7f520a705bb541fb6e6d9fa73ffe6b381',
  'Elara_Sad.png': '6221229cd1c11930c1edec7be8afdee7b52db591294201a9326305c7448486d5',
  'Lira-leaving.png': '94766b2b05d7aed71d8e46c555f6e85340ff86afb4f4b9b3d8e38ad4cc513832',
  'Lira_Angry.png': '902b007d2241a0397e66679a205bede9b99add6ea4948ec3cabdfe9279bb7bd1',
  'Lira_Normal.png': 'abc12648fb4c57b6290d11dd675f14f458da61cf3dcd54b2ffec1a0a61e8a1c7',
  'Lira_Sweet.png': '98c2c22ee9d53132d0a4086ecd292a8dd641edef18da8fc42676b6c33a05c19c',
  'Lira_leanedin.png': 'a551a9f88fc651ea547f996fe813dccd6b3563a6b00db0e2dbf2c166b9f7e2aa'
} as const;

export type PortraitPose = 'automatic' | 'relaxed' | 'confident' | 'guarded' | 'working';
export type PortraitExpression = 'from_sheet' | 'warm' | 'wary' | 'determined' | 'thoughtful' | 'stern';
export type PortraitClothingCondition = 'from_sheet' | 'well_kept' | 'patched' | 'road_worn';
export type PortraitControls = {
  pose: PortraitPose; expression: PortraitExpression; clothingCondition: PortraitClothingCondition;
  optionalItem?: string | null; compositionNote?: string | null;
};
export type PortraitReference = { revision: string; filename: string; sha256: string; bytes: Buffer };
export type PortraitProviderRequest = {
  idempotencyKey: string; prompt: string; references: readonly PortraitReference[]; alternativeOrdinal: number;
  width: typeof PORTRAIT_WIDTH; height: typeof PORTRAIT_HEIGHT; outputFormat: 'png'; background: 'transparent';
};
export type PortraitProviderResponse = { bytes: Buffer; provider: string; model: string; requestId?: string };
export interface PortraitProvider { generate(request: PortraitProviderRequest, signal: AbortSignal): Promise<PortraitProviderResponse>; }
export type PortraitProviderAvailability = { available: true; provider: 'openai'; model: string } | { available: false; reason: 'missing_image_api_key' | 'missing_private_references' | 'local_not_implemented' | 'unknown_provider' };
export type PortraitFailureCode = 'provider_unavailable' | 'provider_timeout' | 'provider_refused' | 'provider_malformed' | 'invalid_output' | 'storage_failed' | 'provider_failed';

export class PortraitProviderError extends Error {
  constructor(public readonly code: PortraitFailureCode, message: string) { super(message); this.name = 'PortraitProviderError'; }
}

function hash(value: Buffer | string) { return createHash('sha256').update(value).digest('hex'); }
function clean(value: string | null | undefined, maximum: number) { return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum); }
function bounded<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T { return allowed.includes(value as T) ? value as T : fallback; }

/** The UI must offer only these authored phrases; free-form item prompting is forbidden. */
export function portraitItemOptions(sheet: NpcSheet): string[] {
  return [...new Set([sheet.appearance.attire, sheet.appearance.notableFeatures].map((value) => clean(value, 240)).filter(Boolean))];
}

/** No lore, campaign, private relationships, or arbitrary style directions enter this projection. */
export function portraitVisualProjection(sheet: NpcSheet, controls: Partial<PortraitControls>) {
  const selectedCues = sheet.personality.values.slice(0, 3).map((value) => clean(value, 80));
  const itemChoices = portraitItemOptions(sheet);
  const item = clean(controls.optionalItem, 240);
  if (item && !itemChoices.includes(item)) throw new PortraitProviderError('provider_malformed', 'Choose an optional item already present in attire or notable features.');
  return {
    name: clean(sheet.identity.name, 100), title: clean(sheet.identity.title, 140), rating: sheet.rating,
    physicalAppearance: clean(sheet.appearance.physicalAppearance, 900), attire: clean(sheet.appearance.attire, 900),
    notableFeatures: clean(sheet.appearance.notableFeatures, 700), mood: clean(sheet.appearance.mood, 400),
    personalityCues: selectedCues,
    controls: {
      pose: bounded(controls.pose, ['automatic', 'relaxed', 'confident', 'guarded', 'working'] as const, 'automatic'),
      expression: bounded(controls.expression, ['from_sheet', 'warm', 'wary', 'determined', 'thoughtful', 'stern'] as const, 'from_sheet'),
      clothingCondition: bounded(controls.clothingCondition, ['from_sheet', 'well_kept', 'patched', 'road_worn'] as const, 'from_sheet'),
      optionalItem: item || null, compositionNote: clean(controls.compositionNote, 240) || null
    },
    styleVersion: PORTRAIT_STYLE_VERSION, referenceSet: PORTRAIT_REFERENCE_SET, referenceRevision: PORTRAIT_REFERENCE_REVISION
  };
}

export function visualInputHash(sheet: NpcSheet, controls: Partial<PortraitControls>) { return hash(JSON.stringify(portraitVisualProjection(sheet, controls))); }
export function referenceSetHash(references: readonly Pick<PortraitReference, 'filename' | 'sha256'>[]) {
  return hash(JSON.stringify([...references].map(({ filename, sha256 }) => ({ filename, sha256 })).sort((a, b) => a.filename.localeCompare(b.filename))));
}

export function lockedPortraitPrompt(sheet: NpcSheet, controls: Partial<PortraitControls>) {
  const visual = portraitVisualProjection(sheet, controls);
  return [
    `Create one original adult NPC portrait sprite for a cozy fantasy tavern game. Role: ${visual.title}.`,
    `Physical appearance: ${visual.physicalAppearance}. Attire: ${visual.attire}. Notable features: ${visual.notableFeatures}. Mood: ${visual.mood}.`,
    `Personality cues: ${visual.personalityCues.join(', ') || 'none supplied'}. Pose: ${visual.controls.pose}. Expression: ${visual.controls.expression}. Clothing condition: ${visual.controls.clothingCondition.replace('_', '-')}.`,
    visual.controls.optionalItem ? `Include this authored item only: ${visual.controls.optionalItem}.` : '',
    visual.controls.compositionNote ? `Composition-only note: ${visual.controls.compositionNote}.` : '',
    'Locked visual style: cozy high-detail painterly fantasy realism; warm amber key light, restrained golden rim light, deep timber shadows; moss, aged brass, worn leather, and unbleached linen accents; tactile hair, fabric, leather, and metal.',
    'Create a single upright, head-to-toe adult in a three-quarter pose with a readable face, natural hands, visible feet, and a clean silhouette. Output a 1024 by 1536 RGBA PNG with a genuinely transparent background and a transparent perimeter.',
    'No environment, floor, furniture, frame, lettering, signature, watermark, interface, extra person, or baked contact shadow. The supplied private references define rendering quality only. Do not reproduce their identity, face, body, hair, clothing, accessories, or pose. Do not default to sexualized framing, exposure, or a body type.'
  ].filter(Boolean).join('\n');
}

export function portraitProviderAvailability(config: Record<string, string | undefined>, projectRoot = process.cwd()): PortraitProviderAvailability {
  const configured = portraitProviderConfiguration(config);
  if (!configured.available) return configured;
  try { loadPrivatePortraitReferences(projectRoot); } catch { return { available: false, reason: 'missing_private_references' }; }
  return configured;
}

export function portraitProviderConfiguration(config: Record<string, string | undefined>): PortraitProviderAvailability {
  const provider = config.NPC_IMAGE_PROVIDER ?? 'openai';
  if (provider === 'local') return { available: false, reason: 'local_not_implemented' };
  if (provider !== 'openai') return { available: false, reason: 'unknown_provider' };
  if (!(config.NPC_IMAGE_API_KEY ?? config.OPENAI_API_KEY)) return { available: false, reason: 'missing_image_api_key' };
  return { available: true, provider: 'openai', model: config.NPC_IMAGE_MODEL ?? 'gpt-image-2' };
}

export function loadPrivatePortraitReferences(projectRoot = process.cwd()): PortraitReference[] {
  const root = resolve(projectRoot, PORTRAIT_REFERENCE_DIRECTORY);
  if (!existsSync(root)) throw new PortraitProviderError('provider_unavailable', 'The private portrait reference set has not been installed.');
  const files = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png')).map((entry) => entry.name).sort();
  const expected = Object.keys(PRIVATE_REFERENCE_MANIFEST).sort();
  if (files.length !== expected.length || files.some((file, index) => file !== expected[index])) throw new PortraitProviderError('provider_unavailable', 'The private portrait reference set is incomplete.');
  return files.map((filename) => {
    const bytes = readFileSync(resolve(root, filename));
    const sha256 = hash(bytes);
    if (sha256 !== PRIVATE_REFERENCE_MANIFEST[filename as keyof typeof PRIVATE_REFERENCE_MANIFEST]) throw new PortraitProviderError('provider_unavailable', 'The private portrait reference set does not match its approved revision.');
    return { revision: PORTRAIT_REFERENCE_REVISION, filename, sha256, bytes };
  });
}

async function openAiImageRequest(config: Record<string, string | undefined>, request: PortraitProviderRequest, signal: AbortSignal): Promise<PortraitProviderResponse> {
  const apiKey = config.NPC_IMAGE_API_KEY ?? config.OPENAI_API_KEY;
  if (!apiKey) throw new PortraitProviderError('provider_unavailable', 'The image-generation API key is not configured.');
  const model = config.NPC_IMAGE_MODEL ?? 'gpt-image-2';
  const form = new FormData();
  form.set('model', model); form.set('prompt', request.prompt); form.set('size', '1024x1536'); form.set('background', 'transparent'); form.set('output_format', 'png');
  for (const reference of request.references) form.append('image[]', new Blob([new Uint8Array(reference.bytes)], { type: 'image/png' }), reference.filename);
  let response: Response;
  try { response = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Idempotency-Key': request.idempotencyKey }, body: form, signal }); }
  catch (cause) { if (signal.aborted) throw new PortraitProviderError('provider_timeout', 'Portrait generation timed out.'); throw new PortraitProviderError('provider_failed', cause instanceof Error ? cause.message : 'Portrait generation failed.'); }
  const requestId = response.headers.get('x-request-id') ?? undefined;
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (response.status === 408 || response.status === 504) throw new PortraitProviderError('provider_timeout', 'Portrait generation timed out.');
    if (response.status === 401 || response.status === 403 || response.status === 429) throw new PortraitProviderError('provider_unavailable', 'The image provider is unavailable.');
    if (response.status === 400 && /moderation|safety|policy/i.test(detail)) throw new PortraitProviderError('provider_refused', 'The image provider refused this request.');
    throw new PortraitProviderError('provider_failed', `The image provider failed (${response.status}).`);
  }
  let payload: { data?: Array<{ b64_json?: string }> };
  try { payload = await response.json(); } catch { throw new PortraitProviderError('provider_malformed', 'The image provider returned unreadable data.'); }
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded) throw new PortraitProviderError('provider_malformed', 'The image provider did not return PNG bytes.');
  return { bytes: Buffer.from(encoded, 'base64'), provider: 'openai', model, requestId };
}

export function createPortraitProvider(config: Record<string, string | undefined>): PortraitProvider {
  const availability = portraitProviderConfiguration(config);
  if (!availability.available) return { async generate() { throw new PortraitProviderError('provider_unavailable', availability.reason); } };
  return { generate: (request, signal) => openAiImageRequest(config, request, signal) };
}

type DecodedPng = { width: number; height: number; pixels: Buffer };
function paeth(left: number, above: number, upperLeft: number) { const p = left + above - upperLeft; const a = Math.abs(p - left); const b = Math.abs(p - above); const c = Math.abs(p - upperLeft); return a <= b && a <= c ? left : b <= c ? above : upperLeft; }
function decodeRgbaPng(bytes: Buffer): DecodedPng {
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new PortraitProviderError('invalid_output', 'The provider output is not a PNG.');
  let cursor = 8; let width = 0; let height = 0; let depth = 0; let colour = 0; const data: Buffer[] = [];
  while (cursor + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(cursor); const type = bytes.toString('ascii', cursor + 4, cursor + 8); const start = cursor + 8; const end = start + length;
    if (end + 4 > bytes.length) throw new PortraitProviderError('invalid_output', 'The PNG is truncated.');
    if (type === 'IHDR') { width = bytes.readUInt32BE(start); height = bytes.readUInt32BE(start + 4); depth = bytes[start + 8]; colour = bytes[start + 9]; if (bytes[start + 12] !== 0) throw new PortraitProviderError('invalid_output', 'Interlaced PNG output is unsupported.'); }
    if (type === 'IDAT') data.push(bytes.subarray(start, end));
    if (type === 'IEND') break;
    cursor = end + 4;
  }
  if (width !== PORTRAIT_WIDTH || height !== PORTRAIT_HEIGHT || depth !== 8 || colour !== 6 || !data.length) throw new PortraitProviderError('invalid_output', 'Portrait output must be a 1024 × 1536 RGBA PNG.');
  let raw: Buffer; try { raw = inflateSync(Buffer.concat(data)); } catch { throw new PortraitProviderError('invalid_output', 'The PNG cannot be decoded.'); }
  const stride = width * 4; if (raw.length !== height * (stride + 1)) throw new PortraitProviderError('invalid_output', 'The PNG scanlines are invalid.');
  const pixels = Buffer.alloc(width * height * 4); let input = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[input++]; const row = pixels.subarray(y * stride, (y + 1) * stride); const prior = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) { const source = raw[input++]; const left = x >= 4 ? row[x - 4] : 0; const above = prior?.[x] ?? 0; const upperLeft = x >= 4 ? (prior?.[x - 4] ?? 0) : 0; row[x] = filter === 0 ? source : filter === 1 ? (source + left) & 255 : filter === 2 ? (source + above) & 255 : filter === 3 ? (source + Math.floor((left + above) / 2)) & 255 : filter === 4 ? (source + paeth(left, above, upperLeft)) & 255 : (() => { throw new PortraitProviderError('invalid_output', 'The PNG has an invalid scanline filter.'); })(); }
  }
  return { width, height, pixels };
}

export type ValidatedPortraitPng = { width: number; height: number; sha256: string; bytes: number; alphaPixels: number; bounds: { left: number; top: number; right: number; bottom: number } };
export function validatePortraitPng(bytes: Buffer): ValidatedPortraitPng {
  const decoded = decodeRgbaPng(bytes); let alphaPixels = 0; let transparentPixels = 0; let left = decoded.width; let right = -1; let top = decoded.height; let bottom = -1;
  for (let y = 0; y < decoded.height; y += 1) for (let x = 0; x < decoded.width; x += 1) { const alpha = decoded.pixels[(y * decoded.width + x) * 4 + 3]; if (alpha === 0) transparentPixels += 1; if (alpha > 0) { alphaPixels += 1; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); } }
  if (!alphaPixels || !transparentPixels) throw new PortraitProviderError('invalid_output', 'Portrait output must have a genuine transparent background.');
  const perimeter = 8; if (left < perimeter || top < perimeter || right >= decoded.width - perimeter || bottom >= decoded.height - perimeter) throw new PortraitProviderError('invalid_output', 'Portrait output has no transparent crop-safe perimeter.');
  return { width: decoded.width, height: decoded.height, sha256: hash(bytes), bytes: bytes.length, alphaPixels, bounds: { left, top, right, bottom } };
}

export type OptimizedPortrait = ValidatedPortraitPng & { runtimeBytes: Buffer; runtimeSha256: string; runtimeMimeType: 'image/webp' };
export async function optimisePortraitWebp(png: Buffer): Promise<OptimizedPortrait> {
  const source = validatePortraitPng(png);
  try {
    let converted: Buffer | null = null;
    for (const quality of [100, 92, 84, 76]) {
      const candidate = await sharp(png).webp({ quality, alphaQuality: 100 }).toBuffer();
      if (candidate.length <= PORTRAIT_RUNTIME_MAX_BYTES) { converted = candidate; break; }
    }
    if (!converted) throw new PortraitProviderError('invalid_output', 'The portrait cannot be optimized below the runtime size limit.');
    const metadata = await sharp(converted).metadata();
    if (metadata.width !== PORTRAIT_WIDTH || metadata.height !== PORTRAIT_HEIGHT || !metadata.hasAlpha) throw new PortraitProviderError('invalid_output', 'The optimized portrait lost required dimensions or transparency.');
    return { ...source, runtimeBytes: converted, runtimeSha256: hash(converted), runtimeMimeType: 'image/webp' };
  } catch (cause) { if (cause instanceof PortraitProviderError) throw cause; throw new PortraitProviderError('invalid_output', 'The portrait derivative could not be validated.'); }
}

export type PrivatePortraitStorage = { from(bucket: string): { upload(key: string, body: Buffer, options: { contentType: string; cacheControl: string; upsert: boolean }): Promise<{ error: { message: string } | null }>; download(key: string): Promise<{ data: Blob | null; error: { message: string } | null }>; createSignedUrl(key: string, seconds: number): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>; remove(keys: string[]): Promise<{ error: { message: string } | null }> } };
export type PrivatePortraitBucketStorage = PrivatePortraitStorage & { createBucket(name: string, options: { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] }): Promise<{ error: { message: string } | null }>; updateBucket(name: string, options: { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] }): Promise<{ error: { message: string } | null }> };
function bucketExists(error: { message: string } | null) { return Boolean(error && /already exists|duplicate|exists/i.test(error.message)); }
/** Idempotently configures private stores before a billable generation can run. */
export async function ensurePrivatePortraitBuckets(storage: PrivatePortraitBucketStorage): Promise<void> {
  const buckets = [
    { name: PRIVATE_PORTRAIT_BUCKET, options: { public: false, fileSizeLimit: PORTRAIT_RUNTIME_MAX_BYTES, allowedMimeTypes: ['image/webp'] } },
    { name: PRIVATE_PORTRAIT_MASTER_BUCKET, options: { public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ['image/png'] } }
  ];
  for (const bucket of buckets) {
    const created = await storage.createBucket(bucket.name, bucket.options);
    if (created.error && !bucketExists(created.error)) throw new PortraitProviderError('storage_failed', created.error.message);
    const updated = await storage.updateBucket(bucket.name, bucket.options);
    if (updated.error) throw new PortraitProviderError('storage_failed', updated.error.message);
  }
}
export type StoredPortrait = { masterKey: string; runtimeKey: string; masterSha256: string; runtimeSha256: string };
export async function storePrivatePortrait(storage: PrivatePortraitStorage, portrait: OptimizedPortrait, masterPng: Buffer, id = randomUUID()): Promise<StoredPortrait> {
  const masterKey = `v1/${id}/master.png`; const runtimeKey = `v1/${id}/sprite.webp`;
  try {
    const master = storage.from(PRIVATE_PORTRAIT_MASTER_BUCKET); const runtime = storage.from(PRIVATE_PORTRAIT_BUCKET);
    const [masterUpload, runtimeUpload] = await Promise.all([master.upload(masterKey, masterPng, { contentType: 'image/png', cacheControl: '31536000', upsert: false }), runtime.upload(runtimeKey, portrait.runtimeBytes, { contentType: 'image/webp', cacheControl: '31536000', upsert: false })]);
    if (masterUpload.error || runtimeUpload.error) throw new Error(masterUpload.error?.message ?? runtimeUpload.error?.message);
    const [masterRead, runtimeRead] = await Promise.all([master.download(masterKey), runtime.download(runtimeKey)]);
    if (masterRead.error || runtimeRead.error || !masterRead.data || !runtimeRead.data || hash(Buffer.from(await masterRead.data.arrayBuffer())) !== portrait.sha256 || hash(Buffer.from(await runtimeRead.data.arrayBuffer())) !== portrait.runtimeSha256) throw new Error('private portrait storage read-back hash mismatch');
    return { masterKey, runtimeKey, masterSha256: portrait.sha256, runtimeSha256: portrait.runtimeSha256 };
  } catch (cause) { throw new PortraitProviderError('storage_failed', cause instanceof Error ? cause.message : 'Private portrait storage failed.'); }
}

/** Call only after the database has authorized the requesting author or reviewer. */
export async function signedPortraitPreview(storage: PrivatePortraitStorage, runtimeKey: string, seconds = 300): Promise<string> {
  const result = await storage.from(PRIVATE_PORTRAIT_BUCKET).createSignedUrl(runtimeKey, Math.max(30, Math.min(seconds, 600)));
  if (result.error || !result.data?.signedUrl) throw new PortraitProviderError('storage_failed', 'The portrait preview could not be authorized.');
  return result.data.signedUrl;
}

/**
 * A preview token is opaque. The caller must first resolve it through an
 * authorization-checked database function and pass only that resulting key
 * here; tokens are never interpreted as URLs or storage paths.
 */
export async function authorizedPortraitPreview(
  storage: PrivatePortraitStorage,
  resolveAuthorizedKey: () => Promise<string | null>,
  seconds = 300
): Promise<string | null> {
  const runtimeKey = await resolveAuthorizedKey();
  if (!runtimeKey || !/^v1\/[0-9a-f-]+\/sprite\.webp$/.test(runtimeKey)) return null;
  return signedPortraitPreview(storage, runtimeKey, seconds);
}

/** Service-only physical purge after the database has retained its audit-safe redaction. */
export async function purgePrivatePortrait(
  storage: PrivatePortraitStorage,
  target: { masterKey?: string | null; runtimeKey: string }
): Promise<void> {
  if (!/^v1\/[0-9a-f-]+\/sprite\.webp$/.test(target.runtimeKey)
    || (target.masterKey != null && !/^v1\/[0-9a-f-]+\/master\.png$/.test(target.masterKey))) {
    throw new PortraitProviderError('storage_failed', 'The portrait purge target is invalid.');
  }
  const removals = [storage.from(PRIVATE_PORTRAIT_BUCKET).remove([target.runtimeKey])];
  if (target.masterKey) removals.push(storage.from(PRIVATE_PORTRAIT_MASTER_BUCKET).remove([target.masterKey]));
  const results = await Promise.all(removals);
  const failure = results.find((result) => result.error)?.error;
  if (failure) throw new PortraitProviderError('storage_failed', failure.message ?? 'Portrait object purge failed.');
}

export function deterministicPortraitProvider(bytes: Buffer): PortraitProvider {
  return { async generate(request) { return { bytes: Buffer.from(bytes), provider: 'deterministic-test', model: 'deterministic-test', requestId: `test-${request.alternativeOrdinal}` }; } };
}
