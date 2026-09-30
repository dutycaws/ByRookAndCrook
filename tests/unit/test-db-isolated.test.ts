import { access, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runIsolatedDatabaseTests, type DatabaseTestOptions } from '../../scripts/test-db-isolated';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'brac-db-runner-fixture-'));
  await mkdir(join(root, 'supabase/migrations'), { recursive: true });
  await mkdir(join(root, 'supabase/tests'));
  await writeFile(join(root, 'supabase/config.toml'), 'project_id = "preserved-app"\n[db]\nport = 57322\nshadow_port = 57320\nmajor_version = 17\n');
  await writeFile(join(root, 'supabase/migrations/001.sql'), 'select 1;');
  await writeFile(join(root, 'supabase/seed.sql'), '-- seed');
  await writeFile(join(root, 'supabase/tests/probe.test.sql'), 'begin; rollback;');
  await writeFile(join(root, '.env'), 'OPENAI_API_KEY=private-key');
  return root;
}

function runner(root: string, failStage?: string, leftoverVolumes?: (project: string, args: readonly string[]) => string) {
  const calls: { command: string; args: readonly string[]; cwd: string; config: string }[] = [];
  const messages: string[] = [];
  let projectRoot = '';
  const spawn: NonNullable<DatabaseTestOptions['spawn']> = (command, args, options) => {
    const stage = args.slice(0, 2).join(' ');
    calls.push({ command, args, cwd: options.cwd, config: '' });
    projectRoot = options.cwd;
    const result = (async () => {
      calls.at(-1)!.config = await readFile(join(options.cwd, 'supabase/config.toml'), 'utf8');
      expect(await readFile(join(options.cwd, 'supabase/migrations/001.sql'), 'utf8')).toBe('select 1;');
      expect(await readFile(join(options.cwd, 'supabase/tests/probe.test.sql'), 'utf8')).toBe('begin; rollback;');
      await expect(access(join(options.cwd, '.env'))).rejects.toThrow();
      expect(options.env.DO_NOT_TRACK).toBe('1');
      expect(options.env.OPENAI_API_KEY).toBeUndefined();
      expect(options.env.DATABASE_URL).toBeUndefined();
      expect(options.env.SUPABASE_DB_URL).toBeUndefined();
      expect(options.env.PGSERVICE).toBeUndefined();
      expect(options.env.PGSERVICEFILE).toBeUndefined();
      expect(options.env.PGHOSTADDR).toBeUndefined();
      const project = calls.at(-1)!.config.match(/^project_id = "([^"]+)"/m)![1];
      return { code: stage === failStage ? 1 : 0, signal: null, stdout: stage === 'volume ls' ? leftoverVolumes?.(project, args) ?? '' : '', stderr: stage === failStage ? 'fixture failure' : '' };
    })();
    return { result, stop: async () => {} };
  };
  return { calls, messages, spawn, projectRoot: () => projectRoot, options: { root, spawn, log: (message: string) => messages.push(message), listenForSignals: false } };
}

