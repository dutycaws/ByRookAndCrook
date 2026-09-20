import { describe, expect, it } from 'vitest';
import { prompts as dialoguePrompts } from '../../src/lib/server/dialogue/prompts.js';
import { SETTLEMENT_PROMPTS } from '../../src/lib/server/evolving-world/prompts.js';
import { createFixtureNpcSheet } from '../../scripts/community-npc-fixtures.js';
import { lockedPortraitPrompt, portraitVisualProjection } from '../../src/lib/server/community-npc-portraits/index.js';
import { PROMPT_KEYS, PROMPT_MANIFEST, PROMPT_WORKFLOW_EDGES, PromptTemplateError, initialPromptReleaseSnapshot, portraitIdentityAnchorInstruction, renderRegisteredPrompt, sha256Hex, validatePromptTemplate } from '../../src/lib/server/prompt-registry/index.js';

function portraitValues(sheet: ReturnType<typeof createFixtureNpcSheet>, controls: Parameters<typeof lockedPortraitPrompt>[1], slot: 'neutral' | 'warm' | 'wary' | 'determined' | 'thoughtful' | 'stern' = 'neutral') {
  const visual = portraitVisualProjection(sheet, controls);
  const context = [
    `Role: ${visual.title}.`,
    `Physical appearance: ${visual.physicalAppearance}. Attire: ${visual.attire}. Notable features: ${visual.notableFeatures}. Mood: ${visual.mood}.`,
    `Personality cues: ${visual.personalityCues.join(', ') || 'none supplied'}. Pose: ${visual.controls.pose}. Expression: ${visual.controls.expression}. Clothing condition: ${visual.controls.clothingCondition.replace('_', '-')}.`,
    visual.controls.optionalItem ? `Include this authored item only: ${visual.controls.optionalItem}.` : '',
    visual.controls.compositionNote ? `Composition-only note: ${visual.controls.compositionNote}.` : ''
  ].filter(Boolean).join('\n');
  return { portrait_context: context, identity_anchor_instruction: portraitIdentityAnchorInstruction(slot) };
}

describe('prompt registry core', () => {
  it('has one code-owned entry for each closed prompt key and deterministic release-1 hashes', () => {
    expect(Object.keys(PROMPT_MANIFEST).sort()).toEqual([...PROMPT_KEYS].sort());
    const release = initialPromptReleaseSnapshot('2026-09-16T00:00:00.000Z', 'fixture');
    expect(Object.keys(release.prompts)).toHaveLength(30);
    expect(release.prompts['dialogue.speak'].bodyHash).toBe(sha256Hex(PROMPT_MANIFEST['dialogue.speak'].initialBody));
    expect(release.prompts['image.community_portrait'].contractHash).toBe(PROMPT_MANIFEST['image.community_portrait'].contract.hash);
    expect(release.prompts['dialogue.speak'].releaseId).toBe(release.releaseId);
    expect(release.prompts['dialogue.speak'].contentHash).toBe(release.prompts['dialogue.speak'].bodyHash);
    expect(release.prompts['dialogue.speak'].promptType).toBe('text_system');
    expect(PROMPT_MANIFEST['dialogue.speak'].initialBody).toBe(dialoguePrompts.speak);
    expect(PROMPT_MANIFEST['procedural.final_critic'].initialBody).toBe(SETTLEMENT_PROMPTS.procedural_world_final_critic);
    expect(PROMPT_MANIFEST['quest_transition.final_critic'].initialBody).toBe(SETTLEMENT_PROMPTS.quest_transition_final_critic);
  });

  it('reproduces the current portrait prompt for neutral and expression-controlled release-1 dispatches', () => {
    const sheet = createFixtureNpcSheet();
    const neutral = {};
    const release=initialPromptReleaseSnapshot();
    expect(renderRegisteredPrompt('image.community_portrait', PROMPT_MANIFEST['image.community_portrait'].initialBody, portraitValues(sheet, neutral, 'neutral'))).toBe(lockedPortraitPrompt(sheet, neutral, 'neutral', release));
    const expression = { expression: 'warm' as const, pose: 'relaxed' as const, clothingCondition: 'well_kept' as const };
    const currentExpressionDispatch = lockedPortraitPrompt(sheet, expression, 'warm', release);
    expect(renderRegisteredPrompt('image.community_portrait', PROMPT_MANIFEST['image.community_portrait'].initialBody, portraitValues(sheet, expression, 'warm'))).toBe(currentExpressionDispatch);
  });

  it('publishes code-owned non-model workflow topology for validation and persistence', () => {
    expect(PROMPT_WORKFLOW_EDGES).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'dialogue.validate', to: 'dialogue.commit' }),
      expect.objectContaining({ from: 'portrait.validate', to: 'portrait.storage' }),
      expect.objectContaining({ from: 'runtime_art.storage', to: 'runtime_art.commit' })
    ]));
    expect(PROMPT_WORKFLOW_EDGES).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'dialogue.investigate', to: 'dialogue.investigate', kind: 'retry' }),
      expect.objectContaining({ from: 'dialogue.speak', to: 'dialogue.speak', kind: 'retry' }),
      expect.objectContaining({ from: 'dialogue.review', to: 'dialogue.review', kind: 'retry' })
    ]));
  });

  it('renders only registered variables and makes image variables exact and required', () => {
    expect(renderRegisteredPrompt('image.runtime_art', PROMPT_MANIFEST['image.runtime_art'].initialBody, { public_appearance: 'amber cloak' })).toContain('amber cloak');
    expect(renderRegisteredPrompt('image.community_portrait', PROMPT_MANIFEST['image.community_portrait'].initialBody, { portrait_context: 'Role: ranger.', identity_anchor_instruction: 'References define quality only.' })).toContain('Role: ranger.');
    expect(() => renderRegisteredPrompt('image.community_portrait', PROMPT_MANIFEST['image.community_portrait'].initialBody, { portrait_context: 'x' })).toThrow(PromptTemplateError);
    expect(() => validatePromptTemplate(PROMPT_MANIFEST['image.community_portrait'], '{{portrait_context}} {{portrait_context}} {{identity_anchor_instruction}}')).toThrow(/exactly once/);
    expect(() => validatePromptTemplate(PROMPT_MANIFEST['image.runtime_art'], '{{other}}')).toThrow(/cannot use/);
  });

  it('rejects oversized candidate bodies before a release can be created', () => {
    expect(() => validatePromptTemplate(PROMPT_MANIFEST['dialogue.speak'], 'x'.repeat(32 * 1024 + 1))).toThrow(/32 KiB/);
  });
});
