import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mergeEnvironment } from './environment-merge';
import { fileURLToPath } from 'node:url';

const environmentFile = fileURLToPath(new URL('../.env', import.meta.url));

if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);

function generatedPassword(name: string, rotate: boolean): string {
  if (!rotate && process.env[name]) return process.env[name];
  return randomBytes(24).toString('base64url');
}

function localStatus(): Record<string, string> {
  const output = execFileSync('supabase', ['status', '-o', 'env'], {
    encoding: 'utf8',
    env: { ...process.env, DO_NOT_TRACK: '1' }
  });

  return Object.fromEntries(
    output
      .split('\n')
      .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[1], match[2]])
  );
}

const status = localStatus();
const apiUrl = new URL(status.API_URL ?? '');
if (!['127.0.0.1', 'localhost'].includes(apiUrl.hostname) || apiUrl.port !== '57321') {
  throw new Error(`Refusing to write an environment for a non-local target: ${apiUrl.toString()}`);
}

if (!status.PUBLISHABLE_KEY) throw new Error('Local Supabase publishable key is unavailable.');

const rotate = process.argv.includes('--rotate');
const generated = [
  `PUBLIC_SUPABASE_URL=${apiUrl.toString().replace(/\/$/, '')}`,
  `PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}`,
  '',
  `LOCAL_PILOT_ONE_EMAIL=${process.env.LOCAL_PILOT_ONE_EMAIL ?? 'keeper.one@example.test'}`,
  `LOCAL_PILOT_ONE_PASSWORD=${generatedPassword('LOCAL_PILOT_ONE_PASSWORD', rotate)}`,
  `LOCAL_PILOT_TWO_EMAIL=${process.env.LOCAL_PILOT_TWO_EMAIL ?? 'keeper.two@example.test'}`,
  `LOCAL_PILOT_TWO_PASSWORD=${generatedPassword('LOCAL_PILOT_TWO_PASSWORD', rotate)}`,
  `LOCAL_TEST_USER_PASSWORD=${generatedPassword('LOCAL_TEST_USER_PASSWORD', rotate)}`,
  ''
].join('\n');
if (!status.SERVICE_ROLE_KEY) throw new Error('Local server credential is unavailable.');
const values = Object.fromEntries(generated.split('\n').filter((line) => line.includes('=')).map((line) => {
  const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
}));
const environment = mergeEnvironment(existsSync(environmentFile) ? readFileSync(environmentFile, 'utf8') : '', values);

writeFileSync(environmentFile, environment, { mode: 0o600 });
chmodSync(environmentFile, 0o600);
console.info(`Wrote ${rotate ? 'rotated ' : ''}local credentials to the ignored .env file for ${apiUrl.origin}.`);
