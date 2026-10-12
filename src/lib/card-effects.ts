export type BurnTreatment = 'crawl' | 'drip' | 'ash';
export type BurnStyle = BurnTreatment | 'random';

export const DEFAULT_BURN_TREATMENT: BurnTreatment = 'drip';
export const DEFAULT_BURN_STYLE: BurnStyle = DEFAULT_BURN_TREATMENT;
export const BURN_TREATMENTS = [
  { value: 'crawl', name: 'Crawl', durationMs: 700, preview: '0.7s' },
  { value: 'drip', name: 'Drip', durationMs: 1000, preview: '1.0s' },
  { value: 'ash', name: 'Ash', durationMs: 1300, preview: '1.3s' }
] as const satisfies readonly { value: BurnTreatment; name: string; durationMs: number; preview: string }[];

export function resolveBurnStyle(value: unknown): BurnStyle | null {
  return value === 'crawl' || value === 'drip' || value === 'ash' || value === 'random' ? value : null;
}

export function profileBurnStyle(metadata: Record<string, unknown> | null | undefined): BurnStyle {
  return resolveBurnStyle(metadata?.card_burn_style) ?? DEFAULT_BURN_STYLE;
}


export type ResolvedBurnAction = {
  treatment: BurnTreatment;
  durationMs: number;
};

/** Resolve a persisted burn preference once when an action begins. */
export function resolveBurnAction(style: BurnStyle): ResolvedBurnAction {
  const treatment = style === 'random'
    ? BURN_TREATMENTS[Math.floor(Math.random() * BURN_TREATMENTS.length)].value
    : style;
  const durationMs = BURN_TREATMENTS.find((option) => option.value === treatment)?.durationMs ?? 1000;
  return { treatment, durationMs };
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Wait for a burn animation to finish.
 * Returns false when cancelled and true when the duration completes or motion is reduced.
 */
export function waitForBurn(durationMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (prefersReducedMotion() || !Number.isFinite(durationMs) || durationMs <= 0) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      finish(false);
      return;
    }
    timeout = setTimeout(() => finish(true), durationMs);
  });
}
