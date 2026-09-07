import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

const environment = [
  `PUBLIC_SUPABASE_URL=${apiUrl.toString().replace(/\/$/, '')}`,
  `PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY}`,
  '',
  'LOCAL_PILOT_ONE_EMAIL=keeper.one@example.test',
  'LOCAL_PILOT_ONE_PASSWORD=RookAndCrook-local-1!',
  'LOCAL_PILOT_TWO_EMAIL=keeper.two@example.test',
  'LOCAL_PILOT_TWO_PASSWORD=RookAndCrook-local-2!',
  ''
].join('\n');

writeFileSync(fileURLToPath(new URL('../.env', import.meta.url)), environment, { mode: 0o600 });
console.info(`Wrote .env for ${apiUrl.origin}.`);
