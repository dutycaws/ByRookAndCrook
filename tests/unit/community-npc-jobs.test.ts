import { describe, expect, it, vi } from 'vitest';
import { localScenePublicUrl } from '$lib/server/community-npc-jobs/local-assets';
import { runLocalAuthoringJob, runLocalNpcEvaluation, type CompletionClient } from '$lib/server/community-npc-jobs/runner';

function client(): { client: CompletionClient; calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return { client: { rpc: vi.fn(async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { error: null }; }) }, calls };
}

describe('local community NPC jobs', () => {
  it('completes deterministic assistance as a proposal without mutating a draft', async () => {
    const fixture = client();
    await expect(runLocalAuthoringJob(fixture.client, { jobId: 'job', npcId: 'npc', kind: 'assist', section: 'personality', instruction: 'Make her patient.', currentSection: { values: ['patient'] } })).resolves.toEqual({ status: 'completed' });
    expect(fixture.calls[0]).toMatchObject({ name: 'npc_author_assistance_complete', args: { p_job_id: 'job', p_error_code: null, p_proposal: { replacement: { values: ['patient'] } } } });
  });

  it('records a missing local scene asset as a server-visible failure', async () => {
    const fixture = client();
    const outcome = await runLocalAuthoringJob(fixture.client, { jobId: 'job', npcId: 'npc', kind: 'scene', instruction: 'A moonlit inn.' }, { sceneAssets: [] });
    expect(outcome).toEqual({ status: 'failed', errorCode: 'local_scene_asset_missing' });
    expect(fixture.calls[0]).toMatchObject({ name: 'npc_author_scene_complete', args: { p_error_code: 'local_scene_asset_missing' } });
  });

  it('records a provider completion failure without inventing success', async () => {
    const failing: CompletionClient = { rpc: vi.fn(async () => ({ error: { message: 'provider unavailable' } })) };
    await expect(runLocalAuthoringJob(failing, { jobId: 'job', npcId: 'npc', kind: 'sandbox', message: 'Hello.' })).resolves.toEqual({ status: 'failed', errorCode: 'local_authoring_worker_failed' });
  });

  it('records deterministic schema hard blocks and the lack of a live evaluation', async () => {
    const fixture = client();
    await expect(runLocalNpcEvaluation(fixture.client, 'version', {})).resolves.toEqual({ status: 'completed', hardBlockCount: expect.any(Number) });
    expect(fixture.calls[0]).toMatchObject({
      name: 'npc_evaluation_complete',
      args: { p_version: 'version', p_error_code: null, p_result: { mode: 'deterministic-local-structural-validation', prohibited: false } }
    });
    expect((fixture.calls[0].args.p_result as { hardBlocks: unknown[] }).hardBlocks.length).toBeGreaterThan(0);
  });

  it('records a local evaluation completion failure without approving the version', async () => {
    const failing: CompletionClient = { rpc: vi.fn(async () => ({ error: { message: 'unavailable' } })) };
    await expect(runLocalNpcEvaluation(failing, 'version', {})).resolves.toEqual({ status: 'failed', errorCode: 'local_evaluation_worker_failed' });
  });

  it('rejects arbitrary keys and remote Supabase URLs when resolving local previews', () => {
    expect(localScenePublicUrl('../secrets.png', 'http://127.0.0.1:57321')).toBeNull();
    expect(localScenePublicUrl('shop/v1/unknown.webp', 'http://127.0.0.1:57321')).toBeNull();
    expect(localScenePublicUrl('community-npcs/v1/unknown.webp', 'https://example.com')).toBeNull();
  });
});
