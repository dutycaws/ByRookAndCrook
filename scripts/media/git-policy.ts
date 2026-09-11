import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mediaPolicy } from './policy.js';

/** The largest ordinary Git object permitted in newly introduced history. */
export const MAX_GIT_BLOB_BYTES = mediaPolicy.git.maxNewBlobBytes;

const ZERO_OID = /^0+$/;
const LFS_POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\n/;
const LFS_CONFIG = /\b(?:filter|merge|diff)\s*=\s*lfs\b|\[filter\s+"?lfs"?\]/i;
const VIDEO_EXTENSIONS = new Set(mediaPolicy.git.forbiddenVideoExtensions);
const SOURCE_MASTER_EXTENSIONS = new Set(['.png', '.tif', '.tiff', '.psd', '.xcf', '.kra']);
const CURATED_STILL_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const CURATED_ROOT = 'docs/screenshots/curated/';
const EMPTY_TREE_OID = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

type GrandfatheredObject = { path: string; oid: string; reason: string };

function loadGrandfatheredObjects(): ReadonlyMap<string, GrandfatheredObject> {
  const policyPath = fileURLToPath(new URL('../../config/media-policy.json', import.meta.url));
  const parsed = JSON.parse(readFileSync(policyPath, 'utf8')) as { git?: { grandfatheredObjects?: unknown } };
  if (!Array.isArray(parsed.git?.grandfatheredObjects)) {
    throw new Error('media-policy.git.grandfatheredObjects must be an array.');
  }
  const entries = new Map<string, GrandfatheredObject>();
  for (const candidate of parsed.git.grandfatheredObjects) {
    if (!candidate || typeof candidate !== 'object') throw new Error('Invalid grandfathered media-policy entry.');
    const { path, oid, reason } = candidate as Partial<GrandfatheredObject>;
    if (typeof path !== 'string' || !path || typeof oid !== 'string' || !/^[0-9a-f]{40}$/.test(oid) || typeof reason !== 'string' || !reason) {
      throw new Error('Each grandfathered media-policy entry requires path, 40-character oid, and reason.');
    }
    const key = `${path}\0${oid}`;
    if (entries.has(key)) throw new Error(`Duplicate grandfathered media-policy entry for ${path} (${oid}).`);
    entries.set(key, { path, oid, reason });
  }
  return entries;
}

const GRANDFATHERED_OBJECTS = loadGrandfatheredObjects();

function isGrandfathered(path: string | undefined, oid: string): boolean {
  return Boolean(path && GRANDFATHERED_OBJECTS.has(`${path}\0${oid}`));
}

export type PolicyMode =
  | { kind: 'range'; base: string; head: string }
  | { kind: 'staged' };

export type GitPolicyViolation = {
  code: 'oversized-blob' | 'oversized-grandfathered-copy' | 'git-lfs-pointer' | 'git-lfs-config' | 'git-video'
    | 'curated-still-extension' | 'curated-set-count' | 'curated-set-bytes';
  message: string;
  oid: string;
  path: string;
  /** Actual bytes in the object that triggered the policy. */
  size: number;
  /** Numeric byte limit or a human-readable prohibition for non-size rules. */
  limit: number | string;
  /** The approved destination, or an explicit non-storage remediation. */
  targetStorageClass: string;
  aggregate?: { set: string; files: number; bytes: number };
};

export type GitPolicyResult = {
  mode: PolicyMode['kind'];
  examinedBlobs: number;
  violations: GitPolicyViolation[];
  /** Fully resolved commit IDs used to construct the inspected range. */
  base?: string;
  head: string;
};

type ObjectInfo = { oid: string; type: string; size: number };
type RawDiff = { status: string; oldOid: string; newOid: string; oldPath?: string; newPath?: string };
type CuratedEntry = { oid: string; size: number; path: string };

function git(args: string[], cwd: string, input?: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { cwd, stdio: 'pipe' });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      const output = Buffer.concat(stdout).toString('utf8');
      if (code === 0) return resolvePromise(output);
      const error = Buffer.concat(stderr).toString('utf8').trim() || `git ${args.join(' ')} exited ${code}`;
      reject(new Error(error));
    });
    child.stdin.end(input);
  });
}

