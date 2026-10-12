<script lang="ts">
import { enhance } from '$app/forms';
import { beforeNavigate } from '$app/navigation';
import { onDestroy, tick, untrack } from 'svelte';
  import type { Snippet } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
import type { BurnStyle, ResolvedBurnAction } from '$lib/card-effects';
import { resolveBurnAction, waitForBurn } from '$lib/card-effects';
  import type { GameSnapshot, GardenCell, GardenCommandKind, GardenCommandPayload, GardenCommandPreview } from '$lib/game/contracts';
  import { gardenCommandPreviewFeedback } from '$lib/game/garden-feedback';
  import type { WorkflowChoice } from '$lib/components/ui/workflow';
  import CardWorkflowFrame from '$lib/components/ui/CardWorkflowFrame.svelte';
  import WorkflowHand from '$lib/components/ui/WorkflowHand.svelte';
  import WorkflowInspection from '$lib/components/ui/WorkflowInspection.svelte';
  import ShopGoodCard from '$lib/components/shop/ShopGoodCard.svelte';
  import { PUBLIC_SUPABASE_URL } from '$env/static/public';
  import { shopItemAssetPublicUrl } from '$lib/game/shop-runtime-assets';
  import CropDetails from './CropDetails.svelte';
  import GardenOverview from './GardenOverview.svelte';
  import GardenProvisionPanel, { type ApiaryWorkflowHand } from './GardenProvisionPanel.svelte';

  type BatchKind = 'water' | 'amend';
  type Section = 'root' | 'crop' | 'soil' | 'apiary' | 'move';
type Pane = 'plant' | 'water' | 'amend' | 'move' | 'remove' | 'incorporate_clover' | 'compost_ingredient' | 'apiary' | 'preview';
type PreviewKind = Exclude<Pane, 'apiary' | 'preview'>;
type PendingGardenAction = {
  id: string;
  kind: GardenCommandKind;
  payload: GardenCommandPayload;
  signature: string;
  revision: number;
  burnAction: ResolvedBurnAction;
};
type PreviewRequest = {
  sequence: number;
  kind: PreviewKind;
  signature: string;
  targetSignature: string;
  revision: number;
  selectedId: string | null;
  returnPane: Pane;
};
  type SceneSlot = Snippet;

  let {
    snapshot,
    selected,
    batchMode = null,
    selectingBatchPlots = false,
    batchTargetIds = new Set<string>(),
    moveTargetId = null,
    moveSourceId = null,
  splitTargetId = null,
    onstartbatch = () => {},
    oncancelbatch = () => {},
    onfinishbatch = () => {},
    onstartmove = () => {},
    oncancelmove = () => {},
  onstartsplit = () => {},
  oncancelsplit = () => {},
  oninteractionlockchange,
    onclose = () => {},
    burnStyle = 'drip',
    transportError = null,
    harvestPending = false,
    harvestActionId = null,
    harvestRetryAvailable = false,
    onharvest = () => {},
    harvestBurnAction = null,
    formMessage = null,
    formError = false,
    formConflict = false,
    scene,
    harvest
  }: {
    snapshot: GameSnapshot;
    selected: GardenCell | null;
    batchMode?: BatchKind | null;
    selectingBatchPlots?: boolean;
    batchTargetIds?: Set<string>;
    moveTargetId?: string | null;
    moveSourceId?: string | null;
  splitTargetId?: string | null;
    onstartbatch?: (kind: BatchKind) => void | Promise<void>;
    oncancelbatch?: () => void | Promise<void>;
    onfinishbatch?: () => void | Promise<void>;
    onstartmove?: () => void | Promise<void>;
    oncancelmove?: () => void | Promise<void>;
  onstartsplit?: () => void | Promise<void>;
  oncancelsplit?: () => void | Promise<void>;
  oninteractionlockchange?: (locked: boolean) => void;
    onclose?: () => void | Promise<void>;
    burnStyle?: BurnStyle;
    transportError?: string | null;
    harvestPending?: boolean;
    harvestActionId?: string | null;
    harvestRetryAvailable?: boolean;
    onharvest?: () => void;
    harvestBurnAction?: ResolvedBurnAction | null;
    formMessage?: string | null;
    formError?: boolean;
    formConflict?: boolean;
    scene: SceneSlot;
    harvest?: Snippet;
  } = $props();

  let section = $state<Section>('root');
  let pane = $state<Pane | null>(null);
  let recordsOpen = $state(false);
  let seedItemKey = $state('');
  let waterDose = $state(10);
  let amendmentKey = $state('');
  let amendmentDose = $state(1);
  let compostRemoval = $state(true);
  let compostBatchId = $state('');
  let preview = $state<GardenCommandPreview | null>(null);
  let previewPayload = $state<GardenCommandPayload | null>(null);
  let previewSignature = $state('');
  let previewRevision = $state<number | null>(null);
  let previewReturnPane = $state<Pane | null>(null);
  let restoredFocusChoiceId = $state<string | null>(null);
  let pending = $state<string | null>(null);
let pendingAction = $state<PendingGardenAction | null>(null);
  let message = $state<string | null>(null);
  let messageError = $state(false);
  let burningId = $state<string | null>(null);
  let commitForm = $state<HTMLFormElement>();
let autoPreviewForm = $state<HTMLFormElement>();
let previewFormRequest: PreviewRequest | null = null;
let previewRequestSequence = 0;
let lastAutoPreviewKey = '';
let focusPreviewAfterBatchFinish = false;
let lastPublishedInteractionLock = false;
  let apiaryHand = $state<ApiaryWorkflowHand | null>(null);
  let lastSelectedId = $state(untrack(() => selected?.id ?? null));
  let burnAction = $state(untrack(() => resolveBurnAction(burnStyle)));
  let burnController: AbortController | null = null;

  let seeds = $derived(snapshot.garden?.inventory.filter((item) => item.kind === 'seed') ?? []);
  let availableSeeds = $derived(seeds.filter((seed) => seed.quantity > 0));
  let selectedSeed = $derived(seeds.find((seed) => seed.itemKey === seedItemKey) ?? null);
  let amendments = $derived(snapshot.garden?.inventory.filter((item) => item.kind === 'amendment' && item.quantity > 0) ?? []);
  let targets = $derived(batchMode ? [...batchTargetIds] : selected ? [selected.id] : []);
  let compostableBatches = $derived(snapshot.ingredients.filter((batch) => {
    const available = batch.quantity - (batch.consumedQuantity ?? 0) - (batch.compostedQuantity ?? 0);
    return available > 0 && batch.id !== snapshot.brewery.activeSession?.ingredientBatchId && batch.id !== snapshot.bakery.activeSession?.ingredientBatchId;
  }));
  let hasApiaryAction = $derived(Boolean(selected && (
    (selected.kind === 'empty' && (snapshot.garden?.inventory.some((item) => item.kind === 'equipment' && item.quantity > 0) ?? false))
    || (selected.kind === 'beehive' && (!selected.hive?.hasColony
      ? (snapshot.garden?.inventory.some((item) => item.kind === 'colony' && item.quantity > 0) ?? false)
      : true))
  )));
  let target = $derived(moveTargetId ? snapshot.cells.find((cell) => cell.id === moveTargetId) ?? null : null);
