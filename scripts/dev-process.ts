import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export type ProcessResult = {
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
};

export type ManagedProcessOptions = {
	cwd: string;
	env: NodeJS.ProcessEnv;
	onOutput?: (stream: 'stdout' | 'stderr', output: string) => void;
	/** Maximum JavaScript characters retained per output stream. Defaults to 64 KiB. */
	maxOutput?: number;
};

function appendBounded(current: string, value: string, maximum: number): string {
	const combined = current + value;
	return combined.length <= maximum ? combined : combined.slice(combined.length - maximum);
}

export class ManagedProcess {
	readonly result: Promise<ProcessResult>;
	readonly pid: number | undefined;
	private readonly child: ChildProcess;
	private readonly closed: Promise<void>;
	private stopped: Promise<void> | undefined;

	constructor(command: string, args: readonly string[], options: ManagedProcessOptions) {
		const maximum = options.maxOutput ?? 64 * 1024;
		if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error('maxOutput must be a positive integer');
		let stdout = '';
		let stderr = '';
		this.child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: process.platform !== 'win32'
		});
		this.pid = this.child.pid;
		this.closed = new Promise((resolve) => this.child.once('close', () => resolve()));
		this.child.stdout?.on('data', (chunk: Buffer) => {
			const output = chunk.toString();
			stdout = appendBounded(stdout, output, maximum);
			// Chunks do not align to lines or secret boundaries. Redaction belongs to
			// the line-aware launcher, where a split credential cannot be leaked.
			options.onOutput?.('stdout', output);
		});
		this.child.stderr?.on('data', (chunk: Buffer) => {
			const output = chunk.toString();
			stderr = appendBounded(stderr, output, maximum);
			options.onOutput?.('stderr', output);
		});
		this.result = new Promise((resolve) => {
			let settled = false;
			const finish = (code: number | null, signal: NodeJS.Signals | null) => {
				if (settled) return;
				settled = true;
				// These are accessors rather than a snapshot. `exit` can precede the
				// final stream drain, and callers often stop/reap before inspecting it.
				resolve({ code, signal, get stdout() { return stdout; }, get stderr() { return stderr; } });
			};
			this.child.once('error', () => finish(null, null));
			// `close` waits for every inherited pipe to close. A crashed shell wrapper can
			// leave descendants holding those pipes, so use `exit` to report the child
			// promptly; callers can then stop the whole process group.
			this.child.once('exit', finish);
		});
	}

	stop(graceMs = 10_000): Promise<void> {
		if (this.stopped) return this.stopped;
		this.stopped = this.stopOnce(graceMs);
		return this.stopped;
	}

	private async stopOnce(graceMs: number): Promise<void> {
		if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error('graceMs must be non-negative');
		const pid = this.pid;
		if (!pid) { await this.result; return; }
		const groupExists = () => {
			try { process.kill(process.platform === 'win32' ? pid : -pid, 0); return true; }
			catch (error: unknown) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
		};
		const send = (signal: NodeJS.Signals) => {
			try { process.kill(process.platform === 'win32' ? pid : -pid, signal); } catch (error: unknown) {
				if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
			}
		};
		send('SIGTERM');
		const deadline = Date.now() + graceMs;
		while (groupExists() && Date.now() < deadline) await delay(Math.min(50, Math.max(1, deadline - Date.now())));
		if (groupExists()) {
			send('SIGKILL');
			const killDeadline = Date.now() + 5_000;
			while (groupExists() && Date.now() < killDeadline) await delay(25);
			if (groupExists()) throw new Error(`Child process group ${pid} did not stop after SIGKILL.`);
		}
		await this.result;
		await waitForPromise(this.closed, 1_000);
	}
}

function waitForPromise(promise: Promise<unknown>, milliseconds: number): Promise<boolean> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), milliseconds);
		promise.then(() => { clearTimeout(timer); resolve(true); }, () => { clearTimeout(timer); resolve(true); });
	});
}

function waitForExit(child: ChildProcess, milliseconds: number): Promise<boolean> {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
	return new Promise((resolve) => {
		const finish = (value: boolean) => { clearTimeout(timer); child.removeListener('exit', onExit); resolve(value); };
		const onExit = () => finish(true);
		const timer = setTimeout(() => finish(false), milliseconds);
		child.once('exit', onExit);
	});
}

export type ProjectLock = { release: () => Promise<void> };

const keeperProgram = "process.stdin.resume(); process.stdin.once('end', () => process.exit(0)); process.stdout.write('ready\\n');";

/**
 * A kernel advisory lock held by a tiny detached Node keeper. The keeper owns
 * its stdin pipe: when its launcher dies, EOF releases both keeper and lock.
 * The stable lock file is deliberately never unlinked; flock ownership is the
 * source of truth, which avoids stale-file and unlink races across checkouts.
 */
export async function acquireProjectLock(projectId: string, options: { dir?: string } = {}): Promise<ProjectLock> {
	if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) throw new Error('projectId may contain only letters, numbers, dots, underscores, and dashes');
	const path = join(options.dir ?? tmpdir(), `${projectId}.brac-app-dev.lock`);
	const child = spawn('flock', ['--nonblock', '--no-fork', path, process.execPath, '-e', keeperProgram], {
		cwd: options.dir ?? tmpdir(), detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'ignore']
	});
	try {
		await new Promise<void>((resolve, reject) => {
		let settled = false;
		let received = '';
		const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); child.stdout?.removeListener('data', onOutput); fn(); } };
		const onOutput = (chunk: Buffer) => {
			received += chunk.toString();
			if (received === 'ready\n') finish(resolve);
			else if (!'ready\n'.startsWith(received)) finish(() => reject(new Error('Unable to acquire the brac-app:dev lock.')));
		};
		const timer = setTimeout(() => finish(() => reject(new Error('Timed out acquiring the brac-app:dev lock.'))), 5_000);
		child.once('error', () => finish(() => reject(new Error('Unable to run flock; install util-linux flock.'))));
		child.once('exit', (code) => finish(() => reject(new Error(code === 1
			? 'Another brac-app:dev session is already running.'
			: 'Unable to acquire the brac-app:dev lock.'))));
		child.stdout?.on('data', onOutput);
		});
	} catch (error) {
		child.stdin?.end();
		if (child.pid) {
			try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); }
			catch (killError: unknown) { if ((killError as NodeJS.ErrnoException).code !== 'ESRCH') throw killError; }
		}
		await waitForExit(child, 1_000);
		throw error;
	}
	let released = false;
	return { release: async () => {
		if (released) return;
		released = true;
		child.stdin?.end();
		const ended = await waitForExit(child, 1_000);
		if (!ended && child.pid) {
			try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); }
			catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
			if (!await waitForExit(child, 5_000)) throw new Error('The brac-app:dev lock keeper did not stop after SIGKILL.');
		}
	} };
}
