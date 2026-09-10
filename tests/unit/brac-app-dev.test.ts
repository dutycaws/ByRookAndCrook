import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  containersReady, loadEnvironment, redact, runDevelopment, validateLocalStatus,
  type Child, type LauncherOptions
} from '../../scripts/brac-app-dev';
import type { ManagedProcessOptions, ProcessResult, ProjectLock } from '../../scripts/dev-process';

const api = 'http://127.0.0.1:57321';
const published = 'local-publishable-key-1234';
const service = 'local-service-role-key-1234';
const baseEnv = {
  OPENAI_API_KEY: 'sk-test-super-secret', NPC_PROVIDER: 'openai',
  LOCAL_PILOT_ONE_EMAIL: 'pilot.one@example.test', LOCAL_PILOT_ONE_PASSWORD: 'pilot-one-password',
  LOCAL_PILOT_TWO_EMAIL: 'pilot.two@example.test', LOCAL_PILOT_TWO_PASSWORD: 'pilot-two-password',
  LOCAL_TEST_USER_PASSWORD: 'test-user-password'
};
const statusOutput = `API_URL=${api}\nPUBLISHABLE_KEY=${published}\nSERVICE_ROLE_KEY=${service}\n`;
const required = ['db', 'auth', 'kong', 'rest', 'storage', 'realtime', 'studio', 'pg_meta',
  'edge_runtime', 'analytics', 'vector', 'mailpit'];
const dockerOutput = required.map((name) => JSON.stringify({
  Names: `supabase_${name}_by-rook-and-crook`, State: 'running', Status: 'Up 1 minute (healthy)'
})).join('\n');

type SpawnCall = { command: string; args: readonly string[]; options: ManagedProcessOptions; child: FakeChild };
class FakeChild implements Child {
  private settle!: (result: ProcessResult) => void;
  readonly result: Promise<ProcessResult>;
  stopped = 0;
  private done = false;
  constructor(private readonly initial?: ProcessResult) {
    this.result = new Promise((resolve) => { this.settle = resolve; });
    if (initial) queueMicrotask(() => this.finish(initial));
  }
  finish(next = this.initial ?? result()): void {
    if (this.done) return;
    this.done = true;
    this.settle(next);
  }
  emit(options: ManagedProcessOptions, stream: 'stdout' | 'stderr', chunk: string): void {
    options.onOutput?.(stream, chunk);
  }
  stop(): Promise<void> {
    this.stopped++;
    this.finish();
    return Promise.resolve();
  }
}

function result(code = 0, stdout = '', stderr = ''): ProcessResult {
  return { code, signal: null, stdout, stderr };
}

