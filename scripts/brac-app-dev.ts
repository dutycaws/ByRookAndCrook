import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import {
  acquireProjectLock, ManagedProcess,
  type ManagedProcessOptions, type ProcessResult, type ProjectLock
} from './dev-process';

export const PROJECT_ID = 'by-rook-and-crook';
export const APP_ORIGIN = 'http://127.0.0.1:3000';
const API_ORIGIN = 'http://127.0.0.1:57321';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RECOVERY = `DO_NOT_TRACK=1 supabase stop --project-id ${PROJECT_ID}`;

export interface Child {
  result: Promise<ProcessResult>;
  stop(graceMs?: number): Promise<void>;
}

/** Injectable system boundaries let the lifecycle tests run without touching Docker. */
export interface LauncherOptions {
  root?: string;
  inheritedEnv?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  listenForSignals?: boolean;
  log?: (message: string) => void;
  spawn?: (command: string, args: readonly string[], options: ManagedProcessOptions) => Child;
  acquireLock?: () => Promise<ProjectLock>;
  checkDependencies?: (root: string) => void;
  portAvailable?: () => Promise<void>;
  probe?: (url: string, headers: Record<string, string>, signal: AbortSignal) => Promise<boolean>;
  readinessMs?: number;
  pollMs?: number;
  shutdownMs?: number;
  graceMs?: number;
}

export function loadEnvironment(root: string, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const file = join(root, '.env');
  let values: NodeJS.ProcessEnv = {};
  if (existsSync(file)) {
    try { values = parseEnv(readFileSync(file, 'utf8')); }
    catch { throw new Error('Cannot read the root .env file. Check its syntax and owner permissions.'); }
  }
  return { ...inherited, ...values, DO_NOT_TRACK: '1', SUPABASE_WORKDIR: root };
}

export function validateProvider(env: NodeJS.ProcessEnv): void {
  if ((env.NPC_PROVIDER ?? 'openai') !== 'openai') {
    throw new Error('NPC_PROVIDER must be openai; other providers are not implemented. Update the root .env.');
  }
  if (!env.OPENAI_API_KEY?.trim()) {
    throw new Error('Missing OPENAI_API_KEY. Add it to the ignored root .env before running brac-app:dev.');
  }
}

export function validateLocalStatus(status: Record<string, string>): void {
  let url: URL;
  try { url = new URL(status.API_URL); }
  catch { throw new Error('Supabase did not return a valid local API_URL.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.port !== '57321' || url.username || url.password || url.search || url.hash
    || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Refusing Supabase credentials outside this project’s local API on port 57321.');
  }
  for (const key of ['PUBLISHABLE_KEY', 'SERVICE_ROLE_KEY']) {
    if (!status[key]?.trim() || status[key] === 'undefined') {
      throw new Error(`Local Supabase did not return ${key}.`);
    }
  }
}

export function checkDependencies(root: string): void {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(major === 22 && minor >= 20 || major === 24 || major >= 26)) {
    throw new Error('Unsupported Node.js version. Use Node 22.20+, 24.x, or 26+ as specified in package.json.');
  }
  if (process.platform !== 'linux') throw new Error('brac-app:dev currently supports Linux/POSIX process supervision.');
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  if (dependencies.some((name) => !existsSync(join(root, 'node_modules', name, 'package.json')))) {
    throw new Error('Project dependencies are missing. Run npm ci with the documented toolchain first.');
  }
  const config = readFileSync(join(root, 'supabase/config.toml'), 'utf8');
  if (config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1] !== PROJECT_ID) {
    throw new Error(`Expected Supabase project_id ${PROJECT_ID} in supabase/config.toml.`);
  }
}

export function assertAppPortAvailable(): Promise<void> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(
      'Cannot bind 127.0.0.1:3000. Stop the existing app/listener before running brac-app:dev.'
    )));
    server.listen({ host: '127.0.0.1', port: 3000, exclusive: true }, () => server.close((error) => {
      if (error) reject(error); else resolvePort();
    }));
  });
}

