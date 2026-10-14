<script module lang="ts">
  import type { WorkflowChoice } from '$lib/components/ui/workflow';

  export type ApiaryWorkflowHand = {
    items: WorkflowChoice[];
    selectedId: string | null;
    focusId?: string | null;
    choose: (id: string) => void;
    pending: boolean;
    locked?: boolean;
    backAvailable?: boolean;
    previewOpen: boolean;
  };
</script>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { onDestroy, tick, untrack } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { resolveBurnAction, waitForBurn, type BurnStyle, type ResolvedBurnAction } from '$lib/card-effects';
  import type {
    ApiaryCommandKind,
    ApiaryCommandPayload,
    ApiaryCommandPreview,
    ApiaryCommandReceipt,
    GameSnapshot,
    GardenCell,
    GardenCommandKind,
    GardenCommandPayload,
    GardenCommandPreview,
    GardenCommandReceipt,
    GardenInventoryItem
  } from '$lib/game/contracts';
  import { apiarySuccessFeedback, gardenSuccessFeedback } from '$lib/game/garden-feedback';
  import { claimAcquisitionReceipt, honeyAcquisitionCard, type AcquisitionCard } from '$lib/game/acquisition';
  import WorkflowInspection from '$lib/components/ui/WorkflowInspection.svelte';

  let {
    snapshot,
    selected,
    includeShop = false,
    burnStyle = 'drip',
    externalHand = false,
    onworkflowhandchange,
    onacquired,
    splitTargetId = null,
    onstartsplit,
    oncancelsplit
  }: {
    snapshot: GameSnapshot;
    selected: GardenCell | null;
    includeShop?: boolean;
    burnStyle?: BurnStyle;
    externalHand?: boolean;
    onworkflowhandchange?: (hand: ApiaryWorkflowHand | null) => void;
    onacquired?: (card: AcquisitionCard) => void;
    splitTargetId?: string | null;
    onstartsplit?: () => void | Promise<void>;
    oncancelsplit?: () => void | Promise<void>;
  } = $props();
  const seenAcquisitionEvents = new Set<string>();

  type Scope = 'garden' | 'apiary';
  type Kind = GardenCommandKind | ApiaryCommandKind;
  type Payload = GardenCommandPayload | ApiaryCommandPayload;
  type Preview = GardenCommandPreview | ApiaryCommandPreview;
  type ColonyAction = ApiaryCommandKind;
  type PreviewResultHandler = Extract<Awaited<ReturnType<SubmitFunction>>, (...args: any[]) => any>;
  type PreviewResultArgs = Parameters<PreviewResultHandler>[0];
  type AutomaticPreviewRequest = {
    scope: Scope;
    kind: Kind;
    payload: Payload;
    contextSignature: string;
    token: number;
  };

  let shopItemKey = $state('');
  let shopQuantity = $state(1);
  let feedQuantity = $state(1);
  let honeyQuantity = $state(1);
  let treatmentItemKey = $state('');
  let splitTargetHiveId = $state('');
  let selectedApiaryAction = $state<ColonyAction | null>(null);
  let lastApiaryAction = $state<ColonyAction | null>(null);
  let selectedTreatmentKey = $state<string | null>(null);
  let lastMedicineFocusId = '';
  let preview = $state<Preview | null>(null);
  let previewPayload = $state<Payload | null>(null);
  let previewScope = $state<Scope>('garden');
  let previewSignature = $state('');
  let previewContextSignature = $state('');
  let previewRevision = $state<number | null>(null);
  let previewSequence = $state(0);
  let previewSequenceForResult = $state(0);
  let pendingAction = $state<{ signature: string; actionId: string; revision: number; burnAction: ResolvedBurnAction } | null>(null);
  let pending = $state(false);
  let message = $state<string | null>(null);
  let messageError = $state(false);
  let burnAction = $state(untrack(() => resolveBurnAction(burnStyle)));
  let burning = $state(false);
  let burnController: AbortController | null = null;
  let commitForm = $state<HTMLFormElement>();
  let automaticPreviewForm = $state<HTMLFormElement>();
  let automaticPreviewRequest = $state<AutomaticPreviewRequest | null>(null);
  let automaticPreviewToken = 0;
  let lastAutomaticPreviewKey = '';
  let previousSubjectKey: string | null = null;
  let previousContextSignature = '';

  let garden = $derived(snapshot.garden);
  let inventory = $derived(garden?.inventory ?? []);
  let shop = $derived(garden?.shop ?? []);
  let nextExpansion = $derived(garden?.expansions.find((expansion) => expansion.available) ?? null);
  let colony = $derived(selected?.hive?.colony ?? null);
  let emptyHives = $derived(snapshot.cells.filter((cell) => cell.unlocked !== false && cell.kind === 'beehive' && cell.hive && !cell.hive.hasColony));
  let treatments = $derived(inventory.filter((item) => item.kind === 'treatment' && item.quantity > 0));
  let hasCurrentPreview = $derived.by(() => {
    if (!preview || !previewPayload) return false;
    if (previewSignature !== makeSignature(previewScope, preview.commandKind, previewPayload)) return false;
    if (previewSequenceForResult !== previewSequence) return false;
    if (pendingAction?.signature === previewSignature) return true;
    return previewRevision === snapshot.save.revision
      && previewContextSignature === makePreviewContextSignature(previewScope, preview.commandKind, previewPayload);
  });

  function apiaryWorkflowItems(): WorkflowChoice[] {
    if (!colony) {
      if (selected?.kind === 'empty') {
        const equipmentAvailable = inventoryQuantity('equipment') > 0;
        return [{
          id: 'apiary:install_hive',
          title: 'Install hive',
          description: equipmentAvailable
            ? 'Install hive equipment on ' + selected.layoutKey + '. The preview shows the fixed cost.'
            : 'No empty hive equipment is in inventory. Open the preview to see what is required.',
          eyebrow: 'Apiary',
          icon: '🐝',
          actionLabel: 'Review installation',
          burn: true
        }];
      }
      if (selected?.kind === 'beehive' && selected.hive && !selected.hive.hasColony) {
        const colonyAvailable = inventoryQuantity('colony') > 0;
        return [{
          id: 'apiary:install_colony',
          title: 'Populate hive',
          description: colonyAvailable
            ? 'Place a replacement colony in ' + selected.layoutKey + '. The preview shows the fixed cost.'
            : 'No replacement colony is in inventory. Open the preview to see what is required.',
          eyebrow: 'Apiary',
          icon: '🐝',
          actionLabel: 'Review colony installation',
          burn: true
        }];
      }
      return [];
    }

    const treatmentActive = colony.treatmentDaysRemaining > 0;
    if (selectedApiaryAction === 'treat' && treatments.length > 1 && !treatmentActive) {
      return treatments.map((item) => ({
        id: 'apiary:medicine:' + item.itemKey,
        title: item.name,
        description: treatmentDescription(item),
        eyebrow: 'Treatment choice',
        icon: '🧪',
        meta: item.quantity + (item.quantity === 1 ? ' dose available' : ' doses available'),
        actionLabel: 'Use one dose',
        burn: true
      }));
    }

    const splitShortages = colonySplitShortages();
    const splitDescription = splitShortages.length
      ? 'This colony needs ' + splitShortages.join(', ') + ' before it can split.'
      : 'Choose an unlocked empty hive on the scene. The preview lists what transfers to the new colony.';

    return [
      {
        id: 'apiary:feed',
        title: 'Feed colony',
        description: inventoryQuantity('feed') > 0
          ? 'Use one dose of ' + feedItemName() + ' on the colony in ' + (selected?.layoutKey ?? 'this hive') + '.'
          : 'No bee feed is in inventory.',
        eyebrow: 'Manage colony',
        icon: '🌾',
        meta: 'One dose · +18 feed stores',
        actionLabel: 'Review feeding',
        disabled: inventoryQuantity('feed') <= 0,
        burn: true
      },
      {
        id: 'apiary:extract_honey',
        title: 'Extract honey',
        description: treatmentActive
          ? 'Honey extraction is unavailable while treatment is active.'
          : colony.extractableSurplus > 0
            ? 'Extract all honey above the honey reserve from ' + (selected?.layoutKey ?? 'this hive') + '.'
            : 'No safe honey surplus is available.',
        eyebrow: 'Manage colony',
        icon: '🍯',
        meta: treatmentActive ? 'Unavailable during treatment' : 'All safe surplus',
        actionLabel: 'Review extraction',
        disabled: treatmentActive || colony.extractableSurplus <= 0,
        burn: true
      },
      {
        id: 'apiary:treat',
        title: 'Treat colony',
        description: treatmentActive
          ? 'Treatment is active for ' + colony.treatmentDaysRemaining + ' more days. Honey extraction is unavailable during treatment.'
          : treatments.length
            ? 'Choose a medicine for the colony. Treatment lasts three days and prevents honey extraction.'
            : 'No treatment medicine is in inventory.',
        eyebrow: 'Manage colony',
        icon: '🧪',
        meta: treatmentActive ? 'Treatment active' : treatments.length ? 'Medicine available' : 'No medicine available',
        actionLabel: treatmentActive ? 'View treatment status' : 'Choose treatment',
        burn: true
      },
      {
        id: 'apiary:split',
        title: 'Split colony',
        description: splitDescription,
        eyebrow: 'Manage colony',
        icon: '🐝',
        meta: emptyHives.length ? 'Choose an empty unlocked hive' : 'No empty unlocked hive available',
        actionLabel: 'Choose destination',
        burn: true
      }
    ];
  }

  function chooseApiaryAction(id: string) {
    if (pending && (id !== 'apiary:back' || pendingAction)) return;
    if (pendingAction) {
      message = 'Retry the same action to resolve its outcome before changing the apiary selection.';
      messageError = true;
      return;
    }

    if (id === 'apiary:back') {
      if (pending) clearPreviewState();
      if (hasCurrentPreview) {
        cancelPreview();
        return;
      }
      if (selectedApiaryAction === 'treat' && treatments.length > 1) {
        if (selectedTreatmentKey) {
          selectedTreatmentKey = null;
          return;
        }
        selectedApiaryAction = null;
        selectedTreatmentKey = null;
        return;
      }
      if (selectedApiaryAction === 'split') cancelSplitSelection();
      selectedApiaryAction = null;
      selectedTreatmentKey = null;
      return;
    }

    if (id.startsWith('apiary:medicine:')) {
      const medicineKey = id.slice('apiary:medicine:'.length);
      const medicine = treatments.find((item) => item.itemKey === medicineKey);
      if (!medicine || !colony || colony.treatmentDaysRemaining > 0) return;
      lastApiaryAction = 'treat';
      lastMedicineFocusId = id;
      selectedApiaryAction = 'treat';
      selectedTreatmentKey = medicineKey;
      message = null;
      messageError = false;
      queueAutomaticPreview();
      return;
    }

    const item = apiaryWorkflowItems().find((choice) => choice.id === id);
    if (!item || item.disabled) return;
    const action = id.slice('apiary:'.length) as ColonyAction;
    if (!['install_hive', 'install_colony', 'feed', 'extract_honey', 'treat', 'split'].includes(action)) return;

    if (action === selectedApiaryAction && action !== 'treat') {
      lastAutomaticPreviewKey = '';
    } else {
      clearPreviewState(false);
    }

    selectedApiaryAction = action;
    selectedTreatmentKey = action === 'treat' && treatments.length === 1 ? treatments[0]!.itemKey : null;
    lastApiaryAction = action;
    if (action !== 'treat') lastMedicineFocusId = '';

    message = null;
    messageError = false;

    if (action === 'split') startSplitSelection();
    queueAutomaticPreview();
  }

  function splitTargetCell() {
    if (!splitTargetId) return null;
    return emptyHives.find((cell) => cell.id === splitTargetId) ?? null;
  }

  function colonySplitShortages() {
    if (!colony) return [];
    const shortages: string[] = [];
    if (colony.adults < 10000) shortages.push('10,000 adult bees');
    if (colony.brood < 2000) shortages.push('2,000 brood');
    if (colony.foodStores < 30) shortages.push('30 food stores');
    if (colony.health < 60) shortages.push('60 health');
    return shortages;
  }

  function treatmentDescription(item: GardenInventoryItem) {
    const effect = item.effect as Record<string, unknown>;
    const effectCondition = effect.problem ?? effect.condition ?? effect.conditionName ?? effect.treats ?? effect.targetCondition;
    const condition = conditionText(effectCondition)
      ?? item.guidance?.[0]
      ?? colony?.symptoms?.map((symptom) => symptom.label).join(', ')
      ?? 'current colony pressure';
    return 'Use one dose of ' + item.name + ' to treat ' + condition
      + '. Treatment lasts three days and honey cannot be extracted while it is active.';
  }

  function conditionText(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.replaceAll('_', ' ');
    if (Array.isArray(value)) {
      const labels = value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim());
      if (labels.length) return labels.map((entry) => entry.replaceAll('_', ' ')).join(', ');
    }
    return null;
  }

  function buildAutomaticPreviewIntent(): { scope: Scope; kind: Kind; payload: Payload } | null {
    if (!externalHand || pendingAction || !selectedApiaryAction) return null;

    if (selectedApiaryAction === 'install_hive' && selected?.kind === 'empty') {
      return { scope: 'apiary', kind: 'install_hive', payload: { cellId: selected.id } };
    }
    if (selectedApiaryAction === 'install_colony' && selected?.kind === 'beehive' && selected.hive?.id && !selected.hive.hasColony) {
      return { scope: 'apiary', kind: 'install_colony', payload: { hiveId: selected.hive.id } };
    }
    if (!colony) return null;

    if (selectedApiaryAction === 'feed') {
      return { scope: 'apiary', kind: 'feed', payload: { colonyId: colony.id, quantity: 1 } };
    }
    if (selectedApiaryAction === 'extract_honey' && colony.treatmentDaysRemaining <= 0 && colony.extractableSurplus > 0) {
      return { scope: 'apiary', kind: 'extract_honey', payload: { colonyId: colony.id, quantity: colony.extractableSurplus } };
    }
    if (selectedApiaryAction === 'treat' && colony.treatmentDaysRemaining <= 0 && treatments.length > 0) {
      const medicine = selectedTreatmentKey
        ? treatments.find((item) => item.itemKey === selectedTreatmentKey)
        : treatments.length === 1 ? treatments[0] : null;
      if (medicine) return { scope: 'apiary', kind: 'treat', payload: { colonyId: colony.id, treatmentItemKey: medicine.itemKey } };
    }
    if (selectedApiaryAction === 'split') {
      const target = splitTargetCell();
      if (target?.hive?.id) return { scope: 'apiary', kind: 'split', payload: { sourceColonyId: colony.id, targetHiveId: target.hive.id } };
    }
    return null;
  }

  function ambientContextSignature() {
    return JSON.stringify({
      revision: snapshot.save.revision,
      selectedCellId: selected?.id ?? null,
      selectedHiveId: selected?.hive?.id ?? null,
      colonyId: colony?.id ?? null,
      splitTargetId,
      selectedApiaryAction,
      selectedTreatmentKey,
      treatmentOptions: treatments.map((item) => [item.itemKey, item.quantity, item.name, item.effect]),
      inventory: inventory.map((item) => [item.itemKey, item.quantity, item.price]).sort(([left], [right]) => String(left).localeCompare(String(right))),
      shopItemKey,
      shopQuantity,
      feedQuantity,
      honeyQuantity,
      treatmentItemKey,
      splitTargetHiveId
    });
  }

  function makeSignature(scope: Scope, kind: Kind, payload: Payload | null) {
    return scope + ':' + kind + ':' + JSON.stringify(payload);
  }

  function makePreviewContextSignature(scope: Scope, kind: Kind, payload: Payload | null) {
    return makeSignature(scope, kind, payload) + '|' + ambientContextSignature();
  }

  function clearPreviewState(clearMessage = true) {
    previewSequence += 1;
    previewSequenceForResult = 0;
    automaticPreviewToken += 1;
    automaticPreviewRequest = null;
    lastAutomaticPreviewKey = '';
    if (!pendingAction) pending = false;
    preview = null;
    previewPayload = null;
    previewSignature = '';
    previewContextSignature = '';
    previewRevision = null;
    if (clearMessage) {
      message = null;
      messageError = false;
    }
  }

  function queueAutomaticPreview() {
    const intent = buildAutomaticPreviewIntent();
    if (!intent || pending || pendingAction) return;
    const contextSignature = makePreviewContextSignature(intent.scope, intent.kind, intent.payload);
    if (contextSignature === lastAutomaticPreviewKey) return;
    if (preview && previewSignature === makeSignature(intent.scope, intent.kind, intent.payload)
      && previewContextSignature === contextSignature) return;
    lastAutomaticPreviewKey = contextSignature;
    const token = ++automaticPreviewToken;
    automaticPreviewRequest = { ...intent, contextSignature, token };
    void tick().then(() => {
      if (token !== automaticPreviewToken || automaticPreviewRequest?.token !== token) return;
      if (pending || pendingAction || contextSignature !== makePreviewContextSignature(intent.scope, intent.kind, intent.payload)) return;
      automaticPreviewForm?.requestSubmit();
    });
  }

  $effect(() => {
    const subjectKey = (selected?.id ?? '') + '|' + (colony?.id ?? '');
    const mutationLocked = !!pendingAction;
    if (subjectKey !== previousSubjectKey) {
      if (previousSubjectKey !== null && !mutationLocked) {
        untrack(() => {
          selectedApiaryAction = null;
          selectedTreatmentKey = null;
          lastApiaryAction = null;
          lastMedicineFocusId = '';
          clearPreviewState();
        });
      }
      previousSubjectKey = subjectKey;
    }

    const contextSignature = ambientContextSignature();
    if (contextSignature !== previousContextSignature) {
      if (previousContextSignature && !mutationLocked) untrack(() => clearPreviewState(false));
      previousContextSignature = contextSignature;
    }

    const intent = buildAutomaticPreviewIntent();
    if (intent) untrack(() => queueAutomaticPreview());
  });

  $effect(() => {
    const hand: ApiaryWorkflowHand | null = externalHand ? {
      items: apiaryWorkflowItems(),
      selectedId: selectedApiaryAction === 'treat' && treatments.length > 1
        ? selectedTreatmentKey ? 'apiary:medicine:' + selectedTreatmentKey : null
        : selectedApiaryAction ? 'apiary:' + selectedApiaryAction : null,
      focusId: selectedApiaryAction === 'treat' && treatments.length > 1
        ? lastMedicineFocusId || 'apiary:treat'
        : lastApiaryAction ? 'apiary:' + lastApiaryAction : null,
      choose: chooseApiaryAction,
      pending,
      locked: !!pendingAction,
      backAvailable: !!selectedApiaryAction || hasCurrentPreview,
      previewOpen: hasCurrentPreview
    } : null;
    untrack(() => onworkflowhandchange?.(hand));
  });

  $effect(() => {
    burnStyle;
    untrack(() => { burnAction = resolveBurnAction(burnStyle); });
  });

  onDestroy(() => {
    burnController?.abort();
    automaticPreviewToken += 1;
    untrack(() => onworkflowhandchange?.(null));
  });

  function actionLabel(kind: Kind) {
    return ({
      plant: 'plant seed',
      move: 'move or swap',
      remove: 'remove plant',
      water: 'water plots',
      amend: 'amend soil',
      incorporate_clover: 'incorporate clover',
      compost_ingredient: 'start compost',
      purchase: 'purchase supplies',
      expand: 'expand garden',
      install_hive: 'install hive',
      install_colony: 'populate hive',
      feed: 'feed colony',
      treat: 'treat colony',
      split: 'split colony',
      extract_honey: 'extract honey'
    } satisfies Record<Kind, string>)[kind];
  }

  function inventoryQuantity(kind: 'equipment' | 'colony' | 'feed') {
    return inventory.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.quantity, 0);
  }

  function feedItemName() {
    return inventory.find((item) => item.kind === 'feed')?.name ?? 'bee feed';
  }

  function previewDescription(kind: Kind, payload: Payload | null = previewPayload) {
    const plot = selected?.layoutKey ?? 'the selected hive';
    if (kind === 'feed') return 'Use one dose of ' + feedItemName() + ' on the colony in ' + plot + '. The preview shows the store increase and inventory cost.';
    if (kind === 'extract_honey') {
      const quantity = payload && 'quantity' in payload ? payload.quantity : colony?.extractableSurplus ?? 0;
      return 'Extract ' + quantity + (quantity === 1 ? ' honey unit' : ' honey units')
        + ' from ' + plot + ', while leaving the honey reserve intact.';
    }
    if (kind === 'treat') {
      const medicineKey = payload && 'treatmentItemKey' in payload ? payload.treatmentItemKey : treatmentItemKey;
      const medicine = treatments.find((item) => item.itemKey === medicineKey);
      return medicine ? treatmentDescription(medicine) : 'Choose a treatment for the colony.';
    }
    if (kind === 'split') {
      const target = splitTargetCell();
      const destination = target?.layoutKey ?? 'the selected empty hive';
      return 'Split the colony in ' + plot + ' into ' + destination
        + '. The preview lists the adults, brood, and food stores transferred.';
    }
    if (kind === 'install_hive') return 'Install hive equipment on ' + plot + '. The preview shows the fixed cost and equipment used.';
    if (kind === 'install_colony') return 'Populate the hive in ' + plot + '. The preview shows the fixed cost and colony used.';
    return 'Review supplies, costs, and effects before applying the action.';
  }

  function beginPreviewSubmission(
    scope: Scope,
    kind: Kind,
    nextPayload: Payload,
    contextSignature: string,
    formData: FormData
  ) {
    if (pending || pendingAction) return null;
    const requestedRevision = snapshot.save.revision;
    const sequence = previewSequence + 1;
    previewSequence = sequence;
    previewSequenceForResult = 0;
    formData.set('commandKind', kind);
    formData.set('payload', JSON.stringify(nextPayload));
    pending = true;
    message = null;
    messageError = false;

    return async ({ result }: PreviewResultArgs) => {
      if (sequence !== previewSequence) {
        if (requestedRevision !== snapshot.save.revision && !pending && !automaticPreviewRequest) {
          message = 'The garden changed while the preview was loading. Select the action again to review the latest state.';
          messageError = true;
        }
        return;
      }
      if (!pendingAction && contextSignature !== makePreviewContextSignature(scope, kind, nextPayload)) {
        pending = false;
        clearPreviewState(false);
        message = 'The garden changed while the preview was loading. Select the action again to review the latest state.';
        messageError = true;
        return;
      }

      pending = false;
      const data = 'data' in result ? result.data as { preview?: Preview; message?: string } | undefined : undefined;
      if (result.type === 'success' && data?.preview) {
        if (data.preview.basedOnRevision !== requestedRevision || data.preview.basedOnRevision !== snapshot.save.revision) {
          clearPreviewState(false);
          message = 'The garden changed while the preview was loading. Select the action again to review the latest state.';
          messageError = true;
          return;
        }
        preview = data.preview;
        previewScope = scope;
        previewPayload = nextPayload;
        previewSignature = makeSignature(scope, kind, nextPayload);
        previewContextSignature = contextSignature;
        previewRevision = data.preview.basedOnRevision;
        previewSequenceForResult = sequence;
        messageError = false;
      } else {
        message = data?.message ?? 'The authoritative preview is unavailable.';
        messageError = true;
      }
    };
  }

  function previewEnhancer(scope: Scope, kind: Kind, payload: () => Payload | null): SubmitFunction {
    return ({ formData, cancel }) => {
      if (pending || pendingAction) {
        cancel();
        return;
      }
      const nextPayload = payload();
      if (!nextPayload) {
        cancel();
        message = 'Choose every value needed for this action.';
        messageError = true;
        return;
      }
      return beginPreviewSubmission(scope, kind, nextPayload, makePreviewContextSignature(scope, kind, nextPayload), formData) ?? (() => {});
    };
  }

  const automaticPreviewEnhancer: SubmitFunction = ({ formData, cancel }) => {
    const request = automaticPreviewRequest;
    if (!request || request.token !== automaticPreviewToken) {
      cancel();
      return;
    }
    const submission = beginPreviewSubmission(request.scope, request.kind, request.payload, request.contextSignature, formData);
    if (!submission) cancel();
    return submission ?? undefined;
  };

  const commitPreview: SubmitFunction = ({ formData, cancel }) => {
    if (!preview || !previewPayload || !hasCurrentPreview || pending) {
      cancel();
      message = 'Preview this action again before committing it.';
      messageError = true;
      return;
    }

    const command = preview;
    const commandScope = previewScope;
    const payload = previewPayload;
    const signature = makeSignature(commandScope, command.commandKind, payload);
    if (!pendingAction || pendingAction.signature !== signature) {
      pendingAction = {
        signature,
        actionId: crypto.randomUUID(),
        revision: previewRevision ?? snapshot.save.revision,
        burnAction
      };
    }

    const action = pendingAction;
    formData.set('saveId', snapshot.save.id);
    formData.set('actionId', action.actionId);
    formData.set('expectedRevision', String(action.revision));
    formData.set('commandKind', command.commandKind);
    formData.set('payload', JSON.stringify(payload));
    pending = true;
    message = null;

    return async ({ result, update }) => {
      pending = false;
      const data = 'data' in result ? result.data as {
        message?: string;
        conflict?: boolean;
        pendingAction?: object;
        receipt?: GardenCommandReceipt | ApiaryCommandReceipt;
      } | undefined : undefined;
      let acquired: AcquisitionCard | null = null;

      if (result.type === 'error' || data?.pendingAction) {
        message = data?.message ?? 'The outcome is unknown. Retry to recover the same action.';
        messageError = true;
        return;
      }

      if (result.type === 'success') {
        if (commandScope === 'apiary' && command.commandKind === 'extract_honey' && data?.receipt) {
          const receipt = data.receipt as ApiaryCommandReceipt;
          const card = honeyAcquisitionCard(`honey:${action.actionId}`, receipt);
          const eventId = card && claimAcquisitionReceipt('honey', receipt.commandKind, action.actionId, receipt.actionId, seenAcquisitionEvents);
          if (eventId) acquired = card;
        }
        const cellLabel = (id: string) => snapshot.cells.find((cell) => cell.id === id)?.layoutKey;
        message = data?.receipt
          ? commandScope === 'garden'
            ? gardenSuccessFeedback(data.receipt.commandKind as GardenCommandKind, data.receipt, { cellLabel })
            : apiarySuccessFeedback(data.receipt.commandKind as ApiaryCommandKind, data.receipt, { cellLabel })
          : data?.message ?? 'Action complete';
        messageError = false;
        await animateAcceptedCommand(action.burnAction);
        if (commandScope === 'apiary' && command.commandKind === 'split') cancelSplitSelection();
        if (commandScope === 'apiary') {
          selectedApiaryAction = null;
          selectedTreatmentKey = null;
        }
        pendingAction = null;
        clearPreviewState(false);
      } else if (data?.conflict) {
        message = data.message ?? 'The garden changed before this action was accepted. Review the latest state and preview again.';
        messageError = true;
        pendingAction = null;
        clearPreviewState(false);
      } else {
        message = data?.message ?? 'The action was rejected.';
        messageError = true;
        pendingAction = null;
      }

      try { await update({ reset: false, invalidateAll: result.type === 'success' || !!data?.conflict }); }
      finally { if (acquired) onacquired?.(acquired); }
    };
  };

  function confirmPreview() {
    if (!pending && hasCurrentPreview && preview?.canCommit !== false) commitForm?.requestSubmit();
  }

  function cancelPreview() {
    if (pendingAction) {
      message = 'Retry this same action to resolve its outcome.';
      messageError = true;
      return;
    }
    if (pending) return;

    const returningToMedicineChoices = previewScope === 'apiary'
      && preview?.commandKind === 'treat'
      && treatments.length > 1;
    const cancelSplit = previewScope === 'apiary' && preview?.commandKind === 'split';
    clearPreviewState();
    if (externalHand) {
      if (returningToMedicineChoices) {
        selectedApiaryAction = 'treat';
        selectedTreatmentKey = null;
      } else if (cancelSplit) {
        selectedApiaryAction = 'split';
        selectedTreatmentKey = null;
      } else {
        selectedApiaryAction = null;
        selectedTreatmentKey = null;
      }
      if (cancelSplit) startSplitSelection();
    }
  }

  function cancelSplitSelection() {
    try {
      void Promise.resolve(oncancelsplit?.()).catch(() => {
        message = 'Could not close split destination selection.';
        messageError = true;
      });
    } catch {
      message = 'Could not close split destination selection.';
      messageError = true;
    }
  }

  function startSplitSelection() {
    try {
      void Promise.resolve(onstartsplit?.()).catch(() => {
        message = 'Could not open split destination selection.';
        messageError = true;
      });
    } catch {
      message = 'Could not open split destination selection.';
      messageError = true;
    }
  }

  async function animateAcceptedCommand(action: ResolvedBurnAction) {
    burnController?.abort();
    const controller = new AbortController();
    burnController = controller;
    burning = true;
    try {
      await waitForBurn(action.durationMs, controller.signal);
    } catch {
      // A newer action or component teardown can stop the animation.
    } finally {
      if (burnController === controller) {
        burnController = null;
        burning = false;
      }
    }
  }

  function fieldValue(key: string, item: unknown) {
    if (typeof item === 'string' && (key === 'itemKey' || key === 'treatmentItemKey')) {
      const entry = inventory.find((candidate) => candidate.itemKey === item) ?? shop.find((candidate) => candidate.itemKey === item);
      if (entry) return entry.name;
    }
    if (typeof item === 'string' && key === 'targetHiveId') {
      return snapshot.cells.find((cell) => cell.hive?.id === item)?.layoutKey ?? item;
    }
    if (typeof item === 'string' && key === 'sourceColonyId' && item === colony?.id) {
      return selected?.layoutKey ?? item;
    }
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return JSON.stringify(item);
  }

  function previewEntryLabel(key: string) {
    const labels: Record<string, string> = {
      protectedReserve: 'Food reserve',
      foodReserve: 'Food reserve',
      protectedHoneyReserve: 'Honey reserve',
      foodStoresBefore: 'Food stores before',
      foodStoresAfter: 'Food stores after',
      feedStoresBefore: 'Feed stores before',
      feedStoresAfter: 'Feed stores after',
      extractableSurplus: 'Safe honey available',
      transferredAdults: 'Adults transferred',
      transferredBrood: 'Brood transferred',
      transferredFoodStores: 'Food stores transferred',
      transferredFloralHoney: 'Honey transferred',
      transferredFeedStores: 'Feed stores transferred',
      treatmentItemKey: 'Medicine',
      targetHiveId: 'Destination',
      sourceColonyId: 'Source'
    };
    return labels[key] ?? key.replaceAll(/([A-Z])/g, ' $1');
  }

  function visiblePreviewEntries(value: Preview): Array<[string, unknown]> {
    const isFeed = value.commandKind === 'feed';
    const isExtraction = value.commandKind === 'extract_honey';
    // The action description already states the extracted amount and treatment tradeoff.
    const redundantExtractionFields = ['protectedReserve', 'foodReserve', 'floralHoney', 'extractableSurplus', 'treatmentRestricted'];
    const entries = Object.entries(value).filter(([key]) =>
      !['commandKind', 'basedOnRevision', 'rulesVersion', 'normalizedPayload', 'canCommit', 'warning', 'warnings', 'requirements', 'transferred'].includes(key)
      && (isFeed || !['foodStoresBefore', 'foodStoresAfter'].includes(key))
      && (!isExtraction || !redundantExtractionFields.includes(key))
      && (!isFeed || key !== 'floralHoneyAfter')
    );
    if (value.commandKind === 'split') {
      const transfer = value.transferred;
      if (transfer && typeof transfer === 'object' && !Array.isArray(transfer)) {
        for (const [key, transferredQuantity] of Object.entries(transfer)) {
          if (typeof transferredQuantity === 'number') {
            const capitalizedKey = key.replace(/^./, (letter) => letter.toUpperCase());
            entries.push(['transferred' + capitalizedKey, transferredQuantity]);
          }
        }
      }
    }
    return entries;
  }

  function previewWarnings(value: Preview): string[] {
    const warningValues = [value.warning, value.warnings];
    return [...new Set(warningValues.flatMap((entry) => {
      if (typeof entry === 'string' && entry.trim()) return [entry];
      if (Array.isArray(entry)) return entry.filter((warning): warning is string => typeof warning === 'string' && !!warning.trim());
      return [];
    }))];
  }