function splitObjectLines(output: string): Map<string, Set<string>> {
  const paths = new Map<string, Set<string>>();
  for (const line of output.split('\n')) {
    if (!line) continue;
    const [oid, ...rest] = line.split(' ');
    if (!oid) continue;
    const path = rest.join(' ');
    const candidates = paths.get(oid) ?? new Set<string>();
    if (path) candidates.add(path);
    paths.set(oid, candidates);
  }
  return paths;
}

async function inspectObjects(cwd: string, oids: Iterable<string>): Promise<ObjectInfo[]> {
  const values = [...oids];
  if (!values.length) return [];
  const output = await git(
    ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    cwd,
    `${values.join('\n')}\n`
  );
  return output.trim().split('\n').filter(Boolean).map((line) => {
    const [oid, type, rawSize] = line.split(' ');
    const size = Number(rawSize);
    if (!oid || !type || !Number.isSafeInteger(size)) throw new Error(`Could not parse git object metadata: ${line}`);
    return { oid, type, size };
  });
}

async function readBlob(cwd: string, oid: string): Promise<string> {
  return git(['cat-file', 'blob', oid], cwd);
}

function parseRawDiff(output: string): RawDiff[] {
  const fields = output.split('\0');
  const entries: RawDiff[] = [];
  for (let index = 0; index < fields.length - 1;) {
    const header = fields[index++];
    if (!header) continue;
    const parts = header.split(' ');
    const status = parts.at(-1);
    if (!status || !header.startsWith(':') || parts.length < 5) {
      throw new Error(`Could not parse git raw diff header: ${header}`);
    }
    const oldOid = parts[2];
    const newOid = parts[3];
    const kind = status[0];
    let oldPath: string | undefined;
    let newPath: string | undefined;
    if (kind === 'A') {
      newPath = fields[index++];
    } else if (kind === 'D') {
      oldPath = fields[index++];
    } else if (kind === 'R' || kind === 'C') {
      oldPath = fields[index++];
      newPath = fields[index++];
    } else {
      // For modifications the path is unchanged, so raw -z emits it once.
      oldPath = fields[index++];
      newPath = oldPath;
    }
    entries.push({ status, oldOid, newOid, oldPath, newPath });
  }
  return entries;
}

async function objectSize(cwd: string, oid: string, cache: Map<string, number>): Promise<number> {
  if (cache.has(oid)) return cache.get(oid)!;
  const [info] = await inspectObjects(cwd, [oid]);
  if (!info || info.type !== 'blob') throw new Error(`${oid} is not a blob`);
  cache.set(oid, info.size);
  return info.size;
}

function formatBlobViolation(code: GitPolicyViolation['code'], oid: string, size: number, path?: string): GitPolicyViolation {
  const reportedPath = path ?? '<path unavailable; inspect object SHA in introduced range>';
  const targetStorageClass = oversizedBlobTarget(reportedPath);
  if (code === 'oversized-grandfathered-copy') {
    return {
      code,
      oid,
      size,
      limit: MAX_GIT_BLOB_BYTES,
      targetStorageClass,
      path: reportedPath,
      message: `Grandfathered blob ${oid} (${size} bytes) is being added at ${reportedPath}; limit ${MAX_GIT_BLOB_BYTES} bytes; target ${targetStorageClass}. Only a true rename is allowed.`
    };
  }
  return {
    code,
    oid,
    size,
    limit: MAX_GIT_BLOB_BYTES,
    targetStorageClass,
    path: reportedPath,
    message: `Blob ${oid} (${size} bytes) exceeds the ${MAX_GIT_BLOB_BYTES}-byte Git limit at ${reportedPath}; target ${targetStorageClass}.`
  };
}

function oversizedBlobTarget(path: string): string {
  if (path.startsWith('docs/screenshots/')) {
    return 'Ignored artifacts/media-captures; optimize before curated Git';
  }
  if (path.startsWith('static/assets/')) {
    return 'Optimized static/assets runtime derivative (must meet per-asset and total runtime budgets)';
  }
  if (SOURCE_MASTER_EXTENSIONS.has(extname(path).toLowerCase())) {
    return 'Private Supabase Storage source-masters';
  }
  return 'Appropriate external media storage; do not add large binaries to Git';
}

