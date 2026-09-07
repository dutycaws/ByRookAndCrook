<script lang="ts">
  import IngredientList from '$lib/components/ingredients/IngredientList.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>Ingredients · By Rook and Crook</title>
  <meta name="description" content="Harvested ingredients from the tavern garden." />
</svelte:head>

<main class="page-shell">
  <div class="page-title-row">
    <div>
      <p class="eyebrow">The keeper's pantry</p>
      <h1>Ingredients</h1>
      <p>Raw garden harvests waiting for the brewery and bakery.</p>
    </div>
    {#if data.snapshot}
      <div class="revision-badge">{data.snapshot.ingredients.length} batch{data.snapshot.ingredients.length === 1 ? '' : 'es'}</div>
    {/if}
  </div>

  <section class="panel inventory-panel" aria-labelledby="inventory-title">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Persisted in the ledger</p>
        <h2 id="inventory-title">Harvested batches</h2>
      </div>
      <a class="secondary-link compact" href="/garden">Return to garden</a>
    </div>

    {#if data.snapshot}
      <IngredientList ingredients={data.snapshot.ingredients} />
    {:else}
      <div class="empty-state">
        <h2>No tavern yet</h2>
        <p>Start your tavern before stocking its pantry.</p>
        <a class="primary-button inline-button" href="/garden">Start in the garden</a>
      </div>
    {/if}
  </section>
</main>
