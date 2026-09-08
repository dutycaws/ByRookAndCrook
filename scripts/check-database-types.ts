import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const typeFile = fileURLToPath(new URL('../src/lib/database.types.ts', import.meta.url));

function normalize(source: string) {
  return `${source.replaceAll('\r\n', '\n').trimEnd()}\n`;
}

const generated = execFileSync(
  'supabase',
  ['gen', 'types', 'typescript', '--local', '--schema', 'public'],
  {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, DO_NOT_TRACK: '1' },
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit']
  }
);
const committed = readFileSync(typeFile, 'utf8');

if (normalize(generated) !== normalize(committed)) {
  console.error('src/lib/database.types.ts does not match the local database schema.');
  console.error('Run `npm run --silent db:types > src/lib/database.types.ts` and commit the result.');
  process.exitCode = 1;
} else {
  console.info('Generated database types match the committed file.');
}
