<script lang="ts">
  import { enhance } from '$app/forms';
  import GardenGrid from '$lib/components/garden/GardenGrid.svelte';
  import CropDetails from '$lib/components/garden/CropDetails.svelte';
  import type { HarvestCommand } from '$lib/game/contracts';
  import type { PageProps, SubmitFunction } from './$types';

  let { data, form }: PageProps = $props();
  let selectedId = $state<string | null>(null);
  let pending = $state(false);
  let pendingCommand = $state<HarvestCommand | null>(null);
  let transportError = $state<string | null>(null);

  let selected = $derived(
    data.snapshot?.cells.find((cell) => cell.id === selectedId) ?? data.snapshot?.cells[0] ?? null
  );

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
        transportError = 'The harvest outcome is unknown. Retry to check the same ledger entry.';
        return;
      }

      if (result.type === 'success') pendingCommand = null;
      await update({ reset: false, invalidateAll: true });
    };
  };
</script>

<svelte:head>
  <title>Garden · By Rook and Crook</title>
  <meta name="description" content="Tend and harvest the tavern garden." />
</svelte:head>

<main class="page-shell">
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
        <p class="eyebrow">Courtyard · rules {data.snapshot.save.rulesVersion}</p>
        <h1>The garden</h1>
        <p>Select a plot to inspect the crop and its harvest.</p>
      </div>
      <div class="revision-badge" title="Current saved game revision">
        Ledger {data.snapshot.save.revision}
      </div>
    </div>

    <div class="garden-layout">
      <section class="garden-panel panel" aria-labelledby="garden-grid-title">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Tavern grounds</p>
            <h2 id="garden-grid-title">Hex garden</h2>
          </div>
          <span class="legend"><i></i> Ready</span>
        </div>
        <GardenGrid cells={data.snapshot.cells} {selectedId} onselect={(id) => (selectedId = id)} />
      </section>

      <aside class="garden-sidebar">
        <CropDetails cell={selected} />

        {#if selected?.kind === 'plant'}
          <form method="POST" action="?/harvest" use:enhance={enhanceHarvest}>
            <button
              class="primary-button full-button"
              type="submit"
              disabled={!selected.harvestable || pending}
            >
              {pending
                ? 'Writing the ledger…'
                : pendingCommand && (transportError || form?.pendingAction)
                  ? 'Retry harvest'
                  : 'Harvest crop'}
            </button>
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
            {#if form?.conflict}
              <span>The latest garden state has been loaded.</span>
            {/if}
          </div>
        {/if}

        {#if pendingCommand && !pending && (transportError || form?.pendingAction)}
          <p class="retry-note">Retrying will reuse action {pendingCommand.actionId.slice(0, 8)}…</p>
        {/if}

        <a class="secondary-link" href="/ingredients">
          View ingredients <span aria-hidden="true">→</span>
        </a>
      </aside>
    </div>
  {/if}
</main>
