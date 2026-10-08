<script lang="ts">
  import { PUBLIC_SUPABASE_URL } from '$env/static/public';
  import { onDestroy, tick, untrack } from 'svelte';
  import type { GameSnapshot } from '$lib/game/contracts';
  import { shopItemAssetPublicUrl } from '$lib/game/shop-runtime-assets';
  import { sceneRuntimeAssetPublicUrl, type SceneRuntimeAssetId } from '$lib/game/scene-runtime-assets';
  import { BURN_TREATMENTS, type BurnStyle, type BurnTreatment } from '$lib/card-effects';
  import { DEFAULT_BURN_TREATMENT, type PrototypeModel, type ShopCategoryKey, type ShopCategory, type ShopEntry, type ShopStage, type ShopVariant, type ShopTransitionPhase } from './types';
  import VariantA from './VariantA.svelte';
  import VariantB from './VariantB.svelte';
  import VariantC from './VariantC.svelte';

  type Props = { snapshot: GameSnapshot; variant: ShopVariant; burnStyle: BurnStyle };
  let { snapshot, variant, burnStyle }: Props = $props();

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
  let announcement = $state('Choose a shop shelf.');
  let result = $state<string | null>(null);
  let burningCategory = $state<ShopCategoryKey | null>(null);
  let leavingCategory = $state<ShopCategory | null>(null);
  let transitionPhase = $state<ShopTransitionPhase>('idle');
  let transitionKey = $state<string | null>(null);
  let transitionSequence = $state(0);
  let activeBurnTreatment = $state<BurnTreatment>('drip');
  let transitionTimer: ReturnType<typeof setTimeout> | undefined;
  let legacyTimer: ReturnType<typeof setTimeout> | undefined;
  let lastCommittedSequence = -1;
  let burnedEntryKeys = $state<string[]>([]);
  let previewBridgeSourceRect = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  let previewBridgeTransform = $state<{ translateX: number; translateY: number; scaleX: number; scaleY: number } | null>(null);
  let previewBridgeAnimating = $state(false);
  let previewBridgeMeasuring = $state(false);
  let history = $state<Array<{ stage: ShopStage; focusId: string; category: ShopCategoryKey; key: string | null }>>([]);
  let previousVariant = untrack(() => variant);
  let previousBurnStyle = untrack(() => burnStyle);

  $effect(() => {
    const nextVariant = variant;
    const nextStyle = burnStyle;
    if (nextVariant !== previousVariant || nextStyle !== previousBurnStyle) {
      untrack(() => settleTransitionForEffectChange());
    }
    previousVariant = nextVariant;
    previousBurnStyle = nextStyle;
  });

  onDestroy(cancelPendingTransition);

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
    history.push({ stage, focusId, category: selectedCategory, key: selectedKey });
  }

  function cancelPendingTransition() {
    transitionSequence += 1;
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = undefined;
    if (legacyTimer) clearTimeout(legacyTimer);
    legacyTimer = undefined;
    transitionPhase = 'idle';
    transitionKey = null;
    burningCategory = null;
    leavingCategory = null;
  }

  function clearItemBridge() {
    burnedEntryKeys = [];
    previewBridgeSourceRect = null;
    previewBridgeTransform = null;
    previewBridgeAnimating = false;
    previewBridgeMeasuring = false;
  }

  function startTimedTransition(phase: ShopTransitionPhase, key: string, durationMs: number, finish: (sequence: number) => void) {
    transitionSequence += 1;
    const sequence = transitionSequence;
    transitionPhase = phase;
    transitionKey = key;
    const poll = () => {
      if (sequence !== transitionSequence || transitionPhase !== phase || transitionKey !== key) return;
      if (document.visibilityState === 'hidden') {
        transitionTimer = setTimeout(poll, 100);
        return;
      }
      transitionTimer = undefined;
      finish(sequence);
    };
    transitionTimer = setTimeout(poll, durationMs + 50);
    return sequence;
  }

  function scheduleCurrentTransition(sequence: number, phase: ShopTransitionPhase, key: string, durationMs: number, finish: (sequence: number) => void) {
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = undefined;
    const poll = () => {
      if (sequence !== transitionSequence || transitionPhase !== phase || transitionKey !== key) return;
      if (document.visibilityState === 'hidden') {
        transitionTimer = setTimeout(poll, 100);
        return;
      }
      transitionTimer = undefined;
      finish(sequence);
    };
    transitionTimer = setTimeout(poll, durationMs + 40);
  }

  function startBurnAction(phase: ShopTransitionPhase, key: string, finish: (sequence: number) => void) {
    const treatment = burnStyle === 'random'
      ? BURN_TREATMENTS[Math.floor(Math.random() * BURN_TREATMENTS.length)]?.value ?? DEFAULT_BURN_TREATMENT
      : burnStyle;
    activeBurnTreatment = treatment;
    const duration = BURN_TREATMENTS.find((entry) => entry.value === treatment)?.durationMs ?? 1000;
    startTimedTransition(phase, key, duration, finish);
    return treatment;
  }

  function finishCategoryBurn(key: ShopCategoryKey, sequence = transitionSequence, restoreFocus = true) {
    if (sequence !== transitionSequence || transitionPhase !== 'category-burn' || transitionKey !== key || burningCategory !== key) return;
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = undefined;
    transitionSequence += 1;
    transitionPhase = 'idle';
    transitionKey = null;
    burningCategory = null;
    leavingCategory = null;
    stage = 'items';
    announcement = `${currentCategory.label}: ${entries.length} ${entries.length === 1 ? 'item' : 'items'}.`;
    if (restoreFocus) void tick().then(() => focusWithoutScroll(entries.length ? `shop-item-${safeId(entries[0].key)}` : 'prototype-back'));
  }

  function showEntryPreview(entry: ShopEntry, restoreFocus = true) {
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = undefined;
    transitionSequence += 1;
    transitionPhase = 'idle';
    transitionKey = null;
    stage = 'preview';
    previewBridgeMeasuring = false;
    announcement = `${entry.name} preview. ${entry.price} gold; ${mockStocks[entry.key] ?? entry.stock} in stock.`;
    if (restoreFocus) void tick().then(() => focusWithoutScroll('shop-preview-title'));
  }

  function finishEntryBurn(key: string, sequence: number) {
    if (sequence !== transitionSequence || transitionPhase !== 'item-burn' || transitionKey !== key) return;
    transitionPhase = 'item-zoom';
    stage = 'preview';
    announcement = `${selectedEntry?.name ?? 'Selected item'} expands for inspection.`;
    if (!previewBridgeSourceRect) {
      scheduleCurrentTransition(sequence, 'item-zoom', key, 200, finishEntryZoom);
      return;
    }
    previewBridgeMeasuring = true;
    void beginPreviewBridge(key, sequence);
  }

  async function beginPreviewBridge(key: string, sequence: number) {
    const source = previewBridgeSourceRect;
    await tick();
    if (sequence !== transitionSequence || transitionPhase !== 'item-zoom' || transitionKey !== key || !source) return;
    const target = document.getElementById('shop-preview-card');
    if (!(target instanceof HTMLElement)) {
      previewBridgeMeasuring = false;
      scheduleCurrentTransition(sequence, 'item-zoom', key, 200, finishEntryZoom);
      return;
    }
    const targetRect = target.getBoundingClientRect();
    if (targetRect.width <= 0 || targetRect.height <= 0) {
      previewBridgeMeasuring = false;
      scheduleCurrentTransition(sequence, 'item-zoom', key, 200, finishEntryZoom);
      return;
    }
    previewBridgeTransform = {
      translateX: source.left - targetRect.left,
      translateY: source.top - targetRect.top,
      scaleX: source.width / targetRect.width,
      scaleY: source.height / targetRect.height
    };
    previewBridgeAnimating = false;
    previewBridgeMeasuring = false;
    await tick();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (sequence !== transitionSequence || transitionPhase !== 'item-zoom' || transitionKey !== key) return;
      previewBridgeAnimating = true;
      scheduleCurrentTransition(sequence, 'item-zoom', key, 200, finishEntryZoom);
    }));
  }

  function finishEntryZoom(sequence: number) {
    const entry = selectedEntry;
    if (sequence !== transitionSequence || transitionPhase !== 'item-zoom' || !entry || transitionKey !== entry.key) return;
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = undefined;
    transitionSequence += 1;
    transitionPhase = 'idle';
    transitionKey = null;
    previewBridgeMeasuring = false;
    previewBridgeAnimating = true;
    announcement = `${entry.name} preview. ${entry.price} gold; ${mockStocks[entry.key] ?? entry.stock} in stock.`;
    void tick().then(() => focusWithoutScroll('shop-preview-title'));
  }

  function commitMockOrder(entry: ShopEntry, sequence: number) {
    if (lastCommittedSequence === sequence) return;
    lastCommittedSequence = sequence;
    mockGold -= entry.price;
    mockStocks[entry.key] = selectedStock - 1;
    if (entry.kind === 'expansion' && entry.plotCount) mockPlotCount = entry.plotCount;
    result = entry.kind === 'expansion'
      ? `Your mock garden now has ${mockPlotCount} plots. ${mockGold} gold remains.`
      : `${entry.name} added to your mock stock. ${mockGold} gold remains.`;
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = undefined;
    transitionSequence += 1;
    transitionPhase = 'idle';
    transitionKey = null;
    stage = 'result';
    announcement = result;
    void tick().then(() => focusWithoutScroll('shop-result-title'));
  }

  function finishPreviewBurn(key: string, sequence: number) {
    const entry = selectedEntry;
    if (sequence !== transitionSequence || transitionPhase !== 'order-burn' || transitionKey !== key || !entry || entry.key !== key || !affordable) return;
    commitMockOrder(entry, sequence);
  }

  function cancelOrderBurn(restoreFocus: boolean, message = 'Order canceled before commit. Your gold and stock are unchanged.') {
    if (transitionPhase !== 'order-burn') return;
    if (history.at(-1)?.stage === 'preview' && history.at(-1)?.focusId === 'shop-buy') history.pop();
    cancelPendingTransition();
    stage = 'preview';
    result = null;
    announcement = message;
    if (restoreFocus) void tick().then(() => focusWithoutScroll('shop-buy'));
  }

  function settleTransitionForEffectChange() {
    const phase = transitionPhase;
    if (phase === 'category-burn' || phase === 'item-burn' || phase === 'item-zoom') {
      cancelPendingTransition();
      const previous = history.pop();
      if (previous) {
        stage = previous.stage;
        selectedCategory = previous.category;
        selectedKey = previous.key;
      }
      clearItemBridge();
      result = null;
      announcement = phase === 'category-burn'
        ? 'Burn style changed. Shelf selection canceled; choose a shelf again.'
        : 'Burn style changed. Item selection canceled; choose an item again.';
    } else if (phase === 'order-burn') {
      cancelOrderBurn(false, 'Burn style changed. The order was canceled before commit; your gold and stock are unchanged.');
    } else {
      cancelPendingTransition();
    }
    if (legacyTimer) clearTimeout(legacyTimer);
    legacyTimer = undefined;
    leavingCategory = null;
  }

  function chooseCategory(key: ShopCategoryKey, triggerId: string) {
    if (transitionPhase !== 'idle') return;
    cancelPendingTransition();
    clearItemBridge();
    pushHistory(triggerId);
    selectedCategory = key;
    selectedKey = null;
    result = null;
    const category = categories.find((entry) => entry.key === key) ?? null;

    if (variant === 'C' && !prefersReducedMotion()) {
      burningCategory = key;
      leavingCategory = null;
      const treatment = startBurnAction('category-burn', key, (sequence) => finishCategoryBurn(key, sequence));
      announcement = burnStyle === 'random'
        ? `Random chose ${treatment} for the ${category?.label ?? 'category'} burn.`
        : `${category?.label ?? 'Category'} burns with the ${treatment} treatment.`;
      return;
    }

    stage = 'items';
    announcement = `${currentCategory.label}: ${entries.length} ${entries.length === 1 ? 'item' : 'items'}.`;
    leavingCategory = category;
    if (variant === 'C') {
      leavingCategory = null;
      void tick().then(() => focusWithoutScroll(entries.length ? `shop-item-${safeId(entries[0].key)}` : 'prototype-back'));
      return;
    }

    legacyTimer = setTimeout(() => {
      burningCategory = null;
      leavingCategory = null;
      legacyTimer = undefined;
    }, 210);
    void tick().then(() => focusWithoutScroll(entries.length ? `shop-item-${safeId(entries[0].key)}` : 'prototype-back'));
  }

  function chooseEntry(entry: ShopEntry, triggerId: string) {
    if (stage !== 'items' || transitionPhase !== 'idle') return;
    pushHistory(triggerId);
    selectedKey = entry.key;
    result = null;
    if (variant === 'C' && !prefersReducedMotion()) {
      const selectedCard = document.getElementById(triggerId);
      const rect = selectedCard?.getBoundingClientRect();
      previewBridgeSourceRect = rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
      previewBridgeTransform = null;
      previewBridgeAnimating = false;
      previewBridgeMeasuring = false;
      burnedEntryKeys = entries.filter((candidate) => candidate.key !== entry.key).map((candidate) => candidate.key);
      const treatment = startBurnAction('item-burn', entry.key, (sequence) => finishEntryBurn(entry.key, sequence));
      announcement = burnStyle === 'random'
        ? `${entry.name} selected. Random chose ${treatment} for the sibling-card burn.`
        : `${entry.name} selected. The sibling cards burn with the ${treatment} treatment.`;
      return;
    }
    clearItemBridge();
    showEntryPreview(entry);
  }

  function goBack() {
    const activePhase = transitionPhase;
    if (activePhase === 'order-burn') {
      cancelOrderBurn(true);
      return;
    }
    cancelPendingTransition();
    const previous = history.pop();
    if (!previous) return;
    stage = previous.stage;
    selectedCategory = previous.category;
    selectedKey = previous.stage === 'preview' ? previous.key : null;
    if (activePhase === 'item-burn' || activePhase === 'item-zoom' || previous.stage === 'items') clearItemBridge();
    result = null;
    if (activePhase === 'category-burn') announcement = 'Shelf transition canceled. Choose a shop shelf.';
    else if (activePhase === 'item-burn' || activePhase === 'item-zoom') announcement = 'Item selection canceled. Choose an item.';
    else announcement = previous.stage === 'categories' ? 'Choose a shop shelf.' : `${currentCategory.label}: ${entries.length} ${entries.length === 1 ? 'item' : 'items'}.`;
    void tick().then(() => focusWithoutScroll(previous.focusId));
  }

  function makeMockOrder() {
    if (!selectedEntry || !affordable || stage !== 'preview' || transitionPhase !== 'idle') return;
    const entry = selectedEntry;
    pushHistory('shop-buy');
    if (variant === 'C' && !prefersReducedMotion()) {
      const treatment = startBurnAction('order-burn', entry.key, (sequence) => finishPreviewBurn(entry.key, sequence));
      announcement = burnStyle === 'random'
        ? `Random chose ${treatment} for the ${entry.name} inspection-card burn. No gold or stock has changed yet.`
        : `Burning the ${entry.name} inspection card with ${treatment}. No gold or stock has changed yet.`;
      return;
    }
    transitionSequence += 1;
    commitMockOrder(entry, transitionSequence);
  }

  function handleKeydown(event: KeyboardEvent) {
    const target = event.target;
    if (event.key !== 'Escape' || (transitionPhase === 'idle' && stage === 'categories')) return;
    if (transitionPhase === 'idle' && target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    goBack();
  }

  function prefersReducedMotion() {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    burnTreatment: activeBurnTreatment,
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
    transitionPhase,
    transitionKey,
    transitionSequence,
    burnedEntryKeys,
    previewBridgeTransform,
    previewBridgeAnimating,
    previewBridgeMeasuring,
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
    {#if stage !== 'categories' || transitionPhase !== 'idle'}
      <button id="prototype-back" type="button" onclick={goBack}>{transitionPhase === 'category-burn' ? 'Cancel burn' : transitionPhase === 'item-burn' || transitionPhase === 'item-zoom' ? 'Cancel selection' : transitionPhase === 'order-burn' ? 'Cancel order' : `← ${stage === 'items' ? 'All shelves' : stage === 'preview' ? 'Back to items' : 'Back to preview'}`}</button>
    {:else}
      <span aria-hidden="true"></span>
    {/if}
  </div>

  <div class="prototype-stage" class:stage-preview={stage === 'preview' || stage === 'result'} aria-busy={transitionPhase !== 'idle'}>
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
