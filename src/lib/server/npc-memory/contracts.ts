/** Server-only contract for the durable, derived NPC-memory outbox. */
export type NpcMemoryProcessorKind = 'extract' | 'summary' | 'embedding';
export type NpcMemoryArtifactKind = 'episode_summary' | 'quest_summary' | 'embedding';

export type NpcMemoryClaim = Readonly<{
  id: string;
  fence: string;
  saveId: string;
  instanceId: string;
  sourceKind: 'dialogue_turn' | 'quest_event' | 'hospitality' | 'resident_evolution' | 'memory_set';
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
  sourceKind?: 'dialogue_turn' | 'quest_event' | 'hospitality' | 'resident_evolution' | 'memory_set';
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

export type NpcMemorySummaryV2Provider = {
  preflight(input: { systemPrompt: string; payload: Record<string, unknown>; model: string; maxSummaryChars: number; maxCitations: number; maxBytes: number; signal: AbortSignal }): Promise<{ prepared: NpcMemorySummaryV2Prepared; inputTokens: number; durationMs: number }>;
  generate(input: { prepared: NpcMemorySummaryV2Prepared; signal: AbortSignal }): Promise<{ result: Record<string, unknown>; model: string; providerRequestId?: string; inputTokens: number; outputTokens: number; durationMs: number }>;
};
export type NpcMemorySummaryV2Prepared = Readonly<{ body: Record<string, unknown>; model: string; inputTokens: number; maxSummaryChars: number; maxCitations: number }>;
export type NpcMemoryEmbeddingPrepared = Readonly<{ body: Readonly<{ model: string; input: string; dimensions: number; encoding_format: 'float' }> }>;
export type NpcMemoryEmbeddingProvider = {
  preflight(input: { inputText: string; model: string; dimensions: number }): NpcMemoryEmbeddingPrepared;
  embed(prepared: NpcMemoryEmbeddingPrepared, signal: AbortSignal): Promise<{ vector: string; model: string; dimensions: number; providerRequestId: string; promptTokens: number; totalTokens: number }>;
};
