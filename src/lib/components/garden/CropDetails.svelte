<script lang="ts">
  import type { GardenCell } from '$lib/game/contracts';

  let { cell }: { cell: GardenCell | null } = $props();
</script>

<section class="detail-card" data-garden-inspector>
  {#if !cell}
    <p class="muted">Select a garden plot to inspect it.</p>
  {:else}
    <p class="eyebrow">Plot {cell.layoutKey}</p>

    {#if cell.kind === 'empty'}
      <h2>Open soil</h2>
      <p class="muted">Ready for a seed or hive. Soil stays with this hex when occupants move.</p>
    {:else if cell.kind === 'beehive'}
      <div class="detail-heading">
        <span aria-hidden="true">⌂</span>
        <h2>Apiary hive</h2>
      </div>
      {#if cell.hive?.hasColony}
        <p class="muted">A colony is active in this hive.</p>
      {:else}
        <div class="notice"><strong>Empty hive</strong><span>Install a colony when one is in inventory.</span></div>
      {/if}
    {:else}
      <div class="detail-heading">
        <span aria-hidden="true">{cell.icon}</span>
        <h2>{cell.plantName}</h2>
      </div>

      {#if cell.harvestable}
        <div class="notice healthy"><strong>Ready for harvest</strong><span>The current crop can be gathered.</span></div>
      {/if}

      {#if cell.preview}
        <div class="harvest-preview">
          <p class="eyebrow">Harvest preview</p>
          <strong>{cell.preview.quantity} ingredient{cell.preview.quantity === 1 ? '' : 's'}</strong>
          {#if cell.preview.hasHiveBonus}
            <span class="hive-bonus">There are signs of recent bee visits this cycle.</span>
          {/if}
        </div>
      {:else}
        <p class="not-ready">This crop is not ready to harvest.</p>
      {/if}
    {/if}

    <section class="observations" aria-label="Garden observations" data-garden-observations>
      <p class="eyebrow">What you notice</p>
      {#if cell.observations?.length}
        <ul>
          {#each cell.observations as observation}
            <li>{observation}</li>
          {/each}
        </ul>
      {:else}
        <p class="muted">No inspection notes are available for this plot yet.</p>
      {/if}
    </section>

    <section class="history" aria-label="Recent plot history" data-garden-history>
      <p class="eyebrow">Recent plot history</p>
      {#if cell.careHistory?.length}
        <ol>
          {#each cell.careHistory as entry}
            <li>
              <strong>Day {entry.dayNumber}</strong>
              <span>{entry.label}</span>
              {#if entry.quantity !== undefined && entry.quantity !== null}
                <small>{entry.quantity} {entry.unit ?? 'units'} applied</small>
              {/if}
            </li>
          {/each}
        </ol>
      {:else}
        <p class="muted">Planting and care notes will appear here as days pass.</p>
      {/if}
    </section>
  {/if}
</section>

<style>
  .detail-card { display: grid; gap: .8rem; }
  .detail-heading { display: flex; align-items: center; gap: .65rem; }
  .detail-heading span { font-size: 1.7rem; }
  .detail-heading h2, .detail-card h2 { margin: 0; }
  .observations, .harvest-preview, .history { display: grid; gap: .55rem; padding-top: .75rem; border-top: 1px solid #3d2e19; }
  .observations ul { display: grid; gap: .45rem; margin: 0; padding-left: 1.1rem; color: #d4c29a; }
  .observations li { font-size: .8rem; line-height: 1.45; }
  .history ol { display: grid; gap: .45rem; max-height: 14rem; overflow-y: auto; margin: 0; padding-left: 1.2rem; color: #d4c29a; }
  .history li { padding-left: .1rem; font-size: .76rem; line-height: 1.4; }
  .history li strong { display: block; color: #d8bc77; font-size: .68rem; }
  .history li span, .history li small { display: block; }
  .history li small { color: #a99671; font-size: .66rem; }
  .notice { display: grid; gap: .2rem; padding: .65rem .75rem; border: 1px solid #67522c; color: #dac79a; background: #1a140a; }
  .notice strong { color: #efd58e; font-family: 'Cinzel',serif; font-size: .76rem; }
  .notice span { font-size: .77rem; line-height: 1.4; }
  .notice.healthy { border-color: #55703c; background: #111a0b; }
  .muted, .not-ready { margin: 0; color: #a99671; font-size: .78rem; line-height: 1.4; }
  .harvest-preview > strong { color: #ebd89e; }
  .harvest-preview span { color: #b9a681; font-size: .74rem; line-height: 1.4; }
  .hive-bonus { color: #b6d78f !important; }
</style>
