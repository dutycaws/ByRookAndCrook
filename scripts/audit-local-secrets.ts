import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const candidates = ['.env', '.env.local', 'supabase/.env']
  .map((name) => ({ name, path: fileURLToPath(new URL(`../${name}`, import.meta.url)) }))
  .filter(({ path }) => existsSync(path));

if (candidates.length > 2) {
  throw new Error(`Found ${candidates.length} project-managed secret files; at most two are allowed.`);
}

for (const candidate of candidates) {
  const ignored = spawnSync('git', ['check-ignore', '--quiet', candidate.name], { cwd: projectRoot });
  if (ignored.status !== 0) throw new Error(`${candidate.name} contains runtime secrets but is not ignored by Git.`);
  if ((statSync(candidate.path).mode & 0o077) !== 0) {
    throw new Error(`${candidate.name} must not be readable or writable by group or other users.`);
  }
}

const primaryEnvironment = candidates.find(({ name }) => name === '.env');
if (primaryEnvironment) process.loadEnvFile(primaryEnvironment.path);

const secretNames = [
  'LOCAL_PILOT_ONE_PASSWORD',
  'LOCAL_PILOT_TWO_PASSWORD',
  'LOCAL_TEST_USER_PASSWORD',
  'OPENAI_API_KEY'
];

for (const name of secretNames) {
  const value = process.env[name];
  if (!value) continue;

  const trackedMatch = spawnSync('git', ['grep', '-F', '--quiet', '--', value], {
    cwd: projectRoot,
    stdio: 'ignore'
  });
  if (trackedMatch.status === 0) throw new Error(`${name} appears in a tracked file.`);
}

execFileSync('git', ['status', '--short', '--ignored', ...candidates.map(({ path }) => relative(projectRoot, path))], {
  cwd: projectRoot,
  stdio: 'ignore'
});

console.info(`Secret audit passed: ${candidates.length} project-managed secret file${candidates.length === 1 ? '' : 's'}, all ignored and permission-restricted, with no configured secret values tracked.`);
