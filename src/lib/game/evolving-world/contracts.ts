export const EVOLVING_WORLD_RULES_VERSION = 'evolving-world-v1' as const;
export const PERSONALITY_SCHEMA_VERSION = 'personality-schema-v1' as const;

export const SALIENCE_BANDS = ['minor', 'meaningful', 'major', 'defining'] as const;
export type SalienceBand = (typeof SALIENCE_BANDS)[number];

export const PROFILE_ENTRY_KINDS = [
  'value',
  'boundary',
  'belief',
  'motive',
  'fear',
  'coping_pattern',
  'voice_trait'
] as const;
export type ProfileEntryKind = (typeof PROFILE_ENTRY_KINDS)[number];

export const WORLD_ENTITY_KINDS = ['npc', 'location', 'faction', 'item', 'recipe', 'world_event'] as const;
export type WorldEntityKind = (typeof WORLD_ENTITY_KINDS)[number];

export const SOCIAL_AXES = ['trust', 'affection', 'respect', 'fear', 'obligation'] as const;
export type SocialAxis = (typeof SOCIAL_AXES)[number];

export interface PersonalityDimensionDefinition {
  key: string;
  label: string;
  negativeAnchor: string;
  positiveAnchor: string;
  initialValue: number;
  volatility: number;
  ordinaryChangeThreshold?: number;
  definingRuptureThreshold?: number;
  core: boolean;
}

export interface ProfileCollectionDefinition {
  kind: ProfileEntryKind;
  maximumEntries: number;
}

export interface PersonalitySchema {
  version: typeof PERSONALITY_SCHEMA_VERSION;
  dimensions: PersonalityDimensionDefinition[];
  collections: ProfileCollectionDefinition[];
}

export interface ProfileEntry {
  id: string;
  kind: ProfileEntryKind;
  text: string;
  core: boolean;
  active: boolean;
}

export interface PersonalityProfile {
  dimensions: Record<string, number>;
  entries: ProfileEntry[];
}

export type SocialCapability = 'conceal' | 'misdirect' | 'deceive' | 'share_gossip';

export type WorldEffectKind =
  | 'adjust_relationship'
  | 'create_quest'
  | 'update_quest'
  | 'create_entity'
  | 'retire_entity'
  | 'record_world_event'
  | 'apply_location_modifier'
  | 'transfer_inventory'
  | 'unlock_recipe'
  | 'apply_economy_modifier'
  | 'set_availability';

export interface CapabilityEnvelope {
  version: string;
  allowedActions: string[];
  allowedApproaches: string[];
  allowedWorldEffects: WorldEffectKind[];
  allowedTargetKinds: WorldEntityKind[];
  socialCapabilities: SocialCapability[];
  irreversibleEffects: Array<{
    effectKey: string;
    targetKinds: WorldEntityKind[];
  }>;
}

export interface AppearanceSpecification {
  version: string;
  physicalIdentity: string;
  silhouette: string;
  attire: string;
  distinguishingFeatures: string[];
  palette: string[];
  renderingTemplateKey: string;
}

export interface DeepNpcEvolutionDefinition {
  personalitySchema: PersonalitySchema;
  initialProfile: PersonalityProfile;
  capabilityEnvelope: CapabilityEnvelope;
  appearanceSpec: AppearanceSpecification;
}

export type EvolutionEvidenceKind =
  | 'dialogue'
  | 'quest_outcome'
  | 'world_event'
  | 'hospitality_reaction'
  | 'social_encounter'
  | 'gossip';

export interface EvolutionEvidenceReference {
  id: string;
  kind: EvolutionEvidenceKind;
  happenedOnDay: number;
  sequence: number;
  sourceFingerprint: string;
  salience: SalienceBand;
}

export interface DimensionPressureProposal {
  dimensionKey: string;
  direction: -1 | 1;
  intendedDelta: number;
}

export type ProfileEntryOperation =
  | { operation: 'add'; entry: ProfileEntry }
  | { operation: 'revise'; entryId: string; text: string }
  | { operation: 'retract'; entryId: string };

/**
 * Beliefs are attributed NPC knowledge, never world canon. Database IDs are deliberately
 * absent from adds: the server assigns them only when it commits a validated operation.
 */
