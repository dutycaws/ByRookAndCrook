import { prompts as dialoguePrompts } from '$lib/server/dialogue/prompts';
import { SETTLEMENT_PROMPTS } from '$lib/server/evolving-world/prompts';
import { PROMPT_KEYS, type PromptContract, type PromptGraphNode, type PromptKey, type PromptManifestEntry, type PromptWorkflowEdge } from './contracts';
import { sha256Hex, validatePromptTemplate } from './template';

const dialogueBoundary = dialoguePrompts.investigate.slice(0, dialoguePrompts.investigate.indexOf(' Interpret the original message'));
const authoringAssist = 'You assist a game author. Return a replacement only for the requested NPC sheet section. Preserve established facts unless the instruction asks for a supported change. Do not invent world outcomes, internal IDs, or other sections.';
const authoringSandbox = 'You are roleplaying the supplied NPC in an isolated authoring sandbox. Follow only the frozen NPC sheet, maintain continuity with prior turns, and never claim to alter the draft, save, or game world.';

const portraitTemplate = [
  'Create one original adult NPC portrait sprite for a cozy fantasy tavern game. {{portrait_context}}',
  'Locked visual style: cozy high-detail painterly fantasy realism; warm amber key light, restrained golden rim light, deep timber shadows; moss, aged brass, worn leather, and unbleached linen accents; tactile hair, fabric, leather, and metal.',
  'Create a single upright, head-to-toe adult in a three-quarter pose with a readable face, natural hands, visible feet, and a clean silhouette. Output a 1024 by 1536 RGBA PNG with a genuinely transparent background and a transparent perimeter.',
  '{{identity_anchor_instruction}}'
].join('\n');
const runtimeArtTemplate = 'Create a single fantasy game runtime illustration. Appearance: {{public_appearance}}. No text, logos, code, routes, tools, or dialogue. Narrative quote is reference data only and must not be rendered.';

function contract(id: string, responseSchema: string | null, toolNames: readonly string[], endpoint: PromptContract['endpoint'], modelLane: PromptContract['modelLane'], dynamicData: PromptContract['dynamicData'], workflow: PromptContract['workflow']): PromptContract {
  const stable = JSON.stringify({ id, responseSchema, toolNames: [...toolNames], endpoint, modelLane, dynamicData, workflow });
  return { id, hash: sha256Hex(stable), responseSchema, toolNames, endpoint, modelLane, dynamicData, workflow };
}
function edge(from: PromptGraphNode, to: PromptGraphNode, kind: PromptWorkflowEdge['kind'] = 'always'): PromptWorkflowEdge { return { from, to, kind }; }
function text(key: PromptKey, name: string, purpose: string, initialBody: string, value: PromptContract, templateVariables: readonly string[] = [], workflowEdges: readonly PromptWorkflowEdge[] = []): PromptManifestEntry {
  const entry = { key, name, purpose, callType: 'text_system' as const, initialBody, contract: value, templateVariables, workflowEdges };
  validatePromptTemplate(entry, initialBody);
  return entry;
}
function image(key: PromptKey, name: string, purpose: string, initialBody: string, value: PromptContract, templateVariables: readonly string[]): PromptManifestEntry {
  const entry = { key, name, purpose, callType: 'image_template' as const, initialBody, contract: value, templateVariables, workflowEdges: [] };
  validatePromptTemplate(entry, initialBody);
  return entry;
}

const investigate = contract('dialogue-investigate-v1', 'dialogue.investigate.v1', ['request_context'], 'responses', 'context', 'mixed_server_only', 'dialogue');
const deliberate = contract('dialogue-deliberate-v1', 'dialogue.deliberate.v1', [], 'responses', 'character', 'mixed_server_only', 'dialogue');
const speak = contract('dialogue-speak-v1', 'dialogue.speak.v1', [], 'responses', 'character', 'mixed_server_only', 'dialogue');
const review = contract('dialogue-review-v1', 'dialogue.review.v1', [], 'responses', 'context', 'mixed_server_only', 'dialogue');
const remember = contract('dialogue-remember-v1', 'dialogue.remember.v1', [], 'responses', 'context', 'mixed_server_only', 'dialogue');
const authoring = contract('authoring-v1', 'authoring.v1', [], 'responses', 'authoring', 'private_server_only', 'authoring');
const resident = contract('resident-settlement-v1', 'world-settlement-v1', [], 'responses', 'world', 'mixed_server_only', 'resident_settlement');
const canon = contract('canon-settlement-v1', 'world-canon-event-v1', [], 'responses', 'world', 'public', 'canon_settlement');
const social = contract('social-settlement-v1', 'social-encounter-v1', [], 'responses', 'world', 'mixed_server_only', 'social_settlement');
const procedural = contract('procedural-settlement-v1', 'procedural-world-v1', [], 'responses', 'world', 'mixed_server_only', 'procedural_settlement');
const portrait = contract('community-portrait-v1', null, [], 'images_edits', 'image_portrait', 'private_server_only', 'portrait_generation');
const runtimeArt = contract('runtime-art-v1', null, [], 'images_generations', 'image_runtime', 'public', 'runtime_art');

