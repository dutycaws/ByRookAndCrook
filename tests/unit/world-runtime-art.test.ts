import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  WORLD_RUNTIME_ART_BUCKET, authorizedRuntimeArtPreview, emitRuntimeArtObservability,
  drainRuntimeArtQueue, ensurePrivateRuntimeArtBucket, persistAcceptedRuntimeArt, runRuntimeArtJob,
  runtimeArtPrompt, runtimeArtPromptHash, validateRuntimeArtPng, type RuntimeArtStorage
} from '../../src/lib/server/evolving-world-art/index.js';
import { fixturePromptRegistry, fixturePromptRelease } from '../helpers/prompt-registry-fixture';

const jobId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
const promptRegistry = fixturePromptRegistry();
async function png() { return sharp({ create: { width: 8, height: 8, channels: 4, background: 'orange' } }).png().toBuffer(); }
function storage(options: { acceptFails?: boolean } = {}) {
  const objects = new Map<string, Buffer>(); const removed: string[] = [];
  const value: RuntimeArtStorage = { from: () => ({
    async upload(key, body) { objects.set(key, Buffer.from(body)); return { error: null }; },
    async download(key) { const body = objects.get(key); return { data: body ? new Blob([Uint8Array.from(body)]) : null, error: body ? null : { message: 'missing' } }; },
    async remove(keys) { removed.push(...keys); keys.forEach((key) => objects.delete(key)); return { error: null }; },
    async createSignedUrl(key) { return { data: { signedUrl: `https://signed.test/${key}?token=opaque` }, error: null }; }
  }) };
  return { value, objects, removed, acceptFails: options.acceptFails ?? false };
}

