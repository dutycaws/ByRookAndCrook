import { describe, expect, it, vi } from 'vitest';
import type { NpcSheet } from '$lib/game/npc-sheet';
import { createNpcSheet } from '$lib/game/community-npc-ui';
import { localScenePublicUrl, localSettingPublicUrl } from '$lib/server/community-npc-jobs/local-assets';
import { authoringProviderAvailability, runAuthoringJob, runLocalAuthoringJob, runLocalNpcEvaluation, type CompletionClient } from '$lib/server/community-npc-jobs/runner';
import { createAuthoringProvider, type AuthoringProvider } from '$lib/server/community-npc-jobs/provider';
import { fixturePromptRelease } from '../helpers/prompt-registry-fixture';

const promptRelease = fixturePromptRelease;
const authoringRuntime = <T extends Record<string, unknown>>(runtime: T) => ({ ...runtime, promptRelease });

function sheet(): NpcSheet {
  const value = createNpcSheet('Mara Reed');
  value.identity = {
    name: 'Mara Reed',
    title: 'Roadside Scout',
    shortDescription: 'A patient local scout who watches the old road for stranded travelers.',
    voice: 'Plain-spoken, observant, and careful with every promise she makes.'
  };
  return value;
}
function client(): { client: CompletionClient; calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return { client: { rpc: vi.fn(async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { error: null }; }) }, calls };
}
function provider(overrides: Partial<AuthoringProvider> = {}): AuthoringProvider {
  return {
    assist: vi.fn(async ({ sheet: current }) => ({ replacement: { ...current.identity, title: 'Master Scout' }, explanation: 'Makes her earned road knowledge clearer.' })),
    sandbox: vi.fn(async () => ({ reply: 'The old road is quiet tonight, but I still watch it.' })),
    ...overrides
  };
}

