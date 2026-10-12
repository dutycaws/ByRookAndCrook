/** Cost-relevant usage reported by text Responses providers. */
export type TextProviderUsage = {
  input: number;
  output: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Preserve each independently valid cache field even when its partner is absent. */
export function parseTextProviderUsage(value: unknown): TextProviderUsage {
  const usage = object(value) ? value : {};
  const input = nonNegativeInteger(usage.input_tokens) ? usage.input_tokens : 0;
  const output = nonNegativeInteger(usage.output_tokens) ? usage.output_tokens : 0;
  const details = object(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const cachedInputTokens = nonNegativeInteger(details.cached_tokens) && details.cached_tokens <= input
    ? details.cached_tokens : undefined;
  const cacheWriteInputTokens = nonNegativeInteger(details.cache_write_tokens) && details.cache_write_tokens <= input
    ? details.cache_write_tokens : undefined;
  return {
    input,
    output,
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens } : {})
  };
}
