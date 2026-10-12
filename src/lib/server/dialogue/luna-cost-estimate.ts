export const LUNA_USAGE_COST_RATES = {
  inputUsdPerMillion: 0.1,
  cachedInputUsdPerMillion: 0.01,
  cacheWriteUsdPerMillion: 0.125,
  outputUsdPerMillion: 0.5
} as const;

export interface LunaUsageForEstimate {
  input: number;
  output: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
}

export interface LunaCostEstimate {
  amountUsd: number;
  inputPricingAssumption: 'reported-cache-breakdown' | 'unclassified-input-at-cache-write-rate';
}

/** Estimate standard-rate Luna generation cost, pricing unknown input conservatively. */
export function estimateLunaCost(usage: LunaUsageForEstimate): LunaCostEstimate | undefined {
  const { input, output, cachedInputTokens, cacheWriteInputTokens } = usage;
  if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) return undefined;
  if (cachedInputTokens !== undefined && (!Number.isSafeInteger(cachedInputTokens) || cachedInputTokens < 0)) return undefined;
  if (cacheWriteInputTokens !== undefined && (!Number.isSafeInteger(cacheWriteInputTokens) || cacheWriteInputTokens < 0)) return undefined;

  const cached = cachedInputTokens ?? 0;
  const cacheWrite = cacheWriteInputTokens ?? 0;
  if (cached + cacheWrite > input) return undefined;

  const hasCompleteBreakdown = cachedInputTokens !== undefined && cacheWriteInputTokens !== undefined;
  const ordinaryInput = hasCompleteBreakdown ? input - cached - cacheWrite : 0;
  const assumedCacheWrite = hasCompleteBreakdown ? cacheWrite : input - cached;
  const rates = LUNA_USAGE_COST_RATES;
  const amountUsd = (ordinaryInput * rates.inputUsdPerMillion
    + cached * rates.cachedInputUsdPerMillion
    + assumedCacheWrite * rates.cacheWriteUsdPerMillion
    + output * rates.outputUsdPerMillion) / 1_000_000;
  return {
    amountUsd,
    inputPricingAssumption: hasCompleteBreakdown ? 'reported-cache-breakdown' : 'unclassified-input-at-cache-write-rate'
  };
}