describe('community NPC authoring provider jobs', () => {
  it('records a visibly changed, complete-sheet-valid assistance proposal without mutating the draft', async () => {
    const fixture = client(); const current = sheet(); const model = provider();
    await expect(runAuthoringJob(fixture.client, { jobId: 'job', npcId: 'npc', kind: 'assist', section: 'identity', instruction: 'Make her title more specific.', sheet: current }, authoringRuntime({ provider: model }))).resolves.toEqual({ status: 'completed' });
    expect(current.identity.title).toBe('Roadside Scout');
    expect(fixture.calls[0]).toMatchObject({ name: 'npc_author_assistance_complete', args: { p_job_id: 'job', p_error_code: null, p_proposal: { replacement: { title: 'Master Scout' }, explanation: expect.any(String) } } });
  });

  it('rejects an unchanged or malformed replacement instead of creating fixture-looking success', async () => {
    const same = client(); const current = sheet();
    await expect(runAuthoringJob(same.client, { jobId: 'same', npcId: 'npc', kind: 'assist', section: 'identity', instruction: 'Do nothing.', sheet: current }, authoringRuntime({ provider: provider({ assist: vi.fn(async ({ sheet: value }) => ({ replacement: value.identity, explanation: 'No change.' })) }) }))).resolves.toEqual({ status: 'failed', errorCode: 'provider_no_change' });
    expect(same.calls[0]).toMatchObject({ args: { p_error_code: 'provider_no_change' } });
    const malformed = client();
    await expect(runAuthoringJob(malformed.client, { jobId: 'bad', npcId: 'npc', kind: 'assist', section: 'identity', instruction: 'Break it.', sheet: current }, authoringRuntime({ provider: provider({ assist: vi.fn(async () => ({ replacement: {}, explanation: 'Broken.' })) }) }))).resolves.toEqual({ status: 'failed', errorCode: 'provider_malformed' });
  });

  it('sends a frozen sheet and ordered context to sandbox, then persists only the returned NPC reply', async () => {
    const fixture = client(); const current = sheet(); const model = provider();
    await expect(runAuthoringJob(fixture.client, { jobId: 'sandbox', npcId: 'npc', kind: 'sandbox', sheet: current, turns: [{ role: 'keeper', content: 'How is the road?' }] }, authoringRuntime({ provider: model }))).resolves.toEqual({ status: 'completed' });
    expect(model.sandbox).toHaveBeenCalledWith(expect.objectContaining({ sheet: current, turns: [{ role: 'keeper', content: 'How is the road?' }] }), expect.any(AbortSignal));
    expect(fixture.calls[0]).toMatchObject({ name: 'npc_author_sandbox_complete', args: { p_reply: 'The old road is quiet tonight, but I still watch it.', p_error_code: null } });
  });

  it('classifies unavailable, timeout, and provider failure outcomes synchronously', async () => {
    expect(authoringProviderAvailability({ NPC_PROVIDER: 'local', OPENAI_API_KEY: 'test' })).toEqual({ available: false, reason: 'local_not_implemented' });
    expect(authoringProviderAvailability({ NPC_PROVIDER: 'openai' })).toEqual({ available: false, reason: 'missing_openai_key' });
    const unavailable = client();
    await expect(runLocalAuthoringJob(unavailable.client, { jobId: 'missing', npcId: 'npc', kind: 'assist', section: 'identity', instruction: 'Help.', sheet: sheet() })).resolves.toEqual({ status: 'failed', errorCode: 'provider_unavailable' });
    const timeout = client();
    const slow = provider({ sandbox: vi.fn((_request, signal) => new Promise<{ reply: string }>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'AbortError' })));
    })) });
    await expect(runAuthoringJob(timeout.client, { jobId: 'slow', npcId: 'npc', kind: 'sandbox', sheet: sheet(), turns: [{ role: 'keeper', content: 'Hello' }] }, authoringRuntime({ provider: slow, timeoutMs: 1_000 }))).resolves.toEqual({ status: 'failed', errorCode: 'provider_timeout' });
    const failed = client();
    await expect(runAuthoringJob(failed.client, { jobId: 'failed', npcId: 'npc', kind: 'sandbox', sheet: sheet(), turns: [{ role: 'keeper', content: 'Hello' }] }, authoringRuntime({ provider: provider({ sandbox: vi.fn(async () => { throw new Error('network'); }) }) }))).resolves.toEqual({ status: 'failed', errorCode: 'provider_failed' });
  });

  it('uses a strict Responses structured result for the configured OpenAI adapter', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ replacementJson: JSON.stringify({ ...sheet().identity, title: 'Trailwarden' }), explanation: 'Clarifies her role.' }) }] }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await createAuthoringProvider({ NPC_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }, promptRelease).assist({ section: 'identity', instruction: 'Clarify her role.', sheet: sheet() }, new AbortController().signal);
      expect(result).toMatchObject({ replacement: { title: 'Trailwarden' }, explanation: 'Clarifies her role.' });
      const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(String(request.body));
      expect(body).toMatchObject({ model: 'gpt-5.6-terra', store: false, text: { format: { type: 'json_schema', strict: true, name: 'npc_authoring_assistance' } } });
      expect(body.input[1].content).toContain('replace_one_section');
    } finally { vi.unstubAllGlobals(); }
  });

  it('keeps local scene fixture failure explicit and deterministic evaluation structural', async () => {
    const fixture = client();
    await expect(runLocalAuthoringJob(fixture.client, { jobId: 'job', npcId: 'npc', kind: 'scene', instruction: 'A moonlit inn.' }, { sceneAssets: [] })).resolves.toEqual({ status: 'failed', errorCode: 'local_scene_asset_missing' });
    await expect(runLocalNpcEvaluation(fixture.client, 'version', {})).resolves.toEqual({ status: 'completed', hardBlockCount: expect.any(Number) });
    expect(fixture.calls.at(-1)).toMatchObject({ name: 'npc_evaluation_complete', args: { p_error_code: null, p_result: { mode: 'deterministic-local-structural-validation' } } });
  });

  it('rejects arbitrary keys and remote Supabase URLs when resolving local previews', () => {
    expect(localScenePublicUrl('../secrets.png', 'http://127.0.0.1:57321')).toBeNull();
    expect(localScenePublicUrl('shop/v1/unknown.webp', 'http://127.0.0.1:57321')).toBeNull();
    expect(localScenePublicUrl('community-npcs/v1/unknown.webp', 'https://example.com')).toBeNull();
    expect(localSettingPublicUrl('unknown-setting', 'http://127.0.0.1:57321')).toBeNull();
    expect(localSettingPublicUrl('community-settings/lantern-lit-tavern-table.webp', 'http://127.0.0.1:57321')).toBeNull();
    expect(localSettingPublicUrl('../lantern-lit-tavern-table', 'http://127.0.0.1:57321')).toBeNull();
  });
});