function lfsViolations(oid: string, size: number, paths: Set<string>, content: string): GitPolicyViolation[] {
  const path = [...paths][0] ?? '<path unavailable; inspect object SHA in introduced range>';
  const violations: GitPolicyViolation[] = [];
  if (LFS_POINTER.test(content)) {
    violations.push({
      code: 'git-lfs-pointer', oid, path,
      size, limit: 'Git LFS pointers are prohibited', targetStorageClass: 'Supabase Storage source-masters or review-evidence',
      message: `Git LFS pointer ${oid} (${size} bytes) at ${path}; limit Git LFS prohibited; target Supabase Storage source-masters or review-evidence.`
    });
  }
  if ([...paths].some((candidate) => ['.gitattributes', '.lfsconfig'].includes(basename(candidate))) && LFS_CONFIG.test(content)) {
    violations.push({
      code: 'git-lfs-config', oid, path,
      size, limit: 'Git LFS configuration is prohibited', targetStorageClass: 'Remove configuration; this repository does not use Git LFS',
      message: `Git LFS configuration ${oid} (${size} bytes) at ${path}; limit Git LFS prohibited; target remove configuration.`
    });
  }
  return violations;
}

function videoViolations(oid: string, size: number, paths: Iterable<string>): GitPolicyViolation[] {
  return [...paths]
    .filter((path) => VIDEO_EXTENSIONS.has(extname(path).toLowerCase()))
    .map((path) => ({
      code: 'git-video' as const,
      oid,
      path,
      size,
      limit: 'New video files are prohibited in Git',
      targetStorageClass: 'Supabase Storage review-evidence',
      message: `Video ${path} (${size} bytes, object ${oid}); limit new video files prohibited in Git; target Supabase Storage review-evidence.`
    }));
}

async function rangeObjects(cwd: string, base: string, head: string) {
  const output = await git(['rev-list', '--objects', head, `^${base}`], cwd);
  return splitObjectLines(output);
}

async function resolveCommit(cwd: string, ref: string): Promise<string> {
  return (await git(['rev-parse', '--verify', `${ref}^{commit}`], cwd)).trim();
}

/**
 * GitHub sends an all-zero `before` SHA for a first push. The workflow translates
 * that to Git's empty-tree object so both `rev-list` and `diff` have a concrete
 * lower bound. Normal ranges continue to resolve commits (including tags that
 * peel to commits); only an actual tree object is accepted as the special base.
 */
async function resolveBase(cwd: string, ref: string): Promise<string> {
  try {
    return await resolveCommit(cwd, ref);
  } catch (commitError) {
    let object: string;
    try {
      object = (await git(['rev-parse', '--verify', ref], cwd)).trim();
    } catch {
      throw commitError;
    }
    const type = (await git(['cat-file', '-t', object], cwd)).trim();
    if (type === 'tree') return object;
    throw commitError;
  }
}

async function stagedDiff(cwd: string): Promise<RawDiff[]> {
  return parseRawDiff(await git(['diff', '--cached', '--raw', '-z', '--no-abbrev', '-M100%', 'HEAD'], cwd));
}

async function finalRangeDiff(cwd: string, base: string, head: string): Promise<RawDiff[]> {
  return parseRawDiff(await git(['diff', '--raw', '-z', '--no-abbrev', '-M100%', base, head], cwd));
}

async function introducedCommits(cwd: string, base: string, head: string): Promise<string[]> {
  const output = await git(['rev-list', '--topo-order', '--reverse', head, `^${base}`], cwd);
  return output.split('\n').filter(Boolean);
}

async function commitParents(cwd: string, commit: string): Promise<string[]> {
  const output = await git(['show', '-s', '--format=%P', commit], cwd);
  return output.trim().split(/\s+/).filter(Boolean);
}

/**
 * `rev-list --objects head ^base` only returns objects not already reachable from
 * base. This per-commit pass closes the complementary gap: a base object can be
 * copied to a new path and then deleted before head. Inspect every parent edge so
 * transient copies/replacements are still policy introductions; merge commits are
 * compared to each parent so merge-only resolutions are covered as well.
 */
