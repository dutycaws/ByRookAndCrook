import type { ProviderResult, ProviderStage, SettlementProvider } from '../../src/lib/server/evolving-world/settlement-contracts';

export function fixtureProvider(outputs: Partial<Record<ProviderStage, unknown>>): SettlementProvider & { calls: ProviderStage[] } {
  const calls: ProviderStage[] = [];
  return { calls, async generate(stage) {
    calls.push(stage); const value = outputs[stage];
    if (value instanceof Error) throw value;
    return { value, model:'fixture-model', usage:{input:1,output:1}, durationMs:1, promptVersion:'fixture-v1' } as ProviderResult;
  } };
}
