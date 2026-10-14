<script lang="ts">
  import { enhance } from '$app/forms';
  import { onDestroy, onMount, tick } from 'svelte';
  import GardenActionMenu from '$lib/components/garden/GardenActionMenu.svelte';
  import GardenScene from '$lib/components/scenes/GardenScene.svelte';
  import { resolveBurnAction, waitForBurn, type ResolvedBurnAction } from '$lib/card-effects';
  import type { HarvestCommand, HarvestReceipt } from '$lib/game/contracts';
  import AcquisitionReveal from '$lib/components/ui/AcquisitionReveal.svelte';
  import { claimAcquisitionReceipt, harvestAcquisitionCard, type AcquisitionCard } from '$lib/game/acquisition';
  import { deriveGardenVisualState } from '$lib/presentation/scene';
  import type { PageProps, SubmitFunction } from './$types';

  let { data, form }: PageProps = $props();
  let selectedId = $state<string | null>(null);
  let pending = $state(false);
  let acquisitionCard = $state<AcquisitionCard | null>(null);
  const seenAcquisitionEvents = new Set<string>();
  let pendingCommand = $state<HarvestCommand | null>(null);
  let harvestForm = $state<HTMLFormElement>();
  let harvestBurnAction = $state<ResolvedBurnAction | null>(null);
  let harvestBurnController: AbortController | null = null;
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
  let splitSourceId = $state<string | null>(null);
  let splitTargetId = $state<string | null>(null);
  let interactionLocked = $state(false);

  onMount(() => {
    hydrated = true;
  });

  let selected = $derived(data.snapshot?.cells.find((cell) => cell.id === selectedId) ?? null);
  let visual = $derived(deriveGardenVisualState(data.snapshot ?? null, selectedId, pending, transportError));
  let splitDestinationIds = $derived(new Set(data.snapshot?.cells.filter((cell) => cell.unlocked !== false && cell.kind === 'beehive' && cell.hive && !cell.hive.hasColony).map((cell) => cell.id) ?? []));

  function selectPlot(cellId: string) {
    if (interactionLocked) return;
    if (splitSourceId) {
      if (splitDestinationIds.has(cellId)) splitTargetId = cellId;
      return;
    }
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
  }

  function navigatePlot(_cellId: string) {
    // Arrow keys move focus only. The plot becomes the active workflow after
    // its button receives Enter, Space, or a pointer click.
    if (!interactionLocked && moveSourceId) moveTargetId = null;
  }

  async function focusPlot(cellId: string | null) {
    await tick();
    if (cellId) document.querySelector<HTMLElement>(`[data-cell-id="${CSS.escape(cellId)}"]`)?.focus({ preventScroll: true });
  }

  async function closePlotMenu() {
    const previousId = selectedId;
    selectedId = null;
    cancelMove();
    cancelSplit();
    await focusPlot(previousId);
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
    await tick();
    document.querySelector<HTMLElement>('[data-workflow-choice="select-plots"]')?.focus({ preventScroll: true });
  }

  async function finishBatch() {
    selectingBatchPlots = false;
    await tick();
    document.querySelector<HTMLElement>('[data-workflow-confirm]')?.focus({ preventScroll: true });
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

  async function startSplit() {
    cancelMove();
    splitSourceId = selected?.id ?? null;
    splitTargetId = null;
    await focusPlot(splitSourceId);
  }

  function cancelSplit() {
    splitSourceId = null;
    splitTargetId = null;
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
    const command = pendingCommand;
    const plant = { name: selected.plantName ?? 'Garden harvest', icon: selected.icon };

    return async ({ result, update }) => {
      let acquired: AcquisitionCard | null = null;
      if (result.type === 'error') {
        pending = false;
        transportError = 'The harvest outcome is unknown. Retry the same harvest to check its result.';
        return;
      }

      if (result.type === 'success') {
        const receipt = (result.data as { receipt?: HarvestReceipt } | undefined)?.receipt;
        const eventId = claimAcquisitionReceipt('harvest', 'harvest_crop', command.actionId, receipt?.actionId, seenAcquisitionEvents);
        if (eventId && receipt) acquired = harvestAcquisitionCard(eventId, receipt, plant);
        harvestBurnController?.abort();
        harvestBurnController = new AbortController();
        harvestBurnAction = resolveBurnAction(data.cardBurnStyle);
        await tick();
        const completed = await waitForBurn(harvestBurnAction.durationMs, harvestBurnController.signal);
        harvestBurnAction = null;
        if (!completed) return;
        if (pendingHarvestVisual) {
          harvestEffect = { ...pendingHarvestVisual, token: Date.now() };
          if (harvestEffectTimer) clearTimeout(harvestEffectTimer);
          harvestEffectTimer = setTimeout(() => (harvestEffect = null), 1_000);
        }
        pendingCommand = null;
        pendingHarvestVisual = null;
      }
      pending = false;
      try { await update({ reset: false, invalidateAll: true }); }
      finally { if (acquired) acquisitionCard = acquired; }
    };
  };

  onDestroy(() => {
    harvestBurnController?.abort();
    if (harvestEffectTimer) clearTimeout(harvestEffectTimer);
  });
</script>

<svelte:window onkeydown={handleBatchKeydown} />

<svelte:head>
  <title>Garden · By Rook and Crook</title>
  <meta name="description" content="Tend and harvest the tavern garden." />
</svelte:head>

<main class="page-shell garden-page" data-hydrated={hydrated}>
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
    <GardenActionMenu
      snapshot={data.snapshot}
      {selected}
      {batchMode}
      {batchTargetIds}
      {selectingBatchPlots}
      {moveTargetId}
      {moveSourceId}
      onstartbatch={startBatch}
      oncancelbatch={cancelBatch}
      onfinishbatch={finishBatch}
      onstartmove={startMove}
      oncancelmove={cancelMove}
      {splitTargetId}
      onstartsplit={startSplit}
      oncancelsplit={cancelSplit}
      oninteractionlockchange={(locked) => { interactionLocked = locked; }}
      onclose={closePlotMenu}
      burnStyle={data.cardBurnStyle}
      {transportError}
      harvestPending={pending}
      {harvestBurnAction}
      onharvest={() => { if (hydrated && !pending) harvestForm?.requestSubmit(); }}
      harvestActionId={pendingCommand?.actionId ?? null}
      harvestRetryAvailable={!!pendingCommand && (!!transportError || !!form?.pendingAction)}
      formMessage={form?.message ?? null}
      formError={form?.success === false}
      formConflict={!!form?.conflict}
      onacquired={(card) => { acquisitionCard = card; }}
    >
      {#snippet scene()}
        <GardenScene
          {visual}
          {harvestEffect}
          batchMode={selectingBatchPlots ? batchMode : null}
          {batchTargetIds}
          {moveTargetId}
          splitTargetId={splitSourceId ? splitTargetId : null}
          splitDestinationIds={splitSourceId ? splitDestinationIds : null}
          onselect={selectPlot}
          onnavigate={navigatePlot}
        />
      {/snippet}
      {#snippet harvest()}
        {#if selected?.kind === 'plant' && selected.harvestable}
          <form bind:this={harvestForm} method="POST" action="?/harvest" use:enhance={enhanceHarvest}></form>
        {/if}
      {/snippet}
    </GardenActionMenu>
    {#if acquisitionCard}
      <AcquisitionReveal open {...acquisitionCard} ondismiss={() => { acquisitionCard = null; }} />
    {/if}
  {/if}
</main>

<style>
  .garden-page { width: min(100% - 2rem, 1640px); margin: 1rem auto 2rem; }
  .onboarding { max-width: 34rem; margin: 12vh auto 0; padding: 2.2rem; text-align: center; }
  .onboarding .large-icon { display: block; margin-bottom: .65rem; font-size: 3rem; }
  .onboarding h1 { margin: .25rem 0 .5rem; }
  .onboarding > p:not(.eyebrow) { color: #b4a17b; line-height: 1.5; }
  .onboarding form { margin-top: 1rem; }
  @media (max-width: 700px) { .garden-page { width: 100%; margin: 0; } .onboarding { margin: 10vh 1rem 0; padding: 1.25rem; } }
</style>
