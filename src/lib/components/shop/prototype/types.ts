import type { ShopItem } from '$lib/game/contracts';
import type { SceneRuntimeAsset } from '$lib/components/scene/ComposedScene.svelte';

export type ShopVariant = 'A' | 'B' | 'C';
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
  onCategory: (category: ShopCategoryKey, triggerId: string) => void;
  onEntry: (entry: ShopEntry, triggerId: string) => void;
  onBack: () => void;
  onBuy: () => void;
};
