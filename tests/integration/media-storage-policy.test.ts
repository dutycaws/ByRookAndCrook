import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createTestPlayer, getLocalSupabase } from '../helpers/local-supabase';

const sourceBucket = 'source-masters';
const evidenceBucket = 'review-evidence';
const runId = crypto.randomUUID();
const sourceKey = `integration/${runId}.png`;
const evidenceKey = `integration/${runId}.json`;
const sourceBytes = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
const evidenceBytes = Buffer.from(JSON.stringify({ runId }));

let admin: SupabaseClient;
let anonymous: SupabaseClient;
let player: Awaited<ReturnType<typeof createTestPlayer>>;

beforeAll(async () => {
  const local = getLocalSupabase();
  admin = createClient(local.url, local.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  anonymous = createClient(local.url, local.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  player = await createTestPlayer('media-storage-policy');

  const sourceUpload = await admin.storage.from(sourceBucket).upload(sourceKey, sourceBytes, {
    contentType: 'image/png',
    upsert: false
  });
  if (sourceUpload.error) throw sourceUpload.error;
  const evidenceUpload = await admin.storage.from(evidenceBucket).upload(evidenceKey, evidenceBytes, {
    contentType: 'application/json',
    cacheControl: '31536000, public, immutable',
    upsert: false
  });
  if (evidenceUpload.error) throw evidenceUpload.error;
});

afterAll(async () => {
  await Promise.all([
    admin?.storage.from(sourceBucket).remove([sourceKey]),
    admin?.storage.from(evidenceBucket).remove([evidenceKey]),
    player?.admin.auth.admin.deleteUser(player.userId)
  ]);
});

describe('media Storage bucket policy', () => {
  it('keeps source masters private from anonymous and authenticated application clients', async () => {
    const serviceRead = await admin.storage.from(sourceBucket).download(sourceKey);
    expect(serviceRead.error).toBeNull();
    expect(Buffer.from(await serviceRead.data!.arrayBuffer())).toEqual(sourceBytes);

    const [anonymousRead, authenticatedRead] = await Promise.all([
      anonymous.storage.from(sourceBucket).download(sourceKey),
      player.client.storage.from(sourceBucket).download(sourceKey)
    ]);
    expect(anonymousRead.error).not.toBeNull();
    expect(authenticatedRead.error).not.toBeNull();
  });

  it('denies application writes to both media buckets', async () => {
    const attempts = await Promise.all([
      anonymous.storage.from(sourceBucket).upload(`integration/${runId}-anon.png`, sourceBytes, { contentType: 'image/png' }),
      anonymous.storage.from(evidenceBucket).upload(`integration/${runId}-anon.json`, evidenceBytes, { contentType: 'application/json' }),
      player.client.storage.from(sourceBucket).upload(`integration/${runId}-auth.png`, sourceBytes, { contentType: 'image/png' }),
      player.client.storage.from(evidenceBucket).upload(`integration/${runId}-auth.json`, evidenceBytes, { contentType: 'application/json' })
    ]);
    expect(attempts.every(({ error }) => error !== null)).toBe(true);
  });

  it('denies anonymous and authenticated application updates and deletes in both media buckets', async () => {
    const updatedSourceBytes = Buffer.from('89504e470d0a1a0a0000000d494844520000000200000002', 'hex');
    const updatedEvidenceBytes = Buffer.from(JSON.stringify({ runId, updated: true }));
    const updates = await Promise.all([
      anonymous.storage.from(sourceBucket).update(sourceKey, updatedSourceBytes, { contentType: 'image/png' }),
      anonymous.storage.from(evidenceBucket).update(evidenceKey, updatedEvidenceBytes, { contentType: 'application/json' }),
      player.client.storage.from(sourceBucket).update(sourceKey, updatedSourceBytes, { contentType: 'image/png' }),
      player.client.storage.from(evidenceBucket).update(evidenceKey, updatedEvidenceBytes, { contentType: 'application/json' })
    ]);
    expect(updates.every(({ error }) => error !== null)).toBe(true);

    const deletes = await Promise.all([
      anonymous.storage.from(sourceBucket).remove([sourceKey]),
      anonymous.storage.from(evidenceBucket).remove([evidenceKey]),
      player.client.storage.from(sourceBucket).remove([sourceKey]),
      player.client.storage.from(evidenceBucket).remove([evidenceKey])
    ]);
    // Storage's bulk-delete endpoint returns a successful empty result when RLS
    // makes no rows deletable, rather than surfacing a 403. Assert both allowed
    // no-op shapes and then prove below that neither fixture was removed.
    expect(deletes.every(({ data, error }) => error !== null || (Array.isArray(data) && data.length === 0))).toBe(true);

    // Failed update/delete calls must leave the administrator-uploaded fixtures
    // intact; this also catches a policy that rejects only one of the mutations.
    const [sourceRead, evidenceRead] = await Promise.all([
      admin.storage.from(sourceBucket).download(sourceKey),
      admin.storage.from(evidenceBucket).download(evidenceKey)
    ]);
    expect(sourceRead.error).toBeNull();
    expect(evidenceRead.error).toBeNull();
    expect(Buffer.from(await sourceRead.data!.arrayBuffer())).toEqual(sourceBytes);
    expect(Buffer.from(await evidenceRead.data!.arrayBuffer())).toEqual(evidenceBytes);
  });

  it('serves public review evidence without exposing source masters', async () => {
    const publicEvidenceUrl = anonymous.storage.from(evidenceBucket).getPublicUrl(evidenceKey).data.publicUrl;
    const publicSourceUrl = anonymous.storage.from(sourceBucket).getPublicUrl(sourceKey).data.publicUrl;
    const [evidenceResponse, sourceResponse] = await Promise.all([fetch(publicEvidenceUrl), fetch(publicSourceUrl)]);

    expect(evidenceResponse.status).toBe(200);
    expect(Buffer.from(await evidenceResponse.arrayBuffer())).toEqual(evidenceBytes);
    expect(evidenceResponse.headers.get('cache-control')).toContain('max-age=31536000');
    expect(evidenceResponse.headers.get('cache-control')).toContain('public');
    expect(evidenceResponse.headers.get('cache-control')).toContain('immutable');
    expect(sourceResponse.ok).toBe(false);
  });
});