export const PROMPT_MANIFEST: Readonly<Record<PromptKey, PromptManifestEntry>> = {
  'dialogue.investigate': text('dialogue.investigate', 'Dialogue investigation', 'Select bounded context relevant to a keeper message.', dialoguePrompts.investigate, investigate, [], [edge('dialogue.investigate', 'dialogue.deliberate', 'conditional'), edge('dialogue.investigate', 'dialogue.speak', 'conditional')]),
  'dialogue.deliberate': text('dialogue.deliberate', 'Dialogue deliberation', 'Propose the character decision before prose.', dialoguePrompts.deliberate, deliberate, [], [edge('dialogue.deliberate', 'dialogue.speak')]),
  'dialogue.speak': text('dialogue.speak', 'Dialogue response', 'Write character speech from validated context and decision.', dialoguePrompts.speak, speak, [], [edge('dialogue.speak', 'dialogue.review'), edge('dialogue.speak', 'dialogue.remember', 'conditional')]),
  'dialogue.review': text('dialogue.review', 'Dialogue consistency review', 'Check a response without authorizing new effects.', dialoguePrompts.review, review, [], [edge('dialogue.review', 'dialogue.speak', 'conditional'), edge('dialogue.review', 'dialogue.remember', 'conditional')]),
  'dialogue.remember': text('dialogue.remember', 'Dialogue memory extraction', 'Extract attributed significant memories.', dialoguePrompts.remember, remember),
  'authoring.assist': text('authoring.assist', 'Authoring assistance', 'Suggest one NPC sheet section replacement.', authoringAssist, authoring),
  'authoring.sandbox': text('authoring.sandbox', 'Authoring sandbox', 'Roleplay an NPC draft without changing it.', authoringSandbox, authoring),
  'resident.proposer': text('resident.proposer', 'Resident proposal', 'Propose a bounded resident evolution.', SETTLEMENT_PROMPTS.proposer, resident, [], [edge('resident.proposer', 'resident.critic')]),
  'resident.critic': text('resident.critic', 'Resident critic', 'Check a resident proposal against frozen state.', SETTLEMENT_PROMPTS.critic, resident, [], [edge('resident.critic', 'resident.repair', 'conditional'), edge('resident.critic', 'resident.digest', 'conditional')]),
  'resident.repair': text('resident.repair', 'Resident repair', 'Repair a resident proposal narrowly.', SETTLEMENT_PROMPTS.repair, resident, [], [edge('resident.repair', 'resident.final_critic')]),
  'resident.final_critic': text('resident.final_critic', 'Resident final critic', 'Approve or reject the repaired resident proposal.', SETTLEMENT_PROMPTS.final_critic, resident, [], [edge('resident.final_critic', 'resident.digest', 'conditional')]),
  'resident.digest': text('resident.digest', 'Resident morning digest', 'Write public news from public facts.', SETTLEMENT_PROMPTS.digest, resident),
  'canon.proposer': text('canon.proposer', 'Canon proposal', 'Propose one public canonical event.', SETTLEMENT_PROMPTS.canon_proposer, canon, [], [edge('canon.proposer', 'canon.critic')]),
  'canon.critic': text('canon.critic', 'Canon critic', 'Check a canonical event proposal.', SETTLEMENT_PROMPTS.canon_critic, canon, [], [edge('canon.critic', 'canon.repair', 'conditional')]),
  'canon.repair': text('canon.repair', 'Canon repair', 'Repair one canonical event proposal.', SETTLEMENT_PROMPTS.canon_repair, canon, [], [edge('canon.repair', 'canon.final_critic')]),
  'canon.final_critic': text('canon.final_critic', 'Canon final critic', 'Approve or reject a repaired canonical event.', SETTLEMENT_PROMPTS.canon_final_critic, canon),
  'social.proposer': text('social.proposer', 'Social encounter proposal', 'Propose a bounded private social encounter.', SETTLEMENT_PROMPTS.social_encounter_proposer, social, [], [edge('social.proposer', 'social.critic')]),
  'social.critic': text('social.critic', 'Social encounter critic', 'Check a social encounter proposal.', SETTLEMENT_PROMPTS.social_encounter_critic, social, [], [edge('social.critic', 'social.repair', 'conditional')]),
  'social.repair': text('social.repair', 'Social encounter repair', 'Repair a social encounter proposal.', SETTLEMENT_PROMPTS.social_encounter_repair, social, [], [edge('social.repair', 'social.final_critic')]),
  'social.final_critic': text('social.final_critic', 'Social encounter final critic', 'Approve or reject a repaired social encounter.', SETTLEMENT_PROMPTS.social_encounter_final_critic, social),
  'procedural.proposer': text('procedural.proposer', 'Procedural world proposal', 'Propose one bounded procedural world command.', SETTLEMENT_PROMPTS.procedural_world_proposer, procedural, [], [edge('procedural.proposer', 'procedural.critic')]),
  'procedural.critic': text('procedural.critic', 'Procedural world critic', 'Check a procedural world proposal.', SETTLEMENT_PROMPTS.procedural_world_critic, procedural, [], [edge('procedural.critic', 'procedural.repair', 'conditional')]),
  'procedural.repair': text('procedural.repair', 'Procedural world repair', 'Repair a procedural world proposal.', SETTLEMENT_PROMPTS.procedural_world_repair, procedural, [], [edge('procedural.repair', 'procedural.final_critic')]),
  'procedural.final_critic': text('procedural.final_critic', 'Procedural world final critic', 'Approve or reject a repaired procedural proposal.', SETTLEMENT_PROMPTS.procedural_world_final_critic, procedural),
  'image.community_portrait': image('image.community_portrait', 'Community portrait sprite', 'Render a private-reference NPC portrait.', portraitTemplate, portrait, ['portrait_context', 'identity_anchor_instruction']),
  'image.runtime_art': image('image.runtime_art', 'Runtime world art', 'Render public runtime world art.', runtimeArtTemplate, runtimeArt, ['public_appearance'])
};

