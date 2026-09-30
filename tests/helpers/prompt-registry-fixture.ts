import { initialPromptReleaseSnapshot, type PromptReleaseSnapshot } from '$lib/server/prompt-registry';
import type { PromptRegistryService } from '$lib/server/prompt-registry/service';

export const fixturePromptRelease = initialPromptReleaseSnapshot('2026-09-16T00:00:00.000Z', 'fixture');

export function fixturePromptRegistry(options: {
  release?: PromptReleaseSnapshot;
  onResolve?: (kind: string, workId: string) => void;
} = {}): PromptRegistryService {
  return {
    async resolveForWork(kind: string, workId: string) {
      options.onResolve?.(kind, workId);
      return options.release ?? fixturePromptRelease;
    },
    async recordSafeRun() { /* The unit fixture has no durable execution ledger. */ }
  } as unknown as PromptRegistryService;
}