describe('isolated database test gate', () => {
  it('uses copied migrations/tests and a unique target, then removes only that project', async () => {
    const root = await fixture();
    const gate = runner(root);
    try {
      const code = await runIsolatedDatabaseTests({ ...gate.options, paths: ['supabase/tests/probe.test.sql'], inheritedEnv: {
        OPENAI_API_KEY: 'private-key', DATABASE_URL: 'postgres://remote', SUPABASE_DB_URL: 'postgres://remote',
        PGSERVICE: 'hosted', PGSERVICEFILE: '/private/connection', PGHOSTADDR: '203.0.113.1'
      } });
      expect(code).toBe(0);
      expect(gate.calls.map(({ args }) => args.slice(0, 2).join(' '))).toEqual(['db start', 'test db', 'stop --project-id', 'volume ls']);
      const config = gate.calls[0].config;
      const project = config.match(/^project_id = "([^"]+)"/m)![1];
      expect(project).toMatch(/^brac-db-test-/);
      expect(config).not.toContain('preserved-app');
      expect(config).not.toMatch(/port = 5732[02]\b/);
      expect(gate.calls.every(({ command, args, cwd }) => cwd !== root && (command === 'docker' || args.includes(cwd)))).toBe(true);
      expect(gate.calls[1].args).toContain(join(gate.projectRoot(), 'supabase/tests/probe.test.sql'));
      expect(gate.calls[2].args).toContain(project);
      expect(gate.calls[2].args).toContain('--no-backup');
      await expect(access(gate.projectRoot())).rejects.toThrow();
      expect(await readFile(join(root, 'supabase/config.toml'), 'utf8')).toContain('preserved-app');
      expect(await readFile(join(root, '.env'), 'utf8')).toContain('private-key');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(['db start', 'test db'])('cleans up and fails closed when %s fails', async (stage) => {
    const root = await fixture();
    const gate = runner(root, stage);
    try {
      expect(await runIsolatedDatabaseTests(gate.options)).toBe(1);
      expect(gate.calls.find(({ args }) => args[0] === 'stop')!.args).toContain('--no-backup');
      await expect(access(gate.projectRoot())).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('reports cleanup failure and retains its recovery configuration', async () => {
    const root = await fixture();
    const gate = runner(root, 'stop --project-id');
    try {
      expect(await runIsolatedDatabaseTests(gate.options)).toBe(1);
      await expect(access(gate.projectRoot())).resolves.toBeUndefined();
      expect(gate.messages.join('\n')).toContain('Recovery');
      expect(gate.messages.join('\n')).toContain(gate.projectRoot());
    } finally {
      await rm(root, { recursive: true, force: true });
      if (gate.projectRoot()) await rm(gate.projectRoot(), { recursive: true, force: true });
    }
  });

  it('removes leftover volumes by exact project names while preserving other volumes', async () => {
    const root = await fixture();
    const gate = runner(root, undefined, (project) => [
      `supabase_db_${project}`, `supabase_config_${project}`, `supabase_edge_runtime_${project}`,
      'supabase_db_preserved-app', `supabase_edge_runtime_${project}-other`, `unrelated_${project}`
    ].join('\n'));
    try {
      expect(await runIsolatedDatabaseTests(gate.options)).toBe(0);
      const project = gate.calls[0].config.match(/^project_id = "([^"]+)"/m)![1];
      expect(gate.calls.at(-1)).toMatchObject({ command: 'docker', args: [
        'volume', 'rm', `supabase_db_${project}`, `supabase_config_${project}`, `supabase_edge_runtime_${project}`
      ] });
      await expect(access(gate.projectRoot())).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('fails closed on volume removal failure and retains a scoped recovery command', async () => {
    const root = await fixture();
    const gate = runner(root, 'volume rm', (project) => `supabase_edge_runtime_${project}\n`);
    try {
      expect(await runIsolatedDatabaseTests(gate.options)).toBe(1);
      await expect(access(gate.projectRoot())).resolves.toBeUndefined();
      const volume = gate.calls.at(-1)!.args[2];
      expect(gate.messages.join('\n')).toContain(`Recovery: docker volume rm ${volume}`);
    } finally {
      await rm(root, { recursive: true, force: true });
      if (gate.projectRoot()) await rm(gate.projectRoot(), { recursive: true, force: true });
    }
  });

  it('filters volume discovery before a large Docker inventory can truncate owned names', async () => {
    const root = await fixture();
    const gate = runner(root, undefined, (project, args) => {
      const owned = `supabase_edge_runtime_${project}\n`;
      // Model daemon filtering followed by ManagedProcess's bounded capture.
      const inventory = args.includes(`name=^supabase_(db|config|edge_runtime)_${project}$`)
        ? owned : owned + 'unrelated-volume\n'.repeat(5_000);
      return inventory.slice(-64 * 1024);
    });
    try {
      expect(await runIsolatedDatabaseTests(gate.options)).toBe(0);
      expect(gate.calls.at(-1)!.args.slice(0, 2)).toEqual(['volume', 'rm']);
      await expect(access(gate.projectRoot())).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(['--linked', '--db-url=postgres://remote', '../elsewhere.sql'])('rejects a target-changing argument: %s', async (path) => {
    const root = await fixture();
    const gate = runner(root);
    try {
      expect(await runIsolatedDatabaseTests({ ...gate.options, paths: [path] })).toBe(1);
      expect(gate.calls).toHaveLength(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('reaps an interrupted command and still cleans up its temporary database', async () => {
    const root = await fixture();
    const gate = runner(root);
    const controller = new AbortController();
    const spawn: NonNullable<DatabaseTestOptions['spawn']> = (command, args, options) => {
      if (args[0] !== 'db') return gate.spawn(command, args, options);
      let finish!: (result: { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }) => void;
      const result = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve) => { finish = resolve; });
      queueMicrotask(() => controller.abort());
      return { result, stop: async () => { finish({ code: null, signal: 'SIGTERM', stdout: '', stderr: '' }); } };
    };
    try {
      expect(await runIsolatedDatabaseTests({ ...gate.options, spawn, signal: controller.signal })).toBe(130);
      expect(gate.calls.find(({ args }) => args[0] === 'stop')!.args).toContain('--no-backup');
      await expect(access(gate.projectRoot())).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('times out and reaps a stuck initialization before scoped cleanup', async () => {
    const root = await fixture();
    const gate = runner(root);
    const spawn: NonNullable<DatabaseTestOptions['spawn']> = (command, args, options) => {
      if (args[0] !== 'db') return gate.spawn(command, args, options);
      return { result: new Promise(() => {}), stop: async () => {} };
    };
    try {
      expect(await runIsolatedDatabaseTests({ ...gate.options, spawn, commandMs: 10 })).toBe(1);
      expect(gate.messages.join('\n')).toContain('timed out');
      expect(gate.calls.find(({ args }) => args[0] === 'stop')!.args).toContain('--no-backup');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