let compostEligible = $derived(Boolean(selected?.kind === 'plant' && selected.plant
  && selected.plant.lifecycle !== 'seedling'
  && (selected.plant.lifecycle === 'dead' || selected.plant.ageDays >= 2 || selected.plant.growthProgress >= 35)));
let gardenMutationLocked = $derived(Boolean(pendingAction));
let mutationInFlight = $derived(Boolean(pending?.startsWith('commit:')));
let canPreview = $derived(!!preview && !!previewPayload
  && signature(preview.commandKind, makePayload(preview.commandKind as PreviewKind)) === previewSignature
  && previewSignature === signature(preview.commandKind, previewPayload)
  && previewRevision === snapshot.save.revision);

  $effect(() => {
    const nextId = selected?.id ?? null;
    if (nextId === lastSelectedId) return;
    if (gardenMutationLocked) return;
    lastSelectedId = nextId;
    section = 'root';
    pane = null;
    apiaryHand = null;
    restoredFocusChoiceId = null;
    recordsOpen = false;
    clearPreview();
    previewReturnPane = null;
    lastAutoPreviewKey = '';
    message = null;
    messageError = false;
  });

  $effect(() => {
    const locked = gardenMutationLocked || Boolean(apiaryHand?.locked);
    if (locked === lastPublishedInteractionLock) return;
    lastPublishedInteractionLock = locked;
    untrack(() => oninteractionlockchange?.(locked));
  });

  $effect(() => {
    const kind = currentDraftKind();
    if (!kind || gardenMutationLocked) return;
    const payload = makePayload(kind);
    if (!payload) {
      lastAutoPreviewKey = '';
      if (pending?.startsWith('preview:')) {
        previewRequestSequence += 1;
        previewFormRequest = null;
        pending = null;
      }
      return;
    }
    const key = `${signature(kind, payload)}@${snapshot.save.revision}`;
    if (key === lastAutoPreviewKey) return;
    lastAutoPreviewKey = key;
    void requestPreview(kind);
  });

  beforeNavigate(({ cancel }) => {
    if (gardenMutationLocked || apiaryHand?.locked) cancel();
  });

  onDestroy(() => {
    burnController?.abort();
    if (lastPublishedInteractionLock) oninteractionlockchange?.(false);
  });

  function signature(kind: GardenCommandKind, payload: GardenCommandPayload | null) {
    return `${kind}:${JSON.stringify(payload)}`;
  }

  function currentEditingPane() {
    return pane === 'preview' ? previewReturnPane : pane;
  }

  function currentDraftKind(): PreviewKind | null {
    const candidate = currentEditingPane();
    return candidate && candidate !== 'apiary' && candidate !== 'preview'
      ? candidate
      : null;
  }

  function targetSignature(kind: PreviewKind, payload: GardenCommandPayload) {
    if (kind === 'move') return `move:${moveTargetId ?? ''}`;
    if ('cellIds' in payload) return `cells:${payload.cellIds.join('|')}`;
    return `cell:${selected?.id ?? ''}`;
  }

  function requestIsCurrent(request: PreviewRequest, payload: GardenCommandPayload) {
    return currentEditingPane() === request.kind
      && selected?.id === request.selectedId
      && snapshot.save.revision === request.revision
      && signature(request.kind, payload) === request.signature
      && targetSignature(request.kind, payload) === request.targetSignature;
  }

  function label(kind: GardenCommandKind) {
    return ({
      plant: 'Plant', water: 'Water', amend: 'Fertilize', move: 'Move', remove: 'Remove',
      incorporate_clover: 'Incorporate clover', compost_ingredient: 'Compost', purchase: 'Purchase', expand: 'Expand'
    } satisfies Record<GardenCommandKind, string>)[kind];
  }

  function makePayload(kind: PreviewKind): GardenCommandPayload | null {
    if (!selected) return null;
    if (kind === 'plant') return selected.kind === 'empty' && availableSeeds.some((seed) => seed.itemKey === seedItemKey)
      ? { cellId: selected.id, seedItemKey }
      : null;
    if (kind === 'water') return targets.length ? { cellIds: targets, dose: Number(waterDose) } : null;
    if (kind === 'amend') return targets.length && amendments.some((item) => item.itemKey === amendmentKey)
      ? { cellIds: targets, itemKey: amendmentKey, dose: Number(amendmentDose) }
      : null;
    if (kind === 'move') return target ? { sourceCellId: selected.id, targetCellId: target.id } : null;
    if (kind === 'remove') return selected.kind === 'plant' ? { cellId: selected.id, compost: compostEligible && compostRemoval } : null;
    if (kind === 'incorporate_clover') return { cellId: selected.id };
    if (kind === 'compost_ingredient') return compostableBatches.some((batch) => batch.id === compostBatchId)
      ? { cellId: selected.id, ingredientBatchId: compostBatchId, quantity: 1 }
      : null;
    return null;
  }

  function clearPreview() {
    previewRequestSequence += 1;
    previewFormRequest = null;
    if (pending?.startsWith('preview:')) pending = null;
    preview = null;
    previewPayload = null;
    previewSignature = '';
    previewRevision = null;
  }

  async function requestPreview(kind: PreviewKind) {
    if (gardenMutationLocked) return;
    const payload = makePayload(kind);
    if (!payload) return;
    const returnPane = currentEditingPane();
    if (returnPane !== kind) return;

    const request: PreviewRequest = {
      sequence: ++previewRequestSequence,
      kind,
      signature: signature(kind, payload),
      targetSignature: targetSignature(kind, payload),
      revision: snapshot.save.revision,
      selectedId: selected?.id ?? null,
      returnPane: kind
    };
    previewFormRequest = request;
    pending = `preview:${kind}:${request.sequence}`;
    message = null;
    messageError = false;
    await tick();
    if (request.sequence !== previewRequestSequence || gardenMutationLocked) return;
    autoPreviewForm?.requestSubmit();
  }

  const previewAction: SubmitFunction = ({ formData, cancel }) => {
    const request = previewFormRequest;
    const payload = request ? makePayload(request.kind) : null;
    if (!request || !payload || gardenMutationLocked || !requestIsCurrent(request, payload)) {
      cancel();
      return;
    }

    formData.set('commandKind', request.kind);
    formData.set('payload', JSON.stringify(payload));
    const pendingKey = `preview:${request.kind}:${request.sequence}`;
    return async ({ result }) => {
      if (request.sequence !== previewRequestSequence) return;
      if (pending === pendingKey) pending = null;
      const currentPayload = makePayload(request.kind);
      if (!currentPayload || !requestIsCurrent(request, currentPayload)) return;
      const body = 'data' in result ? result.data as { preview?: GardenCommandPreview; message?: string } | undefined : undefined;
      if (result.type === 'success' && body?.preview) {
        if (body.preview.basedOnRevision !== request.revision) {
          previewRevision = null;
          message = 'The garden changed while the preview was being prepared. Review the action and preview again.';
          messageError = true;
        } else {
          preview = body.preview;
          previewPayload = payload;
          previewSignature = signature(request.kind, payload);
          previewRevision = body.preview.basedOnRevision;
          previewReturnPane = request.returnPane;
          pane = 'preview';
          messageError = false;
        }
      } else {
        message = body?.message ?? 'The authoritative preview is unavailable.';
        messageError = true;
      }
      await focusBatchConfirmationWhenReady();
    };
  };

  const commit: SubmitFunction = ({ formData, cancel }) => {
    if (pending || selectingBatchPlots) {
      cancel();
      return;
    }

    if (!pendingAction && (!preview || !previewPayload || !canPreview || preview.canCommit === false)) {
      cancel();
      message = 'The garden changed after this preview. Review the action and let the preview refresh.';
      messageError = true;
      return;
    }

    if (!pendingAction && preview && previewPayload) {
      const commandKind = preview.commandKind;
      const key = signature(commandKind, previewPayload);
      const commandBurnAction = resolveBurnAction(burnStyle);
      burnAction = commandBurnAction;
      pendingAction = {
        id: crypto.randomUUID(),
        kind: commandKind,
        payload: previewPayload,
        signature: key,
        revision: previewRevision ?? snapshot.save.revision,
        burnAction: commandBurnAction
      };
    }
    const commandAction = pendingAction;
    if (!commandAction) {
      cancel();
      return;
    }
    formData.set('saveId', snapshot.save.id);
    formData.set('actionId', commandAction.id);
    formData.set('expectedRevision', String(commandAction.revision));
    formData.set('commandKind', commandAction.kind);
    formData.set('payload', JSON.stringify(commandAction.payload));
    pending = `commit:${commandAction.kind}`;
    message = null;
    messageError = false;

    return async ({ result, update }) => {
      pending = null;
      const body = 'data' in result ? result.data as { message?: string; pendingAction?: object; conflict?: boolean } | undefined : undefined;
      if (result.type === 'error' || body?.pendingAction) {
        message = body?.message ?? 'The outcome is unknown. Retry this exact action.';
        messageError = true;
        return;
      }

      if (result.type === 'success') {
        message = body?.message ?? `${label(commandAction.kind)} complete.`;
        messageError = false;
        await animateAcceptedCommand(commandAction.burnAction);
        pendingAction = null;
        clearPreview();
        pane = null;
        previewReturnPane = null;
        restoredFocusChoiceId = null;
        lastAutoPreviewKey = '';
        if (batchMode) await oncancelbatch();
        if (moveSourceId) await oncancelmove();
        await update({ reset: false, invalidateAll: true });
      } else {
        message = body?.conflict
          ? 'The garden changed before this action was accepted. Review the new state and preview again.'
          : body?.message ?? 'The action was rejected. Review the inputs and preview again.';
        messageError = true;
        const returnPane = previewReturnPane;
        pendingAction = null;
        clearPreview();
        pane = returnPane;
        previewReturnPane = null;
        lastAutoPreviewKey = '';
        await update({ reset: false, invalidateAll: !!body?.conflict });
      }
    };
  };

  async function animateAcceptedCommand(action: ResolvedBurnAction) {
    burnController?.abort();
    const controller = new AbortController();
    burnController = controller;
    burningId = 'garden-preview';
    await tick();
    const completed = await waitForBurn(action.durationMs, controller.signal);
    if (!completed || controller.signal.aborted) return;
    burningId = null;
    if (burnController === controller) burnController = null;
  }

  function submitPreview() {
    if (!pending && !selectingBatchPlots) commitForm?.requestSubmit();
  }

  async function focusBatchConfirmationWhenReady() {
    if (!focusPreviewAfterBatchFinish || pending?.startsWith('preview:')) return;
    focusPreviewAfterBatchFinish = false;
    await tick();
    document.querySelector<HTMLElement>('[data-workflow-confirm]')?.focus({ preventScroll: true });
  }

  async function finishBatchSelection() {
    focusPreviewAfterBatchFinish = true;
    await onfinishbatch();
    await tick();
    if (pending?.startsWith('preview:')) return;

    const kind = currentDraftKind();
    const payload = kind ? makePayload(kind) : null;
    const requestKey = kind && payload ? `${signature(kind, payload)}@${snapshot.save.revision}` : '';
    if (kind && requestKey && requestKey !== lastAutoPreviewKey) {
      lastAutoPreviewKey = requestKey;
      void requestPreview(kind);
      return;
    }
    await focusBatchConfirmationWhenReady();
  }

  function cancelPreview() {
    if (gardenMutationLocked) return;
    const returnPane = previewReturnPane;
    const resourceFocus = returnPane === 'plant' && seedItemKey
      ? `seed:${seedItemKey}`
      : returnPane === 'amend' && amendmentKey
        ? `amendment:${amendmentKey}`
        : returnPane === 'compost_ingredient' && compostBatchId
          ? `compost-batch:${compostBatchId}`
          : null;
    const returnFocus = resourceFocus ?? (returnPane && handItems.some((item) => item.id === returnPane) ? returnPane : null);
    restoredFocusChoiceId = returnFocus;
    clearPreview();
    if (returnPane === 'plant') {
      seedItemKey = '';
      pane = 'plant';
    } else if (returnPane === 'amend') {
      amendmentKey = '';
      pane = 'amend';
    } else if (returnPane === 'compost_ingredient') {
      compostBatchId = '';
      pane = 'compost_ingredient';
    } else if (returnPane === 'move') {
      section = 'move';
      pane = 'move';
    } else {
      pane = null;
    }
    previewReturnPane = null;
    if (returnPane !== 'move') lastAutoPreviewKey = '';
    message = null;
    messageError = false;
  }

  async function choose(id: string) {
    if (pane === 'apiary' && id.startsWith('apiary:')) {
      if (!apiaryHand?.locked && (!apiaryHand?.pending || id === 'apiary:back')) apiaryHand?.choose(id);
      return;
    }
    if (gardenMutationLocked) return;
    restoredFocusChoiceId = null;
    if (id.startsWith('seed:') && (pane === 'plant' || (pane === 'preview' && previewReturnPane === 'plant'))) {
      const itemKey = id.slice(5);
      if (mutationInFlight || selected?.kind !== 'empty' || !availableSeeds.some((seed) => seed.itemKey === itemKey)) return;
      seedItemKey = itemKey;
      if (pane !== 'preview') pane = 'plant';
      previewReturnPane = 'plant';
      const payload = makePayload('plant');
      lastAutoPreviewKey = payload ? `${signature('plant', payload)}@${snapshot.save.revision}` : '';
      await requestPreview('plant');
      return;
    }
    if (id.startsWith('amendment:')) {
      const itemKey = id.slice('amendment:'.length);
      if (mutationInFlight || !amendments.some((item) => item.itemKey === itemKey)) return;
      amendmentKey = itemKey;
      if (pane !== 'preview') pane = 'amend';
      previewReturnPane = 'amend';
      const payload = makePayload('amend');
      lastAutoPreviewKey = payload ? `${signature('amend', payload)}@${snapshot.save.revision}` : '';
      void requestPreview('amend');
      return;
    }
    if (id.startsWith('compost-batch:')) {
      const batchId = id.slice('compost-batch:'.length);
      if (mutationInFlight || !compostableBatches.some((batch) => batch.id === batchId)) return;
      compostBatchId = batchId;
      if (pane !== 'preview') pane = 'compost_ingredient';
      previewReturnPane = 'compost_ingredient';
      const payload = makePayload('compost_ingredient');
      lastAutoPreviewKey = payload ? `${signature('compost_ingredient', payload)}@${snapshot.save.revision}` : '';
      void requestPreview('compost_ingredient');
      return;
    }
    if (id === 'harvest') { onharvest(); return; }
    if (id === 'back') {
      if (pane === 'preview') cancelPreview();
      else if (pane) {
        if (pane === 'move' || moveSourceId) void oncancelmove();
        if (splitTargetId) void oncancelsplit();
        clearPreview();
        previewReturnPane = null;
        pane = null;
        lastAutoPreviewKey = '';
      }
      else section = 'root';
      return;
    }
    if (section === 'root') {
      if (id === 'crop' || id === 'soil' || id === 'apiary') section = id;
      else if (id === 'move') {
        section = 'move';
        pane = 'move';
        clearPreview();
        previewReturnPane = null;
        lastAutoPreviewKey = '';
        await onstartmove();
      }
      return;
    }
    if (section === 'move' && id === 'move') {
      const payload = makePayload('move');
      if (payload) {
        lastAutoPreviewKey = `${signature('move', payload)}@${snapshot.save.revision}`;
        void requestPreview('move');
      }
      return;
    }
    if (id === 'plant' || id === 'water' || id === 'amend' || id === 'remove' || id === 'incorporate_clover' || id === 'compost_ingredient') {
      clearPreview();
      previewReturnPane = null;
      lastAutoPreviewKey = '';
      pane = id;
      if (id === 'plant') seedItemKey = '';
      if (id === 'amend') amendmentKey = amendments.some((item) => item.itemKey === amendmentKey) ? amendmentKey : '';
      if (id === 'remove') {
        compostRemoval = compostEligible;
      }
      if (id === 'compost_ingredient') compostBatchId = '';
      if (batchMode && batchMode !== id) await oncancelbatch();
      return;
    }
    if (id === 'manage-apiary') { apiaryHand = null; pane = 'apiary'; }
    else if (id === 'select-plots') {
      const batchKind = pane === 'preview' ? previewReturnPane : pane;
      if (batchKind === 'water' || batchKind === 'amend') await onstartbatch(batchKind);
    }
    else if (id === 'back-to-plot') { section = 'root'; pane = null; }
  }

  function handleBack() {
    if (gardenMutationLocked) return;
    if (recordsOpen) {
      recordsOpen = false;
      return;
    }
    if (pane === 'apiary' && apiaryHand) {
      if (apiaryHand.locked) return;
      if (apiaryHand.backAvailable || apiaryHand.previewOpen || apiaryHand.selectedId) {
        apiaryHand.choose('apiary:back');
        return;
      }
    }
    if (pane === 'preview') {
      cancelPreview();
      return;
    }
    restoredFocusChoiceId = null;
    if (moveSourceId) {
      void oncancelmove();
      clearPreview();
      pane = null;
      section = 'root';
      lastAutoPreviewKey = '';
      return;
    }
    if (selectingBatchPlots) {
      void oncancelbatch();
      return;
    }
    if (pane) {
      clearPreview();
      if (pane === 'move') {
        void oncancelmove();
        section = 'root';
      }
      previewReturnPane = null;
      pane = null;
      apiaryHand = null;
      lastAutoPreviewKey = '';
      return;
    }
    if (section !== 'root') {
      section = 'root';
      return;
    }
    if (selected) void onclose();
  }

  function openRecords() {
    if (gardenMutationLocked || apiaryHand?.locked) return;
    recordsOpen = true;
    section = 'root';
    pane = null;
    restoredFocusChoiceId = null;
    clearPreview();
    previewReturnPane = null;
    lastAutoPreviewKey = '';
  }

  let rootChoices = $derived.by((): WorkflowChoice[] => {
    if (!selected) return [];
    const choices: WorkflowChoice[] = [];
    if (selected.kind === 'plant' && selected.harvestable) choices.push({ id: 'harvest', title: harvestRetryAvailable ? 'Retry harvest' : 'Harvest crop', description: 'Gather this crop into the pantry.', eyebrow: 'Gather', icon: '✦', actionLabel: 'Harvest', disabled: harvestPending });
    if (selected.kind !== 'beehive') choices.push({ id: 'crop', title: 'Crop', description: 'Plant, remove, or work established clover.', eyebrow: 'Garden hand', icon: '🌱', actionLabel: 'Open crop choices', burn: true });
    if (selected.kind !== 'beehive') choices.push({ id: 'soil', title: 'Soil', description: 'Water plots, amend soil, or start compost.', eyebrow: 'Garden hand', icon: '🪴', actionLabel: 'Open soil choices', burn: true });
    if (hasApiaryAction) choices.push({ id: 'apiary', title: 'Apiary', description: 'Install a hive or tend a colony at this plot.', eyebrow: 'Garden hand', icon: '🐝', actionLabel: 'Open apiary choices', burn: true });
    if (selected.kind !== 'empty') choices.push({ id: 'move', title: 'Move', description: 'Choose another plot to swap occupants.', eyebrow: 'Garden hand', icon: '↔', actionLabel: 'Choose a destination', burn: true });
    return choices;
  });

  let handItems = $derived.by((): WorkflowChoice[] => {
    if (!selected || recordsOpen) return [];
    if (pane === 'apiary' && apiaryHand?.items.length) return apiaryHand.items;
    const actionPane = pane === 'preview' ? previewReturnPane : pane;
    if (actionPane === 'plant' && selected.kind === 'empty') return availableSeeds.map((seed) => ({
      id: `seed:${seed.itemKey}`, title: seed.name, description: seed.guidance?.[0] ?? 'Preview planting one seed in this plot.',
      eyebrow: 'Seeds', icon: '✿', meta: `${seed.quantity} in inventory`,
      actionLabel: 'Choose seed', disabled: seed.quantity <= 0 || gardenMutationLocked, burn: true
    }));
    if (actionPane === 'amend') {
      const cards = amendments.map((item) => ({
        id: `amendment:${item.itemKey}`, title: item.name,
        description: item.guidance?.[0] ?? 'Apply this amendment to the selected plot targets.',
        eyebrow: 'Owned amendment', icon: '✦', meta: `${item.quantity} in inventory`,
        actionLabel: 'Choose amendment', disabled: gardenMutationLocked, burn: true
      }));
      const targetChoice: WorkflowChoice = {
        id: 'select-plots', title: batchMode === 'amend' ? 'Edit plot selection' : 'Select plots',
        description: 'Choose garden plots directly on the scene. Enter or Space activates each plot.',
        eyebrow: 'Batch care', icon: '⬡', meta: `${batchTargetIds.size} selected`,
        actionLabel: batchMode === 'amend' ? 'Edit targets' : 'Choose targets', disabled: gardenMutationLocked, burn: true
      };
      return [...cards, targetChoice, { id: 'back', title: 'Back', description: 'Return to soil choices.', icon: '←', actionLabel: 'Soil choices', burn: true }];
    }
    if (actionPane === 'compost_ingredient') {
      const cards = compostableBatches.map((batch) => ({
        id: `compost-batch:${batch.id}`, title: batch.plantName,
        description: 'Compost exactly one available unit from this ingredient batch.',
        eyebrow: 'Ingredient batch', icon: '♻',
        meta: `${batch.quantity - (batch.consumedQuantity ?? 0) - (batch.compostedQuantity ?? 0)} available`,
        actionLabel: 'Compost 1 unit', disabled: gardenMutationLocked, burn: true
      }));
      return [...cards, { id: 'back', title: 'Back', description: 'Return to soil choices.', icon: '←', actionLabel: 'Soil choices', burn: true }];
    }
    if (section === 'root') return rootChoices;
    const back = { id: 'back', title: 'Back', description: 'Return to plot actions.', icon: '←', actionLabel: 'Plot actions', burn: true } satisfies WorkflowChoice;
    if (section === 'crop') {
      const choices: WorkflowChoice[] = [];
      if (selected.kind === 'empty') choices.push({ id: 'plant', title: 'Plant', description: availableSeeds.length ? 'Choose a seed for this open plot.' : 'No seeds are available in the garden inventory.', eyebrow: 'Crop', icon: '🌱', actionLabel: 'Choose seed', burn: true });
      if (selected.kind === 'plant') choices.push({ id: 'remove', title: 'Remove plant', description: 'Remove this crop, with an option to compost eligible biomass.', eyebrow: 'Crop', icon: '✂', actionLabel: 'Review removal', burn: true });
      if (selected.kind === 'plant' && selected.plant?.speciesKey === 'clover') choices.push({ id: 'incorporate_clover', title: 'Incorporate clover', description: 'Release local soil benefits over the next three days.', eyebrow: 'Crop', icon: '☘', actionLabel: 'Review clover', burn: true });
      return [...choices, back];
    }
    if (section === 'soil') {
      const choices: WorkflowChoice[] = [
        { id: 'water', title: 'Water', description: 'Set a dose for this plot or a batch of plots.', eyebrow: 'Soil', icon: '💧', actionLabel: 'Set water dose', burn: true },
        { id: 'amend', title: 'Fertilize', description: 'Choose an amendment and strength.', eyebrow: 'Soil', icon: '✦', actionLabel: 'Set amendment', disabled: !amendments.length, burn: true }
      ];
      if (pane === 'water' || pane === 'amend' || (pane === 'preview' && (previewReturnPane === 'water' || previewReturnPane === 'amend'))) {
        const batchKind = pane === 'preview' ? previewReturnPane : pane;
        choices.push({ id: 'select-plots', title: batchMode === batchKind ? 'Edit plot selection' : 'Select plots', description: 'Choose garden plots directly on the scene. Enter or Space activates each plot.', eyebrow: 'Batch care', icon: '⬡', meta: `${batchTargetIds.size} selected`, actionLabel: batchMode === batchKind ? 'Edit targets' : 'Choose targets', disabled: gardenMutationLocked, burn: true });
      }
      if (compostableBatches.length) choices.push({ id: 'compost_ingredient', title: 'Compost', description: 'Turn an available ingredient batch into soil improvement.', eyebrow: 'Soil', icon: '♻', actionLabel: 'Choose a batch', burn: true });
      return [...choices, back];
    }
    if (section === 'apiary') return [
      { id: 'manage-apiary', title: selected.kind === 'empty' ? 'Install a hive' : selected.hive?.hasColony ? 'Manage colony' : 'Populate hive', description: 'Review apiary actions, available supplies, and colony care.', eyebrow: 'Apiary', icon: '🐝', actionLabel: 'Open apiary folio', burn: true },
      back
    ];
    if (section === 'move') return [
      { id: 'move', title: 'Move or swap', description: target ? `Destination: ${target.layoutKey}. Confirm the move in the folio.` : 'Select a destination plot on the scene.', eyebrow: 'Relocate', icon: '↔', actionLabel: target ? 'Review move' : 'Choose destination', burn: false },
      back
    ];
    return [back];
  });

  let focusChoiceId = $derived.by(() => {
    if (pane === 'apiary' && apiaryHand?.items.length) return apiaryHand.selectedId ?? apiaryHand.focusId ?? apiaryHand.items.find((item) => !item.disabled)?.id ?? null;
    if (pane === 'preview') return null;
    if (restoredFocusChoiceId && handItems.some((item) => item.id === restoredFocusChoiceId)) return restoredFocusChoiceId;
    const actionPane = pane;
    if (actionPane === 'plant') return seedItemKey ? `seed:${seedItemKey}` : handItems[0]?.id ?? null;
    if (actionPane === 'amend') return amendmentKey ? `amendment:${amendmentKey}` : handItems[0]?.id ?? null;
    if (actionPane === 'compost_ingredient') return compostBatchId ? `compost-batch:${compostBatchId}` : handItems[0]?.id ?? null;
    if (section === 'root') return null;
    if (pane === 'water' || pane === 'amend') return 'select-plots';
    if (pane === 'apiary') return 'manage-apiary';
    if (section === 'soil') return 'water';
    if (section === 'crop') return handItems[0]?.id ?? 'back';
    if (section === 'move') return 'move';
    return null;
  });

  let selectedChoiceId = $derived.by(() => {
    if (pane === 'apiary' && apiaryHand?.items.length) return apiaryHand.selectedId;
    if (pane === 'preview') return null;
    if (restoredFocusChoiceId && handItems.some((item) => item.id === restoredFocusChoiceId)) return restoredFocusChoiceId;
    const actionPane = pane;
    if (actionPane === 'plant') return seedItemKey ? `seed:${seedItemKey}` : null;
    if (actionPane === 'amend') return amendmentKey ? `amendment:${amendmentKey}` : null;
    if (actionPane === 'compost_ingredient') return compostBatchId ? `compost-batch:${compostBatchId}` : null;
    return pane ?? (section === 'root' ? null : section);
  });
  let hasFolio = $derived(Boolean(selected || recordsOpen));
  let hasHand = $derived(Boolean(selected && !recordsOpen && !(pane === 'apiary' && apiaryHand?.previewOpen)));
  let frameFocusKey = $derived(selected?.id ?? (recordsOpen ? 'garden-ledger' : null));

  function harvestStatus() {
    if (harvestPending) return 'Gathering the selected crop…';
    if (transportError) return 'The harvest result is unresolved. Retry the same harvest from this folio.';
    return null;
  }
