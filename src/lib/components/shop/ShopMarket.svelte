<script lang="ts">
  import { PUBLIC_SUPABASE_URL } from '$env/static/public';
  import { enhance } from '$app/forms';
  import { beforeNavigate } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { GardenCommandKind, GardenCommandPayload, GardenCommandPreview, GameSnapshot, GardenInventoryItem } from '$lib/game/contracts';
  import { shopItemAssetPublicUrl, shopRuntimeAssetPublicUrl } from '$lib/game/shop-runtime-assets';

  type ShopCategory = 'all' | 'seeds' | 'garden' | 'apiary';
  type ShopCommand = Extract<GardenCommandKind, 'purchase' | 'expand'>;
  type ShopPayload = Extract<GardenCommandPayload, { itemKey: string } | { plotCount: 16 | 24 }>;
  type CompletedOrder = { kind: ShopCommand; itemKey?: string; name: string; quantity?: number; capacity?: number; cost: number; previousGold: number; goldBalance: number };

  let { snapshot }: { snapshot: GameSnapshot } = $props();

  let category = $state<ShopCategory>('all');
  let affordableOnly = $state(false);
  let selectedItemKey = $state<string | null>(null);
  let detailMode = $state<'item' | 'expand' | null>(null);
  let detailQuantity = $state(1);
  let hydrated = $state(false);
  let preview = $state<GardenCommandPreview | null>(null);
  let previewPayload = $state<ShopPayload | null>(null);
  let previewSignature = $state('');
  let pendingAction = $state<{ signature: string; actionId: string; revision: number } | null>(null);
  let pending = $state(false);
  let message = $state<string | null>(null);
  let messageError = $state(false);
  let previewForm: HTMLFormElement | undefined = $state();
  let previewRequest = $state(0);
  let expansionReturn = $state<{ category: ShopCategory; selectedItemKey: string | null; scrollTop: number; focusId: string } | null>(null);
  let completedOrder = $state<CompletedOrder | null>(null);
  let receiptDialog: HTMLDialogElement | undefined = $state();
  let successAction: HTMLButtonElement | undefined = $state();
  let goodsGrid: HTMLDivElement | undefined = $state();
  let prefersReducedMotion = $state(false);
  let focusRequest = 0;
  let resizeFrame = 0;
  let browseScrollTop = 0;
  let browseFocusId = '';

  let garden = $derived(snapshot.garden);
  let goods = $derived(garden?.shop ?? []);
  let inventory = $derived(garden?.inventory ?? []);
  let nextExpansion = $derived(garden?.expansions.find((expansion) => expansion.available) ?? null);
  let capacity = $derived((garden?.plotCount ?? snapshot.cells.filter((cell) => cell.unlocked !== false).length));
  let activeGoods = $derived(goods.filter((item) =>
    (category === 'all' || itemCategory(item) === category) && (!affordableOnly || item.price <= (snapshot.save.gold ?? 0))
  ));
  let selectedItem = $derived(detailMode === 'item' ? activeGoods.find((item) => item.itemKey === selectedItemKey) ?? null : null);
  let completedItem = $derived(completedOrder?.itemKey ? goods.find((item) => item.itemKey === completedOrder?.itemKey) ?? null : null);
  let detailTotal = $derived(selectedItem ? selectedItem.price * detailQuantity : 0);
  let projectedGold = $derived((snapshot.save.gold ?? 0) - detailTotal);
  let hasCurrentPreview = $derived(!!preview && previewSignature === signature(preview?.commandKind as ShopCommand, previewPayload));

  const categoryNames: Record<ShopCategory, string> = {
    all: 'All', seeds: 'Seeds', garden: 'Garden', apiary: 'Apiary'
  };

  const heroAssetUrl = shopRuntimeAssetPublicUrl('elara-counter-hero', PUBLIC_SUPABASE_URL);
  const portraitAssetUrl = '/assets/scenes/shop/elara-portrait.webp';

  onMount(() => {
    hydrated = true;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => { prefersReducedMotion = motion.matches; };
    updateMotion();
    motion.addEventListener('change', updateMotion);
    return () => motion.removeEventListener('change', updateMotion);
  });

  beforeNavigate(({ cancel }) => {
    if (pendingAction) cancel();
  });

  function itemCategory(item: Omit<GardenInventoryItem, 'quantity'>): Exclude<ShopCategory, 'all'> {
    if (item.kind === 'seed') return 'seeds';
    if (item.kind === 'amendment') return 'garden';
    return 'apiary';
  }

  function itemIcon(item: Omit<GardenInventoryItem, 'quantity'>) {
    return ({ seed: '✿', amendment: '◒', equipment: '⌂', colony: '♚', feed: '❋', treatment: '✦' } as const)[item.kind];
  }

  function itemArt(item: Omit<GardenInventoryItem, 'quantity'>) {
    return shopItemAssetPublicUrl(item.itemKey, PUBLIC_SUPABASE_URL);
  }

  function beginLayoutTransition(update: () => void, direction: 'open' | 'close') {
    const documentWithTransitions = document as Document & {
      startViewTransition?: (callback: () => void | Promise<void>) => { finished: Promise<void> };
    };
    if (prefersReducedMotion || !documentWithTransitions.startViewTransition) {
      update();
      return Promise.resolve();
    }
    const root = document.documentElement;
    root.style.setProperty('--shop-transition-duration', direction === 'open' ? '240ms' : '180ms');
    root.style.setProperty('--shop-transition-easing', direction === 'open' ? 'cubic-bezier(.22,1,.36,1)' : 'cubic-bezier(.4,0,1,1)');
    const transition = documentWithTransitions.startViewTransition(async () => {
      update();
      await tick();
    });
    return transition.finished.catch(() => undefined).finally(() => {
      root.style.removeProperty('--shop-transition-duration');
      root.style.removeProperty('--shop-transition-easing');
    });
  }

  function rememberBrowsePosition(focusId: string) {
    browseScrollTop = goodsGrid?.scrollTop ?? browseScrollTop;
    browseFocusId = focusId;
  }

  function focusDetailAfter(transition: Promise<unknown>, expectedMode: 'item' | 'expand', expectedItemKey: string | null = null) {
    const request = ++focusRequest;
    void transition.then(async () => {
      await tick();
      if (request !== focusRequest || detailMode !== expectedMode || (expectedMode === 'item' && selectedItemKey !== expectedItemKey)) return;
      const heading = document.getElementById('item-detail-title');
      heading?.focus({ preventScroll: true });
      if (window.matchMedia('(max-width: 1199px)').matches) {
        heading?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
      }
    });
  }

  function restoreBrowseFocus(transition: Promise<unknown>, focusId = browseFocusId) {
    const request = ++focusRequest;
    void transition.then(async () => {
      await tick();
      if (request !== focusRequest || detailMode) return;
      if (goodsGrid) goodsGrid.scrollTop = browseScrollTop;
      if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    });
  }

  function signature(kind: ShopCommand | undefined, payload: ShopPayload | null) {
    return `${kind ?? 'none'}:${JSON.stringify(payload)}`;
  }

  function commandLabel(kind: ShopCommand) {
    return kind === 'expand' ? 'expand the garden' : 'buy supplies';
  }

  function purchaseSummary(payload: ShopPayload | null) {
    if (!payload || !('itemKey' in payload) || !('quantity' in payload)) return null;
    const item = goods.find((candidate) => candidate.itemKey === payload.itemKey);
    const held = inventory.find((candidate) => candidate.itemKey === payload.itemKey)?.quantity ?? 0;
    return { name: item?.name ?? payload.itemKey, quantity: payload.quantity, held, after: held + payload.quantity };
  }

  function selectItem(item: typeof goods[number]) {
    if (pendingAction) return;
    const opening = detailMode === null;
    rememberBrowsePosition(`shop-good-${item.itemKey}`);
    const updateSelection = () => {
      selectedItemKey = item.itemKey;
      detailMode = 'item';
      detailQuantity = 1;
      affordableOnly = false;
      message = null;
      invalidatePreview();
      void tick().then(() => requestPreview('item'));
    };
    const transition = opening ? beginLayoutTransition(updateSelection, 'open') : Promise.resolve().then(updateSelection);
    focusDetailAfter(transition, 'item', item.itemKey);
  }

  function selectCategory(nextCategory: ShopCategory) {
    if (pendingAction) return;
    rememberBrowsePosition(`shop-filter-${nextCategory}`);
    const transition = detailMode ? beginLayoutTransition(() => {
      category = nextCategory;
      affordableOnly = false;
      selectedItemKey = null;
      detailMode = null;
      invalidatePreview();
    }, 'close') : Promise.resolve().then(() => {
      category = nextCategory;
      affordableOnly = false;
      selectedItemKey = null;
      invalidatePreview();
    });
    restoreBrowseFocus(transition, `shop-filter-${nextCategory}`);
  }

  function showAffordableGoods() {
    if (pendingAction) return;
    rememberBrowsePosition('shop-filter-all');
    const transition = detailMode ? beginLayoutTransition(() => {
      affordableOnly = true;
      selectedItemKey = null;
      detailMode = null;
      invalidatePreview();
    }, 'close') : Promise.resolve().then(() => {
      affordableOnly = true;
      selectedItemKey = null;
      invalidatePreview();
    });
    restoreBrowseFocus(transition, 'shop-filter-all');
  }

  function closeDetail() {
    if (pendingAction) return;
    const itemKey = selectedItemKey;
    const focusId = itemKey ? `shop-good-${itemKey}` : browseFocusId;
    const transition = beginLayoutTransition(() => {
      selectedItemKey = null;
      detailMode = null;
      invalidatePreview();
    }, 'close');
    restoreBrowseFocus(transition, focusId);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && detailMode && !pendingAction && !receiptDialog?.open) {
      event.preventDefault();
      detailMode === 'expand' ? restoreFromExpansion() : closeDetail();
    }
  }

  function handleResize() {
    if (!detailMode) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      const heading = document.getElementById('item-detail-title');
      if (!heading || document.activeElement !== heading) return;
      const bounds = heading.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
        heading.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    });
  }

  function openExpansion() {
    if (pendingAction) return;
    const opening = detailMode === null;
    const focusId = opening ? 'shop-expand-opening' : selectedItemKey ? `shop-good-${selectedItemKey}` : 'shop-expand-compact';
    if (detailMode !== 'expand') expansionReturn = { category, selectedItemKey, scrollTop: goodsGrid?.scrollTop ?? 0, focusId };
    const updateExpansion = () => {
      selectedItemKey = null;
      detailMode = 'expand';
      invalidatePreview();
      if (nextExpansion) void tick().then(() => requestPreview('expand'));
    };
    const transition = opening ? beginLayoutTransition(updateExpansion, 'open') : Promise.resolve().then(updateExpansion);
    focusDetailAfter(transition, 'expand');
  }

  function restoreFromExpansion() {
    if (pendingAction) return;
    const target = expansionReturn;
    expansionReturn = null;
    const targetItemKey = target?.selectedItemKey ?? null;
    const transition = targetItemKey ? Promise.resolve().then(() => {
      category = target?.category ?? category;
      selectedItemKey = targetItemKey;
      detailMode = 'item';
      invalidatePreview();
      void tick().then(() => requestPreview('item'));
    }) : beginLayoutTransition(() => {
      category = target?.category ?? category;
      selectedItemKey = null;
      detailMode = null;
      invalidatePreview();
    }, 'close');
    browseScrollTop = target?.scrollTop ?? browseScrollTop;
    if (targetItemKey) {
      focusDetailAfter(transition, 'item', targetItemKey);
    } else {
      restoreBrowseFocus(transition, target?.focusId ?? 'shop-expand-opening');
    }
  }

  function invalidatePreview() {
    previewRequest += 1;
    pending = false;
    preview = null;
    previewPayload = null;
    previewSignature = '';
  }

  function requestPreview(expectedMode: 'item' | 'expand') {
    if (detailMode !== expectedMode || (expectedMode === 'item' && !selectedItem) || (expectedMode === 'expand' && !nextExpansion)) return;
    if (hydrated && !pendingAction && previewForm) previewForm.requestSubmit();
  }

  function previewStatus() {
    if (!preview || preview.commandKind !== 'purchase') return null;
    const status = preview.status;
    return typeof status === 'string' ? status : null;
  }

  function previewNumber(key: string) {
    const value = preview?.[key];
    return typeof value === 'number' ? value : 0;
  }

  function resetForAnother() {
    completedOrder = null;
    preview = null;
    previewPayload = null;
    previewSignature = '';
    pendingAction = null;
    detailQuantity = 1;
    detailMode = 'item';
    invalidatePreview();
    void tick().then(() => requestPreview('item'));
  }

  function continueShopping() {
    if (completedOrder?.kind === 'expand') {
      completedOrder = null;
      restoreFromExpansion();
      return;
    }
    const focusId = selectedItemKey ? `shop-good-${selectedItemKey}` : browseFocusId;
    completedOrder = null;
    const transition = detailMode ? beginLayoutTransition(() => {
      selectedItemKey = null;
      detailMode = null;
      invalidatePreview();
    }, 'close') : Promise.resolve();
    restoreBrowseFocus(transition, focusId);
  }

  function previewEnhancer(kind: ShopCommand, payloadFor: (formData: FormData) => ShopPayload | null): SubmitFunction {
    return ({ formData, cancel }) => {
      const payload = payloadFor(formData);
      if (!payload) {
        cancel();
        message = 'Choose a valid quantity before asking Elara to prepare the order.';
        messageError = true;
        return;
      }
      formData.set('commandKind', kind);
      formData.set('payload', JSON.stringify(payload));
      const requestId = ++previewRequest;
      pending = true;
      message = null;
      return async ({ result }) => {
        const data = 'data' in result ? result.data as { preview?: GardenCommandPreview; message?: string } | undefined : undefined;
        if (requestId !== previewRequest) return;
        pending = false;
        if (result.type === 'success' && data?.preview) {
          preview = data.preview;
          previewPayload = payload;
          previewSignature = signature(kind, payload);
          messageError = false;
        } else {
          message = data?.message ?? 'Elara cannot prepare that preview right now.';
          messageError = true;
        }
      };
    };
  }

  const commitPreview: SubmitFunction = ({ formData, cancel }) => {
    if (!preview || !previewPayload || !hasCurrentPreview) {
      cancel();
      message = 'Ask for a fresh preview before confirming this order.';
      messageError = true;
      return;
    }
    const committedPreview = preview;
    const committedPayload = previewPayload;
    const currentSignature = signature(committedPreview.commandKind as ShopCommand, committedPayload);
    if (!pendingAction || pendingAction.signature !== currentSignature || pendingAction.revision !== snapshot.save.revision) {
      pendingAction = { signature: currentSignature, actionId: crypto.randomUUID(), revision: snapshot.save.revision };
    }
    formData.set('saveId', snapshot.save.id);
    formData.set('actionId', pendingAction.actionId);
    formData.set('expectedRevision', String(pendingAction.revision));
    formData.set('commandKind', committedPreview.commandKind);
    formData.set('payload', JSON.stringify(committedPayload));
    pending = true;
    message = null;
    return async ({ result, update }) => {
      const data = 'data' in result ? result.data as { message?: string; conflict?: boolean; pendingAction?: object; receipt?: { result?: Record<string, unknown> } } | undefined : undefined;
      if (result.type === 'error') {
        pending = false;
        message = 'The order outcome is unknown. Retry to recover the same order.';
        messageError = true;
        return;
      }
      if (result.type === 'success') {
        const receipt = data?.receipt;
        const resultData = receipt?.result;
        let resolvedOrder: CompletedOrder | null = null;
        if (committedPreview.commandKind === 'purchase' && resultData && typeof resultData === 'object') {
          const order = purchaseSummary(committedPayload);
          resolvedOrder = {
            kind: 'purchase', itemKey: 'itemKey' in committedPayload ? committedPayload.itemKey : undefined,
            name: order?.name ?? 'Supplies', quantity: Number(resultData.quantity ?? order?.quantity ?? 0),
            cost: Number(resultData.goldSpent ?? 0), previousGold: Number(resultData.previousGold ?? 0),
            goldBalance: Number(resultData.goldBalance ?? 0)
          };
          message = 'Purchase complete.';
        } else if (committedPreview.commandKind === 'expand') {
          resolvedOrder = { kind: 'expand', name: 'Garden expanded', capacity: Number(resultData?.plotCount ?? 0), cost: Number(resultData?.goldSpent ?? 0), previousGold: Number(snapshot.save.gold ?? 0), goldBalance: Number(resultData?.goldBalance ?? 0) };
          message = 'Garden expanded.';
        }
        messageError = false;
        preview = null;
        previewPayload = null;
        previewSignature = '';
        await update({ reset: false, invalidateAll: true });
        pending = false;
        pendingAction = null;
        completedOrder = resolvedOrder;
        if (resolvedOrder) {
          await tick();
          receiptDialog?.showModal();
          successAction?.focus();
        }
        return;
      } else if (data?.pendingAction) {
        pending = false;
        message = data.message ?? 'The order outcome is unknown. Retry to recover the same order.';
        messageError = true;
      } else {
        pending = false;
        message = data?.message ?? 'Elara could not complete that order.';
        messageError = true;
        pendingAction = null;
      }
      await update({ reset: false, invalidateAll: !!data?.conflict });
    };
  };

  function detailPayload(formData: FormData): ShopPayload | null {
    if (!selectedItem) return null;
    const quantity = Number(formData.get('quantity'));
    return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 20
      ? { itemKey: selectedItem.itemKey, quantity }
      : null;
  }

  function expansionPayload(): ShopPayload | null {
    const plotCount = nextExpansion?.plotCount;
    return plotCount === 16 || plotCount === 24 ? { plotCount } : null;
  }

  function correctQuantity() {
    if (pendingAction) return;
    detailQuantity = Math.max(1, Math.min(20, previewNumber('remainingStock')));
    invalidatePreview();
    void tick().then(() => requestPreview('item'));
  }

  function effectDescription(item: typeof goods[number]) {
    if (item.kind === 'seed' && typeof item.effect.species === 'string') return `Plant ${item.effect.species} in an empty garden plot.`;
    if (item.kind === 'amendment') {
      if (typeof item.effect.n === 'number') return `Adds ${item.effect.n} nitrogen to selected soil.`;
      if (typeof item.effect.p === 'number') return `Adds ${item.effect.p} phosphorus to selected soil.`;
      if (typeof item.effect.k === 'number') return `Adds ${item.effect.k} potassium to selected soil.`;
      if (typeof item.effect.quality === 'number') return `Improves selected soil quality by ${item.effect.quality}.`;
    }
    if (item.kind === 'feed' && typeof item.effect.food === 'number') return `Restores ${item.effect.food} food to a bee colony.`;
    if (item.kind === 'treatment' && typeof item.effect.problem === 'string') return `Treats ${item.effect.problem} in an affected colony.`;
    if (item.kind === 'equipment') return 'Provides one empty hive for an unlocked garden plot.';
    if (item.kind === 'colony') return 'Stocks an empty hive with a replacement bee colony.';
    return item.name;
  }
