<script lang="ts">
  import { PUBLIC_SUPABASE_URL } from '$env/static/public';
  import { enhance } from '$app/forms';
  import { beforeNavigate } from '$app/navigation';
  import { onDestroy, onMount, tick } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { GardenCommandKind, GardenCommandPayload, GardenCommandPreview, GameSnapshot, GardenInventoryItem, ShopItem } from '$lib/game/contracts';
  import ShopScene from '$lib/components/shop/ShopScene.svelte';
  import CardBurnSurface from '$lib/components/ui/CardBurnSurface.svelte';
  import GeneratedSupplies from './GeneratedSupplies.svelte';
  import { shopItemAssetPublicUrl } from '$lib/game/shop-runtime-assets';
  import { sceneRuntimeAssetPublicUrl, type SceneRuntimeAssetId } from '$lib/game/scene-runtime-assets';
  import { resolveBurnAction, waitForBurn, type BurnStyle, type BurnTreatment } from '$lib/card-effects';
  import type { GeneratedSupplies as GeneratedSupplyCatalog } from '$lib/server/evolving-world/generated-supplies';

type ShopCategory = 'seeds' | 'garden' | 'apiary';
type ShopStage = 'categories' | 'items' | 'inspection' | 'provisions';
  type ShopCommand = Extract<GardenCommandKind, 'purchase' | 'expand'>;
  type ShopPayload = Extract<GardenCommandPayload, { itemKey: string } | { plotCount: 16 | 24 }>;
type CompletedOrder = { kind: ShopCommand; itemKey?: string; name: string; quantity?: number; capacity?: number; cost: number; previousGold: number; goldBalance: number };
type ShopHandEntry =
  | { key: string; kind: 'good'; item: ShopItem }
  | { key: string; kind: 'expansion'; plotCount: number; price: number };
type RectBox = { left: number; top: number; width: number; height: number };
type ActiveBurn = { id: number; purpose: 'category' | 'siblings' | 'receipt'; keys: string[]; treatment: BurnTreatment; durationMs: number };
type InspectionBridge = { id: number; from: RectBox; to: RectBox; phase: 'from' | 'to'; title: string; icon: string; art: string | null; price: number };

type Props = { snapshot: GameSnapshot; burnStyle: BurnStyle; supplies?: GeneratedSupplyCatalog | null; form?: { message?: string; error?: boolean } | null };
let { snapshot, burnStyle, supplies, form }: Props = $props();

  let category = $state<ShopCategory>('seeds'); let stage = $state<ShopStage>('categories');
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
  let completedInspectionHeight = $state(0);
  let completedInspectionTitle = $state('');
  let refreshWarning = $state('');
  let receiptDialog: HTMLDialogElement | undefined = $state();
  let successAction: HTMLButtonElement | undefined = $state();
  let goodsGrid: HTMLDivElement | undefined = $state(); let detailPanel: HTMLElement | undefined = $state();
  let prefersReducedMotion = $state(false); let activeBurn = $state<ActiveBurn | null>(null); let inspectionBridge = $state<InspectionBridge | null>(null); let stageBeforeProvisions = $state<ShopStage>('categories'); let provisionsBusy = $state(false); let burnSequence = 0; let bridgeSequence = 0; let burnCompletionKeys = new Set<string>(); let burnCompletion: (() => void) | null = null; let transitionReturnFocusId = ''; let bridgeController: AbortController | null = null;
  let focusRequest = 0;
  let resizeFrame = 0;
  let browseScrollTop = 0;
  let browseFocusId = '';

  let garden = $derived(snapshot.garden);
  let goods = $derived(garden?.shop ?? []);
  let inventory = $derived(garden?.inventory ?? []);
  let nextExpansion = $derived(garden?.expansions.find((expansion) => expansion.available) ?? null);
  let capacity = $derived((garden?.plotCount ?? snapshot.cells.filter((cell) => cell.unlocked !== false).length));
  let activeGoods = $derived(goods.filter((item) => itemCategory(item) === category && (!affordableOnly || item.price <= (snapshot.save.gold ?? 0))));;
  let selectedItem = $derived(detailMode === 'item' ? activeGoods.find((item) => item.itemKey === selectedItemKey) ?? null : null); let handEntries = $derived.by(() => { const entries: ShopHandEntry[] = activeGoods.map((item) => ({ key: item.itemKey, kind: 'good', item })); if (category === 'garden' && nextExpansion && (!affordableOnly || nextExpansion.price <= (snapshot.save.gold ?? 0))) entries.push({ key: `garden-expansion-${nextExpansion.plotCount}`, kind: 'expansion', plotCount: nextExpansion.plotCount, price: nextExpansion.price }); return entries; });
  let completedItem = $derived(completedOrder?.itemKey ? goods.find((item) => item.itemKey === completedOrder?.itemKey) ?? null : null);
  let detailTotal = $derived(selectedItem ? selectedItem.price * detailQuantity : 0);
  let projectedGold = $derived((snapshot.save.gold ?? 0) - detailTotal);
  let currentPayload = $derived<ShopPayload | null>(detailMode === 'item' && selectedItem ? { itemKey: selectedItem.itemKey, quantity: detailQuantity } : detailMode === 'expand' && nextExpansion ? { plotCount: nextExpansion.plotCount } : null);
  let hasCurrentPreview = $derived(!!preview && !!currentPayload && previewSignature === signature(detailMode === 'expand' ? 'expand' : 'purchase', currentPayload));

  const categoryOptions: Array<{ key: ShopCategory; label: string; icon: string; description: string }> = [
  { key: 'seeds', label: 'Seeds', icon: '✿', description: 'Choose what takes root.' },
  { key: 'garden', label: 'Garden care', icon: '❋', description: 'Feed the soil and open room to grow.' },
  { key: 'apiary', label: 'Apiary', icon: '⌘', description: 'Care for hives and their colonies.' }
];;

  const portraitAssetUrl = '/assets/scenes/shop/elara-portrait.webp';
  /**
   * Composition keys are stable presentation IDs. Their WebP URLs are local
   * fixture media, so an unseeded environment falls back inside ShopScene.
   */
  const sceneAsset = (id: SceneRuntimeAssetId) => sceneRuntimeAssetPublicUrl(id, PUBLIC_SUPABASE_URL);
  const shopSceneAssets = $derived({
    'shop-background': { src: sceneAsset('shop-background'), alt: 'A warm garden shop counter' },
    'shop-elara': { src: sceneAsset('shop-elara'), alt: 'Elara Greenbloom at her garden shop counter' },
    'shop-counter-occlusion': { src: sceneAsset('shop-counter-occlusion'), alt: '' }
  });

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

  const BRIDGE_DURATION_MS = 380;