async function transientPathViolations(
  cwd: string,
  base: string,
  head: string,
  newlyIntroducedOids: Set<string>,
  sizeCache: Map<string, number>
): Promise<GitPolicyViolation[]> {
  const violations: GitPolicyViolation[] = [];
  for (const commit of await introducedCommits(cwd, base, head)) {
    const parents = await commitParents(cwd, commit);
    for (const parent of parents.length ? parents : [EMPTY_TREE_OID]) {
      for (const diff of await finalRangeDiff(cwd, parent, commit)) {
        const kind = diff.status[0];
        if (kind === 'D' || ZERO_OID.test(diff.newOid) || newlyIntroducedOids.has(diff.newOid)) continue;
        // This is a byte-identical move, not an added second copy or replacement.
        if (kind === 'R' && diff.oldOid === diff.newOid) continue;
        if (!diff.newPath || isGrandfathered(diff.newPath, diff.newOid)) continue;
        const size = await objectSize(cwd, diff.newOid, sizeCache);
        const path = new Set([diff.newPath]);
        if (size <= MAX_GIT_BLOB_BYTES) {
          violations.push(...lfsViolations(diff.newOid, size, path, await readBlob(cwd, diff.newOid)));
        }
        violations.push(...videoViolations(diff.newOid, size, path));
        if (size > MAX_GIT_BLOB_BYTES) {
          violations.push(formatBlobViolation('oversized-grandfathered-copy', diff.newOid, size, diff.newPath));
        }
      }
    }
  }
  return violations;
}

function parseCuratedTree(output: string): CuratedEntry[] {
  return output.trim().split('\n').filter(Boolean).map((line) => {
    const match = /^(\d+)\s+blob\s+([0-9a-f]{40})\s+(\d+)\t(.+)$/.exec(line);
    if (!match) throw new Error(`Could not parse curated tree entry: ${line}`);
    return { oid: match[2], size: Number(match[3]), path: match[4] };
  });
}

async function curatedHeadTree(cwd: string, head: string): Promise<CuratedEntry[]> {
  return parseCuratedTree(await git(['ls-tree', '-r', '-l', head, '--', CURATED_ROOT], cwd));
}

async function curatedStagedTree(cwd: string): Promise<CuratedEntry[]> {
  const output = await git(['ls-files', '-s', '-z', '--', CURATED_ROOT], cwd);
  const entries = output.split('\0').filter(Boolean).flatMap((line) => {
    const match = /^(\d+)\s+([0-9a-f]{40})\s+(\d+)\t(.+)$/.exec(line);
    if (!match) throw new Error(`Could not parse staged curated entry: ${line}`);
    // An unmerged index is invalid for a commit; ignore non-stage-zero entries
    // here and let Git's normal conflict protection handle that state.
    if (match[3] !== '0') return [];
    return [{ oid: match[2], path: match[4] }];
  });
  const sizes = new Map<string, number>();
  return Promise.all(entries.map(async (entry) => ({ ...entry, size: await objectSize(cwd, entry.oid, sizes) })));
}

function curatedSetFor(path: string): string | null {
  const segments = path.split('/');
  if (segments.length < 6 || segments[0] !== 'docs' || segments[1] !== 'screenshots' || segments[2] !== 'curated') return null;
  return segments.slice(0, 5).join('/');
}

