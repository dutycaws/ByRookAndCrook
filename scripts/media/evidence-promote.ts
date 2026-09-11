import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { maxClipBytes, maxCuratedStillBytes, maxCuratedStills, maxStillBytes, manifestOutput, safeEvidenceFileName, safeScope, supportedClips, supportedStills, validateManifest } from './evidence-common';

type EvidenceRecord = {
  schemaVersion: 1;
  records: Array<{ commit: string; scope: string; purpose: string; retentionClass: 'project-lifetime'; kind: 'still' | 'clip'; path?: string; bucket?: string; key?: string; url?: string; sha256: string; bytes: number; mimeType: string; manifestSha256: string; promotedAt: string }>;
};

function validateEvidenceIndex(value: unknown): asserts value is EvidenceRecord {
  if (!value || typeof value !== 'object' || (value as { schemaVersion?: unknown }).schemaVersion !== 1 || !Array.isArray((value as { records?: unknown }).records)) throw new Error('Evidence index must be a schemaVersion 1 object with a records array.');
  for (const record of (value as EvidenceRecord).records) {
    if (!/^[a-f0-9]{40}$/i.test(record.commit) || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(record.scope) || !['still', 'clip'].includes(record.kind) || !/^[a-f0-9]{64}$/i.test(record.sha256) || !/^[a-f0-9]{64}$/i.test(record.manifestSha256) || !Number.isSafeInteger(record.bytes) || record.bytes < 0) throw new Error('Evidence index contains an invalid record.');
    if (record.kind === 'still' && (!record.path || !/^docs\/screenshots\/curated\/[a-f0-9]{40}\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(record.path))) throw new Error('Evidence index contains an unsafe still path.');
    if (record.kind === 'clip' && (record.bucket !== 'review-evidence' || !record.key || !/^v1\/[A-Za-z0-9-]+\/[a-f0-9]{64}\/[A-Za-z0-9._-]+\.webm$/.test(record.key) || !record.url)) throw new Error('Evidence index contains an invalid review-evidence clip record.');
  }
}

function recordIdentity(record: EvidenceRecord['records'][number]) {
  return [record.kind, record.commit, record.scope, record.kind === 'clip' ? record.key : record.path].join(':');
}

function argument(name: string) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function list(name: string) { return (argument(name) ?? '').split(',').map((value) => value.trim()).filter(Boolean); }
function hash(data: Buffer) { return createHash('sha256').update(data).digest('hex'); }
const immutableCacheControl = '31536000, public, immutable';

async function existingCuratedStills(directory: string): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const values = await Promise.all(entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return existingCuratedStills(path);
      if (!entry.isFile()) return [];
      const contents = await readFile(path);
      return [{ path, bytes: (await stat(path)).size, sha256: hash(contents) }];
    }));
    return values.flat();
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

const manifestPath = argument('--manifest');
const scopeValue = argument('--scope');
if (!manifestPath || !scopeValue) throw new Error('Usage: evidence:promote -- --manifest <capture-manifest.json> --scope <scope> [--stills a.png,b.webp] [--clips demo.webm]');
const scope = safeScope(scopeValue);
const { manifest, root } = await validateManifest(resolve(manifestPath));
const stills = list('--stills').map((value) => manifestOutput(manifest, root, value, supportedStills));
const clips = list('--clips').map((value) => manifestOutput(manifest, root, value, supportedClips));
if (stills.length + clips.length === 0) throw new Error('Select at least one still or clip to promote.');
if (stills.length > maxCuratedStills) throw new Error(`At most ${maxCuratedStills} stills may be promoted at once.`);
if (stills.some((still) => still.bytes > maxStillBytes)) throw new Error(`Each curated still must be at most ${maxStillBytes} bytes.`);
if (stills.reduce((sum, still) => sum + still.bytes, 0) > maxCuratedStillBytes) throw new Error(`Curated stills exceed the ${maxCuratedStillBytes}-byte set limit.`);
if (clips.some((clip) => clip.bytes > maxClipBytes)) throw new Error(`Each promoted clip must be at most ${maxClipBytes} bytes.`);

const indexPath = resolve('docs/quality/evidence-index.json');
const markdownPath = resolve('docs/quality/evidence-index.md');
let index: EvidenceRecord = { schemaVersion: 1, records: [] };
try { index = JSON.parse(await readFile(indexPath, 'utf8')) as EvidenceRecord; } catch (error: unknown) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}
validateEvidenceIndex(index);
const manifestSha256 = hash(await readFile(resolve(manifestPath)));
const now = new Date().toISOString();
const additions: EvidenceRecord['records'] = [];
const curatedDirectory = resolve('docs/screenshots/curated', manifest.git.commit, scope);
const existingStills = await existingCuratedStills(curatedDirectory);
const existingByPath = new Map(existingStills.map((still) => [still.path, still]));
const indexedByPath = new Map(index.records
  .filter((record) => record.kind === 'still' && record.commit === manifest.git.commit && record.scope === scope && record.path)
  .map((record) => [resolve(record.path!), { path: resolve(record.path!), bytes: record.bytes, sha256: record.sha256 }]));