async function httpProbe(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers, redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(3_000)])
    });
    await response.body?.cancel();
    return response.status === 200;
  } catch { return false; }
}

function secretValues(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env).filter(([key, value]) => value && /KEY|TOKEN|SECRET|PASSWORD/.test(key))
    .map(([, value]) => value!).filter((value) => value.length >= 4);
}

export function redact(text: string, secrets: Iterable<string>): string {
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= 4) text = text.split(secret).join('[REDACTED]');
  }
  return text.replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\b(?:sk-|sb_secret_)[A-Za-z0-9_-]+/g, '[REDACTED]');
}

export function containersReady(output: string): boolean {
  let containers: { Names: string; State: string; Status: string }[];
  try {
    containers = output.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    if (!containers.every((entry) => entry && typeof entry.Names === 'string'
      && typeof entry.State === 'string' && typeof entry.Status === 'string')) return false;
  } catch { return false; }
  // These are the services enabled in this repository's Supabase configuration.
  const required = ['db', 'auth', 'kong', 'rest', 'storage', 'realtime', 'studio', 'pg_meta',
    'edge_runtime', 'analytics', 'vector'];
  const names = new Set(containers.map((entry) => entry.Names));
  return required.every((service) => names.has(`supabase_${service}_${PROJECT_ID}`))
    && ['mailpit', 'inbucket'].some((service) => names.has(`supabase_${service}_${PROJECT_ID}`))
    && containers.every((entry) => entry.State === 'running' && !/unhealthy|health: starting/i.test(entry.Status));
}