function curatedViolations(entries: CuratedEntry[]): GitPolicyViolation[] {
  const violations: GitPolicyViolation[] = [];
  const bySet = new Map<string, CuratedEntry[]>();
  for (const entry of entries) {
    const set = curatedSetFor(entry.path);
    if (!set) continue;
    const group = bySet.get(set) ?? [];
    group.push(entry);
    bySet.set(set, group);
  }
  for (const [set, group] of bySet) {
    const ordered = [...group].sort((left, right) => left.path.localeCompare(right.path));
    const total = ordered.reduce((sum, entry) => sum + entry.size, 0);
    const aggregate = { set, files: ordered.length, bytes: total };
    for (const entry of ordered) {
      if (!CURATED_STILL_EXTENSIONS.has(extname(entry.path).toLowerCase())) {
        violations.push({
          code: 'curated-still-extension', oid: entry.oid, path: entry.path, size: entry.size,
          limit: `Only ${[...CURATED_STILL_EXTENSIONS].join(', ')} curated still extensions are supported`,
          targetStorageClass: 'Ignored artifacts/media-captures or Supabase Storage review-evidence', aggregate,
          message: `Curated set ${set} contains unsupported ${entry.path} (${entry.size} bytes, object ${entry.oid}); limit still formats ${[...CURATED_STILL_EXTENSIONS].join(', ')}; target ignored artifacts/media-captures or Supabase Storage review-evidence.`
        });
      }
    }
    if (ordered.length > mediaPolicy.evidence.maxStillsPerSet) {
      const trigger = ordered[mediaPolicy.evidence.maxStillsPerSet];
      violations.push({
        code: 'curated-set-count', oid: trigger.oid, path: trigger.path, size: trigger.size,
        limit: mediaPolicy.evidence.maxStillsPerSet,
        targetStorageClass: 'Ignored artifacts/media-captures; select at most 12 optimized stills for curated Git', aggregate,
        message: `Curated set ${set} has ${ordered.length} files (${total} bytes); limit ${mediaPolicy.evidence.maxStillsPerSet} stills. Trigger ${trigger.path} (${trigger.size} bytes, object ${trigger.oid}); target ignored artifacts/media-captures.`
      });
    }
    let running = 0;
    const trigger = ordered.find((entry) => {
      running += entry.size;
      return running > mediaPolicy.evidence.maxStillSetBytes;
    });
    if (trigger) {
      violations.push({
        code: 'curated-set-bytes', oid: trigger.oid, path: trigger.path, size: trigger.size,
        limit: mediaPolicy.evidence.maxStillSetBytes,
        targetStorageClass: 'Ignored artifacts/media-captures; optimize/select stills before curated Git', aggregate,
        message: `Curated set ${set} totals ${total} bytes; limit ${mediaPolicy.evidence.maxStillSetBytes} bytes. Trigger ${trigger.path} (${trigger.size} bytes, object ${trigger.oid}); target ignored artifacts/media-captures.`
      });
    }
  }
  return violations;
}

/**
 * Checks Git objects rather than only files in the final tree. Range mode therefore
 * catches an oversized object even when a later commit in the same PR deletes it.
 */
