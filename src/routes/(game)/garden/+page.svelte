<script lang="ts">
  import { enhance } from '$app/forms';
  import { onDestroy, onMount, tick } from 'svelte';
  import CropDetails from '$lib/components/garden/CropDetails.svelte';
  import GardenActionMenu from '$lib/components/garden/GardenActionMenu.svelte';
  import GardenOverview from '$lib/components/garden/GardenOverview.svelte';
  import CraftingSceneLayout from '$lib/components/scene/CraftingSceneLayout.svelte';
  import IllustratedActionButton from '$lib/components/scene/IllustratedActionButton.svelte';
  import GardenScene from '$lib/components/scenes/GardenScene.svelte';
  import type { HarvestCommand } from '$lib/game/contracts';
  import { deriveGardenVisualState } from '$lib/presentation/scene';
  import type { PageProps, SubmitFunction } from './$types';

  let { data, form }: PageProps = $props();
  let selectedId = $state<string | null>(null);
  let pending = $state(false);
  let pendingCommand = $state<HarvestCommand | null>(null);
  let pendingHarvestVisual = $state<{ cellId: string; plantKey: string; stage: number } | null>(null);
  let harvestEffect = $state<{ token: number; cellId: string; plantKey: string; stage: number } | null>(null);
  let harvestEffectTimer: ReturnType<typeof setTimeout> | null = null;
  let transportError = $state<string | null>(null);
  let hydrated = $state(false);
  let batchMode = $state<'water' | 'amend' | null>(null);
  let selectingBatchPlots = $state(false);
  let batchTargetIds = $state<Set<string>>(new Set());
  let batchOriginId = $state<string | null>(null);
  let previousBatchTargetIds = $state<Set<string>>(new Set());
  let moveSourceId = $state<string | null>(null);
  let moveTargetId = $state<string | null>(null);
  let menuOpen = $state(false);

  type ReceiptContext = { cellId: string | null; openRequest: string | null };

  function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  function receiptContext(value: unknown): ReceiptContext {
    const formRecord = record(value);
    const receipt = record(formRecord?.receipt);
    const payload = record(receipt?.normalizedPayload);
    if (!receipt || typeof receipt.commandKind !== 'string' || !data.snapshot) {
      return { cellId: null, openRequest: null };
    }
    const openRequest = typeof receipt.actionId === 'string' ? receipt.actionId : null;

    const directIds = [payload?.cellId, payload?.sourceCellId, ...(Array.isArray(payload?.cellIds) ? payload.cellIds : [])];
    const directCell = directIds.find((id) => typeof id === 'string' && data.snapshot?.cells.some((cell) => cell.id === id));
    if (typeof directCell === 'string') return { cellId: directCell, openRequest };

    const hiveIds = [payload?.hiveId, payload?.targetHiveId];
    const hiveCell = data.snapshot.cells.find((cell) => cell.hive && hiveIds.includes(cell.hive.id));
    if (hiveCell) return { cellId: hiveCell.id, openRequest };

    const colonyIds = [payload?.colonyId, payload?.sourceColonyId];
    const colonyCell = data.snapshot.cells.find((cell) => cell.hive?.colony && colonyIds.includes(cell.hive.colony.id));
    return { cellId: colonyCell?.id ?? null, openRequest: colonyCell ? openRequest : null };
  }

  onMount(() => {
    hydrated = true;
  });

  let selected = $derived(
    data.snapshot?.cells.find((cell) => cell.id === selectedId)
      ?? data.snapshot?.cells.find((cell) => cell.unlocked !== false)
      ?? null
  );
  let completedAction = $derived(receiptContext(form));
  let visual = $derived(deriveGardenVisualState(data.snapshot ?? null, selectedId, pending, transportError));

  $effect(() => {
    if (!selectedId && data.snapshot) {
      selectedId = completedAction.cellId
        ?? data.snapshot.cells.find((cell) => cell.unlocked !== false)?.id
        ?? null;
    }
  });

  function selectPlot(cellId: string) {
    if (moveSourceId) {
      if (cellId !== moveSourceId) moveTargetId = cellId;
      return;
    }
    if (selectingBatchPlots) {
      const next = new Set(batchTargetIds);
      if (next.has(cellId)) next.delete(cellId); else next.add(cellId);
      batchTargetIds = next;
      return;
    }
    selectedId = cellId;
    menuOpen = true;
  }

  function navigatePlot(cellId: string) {
    // In target-selection modes, arrow keys only move focus. Enter/Space then
    // confirms the focused plot without replacing the action's source or menu.
    if (selectingBatchPlots || moveSourceId) return;
    selectedId = cellId;
    menuOpen = false;
    cancelMove();
  }

  async function focusPlot(cellId: string | null) {
    await tick();
    if (cellId) document.querySelector<HTMLElement>(`[data-cell-id="${cellId}"]`)?.focus();
  }

  async function closePlotMenu() {
    menuOpen = false;
    cancelMove();
    // The parent owns the rendered plot. Wait for the floating menu to leave
    // the DOM before returning focus, so responsive unmounting cannot steal it.
    await focusPlot(selectedId);
  }

  async function returnToActions(selector: string) {
    await tick();
    if (window.matchMedia('(max-width: 620px)').matches) {
      const openActions = document.querySelector<HTMLDialogElement>('dialog.actions-dialog[open]');
      if (!openActions) document.querySelector<HTMLButtonElement>('[data-garden-actions-trigger]')?.click();
      await tick();
    }
    document.querySelector<HTMLElement>(selector)?.focus();
  }

  async function startBatch(kind: 'water' | 'amend') {
    batchOriginId = selected?.id ?? null;
    previousBatchTargetIds = new Set(batchTargetIds);
    batchMode = kind;
    selectingBatchPlots = true;
    batchTargetIds = selected ? new Set([selected.id]) : new Set();
    await focusPlot(batchOriginId);
  }

  async function cancelBatch() {
    const kind = batchMode;
    selectedId = batchOriginId ?? selectedId;
    batchMode = null;
    selectingBatchPlots = false;
    batchTargetIds = new Set(previousBatchTargetIds);
    await returnToActions(`[data-batch-start="${kind}"]`);
  }

  async function startMove() {
    moveSourceId = selected?.id ?? null;
    moveTargetId = null;
    await focusPlot(moveSourceId);
  }

  function cancelMove() {
    moveSourceId = null;
    moveTargetId = null;
  }

  async function finishBatch() {
    const kind = batchMode;
    selectingBatchPlots = false;
    await returnToActions(`[data-garden-command="${kind}"]`);
  }

  function handleBatchKeydown(event: KeyboardEvent) {
    if (selectingBatchPlots && event.key === 'Escape') {
      event.preventDefault();
      void cancelBatch();
    }
  }

  const enhanceHarvest: SubmitFunction = ({ formData }) => {
    if (!data.snapshot || !selected) return;

    if (
      !pendingCommand ||
      pendingCommand.cellId !== selected.id ||
      pendingCommand.expectedRevision !== data.snapshot.save.revision
    ) {
      pendingCommand = {
        saveId: data.snapshot.save.id,
        cellId: selected.id,
        actionId: crypto.randomUUID(),
        expectedRevision: data.snapshot.save.revision
      };
      pendingHarvestVisual = selected.kind === 'plant' && selected.plantKey && selected.growthStage
        ? { cellId: selected.id, plantKey: selected.plantKey, stage: selected.growthStage }
        : null;
    }

    formData.set('saveId', pendingCommand.saveId);
    formData.set('cellId', pendingCommand.cellId);
    formData.set('actionId', pendingCommand.actionId);
    formData.set('expectedRevision', String(pendingCommand.expectedRevision));
    pending = true;
    transportError = null;

    return async ({ result, update }) => {
      pending = false;
      if (result.type === 'error') {
        transportError = 'The harvest outcome is unknown. Retry the same harvest to check its result.';
        return;
      }

      if (result.type === 'success') {
        if (pendingHarvestVisual) {
          harvestEffect = { ...pendingHarvestVisual, token: Date.now() };
          if (harvestEffectTimer) clearTimeout(harvestEffectTimer);
          harvestEffectTimer = setTimeout(() => (harvestEffect = null), 1_000);
        }
        pendingCommand = null;
        pendingHarvestVisual = null;
      }
      await update({ reset: false, invalidateAll: true });
    };
  };

  onDestroy(() => {
    if (harvestEffectTimer) clearTimeout(harvestEffectTimer);
  });
