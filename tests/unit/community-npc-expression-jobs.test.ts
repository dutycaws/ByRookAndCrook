import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFixtureNpcSheet } from '../../scripts/community-npc-fixtures.js';
import {
  claimPortraitGenerationAttempt, runPortraitGenerationAttempt,
  type PortraitGenerationAttempt, type PortraitWorkerClient
} from '../../src/lib/server/community-npc-portraits/service.js';
import { PortraitProviderError, type PrivatePortraitStorage } from '../../src/lib/server/community-npc-portraits/index.js';
import { fixturePromptRegistry } from '../helpers/prompt-registry-fixture';

async function sprite() {
  return sharp({ create: { width: 1024, height: 1536, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: 700, height: 1300, channels: 4, background: { r: 120, g: 80, b: 40, alpha: 1 } } }, left: 160, top: 120 }])
    .png().toBuffer();
}

function privateStorage(): PrivatePortraitStorage {
  const objects = new Map<string, Buffer>();
  return { from: (bucket) => ({
    async upload(key, body) { objects.set(`${bucket}/${key}`, Buffer.from(body)); return { error: null }; },
    async download(key) { const value = objects.get(`${bucket}/${key}`); return { data: value ? new Blob([new Uint8Array(value)]) : null, error: value ? null : { message: 'missing' } }; },
    async createSignedUrl() { return { data: { signedUrl: 'https://preview.test/sprite.webp' }, error: null }; },
    async remove(keys) { for (const key of keys) objects.delete(`${bucket}/${key}`); return { error: null }; }
  }) };
}
function storageWithMaster(masterKey: string, bytes: Buffer): PrivatePortraitStorage {
  const value = privateStorage();
  const original = value.from;
  return { from: (bucket) => {
    const bucketClient = original(bucket);
    if (bucket !== 'community-npc-portrait-masters') return bucketClient;
    return { ...bucketClient, async download(key) {
      if (key === masterKey) return { data: new Blob([new Uint8Array(bytes)]), error: null };
      return bucketClient.download(key);
    } };
  } };
}

function attempt(slot: PortraitGenerationAttempt['request']['slot'] = 'neutral'): PortraitGenerationAttempt {
  return {
    attemptId: '00000000-0000-4000-8000-000000000101', leaseToken: '00000000-0000-4000-8000-000000000102',
    jobId: '00000000-0000-4000-8000-000000000103', candidateId: '00000000-0000-4000-8000-000000000104', ordinal: 1,
    request: { npcId: '00000000-0000-4000-8000-000000000105', sheet: createFixtureNpcSheet(), controls: {}, visualInputHash: 'a'.repeat(64), slot }
  };
}
function rpc(calls: Array<{ name: string; args: Record<string, unknown> }>, failures: Record<string, string> = {}): PortraitWorkerClient {
  return { async rpc(name, args = {}) { calls.push({ name, args }); return { data: null, error: failures[name] ? { message: failures[name] } : null }; } };
}
const refs = [{ revision: 'test@v1', filename: 'ref.png', sha256: 'f'.repeat(64), bytes: Buffer.from('reference') }];

/** Durable attempts must resolve the exact release pinned at reservation. */
function promptRegistryFixture() {
  return fixturePromptRegistry({ onResolve(kind, workId) {
      expect(kind).toBe('portrait');
      expect(workId).toMatch(/^[0-9a-f-]{36}$/i);
    } });
}

