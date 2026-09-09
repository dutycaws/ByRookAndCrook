import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ManagedProcess, acquireProjectLock } from '../../scripts/dev-process';

const cwd = process.cwd();
const node = process.execPath;

function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Timed out after ${milliseconds}ms`)), milliseconds);
		promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
	});
}

describe('ManagedProcess', () => {
	it('captures bounded output without attempting unsafe per-chunk redaction', async () => {
		const seen: string[] = [];
		const child = new ManagedProcess(node, ['-e', "console.log(process.env.PRIVATE_TOKEN); console.error('problem')"], {
			cwd, env: { ...process.env, PRIVATE_TOKEN: 'not-for-logs' }, maxOutput: 8,
			onOutput: (_stream, text) => seen.push(text)
		});
		const result = await child.result;
		expect(result.code).toBe(0);
		expect(result.stdout).toMatch(/logs\n$/);
		expect(result.stdout.length).toBeLessThanOrEqual(8);
		expect(result.stderr).toContain('problem');
		expect(seen.join('')).toContain('not-for-logs');
	});

	it('stops the detached group and escalates when SIGTERM is ignored', async () => {
		let signalReady!: () => void;
		const ready = new Promise<void>((resolve) => { signalReady = resolve; });
		const child = new ManagedProcess(node, ['-e', "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"], {
			cwd, env: process.env,
			onOutput: (_stream, output) => { if (output.includes('ready')) signalReady(); }
		});
		try {
			await within(ready, 5_000);
			await child.stop(20);
			const result = await child.result;
			expect(result.signal).toBe('SIGKILL');
		} finally {
			await child.stop(20).catch(() => undefined);
		}
	});

	it('reports wrapper exit even when a descendant retains the output pipe', async () => {
		const child = new ManagedProcess(node, ['-e', "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); process.exit(0)"], { cwd, env: process.env });
		const result = await within(child.result, 5_000);
		expect(result.code).toBe(0);
		await child.stop(20);
	});

	it('keeps final stream output available through the result after reaping', async () => {
		const child = new ManagedProcess(node, ['-e', "process.stdout.write('x'.repeat(200000))"], { cwd, env: process.env, maxOutput: 250000 });
		const result = await child.result;
		await child.stop(20);
		expect(result.stdout).toHaveLength(200000);
	});
});

describe('acquireProjectLock', () => {
	it('rejects a second and concurrent owner without deleting its stable lock file', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'brac-dev-lock-'));
		try {
			const first = await acquireProjectLock('test-project', { dir });
			const attempts = await Promise.allSettled([acquireProjectLock('test-project', { dir }), acquireProjectLock('test-project', { dir })]);
			expect(attempts.every((attempt) => attempt.status === 'rejected')).toBe(true);
			await first.release();
			await expect(access(join(dir, 'test-project.brac-app-dev.lock'))).resolves.toBeUndefined();
			const second = await acquireProjectLock('test-project', { dir });
			await second.release();
		} finally { await rm(dir, { recursive: true, force: true }); }
	});

	it('releases the keeper lock after its launcher dies abruptly', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'brac-dev-lock-'));
		try {
			const moduleUrl = new URL('../../scripts/dev-process.ts', import.meta.url).href;
			const launcher = new ManagedProcess(node, ['--import', 'tsx', '--input-type=module', '-e',
				`import { acquireProjectLock } from ${JSON.stringify(moduleUrl)}; await acquireProjectLock('test-project', { dir: ${JSON.stringify(dir)} }); process.kill(process.pid, 'SIGKILL');`
			], { cwd, env: process.env });
			await launcher.result;
			let lock: Awaited<ReturnType<typeof acquireProjectLock>> | undefined;
			for (let attempt = 0; attempt < 20 && !lock; attempt++) {
				try { lock = await acquireProjectLock('test-project', { dir }); }
				catch { await new Promise((resolve) => setTimeout(resolve, 25)); }
			}
			expect(lock).toBeDefined();
			await lock?.release();
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
});
