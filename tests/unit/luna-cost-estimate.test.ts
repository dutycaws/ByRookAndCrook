import { describe, expect, it } from 'vitest';
import { estimateLunaCost } from '$lib/server/dialogue/luna-cost-estimate';

describe('Luna cost estimate', () => {
  it('uses ordinary, cached, and cache-write rates when both details are reported', () => {
    expect(estimateLunaCost({ input: 1_000, output: 100, cachedInputTokens: 200, cacheWriteInputTokens: 300 }))
      .toEqual({ amountUsd: 0.0001395, inputPricingAssumption: 'reported-cache-breakdown' });
  });

  it('prices input without a cache-write count conservatively when only cached input is known', () => {
    expect(estimateLunaCost({ input: 1_000, output: 100, cachedInputTokens: 200 }))
      .toEqual({ amountUsd: 0.000152, inputPricingAssumption: 'unclassified-input-at-cache-write-rate' });
  });

  it('prices unclassified input conservatively when only cache-write input is known', () => {
    expect(estimateLunaCost({ input: 1_000, output: 100, cacheWriteInputTokens: 300 }))
      .toEqual({ amountUsd: 0.000175, inputPricingAssumption: 'unclassified-input-at-cache-write-rate' });
  });

  it('prices all input conservatively when cache usage details are absent', () => {
    expect(estimateLunaCost({ input: 1_000, output: 100 }))
      .toEqual({ amountUsd: 0.000175, inputPricingAssumption: 'unclassified-input-at-cache-write-rate' });
  });

  it('rejects invalid and internally inconsistent provider usage', () => {
    expect(estimateLunaCost({ input: -1, output: 0 })).toBeUndefined();
    expect(estimateLunaCost({ input: 100, output: 0, cachedInputTokens: 101 })).toBeUndefined();
    expect(estimateLunaCost({ input: 100, output: 0, cachedInputTokens: 60, cacheWriteInputTokens: 41 })).toBeUndefined();
  });
});
