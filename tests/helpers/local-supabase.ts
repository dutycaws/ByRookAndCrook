import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';

const environmentFile = fileURLToPath(new URL('../../.env', import.meta.url));
const isolatedProjectRequested = [
  process.env.LOCAL_TEST_SUPABASE_WORKDIR,
  process.env.LOCAL_TEST_SUPABASE_PROJECT_ID,
  process.env.LOCAL_TEST_SUPABASE_API_PORT
].some((value) => value !== undefined);

if (isolatedProjectRequested) {
  if (!process.env.LOCAL_TEST_SUPABASE_WORKDIR || !process.env.LOCAL_TEST_SUPABASE_PROJECT_ID || !process.env.LOCAL_TEST_SUPABASE_API_PORT) {
    throw new Error('Isolated Supabase tests require LOCAL_TEST_SUPABASE_WORKDIR, LOCAL_TEST_SUPABASE_PROJECT_ID, and LOCAL_TEST_SUPABASE_API_PORT together.');
  }
  if (!process.env.LOCAL_TEST_USER_PASSWORD) {
    throw new Error('Isolated Supabase tests require LOCAL_TEST_USER_PASSWORD in the process environment.');
  }
} else {
  if (!existsSync(environmentFile)) throw new Error('Missing .env. Run `npm run env:local` first.');
  process.loadEnvFile(environmentFile);
}

export interface LocalSupabase {
  url: string;
  publishableKey: string;
  serviceRoleKey: string;
}

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const defaultProjectId = 'by-rook-and-crook';

function isolatedSupabaseTarget(): { workdir: string; projectId: string; apiPort: number } | undefined {
  if (!isolatedProjectRequested) return undefined;
  const projectId = process.env.LOCAL_TEST_SUPABASE_PROJECT_ID!;
  const apiPort = Number(process.env.LOCAL_TEST_SUPABASE_API_PORT);
  const workdir = process.env.LOCAL_TEST_SUPABASE_WORKDIR!;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectId)) {
    throw new Error('LOCAL_TEST_SUPABASE_PROJECT_ID must be a lowercase local project name.');
  }
  if (!Number.isSafeInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new Error('LOCAL_TEST_SUPABASE_API_PORT must be a valid TCP port.');
  }
  const configPath = join(resolve(workdir), 'supabase', 'config.toml');
  if (!existsSync(configPath)) {
    throw new Error('LOCAL_TEST_SUPABASE_WORKDIR must contain a supabase/config.toml file.');
  }
  const configuredProjectId = readFileSync(configPath, 'utf8').match(/^\s*project_id\s*=\s*"([^"]+)"/m)?.[1];
  if (configuredProjectId !== projectId) {
    throw new Error('LOCAL_TEST_SUPABASE_PROJECT_ID must match project_id in the selected Supabase config.');
  }
  return { workdir, projectId, apiPort };
}

/** Resolve the Docker database container owned by the configured local project. */
export function getLocalTestDatabaseContainer(): string {
  const target = isolatedSupabaseTarget();
  return `supabase_db_${target?.projectId ?? defaultProjectId}`;
}

export function getLocalSupabase(): LocalSupabase {
  const target = isolatedSupabaseTarget();
  const statusArgs = ['status', '-o', 'env'];
  if (target) statusArgs.push('--workdir', target.workdir);
  else statusArgs.push('--workdir', repositoryRoot);
  const output = execFileSync('supabase', statusArgs, {
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
  const expectedPort = target?.apiPort ?? 57321;
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== String(expectedPort)) {
    throw new Error(`Tests require a localhost Supabase API on port ${expectedPort}, received ${url.toString()}`);
  }
  if ((target && values.PROJECT_ID && values.PROJECT_ID !== target.projectId) || !values.PUBLISHABLE_KEY || !values.SERVICE_ROLE_KEY) {
    throw new Error('Local Supabase status does not match the configured test project or lacks local keys.');
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
  if (!password) throw new Error('Missing LOCAL_TEST_USER_PASSWORD. Run `npm run env:local` first.');
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
