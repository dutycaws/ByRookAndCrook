import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  EXPRESSION_SPRITE_UPLOAD_MAX_BYTES,
  PRIVATE_PORTRAIT_BUCKET,
  PRIVATE_PORTRAIT_MASTER_BUCKET,
  PortraitProviderError,
  compensateExpressionSpriteUpload,
  expressionSpriteUploadMetadata,
  prepareExpressionSpriteUpload,
  storeExpressionSpriteUpload,
  type PrivatePortraitStorage
} from '../../src/lib/server/community-npc-portraits/index.js';

async function sprite(width = 256, height = 256) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = Math.round(height * .2); y < Math.round(height * .8); y += 1) for (let x = Math.round(width * .25); x < Math.round(width * .75); x += 1) {
    const offset = (y * width + x) * 4;
    pixels[offset] = 202; pixels[offset + 1] = 135; pixels[offset + 2] = 49; pixels[offset + 3] = 255;
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function opaqueSprite(width = 256, height = 256) {
  return sharp({ create: { width, height, channels: 4, background: { r: 5, g: 10, b: 15, alpha: 1 } } }).png().toBuffer();
}

function transparentSprite(width = 256, height = 256) {
  return sharp({ create: { width, height, channels: 4, background: { r: 5, g: 10, b: 15, alpha: 0 } } }).png().toBuffer();
}

function storage(options: { corrupt?: boolean; failRuntimeUpload?: boolean; failRemoval?: boolean } = {}) {
  const objects = new Map<string, Buffer>();
  const removals: string[][] = [];
  const client: PrivatePortraitStorage = {
    from(bucket) {
      return {
        async upload(key, body) {
          if (options.failRuntimeUpload && bucket === PRIVATE_PORTRAIT_BUCKET) return { error: { message: 'runtime unavailable' } };
          objects.set(`${bucket}/${key}`, Buffer.from(body));
          return { error: null };
        },
        async download(key) {
          const body = objects.get(`${bucket}/${key}`);
          if (!body) return { data: null, error: { message: 'not found' } };
          const actual = options.corrupt ? Buffer.concat([body, Buffer.from('corrupt')]) : body;
          const blobBytes = new Uint8Array(actual.length);
          blobBytes.set(actual);
          return { data: new Blob([blobBytes]), error: null };
        },
        async createSignedUrl() { return { data: { signedUrl: 'https://example.test/private' }, error: null }; },
        async remove(keys) {
          removals.push(keys);
          if (options.failRemoval) return { error: { message: 'cannot remove' } };
          for (const key of keys) objects.delete(`${bucket}/${key}`);
          return { error: null };
        }
      };
    }
  };
  return { client, objects, removals };
}

function sha256(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }

describe('author-uploaded community NPC expression sprites', () => {
  it('decodes PNG bytes rather than trusting file hints and makes a canonical transparent master and bounded alpha WebP', async () => {
    const original = await sprite(256, 512);
    const prepared = await prepareExpressionSpriteUpload(original, 'happy');
    expect(prepared.source).toBe('author_upload');
    expect(prepared.original).toMatchObject({ width: 256, height: 512, byteSize: original.length, sha256: sha256(original) });
    expect(prepared.original.visiblePixels).toBeGreaterThan(0);
    expect(prepared.original.transparentPixels).toBeGreaterThan(0);
    const master = await sharp(prepared.masterPng).metadata();
    expect(master).toMatchObject({ format: 'png', width: 1024, height: 1536, hasAlpha: true });
    const raw = await sharp(prepared.masterPng).ensureAlpha().raw().toBuffer();
    for (let y = 0; y < 1536; y += 1) for (let x = 0; x < 1024; x += 1) {
      if (x >= 8 && x < 1016 && y >= 8 && y < 1528) continue;
      expect(raw[(y * 1024 + x) * 4 + 3]).toBe(0);
    }
    const runtime = await sharp(prepared.portrait.runtimeBytes).metadata();
    expect(runtime).toMatchObject({ format: 'webp', width: 1024, height: 1536, hasAlpha: true });
    expect(prepared.portrait.runtimeBytes.length).toBeLessThanOrEqual(500_000);
  });

  it('rejects malformed, opaque, transparent, undersized, oversized, invalid-slot, and byte-limit inputs', async () => {
    await expect(prepareExpressionSpriteUpload(Buffer.from('not a png'), 'neutral')).rejects.toMatchObject({ code: 'invalid_output' });
    await expect(prepareExpressionSpriteUpload(await opaqueSprite(), 'neutral')).rejects.toMatchObject({ code: 'invalid_output' });
    await expect(prepareExpressionSpriteUpload(await transparentSprite(), 'neutral')).rejects.toMatchObject({ code: 'invalid_output' });
    await expect(prepareExpressionSpriteUpload(await sprite(255, 256), 'neutral')).rejects.toMatchObject({ code: 'invalid_output' });
    await expect(prepareExpressionSpriteUpload(await sprite(), 'surprised')).rejects.toMatchObject({ code: 'invalid_output' });
    await expect(prepareExpressionSpriteUpload(Buffer.alloc(EXPRESSION_SPRITE_UPLOAD_MAX_BYTES + 1), 'neutral')).rejects.toMatchObject({ code: 'invalid_output' });
  });

  it('writes, reads back, and verifies both private objects before metadata is registered', async () => {
    const prepared = await prepareExpressionSpriteUpload(await sprite(), 'neutral');
    const fake = storage();
    const uploaded = await storeExpressionSpriteUpload(fake.client, prepared, '11111111-1111-4111-8111-111111111111');
    expect(uploaded.storage.masterSha256).toBe(sha256(prepared.masterPng));
    expect(uploaded.storage.runtimeSha256).toBe(sha256(prepared.portrait.runtimeBytes));
    expect(fake.objects.get(`${PRIVATE_PORTRAIT_MASTER_BUCKET}/${uploaded.storage.masterKey}`)).toEqual(prepared.masterPng);
    expect(fake.objects.get(`${PRIVATE_PORTRAIT_BUCKET}/${uploaded.storage.runtimeKey}`)).toEqual(prepared.portrait.runtimeBytes);
    expect(expressionSpriteUploadMetadata('neutral', uploaded)).toMatchObject({
      slot: 'neutral', source: 'author_upload', originalWidth: 256, originalHeight: 256,
      masterSha256: uploaded.storage.masterSha256, runtimeSha256: uploaded.storage.runtimeSha256,
      alphaValid: true, mimeType: 'image/webp', masterMimeType: 'image/png', provider: null
    });
  });

  it('compensates both object keys on a read-back failure and exposes a non-throwing cleanup helper for DB failures', async () => {
    const prepared = await prepareExpressionSpriteUpload(await sprite(), 'leaving');
    const corrupt = storage({ corrupt: true });
    await expect(storeExpressionSpriteUpload(corrupt.client, prepared, '22222222-2222-4222-8222-222222222222'))
      .rejects.toBeInstanceOf(PortraitProviderError);
    expect(corrupt.objects.size).toBe(0);
    expect(corrupt.removals).toHaveLength(2);

    const normal = storage();
    const uploaded = await storeExpressionSpriteUpload(normal.client, prepared, '33333333-3333-4333-8333-333333333333');
    expect(await compensateExpressionSpriteUpload(normal.client, uploaded)).toBe(true);
    expect(normal.objects.size).toBe(0);
    expect(await compensateExpressionSpriteUpload(storage({ failRemoval: true }).client, uploaded.storage)).toBe(false);
  });
});
