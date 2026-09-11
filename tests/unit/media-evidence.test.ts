import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { containsServerCredential, maxCuratedStillBytes, maxCuratedStills, maxStillBytes, requiredOutputsFor, safeEvidenceFileName, safeScope, validateManifest } from '../../scripts/media/evidence-common';
import { imageDimensions } from '../../scripts/media/capture-artifacts';

const hash = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

describe('media evidence policy', () => {
  it('uses the agreed curated-still limits', () => {
    expect(maxStillBytes).toBe(1_048_576);
    expect(maxCuratedStills).toBe(12);
    expect(maxCuratedStillBytes).toBe(4 * 1024 * 1024);
  });

  it('only accepts safe promotion scopes', () => {
    expect(safeScope('issue-13-final')).toBe('issue-13-final');
    expect(() => safeScope('../escape')).toThrow(/Scope/);
  });

  it('only allows safe filename leaves with matching media extensions', () => {
    expect(safeEvidenceFileName('brewery-demo.webm', 'video/webm')).toBe('brewery-demo.webm');
    expect(() => safeEvidenceFileName('brewery demo.webm', 'video/webm')).toThrow(/Unsafe/);
    expect(() => safeEvidenceFileName('brewery-demo.webm', 'image/png')).toThrow(/extension/);
    expect(() => safeEvidenceFileName('clip?.webm', 'video/webm')).toThrow(/Unsafe/);
  });

  it('parses JPEG and common WebP dimensions without accepting truncated headers', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, 0, 5, 0, 7]);
    expect(imageDimensions(jpeg, 'image/jpeg')).toEqual({ width: 7, height: 5 });
    const vp8l = Buffer.alloc(25); vp8l.write('RIFF', 0); vp8l.write('WEBP', 8); vp8l.write('VP8L', 12); vp8l[20] = 0x2f; vp8l[21] = 4; vp8l[22] = 0; vp8l[23] = 2;
    expect(imageDimensions(vp8l, 'image/webp')).toEqual({ width: 5, height: 9 });
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xc0]), 'image/jpeg')).toEqual({});
    expect(imageDimensions(Buffer.alloc(20), 'image/webp')).toEqual({});
  });

  it('detects legacy Supabase service-role JWTs and credential-bearing URLs', () => {
    const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
    expect(containsServerCredential(token)).toBe(true);
    expect(containsServerCredential('https://operator:secret@example.test/object')).toBe(true);
    expect(containsServerCredential('https://example.test/public')).toBe(false);
  });

  it('defines required outputs for every versioned capture kind', () => {
    expect(requiredOutputsFor('screenshots')).toHaveLength(10);
    expect(requiredOutputsFor('motion-proofs')).toContain('brewery-demo.webm');
    expect(requiredOutputsFor('scene-acceptance')).toContain('acceptance-results.json');
  });

  it('rejects a capture output whose hash changed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-evidence-'));
    const output = join(directory, 'image.json');
    await writeFile(output, 'expected');
    await writeFile(join(directory, 'capture-manifest.json'), JSON.stringify({ schemaVersion: 1, kind: 'screenshots', command: 'npm run test', serverMode: 'test server', capturedAt: new Date().toISOString(), git: { commit, clean: true }, appUrl: 'http://example.test', browser: 'test', viewport: { width: 1, height: 1, deviceScaleFactor: 1 }, runtimeAssets: [], outputs: [{ path: 'image.json', sha256: hash(Buffer.from('different')), bytes: 8, mimeType: 'application/json' }] }));
    await expect(validateManifest(join(directory, 'capture-manifest.json'), { verifyRuntimeAssets: false })).rejects.toThrow(/hash mismatch/);
  });

  it('rejects symlinked capture outputs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-evidence-'));
    const target = join(directory, 'target.png');
    await writeFile(target, 'image');
    await symlink(target, join(directory, 'image.png'));
    await writeFile(join(directory, 'capture-manifest.json'), JSON.stringify({ schemaVersion: 1, kind: 'screenshots', command: 'npm run test', serverMode: 'test server', capturedAt: new Date().toISOString(), git: { commit, clean: true }, appUrl: 'http://example.test', browser: 'test', viewport: { width: 1, height: 1, deviceScaleFactor: 1 }, runtimeAssets: [], outputs: [{ path: 'image.png', sha256: hash(Buffer.from('image')), bytes: 5, mimeType: 'image/png', width: 1, height: 1 }] }));
    await expect(validateManifest(join(directory, 'capture-manifest.json'), { verifyRuntimeAssets: false })).rejects.toThrow(/contains a symlink/);
  });

  it('rejects an output routed through a symlinked parent directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-evidence-'));
    const external = await mkdtemp(join(tmpdir(), 'media-evidence-external-'));
    const body = Buffer.from('{}');
    await writeFile(join(external, 'candidate.json'), body);
    await symlink(external, join(directory, 'nested'));
    await writeFile(join(directory, 'capture-manifest.json'), JSON.stringify({ schemaVersion: 1, kind: 'screenshots', command: 'npm run screenshots', serverMode: 'test server', capturedAt: new Date().toISOString(), git: { commit, clean: true }, appUrl: 'http://example.test', browser: 'test', viewport: { width: 1, height: 1, deviceScaleFactor: 1 }, runtimeAssets: [], outputs: [{ path: 'nested/candidate.json', sha256: hash(body), bytes: body.length, mimeType: 'application/json' }] }));
    await expect(validateManifest(join(directory, 'capture-manifest.json'), { verifyRuntimeAssets: false })).rejects.toThrow(/contains a symlink/);
  });

  it('rejects a manifest without required provenance fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-evidence-'));
    await writeFile(join(directory, 'capture-manifest.json'), JSON.stringify({ schemaVersion: 1, kind: 'screenshots', capturedAt: 'not-a-date', git: { commit, clean: true }, appUrl: 'http://example.test', browser: '', viewport: { width: 0, height: 1, deviceScaleFactor: 1 }, runtimeAssets: [], outputs: [] }));
    await expect(validateManifest(join(directory, 'capture-manifest.json'), { verifyRuntimeAssets: false })).rejects.toThrow(/Invalid capture manifest/);
  });

  it('rejects a credential embedded in a capture output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-evidence-'));
    const body = Buffer.from(JSON.stringify({ token: `sb_secret_${'a'.repeat(24)}` }));
    await writeFile(join(directory, 'result.json'), body);
    await writeFile(join(directory, 'capture-manifest.json'), JSON.stringify({ schemaVersion: 1, kind: 'screenshots', command: 'npm run test', serverMode: 'test server', capturedAt: new Date().toISOString(), git: { commit, clean: true }, appUrl: 'http://example.test', browser: 'test', viewport: { width: 1, height: 1, deviceScaleFactor: 1 }, runtimeAssets: [], outputs: [{ path: 'result.json', sha256: hash(body), bytes: body.length, mimeType: 'application/json' }] }));
    await expect(validateManifest(join(directory, 'capture-manifest.json'), { verifyRuntimeAssets: false })).rejects.toThrow(/server-only credential/);
  });

  it('rejects a candidate package that omits required screenshots', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-evidence-'));
    const body = Buffer.from('{}');
    await writeFile(join(directory, 'candidate.json'), body);
    await writeFile(join(directory, 'capture-manifest.json'), JSON.stringify({ schemaVersion: 1, kind: 'screenshots', command: 'npm run screenshots', serverMode: 'test server', capturedAt: new Date().toISOString(), git: { commit, clean: true }, appUrl: 'http://example.test', browser: 'test', viewport: { width: 1, height: 1, deviceScaleFactor: 1 }, runtimeAssets: [], outputs: [{ path: 'candidate.json', sha256: hash(body), bytes: body.length, mimeType: 'application/json' }] }));
    await expect(validateManifest(join(directory, 'capture-manifest.json'), { verifyRuntimeAssets: false })).rejects.toThrow(/missing required outputs/);
  });
});
