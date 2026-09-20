/**
 * Server-only contracts for the privileged prompt registry. Prompt managers
 * may edit approved template bodies, while the execution contract remains in
 * application code.
 */
export const PROMPT_KEYS = [
  'dialogue.investigate', 'dialogue.deliberate', 'dialogue.speak', 'dialogue.review', 'dialogue.remember',
  'authoring.assist', 'authoring.sandbox',
  'resident.proposer', 'resident.critic', 'resident.repair', 'resident.final_critic', 'resident.digest',
  'canon.proposer', 'canon.critic', 'canon.repair', 'canon.final_critic',
  'social.proposer', 'social.critic', 'social.repair', 'social.final_critic',
  'procedural.proposer', 'procedural.critic', 'procedural.repair', 'procedural.final_critic',
  'quest_transition.proposer', 'quest_transition.critic', 'quest_transition.repair', 'quest_transition.final_critic',
  'image.community_portrait', 'image.runtime_art'
] as const;

export type PromptKey = (typeof PROMPT_KEYS)[number];
/** Distinguishes a text system message from an Image API prompt template. */
export type PromptCallType = 'text_system' | 'image_template';
export type PromptModelLane = 'context' | 'character' | 'authoring' | 'world' | 'image_portrait' | 'image_runtime';
export type DynamicDataClassification = 'public' | 'private_server_only' | 'mixed_server_only';
export type PromptWorkflow = 'dialogue' | 'authoring' | 'resident_settlement' | 'canon_settlement' | 'social_settlement' | 'procedural_settlement' | 'quest_transition' | 'portrait_generation' | 'runtime_art';

/** Non-model nodes are code-owned and let the UI show validation/commit boundaries. */
export type PromptGraphNode = PromptKey | 'dialogue.validate' | 'dialogue.commit' | 'dialogue.fallback' | 'authoring.reserve' | 'authoring.commit' | 'settlement.validate' | 'settlement.commit' | 'settlement.fallback' | 'quest_transition.validate' | 'quest_transition.commit' | 'quest_transition.fallback' | 'portrait.reserve' | 'portrait.validate' | 'portrait.storage' | 'portrait.commit' | 'runtime_art.reserve' | 'runtime_art.validate' | 'runtime_art.storage' | 'runtime_art.commit';
export type PromptWorkflowEdge = Readonly<{ from: PromptGraphNode; to: PromptGraphNode; kind: 'always' | 'conditional' | 'retry' }>;
export type PromptContract = Readonly<{
  id: string;
  hash: string;
  responseSchema: string | null;
  toolNames: readonly string[];
  endpoint: 'responses' | 'images_edits' | 'images_generations';
  modelLane: PromptModelLane;
  dynamicData: DynamicDataClassification;
  workflow: PromptWorkflow;
}>;

export type PromptManifestEntry = Readonly<{
  key: PromptKey;
  name: string;
  purpose: string;
  callType: PromptCallType;
  contract: PromptContract;
  templateVariables: readonly string[];
  initialBody: string;
  workflowEdges: readonly PromptWorkflowEdge[];
}>;

/** Immutable content and provenance used by one registry release. */
export type PromptSnapshot = Readonly<{
  releaseId: string;
  revisionId: string;
  key: PromptKey;
  revision: number;
  promptType: PromptCallType;
  body: string;
  contentHash: string;
  /** Compatibility alias retained while database callers move to contentHash. */
  bodyHash: string;
  contractId: string;
  contractHash: string;
  modelLane: PromptModelLane;
  createdAt: string;
  createdBy: string;
}>;

/** A release is a complete, immutable mapping from every code-owned key. */
export type PromptReleaseSnapshot = Readonly<{
  releaseId: string;
  releaseNumber: number;
  label: string;
  createdAt: string;
  createdBy: string;
  prompts: Readonly<Record<PromptKey, PromptSnapshot>>;
}>;

export class PromptTemplateError extends Error {
  constructor(public readonly code: 'too_large' | 'unknown_variable' | 'missing_variable' | 'duplicate_required_variable' | 'invalid_value', message: string) {
    super(message);
    this.name = 'PromptTemplateError';
  }
}
