import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prompts } from '../../src/lib/server/dialogue/prompts';
import { SETTLEMENT_PROMPTS } from '../../src/lib/server/evolving-world/prompts';
import { QUEST_TRANSITION_PROPOSAL_CONTRACT } from '../../src/lib/server/evolving-world/quest-transition-prompt-contract';
import { initialPromptReleaseSnapshot } from '../../src/lib/server/prompt-registry';
import { INITIAL_DIALOGUE_BOUNDARY } from '../../src/lib/server/prompt-registry/manifest';
import { buildDialogueResponseBody } from '../../src/lib/server/dialogue/provider';

const migration = readFileSync('supabase/migrations/20261003210000_prompt_instruction_dedup.sql', 'utf8');
const bodies = new Map([...migration.matchAll(/\('([^']+)', \$dedup_body\$([\s\S]*?)\$dedup_body\$\)/g)].map((m) => [m[1], m[2]]));
const priorBytes = { investigate: 1721, deliberate: 2379, speak: 2461, review: 2804, remember: 1947 };

describe('deduplicated prompt release', () => {
  it('publishes every changed source body verbatim, including the expanded proposal contract', () => {
    const release = initialPromptReleaseSnapshot();
    expect(bodies.size).toBe(9);
    for (const [key, body] of bodies) {
      expect(body).toBe(release.prompts[key as keyof typeof release.prompts].body);
    }
    for (const stage of ['quest_transition_proposer', 'quest_transition_repair'] as const) {
      expect(SETTLEMENT_PROMPTS[stage].split(QUEST_TRANSITION_PROPOSAL_CONTRACT)).toHaveLength(2);
    }
  });

  it('keeps the common boundary extraction intact and removes the objective-change permission', () => {
    expect(INITIAL_DIALOGUE_BOUNDARY).toBe(prompts.investigate.split(' Interpret the original message')[0]);
    expect(INITIAL_DIALOGUE_BOUNDARY).not.toContain('request_context');
    expect(prompts.deliberate).toContain('never the active quest objective, motivation or targets');
    expect(prompts.deliberate).not.toContain('unless changing the objective');
    expect(prompts.remember).toContain('Keeper claims have null priorCommitmentId and commitmentStatus');
  });

  it.each(Object.keys(priorBytes) as Array<keyof typeof priorBytes>)('reduces the actual %s system field without altering request controls or user data', (stage) => {
    const release = initialPromptReleaseSnapshot();
    const pin = release.prompts[`dialogue.${stage}`];
    const payload = { message: 'Please inspect the footpath tomorrow.', synthetic: true };
    const before = buildDialogueResponseBody(stage, payload, { ...pin, body: 'x'.repeat(priorBytes[stage]) }, 'unchanged-model');
    const after = buildDialogueResponseBody(stage, payload, pin, 'unchanged-model');
    expect(Buffer.byteLength(prompts[stage])).toBeLessThan(priorBytes[stage]);
    expect(Buffer.byteLength(JSON.stringify(after))).toBeLessThan(Buffer.byteLength(JSON.stringify(before)));
    expect({ ...after, input: undefined }).toEqual({ ...before, input: undefined });
    expect((after.input as Array<{ content: string }>)[1]).toEqual((before.input as Array<{ content: string }>)[1]);
    expect((after.input as Array<{ content: string }>)[0].content).toBe(prompts[stage]);
  });
});