export type BeliefOperation =
  | {
      operation: 'add';
      subjectEntityId: string;
      content: string;
      confidence: number;
      provenance: BeliefProvenanceLink[];
      originalClaimFingerprint: string;
    }
  | {
      operation: 'retract';
      beliefId: string;
      reason: string;
      sourceFingerprint: string;
    };

export type WorldEffectCommand =
  | {
      kind: 'adjust_relationship';
      subjectNpcId: string;
      objectEntityId: string;
      axis: SocialAxis;
      delta: number;
    }
  | { kind: 'create_quest'; ownerNpcId: string; templateKey: string; targetEntityIds: string[] }
  | { kind: 'update_quest'; questId: string; action: string; approach?: string; targetEntityIds?: string[] }
  | { kind: 'create_entity'; entityKind: WorldEntityKind; archetypeKey: string; proposedName: string; payload: unknown }
  | { kind: 'retire_entity'; entityId: string; reason: string; irreversibleEffectKey?: string }
  | { kind: 'record_world_event'; templateKey: string; participantEntityIds: string[]; payload: unknown }
  | { kind: 'apply_location_modifier'; locationId: string; modifierKey: string; magnitude: number; durationDays: number }
  | { kind: 'transfer_inventory'; itemEntityId: string; fromEntityId: string; toEntityId: string; quantity: number }
  | { kind: 'unlock_recipe'; recipeEntityId: string }
  | { kind: 'apply_economy_modifier'; modifierKey: string; magnitude: number; durationDays: number }
  | { kind: 'set_availability'; npcId: string; available: boolean; reason: string };

export interface PersonalityMutationProposal {
  rulesVersion: typeof EVOLVING_WORLD_RULES_VERSION;
  evidenceIds: string[];
  salience: SalienceBand;
  dimensionChanges: DimensionPressureProposal[];
  entryOperations: ProfileEntryOperation[];
  beliefOperations: BeliefOperation[];
  causalExplanation: string;
  questChanges: Array<{ questId: string; action: string; motivation: string }>;
  worldEffects: WorldEffectCommand[];
}

export type CriticDecision =
  | { outcome: 'accept'; rationale: string }
  | { outcome: 'reject'; rationale: string }
  | { outcome: 'repair'; rationale: string; instructions: string[] };

export interface DirectedSocialEdge {
  subjectNpcId: string;
  objectEntityId: string;
  axes: Record<SocialAxis, number>;
}

export interface BeliefProvenanceLink {
  sourceKind: 'direct_evidence' | 'dialogue_claim' | 'gossip' | 'inference';
  sourceId: string;
  speakerNpcId?: string;
}

export interface NpcBelief {
  id: string;
  subjectEntityId: string;
  content: string;
  confidence: number;
  provenance: BeliefProvenanceLink[];
  originalClaimFingerprint: string;
  contradictionStatus: 'uncontested' | 'contested' | 'contradicted';
  state: 'active' | 'retracted';
}

export interface DimensionMutationReceipt {
  dimensionKey: string;
  pressureBefore: number;
  pressureAdded: number;
  pressureAfterApproval: number;
  threshold: number;
  crossedThreshold: boolean;
  pressureAfterCommit: number;
  intendedDelta: number;
  appliedDelta: number;
  valueBefore: number;
  valueAfter: number;
}

export interface MutationReceipt {
  rulesVersion: typeof EVOLVING_WORLD_RULES_VERSION;
  outcome: 'pressure_only' | 'roll_failed' | 'changed';
  chancePercent: number | null;
  roll: number | null;
  dimensions: DimensionMutationReceipt[];
  /** Indexes of profile-entry operations authorized by this exact threshold/roll result. */
  appliedEntryOperationIndexes: number[];
}

export interface ContractIssue {
  path: string;
  code: string;
  message: string;
}

export interface WorldValidationSnapshot {
  currentDay: number;
  entityKinds: Record<string, WorldEntityKind>;
  activeQuestIds: string[];
  authorizedIrreversibleEffects: Array<{
    effectKey: string;
    targetEntityId: string;
    criticApproved: boolean;
    visibleSinceDay: number;
  }>;
}
