<script lang="ts">
  import { qualityLabel, type GardenCell } from '$lib/game/contracts';

  let { cell }: { cell: GardenCell | null } = $props();
</script>

<section class="detail-card" aria-live="polite">
  {#if !cell}
    <p class="muted">Select a garden plot to inspect it.</p>
  {:else if cell.kind === 'empty'}
    <p class="eyebrow">Plot {cell.layoutKey}</p>
    <h2>Open soil</h2>
    <p class="muted">This plot is resting. Planting arrives in a later garden season.</p>
  {:else if cell.kind === 'beehive'}
    <p class="eyebrow">Plot {cell.layoutKey}</p>
    <h2>Courtyard beehive</h2>
    <p class="muted">Mature crops exactly one hex away produce one extra ingredient.</p>
  {:else}
    <p class="eyebrow">Plot {cell.layoutKey}</p>
    <div class="detail-heading">
      <span aria-hidden="true">{cell.icon}</span>
      <h2>{cell.plantName}</h2>
    </div>

    <dl class="stats">
      <div>
        <dt>Growth</dt>
        <dd>Stage {cell.growthStage} of 3</dd>
      </div>
      <div>
        <dt>Health</dt>
        <dd>{cell.health}%</dd>
      </div>
      <div>
        <dt>Water</dt>
        <dd>{cell.water}%</dd>
      </div>
    </dl>

    {#if cell.preview}
      <div class="harvest-preview">
        <p class="eyebrow">Harvest preview</p>
        <strong>{cell.preview.quantity} × {qualityLabel(cell.preview.qualityIndex)}</strong>
        <span>Brew +{cell.preview.brewBonus} · Bake +{cell.preview.bakeBonus} per unit</span>
        {#if cell.preview.hasHiveBonus}
          <span class="hive-bonus">🍯 +1 from a neighboring hive</span>
        {/if}
      </div>
    {:else}
      <p class="not-ready">This crop must reach stage 3 before harvest.</p>
    {/if}
  {/if}
</section>
