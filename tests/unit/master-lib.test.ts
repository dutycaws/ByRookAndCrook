import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { catalogSha256, createArchive, matchingRestoreReceipt, pngCrc32, readCatalog, releaseEligibility, safeArchiveEntry, sha256, storageKey, validateMasterBuffer, verifyArchive, type MasterCatalog } from '../../scripts/media/master-lib.js';

const execFileAsync = promisify(execFile);

function pngFromRaw(width: number, height: number, raw: Buffer) {
  const chunk = (type: string, data: Buffer) => { const value = Buffer.alloc(12 + data.length); value.writeUInt32BE(data.length, 0); value.write(type, 4); data.copy(value, 8); value.writeUInt32BE(pngCrc32(value.subarray(4, 8 + data.length)), 8 + data.length); return value; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function png(width = 2, height = 3, pixels = Buffer.alloc(width * height * 4)) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row += 1) pixels.copy(raw, row * (1 + width * 4) + 1, row * width * 4, (row + 1) * width * 4);
  return pngFromRaw(width, height, raw);
}
async function refreshSidecar(archive: string) { const hash = sha256(await readFile(archive)); await writeFile(`${archive}.sha256`, `${hash}  ${archive.split('/').pop()}\n`); }
function catalogFor(bytes: Buffer): MasterCatalog {
  const hash = sha256(bytes); const metadata = validateMasterBuffer(bytes); return { version: 1, bucket: 'source-masters', runtimeDerivatives: [], masters: [{ id: 'test-master', revisionId: 'test-master@123', originalFilename: 'test.png', sha256: hash, bytes: bytes.length, mimeType: 'image/png', width: metadata.width, height: metadata.height, storageKey: storageKey(hash), provenance: { acquiredAt: '2026-09-10', source: 'test', rights: 'test', promptOrNote: 'test', exportSettings: 'test' }, derivatives: [] }] };
}

