import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

type ExpectedAsset = {
  path: string;
  width: number;
  height: number;
  alpha: boolean;
  sha256: string;
  maxBytes: number;
};

type SceneLayer = {
  id: string;
  path: string;
  maskPath?: string;
  z: number;
  bounds: { x: number; y: number; width: number; height: number };
  anchor?: { x: number; y: number };
  worldAnchor?: { x: number; y: number };
};

type SceneContract = {
  version: string;
  designSize: { width: number; height: number };
  responsiveCrops: Record<string, { x: number; y: number; width: number; height: number }>;
  garden: {
    referenceOnly: boolean;
    environmentBounds: { x: number; y: number; width: number; height: number };
    interactiveBoardBounds: { x: number; y: number; width: number; height: number };
    selectionSafeBounds: { x: number; y: number; width: number; height: number };
    selectedPlotAnchor: { x: number; y: number };
    apiaryAnchor: { x: number; y: number };
  };
  brewery: { layers: SceneLayer[] };
  bakery: { layers: SceneLayer[] };
};

const references: ExpectedAsset[] = [
  {
    path: 'docs/reference/CozyTavernConceptArt2.png',
    width: 1672,
    height: 941,
    alpha: false,
    sha256: '06925a9fb1eb1603a3f237c54419701f62c11882f181a1d66a9ae5acc8816b8b',
    maxBytes: 4_000_000
  },
  {
    path: 'docs/reference/CozyTavernConceptArt3.png',
    width: 1672,
    height: 941,
    alpha: false,
    sha256: '9ae79901a389c228751c828649561f3e982aeda78019e60cbfe4211adce6c2ee',
    maxBytes: 4_000_000
  },
  {
    path: 'docs/reference/CozyTavernConceptArt4.png',
    width: 1672,
    height: 941,
    alpha: false,
    sha256: '67f9219290374363de2dd156ff1f83556bb94c2906e2e74546068ddacfb239c0',
    maxBytes: 4_000_000
  }
];