</script>

<svelte:window onkeydown={handleBatchKeydown} />

<svelte:head>
  <title>Garden · By Rook and Crook</title>
  <meta name="description" content="Tend and harvest the tavern garden." />
</svelte:head>

<main class="page-shell crafting-page" data-hydrated={hydrated}>
  {#if !data.snapshot}
    <section class="onboarding panel" aria-labelledby="start-title">
      <span class="large-icon" aria-hidden="true">🌿</span>
      <p class="eyebrow">A courtyard of your own</p>
      <h1 id="start-title">Start your tavern garden</h1>
      <p>A dozen hex plots, seven useful herbs and vegetables, and one busy beehive await.</p>
      <form method="POST" action="?/create">
        <button class="primary-button" type="submit">Start tavern</button>
      </form>
      {#if form?.message}
        <p class="form-message" class:error={!form?.success} role="status">{form.message}</p>
      {/if}
    </section>
  {:else}
    <div class="page-title-row">
      <div>
        <p class="eyebrow">Courtyard · Tavern day {data.snapshot.save.currentDay}</p>
        <h1>Garden</h1>
      </div>
      <div class="revision-badge">{data.snapshot.cells.filter((cell) => cell.kind === 'plant' && cell.harvestable).length} ready</div>
    </div>

    <CraftingSceneLayout area="garden" statusTitle="Garden ledger" inspectorTitle="Selected plot">
      {#snippet status()}
        <GardenOverview snapshot={data.snapshot!} />
      {/snippet}
      {#snippet scene()}
        <section class="garden-panel panel" aria-labelledby="garden-grid-title" data-visual-status={visual.status}>
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Tavern grounds</p>
              <h2 id="garden-grid-title">Hex garden</h2>
            </div>
            <span class="legend"><i></i> Ready</span>
          </div>
          <GardenScene {visual} {harvestEffect} batchMode={selectingBatchPlots ? batchMode : null} {batchTargetIds} onselect={selectPlot} onnavigate={navigatePlot} />
          {#snippet harvestAction()}
            {#if selected?.kind === 'plant' && selected.harvestable}
              <form method="POST" action="?/harvest" use:enhance={enhanceHarvest}>
                <IllustratedActionButton
                  type="submit"
                  icon="✦"
                  loading={pending}
                  disabled={!hydrated || !selected.harvestable}
                >
                  {pending
                    ? 'Gathering…'
                    : pendingCommand && (transportError || form?.pendingAction)
                      ? 'Retry harvest'
                      : 'Harvest crop'}
                </IllustratedActionButton>
              </form>
            {/if}
          {/snippet}
          {#if menuOpen}
            <GardenActionMenu
              snapshot={data.snapshot!}
              {selected}
              batchMode={batchMode}
              {batchTargetIds}
              {moveTargetId}
              onstartbatch={startBatch}
              oncancelbatch={cancelBatch}
              onstartmove={startMove}
              oncancelmove={cancelMove}
              onclose={closePlotMenu}
              harvest={harvestAction}
            />
          {/if}
          {#if selectingBatchPlots}
            <section class="batch-toolbar" data-garden-batch-toolbar aria-label="Batch care selection">
              <strong>{batchTargetIds.size} plot{batchTargetIds.size === 1 ? '' : 's'} selected for {batchMode}</strong>
              <div><button type="button" class="secondary-button" onclick={finishBatch}>Done</button><button type="button" class="text-button" onclick={cancelBatch}>Cancel</button></div>
            </section>
          {/if}
        </section>
      {/snippet}
      {#snippet inspector()}
        <div class="garden-sidebar">
          <CropDetails cell={selected} />
          {#if transportError}
            <div class="form-message error" role="alert" aria-live="assertive">{transportError}</div>
          {/if}

          {#if form?.message}
            <div
              class="form-message"
              class:error={!form?.success}
              role={form?.success ? 'status' : 'alert'}
              aria-live="polite"
            >
              {form.message}
              {#if form?.conflict}<span>The latest garden state has been loaded.</span>{/if}
            </div>
          {/if}

          {#if pendingCommand && !pending && (transportError || form?.pendingAction)}
            <p class="retry-note">Retrying will reuse action {pendingCommand.actionId.slice(0, 8)}…</p>
          {/if}
        </div>
      {/snippet}
    </CraftingSceneLayout>
  {/if}
</main>

<style>
  .batch-toolbar { display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin-top: .7rem; padding: .65rem; border: 1px solid #80612d; background: #171006; color: #e5cb86; font-family: 'Cinzel', serif; font-size: .75rem; }
  .batch-toolbar div { display: flex; gap: .45rem; }
  .secondary-button, .text-button { min-height: 36px; padding: .35rem .6rem; border: 1px solid #70552c; color: #d8bc78; background: #1a1309; font-family: 'Cinzel',serif; font-size: .67rem; }
  .text-button { border-color: #5c4727; background: transparent; }
  @media (max-width: 620px) { .garden-panel { min-height: 0; padding: .85rem; } .panel-heading { padding-bottom: .75rem; } .batch-toolbar { align-items: start; flex-direction: column; } }
</style>