</script>

{#snippet sceneContent()}
  {@render scene()}
{/snippet}

{#snippet statusContent()}
  <div class="garden-status" aria-label="Garden status">
    <span>Day {snapshot.save.currentDay}</span>
    <span>{snapshot.cells.filter((cell) => cell.unlocked !== false).length} plots</span>
    <span>{snapshot.cells.filter((cell) => cell.kind === 'plant' && cell.harvestable).length} ready</span>
    <span>{snapshot.save.gold ?? 0} gold</span>
    {#if moveSourceId}<strong>Choose a destination, then press Enter or Space.</strong>{/if}
    {#if batchMode}<strong>{batchTargetIds.size} plot{batchTargetIds.size === 1 ? '' : 's'} selected for {batchMode}.</strong>{/if}
  </div>
{/snippet}

{#snippet controlsContent()}
  <div class="garden-header-actions">
    {#if recordsOpen}
      <button type="button" onclick={handleBack}>Return to courtyard</button>
    {:else}
      <button type="button" data-garden-ledger-trigger disabled={gardenMutationLocked || !!apiaryHand?.locked} onclick={openRecords}>Garden ledger</button>
    {/if}
    {#if selected && batchMode}
      <button type="button" class="text-button" disabled={gardenMutationLocked} onclick={() => void oncancelbatch()}>Cancel batch</button>
    {/if}
  </div>
{/snippet}

{#snippet folioContent()}
  {#if pane === 'preview' && preview && previewPayload}
    {@const currentPreview = preview}
    {@const feedback = gardenCommandPreviewFeedback(currentPreview, {
      cellLabel: (cellId) => snapshot.cells.find((cell) => cell.id === cellId)?.layoutKey,
      itemName: (itemKey) => snapshot.garden?.inventory.find((item) => item.itemKey === itemKey)?.name
    })}
    {@const draftPane = currentEditingPane()}
    {@const draftPayload = draftPane ? makePayload(draftPane as PreviewKind) : null}
    {@const isCropOrSoil = ['plant', 'water', 'amend'].includes(currentPreview.commandKind)}
    {@const moveSourceCellId = 'sourceCellId' in previewPayload ? previewPayload.sourceCellId : null}
    {@const moveDestinationCellId = 'targetCellId' in previewPayload ? previewPayload.targetCellId : null}
    {@const moveSourceCell = snapshot.cells.find((cell) => cell.id === moveSourceCellId) ?? null}
    {@const moveDestinationCell = snapshot.cells.find((cell) => cell.id === moveDestinationCellId) ?? null}
    {@const removesWithCompost = 'compost' in previewPayload && previewPayload.compost === true}
    {@const compostBatchIdForPreview = 'ingredientBatchId' in previewPayload ? previewPayload.ingredientBatchId : null}
    {@const compostBatch = snapshot.ingredients.find((batch) => batch.id === compostBatchIdForPreview) ?? null}
    {@const compostQuantity = currentPreview.commandKind === 'compost_ingredient' && 'quantity' in previewPayload ? previewPayload.quantity : 1}
    {@const inspectionItem: WorkflowChoice = {
      id: 'garden-preview',
      title: `Confirm ${label(currentPreview.commandKind)}`,
      description: feedback.summary,
      eyebrow: `Plot ${selected?.layoutKey ?? 'garden'}`,
      icon: currentPreview.commandKind === 'water' ? '💧' : currentPreview.commandKind === 'plant' ? '🌱' : '✧',
      actionLabel: pending?.startsWith('commit:') ? 'Applying…' : pendingAction && messageError ? `Retry ${label(currentPreview.commandKind)}` : label(currentPreview.commandKind),
      disabled: selectingBatchPlots || (!pendingAction && (currentPreview.canCommit === false || !canPreview || messageError))
    }}
    <WorkflowInspection
      item={inspectionItem}
      onconfirm={submitPreview}
      oncancel={gardenMutationLocked || selectingBatchPlots ? undefined : cancelPreview}
      confirmLabel={inspectionItem.actionLabel}
      pending={!!pending}
      burning={burningId === 'garden-preview'}
      {burnAction}
      error={messageError ? message : null}
    >
      {#snippet options()}
        <section class="preview-options" aria-label="Authoritative garden preview">
          {#if pending?.startsWith('preview:')}
            <p class="help" role="status">Refreshing the authoritative preview…</p>
          {/if}
          {#if selectingBatchPlots}
            <div class="batch-toolbar" data-garden-batch-toolbar>
              <strong>Select plots with Enter, Space, or a click. Escape cancels.</strong>
              <div><button type="button" class="secondary-button" disabled={gardenMutationLocked} onclick={() => void finishBatchSelection()}>Done · {batchTargetIds.size}</button><button type="button" class="text-button" disabled={gardenMutationLocked} onclick={() => void oncancelbatch()}>Cancel</button></div>
            </div>
          {/if}
          {#if draftPayload && 'cellIds' in draftPayload}
            <p class="help" data-garden-preview-targets>
              Targets: {draftPayload.cellIds.map((id) => snapshot.cells.find((cell) => cell.id === id)?.layoutKey ?? id).join(', ')}
            </p>
          {/if}
          {#if currentPreview.commandKind === 'water'}
            <label>Water amount <output>{waterDose}</output>
              <input aria-label="Water amount" type="range" min="1" max="40" step="1" value={waterDose} disabled={gardenMutationLocked}
                oninput={(event) => { waterDose = Number(event.currentTarget.value); }} />
            </label>
          {:else if currentPreview.commandKind === 'amend'}
            <label>Strength <output>{['Light', 'Medium', 'Heavy'][Number(amendmentDose) - 1]} · {amendmentDose}</output>
              <input aria-label="Fertilizer strength" type="range" min="1" max="3" step="1" value={amendmentDose} disabled={gardenMutationLocked}
                oninput={(event) => { amendmentDose = Number(event.currentTarget.value); }} />
            </label>
          {:else if currentPreview.commandKind === 'remove'}
            {#if compostEligible}
              <label class="check"><input type="checkbox" checked={compostRemoval} disabled={gardenMutationLocked}
                onchange={(event) => { compostRemoval = event.currentTarget.checked; }} /> Compost eligible biomass</label>
            {:else if selected?.plant?.lifecycle === 'seedling'}
              <p class="help">Seedlings cannot be composted.</p>
            {:else}
              <p class="help">This plant is not eligible for composting.</p>
            {/if}
          {:else if currentPreview.commandKind === 'compost_ingredient'}
            <p class="help">Exactly {compostQuantity} unit{compostQuantity === 1 ? '' : 's'} from the {compostBatch?.plantName ?? 'selected ingredient'} batch will start a compost cycle at Plot {selected?.layoutKey ?? 'the garden'}. The first soil benefits arrive on Day {snapshot.save.currentDay + 1}.</p>
          {/if}
          {#if isCropOrSoil}
            {#each feedback.details as detail}
              <p class="preview-detail">{detail}</p>
            {/each}
            {#if feedback.resourceWarning && currentPreview.canCommit !== false}
              <p class="preview-warning" role="status">{feedback.resourceWarning}</p>
            {/if}
          {:else if currentPreview.commandKind === 'move'}
            <p class="preview-detail">
              {#if moveSourceCell && moveDestinationCell}
                {#if moveDestinationCell.kind === 'empty'}
                  The occupant at {moveSourceCell.layoutKey} will move to empty Plot {moveDestinationCell.layoutKey}; Plot {moveSourceCell.layoutKey} will be left empty.
                {:else}
                  Plots {moveSourceCell.layoutKey} and {moveDestinationCell.layoutKey} will swap occupants.
                {/if}
              {:else}
                The occupant at Plot {selected?.layoutKey ?? 'the source plot'} will move to the selected destination.
              {/if}
            </p>
          {:else if currentPreview.commandKind === 'remove'}
            <p class="preview-detail">
              {selected?.plantName ?? 'This plant'} at Plot {selected?.layoutKey ?? 'the garden'} will be removed permanently.
              {#if removesWithCompost}Its eligible biomass will be composted.{:else}Its biomass will not be composted.{/if}
            </p>
          {:else if currentPreview.commandKind === 'incorporate_clover'}
            <p class="preview-detail">Established clover at Plot {selected?.layoutKey ?? 'the garden'} will be sacrificed. Its soil benefits will be released over three in-game days.</p>
          {:else}
            <p class="preview-detail">{feedback.summary}</p>
          {/if}
          {#if currentPreview.canCommit === false}
            <p class="error" role="alert">{feedback.resourceWarning ?? 'This cannot be completed with the current resources.'}</p>
          {/if}
        </section>
      {/snippet}
    </WorkflowInspection>
    <form bind:this={commitForm} method="POST" action="?/command" use:enhance={commit} class="hidden-submit-form"></form>
  {:else if recordsOpen}
    <GardenOverview {snapshot} />
  {:else if selected}
    <div class="plot-folio" data-garden-plot-folio>
      {#if pane !== 'plant' && pane !== 'apiary'}<CropDetails cell={selected} />{/if}
      {#if selected.kind === 'plant' && selected.harvestable && harvest}
        <div hidden>
          {@render harvest()}
        </div>
          {#if harvestRetryAvailable && harvestActionId}
            <p class="retry-note">Retry uses the same harvest action {harvestActionId.slice(0, 8)}…</p>
          {/if}
      {/if}
      {#if transportError}
        <div class="form-message error" role="alert" aria-live="assertive">{transportError}</div>
      {/if}
      {#if formMessage}
        <div class="form-message" class:error={formError} role={formError ? 'alert' : 'status'} aria-live="polite">
          {formMessage}
          {#if formConflict}<span>The latest garden state has been loaded. Review the action and preview it again.</span>{/if}
        </div>
      {/if}
      {#if message && pane !== 'preview'}
        <p class:error={messageError} class="feedback" role={messageError ? 'alert' : 'status'}>{message}</p>
      {/if}

      {#if pane === 'apiary'}
        <GardenProvisionPanel {snapshot} {selected} {burnStyle} {splitTargetId} {onstartsplit} {oncancelsplit} externalHand onworkflowhandchange={(hand) => { apiaryHand = hand; }} />
      {:else if pane === 'plant'}
        <section class="action-fields" aria-labelledby="garden-action-title">
          <p class="eyebrow">Seeds · Plot {selected.layoutKey}</p><h2 id="garden-action-title">{selectedSeed?.name ?? 'Plant this plot'}</h2>
          {#if !availableSeeds.length}
            <p class="help" role="status">No seeds are available in your inventory. <a href="/shop">Visit Elara’s shop</a> to buy seeds.</p>
          {:else}
            <p class="help">Choose a seed card to preview planting one seed in this plot.</p>
          {/if}
          {#if pending?.startsWith('preview:plant:')}<p role="status">Checking this seed and plot…</p>{/if}
          {#if selectedSeed?.guidance?.length}
            <section class="seed-guidance" data-seed-guidance aria-label="Seed growing guidance">
              <p class="eyebrow">Before you plant</p>
              <ul>{#each selectedSeed.guidance as note}<li>{note}</li>{/each}</ul>
            </section>
          {/if}
        </section>
      {:else if pane === 'water'}
        <section class="action-fields" aria-labelledby="garden-action-title">
          <p class="eyebrow">Soil care</p><h2 id="garden-action-title">Water</h2>
          <p class="help">{targets.length} plot{targets.length === 1 ? '' : 's'} selected. Add plots from the hand, then finish selection here.</p>
          <label>Amount <output>{waterDose}</output><input aria-label="Water amount" type="range" min="1" max="40" step="1" value={waterDose} disabled={gardenMutationLocked}
            oninput={(event) => { waterDose = Number(event.currentTarget.value); }} /></label>
          {#if selectingBatchPlots}
            <div class="batch-toolbar" data-garden-batch-toolbar>
              <strong>Select plots with Enter, Space, or a click. Escape cancels.</strong>
              <div><button type="button" class="secondary-button" onclick={() => void finishBatchSelection()}>Done · {batchTargetIds.size}</button><button type="button" class="text-button" onclick={() => void oncancelbatch()}>Cancel</button></div>
            </div>
          {/if}
          {#if pending?.startsWith('preview:')}<p role="status">Checking this water dose and target set…</p>{/if}
        </section>
      {:else if pane === 'amend'}
        <section class="action-fields" aria-labelledby="garden-action-title">
          <p class="eyebrow">Soil care</p><h2 id="garden-action-title">Fertilize</h2>
          <p class="help">{targets.length} plot{targets.length === 1 ? '' : 's'} selected. Choose an owned amendment card and strength.</p>
          {#if !amendments.length}<p class="help" role="status">No amendments are available in your garden inventory.</p>{/if}
          <label>Strength <output>{['Light', 'Medium', 'Heavy'][Number(amendmentDose) - 1]} · {amendmentDose}</output>
            <input aria-label="Fertilizer strength" type="range" min="1" max="3" step="1" value={amendmentDose} disabled={gardenMutationLocked || !amendmentKey}
              oninput={(event) => { amendmentDose = Number(event.currentTarget.value); }} /></label>
          {#if selectingBatchPlots}
            <div class="batch-toolbar" data-garden-batch-toolbar>
              <strong>Select plots with Enter, Space, or a click. Escape cancels.</strong>
              <div><button type="button" class="secondary-button" onclick={() => void finishBatchSelection()}>Done · {batchTargetIds.size}</button><button type="button" class="text-button" onclick={() => void oncancelbatch()}>Cancel</button></div>
            </div>
          {/if}
          {#if pending?.startsWith('preview:')}<p role="status">Checking this amendment and target set…</p>{/if}
        </section>
      {:else if pane === 'move'}
        <section class="action-fields" aria-labelledby="garden-action-title">
          <p class="eyebrow">Relocate</p><h2 id="garden-action-title">Move or swap</h2>
          <p class="help">{target ? `Destination: ${target.layoutKey}. Its occupant will swap.` : 'Select a destination plot on the board. Arrow keys move focus; Enter or Space chooses the destination.'}</p>
          {#if pending?.startsWith('preview:')}<p role="status">Checking this destination…</p>{/if}
        </section>
      {:else if pane === 'remove'}
        <section class="action-fields" aria-labelledby="garden-action-title">
          <p class="eyebrow">Crop care</p><h2 id="garden-action-title">Remove plant</h2>
          <p class="help">This removes the plant permanently.</p>
          {#if compostEligible}
            <label class="check"><input type="checkbox" checked={compostRemoval} disabled={gardenMutationLocked}
              onchange={(event) => { compostRemoval = event.currentTarget.checked; }} /> Compost eligible biomass</label>
          {:else if selected.plant?.lifecycle === 'seedling'}
            <p class="help">Seedlings cannot be composted.</p>
          {:else}
            <p class="help">This plant is not eligible for composting.</p>
          {/if}
          {#if pending?.startsWith('preview:')}<p role="status">Checking plant removal…</p>{/if}
        </section>
      {:else if pane === 'incorporate_clover'}
        <section class="action-fields" aria-labelledby="garden-action-title">
          <p class="eyebrow">Crop care</p><h2 id="garden-action-title">Incorporate clover</h2>
          <p class="help">Established clover is sacrificed and releases local soil benefits over three days.</p>
          {#if pending?.startsWith('preview:')}<p role="status">Checking clover incorporation…</p>{/if}
        </section>
      {:else if pane === 'compost_ingredient'}
        <section class="action-fields" aria-labelledby="garden-action-title">
          <p class="eyebrow">Soil care</p><h2 id="garden-action-title">Compost ingredient</h2>
          <p class="help">Choose an ingredient batch card. Compost uses exactly one available unit.</p>
          {#if !compostableBatches.length}<p class="help" role="status">No unreserved ingredient batches are available to compost.</p>{/if}
          {#if pending?.startsWith('preview:')}<p role="status">Checking this ingredient batch…</p>{/if}
        </section>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet handContent()}
  <WorkflowHand
    items={handItems}
    label={pane === 'apiary' && apiaryHand?.items.length ? `Colony actions for ${selected?.layoutKey ?? 'this hive'}` : (pane === 'plant' || (pane === 'preview' && previewReturnPane === 'plant')) ? `Seeds for ${selected?.layoutKey ?? 'this plot'}` : section === 'root' ? `Actions for ${selected?.layoutKey ?? 'this plot'}` : `${section} choices for ${selected?.layoutKey ?? 'this plot'}`}
    selectedId={selectedChoiceId}
    focusId={focusChoiceId}
    {burnStyle}
      burningId={harvestBurnAction ? 'harvest' : null}
      burnAction={harvestBurnAction ?? undefined}
    pending={mutationInFlight || gardenMutationLocked || harvestPending || !!selectingBatchPlots || recordsOpen || (pane === 'apiary' && !!apiaryHand?.pending)}
    onchoose={choose}
    card={pane === 'plant' || (pane === 'preview' && previewReturnPane === 'plant') ? seedCard : undefined}
  />
{/snippet}

{#snippet seedCard(choice: WorkflowChoice, _index: number)}
  {@const seed = seeds.find((item) => choice.id === `seed:${item.itemKey}`)}
  {#if seed}
    <ShopGoodCard
      item={seed}
      eyebrow="Seeds"
      detail="Plant one seed"
      meta={seed.quantity > 0 ? `${seed.quantity} in inventory` : 'No seeds left'}
      icon="✿"
      artUrl={shopItemAssetPublicUrl(seed.itemKey, PUBLIC_SUPABASE_URL)}
      category="seeds"
      gardenSeedKey={seed.itemKey}
      unavailable={seed.quantity <= 0}
    />
  {/if}
{/snippet}

<CardWorkflowFrame
  sceneAspect={1672 / 941}
  title={recordsOpen ? 'Garden ledger' : 'Garden'}
  eyebrow="The tavern courtyard"
  location={selected ? `Plot ${selected.layoutKey}` : 'Choose a plot on the scene'}
  backLabel={recordsOpen ? 'Back to garden' : section !== 'root' || pane ? 'Back' : 'Back to garden'}
  onback={(selected || recordsOpen) && !gardenMutationLocked && !apiaryHand?.locked ? handleBack : undefined}
  focusKey={frameFocusKey}
  inspectionMode={(pane === 'preview') || (pane === 'apiary' && apiaryHand?.previewOpen) ? 'center' : 'folio'}
  scene={sceneContent}
  status={statusContent}
  controls={controlsContent}
  folio={hasFolio ? folioContent : undefined}
  hand={hasHand ? handContent : undefined}
/>
<form bind:this={autoPreviewForm} method="POST" action="?/preview" use:enhance={previewAction} class="hidden-submit-form"></form>

<style>
  .garden-status { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem .8rem; color: #e2ca8f; font-family: 'Cinzel',serif; font-size: .67rem; }
  .garden-status span { white-space: nowrap; }
  .garden-status strong { flex-basis: 100%; color: #f2d78d; font-size: .7rem; }
  .garden-header-actions { display: flex; flex-wrap: wrap; justify-content: end; gap: .45rem; }
  .garden-header-actions button, .text-button { min-height: 38px; padding: .4rem .6rem; border: 1px solid #84612c; color: #e5cd8f; background: #181107df; font: inherit; font-size: .68rem; cursor: pointer; }
  .garden-header-actions button:hover, .garden-header-actions button:focus-visible, .text-button:hover, .text-button:focus-visible { background: #5b3f16; outline: 1px solid #ffe9a8; outline-offset: 1px; }
  .plot-folio, .action-fields { display: grid; gap: .8rem; }
  .action-fields { padding-top: .85rem; border-top: 1px solid #65502c; }
  .action-fields h2 { margin: 0; color: #efd58e; font-size: 1.05rem; }
  .action-fields label { display: grid; gap: .45rem; }
  .action-fields label { color: #c9ad70; font-size: .75rem; }
  .action-fields input:not([type='checkbox']) { min-height: 38px; padding: .4rem .5rem; border: 1px solid #765324; color: #f0dca8; background: #100a05; }
  .action-fields button { min-height: 42px; padding: .45rem .65rem; border: 1px solid #9d7835; color: #f0dca8; background: #28190a; font: inherit; font-size: .74rem; cursor: pointer; }
  .action-fields button:hover:not(:disabled), .action-fields button:focus-visible { background: #5b3f16; outline: 1px solid #ffe9a8; }
  .action-fields button:disabled { cursor: not-allowed; opacity: .55; }
  .action-fields output { float: right; color: #f4dc96; }
  .action-fields input[type='range'] { width: 100%; accent-color: #c6963d; }
  .action-fields .check { display: flex; align-items: center; }
  .help { margin: .15rem 0 .4rem; color: #b29c72; font-family: Georgia,serif; font-size: .78rem; line-height: 1.45; }
  .seed-guidance { display: grid; gap: .3rem; margin-top: .2rem; padding-top: .65rem; border-top: 1px solid #4f3a1c; }
  .seed-guidance .eyebrow { margin: 0; }
  .seed-guidance ul { display: grid; gap: .25rem; margin: 0; padding-left: 1rem; color: #c4b084; font-family: Georgia,serif; font-size: .76rem; line-height: 1.4; }
  .batch-toolbar { display: grid; gap: .55rem; padding: .65rem; border: 1px solid #80612d; background: #171006; color: #e5cb86; font-family: 'Cinzel',serif; font-size: .72rem; }
  .batch-toolbar > div { display: flex; gap: .45rem; }
  .batch-toolbar button { flex: 1; }
  .secondary-button { min-height: 38px; padding: .35rem .6rem; border: 1px solid #70552c; color: #d8bc78; background: #1a1309; font-family: 'Cinzel',serif; font-size: .67rem; }
  .text-button { border-color: #5c4727; background: transparent; }
  .retry-note { margin: 0; color: #c6aa6c; font-size: .68rem; line-height: 1.4; }
  .form-message, .feedback { margin: 0; padding: .65rem; border: 1px solid #637446; color: #e1e8c1; background: #11180c; font-size: .76rem; line-height: 1.45; }
  .form-message span { display: block; margin-top: .3rem; }
  .form-message.error, .feedback.error { border-color: #9d4d3b; color: #ffd0ba; background: #24100d; }
  .feedback { border-color: #80612d; color: #e5cb86; background: #171006; }
  .preview-options { display: grid; gap: .35rem; }
  .preview-detail, .preview-warning { margin: 0; padding: .4rem .5rem; border-left: 2px solid #7f642e; color: #d6c493; font-family: Georgia,serif; font-size: .74rem; line-height: 1.4; }
  .preview-warning { border-color: #b17832; color: #f0cb84; }
  .error { color: #ffd0ba; }
  .hidden-submit-form { display: none; }
</style>
