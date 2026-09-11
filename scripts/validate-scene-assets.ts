import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { mediaPolicy } from './media/policy.js';

const RUNTIME_ASSET_DIRECTORY = 'static/assets';
const RUNTIME_METADATA_FILES = new Set([
  'static/assets/scenes/motion-proof-contract.json'
]);
const MAX_RUNTIME_RASTER_BYTES = mediaPolicy.runtime.maxRasterBytes;
const MAX_RUNTIME_MEDIA_BYTES = mediaPolicy.runtime.maxTotalMediaBytes;
const RASTER_EXTENSIONS = new Set(mediaPolicy.runtime.rasterExtensions);
const VIDEO_EXTENSIONS = new Set(mediaPolicy.git.forbiddenVideoExtensions);

type ExpectedAsset = {
  path: string;
  width: number;
  height: number;
  alpha: boolean;
  sha256: string;
  maxBytes: number;
  sceneContract?: boolean;
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
    layers: SceneLayer[];
    plotAsset: { path: string; width: number; height: number; anchor: { x: number; y: number } };
    beehiveAsset: { path: string; width: number; height: number; anchor: { x: number; y: number } };
    cropStages: Record<string, string[]>;
    motion: { harvestDurationMs: number; decorativeSpriteCount: number; hiddenTab: string; reducedMotion: string };
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
  { path: 'static/assets/scenes/garden-environment.webp', width: 1672, height: 941, alpha: false, sha256: '17444dbbcde2554e94d1ecea75551c783eabd5eeac6c2b07fd4156a7ba513e2d', maxBytes: 500_000 },
  { path: 'static/assets/scenes/garden/garden-atmosphere.webp', width: 620, height: 330, alpha: true, sha256: '2a1c9d88886ae253a2321a49adcdb3148ec3b4609305f8035b0860f8c8d25a0f', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-beehive.webp', width: 360, height: 300, alpha: true, sha256: '11b5fd9011d5ea874ae2d1dea21fa47c6286478af0f910b8e98d380dc6e8c83e', maxBytes: 90_000 },
  { path: 'static/assets/scenes/garden/garden-foreground.webp', width: 960, height: 330, alpha: true, sha256: 'fe590cf6e63f965b54345502f4e48aa914916b8e38c234886d030cf453dc1a73', maxBytes: 170_000 },
  { path: 'static/assets/scenes/garden/garden-plot-base.webp', width: 230, height: 260, alpha: true, sha256: 'b76d3d0226e9fbabe6a534aac9443044c1331629fbed5ca1babf7fe89fb868b3', maxBytes: 60_000 },
  { path: 'static/assets/scenes/garden/garden-crop-chamomile-stage-1.webp', width: 240, height: 320, alpha: true, sha256: 'db57c904a15a423641078739dd72a1d6ee26398bbf5aa54e3fcbb21db6542f76', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-chamomile-stage-2.webp', width: 240, height: 320, alpha: true, sha256: '034c22c0fd19cbb2459e634a6f3fe96937a9c06d25b22a5650bfb102b00ed891', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-chamomile-stage-3.webp', width: 240, height: 320, alpha: true, sha256: '944aa8f600cfd612674dc6bc1c3c74bb920f24a52514a339c7beb023667f4e04', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-fennel-stage-1.webp', width: 240, height: 320, alpha: true, sha256: '74bed97125e2c99efff968e647ed2ce0480fee1fd399ec66bf84a9545e1f8c70', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-fennel-stage-2.webp', width: 240, height: 320, alpha: true, sha256: 'ed636c34fc388105c97da3c2f3f7a9cd8b7f32a30e57ac263d8ac06ef28891ff', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-fennel-stage-3.webp', width: 240, height: 320, alpha: true, sha256: 'ccfc18a95fedab4c59b028b2a2e631a85a80edf8d37e39fb95d40dad3997bd33', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-hops-stage-1.webp', width: 240, height: 320, alpha: true, sha256: 'b0efbbe5a0a45b46c54614d60f166381fd831be870cbee52c20dcaebf18b4ac1', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-hops-stage-2.webp', width: 240, height: 320, alpha: true, sha256: 'd9c60b462674169168be01f522a80aee143ddb95857259b115ddc18cea30a205', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-hops-stage-3.webp', width: 240, height: 320, alpha: true, sha256: 'd20308fe62e42e1e09c9ed172e6290748655c8fed8bcbac8171ee2ae95d901ed', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-lavender-stage-1.webp', width: 240, height: 320, alpha: true, sha256: '6d0a937377ea814895782196b630db47842d4cf8b8f43563357cfc68d094fe57', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-lavender-stage-2.webp', width: 240, height: 320, alpha: true, sha256: '343b75232ab7d3cc610be896dd167d29d6d271879c7a639dbbd768a1a850b332', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-lavender-stage-3.webp', width: 240, height: 320, alpha: true, sha256: '88a07810143218d17de962f16fc96d7fdbd4afd9c918cb3fa8242218c4e07207', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-pepper-stage-1.webp', width: 240, height: 320, alpha: true, sha256: '0985d4b3ede89cd57bcae1038c488a89ded7841b0bc0d94eef7574091a00c47e', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-pepper-stage-2.webp', width: 240, height: 320, alpha: true, sha256: 'de0ba90ba41d53738972c53155779c8a26664b18f551c4070f43330b5607441c', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-pepper-stage-3.webp', width: 240, height: 320, alpha: true, sha256: '0533aaa937274dbeceaf1a23b801a6207a9ed1836258ea666e834a9ac52e1a0c', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-sage-stage-1.webp', width: 240, height: 320, alpha: true, sha256: '529cb8f37dc82d592c3de78b5e0faf9bb45ef62d3d992b7f557c15a9c8521adc', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-sage-stage-2.webp', width: 240, height: 320, alpha: true, sha256: '4a18f77a2800b952589290d456ab82d26bcb73a45779294a3dda547c21b0107e', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-sage-stage-3.webp', width: 240, height: 320, alpha: true, sha256: '4d2e8c1b465b1e25b1edcdf5c2e06ae77bffd59920037ca91263f905ada27b80', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-tomatoes-stage-1.webp', width: 240, height: 320, alpha: true, sha256: '74f1ef8f821f482359b1808f435a62dc7d190bf7356a77bfc9c1b742e5d29922', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-tomatoes-stage-2.webp', width: 240, height: 320, alpha: true, sha256: '9c9479f13d8f244ddfc403e38bfc09ee649af12838583eed3a4d705b93b3cbbe', maxBytes: 80_000 },
  { path: 'static/assets/scenes/garden/garden-crop-tomatoes-stage-3.webp', width: 240, height: 320, alpha: true, sha256: 'e131f744dd4186e2e801cb172c6cb345e7c6a6010305386531184c2aa93470c3', maxBytes: 80_000 },
  { path: 'static/assets/scenes/brewery-environment.webp', width: 1672, height: 941, alpha: false, sha256: '206e9ccab60d0c774b8cf940aaa464da9d62ab2e5fd05f520b69c69bf325c504', maxBytes: 350_000 },
  { path: 'static/assets/scenes/brewery/brewery-cauldron-foreground-rim.webp', width: 875, height: 355, alpha: true, sha256: '9bf51e4caa5a4f899f00835c97b8c2b8fd6e163431d79776f88f58d0ad7a5e07', maxBytes: 150_000 },
  { path: 'static/assets/scenes/brewery/brewery-fire.webp', width: 780, height: 325, alpha: true, sha256: 'ab163702a2b29deadd255e4dc8bc6d2c2d8a6a6d7adfc3055641a3221e29c6f1', maxBytes: 100_000 },
  { path: 'static/assets/scenes/brewery/brewery-paddle.webp', width: 184, height: 570, alpha: true, sha256: '2b8f64b9a10a46d8f55a41a782eec830e1c8b9cb493a60fd3a76eced1350d3e9', maxBytes: 40_000 },
  { path: 'static/assets/scenes/brewery/brewery-paddle-immersion-shadow.webp', width: 260, height: 100, alpha: true, sha256: '7ba33644cf767c6ad83790aa6546e7aecf1ec885dfee9e88e814afd6b9e2d190', maxBytes: 10_000 },
  { path: 'static/assets/scenes/brewery/brewery-steam.webp', width: 680, height: 453, alpha: true, sha256: 'e1790cb06a023076c0eda879f5f79e6b6414206e06206aea4142cb955de8dce5', maxBytes: 120_000 },
  { path: 'static/assets/scenes/brewery/brewery-wort-mask.webp', width: 782, height: 235, alpha: true, sha256: '5a1b69fa4636cb6300c3b8e484ff43e7c2cc6118355c83b29395c2a2ccc39859', maxBytes: 20_000 },
  { path: 'static/assets/scenes/brewery/brewery-wort-surface.webp', width: 782, height: 235, alpha: true, sha256: '9d9c35c65eadfe109269c0f441e1a6e289e854b5e7d0e78091c9774b2e9c9e88', maxBytes: 100_000 },
  { path: 'static/assets/scenes/lira-tavern.webp', width: 1672, height: 941, alpha: false, sha256: '89970122af0f72144f75260fc22b1547d881a1912a8d7166afed1a355b746337', maxBytes: 500_000, sceneContract: false },
  { path: 'static/assets/scenes/torvin-tavern.webp', width: 1672, height: 941, alpha: false, sha256: 'f39423ff92118d6d02f14304135ae67259356fe114517829e423810ebd048516', maxBytes: 500_000, sceneContract: false },
  { path: 'static/assets/scenes/bakery-environment.webp', width: 1672, height: 941, alpha: false, sha256: '8669352fbb4edb26a4e5ca92248ea17ddbc00d467ae65239ff64165aae36e5eb', maxBytes: 350_000 },
  { path: 'static/assets/scenes/bakery/bakery-dough-fold-active.webp', width: 480, height: 250, alpha: true, sha256: '489892411f081ce0fee0ec4c83abdcc5fc8d8d1f6df62dcc9840fb34d56b8ffa', maxBytes: 60_000 },
  { path: 'static/assets/scenes/bakery/bakery-dough-fold-confirmed.webp', width: 480, height: 250, alpha: true, sha256: 'fa47d37e2d169b0884dc8ea59abfad5cede645d1b5d953af847414d79489d4b7', maxBytes: 60_000 },
  { path: 'static/assets/scenes/bakery/bakery-dough-rest.webp', width: 480, height: 250, alpha: true, sha256: 'c6b220acf8dbe29857a9bdb1498c4602ce9c70a9697eb15aa0352f42df76d2b4', maxBytes: 60_000 },
  { path: 'static/assets/scenes/bakery/bakery-dough-shadow.webp', width: 480, height: 250, alpha: true, sha256: 'fe11db96ac086f5cafc5c0df839624867754510210afdc62cdd992f714af3ac1', maxBytes: 20_000 },
  { path: 'static/assets/scenes/bakery/bakery-preparation-surface.webp', width: 1672, height: 391, alpha: true, sha256: 'd40a540982cb46c8579ff95c5cbe67939cb692d949ebcfcf0628cc4d89584bd5', maxBytes: 200_000 },
  { path: 'static/assets/scenes/bakery/bakery-loaf-pale.webp', width: 520, height: 415, alpha: true, sha256: '2201d447d3b74e4be6e6e256ffb17420b3f1920f682a30d2bf399c60793baea9', maxBytes: 80_000 },
  { path: 'static/assets/scenes/bakery/bakery-loaf-ideal.webp', width: 520, height: 415, alpha: true, sha256: '95314eec09b66df8ab8d909ec3b5b5effa5410549b1362f4bc3cb33c20b27460', maxBytes: 80_000 },
  { path: 'static/assets/scenes/bakery/bakery-loaf-overbaked.webp', width: 520, height: 415, alpha: true, sha256: 'd7654ac924f938af9689b155d64540eb7676eabd24061fcd1fe23d1d72736e50', maxBytes: 80_000 },
  { path: 'static/assets/scenes/bakery/bakery-oven-peel.webp', width: 920, height: 600, alpha: true, sha256: '45e9e53ef2b85b65db714a6eff5cf6204f0ee18c560813e25384b33966b488ee', maxBytes: 120_000 },
  { path: 'static/assets/scenes/bakery/bakery-oven-embers.webp', width: 660, height: 275, alpha: true, sha256: 'a725ca0ec6ef27facb581d48f12810a433469d39403dcb9b33d8e0f3d612eece', maxBytes: 80_000 },
  { path: 'static/assets/scenes/bakery/bakery-oven-steam.webp', width: 485, height: 323, alpha: true, sha256: 'ea4a35a6b66115a39aefbcc0ef344631d23c0d97b1b68f8bd9f2cad181527ca0', maxBytes: 80_000 },
  { path: 'static/assets/scenes/bakery/bakery-oven-foreground.webp', width: 900, height: 300, alpha: true, sha256: '4848240cf00e956bb3bd557d9c5f99a79ebebfb6661489d8ed731887fe8e4126', maxBytes: 70_000 },
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

type RuntimeFile = {
  path: string;
  bytes: number;
  extension: string;
};

async function inventoryRuntimeFiles(directory: string): Promise<RuntimeFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return inventoryRuntimeFiles(path);
    if (!entry.isFile()) return [];
    const info = await stat(path);
    return [{ path, bytes: info.size, extension: extname(entry.name).toLowerCase() }];
  }));
  return nested.flat();
}

