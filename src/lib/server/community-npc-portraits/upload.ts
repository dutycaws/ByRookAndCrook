/**
 * Server-only preparation for one author-supplied expression sprite. Browser
 * MIME types and names are deliberately ignored: sharp must decode an actual,
 * single-frame PNG before anything reaches private storage.
 */
import { createHash, randomUUID } from 'node:crypto';
import sharp, { type Metadata, type Sharp } from 'sharp';
import {
  PORTRAIT_HEIGHT,
  PORTRAIT_WIDTH,
  PortraitProviderError,
  cleanupStoredPrivatePortrait,
  optimisePortraitWebp,
  storePrivatePortrait,
  type OptimizedPortrait,
  type PrivatePortraitStorage,
  type StoredPortrait
} from './index.js';

export const EXPRESSION_SPRITE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const EXPRESSION_SPRITE_RUNTIME_MAX_BYTES = 500_000;
export const EXPRESSION_SPRITE_MIN_DIMENSION = 256;
export const EXPRESSION_SPRITE_MAX_DIMENSION = 4096;
export const EXPRESSION_SPRITE_TRANSPARENT_PERIMETER = 8;
export const EXPRESSION_SPRITE_SLOTS = ['neutral', 'happy', 'sad', 'angry', 'engaged', 'leaving'] as const;
export type ExpressionSpriteSlot = typeof EXPRESSION_SPRITE_SLOTS[number];

type OriginalPng = {
  width: number;
  height: number;
  sha256: string;
  byteSize: number;
  visiblePixels: number;
  transparentPixels: number;
};

export type PreparedExpressionSpriteUpload = {
  source: 'author_upload';
  original: OriginalPng;
  masterPng: Buffer;
  portrait: OptimizedPortrait;
};

export type StoredExpressionSpriteUpload = PreparedExpressionSpriteUpload & {
  storage: StoredPortrait;
};

function sha256(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }

function invalid(message: string): never {
  throw new PortraitProviderError('invalid_output', message);
}

