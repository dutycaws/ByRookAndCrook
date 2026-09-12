import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { link, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';

export const SOURCE_MASTERS_BUCKET = 'source-masters';
export const LOCAL_SOURCE_MASTERS_DIRECTORY = '.local/media/source-masters';
export const MAX_MASTER_BYTES = 50 * 1024 * 1024;
const MAX_INFLATED_PNG_BYTES = 64 * 1024 * 1024;
export const CATALOG_PATH = 'docs/design/source-master-catalog.json';
export const RECEIPTS_PATH = 'docs/design/master-backup-receipts.json';
const execFileAsync = promisify(execFile);

export type MasterRecord = {
  id: string; revisionId: string; originalFilename: string; sha256: string; bytes: number;
  mimeType: 'image/png'; width: number; height: number; storageKey: string;
  provenance: { acquiredAt: string; source: string; rights: string; promptOrNote: string; exportSettings: string };
  derivatives: Array<{ path: string; sha256: string; recipe: string }>;
  supersedes?: string; verifiedAt?: string;
};
export type RuntimeDerivative = { path: string; sha256: string; sourceRevisionId: string | null; recipe: string };
export type MasterCatalog = { version: 1; bucket: typeof SOURCE_MASTERS_BUCKET; runtimeDerivatives: RuntimeDerivative[]; masters: MasterRecord[] };
export type ArchiveReceipt = { archiveId: string; sha256: string; catalogSha256: string; objectCount: number; totalBytes: number; createdAt: string; driveConfirmedAt?: string; restoreChecks?: Array<{ verifiedAt: string; sha256: string }> };
export type ReceiptFile = { version: 1; receipts: ArchiveReceipt[] };
export type VerifiedArchive = { catalog: MasterCatalog; objectCount: number; archiveSha256: string };

export function sha256(value: Buffer | string) { return createHash('sha256').update(value).digest('hex'); }
export function storageKey(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('SHA-256 must be a lowercase 64-character hex value');
  return `v1/sha256/${hash.slice(0, 2)}/${hash}.png`;
}
export function storageMode() {
  const mode = process.env.MEDIA_MASTER_STORAGE ?? 'local';
  if (mode !== 'local' && mode !== 'supabase') throw new Error('MEDIA_MASTER_STORAGE must be "local" or "supabase"');
  return mode;
}
export function localSourceMastersDirectory(projectRoot = process.cwd()) {
  return resolve(projectRoot, LOCAL_SOURCE_MASTERS_DIRECTORY);
}
export function localMasterPath(record: Pick<MasterRecord, 'storageKey'>, projectRoot = process.cwd()) {
  const root = localSourceMastersDirectory(projectRoot);
  const target = resolve(root, record.storageKey);
  if (!target.startsWith(`${root}/`)) throw new Error(`local master path escapes source-master store: ${record.storageKey}`);
  return target;
}
export function pngCrc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function pngMetadata(buffer: Buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.length < 45 || buffer.subarray(0, 8).toString('hex') !== signature) throw new Error('master must be a valid PNG with signature');
  let offset = 8; let chunks = 0; let width = 0; let height = 0; let bitDepth = 0; let colorType = 0; let interlace = 0; let sawIhdr = false; let sawIdat = false; let endedIdat = false; let sawPlte = false; const idatParts: Buffer[] = [];
  while (offset < buffer.length) {
    if (++chunks > 10_000 || offset + 12 > buffer.length) throw new Error('PNG has truncated or excessive chunks');
    const length = buffer.readUInt32BE(offset); const chunkStart = offset; offset += 4;
    if (length > buffer.length - offset - 8) throw new Error('PNG chunk length exceeds remaining bytes');
    const type = buffer.toString('ascii', offset, offset + 4); const dataStart = offset + 4; const dataEnd = dataStart + length; const expectedCrc = buffer.readUInt32BE(dataEnd);
    if (pngCrc32(buffer.subarray(offset, dataEnd)) !== expectedCrc) throw new Error(`PNG CRC mismatch for ${type}`);
    offset = dataEnd + 4;
    if (!sawIhdr) {
      if (type !== 'IHDR' || length !== 13 || chunkStart !== 8) throw new Error('PNG must begin with one 13-byte IHDR chunk');
      width = buffer.readUInt32BE(dataStart); height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8]; colorType = buffer[dataStart + 9]; const compression = buffer[dataStart + 10]; const filter = buffer[dataStart + 11]; interlace = buffer[dataStart + 12];
      const validDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!width || !height || !validDepths[colorType]?.includes(bitDepth) || compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) throw new Error('PNG IHDR has invalid dimensions or encoding fields');
      sawIhdr = true; continue;
    }
    if (type === 'IHDR') throw new Error('PNG IHDR must be unique');
    if (type === 'PLTE') {
      if (sawPlte || sawIdat || colorType === 0 || colorType === 4 || length === 0 || length % 3 !== 0 || length / 3 > (1 << bitDepth)) throw new Error('PNG PLTE is invalid or misplaced');
      sawPlte = true; continue;
    }
    if (type === 'IDAT') { if (endedIdat || (colorType === 3 && !sawPlte)) throw new Error('PNG IDAT chunks must be consecutive and palette images require PLTE first'); sawIdat = true; idatParts.push(buffer.subarray(dataStart, dataEnd)); continue; }
    if (sawIdat) endedIdat = true;
    if (type === 'IEND') {
      if (length !== 0 || !sawIdat || offset !== buffer.length) throw new Error('PNG IEND must be final and follow IDAT');
      const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
      const rowBytes = (pixels: number) => Math.ceil((pixels * channels[colorType] * bitDepth) / 8);
      const passSize = (xStart: number, yStart: number, xStep: number, yStep: number) => {
        const passWidth = width <= xStart ? 0 : Math.ceil((width - xStart) / xStep); const passHeight = height <= yStart ? 0 : Math.ceil((height - yStart) / yStep);
        return passWidth === 0 || passHeight === 0 ? 0 : passHeight * (1 + rowBytes(passWidth));
      };
      const expectedBytes = interlace === 0 ? height * (1 + rowBytes(width)) : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]].reduce((sum, pass) => sum + passSize(pass[0], pass[1], pass[2], pass[3]), 0);
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes > MAX_INFLATED_PNG_BYTES) throw new Error(`PNG decoded scanlines exceed safe ${MAX_INFLATED_PNG_BYTES}-byte limit`);
      let inflated: Buffer;
      try { inflated = inflateSync(Buffer.concat(idatParts), { maxOutputLength: expectedBytes + 1 }); } catch { throw new Error('PNG IDAT payload does not inflate safely'); }
      if (inflated.length !== expectedBytes) throw new Error(`PNG decoded scanline length differs: expected ${expectedBytes}, found ${inflated.length}`);
      const assertFilters = (xStart: number, yStart: number, xStep: number, yStep: number) => {
        const passWidth = width <= xStart ? 0 : Math.ceil((width - xStart) / xStep); const passHeight = height <= yStart ? 0 : Math.ceil((height - yStart) / yStep); const bytesPerRow = rowBytes(passWidth);
        return { passHeight: passWidth === 0 ? 0 : passHeight, bytesPerRow };
      };
      let scanOffset = 0;
      const passes = interlace === 0 ? [[0, 0, 1, 1]] : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
      for (const pass of passes) { const { passHeight, bytesPerRow } = assertFilters(pass[0], pass[1], pass[2], pass[3]); for (let row = 0; row < passHeight; row += 1) { if (inflated[scanOffset] > 4) throw new Error('PNG scanline has invalid filter byte'); scanOffset += 1 + bytesPerRow; } }
      return { width, height };
    }
  }
  throw new Error('PNG is missing final IEND');
}
export function validateMasterBuffer(buffer: Buffer) {
  if (buffer.length > MAX_MASTER_BYTES) throw new Error(`master exceeds ${MAX_MASTER_BYTES} bytes`);
  const dimensions = pngMetadata(buffer);
  if (dimensions.width * dimensions.height > 32_000_000) throw new Error('master exceeds 32 megapixels');
  return { ...dimensions, bytes: buffer.length, sha256: sha256(buffer), mimeType: 'image/png' as const };
}
export function canonicalJson(value: unknown) { return `${JSON.stringify(value, null, 2)}\n`; }
export async function readCatalog(path = CATALOG_PATH): Promise<MasterCatalog> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as MasterCatalog;
  return validateCatalog(parsed, path);
}
export function validateCatalog(parsed: MasterCatalog, label = 'catalog'): MasterCatalog {
  if (parsed.version !== 1 || parsed.bucket !== SOURCE_MASTERS_BUCKET || !Array.isArray(parsed.masters) || !Array.isArray(parsed.runtimeDerivatives)) throw new Error(`${label} is not a source-master catalog v1`);
  const revisions = new Map<string, MasterRecord>(); const hashes = new Set<string>(); const derivativePaths = new Set<string>();
  for (const master of parsed.masters) {
    if (!master.id || !master.revisionId || revisions.has(master.revisionId) || !/^[a-f0-9]{64}$/.test(master.sha256) || hashes.has(master.sha256) || !master.originalFilename || master.originalFilename.includes('/') || master.originalFilename.includes('\\') || master.originalFilename.includes('..') || !Number.isSafeInteger(master.bytes) || master.bytes <= 0 || master.bytes > MAX_MASTER_BYTES || !Number.isSafeInteger(master.width) || master.width <= 0 || !Number.isSafeInteger(master.height) || master.height <= 0 || master.width * master.height > 32_000_000 || !Array.isArray(master.derivatives) || !master.provenance || !master.provenance.acquiredAt || Number.isNaN(Date.parse(master.provenance.acquiredAt)) || !master.provenance.source || !master.provenance.rights || !master.provenance.promptOrNote || !master.provenance.exportSettings || (master.verifiedAt !== undefined && Number.isNaN(Date.parse(master.verifiedAt))) || 'archiveReceiptId' in master) throw new Error(`duplicate or unsafe master record ${master.id} (including incomplete metadata)`);
    revisions.set(master.revisionId, master); hashes.add(master.sha256);
  }
  for (const derivative of parsed.runtimeDerivatives) {
    if (!derivative.path.startsWith('static/') || derivative.path.includes('..') || derivative.path.includes('\\') || derivativePaths.has(derivative.path) || !/^[a-f0-9]{64}$/.test(derivative.sha256) || !derivative.recipe || (derivative.sourceRevisionId !== null && !revisions.has(derivative.sourceRevisionId))) throw new Error(`invalid runtime derivative ${derivative.path}`);
    derivativePaths.add(derivative.path);
  }
  for (const master of parsed.masters) {
    const paths = new Set<string>();
    for (const derivative of master.derivatives) {
      if (!derivative.path.startsWith('static/') || derivative.path.includes('..') || derivative.path.includes('\\') || paths.has(derivative.path) || !/^[a-f0-9]{64}$/.test(derivative.sha256) || !derivative.recipe) throw new Error(`invalid historical derivative for ${master.revisionId}: ${derivative.path}`);
      paths.add(derivative.path);
    }
  }
  for (const runtime of parsed.runtimeDerivatives) {
    if (runtime.sourceRevisionId !== null && !revisions.get(runtime.sourceRevisionId)?.derivatives.some((derivative) => derivative.path === runtime.path && derivative.sha256 === runtime.sha256 && derivative.recipe === runtime.recipe)) {
      throw new Error(`runtime derivative missing from master revision ${runtime.sourceRevisionId}: ${runtime.path}`);
    }
  }
  for (const master of parsed.masters) {
    if (master.storageKey !== storageKey(master.sha256)) throw new Error(`catalog key does not match hash for ${master.id}`);
    if (master.mimeType !== 'image/png') throw new Error(`unsupported catalog MIME type for ${master.id}`);
    if (master.supersedes && (revisions.get(master.supersedes)?.id !== master.id || master.supersedes === master.revisionId)) throw new Error(`invalid supersedes revision for ${master.id}`);
  }
  return parsed;
}
export async function validateRuntimeDerivativeInventory(catalog: MasterCatalog, projectRoot = process.cwd()) {
  const results: Array<{ path: string; sha256: string }> = [];
  for (const derivative of catalog.runtimeDerivatives) {
    const target = resolve(projectRoot, derivative.path);
    if (!target.startsWith(`${resolve(projectRoot)}/`)) throw new Error(`runtime derivative escapes project root: ${derivative.path}`);
    const bytes = await readFile(target);
    const actual = sha256(bytes);
    if (actual !== derivative.sha256) throw new Error(`runtime derivative hash mismatch for ${derivative.path}: expected ${derivative.sha256}, found ${actual}`);
    results.push({ path: derivative.path, sha256: actual });
  }
  return results;
}
export async function writeCatalog(catalog: MasterCatalog, path = CATALOG_PATH) { await writeFile(path, canonicalJson(catalog)); }
export async function readReceipts(path = RECEIPTS_PATH): Promise<ReceiptFile> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as ReceiptFile;
    if (value.version !== 1 || !Array.isArray(value.receipts)) throw new Error('invalid receipts');
    const ids = new Set<string>();
    for (const receipt of value.receipts) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(receipt.archiveId) || ids.has(receipt.archiveId) || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !/^[a-f0-9]{64}$/.test(receipt.catalogSha256) || !Number.isSafeInteger(receipt.objectCount) || receipt.objectCount <= 0 || !Number.isSafeInteger(receipt.totalBytes) || receipt.totalBytes <= 0 || Number.isNaN(Date.parse(receipt.createdAt)) || (receipt.driveConfirmedAt !== undefined && Number.isNaN(Date.parse(receipt.driveConfirmedAt))) || (receipt.restoreChecks !== undefined && (!Array.isArray(receipt.restoreChecks) || receipt.restoreChecks.some((check) => Number.isNaN(Date.parse(check.verifiedAt)) || check.sha256 !== receipt.sha256)))) throw new Error(`invalid archive receipt ${receipt.archiveId}`);
      ids.add(receipt.archiveId);
    }
    return value;
  }
  catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, receipts: [] }; throw error; }
}
export async function writeReceipts(receipts: ReceiptFile, path = RECEIPTS_PATH) { await writeFile(path, canonicalJson(receipts)); }
export function catalogSha256(catalog: MasterCatalog) { return sha256(canonicalJson(catalog)); }
// These lists contain immutable revision IDs (the legacy property names are retained
// so existing status consumers do not need a compatibility migration).
export type MasterReleaseStatus = { catalogSha256: string; verifiedMasterIds: string[]; missingVerificationIds: string[]; matchingReceipt?: ArchiveReceipt; eligible: boolean };
export function releaseEligibility(catalog: MasterCatalog, receipts: ReceiptFile): MasterReleaseStatus {
  const catalogHash = catalogSha256(catalog);
  const missingVerificationIds = catalog.masters.filter((master) => !master.verifiedAt).map((master) => master.revisionId);
  const totalBytes = catalog.masters.reduce((sum, master) => sum + master.bytes, 0);
  const matchingReceipt = receipts.receipts.find((receipt) => receipt.catalogSha256 === catalogHash && receipt.objectCount === catalog.masters.length && receipt.totalBytes === totalBytes && /^[a-f0-9]{64}$/.test(receipt.sha256));
  return { catalogSha256: catalogHash, verifiedMasterIds: catalog.masters.filter((master) => Boolean(master.verifiedAt)).map((master) => master.revisionId), missingVerificationIds, matchingReceipt, eligible: missingVerificationIds.length === 0 && Boolean(matchingReceipt) };
}
export function matchingRestoreReceipt(receipts: ReceiptFile, archive: VerifiedArchive): ArchiveReceipt | undefined {
  const catalogHash = catalogSha256(archive.catalog);
  const totalBytes = archive.catalog.masters.reduce((sum, master) => sum + master.bytes, 0);
  const candidates = receipts.receipts.filter((receipt) => receipt.sha256 === archive.archiveSha256);
  const match = candidates.find((receipt) => receipt.catalogSha256 === catalogHash && receipt.objectCount === archive.objectCount && receipt.totalBytes === totalBytes);
  if (match) return match;
  if (candidates.length) throw new Error('tracked receipt metadata does not match restored archive');
  return undefined;
}
export function storageClient() {
  const url = process.env.MEDIA_SUPABASE_URL;
  // Supabase secret keys are the preferred server-side credential. Keep the legacy
  // service-role alias only to make existing self-hosted/local operator setups migratable.
  const key = process.env.MEDIA_SUPABASE_SECRET_KEY ?? process.env.MEDIA_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('MEDIA_SUPABASE_URL and MEDIA_SUPABASE_SECRET_KEY are required (MEDIA_SUPABASE_SERVICE_ROLE_KEY remains a temporary compatibility alias); never use a browser key for master tooling');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function uploadAndVerify(record: MasterRecord, source: Buffer, projectRoot = process.cwd()) {
  const metadata = validateMasterBuffer(source);
  if (metadata.sha256 !== record.sha256 || metadata.bytes !== record.bytes || metadata.width !== record.width || metadata.height !== record.height) throw new Error(`source does not match catalog record ${record.id}`);
  if (storageMode() === 'local') {
    const target = localMasterPath(record, projectRoot);
    await mkdir(dirname(target), { recursive: true });
    try { await writeFile(target, source, { flag: 'wx' }); }
    catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stored = await readFile(target);
    if (sha256(stored) !== record.sha256) throw new Error(`local read-back hash mismatch for ${record.id}`);
    return;
  }
  const client = storageClient(); const bucket = client.storage.from(SOURCE_MASTERS_BUCKET);
  const { error } = await bucket.upload(record.storageKey, source, { contentType: record.mimeType, upsert: false, cacheControl: '31536000' });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`upload ${record.id}: ${error.message}`);
  const { data, error: downloadError } = await bucket.download(record.storageKey);
  if (downloadError || !data) throw new Error(`download verification ${record.id}: ${downloadError?.message ?? 'empty response'}`);
  const downloaded = Buffer.from(await data.arrayBuffer());
  if (sha256(downloaded) !== record.sha256) throw new Error(`download verification hash mismatch for ${record.id}`);
}
export function safeArchiveEntry(name: string) {
  if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`unsafe archive entry: ${name}`);
  return name;
}
async function addArchiveFile(stage: string, entry: string, bytes: Buffer | string) {
  const target = resolve(stage, safeArchiveEntry(entry));
  if (!target.startsWith(`${stage}/`)) throw new Error('archive entry escapes staging directory');
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); await utimes(target, new Date(315532800000), new Date(315532800000));
}
export async function createArchive(catalog: MasterCatalog, objects: Map<string, Buffer>, outputDirectory: string) {
  const catalogText = canonicalJson(catalog); const catalogHash = sha256(catalogText);
  const stage = await mkdtemp(join(tmpdir(), 'brac-master-archive-'));
  let publishStage: string | undefined;
  try {
    await addArchiveFile(stage, 'catalog.json', catalogText);
    let archivedTotalBytes = 0;
    for (const record of [...catalog.masters].sort((a, b) => a.storageKey.localeCompare(b.storageKey))) {
      const object = objects.get(record.sha256); if (!object || object.length !== record.bytes || sha256(object) !== record.sha256) throw new Error(`missing or corrupt master ${record.id}`);
      archivedTotalBytes += record.bytes; await addArchiveFile(stage, `objects/${record.storageKey}`, object);
    }
    const outputRoot = resolve(outputDirectory); await mkdir(outputRoot, { recursive: true });
    publishStage = await mkdtemp(join(outputRoot, '.source-masters-publish-'));
    const unpublishedArchive = join(publishStage, 'archive.zip');
    const list = ['catalog.json', ...catalog.masters.map((r) => `objects/${r.storageKey}`).sort()];
    await execFileAsync('zip', ['-X', '-q', unpublishedArchive, ...list], { cwd: stage, env: { ...process.env, TZ: 'UTC' } });
    const archiveBytes = await readFile(unpublishedArchive); const archiveSha256 = sha256(archiveBytes);
    const archiveId = `source-masters-${archiveSha256}`; const archive = join(outputRoot, `${archiveId}.zip`); const sidecar = `${archive}.sha256`;
    const unpublishedSidecar = join(publishStage, 'archive.zip.sha256');
    await writeFile(unpublishedSidecar, `${archiveSha256}  ${basename(archive)}\n`);
    // The private publication directory lives under outputRoot, so hard-link creation
    // is same-filesystem and atomically fails with EEXIST. Unlike POSIX rename, it can
    // never replace a concurrently published archive or an orphan sidecar.
    try { await link(unpublishedArchive, archive); } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`refusing to overwrite existing archive ${archive}`);
      throw error;
    }
    try { await link(unpublishedSidecar, sidecar); } catch (error: unknown) {
      // This link was created above by this invocation; remove only that exact archive
      // path, then let staging cleanup unlink its private originals.
      await rm(archive, { force: true });
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`refusing to overwrite existing archive sidecar ${sidecar}`);
      throw error;
    }
    const receipt: ArchiveReceipt = { archiveId, sha256: archiveSha256, catalogSha256: catalogHash, objectCount: catalog.masters.length, totalBytes: archivedTotalBytes, createdAt: new Date().toISOString() };
    return { archive, receipt };
  } finally { await rm(stage, { recursive: true, force: true }); if (publishStage) await rm(publishStage, { recursive: true, force: true }); }
}
export async function verifyArchive(archive: string, options: { requireSidecar?: boolean } = {}) {
  const absoluteArchive = resolve(archive); const listing = (await execFileAsync('unzip', ['-Z1', absoluteArchive])).stdout.trim().split('\n').filter(Boolean);
  const sidecar = `${absoluteArchive}.sha256`;
  try {
    const line = (await readFile(sidecar, 'utf8')).trim();
    // The SHA-256 is authoritative. Accept the original filename in a sidecar so a
    // ZIP and its sidecar remain verifiable after a user renames them in Drive.
    const expected = /^([a-f0-9]{64})  [^\r\n]+$/.exec(line)?.[1];
    if (!expected) throw new Error(`invalid archive checksum sidecar ${sidecar}`);
    const actual = sha256(await readFile(absoluteArchive));
    if (actual !== expected) throw new Error(`archive checksum sidecar mismatch for ${absoluteArchive}`);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !options.requireSidecar) {
      // Legacy archives can still be inspected by the library; operator CLI requires a sidecar.
    } else throw error;
  }
  if (new Set(listing).size !== listing.length) throw new Error('archive contains duplicate entries');
  for (const entry of listing) safeArchiveEntry(entry);
  if (!listing.includes('catalog.json')) throw new Error('archive does not include catalog.json');

  // Restore one vetted entry at a time into a fresh temporary directory. Never ask
  // `unzip` to choose filesystem paths from the archive: every listed name is first
  // checked above, then materialized through addArchiveFile's containment check.
  const restoreRoot = await mkdtemp(join(tmpdir(), 'brac-master-restore-'));
  try {
    const { stdout: catalogOutput } = await execFileAsync('unzip', ['-p', absoluteArchive, 'catalog.json'], { encoding: 'buffer' as never, maxBuffer: 10 * 1024 * 1024 });
    const catalogBytes = Buffer.isBuffer(catalogOutput) ? catalogOutput : Buffer.from(catalogOutput);
    await addArchiveFile(restoreRoot, 'catalog.json', catalogBytes);
    const catalog = validateCatalog(JSON.parse((await readFile(resolve(restoreRoot, 'catalog.json'))).toString('utf8')) as MasterCatalog, 'embedded archive catalog');
    const expectedEntries = new Set(['catalog.json', ...catalog.masters.map((record) => `objects/${record.storageKey}`)]);
    for (const entry of listing) if (!expectedEntries.has(entry)) throw new Error(`archive contains unexpected entry: ${entry}`);
    for (const entry of expectedEntries) if (!listing.includes(entry)) throw new Error(`archive is missing ${entry}`);

    for (const record of catalog.masters) {
      const entry = `objects/${record.storageKey}`;
      // `unzip -p` writes the entire object to stdout. The Node default is only 1 MiB,
      // while the source-master policy permits 50 MiB PNGs. Keep a finite bound so a
      // malformed archive cannot cause unbounded process memory growth.
      const { stdout } = await execFileAsync('unzip', ['-p', absoluteArchive, entry], { encoding: 'buffer' as never, maxBuffer: MAX_MASTER_BYTES + 1024 });
      const restored = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
      await addArchiveFile(restoreRoot, entry, restored);
      const bytes = await readFile(resolve(restoreRoot, entry));
      const details = validateMasterBuffer(bytes);
      if (details.sha256 !== record.sha256 || details.bytes !== record.bytes || details.width !== record.width || details.height !== record.height || details.mimeType !== record.mimeType) throw new Error(`archive object does not match catalog record ${record.id}`);
    }
    return { catalog, objectCount: catalog.masters.length, archiveSha256: sha256(await readFile(absoluteArchive)) };
  } finally {
    await rm(restoreRoot, { recursive: true, force: true });
  }
}
export async function collectCatalogObjectsFromStorage(catalog: MasterCatalog, projectRoot = process.cwd()) {
  if (storageMode() === 'local') {
    const objects = new Map<string, Buffer>();
    for (const record of catalog.masters) {
      const path = localMasterPath(record, projectRoot);
      let bytes: Buffer;
      try { bytes = await readFile(path); }
      catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`missing local source master for ${record.id}: ${path}. Re-ingest the original PNG; do not add it to Git.`);
        throw error;
      }
      if (sha256(bytes) !== record.sha256) throw new Error(`local read-back hash mismatch for ${record.id}`);
      objects.set(record.sha256, bytes);
    }
    return objects;
  }
  const client = storageClient(); const bucket = client.storage.from(SOURCE_MASTERS_BUCKET); const objects = new Map<string, Buffer>();
  for (const record of catalog.masters) {
    const { data, error } = await bucket.download(record.storageKey); if (error || !data) throw new Error(`download ${record.id}: ${error?.message ?? 'empty response'}`);
    const bytes = Buffer.from(await data.arrayBuffer()); if (sha256(bytes) !== record.sha256) throw new Error(`download hash mismatch for ${record.id}`); objects.set(record.sha256, bytes);
  }
  return objects;
}
export async function assertRegularFile(path: string) { const details = await stat(path); if (!details.isFile()) throw new Error(`${path} must be a regular file`); }
