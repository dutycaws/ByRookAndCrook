import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkGitPolicy, MAX_GIT_BLOB_BYTES } from '../../scripts/media/git-policy';
import { mediaPolicy } from '../../scripts/media/policy';

const roots: string[] = [];

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function gitBlobFromWorkspace(oid: string): Buffer {
  return Buffer.from(execFileSync('git', ['cat-file', 'blob', oid], { cwd: process.cwd(), maxBuffer: 5_000_000 }));
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'media-git-policy-'));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'media-policy@example.test');
  git(root, 'config', 'user.name', 'Media Policy Test');
  await writeFile(join(root, 'README.md'), 'baseline\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-qm', 'baseline');
  return root;
}

async function commitFile(root: string, path: string, content: string | Buffer, message = path): Promise<string> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
  git(root, 'add', '--', path);
  git(root, 'commit', '-qm', message);
  return git(root, 'rev-parse', 'HEAD');
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('media Git policy', () => {
  it('allows an object exactly at the ordinary-Git limit and rejects one byte above it', async () => {
    const root = await repository();
    const base = git(root, 'rev-parse', 'HEAD');
    const accepted = await commitFile(root, 'allowed.bin', Buffer.alloc(MAX_GIT_BLOB_BYTES, 7));
    expect((await checkGitPolicy({ kind: 'range', base, head: accepted }, root)).violations).toEqual([]);

    const nextBase = accepted;
    const rejected = await commitFile(root, 'rejected.bin', Buffer.alloc(MAX_GIT_BLOB_BYTES + 1, 9));
    expect((await checkGitPolicy({ kind: 'range', base: nextBase, head: rejected }, root)).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'oversized-blob', path: 'rejected.bin' })]));
  });

  it('finds a large object that is added then deleted within the inspected commit range', async () => {
    const root = await repository();
    const base = git(root, 'rev-parse', 'HEAD');
    await commitFile(root, 'temporary-large.bin', Buffer.alloc(MAX_GIT_BLOB_BYTES + 1, 1), 'add large temporary file');
    git(root, 'rm', '-q', 'temporary-large.bin');
    git(root, 'commit', '-qm', 'delete large temporary file');
    const head = git(root, 'rev-parse', 'HEAD');

    expect((await checkGitPolicy({ kind: 'range', base, head }, root)).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'oversized-blob', path: 'temporary-large.bin' })]));
  });

  it('accepts Git’s empty tree as the lower bound for a root/first-push range', async () => {
    const root = await repository();
    const emptyTree = git(root, 'hash-object', '-t', 'tree', '/dev/null');
    const head = await commitFile(root, 'first-push-large.bin', Buffer.alloc(MAX_GIT_BLOB_BYTES + 1, 6));

    const result = await checkGitPolicy({ kind: 'range', base: emptyTree, head }, root);
    expect(result.base).toBe(emptyTree);
    expect(result.head).toBe(head);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'oversized-blob', path: 'first-push-large.bin' })
    ]));
  });

  it('grandfathers only the reviewed current path/OID pairs when a base predates them', async () => {
    const root = await repository();
    const base = git(root, 'rev-parse', 'HEAD');
    const historical = [
      {
        path: 'docs/reference/CozyTavernConceptArt2.png',
        oid: 'c732c4c1323d6519399e5d0c4c29e2fe98ab6911'
      },
      {
        path: 'docs/screenshots/final-review/bakery-interaction.webm',
        oid: 'a64a144333775187ba028b0462852d29585d9bb0'
      }
    ];
    for (const item of historical) {
      await mkdir(dirname(join(root, item.path)), { recursive: true });
      await writeFile(join(root, item.path), gitBlobFromWorkspace(item.oid));
    }
    git(root, 'add', '--', ...historical.map((item) => item.path));
    git(root, 'commit', '-qm', 'historical media introduced before policy');
    const head = git(root, 'rev-parse', 'HEAD');

    expect((await checkGitPolicy({ kind: 'range', base, head }, root)).violations).toEqual([]);

    await writeFile(join(root, 'docs/reference/copied-concept.png'), gitBlobFromWorkspace(historical[0].oid));
    git(root, 'add', 'docs/reference/copied-concept.png');
    git(root, 'commit', '-qm', 'copy reviewed historical image');
    const copied = git(root, 'rev-parse', 'HEAD');
    expect((await checkGitPolicy({ kind: 'range', base: head, head: copied }, root)).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        code: 'oversized-grandfathered-copy', path: 'docs/reference/copied-concept.png'
      })]));

    await writeFile(join(root, historical[0].path), Buffer.alloc(MAX_GIT_BLOB_BYTES + 1, 7));
    git(root, 'add', '--', historical[0].path);
    git(root, 'commit', '-qm', 'replace reviewed historical image');
    const replaced = git(root, 'rev-parse', 'HEAD');
    expect((await checkGitPolicy({ kind: 'range', base: copied, head: replaced }, root)).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        code: 'oversized-blob', path: historical[0].path
      })]));
  });

  it('rejects a transient copy of grandfathered oversized and video objects even when it is deleted before head', async () => {
    const root = await repository();
    const historical = [
      {
        path: 'docs/reference/CozyTavernConceptArt2.png',
        oid: 'c732c4c1323d6519399e5d0c4c29e2fe98ab6911'
      },
      {
        path: 'docs/screenshots/final-review/bakery-interaction.webm',
        oid: 'a64a144333775187ba028b0462852d29585d9bb0'
      }
    ];
    for (const item of historical) {
      await mkdir(dirname(join(root, item.path)), { recursive: true });
      await writeFile(join(root, item.path), gitBlobFromWorkspace(item.oid));
    }
    git(root, 'add', '--', ...historical.map((item) => item.path));
    git(root, 'commit', '-qm', 'reviewed historical media');
    const base = git(root, 'rev-parse', 'HEAD');

    await writeFile(join(root, 'docs/reference/transient-copy.png'), gitBlobFromWorkspace(historical[0].oid));
    await writeFile(join(root, 'docs/screenshots/transient-copy.webm'), gitBlobFromWorkspace(historical[1].oid));
    git(root, 'add', '--', 'docs/reference/transient-copy.png', 'docs/screenshots/transient-copy.webm');
    git(root, 'commit', '-qm', 'temporarily copy historical media');
    git(root, 'rm', '-q', 'docs/reference/transient-copy.png', 'docs/screenshots/transient-copy.webm');
    git(root, 'commit', '-qm', 'remove temporary media copies');
    const head = git(root, 'rev-parse', 'HEAD');

    expect((await checkGitPolicy({ kind: 'range', base, head }, root)).violations)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'oversized-grandfathered-copy', path: 'docs/reference/transient-copy.png' }),
        expect.objectContaining({ code: 'git-video', path: 'docs/screenshots/transient-copy.webm' })
      ]));
  });

  it('permits a true rename of a grandfathered large blob but rejects its copy', async () => {
    const root = await repository();
    await commitFile(root, 'grandfathered.bin', Buffer.alloc(MAX_GIT_BLOB_BYTES + 1, 3), 'historic large blob');
    const base = git(root, 'rev-parse', 'HEAD');
    git(root, 'mv', 'grandfathered.bin', 'renamed-grandfathered.bin');
    git(root, 'commit', '-qm', 'rename historic blob');
    const renamed = git(root, 'rev-parse', 'HEAD');
    expect((await checkGitPolicy({ kind: 'range', base, head: renamed }, root)).violations).toEqual([]);

    await writeFile(join(root, 'copied-grandfathered.bin'), Buffer.alloc(MAX_GIT_BLOB_BYTES + 1, 3));
    git(root, 'add', 'copied-grandfathered.bin');
    git(root, 'commit', '-qm', 'copy historic blob');
    const copied = git(root, 'rev-parse', 'HEAD');
    expect((await checkGitPolicy({ kind: 'range', base: renamed, head: copied }, root)).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        code: 'oversized-grandfathered-copy', path: 'copied-grandfathered.bin'
      })]));
  });

  it('rejects replacing a grandfathered path with another grandfathered oversized blob', async () => {
    const root = await repository();
    await commitFile(root, 'original.bin', Buffer.alloc(MAX_GIT_BLOB_BYTES + 1, 3), 'historic original');
    await commitFile(root, 'other.bin', Buffer.alloc(MAX_GIT_BLOB_BYTES + 1, 4), 'historic alternative');
    const base = git(root, 'rev-parse', 'HEAD');

    await writeFile(join(root, 'original.bin'), Buffer.alloc(MAX_GIT_BLOB_BYTES + 1, 4));
    git(root, 'add', 'original.bin');
    git(root, 'commit', '-qm', 'replace original with old large content');
    const head = git(root, 'rev-parse', 'HEAD');

    expect((await checkGitPolicy({ kind: 'range', base, head }, root)).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        code: 'oversized-grandfathered-copy', path: 'original.bin'
      })]));
  });

  it('rejects Git LFS pointers and configuration', async () => {
    const root = await repository();
    const base = git(root, 'rev-parse', 'HEAD');
    await commitFile(root, 'asset.bin', 'version https://git-lfs.github.com/spec/v1\noid sha256:123\nsize 1\n');
    await commitFile(root, '.lfsconfig', '[filter "lfs"]\n\tclean = lfs clean -- %f\n');
    const head = git(root, 'rev-parse', 'HEAD');
    const codes = (await checkGitPolicy({ kind: 'range', base, head }, root)).violations.map((item) => item.code);
    expect(codes).toContain('git-lfs-pointer');
    expect(codes).toContain('git-lfs-config');
  });

  it('rejects a final-diff copy of an old small LFS pointer or configuration blob', async () => {
    const root = await repository();
    const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:123\nsize 1\n';
    const config = '[filter "lfs"]\n\tclean = lfs clean -- %f\n';
    await commitFile(root, 'historic-pointer.bin', pointer);
    await commitFile(root, '.lfsconfig', config);
    const base = git(root, 'rev-parse', 'HEAD');

    await writeFile(join(root, 'copied-pointer.bin'), pointer);
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested', '.lfsconfig'), config);
    git(root, 'add', 'copied-pointer.bin', 'nested/.lfsconfig');
    git(root, 'commit', '-qm', 'copy old LFS controls');
    const head = git(root, 'rev-parse', 'HEAD');

    const violations = (await checkGitPolicy({ kind: 'range', base, head }, root)).violations;
    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'git-lfs-pointer', path: 'copied-pointer.bin' }),
      expect.objectContaining({ code: 'git-lfs-config', path: 'nested/.lfsconfig' })
    ]));
  });

  it('reports actionable metadata for every violation', async () => {
    const root = await repository();
    const base = git(root, 'rev-parse', 'HEAD');
    const head = await commitFile(root, 'review.webm', Buffer.from('small candidate clip'));
    const [violation] = (await checkGitPolicy({ kind: 'range', base, head }, root)).violations;

    expect(violation).toMatchObject({
      code: 'git-video', path: 'review.webm', size: expect.any(Number),
      oid: expect.stringMatching(/^[0-9a-f]{40}$/), limit: 'New video files are prohibited in Git',
      targetStorageClass: 'Supabase Storage review-evidence'
    });
  });

  it('classifies oversized screenshot and runtime paths into their distinct approved workflows', async () => {
    const root = await repository();
    const base = git(root, 'rev-parse', 'HEAD');
    await commitFile(root, 'docs/screenshots/candidate.png', Buffer.alloc(MAX_GIT_BLOB_BYTES + 1, 1));
    const screenshotsHead = git(root, 'rev-parse', 'HEAD');
    const screenshot = (await checkGitPolicy({ kind: 'range', base, head: screenshotsHead }, root)).violations
      .find((item) => item.path === 'docs/screenshots/candidate.png')!;
    expect(screenshot.targetStorageClass).toBe('Ignored artifacts/media-captures; optimize before curated Git');

    const runtimeHead = await commitFile(root, 'static/assets/candidate.png', Buffer.alloc(MAX_GIT_BLOB_BYTES + 1, 2));
    const runtime = (await checkGitPolicy({ kind: 'range', base: screenshotsHead, head: runtimeHead }, root)).violations
      .find((item) => item.path === 'static/assets/candidate.png')!;
    expect(runtime.targetStorageClass).toBe('Optimized static/assets runtime derivative (must meet per-asset and total runtime budgets)');
  });

  it('enforces curated still-set count and aggregate budgets from the final range tree and staged index', async () => {
    const root = await repository();
    const base = git(root, 'rev-parse', 'HEAD');
    const set = 'docs/screenshots/curated/0123456789abcdef0123456789abcdef01234567/scene-review';
    await mkdir(join(root, set), { recursive: true });
    for (let index = 0; index < 13; index++) {
      await writeFile(join(root, set, `still-${index.toString().padStart(2, '0')}.webp`), Buffer.alloc(400_000, 4));
    }
    git(root, 'add', '--', set);
    git(root, 'commit', '-qm', 'bypass curated evidence promotion');
    const head = git(root, 'rev-parse', 'HEAD');

    const rangeViolations = (await checkGitPolicy({ kind: 'range', base, head }, root)).violations;
    expect(rangeViolations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'curated-set-count', aggregate: expect.objectContaining({ files: 13, bytes: 5_200_000 }) }),
      expect.objectContaining({ code: 'curated-set-bytes', aggregate: expect.objectContaining({ files: 13, bytes: 5_200_000 }) })
    ]));

    await writeFile(join(root, set, 'not-a-still.gif'), Buffer.from('not an approved curated still'));
    git(root, 'add', '--', join(set, 'not-a-still.gif'));
    expect((await checkGitPolicy({ kind: 'staged' }, root)).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        code: 'curated-still-extension', path: `${set}/not-a-still.gif`
      })]));
  });

  it.each(mediaPolicy.git.forbiddenVideoExtensions)('rejects newly committed %s video even below the blob-size limit', async (extension) => {
    const root = await repository();
    const base = git(root, 'rev-parse', 'HEAD');
    const head = await commitFile(root, `review${extension.toUpperCase()}`, Buffer.from('small candidate clip'));

    expect((await checkGitPolicy({ kind: 'range', base, head }, root)).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'git-video', path: `review${extension.toUpperCase()}` })]));
  });

  it('checks the staged index and rejects a staged oversized blob', async () => {
    const root = await repository();
    await writeFile(join(root, 'staged-large.bin'), Buffer.alloc(MAX_GIT_BLOB_BYTES + 1, 5));
    git(root, 'add', 'staged-large.bin');
    expect((await checkGitPolicy({ kind: 'staged' }, root)).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'oversized-blob', path: 'staged-large.bin' })]));
  });
});