const runtimeAssets: ExpectedAsset[] = [
  { path: 'static/assets/scenes/brewery-environment.webp', width: 1672, height: 941, alpha: false, sha256: '206e9ccab60d0c774b8cf940aaa464da9d62ab2e5fd05f520b69c69bf325c504', maxBytes: 350_000 },
  { path: 'static/assets/scenes/brewery/brewery-cauldron-foreground-rim.webp', width: 875, height: 355, alpha: true, sha256: '9bf51e4caa5a4f899f00835c97b8c2b8fd6e163431d79776f88f58d0ad7a5e07', maxBytes: 150_000 },
  { path: 'static/assets/scenes/brewery/brewery-fire.webp', width: 780, height: 325, alpha: true, sha256: 'ab163702a2b29deadd255e4dc8bc6d2c2d8a6a6d7adfc3055641a3221e29c6f1', maxBytes: 100_000 },
  { path: 'static/assets/scenes/brewery/brewery-paddle.webp', width: 184, height: 570, alpha: true, sha256: '2b8f64b9a10a46d8f55a41a782eec830e1c8b9cb493a60fd3a76eced1350d3e9', maxBytes: 40_000 },
  { path: 'static/assets/scenes/brewery/brewery-paddle-immersion-shadow.webp', width: 260, height: 100, alpha: true, sha256: '7ba33644cf767c6ad83790aa6546e7aecf1ec885dfee9e88e814afd6b9e2d190', maxBytes: 10_000 },
  { path: 'static/assets/scenes/brewery/brewery-steam.webp', width: 680, height: 453, alpha: true, sha256: 'e1790cb06a023076c0eda879f5f79e6b6414206e06206aea4142cb955de8dce5', maxBytes: 120_000 },
  { path: 'static/assets/scenes/brewery/brewery-wort-mask.webp', width: 782, height: 235, alpha: true, sha256: '5a1b69fa4636cb6300c3b8e484ff43e7c2cc6118355c83b29395c2a2ccc39859', maxBytes: 20_000 },
  { path: 'static/assets/scenes/brewery/brewery-wort-surface.webp', width: 782, height: 235, alpha: true, sha256: '9d9c35c65eadfe109269c0f441e1a6e289e854b5e7d0e78091c9774b2e9c9e88', maxBytes: 100_000 },
  { path: 'static/assets/scenes/bakery-environment.webp', width: 1672, height: 941, alpha: false, sha256: '8669352fbb4edb26a4e5ca92248ea17ddbc00d467ae65239ff64165aae36e5eb', maxBytes: 350_000 },
  { path: 'static/assets/scenes/bakery/bakery-dough-fold-active.webp', width: 480, height: 250, alpha: true, sha256: '489892411f081ce0fee0ec4c83abdcc5fc8d8d1f6df62dcc9840fb34d56b8ffa', maxBytes: 60_000 },
  { path: 'static/assets/scenes/bakery/bakery-dough-fold-confirmed.webp', width: 480, height: 250, alpha: true, sha256: 'fa47d37e2d169b0884dc8ea59abfad5cede645d1b5d953af847414d79489d4b7', maxBytes: 60_000 },
  { path: 'static/assets/scenes/bakery/bakery-dough-rest.webp', width: 480, height: 250, alpha: true, sha256: 'c6b220acf8dbe29857a9bdb1498c4602ce9c70a9697eb15aa0352f42df76d2b4', maxBytes: 60_000 },
  { path: 'static/assets/scenes/bakery/bakery-dough-shadow.webp', width: 480, height: 250, alpha: true, sha256: 'fe11db96ac086f5cafc5c0df839624867754510210afdc62cdd992f714af3ac1', maxBytes: 20_000 },
  { path: 'static/assets/scenes/bakery/bakery-preparation-surface.webp', width: 1672, height: 391, alpha: true, sha256: 'd40a540982cb46c8579ff95c5cbe67939cb692d949ebcfcf0628cc4d89584bd5', maxBytes: 200_000 },
  { path: 'static/assets/scenes/bakery/bakery-score-groove-01.webp', width: 480, height: 250, alpha: true, sha256: '492f88db7932099d4ea7d7e0af120524aaae79a62a54f0e9b062e524c8e35805', maxBytes: 20_000 },
  { path: 'static/assets/scenes/bakery/bakery-scoring-tool.webp', width: 310, height: 70, alpha: true, sha256: '36a9ac292097b988424d2271d59e02349d213b3732a60b2f88fcaf07cbcce96d', maxBytes: 30_000 }
];

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function pngMetadata(buffer: Buffer) {
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error('not a PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), alpha: false };
}

function readUInt24LE(buffer: Buffer, offset: number) {
  return buffer[offset] | buffer[offset + 1] << 8 | buffer[offset + 2] << 16;
}

function webpMetadata(buffer: Buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('not a WebP');
  }

  let offset = 12;
  let width = 0;
  let height = 0;
  let alpha = false;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (type === 'VP8X') {
      alpha ||= Boolean(buffer[data] & 0x10);
      width = readUInt24LE(buffer, data + 4) + 1;
      height = readUInt24LE(buffer, data + 7) + 1;
    } else if (type === 'ALPH') {
      alpha = true;
    } else if (type === 'VP8 ' && !width) {
      width = buffer.readUInt16LE(data + 6) & 0x3fff;
      height = buffer.readUInt16LE(data + 8) & 0x3fff;
    } else if (type === 'VP8L' && !width) {
      const bits = buffer.readUInt32LE(data + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    }
    offset = data + length + (length % 2);
  }
  if (!width || !height) throw new Error('WebP dimensions are missing');
  return { width, height, alpha };
}

async function assertAsset(expected: ExpectedAsset) {
  const buffer = await readFile(expected.path);
  const metadata = extname(expected.path) === '.png' ? pngMetadata(buffer) : webpMetadata(buffer);
  const errors = [
    metadata.width === expected.width && metadata.height === expected.height ? null : `expected ${expected.width}x${expected.height}, found ${metadata.width}x${metadata.height}`,
    metadata.alpha === expected.alpha ? null : `expected alpha=${expected.alpha}, found alpha=${metadata.alpha}`,
    sha256(buffer) === expected.sha256 ? null : 'checksum differs from the reviewed derivative',
    buffer.length <= expected.maxBytes ? null : `size ${buffer.length} exceeds ${expected.maxBytes}`
  ].filter(Boolean);
  if (errors.length) throw new Error(`${expected.path}: ${errors.join('; ')}`);
  console.log(`ok ${expected.path} ${metadata.width}x${metadata.height} ${buffer.length} bytes`);
}