function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}
function categoryCardId(key: ShopCategory) {
  return 'shop-category-' + key;
}
function goodCardId(key: string) {
  return 'shop-good-' + safeId(key);
}
function categoryCount(key: ShopCategory) {
  const gold = snapshot.save.gold ?? 0;
  const stocked = goods.filter((item) => itemCategory(item) === key && (!affordableOnly || item.price <= gold)).length;
  const expansionCount = key === 'garden' && nextExpansion && (!affordableOnly || nextExpansion.price <= gold) ? 1 : 0;
  return stocked + expansionCount;
}
function fanStyle(index: number, count: number) {
  const middle = (count - 1) / 2;
  const distance = index - middle;
  const tilt = Math.max(-23, Math.min(23, distance * 6.5));
  const lift = -Math.max(0, 3 - Math.abs(distance)) * 5;
  const delay = Math.abs(distance) * 18;
  return '--tilt:' + tilt + 'deg;--lift:' + lift + 'px;--deal-delay:' + delay + 'ms';
}
function captureRect(id: string): RectBox | null {
  const element = document.getElementById(id);
  if (!element) return null;
  const bounds = element.getBoundingClientRect();
  return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
}
function rectBox(bounds: DOMRect): RectBox {
  return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
}
function bridgeStyle(bridge: InspectionBridge) {
  const bounds = bridge.phase === 'from' ? bridge.from : bridge.to;
  return '--bridge-left:' + bounds.left + 'px;--bridge-top:' + bounds.top + 'px;--bridge-width:' + bounds.width + 'px;--bridge-height:' + bounds.height + 'px';
}
function startBurnAction(purpose: ActiveBurn['purpose'], keys: string[], onComplete: () => void, restoreFocusId = '') {
  if (keys.length === 0) {
    onComplete();
    return;
  }
  if (purpose !== 'receipt' && (pendingAction || activeBurn || inspectionBridge)) return;
  const resolved = resolveBurnAction(burnStyle);
  const id = ++burnSequence;
  burnCompletionKeys = new Set(keys);
  burnCompletion = onComplete;
  transitionReturnFocusId = restoreFocusId;
  activeBurn = { id, purpose, keys, treatment: resolved.treatment, durationMs: resolved.durationMs };
  if (purpose !== 'receipt') {
    void tick().then(() => document.getElementById('shop-transition-cancel')?.focus({ preventScroll: true }));
  }
}
function finishBurnSurface(id: number, key: string) {
  if (!activeBurn || activeBurn.id !== id || !burnCompletionKeys.has(key)) return;
  burnCompletionKeys.delete(key);
  if (burnCompletionKeys.size > 0) return;
  const onComplete = burnCompletion;
  burnCompletion = null;
  activeBurn = null;
  transitionReturnFocusId = '';
  onComplete?.();
}
function cancelPreRequestBurn() {
  if (!activeBurn || activeBurn.purpose === 'receipt' || pendingAction) return;
  const focusId = transitionReturnFocusId;
  burnSequence += 1;
  activeBurn = null;
  burnCompletion = null;
  burnCompletionKeys.clear();
  transitionReturnFocusId = '';
  void tick().then(() => {
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  });
}
function cancelInspectionBridge() {
  bridgeSequence += 1;
  bridgeController?.abort();
  bridgeController = null;
  inspectionBridge = null;
}
async function animateInspectionBridge(
  source: RectBox | null,
  entry: { title: string; icon: string; art: string | null; price: number }
) {
  if (!source || prefersReducedMotion) return;
  cancelInspectionBridge();
  const id = ++bridgeSequence;
  const controller = new AbortController();
  bridgeController = controller;
  inspectionBridge = { id, from: source, to: source, phase: 'from', ...entry };
  await tick();
  const target = detailPanel?.getBoundingClientRect();
  if (!target) {
    if (bridgeSequence === id) {
      inspectionBridge = null;
      bridgeController = null;
    }
    return;
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (controller.signal.aborted || bridgeSequence !== id) return;
  const current = inspectionBridge;
  if (!current || current.id !== id) return;
  inspectionBridge = { ...current, to: rectBox(target), phase: 'to' };
  const completed = await waitForBurn(BRIDGE_DURATION_MS, controller.signal);
  if (!completed || controller.signal.aborted || bridgeSequence !== id) return;
  inspectionBridge = null;
  bridgeController = null;
}
async function focusFirstHandEntry() {
  await tick();
  const first = handEntries[0];
  const focusId = first ? goodCardId(first.key) : 'shop-back-categories';
  document.getElementById(focusId)?.focus({ preventScroll: true });
}
function selectExpansion() {
  if (pendingAction || activeBurn || inspectionBridge || !nextExpansion) return;
  const key = 'garden-expansion-' + nextExpansion.plotCount;
  const focusId = goodCardId(key);
  const source = captureRect(focusId);
  rememberBrowsePosition(focusId);
  const siblings = handEntries.filter((entry) => entry.key !== key).map((entry) => 'item:' + entry.key);
  startBurnAction('siblings', siblings, () => openExpansion(source), focusId);
}
function backToCategories() {
  if (pendingAction || activeBurn || inspectionBridge) return;
  const focusId = categoryCardId(category);
  const transition = beginLayoutTransition(() => {
    selectedItemKey = null;
    detailMode = null;
    stage = 'categories';
    invalidatePreview();
  }, 'close');
  restoreBrowseFocus(transition, focusId);
}
function openProvisions() {
  if (!supplies || pendingAction || activeBurn || inspectionBridge || detailMode || provisionsBusy) return;
  stageBeforeProvisions = stage;
  selectedItemKey = null;
  stage = 'provisions';
  invalidatePreview();
  void tick().then(() => document.getElementById('shop-provisions-back')?.focus({ preventScroll: true }));
}
function returnFromProvisions() {
  if (pendingAction || activeBurn || provisionsBusy) return;
  stage = stageBeforeProvisions === 'provisions' ? 'categories' : stageBeforeProvisions;
  void tick().then(() => document.getElementById('open-provisions')?.focus({ preventScroll: true }));
}
onDestroy(cancelInspectionBridge);

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

  function beginLayoutTransition(update: () => void, _direction: 'open' | 'close') {
    update();
    return tick();
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
  if (pendingAction || activeBurn || inspectionBridge) return;
  const focusId = goodCardId(item.itemKey);
  const source = captureRect(focusId);
  rememberBrowsePosition(focusId);
  const siblings = handEntries.filter((entry) => entry.key !== item.itemKey).map((entry) => 'item:' + entry.key);
  startBurnAction('siblings', siblings, () => {
    selectedItemKey = item.itemKey;
    detailMode = 'item';
    stage = 'inspection';
    detailQuantity = 1;
    affordableOnly = false;
    message = null;
    messageError = false;
    invalidatePreview();
    const transition = animateInspectionBridge(source, { title: item.name, icon: itemIcon(item), art: itemArt(item), price: item.price });
    focusDetailAfter(transition, 'item', item.itemKey);
    void tick().then(() => requestPreview('item'));
  }, focusId);
}

  function selectCategory(nextCategory: ShopCategory) {
  if (pendingAction || activeBurn || inspectionBridge) return;
  const focusId = categoryCardId(nextCategory);
  rememberBrowsePosition(focusId);
  startBurnAction('category', ['category:' + nextCategory], () => {
    category = nextCategory;
    stage = 'items';
    selectedItemKey = null;
    detailMode = null;
    affordableOnly = false;
    message = null;
    messageError = false;
    invalidatePreview();
    void focusFirstHandEntry();
  }, focusId);
}

  function showAffordableGoods() {
  if (pendingAction || activeBurn || inspectionBridge) return;
  cancelInspectionBridge();
  const transition = beginLayoutTransition(() => {
    affordableOnly = true;
    category = 'seeds';
    selectedItemKey = null;
    detailMode = null;
    stage = 'items';
    invalidatePreview();
  }, 'close');
  void transition.then(focusFirstHandEntry);
}

  function closeDetail() {
  if (pendingAction || activeBurn?.purpose === 'receipt') return;
  if (detailMode === 'expand') {
    restoreFromExpansion();
    return;
  }
  cancelInspectionBridge();
  const itemKey = selectedItemKey;
  const focusId = itemKey ? goodCardId(itemKey) : browseFocusId;
  const transition = beginLayoutTransition(() => {
    selectedItemKey = null;
    detailMode = null;
    stage = 'items';
    invalidatePreview();
  }, 'close');
  restoreBrowseFocus(transition, focusId);
}

  function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || receiptDialog?.open) return;
  if (stage === 'provisions') {
    event.preventDefault();
    if (!provisionsBusy) returnFromProvisions();
    return;
  }
  if (activeBurn && activeBurn.purpose !== 'receipt' && !pendingAction) {
    event.preventDefault();
    cancelPreRequestBurn();
    return;
  }
  if (detailMode && !pendingAction) {
    event.preventDefault();
    detailMode === 'expand' ? restoreFromExpansion() : closeDetail();
    return;
  }
  if (stage === 'items' && !pendingAction) {
    event.preventDefault();
    backToCategories();
    return;
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

  function openExpansion(sourceRect: RectBox | null = null) {
  if (pendingAction || activeBurn || !nextExpansion) return;
  const focusId = goodCardId('garden-expansion-' + nextExpansion.plotCount);
  expansionReturn = { category, selectedItemKey: null, scrollTop: goodsGrid?.scrollTop ?? 0, focusId };
  selectedItemKey = null;
  detailMode = 'expand';
  stage = 'inspection';
  message = null;
  messageError = false;
  invalidatePreview();
  const transition = animateInspectionBridge(sourceRect, {
    title: 'Garden expansion · ' + nextExpansion.plotCount + ' plots', icon: '⌂', art: null, price: nextExpansion.price
  });
  focusDetailAfter(transition, 'expand');
  void tick().then(() => requestPreview('expand'));
}

  function restoreFromExpansion() {
  if (pendingAction || activeBurn?.purpose === 'receipt') return;
  cancelInspectionBridge();
  const target = expansionReturn;
  expansionReturn = null;
  const targetItemKey = target?.selectedItemKey ?? null;
  const focusId = target?.focusId ?? 'shop-back-categories';
  const transition = beginLayoutTransition(() => {
    category = target?.category ?? category;
    selectedItemKey = targetItemKey;
    detailMode = null;
    stage = 'items';
    invalidatePreview();
  }, 'close');
  browseScrollTop = target?.scrollTop ?? browseScrollTop;
  restoreBrowseFocus(transition, focusId);
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
  activeBurn = null;
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
  if (completedOrder?.kind === 'expand') {
    completedOrder = null;
    restoreFromExpansion();
    return;
  }
  const focusId = selectedItemKey ? goodCardId(selectedItemKey) : browseFocusId;
  completedOrder = null;
  activeBurn = null;
  const transition = beginLayoutTransition(() => {
    selectedItemKey = null;
    detailMode = null;
    stage = 'items';
    invalidatePreview();
  }, 'close');
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
    const committedInspectionHeight = detailPanel?.offsetHeight ?? 0;
    const committedInspectionTitle = selectedItem?.name ?? ('Expand to ' + nextExpansion?.plotCount + ' plots');
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
        refreshWarning = '';
        try { await update({ reset: false, invalidateAll: true }); }
        catch { refreshWarning = 'Your order is confirmed, but updated stock could not be loaded. Refresh the shop before placing another order.'; }
        completedInspectionHeight = committedInspectionHeight;
        completedInspectionTitle = committedInspectionTitle;
        pending = false;
        pendingAction = null;
        completedOrder = resolvedOrder;
        if (resolvedOrder && detailMode) {
          message = 'Elara has completed the order. Preparing your receipt.';
          startBurnAction('receipt', ['inspection'], () => {
            message = null;
            void tick().then(() => {
              receiptDialog?.showModal();
              successAction?.focus();
            });
          });
          void tick().then(() => document.getElementById('shop-receipt-progress')?.focus({ preventScroll: true }));
        } else if (resolvedOrder) {
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

<section class="shop-layout" data-shop-market data-shop-stage={completedOrder ? 'result' : stage === 'provisions' ? 'provisions' : detailMode ? 'preview' : stage === 'items' ? 'items' : 'categories'} aria-label="Elara Greenbloom’s garden shop">
  <section class="shop-scene panel" data-shop-merchant aria-label="Elara Greenbloom at her shop counter">
    <ShopScene assets={shopSceneAssets} detailMode={!!detailMode} />
  </section>

    <header class="market-heading">
      <div>
        <p class="eyebrow">Elara’s counter</p>
        <h1>Seeds for a better season</h1>
        <p class="market-intro">Choose a hand of goods, then inspect the terms before Elara rings it up.</p>
      </div>
      <div class="market-utilities"><p class="gold-status"><span>Gold</span><strong>{snapshot.save.gold ?? 0}</strong></p><button id="open-provisions" class="provisions-link" type="button" disabled={!supplies || !!pendingAction || !!activeBurn || !!inspectionBridge || !!detailMode || stage === 'provisions'} onclick={openProvisions}>Provisions <span aria-hidden="true">↗</span></button></div>
    </header>

  <div class="shop-workspace" data-shop-catalog>

    {#if activeBurn && activeBurn.purpose !== 'receipt'}
      <div class="burn-controls" role="status">
        <span>Cards are moving across the counter.</span>
        <button id="shop-transition-cancel" class="text-button" type="button" onclick={cancelPreRequestBurn}>Cancel transition</button>
      </div>
    {/if}

    {#if stage === 'categories'}
      <section class="shop-step" aria-labelledby="category-step-title">
        <header class="step-heading">
          <div>
                        <h2 id="category-step-title">What would you like to tend?</h2>
                      </div>
        </header>

        <div class="category-hand" aria-label="Shop categories">
          {#each categoryOptions as option, index (option.key)}
            {@const burnKey = 'category:' + option.key}
            {@const burnId = activeBurn?.id ?? 0}
            <div class="hand-slot category-slot" style={fanStyle(index, categoryOptions.length)}>
              <CardBurnSurface
                active={activeBurn?.keys.includes(burnKey) ?? false}
                treatment={activeBurn?.treatment ?? 'drip'}
                durationMs={activeBurn?.durationMs ?? 0}
                oncomplete={() => {
                  if (burnId > 0) finishBurnSurface(burnId, burnKey);
                }}
              >
                <article class="shop-card category-card" data-shop-category={option.key}>
                  <div class="card-symbol" aria-hidden="true">{option.icon}</div>
                  <div class="card-copy">
                    <p class="eyebrow">Category</p>
                    <h3>{option.label}</h3>
                    <p>{option.description}</p>
                  </div>
                  <div class="card-foot">
                    <span>{categoryCount(option.key)} stocked</span>
                    <span aria-hidden="true">↗</span>
                  </div>
                  <button
                    id={categoryCardId(option.key)}
                    class="card-action"
                    type="button"
                    disabled={!hydrated || !!pendingAction || !!activeBurn || !!inspectionBridge}
                    aria-label={'Browse ' + option.label}
                    onclick={() => selectCategory(option.key)}
                  >Browse {option.label}</button>
                </article>
              </CardBurnSurface>
            </div>
          {/each}
        </div>
      </section>
    {:else if stage === 'items' || detailMode}
      <section class="shop-step" aria-labelledby="goods-step-title">
        <header class="step-heading goods-step-heading">
          <div>

            <h2 id="goods-step-title">{categoryOptions.find((option) => option.key === category)?.label ?? 'Today’s goods'}</h2>

          </div>
          <button id="shop-back-categories" class="text-button" type="button" disabled={!!pendingAction || !!activeBurn || !!inspectionBridge || !!detailMode} onclick={backToCategories}>All categories</button>
        </header>

        {#if affordableOnly}
          <p class="shop-filter-status" role="status">Showing goods you can afford. <button class="text-button" type="button" onclick={() => affordableOnly = false}>Show all</button></p>
        {/if}

        <div class:has-inspection={!!detailMode} class="item-stage">
          <div bind:this={goodsGrid} class="item-hand" inert={!!detailMode} aria-hidden={!!detailMode} aria-live="polite" data-shop-goods-scroll>
            {#each handEntries as entry, index (entry.key)}
              {@const burnKey = 'item:' + entry.key}
              {@const burnId = activeBurn?.id ?? 0}
              <div class="hand-slot item-slot" style={fanStyle(index, handEntries.length)}>
                <CardBurnSurface
                  active={activeBurn?.keys.includes(burnKey) ?? false}
                  treatment={activeBurn?.treatment ?? 'drip'}
                  durationMs={activeBurn?.durationMs ?? 0}
                  oncomplete={() => {
                    if (burnId > 0) finishBurnSurface(burnId, burnKey);
                  }}
                >
                  {#if entry.kind === 'good'}
                    {@const item = entry.item}
                    {@const artUrl = itemArt(item)}
                    <article class="shop-card good-card" data-good-key={item.itemKey} data-good-category={itemCategory(item)}>
                      <div class="good-art" aria-hidden="true">
                        <span class="good-icon">{itemIcon(item)}</span>
                        {#if artUrl}<img src={artUrl} alt="" onerror={(event) => event.currentTarget.remove()} />{/if}
                      </div>
                      <div class="card-copy">
                        <h3>{item.name}</h3>
                        <p>{item.price} gold</p>
                      </div>
                      <div class="card-foot">
                        <span class:sold-out={item.remainingStock === 0}>{item.remainingStock === 0 ? 'Sold out' : item.remainingStock + ' in stock'}</span>
                        <span aria-hidden="true">↗</span>
                      </div>
                      <button
                        id={'shop-good-' + safeId(item.itemKey)}
                        class="card-action"
                        type="button"
                        disabled={!hydrated || !!pendingAction || !!activeBurn || !!inspectionBridge}
                        aria-pressed={selectedItem?.itemKey === item.itemKey}
                        aria-label={'Select ' + item.name}
                        onclick={() => selectItem(item)}
                      >Select {item.name}</button>
                    </article>
                  {:else}
                    <article class="shop-card expansion-card" data-shop-category="garden">
                      <div class="good-art" aria-hidden="true"><span class="good-icon">⌂</span></div>
                      <div class="card-copy">
                        <p class="eyebrow">Garden care</p>
                        <h3>Make room to grow</h3>
                        <p>Open the garden to {entry.plotCount} plots.</p>
                      </div>
                      <div class="card-foot"><span>{entry.price} gold</span><span aria-hidden="true">↗</span></div>
                      <button
                        id={'shop-good-' + safeId(entry.key)}
                        class="card-action"
                        type="button"
                        disabled={!hydrated || !!pendingAction || !!activeBurn || !!inspectionBridge}
                        aria-label={'Select garden expansion to ' + entry.plotCount + ' plots'}
                        onclick={selectExpansion}
                      >Inspect garden expansion</button>
                    </article>
                  {/if}
                </CardBurnSurface>
              </div>
            {:else}
              <p class="shop-muted">No goods are stocked in this category today.</p>
            {/each}
          </div>

          {#if activeBurn?.purpose === 'receipt' && completedOrder}
            {@const inspectionBurnId = activeBurn.id}
            {@const receiptItem = completedItem}
            <CardBurnSurface
              active={activeBurn.keys.includes('inspection')}
              treatment={activeBurn.treatment}
              durationMs={activeBurn.durationMs}
              oncomplete={() => finishBurnSurface(inspectionBurnId, 'inspection')}
            >
              <aside bind:this={detailPanel} class="inspection-panel" style={`min-height:${completedInspectionHeight}px`} data-shop-detail aria-live="polite" aria-labelledby="item-detail-title">
                <header class="inspection-heading">
                  <div>
                    <p class="eyebrow">Elara’s ledger</p>
                    <h2 id="item-detail-title" tabindex="-1">{completedInspectionTitle}</h2>
                  </div>
                </header>
                <div class="inspection-art" aria-hidden="true">
                  {#if completedOrder.kind === 'purchase'}
                    <span>{receiptItem ? itemIcon(receiptItem) : '✿'}</span>
                    {#if receiptItem}
                      {@const receiptArtUrl = itemArt(receiptItem)}
                      {#if receiptArtUrl}<img src={receiptArtUrl} alt="" onerror={(event) => event.currentTarget.remove()} />{/if}
                    {/if}
                  {:else}⌂{/if}
                </div>
                <p class="effect-copy">{completedOrder.kind === 'expand' ? 'Open new ground for a larger garden and more room to grow.' : completedOrder.quantity + ' purchased and recorded in your garden ledger.'}</p>
                <dl class="inspection-facts">
                  <div><dt>{completedOrder.kind === 'expand' ? 'New capacity' : 'Quantity'}</dt><dd>{completedOrder.kind === 'expand' ? completedOrder.capacity + ' plots' : completedOrder.quantity}</dd></div>
                  <div><dt>Actual cost</dt><dd>{completedOrder.cost} gold</dd></div>
                </dl>
              </aside>
            </CardBurnSurface>
          {:else if detailMode === 'item' && selectedItem}
            {@const selectedArtUrl = itemArt(selectedItem)}
            <aside bind:this={detailPanel} class="inspection-panel" data-shop-detail aria-live="polite" aria-labelledby="item-detail-title">
              <header class="inspection-heading">
                <div>
                  <p class="eyebrow">Elara’s ledger</p>
                  <h2 id="item-detail-title" tabindex="-1">{selectedItem.name}</h2>
                </div>
                <button class="text-button" type="button" disabled={!!pendingAction || activeBurn?.purpose === 'receipt'} onclick={closeDetail}>Back to goods</button>
              </header>
              <div class="inspection-art" aria-hidden="true">
                <span>{itemIcon(selectedItem)}</span>
                {#if selectedArtUrl}<img src={selectedArtUrl} alt="" onerror={(event) => event.currentTarget.remove()} />{/if}
              </div>
              <p class="effect-copy">{effectDescription(selectedItem)}</p>
              <dl class="inspection-facts">
                <div><dt>Unit price</dt><dd>{selectedItem.price} gold</dd></div>
                <div><dt>Owned</dt><dd>{inventory.find((item) => item.itemKey === selectedItem.itemKey)?.quantity ?? 0}</dd></div>
                <div><dt>In stock</dt><dd>{selectedItem.remainingStock}</dd></div>
              </dl>

              {#if selectedItem.remainingStock > 0}
                <label class="quantity-label" for="shop-quantity">Quantity</label>
                <input
                  id="shop-quantity"
                  name="quantity"
                  type="number"
                  min="1"
                  max="20"
                  inputmode="numeric"
                  aria-label="Quantity"
                  disabled={!!pendingAction}
                  bind:value={detailQuantity}
                  oninput={(event) => {
                    detailQuantity = event.currentTarget.valueAsNumber;
                    invalidatePreview();
                    void tick().then(() => requestPreview('item'));
                  }}
                />
                <p class="detail-total">Total {detailTotal} gold · {projectedGold} gold remaining.</p>
              {/if}

              {#key 'purchase:' + selectedItem.itemKey}
                <form bind:this={previewForm} class="hidden-preview" method="POST" action="?/preview" use:enhance={previewEnhancer('purchase', detailPayload)}>
                  <input type="hidden" name="quantity" value={detailQuantity} />
                </form>
              {/key}

              {#if selectedItem.remainingStock === 0}
                <p class="form-message error" role="alert"><strong>Out of stock.</strong> Restocks on tavern day {selectedItem.restockDay}.</p>
                <button class="primary-button" type="button" disabled aria-label={'Buy for ' + selectedItem.price + ' gold'}>Buy for {selectedItem.price} gold</button>
              {:else if hasCurrentPreview && preview?.canCommit === false}
                {#if previewStatus() === 'insufficient_gold'}
                  <p class="form-message error" role="alert"><strong>Not enough gold.</strong> Need {previewNumber('goldDeficit')} more gold.</p>
                  {@const unavailablePrice = preview.goldCost ?? detailTotal}
                  <button class="primary-button" type="button" disabled aria-label={'Buy for ' + unavailablePrice + ' gold'}>Buy for {unavailablePrice} gold</button>
                  <div class="detail-actions"><button class="secondary-button" type="button" onclick={showAffordableGoods}>View affordable goods</button></div>
                {:else if previewStatus() === 'exceeds_stock'}
                  <p class="form-message error" role="alert">Only {preview.remainingStock ?? 0} left.</p>
                  <button class="secondary-button" type="button" onclick={correctQuantity}>Use available quantity</button>
                {:else}
                  <p class="form-message error" role="alert">This order cannot be completed.</p>
                {/if}
              {:else if hasCurrentPreview && preview?.canCommit === true}
                {@const buyPrice = preview.goldCost ?? detailTotal}
                <form data-shop-commit method="POST" action="?/command" use:enhance={commitPreview}>
                  <button
                    class="primary-button"
                    type="submit"
                    disabled={!hydrated || pending}
                    aria-label={(pendingAction && messageError ? 'Retry · ' : '') + 'Buy for ' + buyPrice + ' gold'}
                  >{pending ? 'Confirming…' : pendingAction && messageError ? 'Retry · Buy for ' + buyPrice + ' gold' : 'Buy for ' + buyPrice + ' gold'}</button>
                </form>
              {:else if !messageError}
                <p class="shop-muted" role="status">Checking Elara’s ledger…</p>
              {/if}
              {#if message && messageError}
                <p class="form-message error" role="alert">{message}</p>
              {:else if form?.message}
                <p class:form-message-error={form.error} class="form-message" role={form.error ? 'alert' : 'status'}>{form.message}</p>
              {/if}
            </aside>

          {:else if detailMode === 'expand' && nextExpansion}
            <aside bind:this={detailPanel} class="inspection-panel" data-shop-detail aria-live="polite" aria-labelledby="item-detail-title">
              <header class="inspection-heading">
                <div><p class="eyebrow">Garden capacity</p><h2 id="item-detail-title" tabindex="-1">Expand to {nextExpansion.plotCount} plots</h2></div>
                <button class="text-button" type="button" disabled={!!pendingAction} onclick={restoreFromExpansion}>Back to goods</button>
              </header>
              <div class="inspection-art expansion-art" aria-hidden="true">⌂</div>
              <p class="effect-copy">Open new ground for a larger garden and more room to grow.</p>
              <dl class="inspection-facts">
                <div><dt>Current capacity</dt><dd>{capacity} plots</dd></div>
                <div><dt>Next capacity</dt><dd>{nextExpansion.plotCount} plots</dd></div>
                <div><dt>Price</dt><dd>{preview?.goldCost ?? nextExpansion.price} gold</dd></div>
              </dl>
              {#key 'expand:' + nextExpansion.plotCount}
                <form bind:this={previewForm} class="hidden-preview" method="POST" action="?/preview" use:enhance={previewEnhancer('expand', expansionPayload)}>
                  <input type="hidden" name="plotCount" value={nextExpansion.plotCount} />
                </form>
              {/key}
              {#if hasCurrentPreview && preview?.canCommit === false}
                <p class="form-message error" role="alert"><strong>Not enough gold.</strong> Need {Math.max(0, previewNumber('goldCost') - previewNumber('goldBalance'))} more gold.</p>
                <button class="primary-button" type="button" disabled>Expand to {nextExpansion.plotCount} plots for {preview.goldCost ?? nextExpansion.price} gold</button>
                <div class="detail-actions"><button class="secondary-button" type="button" onclick={showAffordableGoods}>View affordable goods</button></div>
              {:else if hasCurrentPreview && preview?.canCommit === true}
                <form data-shop-commit method="POST" action="?/command" use:enhance={commitPreview}>
                  <button class="primary-button" type="submit" disabled={!hydrated || pending}>{pending ? 'Confirming…' : 'Expand to ' + nextExpansion.plotCount + ' plots for ' + (preview.goldCost ?? '…') + ' gold'}</button>
                </form>
              {:else if !messageError}
                <p class="shop-muted" role="status">Checking Elara’s ledger…</p>
              {/if}
              {#if message && messageError}<p class="form-message error" role="alert">{message}</p>{/if}
            </aside>

          {/if}
        </div>
      </section>
    {:else}
      <section class="provisions-destination" aria-label="Settlement provisions">
        <button id="shop-provisions-back" class="text-button provisions-back" type="button" disabled={provisionsBusy} onclick={returnFromProvisions}>← Back to shop</button>
        {#if supplies}
          <GeneratedSupplies supplies={supplies} saveId={snapshot.save.id} revision={snapshot.save.revision} {form} {burnStyle} onbusychange={(busy) => { provisionsBusy = busy; }} />
        {:else}
          <p class="shop-muted">No settlement provisions are available yet.</p>
        {/if}
      </section>
    {/if}

    {#if activeBurn?.purpose === 'receipt'}
      <p id="shop-receipt-progress" class="receipt-progress" role="status" tabindex="-1">Order confirmed. Preparing your receipt…</p>
    {/if}
    {#if activeBurn && activeBurn.purpose !== 'receipt'}
      <p class="shop-message" role="status">You can cancel a card transition before any order is sent.</p>
    {/if}
  </div>

  {#if inspectionBridge}
    <div class:bridge-arrived={inspectionBridge.phase === 'to'} class="inspection-bridge" style={bridgeStyle(inspectionBridge)} aria-hidden="true">
      <span>{inspectionBridge.icon}</span>
      {#if inspectionBridge.art}<img src={inspectionBridge.art} alt="" />{/if}
      <strong>{inspectionBridge.title}</strong>
    </div>
  {/if}
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
      {#if refreshWarning}<p role="alert">{refreshWarning}</p><a class="text-button" href="/shop" data-sveltekit-reload>Refresh shop</a>{/if}
      {#if completedOrder.kind === 'purchase'}<button disabled={!!refreshWarning} bind:this={successAction} class="primary-button" type="button" onclick={resetForAnother}>Buy another</button>{/if}
      <button class="text-button" type="button" disabled={!!refreshWarning} onclick={continueShopping}>Continue shopping</button>
    </div>
  </dialog>
{/if}

<style>
  .shop-layout {
    --shop-gold: #d9b45f;
    --shop-gold-bright: #f0d58c;
    position: relative;
    display: block;
    width: min(100%, 1520px);
    margin: 0 auto;
    padding: 0 clamp(.65rem, 2vw, 1.5rem);
    color: var(--ink, #f2e8d0);
  }
  .shop-scene {
    position: relative;
    width: 100%;
    height: clamp(24rem, 44vw, 42rem);
    min-height: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid #604920;
    background: #130d06;
    box-shadow: 0 24px 70px #0009;
    view-transition-name: shop-merchant;
  }
  .shop-scene :global(.shop-composed-scene) {
    width: 100%;
    height: 100%;
    min-height: 0;
    max-width: none;
    margin: 0;
  }
  .market-heading {
    position: absolute;
    z-index: 5;
    top: clamp(1.1rem, 3.4vw, 3rem);
    left: clamp(1rem, 5vw, 4.2rem);
    right: clamp(1rem, 5vw, 4.2rem);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    pointer-events: none;
    text-shadow: 0 2px 12px #000e;
  }
  .market-heading > * { pointer-events: auto; }
  .market-heading h1, .step-heading h2, .inspection-heading h2 {
    margin: .15rem 0 .4rem;
    color: #f0d58c;
    font: 600 clamp(1.3rem, 2.7vw, 2.2rem)/1.15 'Cinzel', serif;
  }
  .market-intro { margin: .25rem 0 0; color: #d5c8a7; line-height: 1.5; }
  .market-intro { max-width: 38rem; }
  .eyebrow {
    margin: 0;
    color: #b6d382;
    font: 600 .7rem 'Cinzel', serif;
    letter-spacing: .12em;
    text-transform: uppercase;
  }
  .market-utilities { display: grid; justify-items: end; gap: .6rem; }
  .gold-status { display: grid; gap: .1rem; justify-items: end; margin: 0; color: #e0d1ac; font-size: .75rem; }
  .gold-status strong { color: #f0d58c; font: 600 1.5rem 'Cinzel', serif; }
  .provisions-link {
    min-height: 44px;
    padding: .45rem .65rem;
    border: 1px solid #ad8744;
    color: #f0d58c;
    background: #1b1309d9;
    font: 600 .7rem 'Cinzel', serif;
    cursor: pointer;
  }
  .provisions-link:disabled { cursor: not-allowed; opacity: .58; }
  .provisions-link:focus-visible { outline: 3px solid #efcf75; outline-offset: 2px; }

  .shop-workspace {
    position: relative;
    z-index: 3;
    margin-top: -8rem;
    padding: 0 clamp(.6rem, 4vw, 3.5rem) 4.2rem;
  }
  .shop-step { margin: 0; padding: 0; border: 0; background: transparent; }
  .step-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; margin: 0 0 1.1rem; }
  .step-heading h2 { font-size: clamp(1.2rem, 2vw, 1.7rem); }
  .category-hand {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: stretch;
    gap: clamp(.5rem, 1.5vw, 1.2rem);
    padding: .9rem .1rem .4rem;
    perspective: 1100px;
  }
  .hand-slot { min-width: 0; }
  .category-slot { transform: translateY(var(--lift, 0px)) rotate(var(--tilt, 0deg)); animation: shop-deal-in 440ms cubic-bezier(.22,1,.36,1) both; animation-delay: var(--deal-delay, 0ms); }
  .item-slot { animation: shop-deal-in 360ms cubic-bezier(.22,1,.36,1) both; animation-delay: var(--deal-delay, 0ms); }
  .shop-card {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 14rem;
    height: 100%;
    padding: clamp(.65rem, 1.2vw, 1rem);
    grid-template-rows: auto 1fr auto;
    gap: .65rem;
    overflow: hidden;
    border: 1px solid #94713a;
    color: #e9dfc8;
    background: linear-gradient(145deg, #21170cd9, #0d0906e8);
    box-shadow: 0 16px 30px #0009, inset 0 0 0 1px #d2aa5124;
    backdrop-filter: blur(4px);
    transition: transform 220ms ease, border-color 220ms ease, box-shadow 220ms ease;
  }
  .shop-card:hover { transform: translateY(-3px); border-color: #e2bd66; box-shadow: 0 18px 34px #000b, 0 0 18px #d8ad4540; }
  .card-symbol {
    display: grid;
    width: 3rem;
    height: 3rem;
    place-items: center;
    border: 1px solid #8b6d37;
    border-radius: 50%;
    color: #f0d58c;
    background: radial-gradient(circle, #583d1e, #1a1007);
    font-size: 1.6rem;
  }
  .card-copy { min-width: 0; align-self: end; }
  .card-copy h3 { margin: .2rem 0 .35rem; color: #f1d990; font: 600 clamp(.9rem, 1.2vw, 1.1rem)/1.2 'Cinzel', serif; overflow-wrap: anywhere; }
  .card-copy > p:not(.eyebrow) { margin: .25rem 0 0; color: #c9bc9c; font-size: .79rem; line-height: 1.4; }
  .card-foot { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding-top: .5rem; border-top: 1px solid #70562c; color: #d1b979; font-size: .74rem; }
  .card-foot > span:last-child { color: #f0d58c; font-size: 1rem; }
  .card-action { position: absolute; inset: 0; width: 100%; min-height: 44px; border: 0; color: transparent; background: transparent; cursor: pointer; }
  .card-action:focus-visible { outline: 3px solid #f1d782; outline-offset: -5px; box-shadow: inset 0 0 0 100vmax #f1d78216; }
  .card-action:disabled { cursor: progress; }

  .burn-controls { display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin: 0 0 .8rem; padding: .4rem .65rem; border: 1px solid #705329; color: #d8c28e; background: #25190bf2; font-size: .75rem; }
  .item-stage { display: flex; flex-direction: column; gap: 1.25rem; }
  .item-stage:not(.has-inspection) { display: block; }
  .item-hand {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    align-items: stretch;
    gap: .7rem;
    min-width: 0;
    padding: .35rem .1rem .7rem;
    overflow: visible;
  }
  .good-card { min-height: 12rem; }
  .good-art, .inspection-art {
    position: relative;
    display: grid;
    min-height: 4.5rem;
    place-items: center;
    overflow: hidden;
    color: #f0d58c;
    background: radial-gradient(circle, #3d2a14, #120c06);
    font-size: 2.2rem;
  }
  .good-art img, .inspection-art img { position: absolute; inset: .4rem; width: calc(100% - .8rem); height: calc(100% - .8rem); object-fit: contain; }
  .good-icon { display: grid; place-items: center; }
  .good-card .card-copy { align-self: center; }
  .good-card .card-copy h3 { font-size: .88rem; }
  .good-card .card-copy p { color: #d9b45f; font-size: .75rem; }
  .good-card .card-foot { align-self: end; }
  .sold-out { color: #e7836b !important; }
  .expansion-card { min-height: 12rem; border-color: #8e713a; background: linear-gradient(145deg, #2a1c0de8, #120d06e8); }
  .expansion-card .good-art { min-height: 3.5rem; background: radial-gradient(circle, #5a421c, #181007); }

  .inspection-panel {
    display: grid;
    width: min(100%, 44rem);
    gap: .75rem;
    align-content: start;
    margin: 0 auto;
    padding: .9rem;
    border: 1px solid #8b6a31;
    background: linear-gradient(145deg, #21170a, #100b06);
    box-shadow: inset 0 0 0 1px #d8ad4530, 0 12px 32px #0008;
    view-transition-name: shop-detail;
  }
  .inspection-heading { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
  .inspection-heading h2 { font-size: clamp(1.1rem, 1.6vw, 1.45rem); overflow-wrap: anywhere; }
  .inspection-heading h2:focus-visible { outline: 2px solid #efcf75; outline-offset: 4px; }
  .inspection-art { min-height: 9rem; border: 1px solid #654a21; font-size: 3.5rem; }
  .effect-copy { margin: 0; color: #ded2b6; font-size: .85rem; line-height: 1.5; }
  .inspection-facts { display: grid; gap: .4rem; margin: 0; }
  .inspection-facts div { display: flex; justify-content: space-between; gap: .75rem; }
  .inspection-facts dt { color: #c7b991; }
  .inspection-facts dd { margin: 0; color: #f0d58c; text-align: right; }
  .quantity-label { color: #c7b991; font-size: .78rem; }
  .inspection-panel input[type='number'] { width: 100%; min-width: 0; min-height: 44px; margin-top: -.5rem; padding: .45rem .55rem; border: 1px solid #755a2d; color: #f1e6ca; background: #0c0804; }
  .detail-total { margin: -.3rem 0 0; color: #d3bb7d; font-size: .8rem; }
  .hidden-preview { display: none; }
  .primary-button, .secondary-button, .text-button { min-height: 44px; padding: .55rem .75rem; font: 600 .72rem 'Cinzel', serif; cursor: pointer; }
  .primary-button, .secondary-button { border: 1px solid #896a35; color: #e4cd8e; background: #1b1309; }
  .primary-button { width: 100%; border-color: #f0c868; color: #1b1105; background: linear-gradient(#e1b64f, #8e5d19); }
  .primary-button:disabled, .secondary-button:disabled, .text-button:disabled { cursor: not-allowed; opacity: .58; }
  .text-button { border: 1px solid transparent; color: #dbc681; background: transparent; }
  .secondary-button:focus-visible, .primary-button:focus-visible, .text-button:focus-visible { outline: 3px solid #efcf75; outline-offset: 2px; }
  .detail-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
  .shop-muted { margin: .5rem 0; color: #c7b991; font-size: .85rem; }
  .shop-filter-status { margin: .25rem 0 .75rem; color: #dec277; font-size: .78rem; }
  .form-message { margin: 0; color: #c6d99a; font-size: .82rem; }
  .form-message.error, .form-message-error { color: #e4a28e; }
  .shop-message { margin: .7rem 0 0; color: #c6d99a; font-size: .78rem; }
  .provisions-destination { padding: 0; }
  .provisions-back { margin-bottom: .75rem; }
  .inspection-bridge {
    position: fixed;
    z-index: 50;
    left: var(--bridge-left);
    top: var(--bridge-top);
    display: grid;
    width: var(--bridge-width);
    height: var(--bridge-height);
    place-items: center;
    overflow: hidden;
    border: 1px solid #d4ad54;
    color: #f0d58c;
    background: radial-gradient(circle, #573e1e, #160f08);
    box-shadow: 0 12px 34px #000c;
    pointer-events: none;
    transition: left 380ms cubic-bezier(.22,1,.36,1), top 380ms cubic-bezier(.22,1,.36,1), width 380ms cubic-bezier(.22,1,.36,1), height 380ms cubic-bezier(.22,1,.36,1);
  }
  .inspection-bridge > span { font-size: clamp(1.2rem, 3vw, 2.6rem); }
  .inspection-bridge strong { position: absolute; inset: auto .4rem .35rem; overflow: hidden; color: #f2e5c2; font: 600 .68rem 'Cinzel', serif; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
  .inspection-bridge img { position: absolute; inset: .3rem; width: calc(100% - .6rem); height: calc(100% - .6rem); object-fit: contain; }
  .inspection-bridge.bridge-arrived { border-radius: .35rem; }
  .purchase-complete { padding: 1rem; border: 1px solid #b68c45; background: linear-gradient(135deg, #2b1b09, #140e06); }
  .receipt { width: min(32rem, calc(100% - 2rem)); padding: 1.25rem; border: 2px solid #b18a48; color: #251605; background: linear-gradient(135deg, #f0ddb1, #c9a25e); box-shadow: 0 16px 50px #000d; }
  .receipt::backdrop { background: #000b; backdrop-filter: blur(3px); }
  .receipt-check { float: right; display: grid; width: 2.4rem; height: 2.4rem; place-items: center; border-radius: 50%; color: #eaf3d5; background: #507139; font-weight: bold; }
  .receipt-item { position: relative; display: grid; min-height: 9rem; margin: .75rem 0; place-items: center; overflow: hidden; border: 1px solid #8e713d; color: #765019; background: #ead8ad; font-size: 3rem; }
  .receipt-item img { position: absolute; inset: .5rem; width: calc(100% - 1rem); height: calc(100% - 1rem); object-fit: contain; }
  :global(::view-transition-group(shop-merchant)), :global(::view-transition-group(shop-detail)) { animation-duration: var(--shop-transition-duration, 240ms); animation-timing-function: var(--shop-transition-easing, cubic-bezier(.22,1,.36,1)); }
  @keyframes shop-deal-in { from { opacity: 0; transform: translateY(12px) rotate(-2deg); } to { opacity: 1; } }

  @media (max-width: 900px) {
    .shop-layout { padding: 0 .65rem; }
    .shop-scene { height: clamp(20rem, 56vw, 30rem); }
    .shop-workspace { margin-top: 0; padding: 4.2rem .45rem 4.2rem; }
    .market-heading { top: 1rem; left: 1rem; right: 1rem; }
    .market-heading h1 { font-size: clamp(1.2rem, 4vw, 1.7rem); }
    .market-intro { max-width: 24rem; font-size: .82rem; }
    .category-hand { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .55rem; }
    .shop-card { min-height: 12rem; padding: .65rem; }
    .item-hand { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  @media (max-width: 620px) {
    .shop-scene { height: 20rem; }
    .market-heading { align-items: flex-start; }
    .market-heading h1 { max-width: 13rem; font-size: 1.15rem; }
    .market-intro { max-width: 12rem; font-size: .76rem; }
    .market-utilities { gap: .3rem; }
    .gold-status strong { font-size: 1.2rem; }
    .provisions-link { padding: .4rem .5rem; }
    .step-heading { align-items: flex-start; flex-direction: column; }
    .category-hand, .item-hand { display: flex; gap: .7rem; margin-inline: -.4rem; padding: .35rem .4rem .85rem; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; scrollbar-color: #765522 #110c07; }
    .category-slot, .item-slot { flex: 0 0 min(74vw, 16rem); scroll-snap-align: center; }
    .category-slot { transform: none; }
    .shop-card { min-height: 11.5rem; }
    .inspection-panel { width: 100%; }
    .inspection-heading { align-items: flex-start; flex-direction: column; }
    .goods-step-heading > .text-button { align-self: flex-end; }
  }
  /* The scene owns the route; the hand and inspection sit on its counter. */
  .shop-scene { height: max(38rem, calc(100dvh - 6.5rem)); }
  .shop-workspace { position: absolute; inset: 0; z-index: 3; margin: 0; padding: 0; pointer-events: none; }
  .shop-step { position: absolute; inset: auto 0 0; padding: 0 4.2rem; }
  .step-heading { padding: 0 .7rem; margin: 0; color: #f0d58c; text-shadow: 0 2px 10px #000; }
  .step-heading h2 { font-size: 1.1rem; }
  .step-heading button { pointer-events: auto; background: #140e09db; }
  .category-hand, .item-hand { display: flex; align-items: end; justify-content: center; gap: 0; padding: 4.2rem 2rem; perspective: 1100px; }
  .category-slot { flex: 0 0 180px; margin-inline: -.55rem; pointer-events: auto; }
  .item-slot { flex: 0 0 140px; margin-inline: -.3rem; transform: translateY(var(--lift,0px)) rotate(var(--tilt,0deg)); pointer-events: auto; }
  .category-card { min-height: 12.5rem; }
  .item-hand { overflow-x: auto; overscroll-behavior-inline: contain; scrollbar-width: thin; scrollbar-color: #806332 transparent; }
  .hand-slot:focus-within, .hand-slot:hover { z-index: 10; }
  .item-stage.has-inspection .item-hand { opacity: .15; pointer-events: none; }
  .item-stage.has-inspection { display: block; }
  .has-inspection .inspection-panel, .has-inspection :global(.card-burn-surface:has(.inspection-panel)) { pointer-events: auto; }
  .inspection-panel { position: absolute; bottom: 1.5rem; left: 50%; transform: translateX(-50%); width: min(42rem, calc(100% - 2rem)); max-height: calc(100dvh - 13rem); overflow-y: auto; background: #1b140de8; backdrop-filter: blur(8px); }
  .inspection-art { min-height: 5.5rem; }
  .inspection-facts { grid-template-columns: repeat(3,minmax(0,1fr)); gap: .7rem; }
  .inspection-facts div { flex-direction: column; gap: .2rem; }
  .inspection-facts dd { text-align: left; }
  .burn-controls { position: absolute; z-index: 10; top: 10rem; right: 4.2rem; pointer-events: auto; }
  .shop-workspace > .shop-message { position: absolute; bottom: .2rem; left: 4.2rem; }
  .provisions-destination { position: absolute; right: 4.2rem; bottom: 2rem; left: 4.2rem; max-height: calc(100dvh - 16rem); overflow-y: auto; pointer-events: auto; background: #160f09e6; backdrop-filter: blur(8px); }
  @media (max-width: 900px) and (min-width: 621px) {
    .shop-step { padding-inline: 1.25rem; }
    .item-hand { justify-content: flex-start; }
    .item-slot:first-child { margin-left: 1rem; }
    .item-slot:last-child { margin-right: 1rem; }
  }
  @media (max-width: 620px) {
    .shop-layout { padding-inline: 0; }
    .shop-scene { height: 20rem; }
    .shop-workspace { position: relative; inset: auto; pointer-events: auto; }
    .shop-step { position: relative; inset: auto; padding-inline: .4rem; }
    .step-heading { padding: 1rem .6rem 0; flex-direction: row; align-items: center; }
    .category-hand, .item-hand { justify-content: flex-start; margin: 0; padding: 4.2rem 1.2rem; overflow-x: auto; }
    .category-slot { flex-basis: 156px; margin-inline: -.4rem; transform: translateY(var(--lift,0px)) rotate(var(--tilt,0deg)); }
    .item-slot { flex-basis: 130px; margin-inline: -.55rem; }
    .has-inspection .item-hand { display: none; }
    .inspection-panel { position: relative; left: auto; bottom: auto; transform: none; width: 100%; max-height: none; margin-top: 1rem; }
    .inspection-heading { flex-direction: row; }
    .inspection-facts { grid-template-columns: repeat(3,minmax(0,1fr)); }
    .goods-step-heading:has(+ .has-inspection) { display: none; }
    .market-intro { display: none; }
    .burn-controls { position: relative; top: auto; right: auto; margin: .75rem; }
    .shop-workspace > .shop-message { position: static; margin: .6rem; }
    .provisions-destination { position: relative; inset: auto; max-height: none; margin-top: 1rem; }
  }
  .shop-scene::after { content: ''; position: absolute; inset: 0 0 auto; height: 12rem; pointer-events: none; background: linear-gradient(#100a08aa,transparent); }
  .has-inspection :global(.card-burn-surface:has(.inspection-panel)) { position: absolute; bottom: 1.5rem; left: 50%; transform: translateX(-50%); width: min(42rem, calc(100% - 2rem)); height: auto; }
  .has-inspection :global(.card-burn-surface .inspection-panel) { position: relative; bottom: auto; left: auto; transform: none; width: 100%; }
  .receipt-progress { position: absolute; z-index: 12; bottom: .2rem; left: 50%; transform: translateX(-50%); margin: 0; padding: .3rem .6rem; background: #140e09ea; color: #f0d58c; font-size: .8rem; }
  .receipt-progress:focus-visible { outline: 2px solid #f0d58c; }
  @media (max-width: 620px) {
    .has-inspection :global(.card-burn-surface:has(.inspection-panel)) { position: relative; bottom: auto; left: auto; transform: none; width: 100%; }
    .receipt-progress { position: relative; bottom: auto; left: auto; transform: none; margin: .5rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .category-slot, .item-slot { animation-duration: .01ms !important; animation-delay: 0ms !important; }
    .shop-card, .inspection-bridge { transition-duration: .01ms !important; }
    :global(::view-transition-group(shop-merchant)), :global(::view-transition-group(shop-detail)) { animation-duration: 0s !important; }
  }
</style>