describe('master storage helpers', () => {
  it('validates PNG metadata and creates content-addressed keys', () => {
    const value = png(); const details = validateMasterBuffer(value);
    expect(details).toMatchObject({ width: 2, height: 3, bytes: value.length, mimeType: 'image/png' });
    expect(storageKey(details.sha256)).toBe(`v1/sha256/${details.sha256.slice(0, 2)}/${details.sha256}.png`);
  });
  it('rejects malformed PNGs and unsafe archive paths', () => {
    expect(() => validateMasterBuffer(Buffer.from('not a png'))).toThrow('valid PNG');
    expect(() => safeArchiveEntry('../master.png')).toThrow('unsafe archive entry');
    expect(() => safeArchiveEntry('/master.png')).toThrow('unsafe archive entry');
  });
  it('creates a verifiable archive from hash-checked objects', async () => {
    const output = await mkdtemp(join(tmpdir(), 'brac-master-test-')); const bytes = png(); const catalog = catalogFor(bytes);
    try {
      const archive = await createArchive(catalog, new Map([[sha256(bytes), bytes]]), output);
      const result = await verifyArchive(archive.archive);
      expect(result.objectCount).toBe(1); expect(result.catalog.masters[0].sha256).toBe(sha256(bytes));
      expect(archive.archive).toBe(join(output, `source-masters-${archive.receipt.sha256}.zip`));
      expect(archive.receipt.archiveId).toBe(`source-masters-${archive.receipt.sha256}`);
      expect(archive.receipt.totalBytes).toBe(bytes.length);
      await expect(createArchive(catalog, new Map([[sha256(bytes), bytes]]), output)).rejects.toThrow('refusing to overwrite');
    } finally { await rm(output, { recursive: true, force: true }); }
  });
  it('does not let extra object-map entries affect archive receipt totals', async () => {
    const output = await mkdtemp(join(tmpdir(), 'brac-master-extra-test-')); const bytes = png(); const catalog = catalogFor(bytes);
    try {
      const archive = await createArchive(catalog, new Map([[sha256(bytes), bytes], ['f'.repeat(64), Buffer.alloc(4_000_000)]]), output);
      expect(archive.receipt.totalBytes).toBe(bytes.length);
    } finally { await rm(output, { recursive: true, force: true }); }
  });
  it('refuses an orphan sidecar without replacing it or publishing its archive', async () => {
    const seed = await mkdtemp(join(tmpdir(), 'brac-master-sidecar-seed-')); const output = await mkdtemp(join(tmpdir(), 'brac-master-sidecar-target-')); const bytes = png(); const catalog = catalogFor(bytes);
    try {
      const first = await createArchive(catalog, new Map([[sha256(bytes), bytes]]), seed);
      const expectedArchive = join(output, `source-masters-${first.receipt.sha256}.zip`);
      const expectedSidecar = `${expectedArchive}.sha256`; const orphan = 'orphan sidecar\n';
      await writeFile(expectedSidecar, orphan);
      await expect(createArchive(catalog, new Map([[sha256(bytes), bytes]]), output)).rejects.toThrow('existing archive sidecar');
      expect(await readFile(expectedSidecar, 'utf8')).toBe(orphan);
      await expect(readFile(expectedArchive)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await Promise.all([rm(seed, { recursive: true, force: true }), rm(output, { recursive: true, force: true })]); }
  });
  it('produces identical content-addressed ZIP bytes for identical inputs', async () => {
    const left = await mkdtemp(join(tmpdir(), 'brac-master-deterministic-left-')); const right = await mkdtemp(join(tmpdir(), 'brac-master-deterministic-right-')); const bytes = png(); const catalog = catalogFor(bytes);
    try {
      const [first, second] = await Promise.all([createArchive(catalog, new Map([[sha256(bytes), bytes]]), left), createArchive(catalog, new Map([[sha256(bytes), bytes]]), right)]);
      expect(first.receipt.sha256).toBe(second.receipt.sha256);
      expect(first.receipt.archiveId).toBe(second.receipt.archiveId);
    } finally { await Promise.all([rm(left, { recursive: true, force: true }), rm(right, { recursive: true, force: true })]); }
  });
  it('rejects an archive whose sibling checksum does not match', async () => {
    const output = await mkdtemp(join(tmpdir(), 'brac-master-test-')); const bytes = png(); const catalog = catalogFor(bytes);
    try {
      const archive = await createArchive(catalog, new Map([[sha256(bytes), bytes]]), output);
      await writeFile(`${archive.archive}.sha256`, `${'0'.repeat(64)}  ${archive.archive.split('/').pop()}\n`);
      await expect(verifyArchive(archive.archive, { requireSidecar: true })).rejects.toThrow('checksum sidecar mismatch');
      await rm(`${archive.archive}.sha256`);
      await expect(verifyArchive(archive.archive, { requireSidecar: true })).rejects.toThrow();
      expect(await readFile(archive.archive)).toBeInstanceOf(Buffer);
    } finally { await rm(output, { recursive: true, force: true }); }
  });
  it('permits a renamed archive when its sidecar retains the original filename', async () => {
    const output = await mkdtemp(join(tmpdir(), 'brac-master-rename-test-')); const bytes = png(); const catalog = catalogFor(bytes);
    try {
      const archive = await createArchive(catalog, new Map([[sha256(bytes), bytes]]), output);
      const renamed = join(output, 'drive-copy.zip');
      await rename(archive.archive, renamed); await rename(`${archive.archive}.sha256`, `${renamed}.sha256`);
      await expect(verifyArchive(renamed, { requireSidecar: true })).resolves.toMatchObject({ objectCount: 1 });
    } finally { await rm(output, { recursive: true, force: true }); }
  });
  it('verifies an archive containing a master larger than Node default exec output buffer', async () => {
    const output = await mkdtemp(join(tmpdir(), 'brac-master-large-test-')); const bytes = png(300_000, 1, randomBytes(1 + 300_000 * 4)); expect(bytes.length).toBeGreaterThan(1_000_000);
    const catalog = catalogFor(bytes);
    try {
      const archive = await createArchive(catalog, new Map([[sha256(bytes), bytes]]), output);
      await expect(verifyArchive(archive.archive, { requireSidecar: true })).resolves.toMatchObject({ objectCount: 1 });
    } finally { await rm(output, { recursive: true, force: true }); }
  });
  it('rejects malformed PNG structure instead of accepting a header alone', () => {
    const valid = png(); expect(validateMasterBuffer(valid)).toMatchObject({ width: 2, height: 3 });
    const badCrc = Buffer.from(valid); badCrc[20] ^= 1; expect(() => validateMasterBuffer(badCrc)).toThrow('CRC');
    const headerOnly = valid.subarray(0, 33); expect(() => validateMasterBuffer(headerOnly)).toThrow();
    const badPayload = Buffer.from(valid); const idat = badPayload.indexOf(Buffer.from('IDAT')); badPayload[idat + 4] ^= 1; expect(() => validateMasterBuffer(badPayload)).toThrow();
    expect(() => validateMasterBuffer(pngFromRaw(2, 3, Buffer.from('hello')))).toThrow('decoded scanline length');
    const invalidFilter = Buffer.alloc(3 * (1 + 2 * 4)); invalidFilter[0] = 5;
    expect(() => validateMasterBuffer(pngFromRaw(2, 3, invalidFilter))).toThrow('invalid filter');
  });
  it('rejects unexpected, malformed, and traversal archive entries after checksum refresh', async () => {
    const output = await mkdtemp(join(tmpdir(), 'brac-master-adversarial-')); const stage = await mkdtemp(join(tmpdir(), 'brac-master-adversarial-stage-')); const traversalOutput = await mkdtemp(join(tmpdir(), 'brac-master-traversal-')); const bytes = png(); const catalog = catalogFor(bytes);
    try {
      const archive = await createArchive(catalog, new Map([[sha256(bytes), bytes]]), output);
      await writeFile(join(stage, 'unexpected.txt'), 'unexpected'); await execFileAsync('zip', ['-q', archive.archive, 'unexpected.txt'], { cwd: stage }); await refreshSidecar(archive.archive);
      await expect(verifyArchive(archive.archive, { requireSidecar: true })).rejects.toThrow('unexpected entry');
      const malformed = await createArchive(catalog, new Map([[sha256(bytes), bytes]]), stage);
      await writeFile(join(output, 'catalog.json'), '{ malformed'); await execFileAsync('zip', ['-q', malformed.archive, 'catalog.json'], { cwd: output }); await refreshSidecar(malformed.archive);
      await expect(verifyArchive(malformed.archive, { requireSidecar: true })).rejects.toThrow();
      const traversal = await createArchive(catalog, new Map([[sha256(bytes), bytes]]), traversalOutput);
      const nested = join(stage, 'nested'); await mkdir(nested); await writeFile(join(stage, 'traversal.txt'), 'x');
      let traversalCreated = true;
      try { await execFileAsync('zip', ['-q', traversal.archive, '../traversal.txt'], { cwd: nested }); } catch { traversalCreated = false; }
      if (traversalCreated) { await refreshSidecar(traversal.archive); await expect(verifyArchive(traversal.archive, { requireSidecar: true })).rejects.toThrow('unsafe archive entry'); }
    } finally { await Promise.all([rm(output, { recursive: true, force: true }), rm(stage, { recursive: true, force: true }), rm(traversalOutput, { recursive: true, force: true })]); }
  });
  it('requires every master verification and a receipt for the exact catalog', () => {
    const catalog = catalogFor(png());
    expect(releaseEligibility(catalog, { version: 1, receipts: [] }).eligible).toBe(false);
    catalog.masters[0].verifiedAt = '2026-09-10T00:00:00.000Z';
    const hash = catalogSha256(catalog);
    expect(releaseEligibility(catalog, { version: 1, receipts: [{ archiveId: 'archive', sha256: 'b'.repeat(64), catalogSha256: hash, objectCount: 1, totalBytes: catalog.masters[0].bytes, createdAt: '2026-09-10T00:00:00.000Z' }] }).eligible).toBe(true);
    catalog.masters[0].derivatives.push({ path: 'static/assets/changed.webp', sha256: 'a'.repeat(64), recipe: 'changed' });
    expect(releaseEligibility(catalog, { version: 1, receipts: [{ archiveId: 'archive', sha256: 'b'.repeat(64), catalogSha256: hash, objectCount: 1, totalBytes: catalog.masters[0].bytes, createdAt: '2026-09-10T00:00:00.000Z' }] }).eligible).toBe(false);
  });
  it('reports immutable revision IDs and rejects invalid verification metadata', async () => {
    const catalog = catalogFor(png()); const nextBytes = png(4, 5); const nextHash = sha256(nextBytes);
    catalog.masters.push({ ...catalog.masters[0], revisionId: 'test-master@456', originalFilename: 'test-v2.png', sha256: nextHash, width: 4, height: 5, storageKey: storageKey(nextHash), verifiedAt: '2026-09-10T00:00:00.000Z' });
    const status = releaseEligibility(catalog, { version: 1, receipts: [] });
    expect(status.verifiedMasterIds).toEqual(['test-master@456']);
    expect(status.missingVerificationIds).toEqual(['test-master@123']);
    const directory = await mkdtemp(join(tmpdir(), 'brac-master-date-')); const path = join(directory, 'catalog.json');
    try {
      catalog.masters[0].verifiedAt = 'not-a-timestamp'; await writeFile(path, JSON.stringify(catalog));
      await expect(readCatalog(path)).rejects.toThrow('duplicate or unsafe');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('rejects invalid acquisition dates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brac-master-acquired-date-')); const path = join(directory, 'catalog.json');
    const catalog = catalogFor(png()); catalog.masters[0].provenance.acquiredAt = 'not-a-date';
    try {
      await writeFile(path, JSON.stringify(catalog));
      await expect(readCatalog(path)).rejects.toThrow('duplicate or unsafe');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('matches a restore receipt by archive content, not filename, and rejects partial receipt matches', () => {
    const catalog = catalogFor(png()); const archive = { catalog, objectCount: 1, archiveSha256: 'c'.repeat(64) };
    const receipt = { archiveId: 'original-name', sha256: archive.archiveSha256, catalogSha256: catalogSha256(catalog), objectCount: 1, totalBytes: catalog.masters[0].bytes, createdAt: '2026-09-10T00:00:00.000Z' };
    expect(matchingRestoreReceipt({ version: 1, receipts: [receipt] }, archive)).toBe(receipt);
    expect(matchingRestoreReceipt({ version: 1, receipts: [] }, archive)).toBeUndefined();
    expect(() => matchingRestoreReceipt({ version: 1, receipts: [{ ...receipt, objectCount: 2 }] }, archive)).toThrow('receipt metadata');
  });
  it('keeps the seeded catalog free of workstation paths and records every current derivative', async () => {
    const catalog = await readCatalog();
    expect(catalog.masters).toHaveLength(20);
    expect(catalog.runtimeDerivatives).toHaveLength(51);
    expect(JSON.stringify(catalog)).not.toContain('/home/');
    expect(catalog.runtimeDerivatives.filter((derivative) => derivative.sourceRevisionId === null).map((derivative) => derivative.path)).toEqual([
      'static/assets/scenes/brewery/brewery-paddle-immersion-shadow.webp',
      'static/assets/scenes/brewery/brewery-wort-mask.webp',
      'static/assets/scenes/bakery/bakery-dough-shadow.webp',
      'static/assets/scenes/bakery/bakery-score-groove-01.webp'
    ]);
  });
  it('allows immutable revisions to share a logical ID and validates supersedes links', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brac-master-revisions-'));
    const path = join(directory, 'catalog.json');
    const catalog = catalogFor(png());
    const nextBytes = png(4, 5);
    const nextHash = sha256(nextBytes);
    catalog.masters.push({
      ...catalog.masters[0],
      revisionId: 'test-master@456',
      originalFilename: 'test-v2.png',
      sha256: nextHash,
      width: 4,
      height: 5,
      storageKey: storageKey(nextHash),
      supersedes: 'test-master@123'
    });
    try {
      await writeFile(path, JSON.stringify(catalog));
      await expect(readCatalog(path)).resolves.toMatchObject({ masters: [{ id: 'test-master' }, { id: 'test-master', supersedes: 'test-master@123' }] });
      catalog.masters[1].supersedes = 'missing-revision';
      await writeFile(path, JSON.stringify(catalog));
      await expect(readCatalog(path)).rejects.toThrow('invalid supersedes');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('rejects duplicate masters, duplicate derivative paths, and absolute catalog paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brac-master-catalog-')); const path = join(directory, 'catalog.json'); const catalog = catalogFor(png());
    try {
      catalog.masters[0].originalFilename = '/tmp/master.png';
      await writeFile(path, JSON.stringify(catalog)); await expect(readCatalog(path)).rejects.toThrow('duplicate or unsafe');
      catalog.masters[0].originalFilename = 'master.png'; catalog.runtimeDerivatives = [{ path: 'static/assets/a.webp', sha256: 'a'.repeat(64), sourceRevisionId: 'test-master@123', recipe: 'test' }, { path: 'static/assets/a.webp', sha256: 'b'.repeat(64), sourceRevisionId: 'test-master@123', recipe: 'test' }];
      await writeFile(path, JSON.stringify(catalog)); await expect(readCatalog(path)).rejects.toThrow('invalid runtime derivative');
      catalog.runtimeDerivatives = [{ path: 'static/assets/a.webp', sha256: 'a'.repeat(64), sourceRevisionId: 'test-master@123', recipe: 'test' }];
      await writeFile(path, JSON.stringify(catalog)); await expect(readCatalog(path)).rejects.toThrow('runtime derivative missing from master revision');
      catalog.masters[0].derivatives = [{ path: 'static/assets/a.webp', sha256: 'b'.repeat(64), recipe: 'test' }];
      await writeFile(path, JSON.stringify(catalog)); await expect(readCatalog(path)).rejects.toThrow('runtime derivative missing');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
