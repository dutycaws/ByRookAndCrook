<script lang="ts">
  import { enhance } from '$app/forms';
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
  import CropDetails from './CropDetails.svelte';
  import GardenOverview from './GardenOverview.svelte';
  import GardenProvisionPanel from './GardenProvisionPanel.svelte';

  type BatchKind = 'water' | 'amend';
  type Section = 'root' | 'crop' | 'soil' | 'apiary' | 'move';
type Pane = 'plant' | 'water' | 'amend' | 'move' | 'remove' | 'incorporate_clover' | 'compost_ingredient' | 'apiary' | 'preview';
  type SceneSlot = Snippet;

  let {
    snapshot,
    selected,
    batchMode = null,
    selectingBatchPlots = false,
    batchTargetIds = new Set<string>(),
    moveTargetId = null,
    moveSourceId = null,
    onstartbatch = () => {},
    oncancelbatch = () => {},
    onfinishbatch = () => {},
    onstartmove = () => {},
    oncancelmove = () => {},
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
    onstartbatch?: (kind: BatchKind) => void | Promise<void>;
    oncancelbatch?: () => void | Promise<void>;
    onfinishbatch?: () => void | Promise<void>;
    onstartmove?: () => void | Promise<void>;
    oncancelmove?: () => void | Promise<void>;
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
  let compostQuantity = $state(1);
  let preview = $state<GardenCommandPreview | null>(null);
  let previewPayload = $state<GardenCommandPayload | null>(null);
  let previewSignature = $state('');
  let previewRevision = $state<number | null>(null);
  let previewReturnPane = $state<Pane | null>(null);
  let pending = $state<string | null>(null);
  let pendingAction = $state<{ id: string; signature: string; revision: number; burnAction: ResolvedBurnAction } | null>(null);
  let message = $state<string | null>(null);
  let messageError = $state(false);
  let burningId = $state<string | null>(null);
  let workflowRoot = $state<HTMLElement>();
  let commitForm = $state<HTMLFormElement>();
  let lastSelectedId = $state(untrack(() => selected?.id ?? null));
  let burnAction = $state(untrack(() => resolveBurnAction(burnStyle)));
  let burnController: AbortController | null = null;

  let seeds = $derived(snapshot.garden?.inventory.filter((item) => item.kind === 'seed' && item.quantity > 0) ?? []);
  let selectedSeed = $derived(seeds.find((seed) => seed.itemKey === (seedItemKey || seeds[0]?.itemKey)) ?? null);
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
  let canPreview = $derived(!!preview && !!previewPayload
    && previewSignature === signature(preview.commandKind, previewPayload)
    && previewRevision === snapshot.save.revision);

  $effect(() => {
    const nextId = selected?.id ?? null;
    if (nextId === lastSelectedId) return;
    lastSelectedId = nextId;
    section = 'root';
    pane = null;
    recordsOpen = false;
    clearPreview();
    message = null;
    messageError = false;
  });

  onDestroy(() => {
    burnController?.abort();
  });

  function signature(kind: GardenCommandKind, payload: GardenCommandPayload | null) {
    return `${kind}:${JSON.stringify(payload)}`;
  }

  function label(kind: GardenCommandKind) {
    return ({
      plant: 'Plant', water: 'Water', amend: 'Fertilize', move: 'Move', remove: 'Remove',
      incorporate_clover: 'Incorporate clover', compost_ingredient: 'Compost', purchase: 'Purchase', expand: 'Expand'
    } satisfies Record<GardenCommandKind, string>)[kind];
  }

  function makePayload(kind: Exclude<Pane, 'apiary' | 'preview'>): GardenCommandPayload | null {
    if (!selected) return null;
    if (kind === 'plant') return (seedItemKey || seeds[0]?.itemKey)
      ? { cellId: selected.id, seedItemKey: seedItemKey || seeds[0]!.itemKey }
      : null;
    if (kind === 'water') return targets.length ? { cellIds: targets, dose: Number(waterDose) } : null;
    if (kind === 'amend') return targets.length && (amendmentKey || amendments[0]?.itemKey)
      ? { cellIds: targets, itemKey: amendmentKey || amendments[0]!.itemKey, dose: Number(amendmentDose) }
      : null;
    if (kind === 'move') return target ? { sourceCellId: selected.id, targetCellId: target.id } : null;
    if (kind === 'remove') return { cellId: selected.id, compost: compostRemoval };
    if (kind === 'incorporate_clover') return { cellId: selected.id };
    if (kind === 'compost_ingredient') return (compostBatchId || compostableBatches[0]?.id)
      ? { cellId: selected.id, ingredientBatchId: compostBatchId || compostableBatches[0]!.id, quantity: Number(compostQuantity) }
      : null;
    return null;
  }

  function clearPreview() {
    preview = null;
    previewPayload = null;
    previewSignature = '';
    previewRevision = null;
    pendingAction = null;
  }

  function previewAction(kind: Exclude<Pane, 'apiary' | 'preview'>): SubmitFunction {
    return ({ formData, cancel }) => {
      const payload = makePayload(kind);
      if (!payload) {
        cancel();
        message = kind === 'move' ? 'Select a destination plot on the board.' : 'Choose the required item first.';
        messageError = true;
        return;
      }
      formData.set('commandKind', kind);
      formData.set('payload', JSON.stringify(payload));
      pending = `preview:${kind}`;
      message = null;
      pendingAction = null;
      return async ({ result }) => {
        pending = null;
        const body = 'data' in result ? result.data as { preview?: GardenCommandPreview; message?: string } | undefined : undefined;
        if (result.type === 'success' && body?.preview) {
          preview = body.preview;
          previewPayload = payload;
          previewSignature = signature(kind, payload);
          previewRevision = body.preview.basedOnRevision;
          previewReturnPane = kind;
          pane = 'preview';
          messageError = false;
        } else {
          message = body?.message ?? 'The authoritative preview is unavailable.';
          messageError = true;
        }
      };
    };
  }

  const commit: SubmitFunction = ({ formData, cancel }) => {
    if (!preview || !previewPayload || !canPreview) {
      cancel();
      message = 'The garden changed after this preview. Review the action and preview it again.';
      messageError = true;
      return;
    }

    const commandKind = preview.commandKind;
    const key = signature(commandKind, previewPayload);
    if (!pendingAction || pendingAction.signature !== key) {
      const commandBurnAction = resolveBurnAction(burnStyle);
      burnAction = commandBurnAction;
      pendingAction = {
        id: crypto.randomUUID(),
        signature: key,
        revision: previewRevision ?? snapshot.save.revision,
        burnAction: commandBurnAction
      };
    }
    const commandAction = pendingAction;
    formData.set('saveId', snapshot.save.id);
    formData.set('actionId', commandAction.id);
    formData.set('expectedRevision', String(commandAction.revision));
    formData.set('commandKind', commandKind);
    formData.set('payload', JSON.stringify(previewPayload));
    pending = `commit:${commandKind}`;
    message = null;

    return async ({ result, update }) => {
      pending = null;
      const body = 'data' in result ? result.data as { message?: string; pendingAction?: object; conflict?: boolean } | undefined : undefined;
      if (result.type === 'error' || body?.pendingAction) {
        message = body?.message ?? 'The outcome is unknown. Retry this exact action.';
        messageError = true;
        return;
      }

      if (result.type === 'success') {
        message = body?.message ?? `${label(commandKind)} complete.`;
        messageError = false;
        await animateAcceptedCommand(commandAction.burnAction);
        pendingAction = null;
        clearPreview();
        pane = null;
        if (batchMode) await oncancelbatch();
        if (moveSourceId) await oncancelmove();
        await update({ reset: false, invalidateAll: true });
      } else {
        message = body?.conflict
          ? 'The garden changed before this action was accepted. Review the new state and preview again.'
          : body?.message ?? 'The action was rejected. Review the inputs and preview again.';
        messageError = true;
        if (body?.conflict) {
          clearPreview();
          pane = previewReturnPane;
        } else {
          pendingAction = null;
          clearPreview();
          pane = previewReturnPane;
        }
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
    if (!pending) commitForm?.requestSubmit();
  }

  function cancelPreview() {
    const returnPane = previewReturnPane;
    clearPreview();
    pane = returnPane;
    message = null;
    messageError = false;
  }

  async function choose(id: string) {
    if (id === 'harvest') { onharvest(); return; }
    if (id === 'back') {
      if (pane === 'preview') cancelPreview();
      else if (pane) pane = null;
      else section = 'root';
      return;
    }
    if (section === 'root') {
      if (id === 'crop' || id === 'soil' || id === 'apiary') section = id;
      else if (id === 'move') {
        section = 'move';
        pane = 'move';
        await onstartmove();
      }
      return;
    }
    if (id === 'plant' || id === 'water' || id === 'amend' || id === 'remove' || id === 'incorporate_clover' || id === 'compost_ingredient') {
      pane = id;
      if (batchMode && batchMode !== id) await oncancelbatch();
      return;
    }
    if (id === 'manage-apiary') pane = 'apiary';
    else if (id === 'select-plots' && (pane === 'water' || pane === 'amend')) await onstartbatch(pane);
    else if (id === 'back-to-plot') { section = 'root'; pane = null; }
  }

  function handleBack() {
    if (recordsOpen) {
      recordsOpen = false;
      return;
    }
    if (pane === 'preview') {
      cancelPreview();
      return;
    }
    if (moveSourceId) {
      void oncancelmove();
      pane = null;
      section = 'root';
      return;
    }
    if (pane) {
      pane = null;
      return;
    }
    if (section !== 'root') {
      section = 'root';
      return;
    }
    if (selected) void onclose();
  }

  function openRecords() {
    recordsOpen = true;
    section = 'root';
    pane = null;
    clearPreview();
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
    if (section === 'root') return rootChoices;
    const back = { id: 'back', title: 'Back', description: 'Return to plot actions.', icon: '←', actionLabel: 'Plot actions', burn: true } satisfies WorkflowChoice;
    if (section === 'crop') {
      const choices: WorkflowChoice[] = [];
      if (selected.kind === 'empty') choices.push({ id: 'plant', title: 'Plant', description: seeds.length ? 'Choose a seed for this open plot.' : 'No seeds are available in the garden inventory.', eyebrow: 'Crop', icon: '🌱', actionLabel: 'Choose seed', disabled: !seeds.length, burn: true });
      if (selected.kind === 'plant') choices.push({ id: 'remove', title: 'Remove plant', description: 'Remove this crop, with an option to compost eligible biomass.', eyebrow: 'Crop', icon: '✂', actionLabel: 'Review removal', burn: true });
      if (selected.kind === 'plant' && selected.plant?.speciesKey === 'clover') choices.push({ id: 'incorporate_clover', title: 'Incorporate clover', description: 'Release local soil benefits over the next three days.', eyebrow: 'Crop', icon: '☘', actionLabel: 'Review clover', burn: true });
      return [...choices, back];
    }
    if (section === 'soil') {
      const choices: WorkflowChoice[] = [
        { id: 'water', title: 'Water', description: 'Set a dose for this plot or a batch of plots.', eyebrow: 'Soil', icon: '💧', actionLabel: 'Set water dose', burn: true },
        { id: 'amend', title: 'Fertilize', description: 'Choose an amendment and strength.', eyebrow: 'Soil', icon: '✦', actionLabel: 'Set amendment', disabled: !amendments.length, burn: true }
      ];
      if (pane === 'water' || pane === 'amend') choices.push({ id: 'select-plots', title: batchMode === pane ? 'Edit plot selection' : 'Select plots', description: 'Choose garden plots directly on the scene. Enter or Space activates each plot.', eyebrow: 'Batch care', icon: '⬡', meta: `${batchTargetIds.size} selected`, actionLabel: batchMode === pane ? 'Edit targets' : 'Choose targets', disabled: !!pending, burn: true });
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
    if (section === 'root') return null;
    if (pane === 'water' || pane === 'amend') return 'select-plots';
    if (pane === 'apiary') return 'manage-apiary';
    if (section === 'soil') return 'water';
    if (section === 'crop') return handItems[0]?.id ?? 'back';
    if (section === 'move') return 'move';
    return null;
  });

  let selectedChoiceId = $derived(pane === 'preview' ? null : pane ?? (section === 'root' ? null : section));
  let hasFolio = $derived(Boolean(selected || recordsOpen));
  let hasHand = $derived(Boolean(selected && !recordsOpen && pane !== 'preview'));
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
      <button type="button" data-garden-ledger-trigger onclick={openRecords}>Garden ledger</button>
    {/if}
    {#if selected && batchMode}
      <button type="button" class="text-button" onclick={() => void oncancelbatch()}>Cancel batch</button>
    {/if}
  </div>
{/snippet}

{#snippet folioContent()}
  {#if canPreview && preview && previewPayload}
    {@const currentPreview = preview}
    {@const feedback = gardenCommandPreviewFeedback(currentPreview, {
      cellLabel: (cellId) => snapshot.cells.find((cell) => cell.id === cellId)?.layoutKey,
      itemName: (itemKey) => snapshot.garden?.inventory.find((item) => item.itemKey === itemKey)?.name
    })}
    {@const currentPayload = previewPayload}
    {@const isCropOrSoil = ['plant', 'water', 'amend'].includes(currentPreview.commandKind)}
    {@const inspectionItem: WorkflowChoice = {
      id: 'garden-preview',
      title: `Confirm ${label(currentPreview.commandKind)}`,
      description: feedback.summary,
      eyebrow: `Plot ${selected?.layoutKey ?? 'garden'}`,
      icon: currentPreview.commandKind === 'water' ? '💧' : currentPreview.commandKind === 'plant' ? '🌱' : '✧',
      actionLabel: pending?.startsWith('commit:') ? 'Applying…' : pendingAction && messageError ? `Retry ${label(currentPreview.commandKind)}` : label(currentPreview.commandKind),
      disabled: currentPreview.canCommit === false
    }}
    <WorkflowInspection
      item={inspectionItem}
      onconfirm={submitPreview}
      oncancel={cancelPreview}
      confirmLabel={inspectionItem.actionLabel}
      consequence={currentPreview.canCommit === false ? feedback.resourceWarning ?? 'This cannot be completed with the current resources.' : undefined}
      pending={!!pending}
      burning={burningId === 'garden-preview'}
      {burnAction}
      error={messageError ? message : null}
    >
      {#snippet options()}
        <section class="preview-options" aria-label="Authoritative garden preview">
          {#if currentPayload && 'cellIds' in currentPayload}
            <p class="help" data-garden-preview-targets>
              Targets: {currentPayload.cellIds.map((id) => snapshot.cells.find((cell) => cell.id === id)?.layoutKey ?? id).join(', ')}
            </p>
          {/if}
          {#if isCropOrSoil}
            {#each feedback.details as detail}
              <p class="preview-detail">{detail}</p>
            {/each}
            {#if feedback.resourceWarning && currentPreview.canCommit !== false}
              <p class="preview-warning" role="status">{feedback.resourceWarning}</p>
            {/if}
          {:else}
            <dl>
              {#each Object.entries(currentPreview).filter(([key]) => !['commandKind', 'basedOnRevision', 'rulesVersion', 'normalizedPayload', 'targets', 'before', 'after', 'warning', 'warningCount', 'canCommit', 'requiresAuthoritativeValidation'].includes(key)) as [key, value]}
                <div><dt>{key.replaceAll(/([A-Z])/g, ' $1')}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>
              {/each}
            </dl>
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
      <CropDetails cell={selected} />
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
        <GardenProvisionPanel {snapshot} {selected} {burnStyle} />
      {:else if pane === 'plant'}
        <section class="action-fields" aria-labelledby="garden-action-title">
          <p class="eyebrow">Crop choice</p><h2 id="garden-action-title">Plant this plot</h2>
          <p class="help">Seed guidance and growing notes stay with the selected variety.</p>
          <form method="POST" action="?/preview" use:enhance={previewAction('plant')}>
            <label>Seed
              <select bind:value={seedItemKey} aria-label="Seed" disabled={!seeds.length}>
                {#each seeds as seed}<option value={seed.itemKey}>{seed.name} · {seed.quantity}</option>{/each}
              </select>
            </label>
            <button type="submit" data-garden-command="plant" disabled={!!pending || !seeds.length}>Preview planting</button>
          </form>
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
          <label>Amount <output>{waterDose}</output><input aria-label="Water amount" type="range" min="1" max="40" step="1" bind:value={waterDose} /></label>
          {#if selectingBatchPlots}
            <div class="batch-toolbar" data-garden-batch-toolbar>
              <strong>Select plots with Enter, Space, or a click. Escape cancels.</strong>
              <div><button type="button" class="secondary-button" onclick={() => void onfinishbatch()}>Done · {batchTargetIds.size}</button><button type="button" class="text-button" onclick={() => void oncancelbatch()}>Cancel</button></div>
            </div>
          {/if}
          <form method="POST" action="?/preview" use:enhance={previewAction('water')}>
            <button type="submit" data-garden-command="water" disabled={!!pending || selectingBatchPlots}>Preview water</button>
          </form>
        </section>
      {:else if pane === 'amend'}
        <section class="action-fields" aria-labelledby="garden-action-title">
          <p class="eyebrow">Soil care</p><h2 id="garden-action-title">Fertilize</h2>
          <p class="help">{targets.length} plot{targets.length === 1 ? '' : 's'} selected. Choose an amendment and strength.</p>
          <label>Amendment
            <select bind:value={amendmentKey} aria-label="Amendment" disabled={!amendments.length}>
              {#each amendments as item}<option value={item.itemKey}>{item.name} · {item.quantity}</option>{/each}
            </select>
          </label>
          <label>Strength <output>{['Light', 'Medium', 'Heavy'][Number(amendmentDose) - 1]} · {amendmentDose}</output><input aria-label="Fertilizer strength" type="range" min="1" max="3" step="1" bind:value={amendmentDose} /></label>
          {#if selectingBatchPlots}
            <div class="batch-toolbar" data-garden-batch-toolbar>
              <strong>Select plots with Enter, Space, or a click. Escape cancels.</strong>
              <div><button type="button" class="secondary-button" onclick={() => void onfinishbatch()}>Done · {batchTargetIds.size}</button><button type="button" class="text-button" onclick={() => void oncancelbatch()}>Cancel</button></div>
            </div>
          {/if}
          <form method="POST" action="?/preview" use:enhance={previewAction('amend')}>
            <button type="submit" data-garden-command="amend" disabled={!!pending || !amendments.length || selectingBatchPlots}>Preview fertilize</button>
          </form>
        </section>
      {:else if pane === 'move'}
        <section class="action-fields" aria-labelledby="garden-action-title">
          <p class="eyebrow">Relocate</p><h2 id="garden-action-title">Move or swap</h2>
          <p class="help">{target ? `Destination: ${target.layoutKey}. Its occupant will swap.` : 'Select a destination plot on the board. Arrow keys move focus; Enter or Space chooses the destination.'}</p>
          <form method="POST" action="?/preview" use:enhance={previewAction('move')}>
            <button type="submit" data-garden-command="move" disabled={!!pending || !target}>Preview move</button>
          </form>
        </section>
      {:else if pane === 'remove'}
        <section class="action-fields" aria-labelledby="garden-action-title">
          <p class="eyebrow">Crop care</p><h2 id="garden-action-title">Remove plant</h2>
          <p class="help">This removes the plant permanently.</p>
          <label class="check"><input type="checkbox" bind:checked={compostRemoval} /> Compost eligible biomass</label>
          <form method="POST" action="?/preview" use:enhance={previewAction('remove')}><button type="submit" data-garden-command="remove" disabled={!!pending}>Preview removal</button></form>
        </section>
      {:else if pane === 'incorporate_clover'}
        <section class="action-fields" aria-labelledby="garden-action-title">
          <p class="eyebrow">Crop care</p><h2 id="garden-action-title">Incorporate clover</h2>
          <p class="help">Established clover is sacrificed and releases local soil benefits over three days.</p>
          <form method="POST" action="?/preview" use:enhance={previewAction('incorporate_clover')}><button type="submit" data-garden-command="incorporate_clover" disabled={!!pending}>Preview incorporation</button></form>
        </section>
      {:else if pane === 'compost_ingredient'}
        <section class="action-fields" aria-labelledby="garden-action-title">
          <p class="eyebrow">Soil care</p><h2 id="garden-action-title">Compost ingredient</h2>
          <label>Ingredient batch
            <select bind:value={compostBatchId} aria-label="Ingredient batch">
              {#each compostableBatches as batch}<option value={batch.id}>{batch.plantName} · {batch.quantity - (batch.consumedQuantity ?? 0) - (batch.compostedQuantity ?? 0)} available</option>{/each}
            </select>
          </label>
          <label>Units <output>{compostQuantity}</output><input aria-label="Compost quantity" type="range" min="1" max="20" step="1" bind:value={compostQuantity} /></label>
          <form method="POST" action="?/preview" use:enhance={previewAction('compost_ingredient')}><button type="submit" data-garden-command="compost_ingredient" disabled={!!pending || !compostableBatches.length}>Preview compost</button></form>
        </section>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet handContent()}
  <WorkflowHand
    items={handItems}
    label={section === 'root' ? `Actions for ${selected?.layoutKey ?? 'this plot'}` : `${section} choices for ${selected?.layoutKey ?? 'this plot'}`}
    selectedId={selectedChoiceId}
    focusId={focusChoiceId}
    {burnStyle}
      burningId={harvestBurnAction ? 'harvest' : null}
      burnAction={harvestBurnAction ?? undefined}
      pending={!!pending || harvestPending || !!selectingBatchPlots || recordsOpen}
    onchoose={choose}
  />
{/snippet}

<CardWorkflowFrame
  sceneAspect={1672 / 941}
  title={recordsOpen ? 'Garden ledger' : 'Garden'}
  eyebrow="The tavern courtyard"
  location={selected ? `Plot ${selected.layoutKey}` : 'Choose a plot on the scene'}
  backLabel={recordsOpen ? 'Back to garden' : section !== 'root' || pane ? 'Back' : 'Back to garden'}
  onback={selected || recordsOpen ? handleBack : undefined}
  focusKey={frameFocusKey}
  inspectionMode={pane === 'preview' && canPreview ? 'center' : 'folio'}
  scene={sceneContent}
  status={statusContent}
  controls={controlsContent}
  folio={hasFolio ? folioContent : undefined}
  hand={hasHand ? handContent : undefined}
/>

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
  .action-fields form, .action-fields label { display: grid; gap: .45rem; }
  .action-fields label { color: #c9ad70; font-size: .75rem; }
  .action-fields select, .action-fields input:not([type='checkbox']) { min-height: 38px; padding: .4rem .5rem; border: 1px solid #765324; color: #f0dca8; background: #100a05; }
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
  .preview-options dl { display: grid; gap: .35rem; margin: .35rem 0; }
  .preview-options dl div { display: flex; justify-content: space-between; gap: .5rem; font-size: .72rem; }
  .preview-options dt { color: #a89161; text-transform: capitalize; }
  .preview-options dd { max-width: 58%; margin: 0; overflow-wrap: anywhere; text-align: right; }
  .error { color: #ffd0ba; }
  .hidden-submit-form { display: none; }
</style>
