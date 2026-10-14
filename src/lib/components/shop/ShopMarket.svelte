<script lang="ts">
  import { PUBLIC_SUPABASE_URL } from '$env/static/public';
  import { enhance } from '$app/forms';
  import { beforeNavigate } from '$app/navigation';
import { onDestroy, onMount, tick, untrack } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { GardenCommandKind, GardenCommandPayload, GardenCommandPreview, GameSnapshot, GardenInventoryItem, ShopItem } from '$lib/game/contracts';
  import ShopScene from '$lib/components/shop/ShopScene.svelte';
  import WorkflowHand from '$lib/components/ui/WorkflowHand.svelte';
  import CardWorkflowFrame from '$lib/components/ui/CardWorkflowFrame.svelte';
  import WorkflowInspection from '$lib/components/ui/WorkflowInspection.svelte';
  import AcquisitionReveal from '$lib/components/ui/AcquisitionReveal.svelte';
  import QuantityStepper from '$lib/components/ui/QuantityStepper.svelte';
  import GeneratedSupplies from './GeneratedSupplies.svelte';
  import ShopGoodCard from './ShopGoodCard.svelte';
  import { shopItemAssetPublicUrl } from '$lib/game/shop-runtime-assets';
  import { claimAcquisitionEvent, claimAcquisitionReceipt, type AcquisitionCard } from '$lib/game/acquisition';
  import { sceneRuntimeAssetPublicUrl, type SceneRuntimeAssetId } from '$lib/game/scene-runtime-assets';
  import { resolveBurnAction, waitForBurn, type BurnStyle, type ResolvedBurnAction } from '$lib/card-effects';
  import type { GeneratedSupplies as GeneratedSupplyCatalog, GeneratedSupplyCatalogItem } from '$lib/server/evolving-world/generated-supplies';
  import type { WorkflowChoice } from '$lib/components/ui/workflow';

  type ShopCategory = 'seeds' | 'garden' | 'apiary' | 'provisions';
  type ShopStage = 'categories' | 'items' | 'inspection';
  type ShopCommand = Extract<GardenCommandKind, 'purchase' | 'expand'>;
  type ShopPayload = Extract<GardenCommandPayload, { itemKey: string } | { plotCount: 16 | 24 }>;
  type CompletedOrder = { kind: ShopCommand; itemKey?: string; name: string; quantity?: number; capacity?: number; cost: number; previousGold: number; goldBalance: number };
  type ShopHandEntry =
    | { key: string; kind: 'good'; item: ShopItem }
    | { key: string; kind: 'expansion'; plotCount: number; price: number };
  type Props = { snapshot: GameSnapshot; burnStyle: BurnStyle; supplies?: GeneratedSupplyCatalog | null; form?: { message?: string; error?: boolean } | null };

  let { snapshot, burnStyle, supplies, form }: Props = $props();
  let category = $state<ShopCategory>('seeds');
  let stage = $state<ShopStage>('categories');
  let affordableOnly = $state(false);
  let selectedItemKey = $state<string | null>(null);
  let selectedProvisionKey = $state<string | null>(null);
  let detailMode = $state<'item' | 'expand' | 'provision' | null>(null);
  let detailQuantity = $state(1);
  let availableStock = $state(0);
  let hydrated = $state(false);
  let preview = $state<GardenCommandPreview | null>(null);
  let previewPayload = $state<ShopPayload | null>(null);
  let previewSignature = $state('');
  let pendingAction = $state<{
    signature: string;
    actionId: string;
    revision: number;
    saveId: string;
    commandKind: ShopCommand;
    payload: ShopPayload;
    preview: GardenCommandPreview;
  } | null>(null);
  let pending = $state(false);
  let message = $state<string | null>(null);
  let messageError = $state(false);
  let previewForm: HTMLFormElement | undefined = $state();
  let commitForm: HTMLFormElement | undefined = $state();
  let previewRequest = 0;
  let previewRevision = $state<number | null>(null);
  let observedSaveRevision = $state(untrack(() => snapshot.save.revision));
  let pendingRevisionRefresh = $state(false);
  let completedOrder = $state<CompletedOrder | null>(null);
  let refreshWarning = $state('');
  let receiptBurning = $state(false);
  let receiptBurnAction = $state<ResolvedBurnAction | null>(null);
  let receiptSequence = 0;
  let provisionsBusy = $state(false);
  let handFocusId = $state<string | null>(null);
  let acquisitionCard = $state<AcquisitionCard | null>(null);
  const seenAcquisitionEvents = new Set<string>();

  let garden = $derived(snapshot.garden);
  let goods = $derived(garden?.shop ?? []);
  let inventory = $derived(garden?.inventory ?? []);
  let nextExpansion = $derived(garden?.expansions.find((expansion) => expansion.available) ?? null);
  let capacity = $derived(garden?.plotCount ?? snapshot.cells.filter((cell) => cell.unlocked !== false).length);
  let activeGoods = $derived(goods.filter((item) => itemCategory(item) === category && (!affordableOnly || item.price <= (snapshot.save.gold ?? 0))));
  let selectedItem = $derived(detailMode === 'item' ? goods.find((item) => item.itemKey === selectedItemKey) ?? null : null);
  let selectedProvision = $derived(detailMode === 'provision' ? supplies?.catalog.find((item) => item.itemKey === selectedProvisionKey) ?? null : null);
  let forgetfulnessStock = $derived(snapshot.dailyDeck?.provisions?.potionOfForgetfulness ?? 0);
  let removableSocialCopies = $derived((snapshot.dailyDeck?.cards ?? []).filter((card: { id: string; kind: string; pile: string; displayName: string }) => (
    card.kind === 'social' && card.pile !== 'consumed' && !snapshot.dailyDeck?.pending.removals.includes(card.id)
  )));
  let handEntries = $derived.by(() => {
    if (category === 'provisions') return [] as ShopHandEntry[];
    const entries: ShopHandEntry[] = activeGoods.map((item) => ({ key: item.itemKey, kind: 'good', item }));
    if (category === 'garden' && nextExpansion && (!affordableOnly || nextExpansion.price <= (snapshot.save.gold ?? 0))) {
      entries.push({ key: `garden-expansion-${nextExpansion.plotCount}`, kind: 'expansion', plotCount: nextExpansion.plotCount, price: nextExpansion.price });
    }
    return entries;
  });
  let handItems = $derived.by((): WorkflowChoice[] => {
    if (stage === 'categories') {
      return categoryOptions.map((option) => ({
        id: `category:${option.key}`,
        title: option.label,
        description: option.description,
        eyebrow: 'Shop category',
        icon: option.icon,
        meta: `${categoryCount(option.key)} available`,
        actionLabel: 'Browse',
        burn: true
      }));
    }
    if (category === 'provisions') {
      return (supplies?.catalog ?? []).map((item) => ({
        id: `provision:${item.itemKey}`,
        title: item.name,
        description: 'A settlement provision for your tavern pantry.',
        eyebrow: 'Provision',
        icon: '✧',
        meta: `${item.price} gold · ${item.remainingStock} in stock`,
        actionLabel: 'Inspect',
        burn: true
      }));
    }
    return handEntries.map((entry) => entry.kind === 'good'
      ? {
          id: `good:${entry.item.itemKey}`,
          title: entry.item.name,
          description: effectDescription(entry.item),
          eyebrow: itemCategory(entry.item),
          icon: itemIcon(entry.item),
          meta: `${entry.item.price} gold · ${entry.item.remainingStock === 0 ? 'sold out' : `${entry.item.remainingStock} in stock`}`,
          actionLabel: 'Inspect',
          burn: true
        }
      : {
          id: `expansion:${entry.plotCount}`,
          title: `Open ${entry.plotCount} garden plots`,
          description: 'Make room for a larger garden.',
          eyebrow: 'Garden care',
          icon: '⌂',
          meta: `${entry.price} gold`,
          actionLabel: 'Inspect',
          burn: true
        });
  });
  let focusedChoice = $derived.by((): WorkflowChoice => {
    if (completedOrder) {
      return {
        id: 'shop-receipt-ready', title: completedOrder.kind === 'expand' ? 'Garden expanded' : 'Purchase complete',
        description: 'Elara has recorded the completed order.', eyebrow: 'Receipt', icon: completedOrder.kind === 'expand' ? '⌂' : '✿',
        meta: `${completedOrder.cost} gold paid`, actionLabel: 'Preparing receipt', disabled: true
      };
    }
    if (detailMode === 'item' && selectedItem) {
      const retryingUnknownOrder = !!pendingAction && messageError;
      const canBuy = retryingUnknownOrder || quantityLimit > 0 && hydrated && hasCurrentPreview && preview?.canCommit === true;
      const price = pendingAction?.preview.goldCost ?? preview?.goldCost ?? detailTotal;
      return {
        id: `good:${selectedItem.itemKey}`, title: selectedItem.name, description: effectDescription(selectedItem), eyebrow: 'Elara’s ledger', icon: itemIcon(selectedItem),
        meta: `${selectedItem.price} gold each · ${selectedItem.remainingStock} in stock`,
        actionLabel: pending ? 'Checking order…' : pendingAction && messageError ? `Retry · Buy for ${price} gold` : canBuy ? `Buy for ${price} gold` : quantityLimit === 0 ? 'Out of stock' : hasCurrentPreview && preview?.canCommit === false ? 'Order unavailable' : 'Preparing order…',
        disabled: !canBuy || pending || receiptBurning
      };
    }
    if (detailMode === 'expand' && nextExpansion) {
      const retryingUnknownOrder = !!pendingAction && messageError;
      const canBuy = retryingUnknownOrder || hydrated && hasCurrentPreview && preview?.canCommit === true;
      const price = pendingAction?.preview.goldCost ?? preview?.goldCost ?? nextExpansion.price;
      return {
        id: `expansion:${nextExpansion.plotCount}`, title: `Expand to ${nextExpansion.plotCount} plots`, description: 'Open new ground for a larger garden and more room to grow.', eyebrow: 'Garden capacity', icon: '⌂',
        meta: `${capacity} plots now · ${price} gold`,
        actionLabel: pending ? 'Checking order…' : pendingAction && messageError ? 'Retry garden expansion' : canBuy ? `Expand for ${price} gold` : hasCurrentPreview && preview?.canCommit === false ? 'Expansion unavailable' : 'Preparing order…',
        disabled: !canBuy || pending || receiptBurning
      };
    }
    return { id: 'shop-inspection-unavailable', title: 'Item unavailable', disabled: true };
  });
  let selectedChoiceId = $derived(
    detailMode === 'item' && selectedItemKey ? `good:${selectedItemKey}`
      : detailMode === 'expand' && nextExpansion ? `expansion:${nextExpansion.plotCount}`
        : detailMode === 'provision' && selectedProvisionKey ? `provision:${selectedProvisionKey}` : null
  );
  let currentPayload = $derived<ShopPayload | null>(detailMode === 'item' && selectedItem
    ? { itemKey: selectedItem.itemKey, quantity: detailQuantity }
    : detailMode === 'expand' && nextExpansion ? { plotCount: nextExpansion.plotCount } : null);
  let detailTotal = $derived(selectedItem && Number.isFinite(detailQuantity) ? selectedItem.price * detailQuantity : 0);
  let hasCurrentPreview = $derived(
    !!preview && !!currentPayload &&
    previewSignature === signature(detailMode === 'expand' ? 'expand' : 'purchase', currentPayload) &&
    previewRevision === snapshot.save.revision && preview.basedOnRevision === previewRevision
  );
  let quantityLimit = $derived(selectedItem ? Math.min(20, Math.max(0, availableStock)) : 0);
  let authoritativeDetailTotal = $derived(hasCurrentPreview ? previewNumber('goldCost') : detailTotal);
  let currentDetailGold = $derived(hasCurrentPreview && typeof preview?.goldBalance === 'number' ? preview.goldBalance : snapshot.save.gold ?? 0);
  let projectedGold = $derived(currentDetailGold - authoritativeDetailTotal);
  let completedItem = $derived(completedOrder?.itemKey ? goods.find((item) => item.itemKey === completedOrder?.itemKey) ?? null : null);
  let pendingRetryChoice = $derived.by((): WorkflowChoice => {
    const action = pendingAction;
    if (!action) return { id: 'shop-retry-unavailable', title: 'Order result unknown', disabled: true };
    if (action.commandKind === 'purchase' && 'itemKey' in action.payload) {
      const itemKey = action.payload.itemKey;
      const item = goods.find((candidate) => candidate.itemKey === itemKey);
      const quantity = 'quantity' in action.payload ? action.payload.quantity : 1;
      const name = item?.name ?? itemKey;
      return {
        id: `shop-retry:${action.actionId}`,
        title: name,
        description: `Retry the same ${quantity} × ${name} purchase to recover its result.`,
        eyebrow: 'Order recovery',
        icon: item ? itemIcon(item) : '✿',
        meta: `${action.preview.goldCost ?? 'Price checked'} gold`,
        actionLabel: 'Retry purchase',
        disabled: pending || !messageError
      };
    }
    const plotCount = 'plotCount' in action.payload ? action.payload.plotCount : 0;
    return {
      id: `shop-retry:${action.actionId}`,
      title: plotCount ? `Expand to ${plotCount} plots` : 'Garden expansion',
      description: 'Retry the same expansion to recover its result.',
      eyebrow: 'Order recovery',
      icon: '⌂',
      meta: `${action.preview.goldCost ?? 'Price checked'} gold`,
      actionLabel: 'Retry garden expansion',
      disabled: pending || !messageError
    };
  });

  $effect(() => {
    const revision = snapshot.save.revision;
    const hasPendingAction = !!pendingAction;
    const isCompleted = !!completedOrder;
    const mode = detailMode === 'item' ? 'item' : detailMode === 'expand' ? 'expand' : null;

    if (revision !== observedSaveRevision) {
      observedSaveRevision = revision;
      if (hasPendingAction) {
        pendingRevisionRefresh = true;
        return;
      }
      if (mode && !isCompleted) queuePreviewRefresh(revision, mode);
      return;
    }

    if (!hasPendingAction && pendingRevisionRefresh) {
      pendingRevisionRefresh = false;
      if (mode && !isCompleted) queuePreviewRefresh(revision, mode);
    }
  });

  const categoryOptions: Array<{ key: ShopCategory; label: string; icon: string; description: string }> = [
    { key: 'seeds', label: 'Seeds', icon: '✿', description: 'Choose what takes root.' },
    { key: 'garden', label: 'Garden care', icon: '❋', description: 'Feed the soil and open room to grow.' },
    { key: 'apiary', label: 'Apiary', icon: '⌘', description: 'Care for hives and their colonies.' },
    { key: 'provisions', label: 'Provisions', icon: '✧', description: 'Browse goods discovered by your settlement.' }
  ];

  const sceneAsset = (id: SceneRuntimeAssetId) => sceneRuntimeAssetPublicUrl(id, PUBLIC_SUPABASE_URL);
  const shopSceneAssets = $derived({
    'shop-background': { src: sceneAsset('shop-background'), alt: 'A warm garden shop counter' },
    'shop-elara': { src: sceneAsset('shop-elara'), alt: 'Elara Greenbloom at her garden shop counter' },
    'shop-counter-occlusion': { src: sceneAsset('shop-counter-occlusion'), alt: '' }
  });

  onMount(() => { hydrated = true; });
  onDestroy(() => { receiptSequence += 1; });
  beforeNavigate(({ cancel }) => {
    if (pendingAction || provisionsBusy) cancel();
  });

  function categoryCount(key: ShopCategory) {
    if (key === 'provisions') return supplies?.catalog.length ?? 0;
    const gold = snapshot.save.gold ?? 0;
    const stocked = goods.filter((item) => itemCategory(item) === key && (!affordableOnly || item.price <= gold)).length;
    const expansionCount = key === 'garden' && nextExpansion && (!affordableOnly || nextExpansion.price <= gold) ? 1 : 0;
    return stocked + expansionCount;
  }

  function categoryFromChoice(id: string) {
    return categoryOptions.find((option) => id === `category:${option.key}`) ?? null;
  }

  function itemFromChoice(id: string) {
    return goods.find((item) => id === `good:${item.itemKey}`) ?? null;
  }

  function expansionFromChoice(id: string) {
    const entry = handEntries.find((candidate) => candidate.kind === 'expansion' && id === `expansion:${candidate.plotCount}`);
    return entry?.kind === 'expansion' ? entry : null;
  }

  function provisionFromChoice(id: string) {
    return supplies?.catalog.find((item) => id === `provision:${item.itemKey}`) ?? null;
  }

  function itemCategory(item: Omit<GardenInventoryItem, 'quantity'>): Exclude<ShopCategory, 'provisions'> {
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

  function provisionIcon(_item: GeneratedSupplyCatalogItem) {
    return '✧';
  }

  async function refocusHand(id: string | null) {
    handFocusId = null;
    await tick();
    handFocusId = id;
  }

  function selectCategory(nextCategory: ShopCategory) {
    if (pendingAction || pending || provisionsBusy) return;
    category = nextCategory;
    stage = 'items';
    selectedItemKey = null;
    selectedProvisionKey = null;
    detailMode = null;
    affordableOnly = false;
    message = null;
    messageError = false;
    invalidatePreview();
    void refocusHand(handItems[0]?.id ?? null);
  }

  function selectItem(item: ShopItem) {
    if (pendingAction || provisionsBusy) return;
    selectedItemKey = item.itemKey;
    selectedProvisionKey = null;
    detailMode = 'item';
    stage = 'inspection';
    detailQuantity = 1;
    availableStock = Math.max(0, item.remainingStock);
    affordableOnly = false;
    message = null;
    messageError = false;
    invalidatePreview();
    void tick().then(() => requestPreview('item'));
  }

  function selectExpansion() {
    if (pendingAction || provisionsBusy || !nextExpansion) return;
    selectedItemKey = null;
    selectedProvisionKey = null;
    detailMode = 'expand';
    stage = 'inspection';
    message = null;
    messageError = false;
    invalidatePreview();
    void tick().then(() => requestPreview('expand'));
  }

  function selectProvision(item: GeneratedSupplyCatalogItem) {
    if (pendingAction || pending || provisionsBusy) return;
    selectedItemKey = null;
    selectedProvisionKey = item.itemKey;
    detailMode = 'provision';
    stage = 'inspection';
    message = null;
    messageError = false;
    invalidatePreview();
  }

  function chooseMarketItem(id: string) {
    const categoryChoice = categoryFromChoice(id);
    if (categoryChoice) { selectCategory(categoryChoice.key); return; }
    const item = itemFromChoice(id);
    if (item) { selectItem(item); return; }
    if (expansionFromChoice(id)) { selectExpansion(); return; }
    const provision = provisionFromChoice(id);
    if (provision) selectProvision(provision);
  }

  function goBack() {
    if (stage === 'inspection') { closeDetail(); return; }
    if (stage === 'items') backToCategories();
  }

  function backToCategories() {
    if (pendingAction || pending || provisionsBusy) return;
    const focusId = `category:${category}`;
    category = 'seeds';
    stage = 'categories';
    selectedItemKey = null;
    selectedProvisionKey = null;
    detailMode = null;
    affordableOnly = false;
    invalidatePreview();
    void refocusHand(focusId);
  }

  function closeDetail() {
    if (pendingAction || provisionsBusy || receiptBurning) return;
    const focusId = selectedChoiceId;
    selectedItemKey = null;
    selectedProvisionKey = null;
    detailMode = null;
    stage = 'items';
    invalidatePreview();
    void refocusHand(focusId);
  }

  function showAffordableGoods() {
    if (pendingAction || provisionsBusy) return;
    affordableOnly = true;
    selectedItemKey = null;
    detailMode = null;
    stage = 'items';
    invalidatePreview();
    void refocusHand(handItems[0]?.id ?? null);
  }

  function correctQuantity() {
    if (pendingAction || !selectedItem || quantityLimit === 0) return;
    detailQuantity = quantityLimit;
    invalidatePreview();
    void tick().then(() => requestPreview('item'));
  }

  function adjustQuantity(nextQuantity: number) {
    if (pendingAction || !selectedItem || quantityLimit === 0) return;
    if (!Number.isSafeInteger(nextQuantity) || nextQuantity < 1 || nextQuantity > quantityLimit) return;
    detailQuantity = nextQuantity;
    invalidatePreview();
    void tick().then(() => requestPreview('item'));
  }

  function signature(kind: ShopCommand | undefined, payload: ShopPayload | null) {
    return `${kind ?? 'none'}:${JSON.stringify(payload)}`;
  }

  function purchaseSummary(payload: ShopPayload | null) {
    if (!payload || !('itemKey' in payload) || !('quantity' in payload)) return null;
    const item = goods.find((candidate) => candidate.itemKey === payload.itemKey);
    const held = inventory.find((candidate) => candidate.itemKey === payload.itemKey)?.quantity ?? 0;
    return { name: item?.name ?? payload.itemKey, quantity: payload.quantity, held, after: held + payload.quantity };
  }

  function onProvisionAcquired(event: { actionId: string; item: GeneratedSupplyCatalogItem }) {
    const eventId = claimAcquisitionEvent('purchase', event.actionId, true, seenAcquisitionEvents);
    if (!eventId) return;
    acquisitionCard = {
      id: eventId,
      eyebrow: 'Provision acquired',
      title: event.item.name,
      description: 'Added to your tavern pantry.',
      quantityLabel: '1 provision',
      icon: '✧',
      artKind: 'item',
      details: [{ label: 'Cost', value: `${event.item.price} gold` }]
    };
  }

  function effectDescription(item: ShopItem) {
    const socialFlavor = socialSeedFlavor(item.itemKey);
    if (socialFlavor) return `Grow and harvest this seed to schedule one ${socialFlavor} social copy for tomorrow's deck.`;
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

  function socialSeedFlavor(itemKey: string) {
    return ({
      seed_charm_bloom: 'Charm',
      seed_insight_iris: 'Insight',
      seed_rumor_thyme: 'Rumor'
    } as Record<string, string | undefined>)[itemKey] ?? null;
  }

  function prepareForgetfulness(event: SubmitEvent) {
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const actionId = form.elements.namedItem('actionId');
    if (actionId instanceof HTMLInputElement && !actionId.value) actionId.value = crypto.randomUUID();
  }

  const enhanceForgetfulness: SubmitFunction = ({ formData, formElement }) => {
    const isPotionPurchase = formElement.hasAttribute('data-forgetfulness-purchase');
    const input = formElement.elements.namedItem('actionId');
    const actionId = input instanceof HTMLInputElement && input.value
      ? input.value
      : crypto.randomUUID();
    if (input instanceof HTMLInputElement) input.value = actionId;
    formData.set('actionId', actionId);
    return async ({ result, update }) => {
      const data = 'data' in result
        ? result.data as { receipt?: { actionId?: string; price?: number } } | undefined
        : undefined;
      let completedAcquisition: AcquisitionCard | null = null;

      if (result.type === 'success') {
        const receiptMatchesSubmission = data?.receipt?.actionId === actionId;
        if (receiptMatchesSubmission && input instanceof HTMLInputElement) input.value = '';

        if (isPotionPurchase) {
          const eventId = claimAcquisitionReceipt('purchase', 'purchase', actionId, data?.receipt?.actionId, seenAcquisitionEvents);
          if (eventId) {
            completedAcquisition = {
              id: eventId,
              eyebrow: 'Provision acquired',
              title: 'Potion of Forgetfulness',
              description: 'Schedule one social copy to leave tomorrow.',
              quantityLabel: '1 potion',
              icon: '✧',
              artKind: 'item',
              details: [{ label: 'Cost', value: `${data?.receipt?.price ?? 12} gold` }]
            };
          }
        }
        try { await update({ reset: false, invalidateAll: true }); }
        finally { if (completedAcquisition) acquisitionCard = completedAcquisition; }
        return;
      }

      await update({ reset: false, invalidateAll: false });
    };
  };

  function invalidatePreview() {
    previewRequest += 1;
    pending = false;
    preview = null;
    previewPayload = null;
    previewSignature = '';
    previewRevision = null;
  }

  function queuePreviewRefresh(revision: number, expectedMode: 'item' | 'expand') {
    if (pendingAction || completedOrder) return;
    invalidatePreview();
    void tick().then(() => {
      if (pendingAction || completedOrder || snapshot.save.revision !== revision || detailMode !== expectedMode) return;
      requestPreview(expectedMode);
    });
  }

  function requestPreview(expectedMode: 'item' | 'expand') {
    if (detailMode !== expectedMode || (expectedMode === 'item' && !selectedItem) || (expectedMode === 'expand' && !nextExpansion)) return;
    if (hydrated && !pendingAction && previewForm) previewForm.requestSubmit();
  }

  function previewStatus() {
    if (!preview || preview.commandKind !== 'purchase') return null;
    return typeof preview.status === 'string' ? preview.status : null;
  }

  function previewNumber(key: string) {
    const value = preview?.[key];
    return typeof value === 'number' ? value : 0;
  }

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
      const requestRevision = snapshot.save.revision;
      const requestSignature = signature(kind, payload);
      const expectedMode = kind === 'purchase' ? 'item' : 'expand';
      const requestId = ++previewRequest;
      pending = true;
      message = null;
      return async ({ result, update }) => {
        const data = 'data' in result ? result.data as { preview?: GardenCommandPreview; message?: string } | undefined : undefined;
        if (requestId !== previewRequest) return;
        pending = false;
        if (result.type === 'success' && data?.preview) {
          const payloadStillCurrent = signature(kind, currentPayload) === requestSignature;
          const revisionStillCurrent = snapshot.save.revision === requestRevision;
          const previewRevisionMatches = data.preview.basedOnRevision === requestRevision;
          if (!payloadStillCurrent || !revisionStillCurrent || !previewRevisionMatches) {
            preview = null;
            previewPayload = null;
            previewSignature = '';
            previewRevision = null;
            if (!revisionStillCurrent && detailMode === expectedMode && !pendingAction) {
              observedSaveRevision = snapshot.save.revision;
              queuePreviewRefresh(snapshot.save.revision, expectedMode);
            } else if (!payloadStillCurrent && revisionStillCurrent && detailMode === expectedMode && !pendingAction) {
              queuePreviewRefresh(requestRevision, expectedMode);
            } else if (!previewRevisionMatches && revisionStillCurrent && !pendingAction) {
              await update({ reset: false, invalidateAll: true });
              if (requestId === previewRequest && snapshot.save.revision !== requestRevision && detailMode === expectedMode) {
                observedSaveRevision = snapshot.save.revision;
                pendingRevisionRefresh = false;
                queuePreviewRefresh(snapshot.save.revision, expectedMode);
                return;
              }
              if (requestId === previewRequest && snapshot.save.revision === requestRevision && !pendingAction) {
                message = 'The shop changed while you were choosing. Try adjusting the quantity for a fresh preview.';
                messageError = true;
              }
            }
            return;
          }
          preview = data.preview;
          previewPayload = payload;
          previewSignature = signature(kind, payload);
          previewRevision = requestRevision;
          if (kind === 'purchase' && typeof data.preview.remainingStock === 'number') {
            availableStock = Math.max(0, data.preview.remainingStock);
          }
          messageError = false;
        } else {
          message = data?.message ?? 'Elara cannot prepare that preview right now.';
          messageError = true;
        }
      };
    };
  }

  function confirmShopOrder() {
    if (pending) return;
    if (pendingAction && messageError) {
      commitForm?.requestSubmit();
      return;
    }
    if (!pendingAction && hasCurrentPreview && preview?.canCommit === true && !focusedChoice.disabled) commitForm?.requestSubmit();
  }

  async function showReceiptAfterBurn() {
    const sequence = ++receiptSequence;
    const resolved = resolveBurnAction(burnStyle);
    receiptBurnAction = resolved;
    receiptBurning = true;
    await tick();
    const completed = await waitForBurn(resolved.durationMs);
    if (!completed || sequence !== receiptSequence) return;
    receiptBurning = false;
    await tick();
    handFocusId = 'receipt-continue';
  }

  function resetForAnother() {
    completedOrder = null;
    receiptBurning = false;
    receiptBurnAction = null;
    preview = null;
    previewPayload = null;
    previewSignature = '';
    pendingAction = null;
    detailQuantity = 1;
    detailMode = 'item';
    stage = 'inspection';
    message = null;
    messageError = false;
    invalidatePreview();
    void tick().then(() => requestPreview('item'));
  }

  function continueShopping() {
    const focusId = selectedChoiceId;
    completedOrder = null;
    receiptBurning = false;
    receiptBurnAction = null;
    selectedItemKey = null;
    detailMode = null;
    stage = 'items';
    invalidatePreview();
    void refocusHand(focusId);
  }

  const commitPreview: SubmitFunction = ({ formData, cancel }) => {
    let frozenAction = pendingAction;
    if (frozenAction) {
      if (!messageError) {
        cancel();
        return;
      }
    } else {
      if (!preview || !previewPayload || !hasCurrentPreview || preview.canCommit !== true || preview.basedOnRevision !== snapshot.save.revision) {
        cancel();
        message = 'Ask for a fresh preview before confirming this order.';
        messageError = true;
        return;
      }
      if (preview.commandKind !== 'purchase' && preview.commandKind !== 'expand') {
        cancel();
        message = 'This shop order cannot be completed.';
        messageError = true;
        return;
      }
      frozenAction = {
        signature: signature(preview.commandKind, previewPayload),
        actionId: crypto.randomUUID(),
        revision: snapshot.save.revision,
        saveId: snapshot.save.id,
        commandKind: preview.commandKind,
        payload: previewPayload,
        preview
      };
      pendingAction = frozenAction;
    }
    const committedPreview = frozenAction.preview;
    const committedPayload = frozenAction.payload;
    formData.set('saveId', frozenAction.saveId);
    formData.set('actionId', frozenAction.actionId);
    formData.set('expectedRevision', String(frozenAction.revision));
    formData.set('commandKind', frozenAction.commandKind);
    formData.set('payload', JSON.stringify(frozenAction.payload));
    pending = true;
    message = null;
    return async ({ result, update }) => {
      const data = 'data' in result ? result.data as { message?: string; conflict?: boolean; pendingAction?: object; receipt?: { actionId?: string; result?: Record<string, unknown> } } | undefined : undefined;
      if (result.type === 'error') {
        pending = false;
        message = 'The order outcome is unknown. Retry to recover the same order.';
        messageError = true;
        return;
      }
      if (result.type === 'success') {
        const resultData = data?.receipt?.result;
        let resolvedOrder: CompletedOrder | null = null;
        let completedAcquisition: AcquisitionCard | null = null;
        if (committedPreview.commandKind === 'purchase' && resultData && typeof resultData === 'object') {
          const order = purchaseSummary(committedPayload);
          resolvedOrder = {
            kind: 'purchase', itemKey: 'itemKey' in committedPayload ? committedPayload.itemKey : undefined,
            name: order?.name ?? 'Supplies', quantity: Number(resultData.quantity ?? order?.quantity ?? 0),
            cost: Number(resultData.goldSpent ?? 0), previousGold: Number(resultData.previousGold ?? 0),
            goldBalance: Number(resultData.goldBalance ?? 0)
          };
          message = 'Purchase complete.';
          const eventId = claimAcquisitionReceipt('purchase', committedPreview.commandKind, frozenAction.actionId, data?.receipt?.actionId, seenAcquisitionEvents);
          const purchasedItem = goods.find((candidate) => candidate.itemKey === ('itemKey' in committedPayload ? committedPayload.itemKey : ''));
          if (eventId && purchasedItem) {
            completedAcquisition = {
              id: eventId,
              eyebrow: 'Item acquired',
              title: order?.name ?? purchasedItem.name,
              description: effectDescription(purchasedItem),
              quantityLabel: `${Number(resultData.quantity ?? order?.quantity ?? 1)} acquired`,
              imageSrc: itemArt(purchasedItem),
              icon: itemIcon(purchasedItem),
              artKind: 'item',
              details: [{ label: 'Cost', value: `${Number(resultData.goldSpent ?? 0)} gold` }]
            };
          }
        } else if (committedPreview.commandKind === 'expand') {
          resolvedOrder = {
            kind: 'expand', name: 'Garden expanded', capacity: Number(resultData?.plotCount ?? 0),
            cost: Number(resultData?.goldSpent ?? 0), previousGold: Number(resultData?.previousGold ?? committedPreview.goldBalance ?? snapshot.save.gold ?? 0),
            goldBalance: Number(resultData?.goldBalance ?? 0)
          };
          message = 'Garden expanded.';
          const eventId = claimAcquisitionReceipt('purchase', committedPreview.commandKind, frozenAction.actionId, data?.receipt?.actionId, seenAcquisitionEvents);
          if (eventId) {
            completedAcquisition = {
              id: eventId,
              eyebrow: 'Garden expanded',
              title: 'New ground opened',
              description: 'Elara has made more room for your garden.',
              quantityLabel: `${resolvedOrder.capacity ?? 0} plots available`,
              icon: '⌂',
              artKind: 'item',
              details: [{ label: 'Cost', value: `${resolvedOrder.cost} gold` }]
            };
          }
        }
        messageError = false;
        preview = null;
        previewPayload = null;
        previewSignature = '';
        previewRevision = null;
        refreshWarning = '';
        try { await update({ reset: false, invalidateAll: true }); }
        catch { refreshWarning = 'Your order is confirmed, but updated stock could not be loaded. Refresh the shop before placing another order.'; }
        pending = false;
        pendingAction = null;
        completedOrder = resolvedOrder;
        if (resolvedOrder && detailMode) {
          message = 'Elara has completed the order. Preparing your receipt.';
          await showReceiptAfterBurn();
          message = null;
        }
        if (completedAcquisition) acquisitionCard = completedAcquisition;
        return;
      }
      if (data?.pendingAction) {
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
</script>

{#snippet shopHandCard(choice: WorkflowChoice, _index: number)}
  {@const categoryOption = categoryFromChoice(choice.id)}
  {@const item = itemFromChoice(choice.id)}
  {@const expansion = expansionFromChoice(choice.id)}
  {@const provision = provisionFromChoice(choice.id)}
  {#if categoryOption}
    <div class="shop-hand-card category-card">
      <div class="shop-card-art category-symbol" aria-hidden="true">{categoryOption.icon}</div>
      <div class="shop-card-copy"><p class="eyebrow">Shop category</p><h3>{categoryOption.label}</h3><p>{categoryOption.description}</p></div>
      <div class="shop-card-meta"><span>{categoryCount(categoryOption.key)} available</span><span aria-hidden="true">↗</span></div>
    </div>
  {:else if item}
    {@const artUrl = itemArt(item)}
    <ShopGoodCard
      {item}
      eyebrow={itemCategory(item)}
      detail={`${item.price} gold`}
      meta={item.remainingStock === 0 ? 'Sold out' : `${item.remainingStock} in stock`}
      icon={itemIcon(item)}
      {artUrl}
      category={itemCategory(item)}
      unavailable={item.remainingStock === 0}
    />
  {:else if expansion}
    <div class="shop-hand-card expansion-card" data-shop-category="garden">
      <div class="shop-card-art category-symbol" aria-hidden="true">⌂</div>
      <div class="shop-card-copy"><p class="eyebrow">Garden care</p><h3>Make room to grow</h3><p>Open the garden to {expansion.plotCount} plots.</p></div>
      <div class="shop-card-meta"><span>{expansion.price} gold</span><span aria-hidden="true">↗</span></div>
    </div>
  {:else if provision}
    <div class="shop-hand-card good-card provision-card" data-provision-key={provision.itemKey}>
      <div class="shop-card-art category-symbol" aria-hidden="true">{provisionIcon(provision)}</div>
      <div class="shop-card-copy"><p class="eyebrow">Settlement provision</p><h3>{provision.name}</h3><p>{provision.price} gold</p></div>
      <div class="shop-card-meta"><span class:sold-out={provision.remainingStock === 0}>{provision.remainingStock === 0 ? 'Sold out' : `${provision.remainingStock} in stock`}</span><span aria-hidden="true">↗</span></div>
    </div>
  {/if}
{/snippet}

{#snippet marketScene()}
  <div class="shop-scene-anchor" data-shop-merchant aria-label="Elara Greenbloom at her garden shop counter">
    <ShopScene assets={shopSceneAssets} detailMode={stage === 'inspection'} />
  </div>
{/snippet}

{#snippet marketStatus()}
  <div class="market-status" aria-label="Shop account" data-shop-ready={hydrated}>
    <p class="gold-status"><span>Gold</span><strong>{snapshot.save.gold ?? 0}</strong></p>
    {#if category === 'provisions' && supplies?.inventory.length}
      <details class="pantry-inventory"><summary>Pantry · {supplies.inventory.length}</summary><ul>{#each supplies.inventory as pantryItem (pantryItem.entityId)}<li>{pantryItem.quantity} × {pantryItem.name}</li>{/each}</ul></details>
    {/if}
    {#if category === 'provisions'}
      <form class="forgetfulness-purchase" method="POST" action="?/purchaseForgetfulness" onsubmit={prepareForgetfulness} use:enhance={enhanceForgetfulness} data-forgetfulness-purchase>
        <input type="hidden" name="actionId" value="" />
        <input type="hidden" name="expectedRevision" value={snapshot.save.revision} />
        <span><strong>Potion of Forgetfulness</strong><small>Schedule one social copy to leave tomorrow.</small></span>
        <button type="submit" disabled={(snapshot.save.gold ?? 0) < 12}>Buy · 12 gold</button>
      </form>
      <form class="forgetfulness-form" method="POST" action="?/forgetfulness" onsubmit={prepareForgetfulness} use:enhance={enhanceForgetfulness} data-forgetfulness-use>
        <input type="hidden" name="actionId" value="" />
        <input type="hidden" name="expectedRevision" value={snapshot.save.revision} />
        <label>
          <span>Potion of Forgetfulness · {forgetfulnessStock} held</span>
          <select name="cardId" required disabled={removableSocialCopies.length === 0} aria-label="Choose a social copy to remove tomorrow">
            {#each removableSocialCopies as card, index (card.id)}
              <option value={card.id}>{card.displayName} copy {index + 1}</option>
            {/each}
          </select>
        </label>
        <button type="submit" disabled={forgetfulnessStock === 0 || removableSocialCopies.length === 0}>Schedule removal tomorrow</button>
        {#if forgetfulnessStock === 0}<small>Buy a potion before scheduling a removal.</small>{:else if removableSocialCopies.length === 0}<small>No removable social copies remain.</small>{/if}
        {#if form?.message}<small class:error={form.error}>{form.message}</small>{/if}
      </form>
    {/if}
  </div>
{/snippet}

{#snippet marketControls()}
  {#if stage === 'items' && category !== 'provisions'}
    <button class="market-control" type="button" disabled={pending || !!pendingAction} onclick={() => affordableOnly = !affordableOnly}>
      {affordableOnly ? 'Show all goods' : 'Show what I can afford'}
    </button>
  {/if}
{/snippet}

{#snippet marketHand()}
  {#if completedOrder && !receiptBurning}
    <WorkflowHand
      items={[
        ...(completedOrder.kind === 'purchase' && completedItem && completedItem.remainingStock > 0 && !refreshWarning ? [{ id: 'receipt-another', title: 'Buy another', description: `Inspect another ${completedOrder.name}.`, icon: '↻', actionLabel: 'Inspect' }] : []),
        { id: 'receipt-continue', title: 'Continue shopping', description: 'Return to the goods in this category.', icon: '←', actionLabel: 'Browse' }
      ]}
      label="After your purchase"
      focusId={handFocusId}
      {burnStyle}
      pending={!!refreshWarning}
      onchoose={(id) => id === 'receipt-another' ? resetForAnother() : continueShopping()}
    />
  {:else if handItems.length}
    <WorkflowHand
      items={handItems}
      label={stage === 'categories' ? 'Shop categories' : `${categoryOptions.find((option) => option.key === category)?.label ?? 'Shop'} goods`}
      selectedId={selectedChoiceId}
      focusId={handFocusId}
      {burnStyle}
      pending={pending || !!pendingAction || provisionsBusy || stage === 'inspection'}
      muted={stage === 'inspection'}
      onchoose={chooseMarketItem}
      card={shopHandCard}
    />
  {:else}
    <p class="shop-empty" role="status">
      {#if category === 'provisions'}
        {supplies ? 'No settlement provisions have been discovered yet.' : 'Settlement provisions are unavailable right now.'}
      {:else}
        {affordableOnly ? 'No goods in this category fit your current gold.' : 'No goods are stocked in this category today.'}
      {/if}
    </p>
  {/if}
{/snippet}

{#snippet shopFolio()}
  {#if completedOrder}
    {#if receiptBurning}
      <WorkflowInspection item={focusedChoice} onconfirm={() => undefined} burning burnAction={receiptBurnAction ?? undefined} />
    {:else}
      <section class="shop-receipt" data-shop-receipt aria-labelledby="receipt-title" role="status">
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
        {#if refreshWarning}<p class="receipt-warning" role="alert">{refreshWarning}</p><a class="market-control" href="/shop" data-sveltekit-reload>Refresh shop</a>{/if}
      </section>
    {/if}
  {:else if detailMode === 'item' && selectedItem}
    {@const artUrl = itemArt(selectedItem)}
    <WorkflowInspection
      item={focusedChoice}
      onconfirm={confirmShopOrder}
      oncancel={closeDetail}
      confirmLabel={focusedChoice.actionLabel}
      consequence="Preview the final price and quantity before Elara rings up the order."
      pending={pending}
      error={message && messageError ? message : null}
    >
      {#snippet options()}
        <dl class="inspection-facts">
          <div><dt>Owned</dt><dd>{inventory.find((owned) => owned.itemKey === selectedItem.itemKey)?.quantity ?? 0}</dd></div>
        </dl>
        <QuantityStepper value={detailQuantity} max={quantityLimit} disabled={!!pendingAction} onchange={adjustQuantity} />
        <p class="detail-total">{hasCurrentPreview ? 'Total' : 'Estimated total'} {authoritativeDetailTotal} gold{#if projectedGold >= 0} · {projectedGold} gold remaining{/if}.</p>
        <form bind:this={previewForm} class="hidden-form" method="POST" action="?/preview" use:enhance={previewEnhancer('purchase', detailPayload)}>
          <input type="hidden" name="quantity" value={detailQuantity} />
        </form>
        <form bind:this={commitForm} class="hidden-form" data-shop-commit method="POST" action="?/command" use:enhance={commitPreview}></form>
        {#if quantityLimit === 0}
          <p class="form-message error" role="alert"><strong>Out of stock.</strong> Restocks on tavern day {hasCurrentPreview && typeof preview?.restockDay === 'number' ? preview.restockDay : selectedItem.restockDay}.</p>
        {:else if hasCurrentPreview && preview?.canCommit === false}
          {#if previewStatus() === 'insufficient_gold'}
            <p class="form-message error" role="alert"><strong>Not enough gold.</strong> Need {previewNumber('goldDeficit')} more gold.</p>
            <button class="market-control" type="button" onclick={showAffordableGoods}>View affordable goods</button>
          {:else if previewStatus() === 'exceeds_stock'}
            <p class="form-message error" role="alert">Only {preview.remainingStock ?? 0} left.</p>
            {#if quantityLimit > 0}<button class="market-control" type="button" onclick={correctQuantity}>Use available quantity</button>{/if}
          {:else}
            <p class="form-message error" role="alert">This order cannot be completed.</p>
          {/if}
        {:else if !hasCurrentPreview && !messageError}
          <p class="shop-muted" role="status">Checking Elara’s ledger…</p>
        {/if}
        {#if form?.message}<p class:form-error={form.error} class="form-message" role={form.error ? 'alert' : 'status'}>{form.message}</p>{/if}
      {/snippet}
    </WorkflowInspection>
  {:else if detailMode === 'expand' && nextExpansion}
    <WorkflowInspection
      item={focusedChoice}
      onconfirm={confirmShopOrder}
      oncancel={closeDetail}
      confirmLabel={focusedChoice.actionLabel}
      consequence="Review the expansion before confirming."
      pending={pending}
      error={message && messageError ? message : null}
    >
      {#snippet options()}
        <dl class="inspection-facts">
          <div><dt>Current capacity</dt><dd>{capacity} plots</dd></div>
          <div><dt>New capacity</dt><dd>{nextExpansion.plotCount} plots</dd></div>
          <div><dt>Price</dt><dd>{preview?.goldCost ?? nextExpansion.price} gold</dd></div>
        </dl>
        <form bind:this={previewForm} class="hidden-form" method="POST" action="?/preview" use:enhance={previewEnhancer('expand', expansionPayload)}>
          <input type="hidden" name="plotCount" value={nextExpansion.plotCount} />
        </form>
        <form bind:this={commitForm} class="hidden-form" data-shop-commit method="POST" action="?/command" use:enhance={commitPreview}></form>
        {#if hasCurrentPreview && preview?.canCommit === false}
          <p class="form-message error" role="alert"><strong>Not enough gold.</strong> Need {Math.max(0, previewNumber('goldCost') - previewNumber('goldBalance'))} more gold.</p>
          <button class="market-control" type="button" onclick={showAffordableGoods}>View affordable goods</button>
        {:else if !hasCurrentPreview && !messageError}
          <p class="shop-muted" role="status">Checking Elara’s ledger…</p>
        {/if}
      {/snippet}
    </WorkflowInspection>
  {:else if pendingAction && messageError}
    <WorkflowInspection
      item={pendingRetryChoice}
      onconfirm={confirmShopOrder}
      confirmLabel={pendingRetryChoice.actionLabel}
      pending={pending}
      error={message}
    >
      {#snippet options()}
        <form bind:this={commitForm} class="hidden-form" data-shop-commit method="POST" action="?/command" use:enhance={commitPreview}></form>
      {/snippet}
    </WorkflowInspection>
  {:else if detailMode === 'provision' && selectedProvision && supplies}
    <GeneratedSupplies
      {supplies}
      item={selectedProvision}
      saveId={snapshot.save.id}
      revision={snapshot.save.revision}
      {burnStyle}
      oncancel={closeDetail}
      onbusychange={(busy) => provisionsBusy = busy}
      onacquired={onProvisionAcquired}
    />
  {/if}
{/snippet}

<section class="shop-market" data-shop-market data-shop-stage={completedOrder ? 'result' : detailMode ? 'inspection' : stage} aria-label="Elara Greenbloom’s garden shop">
  <CardWorkflowFrame
    title="Elara’s garden shop"
    eyebrow="Elara Greenbloom · Shop counter"
    location={stage === 'categories' ? 'Choose a category' : `${categoryOptions.find((option) => option.key === category)?.label ?? 'Shop'} · ${stage === 'inspection' ? 'Inspecting' : 'Goods'}`}
    backLabel={completedOrder ? 'Continue shopping' : stage === 'inspection' ? 'All goods' : 'All categories'}
    onback={receiptBurning || refreshWarning ? undefined : completedOrder ? continueShopping : stage === 'categories' ? undefined : goBack}
    inspectionMode={completedOrder && !receiptBurning ? 'folio' : stage === 'inspection' ? 'center' : 'folio'}
    scene={marketScene}
    status={marketStatus}
    controls={marketControls}
    folio={stage === 'inspection' && !acquisitionCard ? shopFolio : undefined}
    hand={marketHand}
  />
  {#if acquisitionCard}
    <AcquisitionReveal open {...acquisitionCard} ondismiss={() => acquisitionCard = null} />
  {/if}

  {#if message && !preview && !completedOrder && !detailMode}
    <p class="shop-message" class:error={messageError} role={messageError ? 'alert' : 'status'} aria-live="polite">{message}</p>
  {/if}


</section>

<style>
  .shop-market { width: min(1600px, calc(100% - 24px)); margin: 1rem auto; color: #f0dfb8; }
  .shop-scene-anchor { position: absolute; inset: 0; overflow: hidden; background: #130d06; }
  .shop-scene-anchor :global(.shop-composed-scene) { width: 100%; height: 100%; min-height: 0; max-width: none; aspect-ratio: auto; margin: 0; }
  .market-status { display: flex; align-items: center; justify-content: end; gap: .8rem; }
  .gold-status { display: grid; gap: .05rem; justify-items: end; margin: 0; color: #e0d1ac; font-size: .7rem; }
  .gold-status strong { color: #f0d58c; font: 600 1.2rem 'Cinzel', serif; }
  .pantry-inventory { max-width: 15rem; padding: .35rem .5rem; border: 1px solid #957440; border-radius: .45rem; color: #ead9b4; background: #1a120be8; font-size: .7rem; }
  .pantry-inventory summary { cursor: pointer; }
  .pantry-inventory ul { display: grid; gap: .2rem; margin: .4rem 0 0; padding-left: 1rem; }
  .forgetfulness-form { display: grid; grid-template-columns: minmax(10rem, 1fr) auto; gap: .3rem .45rem; max-width: 24rem; padding: .35rem .5rem; border: 1px solid #80609d; border-radius: .45rem; background: #170d22ed; color: #ead9f4; font-size: .68rem; }
  .forgetfulness-purchase { display: grid; grid-template-columns: minmax(10rem, 1fr) auto; gap: .35rem; max-width: 24rem; padding: .4rem .5rem; border: 1px solid #80609d; border-radius: .45rem; background: #170d22ed; color: #ead9f4; font-size: .68rem; }
  .forgetfulness-purchase span { display: grid; gap: .12rem; }
  .forgetfulness-purchase small { color: #cab7d8; }
  .forgetfulness-purchase button { min-height: 2rem; border: 1px solid #a880bd; border-radius: .3rem; color: #f3dcff; background: #321746; font: inherit; font-size: .68rem; cursor: pointer; }
  .forgetfulness-purchase button:disabled { cursor: not-allowed; opacity: .62; }
  .forgetfulness-form label { display: grid; gap: .2rem; }
  .forgetfulness-form select { min-width: 0; border: 1px solid #9672af; border-radius: .25rem; color: #f1e4fc; background: #21122e; font: inherit; }
  .forgetfulness-form button { align-self: end; min-height: 2rem; border: 1px solid #a880bd; border-radius: .3rem; color: #f3dcff; background: #321746; font: inherit; font-size: .68rem; cursor: pointer; }
  .forgetfulness-form button:disabled { cursor: not-allowed; opacity: .62; }
  .forgetfulness-form small { grid-column: 1 / -1; color: #cab7d8; }
  .forgetfulness-form small.error { color: #f1a29a; }
  .market-control { min-height: 40px; padding: .45rem .65rem; border: 1px solid #a17c3c; border-radius: .4rem; color: #f0d58c; background: #20170bd9; font: inherit; font-size: .75rem; cursor: pointer; }
  .market-control:disabled { cursor: not-allowed; opacity: .58; }
  .market-control:focus-visible { outline: 2px solid #ffe49c; outline-offset: 2px; }
  .shop-hand-card { display: grid; height: 100%; min-height: 12rem; grid-template-rows: minmax(4rem, auto) 1fr auto; gap: .5rem; }
  .shop-card-art { position: relative; display: grid; min-height: 4.4rem; place-items: center; overflow: hidden; color: #f0d58c; background: radial-gradient(circle, #3d2a14, #120c06); font-size: 2.3rem; }
  .category-symbol { width: 4rem; min-height: 4rem; border: 1px solid #8b6d37; border-radius: 50%; background: radial-gradient(circle, #583d1e, #1a1007); }
  .shop-card-copy { min-width: 0; align-self: center; }
  .shop-card-copy .eyebrow { color: #b6d382; font: 600 .62rem 'Cinzel', serif; letter-spacing: .1em; text-transform: uppercase; }
  .shop-card-copy h3 { margin: .2rem 0 .35rem; color: #f1d990; font: 600 .92rem/1.2 'Cinzel', serif; overflow-wrap: anywhere; }
  .shop-card-copy p:not(.eyebrow) { margin: .25rem 0 0; color: #c9bc9c; font-size: .74rem; line-height: 1.4; }
  .shop-card-meta { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding-top: .45rem; border-top: 1px solid #70562c; color: #d1b979; font-size: .7rem; }
  .shop-card-meta > span:last-child { color: #f0d58c; font-size: .95rem; }
  .sold-out { color: #e7836b !important; }
  .good-card .shop-card-copy h3 { font-size: .86rem; }
  .expansion-card { border-color: #8e713a; }
  .shop-empty { max-width: 36rem; margin: 0 auto 1.2rem; padding: .85rem 1rem; border: 1px solid #816434; border-radius: .6rem; color: #e2d2ad; background: #160f09df; text-align: center; font-size: .85rem; }
  .inspection-facts { display: grid; gap: .4rem; margin: 0; padding: .65rem .75rem; border: 1px solid #8a6a3766; border-radius: .5rem; background: #171109db; font-size: .8rem; }
  .inspection-facts div { display: flex; justify-content: space-between; gap: .75rem; }
  .inspection-facts dt { color: #c7b991; }
  .inspection-facts dd { margin: 0; color: #f0d58c; text-align: right; }
  .detail-total { margin: -.2rem 0 0; color: #d3bb7d; font-size: .8rem; }
  .hidden-form { display: none; }
  .form-message { margin: 0; color: #d5e2b7; font-size: .8rem; line-height: 1.45; }
  .form-message.error, .form-message.form-error, .shop-message.error { color: #e7a08d; }
  .shop-muted { margin: 0; color: #c7b991; font-size: .8rem; }
  .shop-message { margin: .65rem 0; padding: .6rem .8rem; border: 1px solid #88693a; border-radius: .5rem; background: #1a120be8; text-align: center; }
  .shop-receipt { display: grid; gap: .7rem; }
  .shop-receipt h2, .shop-receipt p { margin: 0; }
  .shop-receipt dl { display: grid; gap: .55rem; margin: .25rem 0; }
  .shop-receipt dl > div { display: flex; justify-content: space-between; border-top: 1px solid #92754455; padding-top: .55rem; }
  .shop-receipt dd { margin: 0; font-weight: 700; }
  .receipt-item { position: relative; min-height: 7rem; display: grid; place-items: center; color: #d4b478; font-size: 3rem; }
  .receipt-item img { position: absolute; inset: .5rem; width: calc(100% - 1rem); height: calc(100% - 1rem); object-fit: contain; }
  .receipt-warning { color: #ffe2cc; }
  @media (max-width: 700px) {
    .shop-market { width: calc(100% - 12px); margin: .4rem auto; }
    .market-status { gap: .4rem; }
    .gold-status strong { font-size: 1rem; }
    .pantry-inventory { max-width: 10rem; }
    .shop-hand-card { min-height: 10.5rem; gap: .35rem; }
    .shop-card-copy h3 { font-size: .82rem; }
    .shop-card-copy p:not(.eyebrow) { font-size: .68rem; }
    .shop-card-meta { font-size: .65rem; }
  }
  @media (prefers-reduced-motion: reduce) { .shop-market :global(.card-workflow-frame) { scroll-behavior: auto; } }
</style>
