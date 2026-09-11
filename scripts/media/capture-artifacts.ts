import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

export const captureRoot = resolve('artifacts/media-captures');

export type CaptureOutput = {
  path: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number | null;
};

export type CaptureManifest = {
  schemaVersion: 1;
  kind: string;
  command: string;
  serverMode: string;
  capturedAt: string;
  git: { commit: string; clean: boolean };
  appUrl: string;
  browser: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  outputs: CaptureOutput[];
  runtimeAssets: Array<{ path: string; sha256: string }>;
  metadata?: Record<string, unknown>;
};

function git(args: string[]) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export function createCaptureDirectory(kind: string) {
  if (!/^[a-z0-9-]+$/.test(kind)) throw new Error(`Unsafe capture kind: ${kind}`);
  const configured = process.env.MEDIA_CAPTURE_OUTPUT_DIR;
  if (configured) {
    const absolute = resolve(configured);
    if (!absolute.startsWith(`${captureRoot}${sep}`)) throw new Error('MEDIA_CAPTURE_OUTPUT_DIR must be inside artifacts/media-captures.');
    return absolute;
  }
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  const shortSha = git(['rev-parse', '--short=12', 'HEAD']);
  return resolve(captureRoot, kind, `${now}-${shortSha}`);
}

export function captureGitState() {
  const commit = process.env.CAPTURE_COMMIT ?? git(['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('CAPTURE_COMMIT must be a full Git SHA.');
  return { commit, clean: git(['status', '--porcelain']).length === 0 };
}

export function mimeFor(path: string, content?: Buffer) {
  const extension = path.split('.').pop()?.toLowerCase();
  const expected = ({ png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', webm: 'video/webm', json: 'application/json' })[extension ?? ''] ?? 'application/octet-stream';
  if (!content) return expected;
  if (content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return 'image/jpeg';
  if (content.toString('ascii', 0, 4) === 'RIFF' && content.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (content.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))) return 'video/webm';
  if (expected === 'application/json') {
    JSON.parse(content.toString('utf8'));
    return expected;
  }
  return 'application/octet-stream';
}

export function imageDimensions(content: Buffer, mimeType: string) {
  if (mimeType === 'image/png' && content.length >= 24 && content.toString('ascii', 12, 16) === 'IHDR') return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
  if (mimeType === 'image/jpeg') {
    if (content.length < 4 || content[0] !== 0xff || content[1] !== 0xd8) return {};
    for (let offset = 2; offset + 3 < content.length;) {
      if (content[offset] !== 0xff) return {};
      while (content[offset] === 0xff) offset += 1;
      const marker = content[offset++];
      if (marker === 0xd9 || marker === 0xda) return {};
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > content.length) return {};
      const length = content.readUInt16BE(offset);
      const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (length < 7 || offset + length > content.length) return {};
      if (sof) return { width: content.readUInt16BE(offset + 5), height: content.readUInt16BE(offset + 3) };
      offset += length;
    }
  }
  if (mimeType === 'image/webp' && content.length >= 20 && content.toString('ascii', 0, 4) === 'RIFF' && content.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = content.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && content.length >= 30) return { width: 1 + content.readUIntLE(24, 3), height: 1 + content.readUIntLE(27, 3) };
    if (chunk === 'VP8 ' && content.length >= 30 && content.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return { width: content.readUInt16LE(26) & 0x3fff, height: content.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && content.length >= 25 && content[20] === 0x2f) return { width: 1 + content[21] + ((content[22] & 0x3f) << 8), height: 1 + (content[22] >> 6) + (content[23] << 2) + ((content[24] & 0x0f) << 10) };
  }
  return {};
}

function webmDurationMs(content: Buffer) {
  const durationId = Buffer.from([0x44, 0x89]);
  const scaleId = Buffer.from([0x2a, 0xd7, 0xb1]);
  const readElement = (id: Buffer) => {
    const at = content.indexOf(id);
    if (at < 0) return undefined;
    const first = content[at + id.length];
    if (!first) return undefined;
    const width = Math.clz32(first) - 23;
    if (width < 1 || width > 8 || at + id.length + width > content.length) return undefined;
    let size = first & ((1 << (8 - width)) - 1);
    for (let index = 1; index < width; index += 1) size = size * 256 + content[at + id.length + index];
    const start = at + id.length + width;
    return content.subarray(start, start + size);
  };
  const duration = readElement(durationId);
  if (!duration || ![4, 8].includes(duration.length)) return undefined;
  const value = duration.length === 4 ? duration.readFloatBE(0) : duration.readDoubleBE(0);
  const scale = readElement(scaleId);
  const timecodeScale = scale && scale.length <= 6 ? scale.readUIntBE(0, scale.length) : 1_000_000;
  const milliseconds = value * timecodeScale / 1_000_000;
  return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.round(milliseconds) : undefined;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return entry.isFile() ? [path] : [];
  }));
  return files.flat();
}

export async function runtimeAssetHashes() {
  const root = resolve('static/assets');
  try {
    return await Promise.all((await listFiles(root)).sort().map(async (path) => ({
      path: relative(root, path).split(sep).join('/'),
      sha256: createHash('sha256').update(await readFile(path)).digest('hex')
    })));
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeCaptureManifest(
  directory: string,
  input: Omit<CaptureManifest, 'schemaVersion' | 'capturedAt' | 'git' | 'outputs' | 'runtimeAssets'> & { metadata?: Record<string, unknown> }
) {
  await mkdir(directory, { recursive: true });
  const files = (await listFiles(directory)).filter((path) => !path.endsWith('capture-manifest.json')).sort();
  const outputs = await Promise.all(files.map(async (path) => {
    const content = await readFile(path);
    const info = await stat(path);
    const mimeType = mimeFor(path, content);
    if (mimeType === 'application/octet-stream') throw new Error(`Unsupported or signature-mismatched capture output: ${path}`);
    return {
      path: relative(directory, path).split(sep).join('/'),
      sha256: createHash('sha256').update(content).digest('hex'),
      bytes: info.size,
      mimeType,
      ...imageDimensions(content, mimeType),
      ...(mimeType === 'video/webm' ? { durationMs: webmDurationMs(content) } : {})
    };
  }));
  const manifest: CaptureManifest = { schemaVersion: 1, capturedAt: new Date().toISOString(), git: captureGitState(), outputs, runtimeAssets: await runtimeAssetHashes(), ...input };
  await writeFile(resolve(directory, 'capture-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function finalizeCapture(
  directory: string,
  kind: string,
  browser: string,
  viewport: { width: number; height: number; deviceScaleFactor: number },
  command: string,
  serverMode: string,
  metadata?: Record<string, unknown>
) {
  return writeCaptureManifest(directory, { kind, command, serverMode, appUrl: process.env.APP_URL ?? 'http://127.0.0.1:3000', browser, viewport, metadata });
}