export async function runDevelopment(options: LauncherOptions = {}): Promise<number> {
  const root = resolve(options.root ?? ROOT);
  const inherited = { ...(options.inheritedEnv ?? process.env) };
  const spawn = options.spawn ?? ((command, args, opts) => new ManagedProcess(command, args, opts));
  const probe = options.probe ?? httpProbe;
  const controller = new AbortController();
  const { signal } = controller;
  const secrets = new Set<string>(secretValues(inherited));
  const log = (message: string) => (options.log ?? console.info)(redact(message, secrets));
  const readinessMs = options.readinessMs ?? 60_000;
  const graceMs = options.graceMs ?? 10_000;
  let env: NodeJS.ProcessEnv = {};
  let active: Child | undefined;
  let lock: ProjectLock | undefined;
  let adopted = false;
  let cleaning = false;
  let cleanupFailed = false;
  let exitCode = 0;
  let signalCode = 130;

  function requestStop(code = 130) {
    if (signal.aborted) return;
    signalCode = code;
    controller.abort();
    log('[brac-app:dev] Stopping the local session…');
    if (!cleaning) void active?.stop(graceMs).catch(() => { cleanupFailed = true; });
  }
  const onInterrupt = () => requestStop(130);
  const onTerminate = () => requestStop(143);
  const onExternalAbort = () => requestStop();
  if (options.listenForSignals !== false) {
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
  }
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  if (options.signal?.aborted) requestStop();

  const reloadEnvironment = () => {
    env = loadEnvironment(root, inherited);
    for (const value of secretValues(env)) secrets.add(value);
    validateProvider(env);
  };

  function startChild(command: string, args: readonly string[], visible: boolean, childEnv = env): Child {
    signal.throwIfAborted();
    const buffers = { stdout: '', stderr: '' };
    const child = spawn(command, args, {
      cwd: root, env: childEnv,
      ...(visible ? { onOutput: (stream: 'stdout' | 'stderr', chunk: string) => {
        buffers[stream] += chunk;
        let newline: number;
        while ((newline = buffers[stream].indexOf('\n')) >= 0) {
          const line = buffers[stream].slice(0, newline);
          buffers[stream] = buffers[stream].slice(newline + 1);
          log(line);
        }
        // Do not emit unbounded or incomplete lines, which could split a credential.
        if (buffers[stream].length > 64 * 1024) buffers[stream] = '';
      } } : {})
    });
    active = child;
    return child;
  }

  async function execute(command: string, args: readonly string[], settings: {
    label?: string; visible?: boolean; allowFailure?: boolean; env?: NodeJS.ProcessEnv;
  } = {}): Promise<ProcessResult> {
    if (settings.label) log(`[brac-app:dev] ${settings.label}`);
    const child = startChild(command, args, settings.visible ?? false, settings.env);
    const result = await child.result;
    await child.stop(graceMs);
    active = undefined;
    signal.throwIfAborted();
    if (result.code !== 0 && !settings.allowFailure) {
      // Hidden stages include credential-bearing CLI output. Never include it in exceptions.
      throw new Error(`${settings.label ?? command} failed (${result.signal ?? `exit ${result.code ?? 'unavailable executable'}`}).`
        + (settings.visible ? `\n${redact(result.stderr, secrets)}` : ' Check the named prerequisite or command locally.'));
    }
    return result;
  }

  const supabase = (args: string[], label?: string, allowFailure = false) => execute(
    'supabase', [...args, '--workdir', root], { label, allowFailure }
  );
  // Use the npm executable that launched this command, without an extra shell.
  const npmFile = process.env.npm_execpath;
  const npm = (script: string, label: string, visible = true) => execute(
    npmFile ? process.execPath : 'npm', [...(npmFile ? [npmFile] : []), 'run', script], {
      label, visible, env: { ...env, ...(['test:unit', 'test:integration'].includes(script) ? { NODE_ENV: 'test' } : {}) }
    }
  );

  async function status(): Promise<Record<string, string> | null> {
    const result = await supabase(['status', '-o', 'env'], undefined, true);
    if (result.code !== 0) return null;
    const values = Object.fromEntries(Object.entries(parseEnv(result.stdout))
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    for (const value of secretValues(values)) secrets.add(value);
    validateLocalStatus(values);
    return values;
  }

  async function healthy(values: Record<string, string>): Promise<boolean> {
    const result = await execute('docker', ['ps', '--all', '--filter',
      `label=com.supabase.cli.project=${PROJECT_ID}`, '--format', '{{json .}}'], { allowFailure: true });
    if (result.code !== 0 || !containersReady(result.stdout)) return false;
    const headers = { apikey: values.PUBLISHABLE_KEY };
    return await probe(`${API_ORIGIN}/auth/v1/health`, headers, signal)
      && await probe(`${API_ORIGIN}/rest/v1/`, headers, signal);
  }

  try {
    signal.throwIfAborted();
    reloadEnvironment();
    (options.checkDependencies ?? checkDependencies)(root);
    log('[brac-app:dev] Checking local prerequisites…');
    await execute('supabase', ['--version'], { label: 'Checking Supabase CLI (install the documented CLI if unavailable)' });
    await execute('docker', ['info', '--format', '{{.ServerVersion}}'], { label: 'Checking Docker (start Docker if unavailable)' });
    await execute('flock', ['--version'], { label: 'Checking flock (provided by util-linux)' });
    await (options.portAvailable ?? assertAppPortAvailable)();
    signal.throwIfAborted();
    lock = await (options.acquireLock ?? (() => acquireProjectLock(PROJECT_ID)))();
    signal.throwIfAborted();
    await npm('test:unit', 'Running all unit tests…');

    let values = await status();
    const reuse = values !== null && await healthy(values);
    signal.throwIfAborted();
    // From this point cleanup must stop even a pre-existing or partially started stack.
    adopted = true;
    if (reuse) log('[brac-app:dev] Reusing Supabase; this session will stop it on exit.');
    else await supabase(['start'], 'Starting this project’s Supabase stack (first startup may download images)…');

    const stackDeadline = Date.now() + readinessMs;
    while (true) {
      values = await status();
      if (values && await healthy(values)) break;
      if (Date.now() >= stackDeadline) throw new Error('Supabase did not become healthy before the readiness timeout.');
      await delay(options.pollMs ?? 1_000, undefined, { signal });
    }

    await npm('env:local', 'Refreshing local credentials in .env…', false);
    reloadEnvironment();
    validateLocalStatus({ API_URL: env.PUBLIC_SUPABASE_URL ?? '',
      PUBLISHABLE_KEY: env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '', SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY ?? '' });
    if (env.PUBLIC_SUPABASE_PUBLISHABLE_KEY !== values.PUBLISHABLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY !== values.SERVICE_ROLE_KEY) {
      throw new Error('Generated .env credentials do not match the running local Supabase stack.');
    }
    for (const name of ['LOCAL_PILOT_ONE_EMAIL', 'LOCAL_PILOT_ONE_PASSWORD', 'LOCAL_PILOT_TWO_EMAIL',
      'LOCAL_PILOT_TWO_PASSWORD', 'LOCAL_TEST_USER_PASSWORD']) {
      if (!env[name]?.trim()) throw new Error(`Missing ${name} after refreshing .env.`);
    }
    await supabase(['migration', 'up', '--local'], 'Applying pending local migrations without resetting saves…');
    await npm('fixtures:users:local', 'Ensuring local pilot accounts exist…', false);
    await npm('test:db', 'Running database tests…');
    await npm('test:integration', 'Running RPC integration tests…');

    log('[brac-app:dev] Starting the app with hot reload…');
    const app = startChild(npmFile ? process.execPath : 'npm',
      [...(npmFile ? [npmFile] : []), 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '3000', '--strictPort'],
      true, { ...env, NODE_ENV: 'development' });
    let appExited = false;
    void app.result.then(() => { appExited = true; });
    const appDeadline = Date.now() + readinessMs;
    while (!await probe(`${APP_ORIGIN}/login`, {}, signal)) {
      signal.throwIfAborted();
      if (appExited) throw new Error('The app exited before /login became ready.');
      if (Date.now() >= appDeadline) throw new Error('The app did not serve /login before the readiness timeout.');
      await delay(options.pollMs ?? 1_000, undefined, { signal });
    }
    signal.throwIfAborted();
    if (appExited) throw new Error('The app exited before readiness could be confirmed.');
    log(`[brac-app:dev] Ready: ${APP_ORIGIN}/login\nStudio: http://127.0.0.1:57323\n`
      + 'Retrieve pilot logins with: npm run credentials:local\nCtrl+C stops the app and this Supabase stack; saves are retained.');
    const result = await app.result;
    if (!signal.aborted && result.code !== 0) throw new Error(`The app exited unexpectedly (${result.signal ?? result.code}).`);
  } catch (error) {
    if (signal.aborted) exitCode = signalCode;
    else {
      exitCode = 1;
      log(`[brac-app:dev] ${error instanceof Error ? error.message : 'Local startup failed.'}`);
    }
  } finally {
    cleaning = true;
    try { await active?.stop(graceMs); }
    catch { cleanupFailed = true; log('[brac-app:dev] Could not terminate a managed process group.'); }
    if (adopted) {
      log('[brac-app:dev] Stopping this project’s Supabase stack and retaining its data…');
      let stopper: Child | undefined;
      const timer = new AbortController();
      try {
        stopper = spawn('supabase', ['stop', '--project-id', PROJECT_ID, '--workdir', root], { cwd: root, env });
        const result = await Promise.race([
          stopper.result,
          delay(options.shutdownMs ?? 60_000, undefined, { signal: timer.signal }).then(() => null)
        ]);
        if (!result || result.code !== 0) throw new Error('Stack shutdown failed or timed out.');
      } catch {
        cleanupFailed = true;
        log(`[brac-app:dev] Supabase shutdown failed or timed out. From ${root}, run: ${RECOVERY}`);
      } finally {
        timer.abort();
        try { await stopper?.stop(0); } catch { cleanupFailed = true; }
      }
    }
    try { await lock?.release(); }
    catch { cleanupFailed = true; log('[brac-app:dev] Could not release the session lock.'); }
    if (options.listenForSignals !== false) {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    }
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
  return cleanupFailed ? 1 : signal.aborted ? signalCode : exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runDevelopment();
}
