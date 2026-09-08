import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const environmentFile = fileURLToPath(new URL('../.env', import.meta.url));
if (!existsSync(environmentFile)) throw new Error('Missing .env. Run `npm run env:local` first.');
process.loadEnvFile(environmentFile);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Run \`npm run env:local\` first.`);
  return value;
}

const DEFAULT_USERS = [
  {
    email: required('LOCAL_PILOT_ONE_EMAIL'),
    password: required('LOCAL_PILOT_ONE_PASSWORD')
  },
  {
    email: required('LOCAL_PILOT_TWO_EMAIL'),
    password: required('LOCAL_PILOT_TWO_PASSWORD')
  }
];

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

async function main() {
  const status = localStatus();
  const apiUrl = new URL(status.API_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(apiUrl.hostname) || apiUrl.port !== '57321') {
    throw new Error(`Refusing to seed non-local Supabase target: ${apiUrl.toString()}`);
  }

  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('Local Supabase service role key is unavailable.');

  const admin = createClient(apiUrl.toString(), serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;

  for (const account of DEFAULT_USERS) {
    const existing = listed.users.find((user) => user.email === account.email);
    const response = existing
      ? await admin.auth.admin.updateUserById(existing.id, {
          password: account.password,
          email_confirm: true
        })
      : await admin.auth.admin.createUser({
          email: account.email,
          password: account.password,
          email_confirm: true
        });

    if (response.error) throw response.error;
    console.info(`${existing ? 'Updated' : 'Created'} local pilot ${account.email}`);
  }
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