async function findRuntimePngs(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findRuntimePngs(path);
    return entry.isFile() && extname(entry.name).toLowerCase() === '.png' ? [path] : [];
  }));
  return nested.flat();
}

async function assertContract() {
  const path = 'static/assets/scenes/motion-proof-contract.json';
  const contract = JSON.parse(await readFile(path, 'utf8')) as SceneContract;
  if (contract.version !== 'motion-proof-v1') throw new Error(`${path}: unexpected version ${contract.version}`);
  if (contract.designSize.width !== 1672 || contract.designSize.height !== 941) {
    throw new Error(`${path}: design size must remain 1672x941`);
  }

  for (const [name, crop] of Object.entries(contract.responsiveCrops)) {
    if (crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 ||
      crop.x + crop.width > contract.designSize.width || crop.y + crop.height > contract.designSize.height) {
      throw new Error(`${path}: ${name} crop leaves the design canvas`);
    }
  }
  if (!contract.garden.referenceOnly) throw new Error(`${path}: issue #7 must not claim production Garden art`);
  for (const [name, bounds] of Object.entries({
    environment: contract.garden.environmentBounds,
    interactiveBoard: contract.garden.interactiveBoardBounds,
    selectionSafe: contract.garden.selectionSafeBounds
  })) {
    if (bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0 ||
      bounds.x + bounds.width > contract.designSize.width || bounds.y + bounds.height > contract.designSize.height) {
      throw new Error(`${path}: Garden ${name} bounds leave the design canvas`);
    }
  }

  const expectedByRuntimePath = new Map(runtimeAssets.map((asset) => [
    `/${asset.path.replace(/^static\//, '')}`,
    asset
  ]));
  const referenced = new Set<string>();
  for (const [area, layers] of [['brewery', contract.brewery.layers], ['bakery', contract.bakery.layers]] as const) {
    let previousZ = -Infinity;
    for (const layer of layers) {
      if (layer.z < previousZ) throw new Error(`${path}: ${area} layers are not in z-order at ${layer.id}`);
      previousZ = layer.z;
      const expected = expectedByRuntimePath.get(layer.path);
      if (!expected) throw new Error(`${path}: ${layer.id} references an unreviewed asset ${layer.path}`);
      referenced.add(layer.path);
      if (layer.bounds.width !== expected.width || layer.bounds.height !== expected.height) {
        throw new Error(`${path}: ${layer.id} bounds differ from ${expected.width}x${expected.height}`);
      }
      if (layer.anchor && (layer.anchor.x < 0 || layer.anchor.y < 0 || layer.anchor.x > expected.width || layer.anchor.y > expected.height)) {
        throw new Error(`${path}: ${layer.id} anchor leaves its asset bounds`);
      }
      if (expected.alpha && (!layer.anchor || !layer.worldAnchor)) {
        throw new Error(`${path}: alpha layer ${layer.id} must declare local and world anchors`);
      }
      if (layer.anchor && layer.worldAnchor &&
        (layer.bounds.x + layer.anchor.x !== layer.worldAnchor.x || layer.bounds.y + layer.anchor.y !== layer.worldAnchor.y)) {
        throw new Error(`${path}: ${layer.id} world anchor does not match its bounds and local anchor`);
      }
      if (layer.maskPath) {
        const mask = expectedByRuntimePath.get(layer.maskPath);
        if (!mask) throw new Error(`${path}: ${layer.id} references an unreviewed mask ${layer.maskPath}`);
        if (mask.width !== expected.width || mask.height !== expected.height) {
          throw new Error(`${path}: ${layer.id} mask dimensions do not match`);
        }
        referenced.add(layer.maskPath);
      }
    }
  }

  const omitted = [...expectedByRuntimePath.keys()].filter((assetPath) => !referenced.has(assetPath));
  if (omitted.length) throw new Error(`${path}: reviewed assets missing from contract: ${omitted.join(', ')}`);
  console.log(`ok ${path} ${referenced.size} referenced assets`);
}

await Promise.all([...references, ...runtimeAssets].map(assertAsset));
const runtimePngs = await findRuntimePngs('static/assets');
if (runtimePngs.length) throw new Error(`source PNG masters must stay outside the runtime bundle: ${runtimePngs.join(', ')}`);
await stat('static/assets/scenes/motion-proof-contract.json');
await assertContract();
console.log(`validated ${references.length} references and ${runtimeAssets.length} optimized runtime assets`);
