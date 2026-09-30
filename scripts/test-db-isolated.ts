import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManagedProcess, type ManagedProcessOptions, type ProcessResult } from './dev-process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
type Child = { result: Promise<ProcessResult>; stop(graceMs?: number): Promise<void> };

export interface DatabaseTestOptions {
  root?: string;
  paths?: readonly string[];
  inheritedEnv?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  listenForSignals?: boolean;
  commandMs?: number;
  cleanupMs?: number;
  graceMs?: number;
  log?: (message: string) => void;
  spawn?: (command: string, args: readonly string[], options: ManagedProcessOptions) => Child;
}

async function unusedPort(excluded: Set<number>): Promise<number> {
  const server = createServer();
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  if (!port) throw new Error('Could not allocate a disposable database port.');
  if (excluded.has(port)) return unusedPort(excluded);
  excluded.add(port);
  return port;
}

async function isolatedConfig(source: string, projectId: string): Promise<string> {
  let section = '';
  const found = new Set<string>();
  const excluded = new Set<number>([...source.matchAll(/^\s*(?:port|shadow_port)\s*=\s*(\d+)/gm)].map((match) => Number(match[1])));
  const port = await unusedPort(excluded);
  const shadowPort = await unusedPort(excluded);
  const config = source.split('\n').map((line) => {
    const heading = line.match(/^\s*\[([^\]]+)\]/);
    if (heading) section = heading[1];
    if (section === '' && /^\s*project_id\s*=/.test(line)) {
      if (found.has('project_id')) throw new Error('Duplicate project_id in Supabase config.');
      found.add('project_id');
      return `project_id = "${projectId}"`;
    }
    if (section === 'db') {
      const match = line.match(/^\s*(port|shadow_port)\s*=/);
      if (match) {
        if (found.has(match[1])) throw new Error(`Duplicate ${match[1]} in Supabase config.`);
        found.add(match[1]);
        return `${match[1]} = ${match[1] === 'port' ? port : shadowPort}`;
      }
    }
    return line;
  }).join('\n');
  if (found.size !== 3) throw new Error('Supabase config must define project_id, db.port and db.shadow_port.');
  return config;
}

