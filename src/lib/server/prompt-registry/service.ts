import { PROMPT_KEYS, type PromptKey, type PromptReleaseSnapshot, type PromptSnapshot } from './contracts';
import { PROMPT_MANIFEST } from './manifest';
import { sha256Hex } from './template';

type RpcResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
export type PromptRegistryClient = { rpc(name: string, args?: Record<string, unknown>): RpcResult<unknown> };

type RawPrompt = { revisionId: string; revision: number; body: string; contentHash: string; contractId: string; contractHash: string; promptType: PromptSnapshot['promptType']; modelLane: PromptSnapshot['modelLane']; workflow: string };
type RawRelease = { releaseId: string; releaseNumber: number; label: string; prompts: Record<string, RawPrompt> };

/** Server-only resolver. A missing or malformed release is an operational error
 * before any provider call, rather than a fallback to unpinned prompt content. */
export class PromptRegistryService {
  constructor(private readonly client: PromptRegistryClient) {}

  async resolve(releaseId?: string): Promise<PromptReleaseSnapshot> {
    const result = await this.client.rpc('prompt_registry_service_resolve', { p_release_id: releaseId ?? null });
    if (result.error || !result.data) throw new Error(result.error?.message ?? 'Prompt release unavailable');
    const raw = result.data as RawRelease;
    if (!raw.releaseId || !raw.prompts || typeof raw.prompts !== 'object') throw new Error('Prompt release response is malformed');
    if (Object.keys(raw.prompts).length !== PROMPT_KEYS.length || PROMPT_KEYS.some((key) => !(key in raw.prompts))) throw new Error('Prompt release is incomplete');
    const prompts = Object.fromEntries(Object.entries(raw.prompts).map(([key, value]) => {
      if (!(key in PROMPT_MANIFEST)) throw new Error(`Prompt ${key} is not registered`);
      if (!value || !value.revisionId || !value.contentHash || !value.contractId || !value.contractHash || typeof value.body !== 'string') throw new Error(`Prompt ${key} is malformed`);
      if (sha256Hex(value.body) !== value.contentHash) throw new Error(`Prompt ${key} content hash is invalid`);
      const manifest = PROMPT_MANIFEST[key as PromptKey];
      if (value.contractId !== manifest.contract.id || value.contractHash !== manifest.contract.hash || value.promptType !== manifest.callType || value.modelLane !== manifest.contract.modelLane) throw new Error(`Prompt ${key} contract does not match the application manifest`);
      const snapshot: PromptSnapshot = { releaseId: raw.releaseId, revisionId: value.revisionId, key: key as PromptKey, revision: value.revision, promptType: value.promptType, body: value.body, contentHash: value.contentHash, bodyHash: value.contentHash, contractId: value.contractId, contractHash: value.contractHash, modelLane: value.modelLane, createdAt: '', createdBy: 'registry' };
      return [key, snapshot];
    })) as PromptReleaseSnapshot['prompts'];
    return { releaseId: raw.releaseId, releaseNumber: raw.releaseNumber, label: raw.label, createdAt: '', createdBy: 'registry', prompts };
  }

  /** Resolves the release persisted beside durable work; it never consults the
   * mutable active pointer.  Call this before every provider dispatch. */
  async resolveForWork(kind: 'dialogue' | 'settlement' | 'quest_transition' | 'authoring' | 'portrait' | 'runtime_art', workId: string): Promise<PromptReleaseSnapshot> {
    const result = await this.client.rpc('prompt_registry_service_work_release', { p_work_kind: kind, p_work_id: workId });
    if (result.error || typeof result.data !== 'string') throw new Error(result.error?.message ?? 'Prompt release was not pinned for this work');
    return this.resolve(result.data);
  }

  async recordSafeRun(input: { executionId: string; attempt?: number; workflow: string; nodeKey: string; prompt: PromptSnapshot; status: 'started' | 'completed' | 'failed' | 'reused' | 'skipped'; model?: string; durationMs?: number; inputTokens?: number; outputTokens?: number; errorCode?: string }): Promise<void> {
    const result = await this.client.rpc('prompt_registry_service_record_run', {
      p_execution_id: input.executionId, p_attempt: input.attempt ?? 0, p_workflow: input.workflow, p_node_key: input.nodeKey, p_prompt_key: input.prompt.key,
      p_release_id: input.prompt.releaseId, p_revision_id: input.prompt.revisionId, p_status: input.status,
      p_model: input.model ?? null, p_duration_ms: input.durationMs ?? null, p_input_tokens: input.inputTokens ?? null,
      p_output_tokens: input.outputTokens ?? null, p_error_code: input.errorCode ?? null
    });
    if (result.error) throw new Error(result.error.message);
  }
}

export function promptRegistryService(client: PromptRegistryClient): PromptRegistryService { return new PromptRegistryService(client); }
