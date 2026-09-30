import { PROMPT_MANIFEST } from './manifest';
import type { PromptKey, PromptManifestEntry, PromptReleaseSnapshot, PromptSnapshot } from './contracts';
import { renderPromptTemplate, sha256Hex } from './template';

export * from './contracts';
export * from './template';
export { PROMPT_MANIFEST, PROMPT_WORKFLOW_EDGES, portraitIdentityAnchorInstruction } from './manifest';
export { releasePrompt, releaseTextPrompt, releaseImagePrompt, DIALOGUE_PROMPT_KEY, SETTLEMENT_PROMPT_KEY } from './runtime';

export function promptManifestEntry(key: PromptKey): PromptManifestEntry { return PROMPT_MANIFEST[key]; }
export function renderRegisteredPrompt(key: PromptKey, body: string, values: Readonly<Record<string, string>> = {}): string {
  return renderPromptTemplate(PROMPT_MANIFEST[key], body, values);
}

/** Builds the immutable release-1 source snapshot before persistence exists. */
export function initialPromptSnapshot(key: PromptKey, releaseId = 'release-1', createdAt = '1970-01-01T00:00:00.000Z', createdBy = 'system'): PromptSnapshot {
  const entry = PROMPT_MANIFEST[key];
  const contentHash = sha256Hex(entry.initialBody);
  return { releaseId, revisionId: `${releaseId}:${key}:1`, key, revision: 1, promptType: entry.callType, body: entry.initialBody, contentHash, bodyHash: contentHash, contractId: entry.contract.id, contractHash: entry.contract.hash, modelLane: entry.contract.modelLane, createdAt, createdBy };
}
export function initialPromptReleaseSnapshot(createdAt = '1970-01-01T00:00:00.000Z', createdBy = 'system'): PromptReleaseSnapshot {
  const releaseId = 'release-1';
  const prompts = Object.fromEntries(Object.keys(PROMPT_MANIFEST).map((key) => [key, initialPromptSnapshot(key as PromptKey, releaseId, createdAt, createdBy)])) as Record<PromptKey, PromptSnapshot>;
  return { releaseId: 'release-1', releaseNumber: 1, label: 'Initial code-equivalent release', createdAt, createdBy, prompts };
}
