/** Server-only contract for the durable, derived NPC-memory outbox. */
export type NpcMemoryProcessorKind = 'extract' | 'summary' | 'embedding';
export type NpcMemoryArtifactKind = 'episode_summary' | 'quest_summary' | 'embedding';

export type NpcMemoryClaim = Readonly<{
  id: string;
  fence: string;
  saveId: string;
  instanceId: string;
  sourceKind: 'dialogue_turn' | 'quest_event';
  sourceId: string;
  sourceVersion: number;
  sourceHash: string;
}>;

export type NpcMemorySource = Readonly<{
  /** Verbatim, authorized source text; it is never treated as instructions. */
  records: readonly Readonly<{ id: string; speaker: string; text: string; quote?: string }>[];
  disclosureClass?: 'player_visible' | 'npc_known' | 'npc_private' | 'system';
  acceptedMemories?: readonly unknown[];
}>;

export type NpcMemoryArtifact = Readonly<{
  artifactKind: NpcMemoryArtifactKind;
  sourceKind?: 'dialogue_turn' | 'quest_event' | 'memory_set';
  model?: string;
  contractHash?: string;
  disclosureClass?: 'player_visible' | 'npc_known' | 'npc_private' | 'system';
  content: Record<string, unknown>;
  contentHash: string;
  embedding?: string;
  embeddingDimensions?: number;
}>;

export type NpcMemoryWorkerClient = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
};

export type NpcMemoryOutcome =
  | { status: 'idle' }
  | { status: 'completed'; artifacts: number; fallback: boolean }
  | { status: 'lease_lost' }
  | { status: 'failed'; errorCode: string };