/** Each invocation owns a new Postgres-only project. The app database is never a target. */
export async function runIsolatedDatabaseTests(options: DatabaseTestOptions = {}): Promise<number> {
  const root = resolve(options.root ?? ROOT);
  const log = options.log ?? console.info;
  const spawn = options.spawn ?? ((command, args, settings) => new ManagedProcess(command, args, settings));
  const controller = new AbortController();
  const env: NodeJS.ProcessEnv = { ...(options.inheritedEnv ?? process.env), DO_NOT_TRACK: '1' };
  // SQL fixtures require no provider or hosted credentials. Do not copy the app .env.
  for (const key of Object.keys(env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key) || /^(PG|SUPABASE_)/.test(key) || key === 'DATABASE_URL') delete env[key];
  }
  let exitCode = 0;
  let signalCode = 130;
  let workdir: string | undefined;
  let projectId: string | undefined;
  let attemptedStart = false;
  let cleanupDeadline = 0;
  let cleanupRecovery = '';
  const interrupt = () => { signalCode = 130; controller.abort(); };
  const terminate = () => { signalCode = 143; controller.abort(); };
  if (options.listenForSignals !== false) {
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
  }
  options.signal?.addEventListener('abort', interrupt, { once: true });
  if (options.signal?.aborted) interrupt();

  async function execute(command: string, args: string[], cleanup = false): Promise<ProcessResult> {
    if (!cleanup) controller.signal.throwIfAborted();
    const timeoutMs = cleanup ? cleanupDeadline - Date.now() : options.commandMs ?? 600_000;
    if (timeoutMs <= 0) throw new Error('Disposable database cleanup timed out.');
    const child = spawn(command, command === 'supabase' ? [...args, '--workdir', workdir!] : args, { cwd: workdir!, env });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const interrupted = new Promise<never>((_accept, reject) => {
        timer = setTimeout(() => reject(new Error(`${command} ${args[0]} timed out.`)), timeoutMs);
        if (!cleanup) {
          abort = () => reject(new Error('Database tests interrupted.'));
          controller.signal.addEventListener('abort', abort, { once: true });
          if (controller.signal.aborted) abort();
        }
      });
      const result = await Promise.race([child.result, interrupted]);
      await child.stop(options.graceMs ?? 5_000);
      // Initialization can print connection details. Only print TAP output from
      // the isolated, fixture-only database, never status or app credentials.
      if (command === 'supabase' && args[0] === 'test') {
        if (result.stdout.trim()) log(result.stdout.trimEnd());
        if (result.stderr.trim()) log(result.stderr.trimEnd());
      }
      if (result.code !== 0) {
        if (args[0] !== 'test' && result.stderr.trim()) {
          log(result.stderr.trimEnd().replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '<REDACTED database URL>'));
        }
        throw new Error(`${command} ${args.slice(0, 2).join(' ')} failed (${result.signal ?? `exit ${result.code ?? 'unavailable executable'}`}).`);
      }
      return result;
    } finally {
      clearTimeout(timer);
      if (abort) controller.signal.removeEventListener('abort', abort);
      await child.stop(options.graceMs ?? 5_000);
    }
  }

  try {
    controller.signal.throwIfAborted();
    const testsRoot = await realpath(join(root, 'supabase/tests'));
    const paths: string[] = [];
    for (const path of options.paths ?? []) {
      if (path.startsWith('-')) throw new Error('Only local SQL test paths are accepted; connection flags are forbidden.');
      const target = await realpath(resolve(root, path));
      if (target !== testsRoot && !target.startsWith(testsRoot + sep)) throw new Error('SQL test paths must stay inside supabase/tests.');
      paths.push(relative(testsRoot, target));
    }
    const config = await readFile(join(root, 'supabase/config.toml'), 'utf8');
    workdir = await mkdtemp(join(tmpdir(), 'brac-db-test-'));
    projectId = basename(workdir);
    if (!/^brac-db-test-[a-zA-Z0-9]+$/.test(projectId)) throw new Error('Invalid disposable project identity.');
    await mkdir(join(workdir, 'supabase'));
    await writeFile(join(workdir, 'supabase/config.toml'), await isolatedConfig(config, projectId), { mode: 0o600 });
    for (const path of ['migrations', 'tests', 'seed.sql']) {
      await cp(join(root, 'supabase', path), join(workdir, 'supabase', path), { recursive: true });
    }
    controller.signal.throwIfAborted();
    log(`[test:db:isolated] Initializing ${projectId} with repository migrations and seed…`);
    attemptedStart = true;
    await execute('supabase', ['db', 'start']);
    log('[test:db:isolated] Running SQL tests against the disposable database…');
    await execute('supabase', ['test', 'db', ...(paths.length ? paths : ['']).map((path) => join(workdir!, 'supabase/tests', path))]);
  } catch (error) {
    exitCode = controller.signal.aborted ? signalCode : 1;
    log(`[test:db:isolated] ${controller.signal.aborted ? 'Interrupted.' : error instanceof Error ? error.message : 'Database test gate failed.'}`);
  } finally {
    let cleaned = !attemptedStart;
    if (attemptedStart) {
      cleanupDeadline = Date.now() + (options.cleanupMs ?? 60_000);
      cleanupRecovery = `DO_NOT_TRACK=1 supabase stop --project-id ${projectId} --no-backup --workdir ${workdir}`;
      try {
        log(`[test:db:isolated] Removing disposable project ${projectId} and its data…`);
        await execute('supabase', ['stop', '--project-id', projectId!, '--no-backup'], true);
        // The CLI can leave its edge-runtime volume behind even after a
        // Postgres-only start. Match exact owned names; never prune Docker.
        const ownedNames = new Set(['db', 'config', 'edge_runtime'].map((kind) => `supabase_${kind}_${projectId}`));
        cleanupRecovery = `docker volume rm ${[...ownedNames].join(' ')}`;
        const volumes = await execute('docker', ['volume', 'ls', '--filter',
          `name=^supabase_(db|config|edge_runtime)_${projectId}$`, '--format', '{{.Name}}'], true);
        const leftovers = volumes.stdout.split(/\r?\n/).filter((name) => ownedNames.has(name));
        if (leftovers.length) {
          cleanupRecovery = `docker volume rm ${leftovers.join(' ')}`;
          await execute('docker', ['volume', 'rm', ...leftovers], true);
        }
        cleaned = true;
      } catch {
        exitCode = 1;
        log(`[test:db:isolated] Cleanup failed. Recovery: ${cleanupRecovery}. Temporary configuration retained at ${workdir}.`);
      }
    }
    if (cleaned && workdir) {
      try { await rm(workdir, { recursive: true, force: true }); }
      catch { exitCode = 1; log(`[test:db:isolated] Could not remove temporary files at ${workdir}.`); }
    }
    if (options.listenForSignals !== false) {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
    options.signal?.removeEventListener('abort', interrupt);
  }
  return exitCode === 0 && controller.signal.aborted ? signalCode : exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runIsolatedDatabaseTests({ paths: process.argv.slice(2) });
}
