<script lang="ts">
  import { PUBLIC_SUPABASE_URL } from '$env/static/public';
  import { tick, untrack } from 'svelte';
  import type { GameSnapshot } from '$lib/game/contracts';
  import { shopItemAssetPublicUrl } from '$lib/game/shop-runtime-assets';
  import { sceneRuntimeAssetPublicUrl, type SceneRuntimeAssetId } from '$lib/game/scene-runtime-assets';
  import type { PrototypeModel, ShopCategoryKey, ShopCategory, ShopEntry, ShopStage, ShopVariant } from './types';
  import VariantA from './VariantA.svelte';
  import VariantB from './VariantB.svelte';
  import VariantC from './VariantC.svelte';

  type Props = { snapshot: GameSnapshot; variant: ShopVariant };
  let { snapshot, variant }: Props = $props();

  const definitions: Omit<ShopCategory, 'count'>[] = [
    { key: 'seeds', label: 'Seeds', icon: '✿', description: 'Start something growing.' },
    { key: 'garden', label: 'Garden care', icon: '❋', description: 'Feed the soil and make room.' },
    { key: 'apiary', label: 'Apiary', icon: '⌘', description: 'Tools and care for the bees.' }
  ];
  const sceneAsset = (id: SceneRuntimeAssetId) => sceneRuntimeAssetPublicUrl(id, PUBLIC_SUPABASE_URL);
  const assets = {
    'shop-background': { src: sceneAsset('shop-background'), alt: 'A warm garden shop counter' },
    'shop-elara': { src: sceneAsset('shop-elara'), alt: 'Elara Greenbloom at her garden shop counter' },
    'shop-counter-occlusion': { src: sceneAsset('shop-counter-occlusion'), alt: '' }
  };

  let stage = $state<ShopStage>('categories');
  let selectedCategory = $state<ShopCategoryKey>('seeds');
  let selectedKey = $state<string | null>(null);
  let mockGold = $state(untrack(() => snapshot.save.gold ?? 0));
  let mockPlotCount = $state(untrack(() => snapshot.garden?.plotCount ?? 12));
  let mockStocks = $state<Record<string, number>>({});
  let history = $state<Array<{ stage: ShopStage; focusId: string }>>([]);
  let announcement = $state('Choose a shop shelf.');
  let result = $state<string | null>(null);
  let burningCategory = $state<ShopCategoryKey | null>(null);
  let leavingCategory = $state<ShopCategory | null>(null);
  let burnTimer: ReturnType<typeof setTimeout> | undefined;

  const categories = $derived(definitions.map((category) => ({
    ...category,
    count: (snapshot.garden?.shop ?? []).filter((item) => itemCategory(item) === category.key).length + (category.key === 'garden' ? (snapshot.garden?.expansions.some((entry) => entry.available) ? 1 : 0) : 0)
  })));

  const catalog = $derived.by(() => {
    const entries: ShopEntry[] = (snapshot.garden?.shop ?? []).map((item) => ({
      key: item.itemKey,
      category: itemCategory(item),
      kind: 'good',
      name: item.name,
      icon: itemIcon(item.kind),
      art: shopItemAssetPublicUrl(item.itemKey, PUBLIC_SUPABASE_URL) ?? null,
      price: item.price,
      stock: item.remainingStock,
      description: item.guidance?.[0] ?? 'A useful addition for the garden and apiary.',
      item
    }));
    const expansion = snapshot.garden?.expansions.find((entry) => entry.available);
    if (expansion) {
      entries.push({
        key: `garden-expansion-${expansion.plotCount}`,
        category: 'garden',
        kind: 'expansion',
        name: `Garden expansion · ${expansion.plotCount} plots`,
        icon: '⌂',
        art: null,
        price: expansion.price,
        stock: 1,
        description: `Open the next ${expansion.plotCount - mockPlotCount} plots for new plantings.`,
        plotCount: expansion.plotCount
      });
    }
    return entries;
  });

  const currentCategory = $derived(categories.find((category) => category.key === selectedCategory) ?? categories[0]!);
  const entries = $derived(catalog.filter((entry) => entry.category === selectedCategory));
  const selectedEntry = $derived(catalog.find((entry) => entry.key === selectedKey) ?? null);
  const selectedStock = $derived(selectedEntry ? mockStocks[selectedEntry.key] ?? selectedEntry.stock : 0);
  const affordable = $derived(!!selectedEntry && selectedEntry.price <= mockGold && selectedStock > 0);

  function itemCategory(item: { kind: string }): ShopCategoryKey {
    if (item.kind === 'seed') return 'seeds';
    if (item.kind === 'amendment') return 'garden';
    return 'apiary';
  }

  function itemIcon(kind: string) {
    return ({ seed: '✿', amendment: '◒', equipment: '⌂', colony: '♚', feed: '❋', treatment: '✦' } as Record<string, string>)[kind] ?? '✧';
  }

  function pushHistory(focusId: string) {
    history.push({ stage, focusId });
  }

  function chooseCategory(key: ShopCategoryKey, triggerId: string) {
    pushHistory(triggerId);
    selectedCategory = key;
    selectedKey = null;
    result = null;
    stage = 'items';
    announcement = `${currentCategory.label}: ${entries.length} ${entries.length === 1 ? 'item' : 'items'}.`;
    leavingCategory = categories.find((category) => category.key === key) ?? null;
    burningCategory = variant === 'C' ? key : null;
    if (burnTimer) clearTimeout(burnTimer);
    burnTimer = setTimeout(() => {
      burningCategory = null;
      leavingCategory = null;
    }, 210);
    void tick().then(() => focusWithoutScroll(entries.length ? `shop-item-${safeId(entries[0].key)}` : 'prototype-back'));
  }

  function chooseEntry(entry: ShopEntry, triggerId: string) {
    pushHistory(triggerId);
    selectedKey = entry.key;
    result = null;
    stage = 'preview';
    announcement = `${entry.name} preview. ${entry.price} gold; ${mockStocks[entry.key] ?? entry.stock} in stock.`;
    void tick().then(() => focusWithoutScroll('shop-preview-title'));
  }

  function goBack() {
    const previous = history.pop();
    if (!previous) return;
    stage = previous.stage;
    if (previous.stage === 'categories') selectedKey = null;
    result = null;
    void tick().then(() => focusWithoutScroll(previous.focusId));
  }

  function makeMockOrder() {
    if (!selectedEntry || !affordable) return;
    pushHistory('shop-buy');
    mockGold -= selectedEntry.price;
    mockStocks[selectedEntry.key] = selectedStock - 1;
    if (selectedEntry.kind === 'expansion' && selectedEntry.plotCount) mockPlotCount = selectedEntry.plotCount;
    result = selectedEntry.kind === 'expansion'
      ? `Your mock garden now has ${mockPlotCount} plots. ${mockGold} gold remains.`
      : `${selectedEntry.name} added to your mock stock. ${mockGold} gold remains.`;
    stage = 'result';
    announcement = result;
    void tick().then(() => focusWithoutScroll('shop-result-title'));
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || stage === 'categories') return;
    event.preventDefault();
    goBack();
  }

  function safeId(value: string) {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  function focusWithoutScroll(id: string) {
    const target = document.getElementById(id);
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }

  const model: PrototypeModel = $derived({
    variant,
    stage,
    categories,
    category: currentCategory,
    entries,
    selectedEntry,
    selectedCategory,
    assets,
    gold: mockGold,
    affordable,
    stock: selectedStock,
    plotCount: mockPlotCount,
    announcement,
    result,
    burningCategory,
    leavingCategory,
    onCategory: chooseCategory,
    onEntry: chooseEntry,
    onBack: goBack,
    onBuy: makeMockOrder
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<section class="shop-prototype" aria-label="Shop layout prototype">
  <header class="prototype-heading">
    <div>
      <p class="eyebrow">Elara Greenbloom · shop</p>
      <h1>{stage === 'categories' ? 'What are you looking for?' : currentCategory.label}</h1>
      <p class="prototype-path" aria-label="Your place in the shop">
        <span>Shop</span>{#if stage !== 'categories'}<span aria-hidden="true"> / </span><span>{currentCategory.label}</span>{/if}{#if selectedEntry && stage !== 'items'}<span aria-hidden="true"> / </span><span>{selectedEntry.name}</span>{/if}
      </p>
    </div>
    <div class="gold-balance"><span>Gold</span><strong>{mockGold}</strong></div>
  </header>

  <div class="prototype-nav">
    {#if stage !== 'categories'}
      <button id="prototype-back" type="button" onclick={goBack}>← {stage === 'items' ? 'All shelves' : stage === 'preview' ? 'Back to items' : 'Back to preview'}</button>
    {:else}
      <span aria-hidden="true"></span>
    {/if}
  </div>

  <div class="prototype-stage" class:stage-preview={stage === 'preview' || stage === 'result'}>
    {#if variant === 'A'}
      <VariantA {model} />
    {:else if variant === 'B'}
      <VariantB {model} />
    {:else}
      <VariantC {model} />
    {/if}
  </div>
  <p class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
</section>

<style>
  .shop-prototype { --ink: #f1e3c2; --muted: #c7b992; --gold: #d4ae66; --panel: rgba(24, 18, 11, .88); width: 100%; min-width: 0; color: var(--ink); }
  .prototype-heading { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: .2rem .2rem .7rem; }
  .eyebrow { margin: 0 0 .12rem; color: #c9a969; font-size: .67rem; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; }
  h1 { margin: 0; font-size: clamp(1.25rem, 2vw, 1.85rem); letter-spacing: -.035em; }
  .prototype-path { margin: .22rem 0 0; color: var(--muted); font-size: .74rem; }
  .prototype-nav { display: flex; min-height: 30px; justify-content: flex-end; align-items: center; gap: .75rem; margin: 0 0 .55rem; color: var(--muted); font-size: .7rem; }
  .prototype-nav button { padding: .32rem .58rem; border: 1px solid rgba(212, 174, 102, .45); border-radius: 999px; color: #f1e3c2; background: rgba(24, 18, 11, .82); font-size: .7rem; }
  .prototype-nav button:focus-visible { outline: 2px solid #f5d484; outline-offset: 2px; }
  .gold-balance { display: flex; align-items: baseline; gap: .5rem; padding: .48rem .72rem; border: 1px solid rgba(215, 174, 94, .42); border-radius: 999px; color: var(--muted); background: rgba(23, 17, 10, .82); white-space: nowrap; }
  .gold-balance strong { color: #f4d891; font-size: 1.1rem; }
  .prototype-stage { min-width: 0; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  @media (max-width: 600px) {
    .prototype-heading { align-items: flex-start; padding-inline: 0; }
    .prototype-path { font-size: .68rem; }
    .gold-balance { padding: .38rem .58rem; }
    .prototype-nav { margin-bottom: .35rem; }
  }
</style>