describe('runtime world art boundary', () => {
  it('keeps the bucket private and decodes only bounded PNG output', async () => {
    const configured: unknown[] = [];
    await ensurePrivateRuntimeArtBucket({ ...storage().value, async createBucket(_name, options) { configured.push(options); return { error: { message: 'exists' } }; }, async updateBucket(_name, options) { configured.push(options); return { error: null }; } });
    expect(configured).toContainEqual({ public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ['image/png'] });
    await expect(validateRuntimeArtPng(await png())).resolves.toBeInstanceOf(Buffer);
    await expect(validateRuntimeArtPng(Buffer.from('not-a-png'))).rejects.toMatchObject({ code: 'storage_failed' });
  });

  it('cleans storage after a failed accept and treats terminal errors as nonblocking', async () => {
    const fixture = storage({ acceptFails: true }); const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const rpc = { async rpc(name: string, args: Record<string, unknown>) { rpcCalls.push({ name, args }); return { error: name === 'world_runtime_art_accept' ? { message: 'reject' } : null }; } };
    const lease = { attempt: 1, fence: '33333333-3333-4333-8333-333333333333' };
    await expect(persistAcceptedRuntimeArt(fixture.value, rpc, jobId, 'world-v1', await png(), undefined, lease)).rejects.toMatchObject({ code: 'storage_failed' });
    expect(fixture.removed).toHaveLength(1);
    expect(rpcCalls.map(({ name }) => name)).toEqual(['world_runtime_art_accept', 'world_runtime_art_fail']);
    const result = await runRuntimeArtJob({ async generate() { throw new Error('provider private response'); } }, fixture.value, rpc, { id: jobId, appearanceVersion: 'world-v1', attempt: 1, fence: '33333333-3333-4333-8333-333333333333', input: { entityId, appearanceVersion: 'world-v1', publicAppearance: 'amber cloak', narrativeQuote: 'private quote' } }, {}, AbortSignal.timeout(1_000));
    expect(result).toEqual({ status: 'failed_provider' });
    expect(rpcCalls.at(-1)).toEqual(expect.objectContaining({ name: 'world_runtime_art_fail', args: expect.objectContaining({ p_attempt: 1, p_fence: '33333333-3333-4333-8333-333333333333' }) }));
    expect(() => runtimeArtPrompt({ entityId, appearanceVersion: 'world-v1', publicAppearance: ' ', narrativeQuote: 'secret' }, fixturePromptRelease)).toThrow('appearance');
  });

  it('issues a signed preview only after opaque owner authorization and never returns the storage key', async () => {
    const fixture = storage(); const key = `accepted/${jobId}/world-v1/${'a'.repeat(64)}.png`;
    const owner = { async rpc(name: string) { return name === 'world_runtime_art_authorize_delivery' ? { data: { renderId: entityId }, error: null } : { error: { message: 'unexpected' } }; } };
    const service = { async rpc() { return { data: { runtimeKey: key }, error: null }; } };
    await expect(authorizedRuntimeArtPreview(fixture.value, owner, service, { saveId: jobId, entityId, renderId: entityId })).resolves.toContain('https://signed.test/');
    const denied = { async rpc() { return { data: { renderId: jobId }, error: null }; } };
    await expect(authorizedRuntimeArtPreview(fixture.value, denied, service, { saveId: jobId, entityId, renderId: entityId })).resolves.toBeNull();
  });

  it('emits only allow-listed opaque runtime-art lifecycle metrics', async () => {
    const events: unknown[] = [];
    await emitRuntimeArtObservability((event) => { events.push(event); }, { correlationId: `runtime-art:${jobId}`, attempt: 2, stage: 'accept', status: 'completed', model: 'gpt-image-test', tokenCount: 0, durationMs: 12 });
    expect(events).toEqual([{ correlationId: `runtime-art:${jobId}`, attempt: 2, stage: 'accept', status: 'completed', model: 'gpt-image-test', tokenCount: 0, durationMs: 12 }]);
    await emitRuntimeArtObservability((event) => { events.push(event); }, { correlationId: 'bad', attempt: 1, stage: 'fail', status: 'failed', errorCode: 'provider_failed' });
    await emitRuntimeArtObservability((event) => { events.push(event); }, { correlationId: `runtime-art:${jobId}`, attempt: 1, stage: 'fail', status: 'failed', model: 'model with private key', errorCode: 'provider_failed' } as any);
    await emitRuntimeArtObservability((event) => { events.push(event); }, { correlationId: `runtime-art:${jobId}`, attempt: 1, stage: 'fail', status: 'failed', errorCode: 'private provider response' } as any);
    expect(events).toHaveLength(1);
  });

  it('records a bounded attempt and elapsed verification and acceptance work', async () => {
    const fixture = storage(); const events: Array<Record<string, unknown>> = [];
    await runRuntimeArtJob({ async generate() { return png(); } }, fixture.value, { async rpc() { return { data: { reused: false }, error: null }; } }, { id: jobId, appearanceVersion: 'art-v2', attempt: 2, fence: '33333333-3333-4333-8333-333333333333', input: { entityId, appearanceVersion: 'art-v2', publicAppearance: 'brass lantern' } }, {}, AbortSignal.timeout(1_000), { promptRegistry, observability: (event) => { events.push(event); } });
    expect(events).toHaveLength(7);
    expect(events.every((event) => event.attempt === 2)).toBe(true);
    for (const stage of ['verify', 'accept']) expect(events.find((event) => event.stage === stage && event.status === 'completed')).toMatchObject({ durationMs: expect.any(Number) });
  });

  it('uses the SQL-compatible public-spec hash and drains at most four claimed jobs serially', async () => {
    expect(runtimeArtPromptHash({ entityId, appearanceVersion: 'art-v2', publicAppearance: '  brass   lantern  ' })).toBe('a81fbc68d0323926284edbe911285974d37a59edd334d537cfca237ddf114a49');
    const fixture = storage(); let claimed = 0; let concurrent = 0; let maximum = 0;
    const rpc = { async rpc(name: string) {
      if (name === 'world_runtime_art_claim_next') {
        claimed++;
        return claimed <= 5 ? { data: { jobId: `${claimed}`.padStart(8, '0') + '-1111-4111-8111-111111111111', saveId: jobId, entityId, appearanceVersion: 'art-v2', publicAppearance: 'brass lantern', attempt: 1, fence: '33333333-3333-4333-8333-333333333333' }, error: null } : { data: null, error: null };
      }
      return { data: { reused: false }, error: null };
    } };
    const provider = { async generate() { maximum = Math.max(maximum, ++concurrent); const image = await png(); concurrent--; return image; } };
    const outcomes = await drainRuntimeArtQueue(rpc, provider, fixture.value, {}, { promptRegistry, observability: () => {} });
    expect(outcomes).toHaveLength(4);
    expect(maximum).toBe(1);
    expect(claimed).toBe(4);
  });

  it('uses the default structured sink without emitting prompt, storage, or image data', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const fixture = storage();
      await runRuntimeArtJob({ async generate() { return png(); } }, fixture.value, { async rpc() { return { data: { reused: false }, error: null }; } }, { id: jobId, appearanceVersion: 'art-v2', attempt: 1, fence: '33333333-3333-4333-8333-333333333333', input: { entityId, appearanceVersion: 'art-v2', publicAppearance: 'brass lantern', narrativeQuote: 'private quote' } }, {}, AbortSignal.timeout(1_000), { promptRegistry });
      const events = log.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(Object.keys(event).sort()).toEqual(expect.arrayContaining(['workflow', 'correlationId', 'stage', 'status']));
        expect(JSON.stringify(event)).not.toMatch(/brass|quote|accepted\/|token|private/i);
      }
    } finally { log.mockRestore(); }
  });
});
