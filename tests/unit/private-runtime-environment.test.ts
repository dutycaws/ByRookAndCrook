import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { privateRuntimeEnvironment } from '$lib/server/private-runtime-environment';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('private runtime environment', () => {
  it('keeps disposable verification endpoints and credentials together', () => {
    const root = mkdtempSync(join(tmpdir(), 'brac-private-env-'));
    roots.push(root);
    writeFileSync(join(root, '.env'), 'SUPABASE_SERVICE_ROLE_KEY=persistent-app-key\n');
    const isolated = {
      LOCAL_TEST_SUPABASE_WORKDIR: '/tmp/brac-fixture-stack',
      PUBLIC_SUPABASE_URL: 'http://127.0.0.1:59321',
      SUPABASE_SERVICE_ROLE_KEY: 'isolated-key'
    };
    expect(privateRuntimeEnvironment(isolated, root)).toEqual(isolated);
  });
  it('lets the authoritative local file replace stale empty process values', () => {
    const root = mkdtempSync(join(tmpdir(), 'brac-private-env-'));
    roots.push(root);
    writeFileSync(join(root, '.env'), 'NPC_IMAGE_API_KEY=updated-key\nOPENAI_API_KEY=dialogue-key\n');

    expect(privateRuntimeEnvironment({ NPC_IMAGE_API_KEY: '', OPENAI_API_KEY: '' }, root)).toMatchObject({
      NPC_IMAGE_API_KEY: 'updated-key',
      OPENAI_API_KEY: 'dialogue-key'
    });
  });

  it('retains the process environment when the local file is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'brac-private-env-'));
    roots.push(root);
    expect(privateRuntimeEnvironment({ NPC_IMAGE_API_KEY: 'process-key' }, root)).toEqual({
      NPC_IMAGE_API_KEY: 'process-key'
    });
  });
});
