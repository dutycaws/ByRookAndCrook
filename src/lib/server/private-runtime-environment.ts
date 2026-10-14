import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * The ignored root .env is authoritative for local prototype configuration.
 * Read it on demand so a key added after Vite started replaces an empty value
 * inherited by that long-lived process.
 */
export function privateRuntimeEnvironment(
  base: Record<string, string | undefined>,
  projectRoot = process.cwd()
): Record<string, string | undefined> {
  // Disposable verification stacks supply their own credentials. Do not mix
  // their public endpoint with the persistent app's private .env credentials.
  if (base.LOCAL_TEST_SUPABASE_WORKDIR) return base;
  const file = resolve(projectRoot, '.env');
  if (!existsSync(file)) return base;
  try {
    return { ...base, ...parseEnv(readFileSync(file, 'utf8')) };
  } catch {
    // Startup validates the file. A transient read failure should retain the
    // already-loaded environment rather than taking down an active workspace.
    return base;
  }
}
