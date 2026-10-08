import type { ShopItem } from '$lib/game/contracts';
import type { SceneRuntimeAsset } from '$lib/components/scene/ComposedScene.svelte';

export type ShopVariant = 'A' | 'B' | 'C';
export type BurnTreatment = 'crawl' | 'drip' | 'ash';
export type BurnStyle = BurnTreatment | 'random';
export type ShopTransitionPhase = 'idle' | 'category-burn' | 'item-burn' | 'item-zoom' | 'order-burn';
export type PreviewBridgeTransform = { translateX: number; translateY: number; scaleX: number; scaleY: number };
export const DEFAULT_BURN_TREATMENT: BurnTreatment = 'drip';
export const DEFAULT_BURN_STYLE: BurnStyle = DEFAULT_BURN_TREATMENT;
export const BURN_TREATMENTS = [
  { value: 'crawl', name: 'Crawl', durationMs: 700, preview: '0.7s' },
  { value: 'drip', name: 'Drip', durationMs: 1000, preview: '1.0s' },
  { value: 'ash', name: 'Ash', durationMs: 1300, preview: '1.3s' }
] as const satisfies readonly { value: BurnTreatment; name: string; durationMs: number; preview: string }[];
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
  transitionPhase: ShopTransitionPhase;
  transitionKey: string | null;
  transitionSequence: number;
  burnedEntryKeys: string[];
  previewBridgeTransform: PreviewBridgeTransform | null;
  previewBridgeAnimating: boolean;
  previewBridgeMeasuring: boolean;
  onCategory: (category: ShopCategoryKey, triggerId: string) => void;
  onEntry: (entry: ShopEntry, triggerId: string) => void;
  onBack: () => void;
  onBuy: () => void;
};
