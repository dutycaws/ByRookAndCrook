import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import type { PromptKey } from '$lib/server/prompt-registry';
import { fixturePromptRelease } from './prompt-registry-fixture';

const outputPath = 'artifacts/npc-evals/issue-35-offline-provider-requests.jsonl';
const promptKeyByFormatName: Record<string, PromptKey> = {
  review: 'dialogue.review',
  world_proposer: 'resident.proposer',
  world_critic: 'resident.critic',
  world_repair: 'resident.repair',
  world_final_critic: 'resident.final_critic',
  world_digest: 'resident.digest',
  world_canon_proposer: 'canon.proposer',
  world_canon_critic: 'canon.critic',
  world_canon_repair: 'canon.repair',
  world_canon_final_critic: 'canon.final_critic',
  world_social_encounter_proposer: 'social.proposer',
  world_social_encounter_critic: 'social.critic',
  world_social_encounter_repair: 'social.repair',
  world_social_encounter_final_critic: 'social.final_critic',
  world_procedural_world_proposer: 'procedural.proposer',
  world_procedural_world_critic: 'procedural.critic',
  world_procedural_world_repair: 'procedural.repair',
  world_procedural_world_final_critic: 'procedural.final_critic',
  world_quest_transition_proposer: 'quest_transition.proposer',
  world_quest_transition_critic: 'quest_transition.critic',
  world_quest_transition_repair: 'quest_transition.repair',
  world_quest_transition_final_critic: 'quest_transition.final_critic',
  npc_memory_summary_v2: 'npc_memory.summary.v2',
  npc_authoring_assistance: 'authoring.assist',
  npc_authoring_sandbox: 'authoring.sandbox'
};

/**
 * Existing provider tests already intercept every OpenAI request. This opt-in
 * recorder persists only their exact, bounded generation bodies for local
 * approval review; ordinary test runs have no file-system side effect.
 */
export function captureMockedNpcProviderRequests(sourceSuite: string): void {
  if (process.env.ISSUE_35_CAPTURE_PROVIDER_PAYLOADS !== '1') return;
  const fetchMock = globalThis.fetch as typeof globalThis.fetch & { mock?: { calls: Array<[unknown, RequestInit?]> } };
  const calls = fetchMock.mock?.calls ?? [];
  const priorDigests = new Set<string>();
  if (existsSync(outputPath)) {
    for (const line of readFileSync(outputPath, 'utf8').split('\n')) {
      if (!line) continue;
      try { priorDigests.add(JSON.parse(line).requestSha256); } catch { /* Ignore an incomplete last line during an interrupted run. */ }
    }
  }
  for (const [, init] of calls) {
    if (typeof init?.body !== 'string') continue;
    let requestBody: Record<string, any>;
    try { requestBody = JSON.parse(init.body); } catch { continue; }
    if (requestBody.store !== false || !Number.isSafeInteger(requestBody.max_output_tokens)
      || typeof requestBody.model !== 'string' || requestBody.model !== 'gpt-6-luna'
      || !requestBody.text?.format?.name || new TextEncoder().encode(init.body).byteLength > 100_000) continue;
    const formatName = requestBody.text.format.name as string;
    const promptKey = promptKeyByFormatName[formatName];
    const prompt = promptKey ? fixturePromptRelease.prompts[promptKey] : undefined;
    if (!prompt) continue;
    const requestSha256 = createHash('sha256').update(init.body).digest('hex');
    if (priorDigests.has(requestSha256)) continue;
    priorDigests.add(requestSha256);
    appendFileSync(outputPath, `${JSON.stringify({
      sourceSuite,
      sourceTest: expect.getState().currentTestName,
      stage: formatName,
      prompt: { key: prompt.key, releaseId: prompt.releaseId, revisionId: prompt.revisionId, contentHash: prompt.contentHash },
      requestBody,
      requestSha256,
      requestBytes: new TextEncoder().encode(init.body).byteLength
    })}\n`);
  }
}