function isPngSignature(bytes: Buffer) {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function assertSlot(slot: string): asserts slot is ExpressionSpriteSlot {
  if (!(EXPRESSION_SPRITE_SLOTS as readonly string[]).includes(slot)) {
    invalid('Choose a supported expression slot.');
  }
}

/** A decoded alpha inspection prevents opaque/empty images masquerading as sprites. */
async function inspectOriginalPng(bytes: Buffer): Promise<OriginalPng> {
  if (bytes.length === 0 || bytes.length > EXPRESSION_SPRITE_UPLOAD_MAX_BYTES) {
    invalid('Upload one PNG no larger than 10 MiB.');
  }
  if (!isPngSignature(bytes)) invalid('Upload one PNG image.');

  let image: Sharp;
  let metadata: Metadata;
  try {
    image = sharp(bytes, { animated: true, limitInputPixels: EXPRESSION_SPRITE_MAX_DIMENSION ** 2, failOn: 'error' });
    metadata = await image.metadata();
  } catch {
    invalid('The uploaded PNG could not be decoded.');
  }

  if (metadata.format !== 'png') invalid('Upload one PNG image.');
  if (!metadata.width || !metadata.height
    || metadata.width < EXPRESSION_SPRITE_MIN_DIMENSION || metadata.height < EXPRESSION_SPRITE_MIN_DIMENSION
    || metadata.width > EXPRESSION_SPRITE_MAX_DIMENSION || metadata.height > EXPRESSION_SPRITE_MAX_DIMENSION) {
    invalid('PNG dimensions must be between 256 and 4096 pixels.');
  }
  if ((metadata.pages ?? 1) !== 1 || (metadata.delay?.length ?? 0) > 1) {
    invalid('Animated PNGs are not supported.');
  }

  let raw: Buffer;
  try {
    raw = Buffer.from(await image.ensureAlpha().raw().toBuffer());
  } catch {
    invalid('The uploaded PNG pixels could not be inspected.');
  }
  let visiblePixels = 0;
  let transparentPixels = 0;
  for (let index = 3; index < raw.length; index += 4) {
    if (raw[index] === 0) transparentPixels += 1;
    else visiblePixels += 1;
  }
  if (!visiblePixels || !transparentPixels) {
    invalid('PNG sprites need visible artwork and a genuinely transparent background.');
  }
  return { width: metadata.width, height: metadata.height, sha256: sha256(bytes), byteSize: bytes.length, visiblePixels, transparentPixels };
}

/**
 * Normalization is deliberately not a crop: the decoded image is auto-oriented
 * and contained inside a canonical transparent canvas with an 8px safe edge.
 */
async function canonicalMaster(bytes: Buffer): Promise<Buffer> {
  try {
    const master = await sharp(bytes, { animated: false, limitInputPixels: EXPRESSION_SPRITE_MAX_DIMENSION ** 2, failOn: 'error' })
      .rotate()
      .ensureAlpha()
      .resize({
        width: PORTRAIT_WIDTH - EXPRESSION_SPRITE_TRANSPARENT_PERIMETER * 2,
        height: PORTRAIT_HEIGHT - EXPRESSION_SPRITE_TRANSPARENT_PERIMETER * 2,
        fit: 'contain',
        position: 'centre',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .extend({
        top: EXPRESSION_SPRITE_TRANSPARENT_PERIMETER,
        bottom: EXPRESSION_SPRITE_TRANSPARENT_PERIMETER,
        left: EXPRESSION_SPRITE_TRANSPARENT_PERIMETER,
        right: EXPRESSION_SPRITE_TRANSPARENT_PERIMETER,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ compressionLevel: 9, effort: 10, palette: false })
      .toBuffer();
    const metadata = await sharp(master, { animated: false }).metadata();
    if (metadata.format !== 'png' || metadata.width !== PORTRAIT_WIDTH || metadata.height !== PORTRAIT_HEIGHT || !metadata.hasAlpha) {
      invalid('The uploaded sprite could not be normalized safely.');
    }
    return master;
  } catch (cause) {
    if (cause instanceof PortraitProviderError) throw cause;
    invalid('The uploaded sprite could not be normalized safely.');
  }
}

export async function prepareExpressionSpriteUpload(bytes: Buffer, slot: string): Promise<PreparedExpressionSpriteUpload> {
  assertSlot(slot);
  const original = await inspectOriginalPng(bytes);
  const masterPng = await canonicalMaster(bytes);
  const portrait = await optimisePortraitWebp(masterPng, EXPRESSION_SPRITE_RUNTIME_MAX_BYTES);
  if (portrait.runtimeBytes.length > EXPRESSION_SPRITE_RUNTIME_MAX_BYTES) invalid('The runtime sprite exceeds the 500,000-byte budget.');
  return { source: 'author_upload', original, masterPng, portrait };
}

/** Writes both private objects and verifies their hashes before a DB candidate can be registered. */
export async function storeExpressionSpriteUpload(
  storage: PrivatePortraitStorage,
  prepared: PreparedExpressionSpriteUpload,
  id = randomUUID()
): Promise<StoredExpressionSpriteUpload> {
  const stored = await storePrivatePortrait(storage, prepared.portrait, prepared.masterPng, id);
  return { ...prepared, storage: stored };
}

/** Use after a candidate-registration RPC fails. It never obscures the original persistence error. */
export async function compensateExpressionSpriteUpload(
  storage: PrivatePortraitStorage,
  stored: Pick<StoredExpressionSpriteUpload, 'storage'> | StoredPortrait
): Promise<boolean> {
  const target = 'storage' in stored ? stored.storage : stored;
  return cleanupStoredPrivatePortrait(storage, target);
}

/** Safe server-action payload; object keys stay server-only until the DB authorizes them. */
export function expressionSpriteUploadMetadata(slot: ExpressionSpriteSlot, upload: StoredExpressionSpriteUpload) {
  return {
    slot,
    source: upload.source,
    originalWidth: upload.original.width,
    originalHeight: upload.original.height,
    originalSha256: upload.original.sha256,
    originalByteSize: upload.original.byteSize,
    width: upload.portrait.width,
    height: upload.portrait.height,
    masterSha256: upload.storage.masterSha256,
    runtimeSha256: upload.storage.runtimeSha256,
    masterByteSize: upload.masterPng.length,
    byteSize: upload.portrait.runtimeBytes.length,
    alphaValid: true,
    mimeType: upload.portrait.runtimeMimeType,
    masterMimeType: 'image/png' as const,
    // The server action passes these only to the ownership-checked RPC. The
    // database never returns either key in a browser DTO.
    masterStorageKey: upload.storage.masterKey,
    runtimeStorageKey: upload.storage.runtimeKey,
    provider: null,
    model: null,
    requestId: null
  };
}