if (Object.keys(PROMPT_MANIFEST).length !== PROMPT_KEYS.length) throw new Error('Prompt manifest must contain every closed prompt key.');
export const INITIAL_DIALOGUE_BOUNDARY = dialogueBoundary;
/**
 * The real expression worker appends this sentence after the locked base
 * prompt. Keeping it as a template value lets a prompt revision preserve the
 * private-reference rule without exposing a selected Neutral image itself.
 */
export function portraitIdentityAnchorInstruction(slot: 'neutral' | 'warm' | 'wary' | 'determined' | 'thoughtful' | 'stern' | string): string {
  const base = 'No environment, floor, furniture, frame, lettering, signature, watermark, interface, extra person, or baked contact shadow. The supplied private references define rendering quality only. Do not reproduce their identity, face, body, hair, clothing, accessories, or pose. Do not default to sexualized framing, exposure, or a body type.';
  return slot === 'neutral' ? base : `${base}\nThe final supplied image is this NPC’s approved Neutral identity anchor. Preserve the same person and recognizable silhouette while expressing only the requested slot; do not copy the private style references.`;
}

/** Code-owned graph edges include deterministic validation and persistence nodes. */
export const PROMPT_WORKFLOW_EDGES: readonly PromptWorkflowEdge[] = [
  ...Object.values(PROMPT_MANIFEST).flatMap((entry) => entry.workflowEdges),
  edge('dialogue.investigate', 'dialogue.investigate', 'retry'), edge('dialogue.speak', 'dialogue.speak', 'retry'), edge('dialogue.review', 'dialogue.review', 'retry'),
  edge('dialogue.speak', 'dialogue.validate'), edge('dialogue.validate', 'dialogue.review'), edge('dialogue.validate', 'dialogue.commit', 'conditional'), edge('dialogue.review', 'dialogue.fallback', 'conditional'), edge('dialogue.remember', 'dialogue.commit', 'conditional'),
  edge('authoring.reserve', 'authoring.assist', 'conditional'), edge('authoring.reserve', 'authoring.sandbox', 'conditional'), edge('authoring.assist', 'authoring.commit'), edge('authoring.sandbox', 'authoring.commit'),
  edge('settlement.validate', 'resident.proposer', 'conditional'), edge('settlement.validate', 'canon.proposer', 'conditional'), edge('settlement.validate', 'social.proposer', 'conditional'), edge('settlement.validate', 'procedural.proposer', 'conditional'), edge('resident.digest', 'settlement.commit'), edge('canon.final_critic', 'settlement.commit'), edge('social.final_critic', 'settlement.commit'), edge('procedural.final_critic', 'settlement.commit'), edge('settlement.validate', 'settlement.fallback', 'conditional'),
  edge('portrait.reserve', 'image.community_portrait'), edge('image.community_portrait', 'portrait.validate'), edge('portrait.validate', 'portrait.storage'), edge('portrait.storage', 'portrait.commit'),
  edge('runtime_art.reserve', 'image.runtime_art'), edge('image.runtime_art', 'runtime_art.validate'), edge('runtime_art.validate', 'runtime_art.storage'), edge('runtime_art.storage', 'runtime_art.commit')
];