function assertRuntimeInventory(files: RuntimeFile[]) {
  const expectedByPath = new Map(runtimeAssets.map((asset) => [asset.path, asset]));
  const mediaFiles = files.filter((file) => RASTER_EXTENSIONS.has(file.extension) || VIDEO_EXTENSIONS.has(file.extension));
  const unreviewed = files.filter((file) => !expectedByPath.has(file.path) && !RUNTIME_METADATA_FILES.has(file.path));
  const pngs = mediaFiles.filter((file) => file.extension === '.png');
  const videos = mediaFiles.filter((file) => VIDEO_EXTENSIONS.has(file.extension));
  const oversizedRasters = mediaFiles.filter((file) => RASTER_EXTENSIONS.has(file.extension) && file.bytes > MAX_RUNTIME_RASTER_BYTES);
  // The architectural ceiling covers the complete runtime asset tree, including
  // small contracts or future SVG/audio/font files, not only raster/video files.
  const totalRuntimeBytes = files.reduce((total, file) => total + file.bytes, 0);
  const errors = [
    unreviewed.length ? `unreviewed runtime asset files: ${unreviewed.map((file) => file.path).join(', ')}` : null,
    pngs.length ? `source PNG masters must stay outside the runtime bundle: ${pngs.map((file) => file.path).join(', ')}` : null,
    videos.length ? `runtime video must be stored as review evidence instead: ${videos.map((file) => file.path).join(', ')}` : null,
    oversizedRasters.length ? `runtime raster exceeds ${MAX_RUNTIME_RASTER_BYTES} bytes: ${oversizedRasters.map((file) => `${file.path} (${file.bytes})`).join(', ')}` : null,
    totalRuntimeBytes > MAX_RUNTIME_MEDIA_BYTES ? `runtime asset total ${totalRuntimeBytes} exceeds ${MAX_RUNTIME_MEDIA_BYTES} bytes` : null
  ].filter(Boolean);

  const largest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
  console.log(`runtime inventory: ${files.length} files; ${mediaFiles.length} raster/video media; ${totalRuntimeBytes} total runtime bytes; ${MAX_RUNTIME_MEDIA_BYTES - totalRuntimeBytes} bytes headroom`);
  console.log(`runtime inventory largest files: ${largest.map((file) => `${file.path} (${file.bytes} bytes)`).join(', ')}`);
  if (errors.length) throw new Error(errors.join('; '));
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
  if (contract.garden.referenceOnly) throw new Error(`${path}: production Garden art must not be reference-only`);
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

  const expectedByRuntimePath = new Map(runtimeAssets.filter((asset) => asset.sceneContract !== false).map((asset) => [
    `/${asset.path.replace(/^static\//, '')}`,
    asset
  ]));
  const referenced = new Set<string>();
  for (const [area, layers] of [['garden', contract.garden.layers], ['brewery', contract.brewery.layers], ['bakery', contract.bakery.layers]] as const) {
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

  for (const [name, asset] of Object.entries({ plot: contract.garden.plotAsset, beehive: contract.garden.beehiveAsset })) {
    const expected = expectedByRuntimePath.get(asset.path);
    if (!expected) throw new Error(`${path}: Garden ${name} references an unreviewed asset ${asset.path}`);
    if (expected.width !== asset.width || expected.height !== asset.height) {
      throw new Error(`${path}: Garden ${name} dimensions differ from the reviewed asset`);
    }
    if (asset.anchor.x < 0 || asset.anchor.y < 0 || asset.anchor.x > asset.width || asset.anchor.y > asset.height) {
      throw new Error(`${path}: Garden ${name} anchor leaves its asset bounds`);
    }
    referenced.add(asset.path);
  }
  const cropKeys = ['hops', 'fennel', 'pepper', 'chamomile', 'tomatoes', 'lavender', 'sage'];
  for (const cropKey of cropKeys) {
    const stages = contract.garden.cropStages[cropKey];
    if (!stages || stages.length !== 3) throw new Error(`${path}: Garden ${cropKey} must define three stages`);
    for (const stagePath of stages) {
      const expected = expectedByRuntimePath.get(stagePath);
      if (!expected || expected.width !== 240 || expected.height !== 320 || !expected.alpha) {
        throw new Error(`${path}: Garden ${cropKey} stage references an invalid asset ${stagePath}`);
      }
      referenced.add(stagePath);
    }
  }
  if (contract.garden.motion.decorativeSpriteCount > 40 || contract.garden.motion.harvestDurationMs > 1_000) {
    throw new Error(`${path}: Garden motion exceeds its bounded presentation budget`);
  }

  const omitted = [...expectedByRuntimePath.keys()].filter((assetPath) => !referenced.has(assetPath));
  if (omitted.length) throw new Error(`${path}: reviewed assets missing from contract: ${omitted.join(', ')}`);
  console.log(`ok ${path} ${referenced.size} referenced assets`);
}

await Promise.all([...references, ...runtimeAssets].map(assertAsset));
const runtimeFiles = await inventoryRuntimeFiles(RUNTIME_ASSET_DIRECTORY);
assertRuntimeInventory(runtimeFiles);
await stat('static/assets/scenes/motion-proof-contract.json');
await assertContract();
console.log(`validated ${references.length} references and ${runtimeAssets.length} optimized runtime assets`);
