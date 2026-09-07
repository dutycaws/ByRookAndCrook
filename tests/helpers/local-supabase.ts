import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';

const environmentFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (!existsSync(environmentFile)) throw new Error('Missing .env. Run `pnpm env:local` first.');
process.loadEnvFile(environmentFile);

export interface LocalSupabase {
  url: string;
  publishableKey: string;
  serviceRoleKey: string;
}

export function getLocalSupabase(): LocalSupabase {
  const output = execFileSync('supabase', ['status', '-o', 'env'], {
    encoding: 'utf8',
    env: { ...process.env, DO_NOT_TRACK: '1' }
  });
  const values = Object.fromEntries(
    output
      .split('\n')
      .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[1], match[2]])
  );

  const url = new URL(values.API_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '57321') {
    throw new Error(`Tests require the local project on port 57321, received ${url.toString()}`);
  }

  return {
    url: url.toString(),
    publishableKey: values.PUBLISHABLE_KEY,
    serviceRoleKey: values.SERVICE_ROLE_KEY
  };
}

export async function createTestPlayer(prefix: string): Promise<{
  client: SupabaseClient<Database>;
  admin: SupabaseClient<Database>;
  userId: string;
  email: string;
  password: string;
}> {
  const local = getLocalSupabase();
  const admin = createClient<Database>(local.url, local.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = `${prefix}-${crypto.randomUUID()}@example.test`;
  const password = process.env.LOCAL_TEST_USER_PASSWORD;
  if (!password) throw new Error('Missing LOCAL_TEST_USER_PASSWORD. Run `pnpm env:local` first.');
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (createError) throw createError;

  const client = createClient<Database>(local.url, local.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
    if (cleanupError) throw new Error('Test player sign-in and cleanup failed.');
    throw new Error(`Test player sign-in failed (${signInError.status ?? 'unknown'} / ${signInError.code ?? 'unknown'}).`);
  }

  return { client, admin, userId: created.user.id, email, password };
}