describe('durable NPC expression generation worker', () => {
  it('claims only valid fenced queue work', async () => {
    const valid = attempt(); const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client: PortraitWorkerClient = { async rpc(name, args = {}) { calls.push({ name, args }); return { data: valid, error: null }; } };
    await expect(claimPortraitGenerationAttempt(client)).resolves.toMatchObject(valid);
    expect(calls).toEqual([{ name: 'npc_portrait_claim_generation_attempt', args: {} }]);
    const malformed: PortraitWorkerClient = { async rpc() { return { data: { attemptId: 'not-enough' }, error: null }; } };
    await expect(claimPortraitGenerationAttempt(malformed)).resolves.toBeNull();
  });

  it('persists each successful ordinal independently after marking it dispatched', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const png = await sprite();
    const outcome = await runPortraitGenerationAttempt(rpc(calls), attempt(), {
      config: { NPC_IMAGE_API_KEY: 'test' }, storage: privateStorage(), references: refs,
      promptRegistry: promptRegistryFixture(),
      provider: { async generate() { return { bytes: png, provider: 'fixture', model: 'fixture', requestId: 'req-1' }; } }
    });
    expect(outcome).toEqual({ status: 'completed' });
    expect(calls.map((call) => call.name)).toEqual([
      'npc_portrait_mark_generation_dispatched', 'npc_portrait_complete_generation_attempt'
    ]);
    expect(calls[1].args).toMatchObject({ p_error_code: null, p_result: { stage: 'completed', candidate: {
      id: attempt().candidateId, slot: 'neutral', source: 'ai_generated', ordinal: 1
    } } });
  });

  it('attributes a post-dispatch provider failure to only its own ordinal and never re-dispatches', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const outcome = await runPortraitGenerationAttempt(rpc(calls), attempt(), {
      config: { NPC_IMAGE_API_KEY: 'test' }, storage: privateStorage(), references: refs,
      promptRegistry: promptRegistryFixture(),
      provider: { async generate() { throw new PortraitProviderError('provider_timeout', 'timed out'); } }
    });
    expect(outcome).toEqual({ status: 'failed', errorCode: 'provider_timeout' });
    expect(calls.map((call) => call.name)).toEqual([
      'npc_portrait_mark_generation_dispatched', 'npc_portrait_complete_generation_attempt'
    ]);
    expect(calls[1].args).toMatchObject({ p_error_code: 'provider_timeout', p_result: { stage: 'ambiguous_after_dispatch' } });
  });

  it('records confirmed post-dispatch failures as ordinary failed candidates', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const outcome = await runPortraitGenerationAttempt(rpc(calls), attempt(), {
      config: { NPC_IMAGE_API_KEY: 'test' }, storage: privateStorage(), references: refs,
      promptRegistry: promptRegistryFixture(),
      provider: { async generate() { throw new PortraitProviderError('provider_refused', 'policy refusal'); } }
    });
    expect(outcome).toEqual({ status: 'failed', errorCode: 'provider_refused' });
    expect(calls.map((call) => call.name)).toEqual([
      'npc_portrait_mark_generation_dispatched', 'npc_portrait_complete_generation_attempt'
    ]);
    expect(calls[1].args).toMatchObject({
      p_error_code: 'provider_refused', p_result: { stage: 'confirmed_post_dispatch_failure' }
    });
  });

  it.each(['provider_malformed', 'invalid_output', 'storage_failed'] as const)(
    'keeps confirmed %s failures out of the ambiguous path',
    async (code) => {
      const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
      await expect(runPortraitGenerationAttempt(rpc(calls), attempt(), {
        config: { NPC_IMAGE_API_KEY: 'test' }, storage: privateStorage(), references: refs,
        promptRegistry: promptRegistryFixture(),
        provider: { async generate() { throw new PortraitProviderError(code, code); } }
      })).resolves.toEqual({ status: 'failed', errorCode: code });
      expect(calls.at(-1)).toMatchObject({ name: 'npc_portrait_complete_generation_attempt', args: {
        p_error_code: code, p_result: { stage: 'confirmed_post_dispatch_failure' }
      } });
    }
  );

  it('adds only the selected Neutral master as the identity anchor for an optional expression', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []; const png = await sprite();
    const masterKey = 'v1/00000000-0000-4000-8000-000000000106/master.png';
    const expression = attempt('happy');
    expression.neutralAnchorAsset = { assetId: '00000000-0000-4000-8000-000000000107', runtimeStorageKey: 'v1/00000000-0000-4000-8000-000000000106/sprite.webp', masterStorageKey: masterKey, sha256: createHash('sha256').update(png).digest('hex') };
    let referenceNames: string[] = [];
    await expect(runPortraitGenerationAttempt(rpc(calls), expression, {
      config: { NPC_IMAGE_API_KEY: 'test' }, storage: storageWithMaster(masterKey, png), references: refs,
      promptRegistry: promptRegistryFixture(),
      provider: { async generate(request) { referenceNames = request.references.map((reference) => reference.filename); return { bytes: png, provider: 'fixture', model: 'fixture' }; } }
    })).resolves.toEqual({ status: 'completed' });
    expect(referenceNames).toEqual(['ref.png', 'selected-neutral-anchor.png']);
  });

  it('does not cross the provider-dispatch boundary when the provider is unavailable', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const outcome = await runPortraitGenerationAttempt(rpc(calls), attempt(), {
      config: {}, storage: privateStorage(), references: refs
    });
    expect(outcome).toEqual({ status: 'failed', errorCode: 'provider_unavailable' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'npc_portrait_complete_generation_attempt', args: {
      p_error_code: 'provider_unavailable', p_result: { stage: 'pre_dispatch_failed' }
    } });
  });

  it('honors a fenced completion rejection without treating a stale attempt as a winner', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const png = await sprite();
    const outcome = await runPortraitGenerationAttempt(rpc(calls, { npc_portrait_complete_generation_attempt: 'lease no longer valid' }), attempt(), {
      config: { NPC_IMAGE_API_KEY: 'test' }, storage: privateStorage(), references: refs,
      promptRegistry: promptRegistryFixture(),
      provider: { async generate() { return { bytes: png, provider: 'fixture', model: 'fixture' }; } }
    });
    expect(outcome).toEqual({ status: 'lost_lease' });
    expect(calls.map((call) => call.name)).toEqual([
      'npc_portrait_mark_generation_dispatched', 'npc_portrait_complete_generation_attempt'
    ]);
  });
});