</script>

<svelte:window onkeydown={handleKeydown} onresize={handleResize} />

<section class:art8-layout={!!detailMode} class:art6-layout={!detailMode} class="shop-layout" data-shop-market aria-label="Elara Greenbloom's garden shop">
  {#if !detailMode}
    <aside class="opening-status panel" aria-label="Shop status">
      <p class="eyebrow">Shop status</p>
      <div class="gold-status"><span>Gold</span><strong>{snapshot.save.gold ?? 0}</strong></div>
      <details class="status-more">
        <summary>Garden status</summary>
        <dl>
          <div><dt>Garden capacity</dt><dd>{capacity} plots</dd></div>
          {#if nextExpansion}<div><dt>Next expansion</dt><dd>{nextExpansion.plotCount} plots · {nextExpansion.price} gold</dd></div>{/if}
        </dl>
      </details>
      {#if nextExpansion}
        <button id="shop-expand-opening" class="secondary-button" type="button" onclick={openExpansion}>Expand garden</button>
      {:else}
        <p class="shop-muted">Garden at full capacity.</p>
      {/if}
    </aside>
  {/if}
  <section class="shop-scene panel" data-shop-merchant aria-label="Elara Greenbloom’s shop counter">
    {#if detailMode}
      <div class="compact-identity">
        <span class="portrait-frame"><img src={portraitAssetUrl} alt="" onerror={(event) => event.currentTarget.remove()} /></span>
        <span><strong>Elara Greenbloom</strong><small>Shopkeeper</small></span>
      </div>
    {/if}
    <div class="shop-scene-art" role="img" aria-label="Elara Greenbloom at her garden shop counter">
      <span class="scene-fallback">Elara Greenbloom</span>
      {#if heroAssetUrl}<img class="shop-merchant" src={heroAssetUrl} alt="" onerror={(event) => event.currentTarget.remove()} />{/if}
    </div>
  </section>

  <aside class="shop-goods panel" data-shop-catalog aria-labelledby="goods-title">
    {#if !detailMode}
      <div class="opening-identity">
        <span class="portrait-frame"><img src={portraitAssetUrl} alt="" onerror={(event) => event.currentTarget.remove()} /></span>
        <span><strong>Elara Greenbloom</strong><small>Shopkeeper</small></span>
      </div>
    {/if}
    <header class="merchant-heading">
      <div><p class="eyebrow">Elara’s counter</p><h2 id="goods-title">Featured goods</h2></div>
      <div class="market-tools">
        <p><strong>{snapshot.save.gold ?? 0}</strong> gold</p>
        {#if detailMode && detailMode !== 'expand' && nextExpansion}<button id="shop-expand-compact" class="text-button" type="button" disabled={!!pendingAction} onclick={openExpansion}>Expand garden</button>{/if}
        {#if detailMode && !nextExpansion}<span>Full capacity</span>{/if}
      </div>
    </header>
    <fieldset class="shop-filters">
      <legend>Categories</legend>
      <div>
        {#each Object.entries(categoryNames) as [key, label]}
          <label><input id={`shop-filter-${key}`} type="radio" name="shop-category" value={key} checked={category === key} disabled={!hydrated || !!pendingAction} onchange={() => selectCategory(key as ShopCategory)} /><span>{label}</span></label>
        {/each}
      </div>
    </fieldset>
    {#if affordableOnly}<p class="shop-filter-status" role="status">Showing goods you can afford. <button class="text-button" type="button" onclick={() => affordableOnly = false}>Show all</button></p>{/if}
    <div bind:this={goodsGrid} class="goods-grid" aria-live="polite" data-shop-goods-scroll>
      {#each activeGoods as item (item.itemKey)}
        {@const artUrl = itemArt(item)}
        <article class:selected={selectedItem?.itemKey === item.itemKey} class="good-card" data-good-key={item.itemKey} data-good-category={itemCategory(item)}>
          <span class="good-art" aria-hidden="true"><span class="good-icon">{itemIcon(item)}</span>{#if artUrl}<img src={artUrl} alt="" onerror={(event) => event.currentTarget.remove()} />{/if}</span>
          <h3>{item.name}</h3>
          <p>{item.price} gold</p><span class:sold-out={item.remainingStock === 0}>{item.remainingStock === 0 ? 'Sold out' : `${item.remainingStock} left`}</span>
          <button id={`shop-good-${item.itemKey}`} class="tile-button" type="button" disabled={!hydrated || !!pendingAction} onclick={() => selectItem(item)} aria-pressed={selectedItem?.itemKey === item.itemKey}><span class="sr-only">Select {item.name}</span></button>
        </article>
      {:else}
        <p class="shop-muted">No goods are stocked in this category today.</p>
      {/each}
    </div>
  </aside>
  {#if detailMode}<aside class="item-detail panel" data-shop-detail aria-live="polite">
    {#if detailMode === 'expand'}
      <p class="eyebrow">Garden capacity</p><h2 id="item-detail-title" tabindex="-1">{nextExpansion ? `Expand to ${nextExpansion.plotCount} plots` : 'Garden at full capacity'}</h2>
      {#if nextExpansion}
        <dl>
          <div><dt>Current capacity</dt><dd>{capacity} plots</dd></div>
          <div><dt>Next capacity</dt><dd>{nextExpansion.plotCount} plots</dd></div>
          <div><dt>Price</dt><dd>{preview?.goldCost ?? nextExpansion.price} gold</dd></div>
          <div><dt>Current gold</dt><dd>{preview?.goldBalance ?? snapshot.save.gold ?? 0}</dd></div>
        </dl>
      {:else}
        <p>Every available garden plot is already in your care.</p>
      {/if}
    {:else if selectedItem}
      {@const selectedArtUrl = itemArt(selectedItem)}
      <p class="eyebrow">{itemCategory(selectedItem)}</p><h2 id="item-detail-title" tabindex="-1">{selectedItem.name}</h2>
      <div class="detail-illustration" aria-hidden="true"><span>{itemIcon(selectedItem)}</span>{#if selectedArtUrl}<img src={selectedArtUrl} alt="" onerror={(event) => event.currentTarget.remove()} />{/if}</div>
      <p>{effectDescription(selectedItem)}</p>
      <dl><div><dt>Unit price</dt><dd>{selectedItem.price} gold</dd></div><div><dt>Current gold</dt><dd>{preview?.goldBalance ?? snapshot.save.gold ?? 0}</dd></div><div><dt>Owned</dt><dd>{inventory.find((candidate) => candidate.itemKey === selectedItem.itemKey)?.quantity ?? 0}</dd></div><div><dt>In stock</dt><dd>{selectedItem.remainingStock}</dd></div></dl>
      {#if selectedItem.remainingStock > 0}<label class="quantity-label">Quantity <input name="quantity" type="number" min="1" max="20" disabled={!!pendingAction} bind:value={detailQuantity} onchange={() => { invalidatePreview(); requestPreview('item'); }} /></label>{/if}
      <p class="detail-total">Total {detailTotal} gold · You will have {projectedGold} gold remaining.</p>
    {:else}<p class="eyebrow">Garden ledger</p><h2>Choose a good</h2><p>Select a tile to inspect its current terms.</p>{/if}

    {#if detailMode === 'expand' && nextExpansion}
      {#key `expand:${nextExpansion.plotCount}`}
        <form bind:this={previewForm} method="POST" action="?/preview" use:enhance={previewEnhancer('expand', expansionPayload)}><input type="hidden" name="plotCount" value={nextExpansion.plotCount} /></form>
      {/key}
    {:else if detailMode === 'item' && selectedItem}
      {#key `purchase:${selectedItem.itemKey}`}
        <form bind:this={previewForm} method="POST" action="?/preview" use:enhance={previewEnhancer('purchase', detailPayload)}><input type="hidden" name="quantity" value={detailQuantity} /></form>
      {/key}
    {/if}
    {#if detailMode === 'item' && selectedItem?.remainingStock === 0}<p class="form-message error" role="alert"><strong>Out of stock.</strong> Restocks on tavern day {selectedItem.restockDay}.</p><button class="primary-button" type="button" disabled>Buy for {selectedItem.price} gold</button><div class="detail-actions"><button class="secondary-button" type="button" onclick={() => { closeDetail(); affordableOnly = false; }}>View alternatives</button></div>
    {:else if preview?.canCommit === false}
      {#if preview.commandKind === 'expand'}<p class="form-message error" role="alert"><strong>Not enough gold.</strong> Need {Math.max(0, previewNumber('goldCost') - previewNumber('goldBalance'))} more gold.</p><button class="primary-button" type="button" disabled>Expand to {nextExpansion?.plotCount} plots for {preview.goldCost ?? nextExpansion?.price} gold</button><div class="detail-actions"><button class="secondary-button" type="button" onclick={showAffordableGoods}>View affordable goods</button></div>
      {:else if previewStatus() === 'insufficient_gold'}<p class="form-message error" role="alert"><strong>Not enough gold.</strong> Need {previewNumber('goldDeficit')} more gold.</p><button class="primary-button" type="button" disabled>Buy for {preview.goldCost ?? detailTotal} gold</button><div class="detail-actions"><button class="secondary-button" type="button" onclick={showAffordableGoods}>View affordable goods</button></div>
      {:else if previewStatus() === 'exceeds_stock'}<p class="form-message error" role="alert">Only {preview.remainingStock ?? 0} left.</p><button class="secondary-button" type="button" onclick={correctQuantity}>Use available quantity</button>
      {:else}<p class="form-message error" role="alert">This capacity change cannot be completed.</p>{/if}
    {:else if preview && detailMode}<form data-shop-commit method="POST" action="?/command" use:enhance={commitPreview}><button class="primary-button" type="submit" disabled={!hydrated || pending}>{pending ? 'Confirming…' : pendingAction && messageError ? `Retry ${commandLabel(preview.commandKind as ShopCommand)}` : preview.commandKind === 'expand' ? `Expand to ${nextExpansion?.plotCount} plots for ${preview.goldCost ?? '…'} gold` : `Buy for ${preview.goldCost ?? '…'} gold`}</button></form>
    {:else if detailMode && !messageError}<p class="shop-muted">Checking Elara’s ledger…</p>{/if}
    {#if message && messageError}<p class="form-message error" role="alert">{message}</p>{/if}
    <button class="text-button detail-close" type="button" disabled={!!pendingAction} onclick={detailMode === 'expand' ? restoreFromExpansion : closeDetail}>Back to goods</button>
  </aside>{/if}
</section>

{#if message && !preview && !completedOrder && !detailMode}
  <p class="shop-message" class:error={messageError} role={messageError ? 'alert' : 'status'} aria-live="polite">{message}</p>
{/if}

{#if completedOrder}
  <dialog bind:this={receiptDialog} class="purchase-complete receipt" data-shop-receipt aria-labelledby="receipt-title" oncancel={(event) => event.preventDefault()}>
    <div class="receipt-check" aria-hidden="true">✓</div>
    <p class="eyebrow">Elara’s receipt</p>
    <h2 id="receipt-title">{completedOrder.kind === 'expand' ? 'Garden expanded' : 'Purchase complete'}</h2>
    {#if completedOrder.kind === 'purchase'}
      {@const receiptArtUrl = completedItem ? itemArt(completedItem) : null}
      <div class="receipt-item" aria-hidden="true"><span>{completedItem ? itemIcon(completedItem) : '✿'}</span>{#if receiptArtUrl}<img src={receiptArtUrl} alt="" onerror={(event) => event.currentTarget.remove()} />{/if}</div>
    {/if}
    <p><strong>{completedOrder.kind === 'expand' ? `${completedOrder.capacity} plots` : `${completedOrder.quantity} × ${completedOrder.name}`}</strong></p>
    <dl>
      <div><dt>Actual cost</dt><dd>{completedOrder.cost} gold</dd></div>
      <div><dt>Previous gold</dt><dd>{completedOrder.previousGold}</dd></div>
      <div><dt>New gold</dt><dd>{completedOrder.goldBalance}</dd></div>
    </dl>
    <div class="detail-actions">
      {#if completedOrder.kind === 'purchase'}<button bind:this={successAction} class="primary-button" type="button" onclick={resetForAnother}>Buy another</button>{/if}
      <button class="text-button" type="button" onclick={continueShopping}>Continue shopping</button>
    </div>
  </dialog>
{/if}

<style>
  .shop-layout {
    display: grid;
    width: calc(100% - 2rem);
    max-width: none;
    min-width: 0;
    margin: 0 1rem;
    gap: .75rem;
    align-items: start;
  }
  .art6-layout { grid-template-columns: minmax(0,18fr) minmax(0,58fr) minmax(0,24fr); }
  .art8-layout { grid-template-columns: minmax(0,24fr) minmax(0,42fr) minmax(0,34fr); }
  .opening-status { grid-column: 1; display: grid; gap: .9rem; align-content: start; padding: 1rem; }
  .art6-layout .shop-scene { grid-column: 2; }
  .art6-layout .shop-goods { grid-column: 3; }
  .art8-layout .shop-scene { grid-column: 1; }
  .art8-layout .shop-goods { grid-column: 2; }
  .art8-layout .item-detail { grid-column: 3; }
  .gold-status { display: flex; align-items: baseline; justify-content: space-between; gap: .75rem; padding-bottom: .7rem; border-bottom: 1px solid #4c371c; color: var(--muted); }
  .gold-status strong { color: var(--gold-bright); font: 600 1.35rem 'Cinzel', serif; }
  .status-more { min-width: 0; }
  .status-more summary { min-height: 44px; color: #d8bc78; cursor: pointer; }
  .status-more dl { display: grid; gap: .7rem; margin: 0; }
  .status-more dl div { display: grid; gap: .2rem; }
  .status-more dt { color: var(--muted); font-size: .78rem; }
  .status-more dd { margin: 0; color: var(--gold-bright); font-size: .9rem; }
  .shop-scene { min-width: 0; overflow: hidden; background: radial-gradient(circle at 50% 30%, #6c4b25, #1c1209 64%, #090603); view-transition-name: shop-merchant; }
  .shop-scene-art { position: relative; display: grid; width: 100%; aspect-ratio: 4 / 3; place-items: center; overflow: hidden; isolation: isolate; }
  .scene-fallback { z-index: 0; padding: 1rem; color: #d7bd7a; font: 600 1rem 'Cinzel', serif; text-align: center; }
  .shop-merchant { position: absolute; z-index: 1; inset: 0; width: 100%; height: 100%; object-fit: contain; object-position: center; }
  .compact-identity, .opening-identity { display: flex; align-items: center; gap: .7rem; padding: .65rem .8rem; color: #d9c28b; background: #100b07; }
  .compact-identity { border-bottom: 1px solid #6b4e24; }
  .opening-identity { margin: -.2rem -.2rem .25rem; border-bottom: 1px solid #493719; }
  .compact-identity > span:last-child, .opening-identity > span:last-child { display: grid; gap: .12rem; min-width: 0; }
  .compact-identity strong, .opening-identity strong { color: var(--gold-bright); font: 600 .85rem 'Cinzel', serif; }
  .compact-identity small, .opening-identity small { color: #9fc36c; }
  .portrait-frame { display: grid; width: 48px; height: 48px; flex: 0 0 48px; place-items: center; overflow: hidden; border: 1px solid #80602d; border-radius: 50%; background: radial-gradient(circle, #5d4120, #171006); }
  .portrait-frame img { width: 100%; height: 100%; object-fit: cover; object-position: center; }
  .shop-goods { display: flex; min-width: 0; max-height: calc(100vh - 6.5rem); padding: .8rem; flex-direction: column; overflow: hidden; view-transition-name: shop-catalog; }
  .merchant-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: .7rem; padding-bottom: .7rem; border-bottom: 1px solid #493719; }
  .merchant-heading h2 { margin: .12rem 0 0; color: var(--gold-bright); font: 600 1rem 'Cinzel', serif; }
  .market-tools { display: grid; gap: .25rem; justify-items: end; text-align: right; }
  .market-tools p { margin: 0; color: var(--muted); font-size: .75rem; white-space: nowrap; }
  .market-tools strong { color: var(--gold-bright); }
  .market-tools span { color: #9fc36c; font-size: .68rem; }
  .shop-filters { min-width: 0; margin: .7rem 0; padding: 0; border: 0; }
  .shop-filters legend { margin-bottom: .42rem; color: var(--gold-bright); font: .68rem 'Cinzel', serif; text-transform: uppercase; letter-spacing: .09em; }
  .shop-filters > div { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: .25rem; }
  .shop-filters label { position: relative; min-width: 0; }
  .shop-filters input { position: absolute; opacity: 0; }
  .shop-filters span { display: grid; min-height: 44px; place-items: center; padding: .25rem; border: 1px solid #55401e; color: #aa9364; background: #100c07; font-size: .7rem; cursor: pointer; }
  .shop-filters input:checked + span { border-color: var(--gold); color: var(--gold-bright); background: #392813; box-shadow: inset 0 -2px #d4a746; }
  .shop-filters input:focus-visible + span { outline: 3px solid #efcf75; outline-offset: 2px; }
  .goods-grid { display: grid; min-height: 0; padding: .1rem; grid-template-columns: repeat(3,minmax(0,1fr)); gap: .45rem; overflow: auto; overscroll-behavior: contain; scrollbar-color: #765522 #110c07; }
  .art8-layout .goods-grid { grid-template-columns: repeat(4,minmax(0,1fr)); }
  .good-card { position: relative; display: grid; min-width: 0; min-height: 8.6rem; padding: .42rem; grid-template-rows: minmax(3.8rem,1fr) auto auto; gap: .25rem; border: 1px solid #4d391e; background: linear-gradient(145deg,#171008,#0c0905); text-align: center; }
  .good-card.selected { border-color: var(--gold); box-shadow: inset 0 0 0 1px #bc8e35, 0 0 12px #d3a33b33; }
  .good-art { position: relative; display: grid; min-width: 0; min-height: 3.8rem; place-items: center; overflow: hidden; color: #e0bd65; font-size: 1.7rem; }
  .good-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .good-icon { display: grid; place-items: center; }
  .good-card h3, .good-card p { margin: 0; min-width: 0; }
  .good-card h3 { color: #e2c989; font: .64rem/1.25 'Cinzel', serif; overflow-wrap: anywhere; }
  .good-card p { color: var(--gold); font-size: .7rem; }
  .good-card > span:last-of-type { color: var(--muted); font-size: .65rem; }
  .good-card > span.sold-out { color: #e7836b; }
  .tile-button { position: absolute; inset: 0; min-width: 44px; min-height: 44px; opacity: 0; cursor: pointer; }
  .tile-button:focus-visible { opacity: 1; outline: 3px solid #efcf75; outline-offset: -3px; background: transparent; }
  .shop-muted { margin: .4rem 0; color: var(--muted); font-size: .85rem; }
  .shop-filter-status { margin: .35rem 0 .6rem; color: #d8bc78; font-size: .75rem; }
  .item-detail { display: grid; min-width: 0; gap: .7rem; align-content: start; padding: 1rem; border: 1px solid #80602d; background: linear-gradient(145deg,#181107,#0e0a05); view-transition-name: shop-detail; }
  .item-detail h2, .item-detail p { margin: 0; }
  .item-detail h2 { color: var(--gold-bright); font: 600 clamp(1rem,2vw,1.35rem) 'Cinzel', serif; }
  .item-detail h2:focus-visible { outline: 2px solid #efcf75; outline-offset: 4px; }
  .item-detail dl { display: grid; gap: .4rem; margin: 0; }
  .item-detail dl div { display: flex; justify-content: space-between; gap: .75rem; }
  .item-detail dt { color: var(--muted); }
  .item-detail dd { margin: 0; color: var(--gold-bright); text-align: right; }
  .detail-illustration, .receipt-item { position: relative; display: grid; place-items: center; overflow: hidden; }
  .detail-illustration { min-height: 11rem; border: 1px solid #765522; color: #e7c96f; background: radial-gradient(circle,#32200d,#130d06); font-size: 4rem; }
  .detail-illustration img, .receipt-item img { position: absolute; inset: .5rem; width: calc(100% - 1rem); height: calc(100% - 1rem); object-fit: contain; }
  .quantity-label { display: grid; gap: .35rem; color: var(--muted); font-size: .78rem; }
  .quantity-label input { width: 100%; min-width: 0; min-height: 44px; padding: .35rem .45rem; border: 1px solid #624a26; color: var(--ink); background: #090704; }
  .detail-total { color: var(--muted); font-size: .78rem; }
  .detail-actions { display: flex; flex-wrap: wrap; gap: .55rem; margin-top: .35rem; }
  .detail-close { justify-self: start; margin-top: .3rem; }
  .secondary-button, .primary-button, .text-button { min-height: 44px; padding: .5rem .7rem; font: 600 .7rem 'Cinzel', serif; cursor: pointer; }
  .secondary-button, .primary-button { border: 1px solid #70552c; color: #d8bc78; background: #1a1309; }
  .primary-button { border-color: #f0c868; color: #191006; background: linear-gradient(#d9a83d,#8c5b14); }
  .text-button { border: 1px solid transparent; color: #d8bc78; background: transparent; }
  .secondary-button:disabled, .primary-button:disabled, .text-button:disabled { cursor: not-allowed; opacity: .55; }
  .secondary-button:focus-visible, .primary-button:focus-visible, .text-button:focus-visible { outline: 3px solid #efcf75; outline-offset: 2px; }
  .shop-message { margin: 1rem; padding: .65rem .8rem; border: 1px solid #506d35; color: #c6d99a; background: #17200e; }
  .shop-message.error { border-color: #8c4939; color: #e4a28e; background: #2a110c; }
  .purchase-complete { padding: 1rem; border: 1px solid #b68c45; background: linear-gradient(135deg,#2b1b09,#140e06); }
  .purchase-complete > p { margin: .35rem 0; }
  .purchase-complete dl { display: grid; gap: .35rem; margin: .8rem 0; }
  .purchase-complete dl div { display: flex; justify-content: space-between; gap: .5rem; }
  .purchase-complete dd { margin: 0; }
  .receipt { width: min(32rem,calc(100% - 2rem)); padding: 1.25rem; border: 2px solid #b18a48; color: #251605; background: linear-gradient(135deg,#f0ddb1,#c9a25e); box-shadow: 0 16px 50px #000d; }
  .receipt::backdrop { background: #000b; backdrop-filter: blur(3px); }
  .receipt-check { float: right; display: grid; width: 2.4rem; height: 2.4rem; place-items: center; border-radius: 50%; color: #eaf3d5; background: #507139; font-weight: bold; }
  .receipt-item { min-height: 9rem; margin: .75rem 0; border: 1px solid #8e713d; color: #765019; background: #ead8ad; font-size: 3rem; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  :global(::view-transition-group(shop-merchant)), :global(::view-transition-group(shop-catalog)), :global(::view-transition-group(shop-detail)) { animation-duration: var(--shop-transition-duration,240ms); animation-timing-function: var(--shop-transition-easing,cubic-bezier(.22,1,.36,1)); }
  :global(::view-transition-old(shop-detail)) { animation: shop-detail-out var(--shop-transition-duration,180ms) var(--shop-transition-easing,cubic-bezier(.4,0,1,1)) both; }
  :global(::view-transition-new(shop-detail)) { animation: shop-detail-in var(--shop-transition-duration,240ms) var(--shop-transition-easing,cubic-bezier(.22,1,.36,1)) both; }
  @keyframes shop-detail-in { from { opacity: 0; transform: translateX(24px); } }
  @keyframes shop-detail-out { to { opacity: 0; transform: translateX(18px); } }

  @media (min-width: 1600px) {
    .art6-layout .goods-grid { grid-template-columns: repeat(4,minmax(0,1fr)); }
  }
  @media (min-width: 800px) {
    .status-more > summary { display: none; }
    .status-more > dl { display: grid; }
  }
  @media (max-width: 1199px) {
    .shop-layout { grid-template-columns: minmax(0,1fr) minmax(0,1fr); }
    .art6-layout .opening-status { grid-column: 1 / -1; display: flex; align-items: center; }
    .art6-layout .opening-status .gold-status { min-width: 9rem; border: 0; }
    .art6-layout .opening-status .status-more { flex: 1; }
    .art6-layout .shop-scene, .art8-layout .shop-scene { grid-column: 1; }
    .art6-layout .shop-goods, .art8-layout .shop-goods { grid-column: 2; }
    .art8-layout .item-detail { grid-column: 1 / -1; }
    .art8-layout .goods-grid { grid-template-columns: repeat(3,minmax(0,1fr)); }
    .shop-goods { max-height: 44rem; }
    @keyframes shop-detail-in { from { opacity: 0; transform: translateY(12px); } }
    @keyframes shop-detail-out { to { opacity: 0; transform: translateY(10px); } }
  }
  @media (max-width: 799px) {
    .shop-layout { width: calc(100% - 1rem); margin: 0 .5rem; grid-template-columns: minmax(0,1fr); }
    .art6-layout .opening-status, .art6-layout .shop-scene, .art6-layout .shop-goods, .art8-layout .shop-scene, .art8-layout .shop-goods, .art8-layout .item-detail { grid-column: 1; }
    .art6-layout .opening-status { display: grid; align-items: stretch; }
    .status-more > summary { display: flex; align-items: center; }
    .shop-goods { max-height: none; }
    .goods-grid, .art8-layout .goods-grid { grid-template-columns: repeat(2,minmax(0,1fr)); overflow: visible; }
    .merchant-heading { position: static; }
    .good-card { min-height: 9.5rem; }
    .detail-illustration { min-height: 10rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(::view-transition-group(shop-merchant)), :global(::view-transition-group(shop-catalog)), :global(::view-transition-group(shop-detail)), :global(::view-transition-old(shop-detail)), :global(::view-transition-new(shop-detail)) { animation-duration: 0s !important; }
  }
</style>
