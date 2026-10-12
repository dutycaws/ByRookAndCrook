/** Game-owned trinket effects. Author sheets may select an entry, never a strength. */
export const TRINKET_EFFECT_CATALOG = {
  food_revenue: { kind: 'food_revenue', bonusBasisPoints: 500, label: 'Food sales earn 5% more gold.' },
  drink_revenue: { kind: 'drink_revenue', bonusBasisPoints: 500, label: 'Drink sales earn 5% more gold.' },
  harvest_quality: { kind: 'harvest_quality', bonusQuality: 1, label: 'Harvested ingredients gain 1 quality.' }
} as const;

export type TrinketCatalogId = keyof typeof TRINKET_EFFECT_CATALOG;
export type TrinketEffectKind = (typeof TRINKET_EFFECT_CATALOG)[TrinketCatalogId]['kind'];
export type TrinketSlot = 0 | 1 | 2 | 3;

/** Only these reviewed assets can be referenced by community or first-party authoring. */
export const TRINKET_ARTWORK = {
  'copper-leaf': { src: '/images/trinkets/copper-leaf.svg', alt: 'A small copper leaf charm' },
  'brass-seal': { src: '/images/trinkets/brass-seal.svg', alt: 'A brass seal stamped with a balanced scale' },
  'seed-glass': { src: '/images/trinkets/seed-glass.svg', alt: 'A glass charm holding a tiny green seed' }
} as const;

export type SupportedTrinketArtworkId = keyof typeof TRINKET_ARTWORK;

export interface NpcInitialQuestTrinket {
  catalogId: TrinketCatalogId;
  artworkId: SupportedTrinketArtworkId;
  name: string;
  dedication: string;
}

/** Durable instance returned by the server, with its authored source and current slot. */
export interface OwnedTrinket extends NpcInitialQuestTrinket {
  id: string;
  sourceNpcId: string;
  sourceMilestoneId: string;
  slot: TrinketSlot | null;
  earnedAt: string;
}

export interface ActiveTrinketTotals {
  foodRevenueBasisPoints: number;
  drinkRevenueBasisPoints: number;
  harvestQuality: number;
}

export function activeTrinketTotals(items: readonly Pick<OwnedTrinket, 'catalogId' | 'slot'>[]): ActiveTrinketTotals {
  const totals: ActiveTrinketTotals = { foodRevenueBasisPoints: 0, drinkRevenueBasisPoints: 0, harvestQuality: 0 };
  for (const item of items) {
    if (item.slot === null) continue;
    const effect = TRINKET_EFFECT_CATALOG[item.catalogId];
    if (effect.kind === 'food_revenue') totals.foodRevenueBasisPoints += effect.bonusBasisPoints;
    else if (effect.kind === 'drink_revenue') totals.drinkRevenueBasisPoints += effect.bonusBasisPoints;
    else totals.harvestQuality += effect.bonusQuality;
  }
  return totals;
}

/** Apply summed revenue bonuses once, rounding the combined base result once. */
export function trinketAdjustedRevenue(baseGold: number, kind: 'food' | 'drink', items: readonly Pick<OwnedTrinket, 'catalogId' | 'slot'>[]): number {
  if (!Number.isFinite(baseGold) || baseGold < 0) throw new RangeError('Base revenue must be a non-negative finite number.');
  const totals = activeTrinketTotals(items);
  const basisPoints = kind === 'food' ? totals.foodRevenueBasisPoints : totals.drinkRevenueBasisPoints;
  return Math.round(baseGold * (10_000 + basisPoints) / 10_000);
}

/** Harvest bonuses are additive and respect the existing zero-through-six range. */
export function trinketAdjustedHarvestQuality(baseQuality: number, items: readonly Pick<OwnedTrinket, 'catalogId' | 'slot'>[]): number {
  if (!Number.isFinite(baseQuality)) throw new RangeError('Base quality must be finite.');
  return Math.max(0, Math.min(6, Math.round(baseQuality) + activeTrinketTotals(items).harvestQuality));
}