export async function checkGitPolicy(mode: PolicyMode, cwd = process.cwd()): Promise<GitPolicyResult> {
  const violations: GitPolicyViolation[] = [];
  const sizeCache = new Map<string, number>();
  let pathsByOid: Map<string, Set<string>>;
  let diffs: RawDiff[];
  let newlyIntroducedOids: Set<string>;
  let base: string | undefined;
  let head: string;

  if (mode.kind === 'range') {
    // Resolve the exact commits once. We intentionally do not substitute a
    // merge-base: CI passes its explicit base SHA so the check covers every
    // object introduced by that review range, including objects later deleted.
    base = await resolveBase(cwd, mode.base);
    head = await resolveCommit(cwd, mode.head);
    pathsByOid = await rangeObjects(cwd, base, head);
    newlyIntroducedOids = new Set(pathsByOid.keys());
    diffs = await finalRangeDiff(cwd, base, head);
  } else {
    head = await resolveCommit(cwd, 'HEAD');
    diffs = await stagedDiff(cwd);
    pathsByOid = new Map<string, Set<string>>();
    for (const diff of diffs) {
      if (!ZERO_OID.test(diff.newOid)) {
        const paths = pathsByOid.get(diff.newOid) ?? new Set<string>();
        if (diff.newPath) paths.add(diff.newPath);
        pathsByOid.set(diff.newOid, paths);
      }
    }
    const headObjects = splitObjectLines(await git(['rev-list', '--objects', 'HEAD'], cwd));
    newlyIntroducedOids = new Set([...pathsByOid.keys()].filter((oid) => !headObjects.has(oid)));
  }

  const info = await inspectObjects(cwd, pathsByOid.keys());
  const blobs = info.filter((object) => object.type === 'blob');
  for (const object of blobs) sizeCache.set(object.oid, object.size);

  // New reachable objects are checked independently of their final path. This is
  // what catches an add-then-delete sequence in a commit range.
  for (const object of blobs) {
    const paths = pathsByOid.get(object.oid) ?? new Set<string>();
    const nonGrandfatheredPaths = [...paths].filter((path) => !isGrandfathered(path, object.oid));
    const onlyGrandfatheredPaths = paths.size > 0 && nonGrandfatheredPaths.length === 0;
    if (newlyIntroducedOids.has(object.oid) && !onlyGrandfatheredPaths && object.size > MAX_GIT_BLOB_BYTES) {
      violations.push(formatBlobViolation('oversized-blob', object.oid, object.size, nonGrandfatheredPaths[0]));
    }
    if (newlyIntroducedOids.has(object.oid) && !onlyGrandfatheredPaths) {
      violations.push(...videoViolations(object.oid, object.size, nonGrandfatheredPaths));
    }
    // LFS pointers and LFS config are necessarily small. Avoid reading large binary
    // objects simply to inspect a textual marker.
    if (object.size <= MAX_GIT_BLOB_BYTES) {
      violations.push(...lfsViolations(object.oid, object.size, paths, await readBlob(cwd, object.oid)));
    }
  }

  // A pre-existing large blob will not appear in the range object set when copied
  // to a new path. Inspect the final path diff to reject that copy, while -M100%
  // identifies byte-for-byte moves as renames and permits them.
  for (const diff of diffs) {
    const kind = diff.status[0];
    if (kind === 'D' || ZERO_OID.test(diff.newOid)) continue;
    const size = await objectSize(cwd, diff.newOid, sizeCache);
    if (diff.newPath) {
      const finalPath = new Set([diff.newPath]);
      const grandfatheredFinalPath = isGrandfathered(diff.newPath, diff.newOid);
      // A copy can reuse an old, small blob, so it is not present in the range
      // object set. Inspect every final destination path for the textual LFS
      // controls before considering rename/copy size exemptions.
      if (!grandfatheredFinalPath && size <= MAX_GIT_BLOB_BYTES) {
        violations.push(...lfsViolations(diff.newOid, size, finalPath, await readBlob(cwd, diff.newOid)));
      }
      if (!grandfatheredFinalPath) violations.push(...videoViolations(diff.newOid, size, finalPath));
      if (grandfatheredFinalPath) continue;
    }
    if (kind === 'R' && diff.oldOid === diff.newOid) continue;
    if (size <= MAX_GIT_BLOB_BYTES) continue;
    const existingNewObjectViolation = newlyIntroducedOids.has(diff.newOid);
    if (!existingNewObjectViolation) {
      violations.push(formatBlobViolation('oversized-grandfathered-copy', diff.newOid, size, diff.newPath));
    }
  }

  if (mode.kind === 'range' && base) {
    violations.push(...await transientPathViolations(cwd, base, head, newlyIntroducedOids, sizeCache));
  }

  const finalCuratedEntries = mode.kind === 'range'
    ? await curatedHeadTree(cwd, head)
    : await curatedStagedTree(cwd);
  violations.push(...curatedViolations(finalCuratedEntries));

  const unique = new Map<string, GitPolicyViolation>();
  for (const violation of violations) {
    unique.set(`${violation.code}:${violation.oid ?? ''}:${violation.path ?? ''}`, violation);
  }
  return { mode: mode.kind, base, head, examinedBlobs: blobs.length, violations: [...unique.values()] };
}

export function assertGitPolicy(result: GitPolicyResult): void {
  if (!result.violations.length) return;
  throw new Error(`Media Git policy failed:\n${result.violations.map((item) => `- ${item.message}`).join('\n')}`);
}

function parseArguments(args: string[]): PolicyMode {
  if (args.length === 1 && args[0] === '--staged') return { kind: 'staged' };
  const baseIndex = args.indexOf('--base');
  const headIndex = args.indexOf('--head');
  if (baseIndex >= 0 && headIndex >= 0 && args[baseIndex + 1] && args[headIndex + 1] && args.length === 4) {
    return { kind: 'range', base: args[baseIndex + 1], head: args[headIndex + 1] };
  }
  throw new Error('Usage: media:git:check -- --base <git-oid> --head <git-oid> | media:git:check:staged');
}

async function main(): Promise<void> {
  const result = await checkGitPolicy(parseArguments(process.argv.slice(2)), resolve(process.cwd()));
  const range = result.base ? `base=${result.base} head=${result.head}` : `staged against HEAD=${result.head}`;
  console.log(`media Git policy: ${range}; examined ${result.examinedBlobs} newly introduced/staged blob(s)`);
  assertGitPolicy(result);
  console.log('media Git policy: ok');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