for (const [path, indexed] of indexedByPath) {
  const physical = existingByPath.get(path);
  if (physical && (physical.sha256 !== indexed.sha256 || physical.bytes !== indexed.bytes)) throw new Error(`Evidence index disagrees with immutable curated still ${path}.`);
}
const accountedByPath = new Map([...indexedByPath, ...existingByPath]);
const newStills = stills.filter((still) => {
  const target = resolve(curatedDirectory, safeEvidenceFileName(basename(still.path), still.mimeType));
  const existing = accountedByPath.get(target);
  if (!existing) return true;
  if (existing.sha256 !== still.sha256) throw new Error(`Immutable curated still collision: ${target}`);
  return false;
});
if (accountedByPath.size + newStills.length > maxCuratedStills) {
  throw new Error(`Curated evidence set ${manifest.git.commit}/${scope} would exceed ${maxCuratedStills} stills.`);
}
if ([...accountedByPath.values()].reduce((sum, still) => sum + still.bytes, 0) + newStills.reduce((sum, still) => sum + still.bytes, 0) > maxCuratedStillBytes) {
  throw new Error(`Curated evidence set ${manifest.git.commit}/${scope} would exceed the ${maxCuratedStillBytes}-byte limit.`);
}
for (const still of stills) {
  const target = resolve(curatedDirectory, safeEvidenceFileName(basename(still.path), still.mimeType));
  await mkdir(resolve(target, '..'), { recursive: true });
  try { await copyFile(still.source, target, constants.COPYFILE_EXCL); } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    if (hash(await readFile(target)) !== still.sha256) throw new Error(`Refusing to overwrite curated still ${target}.`);
  }
  additions.push({ commit: manifest.git.commit, scope, purpose: scope, retentionClass: 'project-lifetime', kind: 'still', path: target.replace(`${resolve('.')}/`, ''), sha256: still.sha256, bytes: still.bytes, mimeType: still.mimeType, manifestSha256, promotedAt: now });
}

if (clips.length > 0) {
  const url = process.env.MEDIA_SUPABASE_URL;
  const secretKey = process.env.MEDIA_SUPABASE_SECRET_KEY ?? process.env.MEDIA_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) throw new Error('Promoting clips requires MEDIA_SUPABASE_URL and MEDIA_SUPABASE_SECRET_KEY (the legacy MEDIA_SUPABASE_SERVICE_ROLE_KEY is a compatibility alias). Never expose this credential to browser code.');
  const storage = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
  for (const clip of clips) {
    const key = `v1/${scope}/${clip.sha256}/${safeEvidenceFileName(basename(clip.path), clip.mimeType)}`;
    const contents = await readFile(clip.source);
    const { error } = await storage.from('review-evidence').upload(key, contents, { contentType: clip.mimeType, cacheControl: immutableCacheControl, upsert: false });
    if (error && !/already exists|duplicate/i.test(error.message)) throw error;
    const download = await storage.from('review-evidence').download(key);
    if (download.error) throw download.error;
    const downloaded = Buffer.from(await download.data.arrayBuffer());
    if (hash(downloaded) !== clip.sha256) throw new Error(`Uploaded clip failed hash verification: ${key}`);
    const { data } = storage.from('review-evidence').getPublicUrl(key);
    const publicResponse = await fetch(data.publicUrl, { method: 'HEAD' });
    const cacheControl = publicResponse.headers.get('cache-control')?.toLowerCase() ?? '';
    if (!publicResponse.ok || !cacheControl.includes('public') || !cacheControl.includes('immutable') || !cacheControl.includes('max-age=31536000')) throw new Error(`Uploaded clip is missing immutable public cache policy: ${key}`);
    additions.push({ commit: manifest.git.commit, scope, purpose: scope, retentionClass: 'project-lifetime', kind: 'clip', bucket: 'review-evidence', key, url: data.publicUrl, sha256: clip.sha256, bytes: clip.bytes, mimeType: clip.mimeType, manifestSha256, promotedAt: now });
  }
}

for (const addition of additions) {
  const identity = recordIdentity(addition);
  const existing = index.records.find((record) => recordIdentity(record) === identity);
  if (existing && existing.sha256 !== addition.sha256) {
    throw new Error(`Evidence index already contains conflicting immutable record ${identity}.`);
  }
  if (!existing) index.records.push(addition);
}
await mkdir(resolve(indexPath, '..'), { recursive: true });
await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
const lines = ['# Curated evidence', '', 'This index is generated by `npm run media:evidence:promote`; do not manually change object URLs.', ''];
for (const record of index.records) lines.push(`- ${record.kind === 'clip' ? `[${record.scope} clip](${record.url})` : `\`${record.path}\``} — ${record.commit.slice(0, 12)}, ${record.bytes} bytes, SHA-256 \`${record.sha256}\`.`);
await writeFile(markdownPath, `${lines.join('\n')}\n`);
console.info(`Promoted ${additions.length} evidence item(s).`);