</script>

<section class="provision-panel" class:external-panel={externalHand} aria-labelledby={externalHand ? undefined : 'provision-heading'} aria-label={externalHand ? `Colony care for ${selected?.layoutKey ?? 'this plot'}` : undefined}>
  {#if !(externalHand && hasCurrentPreview)}
    {#if !externalHand}
      <div><p class="eyebrow">Apiary actions</p><h2 id="provision-heading">Care for this plot</h2></div>

      {#if includeShop}<details class="provision-group">
        <summary>Purchase supplies · {snapshot.save.gold ?? 0} gold</summary>
        <form method="POST" action="?/preview" use:enhance={previewEnhancer('garden', 'purchase', () => (shopItemKey || shop[0]?.itemKey) ? { itemKey: shopItemKey || shop[0]!.itemKey, quantity: shopQuantity } : null)}>
          <label>Item
            <select bind:value={shopItemKey} disabled={!shop.length}>
              {#each shop as item}<option value={item.itemKey}>{item.name} · {item.price} gold</option>{/each}
            </select>
          </label>
          <label>Quantity <input type="number" min="1" max="20" bind:value={shopQuantity} /></label>
          <button type="submit" class="secondary-button" data-garden-command="purchase" disabled={pending || !shop.length}>Preview purchase</button>
        </form>
      </details>{/if}

      {#if includeShop && nextExpansion}
        <details class="provision-group">
          <summary>Land expansion</summary>
          <p class="help">Unlock {nextExpansion.plotCount - (garden?.plotCount ?? 12)} new plots without changing existing plot identities.</p>
          <form method="POST" action="?/preview" use:enhance={previewEnhancer('garden', 'expand', () => ({ plotCount: nextExpansion!.plotCount }))}>
            <button type="submit" class="secondary-button" data-garden-command="expand" disabled={pending}>Preview {nextExpansion.plotCount}-plot expansion · {nextExpansion.price} gold</button>
          </form>
        </details>
      {/if}

      {#if selected?.kind === 'empty'}
        <details class="provision-group" open>
          <summary>Install hive on {selected.layoutKey}</summary>
          <p class="help">Empty hive equipment in inventory: {inventoryQuantity('equipment')}.</p>
          <form method="POST" action="?/apiaryPreview" use:enhance={previewEnhancer('apiary', 'install_hive', () => ({ cellId: selected!.id }))}>
            <button type="submit" class="secondary-button" data-apiary-command="install_hive" disabled={pending}>Preview hive installation</button>
          </form>
        </details>
      {/if}

      {#if selected?.kind === 'beehive' && selected.hive && !selected.hive.hasColony}
        <details class="provision-group" open>
          <summary>Populate this hive</summary>
          <p class="help">Replacement colonies in inventory: {inventoryQuantity('colony')}.</p>
          <form method="POST" action="?/apiaryPreview" use:enhance={previewEnhancer('apiary', 'install_colony', () => ({ hiveId: selected!.hive!.id }))}>
            <button type="submit" class="secondary-button" data-apiary-command="install_colony" disabled={pending}>Preview colony installation</button>
          </form>
        </details>
      {/if}

      {#if colony}
        <details class="provision-group" open>
          <summary>Manage colony</summary>
          <div class="apiary-actions">
            <section class="apiary-action-detail">
              <form method="POST" action="?/apiaryPreview" use:enhance={previewEnhancer('apiary', 'feed', () => ({ colonyId: colony!.id, quantity: feedQuantity }))}>
                <label>Feed units <input type="number" min="1" max="10" bind:value={feedQuantity} /></label>
                <button type="submit" class="secondary-button" data-apiary-command="feed" disabled={pending}>Preview feeding</button>
              </form>
            </section>
            <section class="apiary-action-detail">
              <form method="POST" action="?/apiaryPreview" use:enhance={previewEnhancer('apiary', 'extract_honey', () => ({ colonyId: colony!.id, quantity: honeyQuantity }))}>
                <label>Honey units <input type="number" min="1" max="20" bind:value={honeyQuantity} /></label>
                <button type="submit" class="secondary-button" data-apiary-command="extract_honey" disabled={pending}>Preview safe extraction</button>
              </form>
            </section>
            <section class="apiary-action-detail">
              <form method="POST" action="?/apiaryPreview" use:enhance={previewEnhancer('apiary', 'treat', () => (treatmentItemKey || treatments[0]?.itemKey) ? { colonyId: colony!.id, treatmentItemKey: treatmentItemKey || treatments[0]!.itemKey } : null)}>
                <label>Treatment
                  <select bind:value={treatmentItemKey} disabled={!treatments.length}>
                    {#each treatments as item}<option value={item.itemKey}>{item.name} · {item.quantity}</option>{/each}
                  </select>
                </label>
                <button type="submit" class="secondary-button" data-apiary-command="treat" disabled={pending || !treatments.length}>Preview treatment</button>
              </form>
            </section>
            <section class="apiary-action-detail">
              <form method="POST" action="?/apiaryPreview" use:enhance={previewEnhancer('apiary', 'split', () => (splitTargetHiveId || emptyHives[0]?.hive?.id) ? { sourceColonyId: colony!.id, targetHiveId: splitTargetHiveId || emptyHives[0]!.hive!.id } : null)}>
                <label>Empty destination hive
                  <select bind:value={splitTargetHiveId} disabled={!emptyHives.length}>
                    {#each emptyHives as cell}<option value={cell.hive!.id}>{cell.layoutKey} · hive equipment</option>{/each}
                  </select>
                </label>
                <button type="submit" class="secondary-button" data-apiary-command="split" disabled={pending || !emptyHives.length}>Preview colony split</button>
              </form>
            </section>
          </div>
        </details>
      {/if}
    {:else if colony}
      <section class="apiary-colony-status" data-apiary-colony-status>
        <p class="eyebrow">Colony in {selected?.layoutKey ?? 'the selected hive'}</p>
        <dl>
          <div><dt>Health</dt><dd>{colony.health}</dd></div>
          <div><dt>Feed stores</dt><dd>{colony.feedStores ?? colony.foodStores}</dd></div>
          <div><dt>Safe honey</dt><dd>{colony.extractableSurplus}</dd></div>
          <div><dt>Food reserve</dt><dd>{colony.protectedReserve}</dd></div>
        </dl>
      </section>
      {#if !selectedApiaryAction}
        <p class="help">Choose an apiary action from the hand to review its guidance and current colony state.</p>
      {:else if selectedApiaryAction === 'feed'}
        <section class="apiary-action-detail external-action">
          <h3>Feed colony</h3>
          <p class="help">Use one dose of {feedItemName()} on the colony in {selected?.layoutKey ?? 'this hive'}. It adds 18 feed stores.</p>
        </section>
      {:else if selectedApiaryAction === 'extract_honey'}
        <section class="apiary-action-detail external-action">
          <h3>Extract honey</h3>
          {#if colony.treatmentDaysRemaining > 0}
            <p class="help">Honey extraction is unavailable while treatment is active for {colony.treatmentDaysRemaining} more days.</p>
          {:else}
            <p class="help">Extract all {colony.extractableSurplus} safe honey units from {selected?.layoutKey ?? 'this hive'}, leaving the honey reserve intact.</p>
          {/if}
        </section>
      {:else if selectedApiaryAction === 'treat'}
        <section class="apiary-action-detail external-action">
          <h3>Treat colony</h3>
          {#if colony.treatmentDaysRemaining > 0}
            <p class="help">Treatment is active for {colony.treatmentDaysRemaining} more days. Honey extraction is unavailable during treatment.</p>
          {:else if !treatments.length}
            <p class="help">No treatment medicine is in inventory.</p>
          {:else if treatments.length > 1 && !selectedTreatmentKey}
            <p class="help">Choose a medicine from the action hand. Treatment lasts three days and prevents honey extraction while active.</p>
          {:else}
            {@const selectedMedicine = treatments.find((item) => item.itemKey === selectedTreatmentKey) ?? treatments[0]}
            {#if selectedMedicine}<p class="help">{treatmentDescription(selectedMedicine)}</p>{/if}
          {/if}
        </section>
      {:else if selectedApiaryAction === 'split'}
        <section class="apiary-action-detail external-action">
          <h3>Split colony</h3>
          {#if colonySplitShortages().length}
            <p class="help">This colony still needs {colonySplitShortages().join(', ')} before it meets the split requirements.</p>
          {/if}
          {#if splitTargetCell()}
            <p class="help">Destination: {splitTargetCell()!.layoutKey}. The preview lists the adults, brood, and food stores that transfer.</p>
          {:else if emptyHives.length}
            <p class="help">Choose an unlocked empty hive on the scene. The preview lists what transfers to that hive.</p>
          {:else}
            <p class="help">No empty unlocked hive is available for this split.</p>
          {/if}
        </section>
      {/if}
    {:else if selectedApiaryAction === 'install_hive'}
      <section class="apiary-action-detail external-action">
        <h3>Install hive</h3>
        <p class="help">Install hive equipment on {selected?.layoutKey ?? 'this empty plot'}. The preview shows the fixed cost and equipment used. Equipment in inventory: {inventoryQuantity('equipment')}.</p>
      </section>
    {:else if selectedApiaryAction === 'install_colony'}
      <section class="apiary-action-detail external-action">
        <h3>Populate hive</h3>
        <p class="help">Place a replacement colony in {selected?.layoutKey ?? 'this hive'}. The preview shows the fixed cost and colony used. Colonies in inventory: {inventoryQuantity('colony')}.</p>
      </section>
    {:else if selected?.kind === 'empty' || selected?.kind === 'beehive'}
      <p class="help">Choose an apiary installation action from the hand to review its cost and requirements.</p>
    {/if}
  {/if}

  {#if externalHand}
    <form
      bind:this={automaticPreviewForm}
      class="hidden-submit-form"
      method="POST"
      action="?/apiaryPreview"
      use:enhance={automaticPreviewEnhancer}
      data-automatic-preview-scope="apiary"
    ></form>
  {/if}

  {#if preview && hasCurrentPreview}
    {@const currentPreview = preview}
    {@const confirmLabel = pending ? 'Applying…' : pendingAction && messageError ? `Retry ${actionLabel(currentPreview.commandKind)}` : `Apply ${actionLabel(currentPreview.commandKind)}`}
    {@const inspectionItem: WorkflowChoice = {
      id: 'provision-preview',
      title: actionLabel(currentPreview.commandKind).replace(/^./, (letter) => letter.toUpperCase()),
      description: previewDescription(currentPreview.commandKind),
      eyebrow: previewScope === 'apiary' ? 'Apiary preview' : 'Garden supplies',
      icon: previewScope === 'apiary' ? '🐝' : '🌿',
      actionLabel: confirmLabel,
      disabled: currentPreview.canCommit === false
    }}
    <WorkflowInspection
      item={inspectionItem}
      onconfirm={confirmPreview}
      oncancel={cancelPreview}
      {confirmLabel}
      consequence={currentPreview.canCommit === false && previewWarnings(currentPreview).length === 0 ? 'This action cannot be completed with the current state or resources.' : undefined}
      {pending}
      {burning}
      {burnAction}
      error={messageError ? message : null}
    >
      {#snippet options()}
        <section class="preview-card" aria-live="polite" data-provision-preview data-preview-scope={previewScope}>
          {#if !externalHand}<p class="eyebrow">Preview</p><h3>{actionLabel(currentPreview.commandKind)}</h3>{/if}
          <dl>
            {#each visiblePreviewEntries(currentPreview) as [key, item]}
              <div><dt>{previewEntryLabel(key)}</dt><dd>{fieldValue(key, item)}</dd></div>
            {/each}
          </dl>
          {#each previewWarnings(currentPreview) as warning}
            <p class="preview-warning" role="status">{warning}</p>
          {/each}
        </section>
      {/snippet}
    </WorkflowInspection>
    <form
      bind:this={commitForm}
      class="hidden-submit-form"
      method="POST"
      action={previewScope === 'apiary' ? '?/apiaryCommand' : '?/command'}
      use:enhance={commitPreview}
      data-command-scope={previewScope}
    ></form>
  {/if}

  {#if message && !(externalHand && hasCurrentPreview)}<div class="form-message" class:error={messageError} role={messageError ? 'alert' : 'status'} aria-live="polite">{message}</div>{/if}
</section>

<style>
  .provision-panel { display: grid; gap: .7rem; padding-top: .9rem; border-top: 1px solid #4a371c; }
  .provision-panel h2 { margin: .2rem 0 0; font-size: 1rem; }
  .provision-group { padding: .55rem .6rem; border: 1px solid #4e3a1e; background: #110d07; }
  summary { color: #dabd72; cursor: pointer; font-family: 'Cinzel',serif; font-size: .75rem; }
  .apiary-colony-status { display: grid; gap: .45rem; margin: .65rem 0; padding: .7rem; border: 1px solid #806234; border-radius: .45rem; background: #171109db; }
  .apiary-colony-status > p { margin: 0; color: #d8bf83; font-size: .72rem; }
  .apiary-colony-status dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .4rem .75rem; margin: 0; }
  .apiary-colony-status dl div { display: flex; justify-content: space-between; gap: .5rem; color: #cbb991; font-size: .75rem; }
  .apiary-colony-status dd { margin: 0; color: #f0d58c; }
  .apiary-action-detail { display: grid; gap: .45rem; }
  .apiary-action-detail.external-action { padding: .7rem; border: 1px solid #806234; border-radius: .45rem; background: #171109db; }
  .external-panel { padding-top: 0; border-top: 0; }
  .external-panel .apiary-colony-status { padding: .7rem 0; border: 0; border-bottom: 1px solid #806234; border-radius: 0; background: transparent; }
  .external-panel .apiary-action-detail.external-action { padding: .7rem 0 0; border: 0; border-top: 1px solid #806234; border-radius: 0; background: transparent; }
  .apiary-action-detail h3 { margin: 0; color: #f1d990; font: 600 .9rem 'Cinzel', serif; }
  form, .apiary-actions { display: grid; gap: .55rem; margin-top: .6rem; }
  label { display: grid; gap: .25rem; color: #a99267; font-size: .7rem; }
  input, select { min-width: 0; min-height: 38px; padding: .4rem .45rem; border: 1px solid #624a26; border-radius: 0; color: #e2cc97; background: #090704; }
  .secondary-button { min-height: 40px; padding: .45rem .6rem; border: 1px solid #70552c; color: #d8bc78; background: #1a1309; font-family: 'Cinzel',serif; font-size: .67rem; }
  button:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: .5; }
  .help { margin: .45rem 0 0; color: #9f8b66; font-size: .67rem; line-height: 1.4; }
  .preview-card { display: grid; gap: .55rem; padding: .7rem; border: 1px solid #ad8335; background: #1b1307; }
  .preview-card h3 { margin: 0; color: #e6cb84; font-size: .9rem; text-transform: capitalize; }
  .preview-card dl { display: grid; gap: .25rem; margin: 0; }
  .preview-card dl div { display: flex; justify-content: space-between; gap: .5rem; }
  .preview-card dt { color: #9f8960; font-size: .65rem; text-transform: capitalize; }
  .preview-card dd { max-width: 58%; margin: 0; overflow-wrap: anywhere; color: #dfc789; font-size: .68rem; text-align: right; }
  .preview-warning { margin: 0; padding: .4rem .5rem; border-left: 2px solid #b17832; color: #f0cb84; font-size: .74rem; line-height: 1.4; }
  .hidden-submit-form { display: none; }
</style>
