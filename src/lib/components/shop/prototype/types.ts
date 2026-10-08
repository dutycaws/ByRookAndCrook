import type { ShopItem } from '$lib/game/contracts';
import type { SceneRuntimeAsset } from '$lib/components/scene/ComposedScene.svelte';

export type ShopVariant = 'A' | 'B' | 'C';
export type BurnTreatment = 'crawl' | 'drip' | 'ash';
export const DEFAULT_BURN_TREATMENT: BurnTreatment = 'drip';
export const BURN_TREATMENTS = [
  { value: 'crawl', name: 'Crawl', durationMs: 700, fanPaddingRem: 3.5, preview: '0.7s · snug' },
  { value: 'drip', name: 'Drip', durationMs: 1000, fanPaddingRem: 3.8, preview: '1.0s · generous' },
  { value: 'ash', name: 'Ash', durationMs: 1300, fanPaddingRem: 4.2, preview: '1.3s · airy' }
] as const satisfies readonly { value: BurnTreatment; name: string; durationMs: number; fanPaddingRem: number; preview: string }[];
export type ShopCategoryKey = 'seeds' | 'garden' | 'apiary';
export type ShopStage = 'categories' | 'items' | 'preview' | 'result';

export type ShopCategory = {
  key: ShopCategoryKey;
  label: string;
  icon: string;
  description: string;
  count: number;
};

export type ShopEntry = {
  key: string;
  category: ShopCategoryKey;
  kind: 'good' | 'expansion';
  name: string;
  icon: string;
  art: string | null;
  price: number;
  stock: number;
  description: string;
  item?: ShopItem;
  plotCount?: 16 | 24;
};

export type PrototypeModel = {
  variant: ShopVariant;
  burnTreatment: BurnTreatment;
  stage: ShopStage;
  categories: ShopCategory[];
  category: ShopCategory;
  entries: ShopEntry[];
  selectedEntry: ShopEntry | null;
  selectedCategory: ShopCategoryKey;
  assets: Record<string, SceneRuntimeAsset | undefined>;
  gold: number;
  affordable: boolean;
  stock: number;
  plotCount: number;
  announcement: string;
  result: string | null;
  burningCategory: ShopCategoryKey | null;
  leavingCategory: ShopCategory | null;
  onBurnComplete: (category: ShopCategoryKey) => void;
  onCategory: (category: ShopCategoryKey, triggerId: string) => void;
  onEntry: (entry: ShopEntry, triggerId: string) => void;
  onBack: () => void;
  onBuy: () => void;
};
