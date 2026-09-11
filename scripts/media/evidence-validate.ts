import { resolve } from 'node:path';
import { validateManifest } from './evidence-common';

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const manifestInput = argument('--manifest');
const directory = argument('--directory');
if (manifestInput && directory) throw new Error('Pass either --manifest or --directory, not both.');
const manifestPath = manifestInput ?? (directory ? resolve(directory, 'capture-manifest.json') : undefined);
if (!manifestPath) throw new Error('Usage: evidence:validate -- --manifest <capture-manifest.json> | --directory <capture-directory>');
const { manifest } = await validateManifest(resolve(manifestPath));
console.info(`Validated ${manifest.outputs.length} capture outputs for ${manifest.kind} at ${manifest.git.commit}.`);