async function withRoot(test: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'brac-app-dev-'));
  writeFileSync(join(root, '.env'), Object.entries(baseEnv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  try { await test(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function harness(root: string, overrides: Partial<LauncherOptions> & { cold?: boolean } = {}) {
  const calls: SpawnCall[] = [];
  const logs: string[] = [];
  const controller = new AbortController();
  let statusCalls = 0;
  const spawn = (command: string, args: readonly string[], options: ManagedProcessOptions): Child => {
    const script = args[args.indexOf('run') + 1];
    let child: FakeChild;
    if (command === 'supabase' && args[0] === 'status') {
      statusCalls++;
      child = new FakeChild(overrides.cold && statusCalls === 1 ? result(1) : result(0, statusOutput));
    } else if (command === 'docker' && args[0] === 'ps') child = new FakeChild(result(0, dockerOutput));
    else if (script === 'env:local') {
      // The real generator refreshes only local Supabase values and keeps custom provider settings.
      writeFileSync(join(root, '.env'), [
        ...Object.entries(baseEnv).map(([k, v]) => `${k}=${v}`),
        `PUBLIC_SUPABASE_URL=${api}`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY=${published}`,
        `SUPABASE_SERVICE_ROLE_KEY=${service}`, 'CUSTOM_SETTING=kept'
      ].join('\n') + '\n');
      child = new FakeChild(result());
    } else if (script === 'dev') child = new FakeChild();
    else child = new FakeChild(result());
    calls.push({ command, args, options, child });
    return child;
  };
  let released = 0;
  const options: LauncherOptions = {
    root, inheritedEnv: { ...baseEnv, PUBLIC_SUPABASE_URL: 'http://stale.invalid', SUPABASE_SERVICE_ROLE_KEY: 'stale-secret' },
    signal: controller.signal, listenForSignals: false, spawn, log: (message) => {
      logs.push(message);
      if (message.includes('[brac-app:dev] Ready:')) queueMicrotask(() => controller.abort());
    },
    acquireLock: async () => ({ release: async () => { released++; } }), checkDependencies: () => {},
    portAvailable: async () => {}, readinessMs: 20, pollMs: 1, shutdownMs: 5, graceMs: 1,
    probe: async () => true,
    ...overrides
  };
  return { options, calls, logs, controller, get released() { return released; } };
}

const commandNames = (calls: SpawnCall[]) => calls.map(({ command, args }) =>
  command === 'supabase' ? `supabase ${args[0]}` : command === 'docker' ? `docker ${args[0]}` : `npm ${args[args.indexOf('run') + 1]}`);

describe('brac-app:dev launcher', () => {
  it('runs gates in order, cold-starts Supabase, reloads generated env, and tears down on app stop', async () => withRoot(async (root) => {
    const h = harness(root, { cold: true });
    expect(await runDevelopment(h.options)).toBe(130);
    const order = commandNames(h.calls);
    expect(order.indexOf('npm test:unit')).toBeLessThan(order.indexOf('supabase start'));
    expect(order.indexOf('supabase start')).toBeLessThan(order.indexOf('npm test:db'));
    expect(order.indexOf('npm test:db')).toBeLessThan(order.indexOf('npm test:integration'));
    expect(order.indexOf('npm test:integration')).toBeLessThan(order.indexOf('npm dev'));
    expect(order).toContain('supabase migration');
    expect(order).toContain('supabase stop');
    const app = h.calls.find((call) => commandNames([call])[0] === 'npm dev')!;
    expect(app.options.env.PUBLIC_SUPABASE_URL).toBe(api);
    expect(app.options.env.SUPABASE_SERVICE_ROLE_KEY).toBe(service);
    const migration = h.calls.find((call) => call.command === 'supabase' && call.args[0] === 'migration')!;
    expect(migration.options.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(published);
    expect(h.released).toBe(1);
  }));

  it('reuses a healthy project stack while retaining responsibility for stopping it', async () => withRoot(async (root) => {
    const h = harness(root);
    expect(await runDevelopment(h.options)).toBe(130);
    expect(commandNames(h.calls)).not.toContain('supabase start');
    expect(commandNames(h.calls)).toContain('supabase stop');
    expect(h.logs.join('\n')).toContain('Reusing Supabase');
  }));

  it('does not adopt or stop Supabase when unit tests fail', async () => withRoot(async (root) => {
    const h = harness(root);
    const original = h.options.spawn!;
    h.options.spawn = (command, args, options) => args.includes('test:unit')
      ? new FakeChild(result(1, '', 'unit failure')) : original(command, args, options);
    expect(await runDevelopment(h.options)).toBe(1);
    expect(commandNames(h.calls)).not.toContain('supabase start');
    expect(commandNames(h.calls)).not.toContain('supabase stop');
  }));

  it('cleans up an adopted stack after a later startup failure', async () => withRoot(async (root) => {
    const h = harness(root, { cold: true });
    const original = h.options.spawn!;
    h.options.spawn = (command, args, options) => args.includes('test:db')
      ? new FakeChild(result(1, '', 'database failure')) : original(command, args, options);
    expect(await runDevelopment(h.options)).toBe(1);
    expect(commandNames(h.calls)).toContain('supabase stop');
  }));

  it('returns cancellation once and cleans up when stopped during a test stage', async () => withRoot(async (root) => {
    const h = harness(root, { cold: true });
    const original = h.options.spawn!;
    let integration: FakeChild | undefined;
    h.options.spawn = (command, args, options) => {
      if (args.includes('test:integration')) {
        integration = new FakeChild();
        queueMicrotask(() => { h.controller.abort(); h.controller.abort(); });
        return integration;
      }
      return original(command, args, options);
    };
    expect(await runDevelopment(h.options)).toBe(130);
    expect(integration?.stopped).toBeGreaterThan(0);
    expect(commandNames(h.calls).filter((name) => name === 'supabase stop')).toHaveLength(1);
    expect(commandNames(h.calls)).not.toContain('npm test:integration');
  }));

  it('cancels an in-progress stack startup and still tears down the adopted project', async () => withRoot(async (root) => {
    const h = harness(root, { cold: true });
    const original = h.options.spawn!;
    let starter: FakeChild | undefined;
    h.options.spawn = (command, args, options) => {
      if (command === 'supabase' && args[0] === 'start') {
        starter = new FakeChild();
        queueMicrotask(() => h.controller.abort());
        return starter;
      }
      return original(command, args, options);
    };
    expect(await runDevelopment(h.options)).toBe(130);
    expect(starter?.stopped).toBeGreaterThan(0);
    expect(commandNames(h.calls)).toContain('supabase stop');
    expect(commandNames(h.calls)).not.toContain('supabase migration');
  }));

  it('fails before service ownership when port or lock preflight rejects', async () => withRoot(async (root) => {
    const port = harness(root, { portAvailable: async () => { throw new Error('occupied'); } });
    expect(await runDevelopment(port.options)).toBe(1);
    expect(commandNames(port.calls)).not.toContain('supabase stop');
    const locked = harness(root, { acquireLock: async () => { throw new Error('already running'); } });
    expect(await runDevelopment(locked.options)).toBe(1);
    expect(commandNames(locked.calls)).not.toContain('npm test:unit');
  }));

  it('times out unhealthy stacks and reports a redacted recovery failure', async () => withRoot(async (root) => {
    const h = harness(root, {
      cold: true, readinessMs: 2,
      probe: async () => false
    });
    const original = h.options.spawn!;
    h.options.spawn = (command, args, options) => command === 'supabase' && args[0] === 'stop'
      ? new FakeChild(result(1, '', `failed ${service}`)) : original(command, args, options);
    expect(await runDevelopment(h.options)).toBe(1);
    const joined = h.logs.join('\n');
    expect(joined).toContain('readiness timeout');
    expect(joined).toContain('supabase stop --project-id by-rook-and-crook');
    expect(joined).not.toContain(service);
  }));

  it('treats a Supabase shutdown timeout as a failed cleanup', async () => withRoot(async (root) => {
    const h = harness(root);
    const original = h.options.spawn!;
    h.options.spawn = (command, args, options) => command === 'supabase' && args[0] === 'stop'
      ? new FakeChild() : original(command, args, options);
    expect(await runDevelopment(h.options)).toBe(1);
    expect(h.logs.join('\n')).toContain('shutdown failed or timed out');
  }));

  it('refuses malformed or remote status before adopting an unrelated stack', async () => withRoot(async (root) => {
    const h = harness(root);
    const original = h.options.spawn!;
    h.options.spawn = (command, args, options) => command === 'supabase' && args[0] === 'status'
      ? new FakeChild(result(0, `API_URL=https://outside.example:57321\nPUBLISHABLE_KEY=${published}\nSERVICE_ROLE_KEY=${service}\n`))
      : original(command, args, options);
    expect(await runDevelopment(h.options)).toBe(1);
    expect(commandNames(h.calls)).not.toContain('supabase stop');
    expect(h.logs.join('\n')).toContain('Refusing Supabase credentials outside');
  }));

  it('cleans up after the dev server crashes before it becomes ready', async () => withRoot(async (root) => {
    const h = harness(root, { probe: async (url) => !url.includes('/login') });
    const original = h.options.spawn!;
    h.options.spawn = (command, args, options) => args.includes('dev')
      ? new FakeChild(result(1, '', 'crashed')) : original(command, args, options);
    expect(await runDevelopment(h.options)).toBe(1);
    expect(commandNames(h.calls)).toContain('supabase stop');
    expect(h.logs.join('\n')).toContain('app exited before /login');
  }));

  it('cleans up after the dev server exits unexpectedly after readiness', async () => withRoot(async (root) => {
    const logs: string[] = [];
    const h = harness(root, { log: (message) => logs.push(message) });
    const original = h.options.spawn!;
    h.options.spawn = (command, args, options) => {
      if (args.includes('dev')) {
        const app = new FakeChild();
        queueMicrotask(() => app.finish(result(1, '', 'runtime crash')));
        return app;
      }
      return original(command, args, options);
    };
    expect(await runDevelopment(h.options)).toBe(1);
    expect(commandNames(h.calls)).toContain('supabase stop');
    expect(logs.join('\n')).toContain('app exited unexpectedly');
  }));

  it('times out an app that never serves /login and stops its in-flight process', async () => withRoot(async (root) => {
    const h = harness(root, { readinessMs: 2, probe: async (url) => !url.includes('/login') });
    expect(await runDevelopment(h.options)).toBe(1);
    const app = h.calls.find((call) => commandNames([call])[0] === 'npm dev')!.child;
    expect(app.stopped).toBeGreaterThan(0);
    expect(h.logs.join('\n')).toContain('did not serve /login');
  }));

  it('does not log a secret split across streamed output chunks', async () => withRoot(async (root) => {
    const h = harness(root);
    const original = h.options.spawn!;
    h.options.spawn = (command, args, options) => {
      if (args.includes('test:unit')) {
        const child = new FakeChild();
        queueMicrotask(() => {
          child.emit(options, 'stdout', 'tool says sk-test-');
          child.emit(options, 'stdout', 'super-secret is invalid\n');
          child.finish(result(1));
        });
        return child;
      }
      return original(command, args, options);
    };
    expect(await runDevelopment(h.options)).toBe(1);
    expect(h.logs.join('\n')).not.toContain('sk-test-super-secret');
    expect(h.logs.join('\n')).not.toContain('sk-test-');
  }));

  it('rejects missing provider secrets without invoking external commands', async () => withRoot(async (root) => {
    const h = harness(root, { inheritedEnv: { NPC_PROVIDER: 'openai' } });
    writeFileSync(join(root, '.env'), 'NPC_PROVIDER=openai\n');
    expect(await runDevelopment(h.options)).toBe(1);
    expect(h.calls).toHaveLength(0);
    expect(h.logs.join('\n')).toContain('Missing OPENAI_API_KEY');
  }));

  it('rejects an unsupported NPC provider without invoking external commands', async () => withRoot(async (root) => {
    const h = harness(root);
    writeFileSync(join(root, '.env'), 'OPENAI_API_KEY=sk-test-super-secret\nNPC_PROVIDER=local\n');
    expect(await runDevelopment(h.options)).toBe(1);
    expect(h.calls).toHaveLength(0);
    expect(h.logs.join('\n')).toContain('NPC_PROVIDER must be openai');
  }));
});

describe('launcher boundaries', () => {
  it('accepts only complete healthy local container sets and refuses remote status URLs', () => {
    expect(containersReady(dockerOutput)).toBe(true);
    expect(containersReady(dockerOutput.replace('"running"', '"exited"'))).toBe(false);
    expect(containersReady('not docker json')).toBe(false);
    expect(() => validateLocalStatus({ API_URL: 'https://example.test:57321', PUBLISHABLE_KEY: 'x', SERVICE_ROLE_KEY: 'y' })).toThrow('local API');
  });

  it('uses root env values over inherited values and redacts credential-shaped text', async () => withRoot(async (root) => {
    writeFileSync(join(root, '.env'), 'OPENAI_API_KEY=root-secret-1234\nNPC_PROVIDER=openai\nCUSTOM=value\n');
    const env = loadEnvironment(root, { OPENAI_API_KEY: 'shell-secret-1234', INHERITED: 'yes' });
    expect(env.OPENAI_API_KEY).toBe('root-secret-1234');
    expect(env.INHERITED).toBe('yes');
    expect(redact('Bearer abc.def.ghi root-secret-1234', ['root-secret-1234'])).not.toContain('root-secret-1234');
  }));
});
