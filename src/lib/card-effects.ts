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
