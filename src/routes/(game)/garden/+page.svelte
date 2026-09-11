<script lang="ts">
  import { enhance } from '$app/forms';
  import { onDestroy, onMount } from 'svelte';
  import CropDetails from '$lib/components/garden/CropDetails.svelte';
  import GardenOverview from '$lib/components/garden/GardenOverview.svelte';
  import GardenCarePanel from '$lib/components/garden/GardenCarePanel.svelte';
  import GardenProvisionPanel from '$lib/components/garden/GardenProvisionPanel.svelte';
  import ContextualActionStrip from '$lib/components/scene/ContextualActionStrip.svelte';
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

  onMount(() => {
    hydrated = true;
  });

  let selected = $derived(
    data.snapshot?.cells.find((cell) => cell.id === selectedId) ?? data.snapshot?.cells[0] ?? null
  );
  let visual = $derived(deriveGardenVisualState(data.snapshot ?? null, selectedId, pending, transportError));

  $effect(() => {
    if (!selectedId && data.snapshot) {
      selectedId = data.snapshot.cells.find((cell) => cell.layoutKey === 'c1')?.id ?? null;
    }
  });

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

<svelte:head>
  <title>Garden · By Rook and Crook</title>
  <meta name="description" content="Tend and harvest the tavern garden." />
</svelte:head>

<main class="page-shell" data-hydrated={hydrated}>
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
        <h1>The garden</h1>
        <p>Select a plot to inspect the crop and its harvest.</p>
      </div>
      <div class="revision-badge">{data.snapshot.cells.filter((cell) => cell.kind === 'plant' && cell.harvestable).length} ready</div>
    </div>

    <CraftingSceneLayout area="garden" statusTitle="Garden ledger" inspectorTitle="Selected plot">
      {#snippet status()}
        <GardenOverview snapshot={data.snapshot!} onselect={(id) => (selectedId = id)} />
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
          <GardenScene {visual} {harvestEffect} onselect={(id) => (selectedId = id)} />
        </section>
      {/snippet}
      {#snippet inspector()}
        <div class="garden-sidebar">
          <CropDetails cell={selected} />
          <GardenCarePanel snapshot={data.snapshot!} {selected} />
          <GardenProvisionPanel snapshot={data.snapshot!} {selected} />

          {#if selected?.kind === 'plant'}
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
      {#snippet action()}
        <ContextualActionStrip
          eyebrow="Garden action"
          title={selected?.kind === 'plant' ? `Inspect ${selected.plantName}` : selected?.kind === 'beehive' ? 'Inspect the beehive' : 'Inspect open soil'}
          description={selected?.harvestable ? 'This crop is mature. Harvest it from the selected-plot inspector.' : 'Choose any tessellated plot to inspect its live state.'}
          status={pending ? 'Gathering…' : `${visual.plots.filter((plot) => plot.harvestable).length} crops ready`}
        >
          <a class="secondary-link compact-link" href="/ingredients">View ingredients <span aria-hidden="true">→</span></a>
        </ContextualActionStrip>
      {/snippet}
    </CraftingSceneLayout>
  {/if}
</main>

<style>
  @media (max-width: 620px) { .garden-panel { min-height: 0; padding: .85rem; } .panel-heading { padding-bottom: .75rem; } }
</style>
