<script lang="ts">
  import { qualityLabel, type GardenCell } from '$lib/game/contracts';

  let { cell }: { cell: GardenCell | null } = $props();

  function titleCase(value: string) {
    return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function condition(value: number) {
    if (value >= 75) return 'Strong';
    if (value >= 45) return 'Watch';
    return 'Threatened';
  }
</script>

<section class="detail-card" data-garden-inspector aria-live="polite">
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
      {#if cell.hive}
        <dl class="stats compact-stats" data-apiary-inspector>
          <div><dt>Equipment</dt><dd>{cell.hive.equipmentCondition}% · {condition(cell.hive.equipmentCondition)}</dd></div>
          <div><dt>Colony</dt><dd>{cell.hive.hasColony ? 'Installed' : 'Empty'}</dd></div>
        </dl>
        {#if cell.hive.colony}
          {@const colony = cell.hive.colony}
          <dl class="stats colony-stats">
            <div><dt>Adults</dt><dd>{colony.adults.toLocaleString()}</dd></div>
            <div><dt>Brood</dt><dd>{colony.brood.toLocaleString()}</dd></div>
            <div><dt>Health</dt><dd>{colony.health}% · {condition(colony.health)}</dd></div>
            <div><dt>Food stores</dt><dd>{colony.foodStores}</dd></div>
            <div><dt>Purchased feed</dt><dd>{colony.feedStores ?? 0}</dd></div>
            <div><dt>Floral honey</dt><dd>{colony.floralHoney}</dd></div>
            <div><dt>Protected reserve</dt><dd>{colony.protectedReserve}</dd></div>
            <div><dt>Safe surplus</dt><dd>{colony.extractableSurplus}</dd></div>
          </dl>
          <div class="pressure-panel" aria-label="Colony health pressures">
            <p class="eyebrow">Health pressures</p>
            <div class="pressure-grid">
              <span>Varroa <strong>{colony.varroaPressure}</strong></span>
              <span>Chalkbrood <strong>{colony.chalkbroodPressure}</strong></span>
              <span>Nosema <strong>{colony.nosemaPressure}</strong></span>
            </div>
          </div>
          {#if colony.treatmentKey}
            <div class="notice warning" role="status">
              <strong>{titleCase(colony.treatmentKey)} active</strong>
              <span>{colony.treatmentDaysRemaining} day{colony.treatmentDaysRemaining === 1 ? '' : 's'} remaining. {colony.treatmentTradeoff === 'no-honey-production-or-extraction' ? 'Honey production and extraction are paused.' : ''}</span>
            </div>
          {/if}
          {#if colony.threatDays}
            <div class="notice danger" role="alert"><strong>Colony at risk</strong><span>Threatened for {colony.threatDays} day{colony.threatDays === 1 ? '' : 's'}.</span></div>
          {/if}
          {#if colony.symptoms?.length}
            <div class="symptoms">
              <p class="eyebrow">Observed symptoms</p>
              <ul>
                {#each colony.symptoms as symptom}
                  <li data-garden-symptom data-severity={symptom.severity}>
                    <strong>{symptom.label}</strong><span>{symptom.cause}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        {:else}
          <div class="notice"><strong>Equipment is available</strong><span>Install a colony when one is in inventory.</span></div>
        {/if}
      {/if}
    {:else}
      <div class="detail-heading">
        <span aria-hidden="true">{cell.icon}</span>
        <h2>{cell.plantName}</h2>
      </div>

      {#if cell.plant}
        <dl class="stats compact-stats">
          <div><dt>Lifecycle</dt><dd>{titleCase(cell.plant.lifecycle)}</dd></div>
          <div><dt>Growth</dt><dd>{cell.plant.growthProgress}%</dd></div>
          <div><dt>Health</dt><dd>{cell.plant.health}% · {condition(cell.plant.health)}</dd></div>
          <div><dt>Cycle quality</dt><dd>{qualityLabel(cell.plant.qualityIndex)}</dd></div>
          <div><dt>Age</dt><dd>{cell.plant.ageDays} day{cell.plant.ageDays === 1 ? '' : 's'}</dd></div>
          <div><dt>Production cycle</dt><dd>{cell.plant.productionCycle}</dd></div>
          <div><dt>Flowering</dt><dd>{cell.plant.floweringDaysRemaining > 0 ? `${cell.plant.floweringDaysRemaining} days remain` : 'Not flowering'}</dd></div>
        </dl>
        {#if cell.plant.symptoms.length}
          <div class="symptoms">
            <p class="eyebrow">Diagnosed symptoms</p>
            <ul>
              {#each cell.plant.symptoms as symptom}
                <li data-garden-symptom data-severity={symptom.severity}>
                  <strong>{symptom.label}</strong><span>{symptom.cause}</span>
                </li>
              {/each}
            </ul>
          </div>
        {:else}
          <div class="notice healthy"><strong>No active stress</strong><span>Current care is within this crop’s supported range.</span></div>
        {/if}
      {/if}

      {#if cell.preview}
        <div class="harvest-preview">
          <p class="eyebrow">Harvest preview</p>
          <strong>{cell.preview.quantity} × {qualityLabel(cell.preview.qualityIndex)}</strong>
          <span>Brew +{cell.preview.brewBonus} · Bake +{cell.preview.bakeBonus} per unit</span>
          {#if cell.preview.hasHiveBonus}
            <span class="hive-bonus">Pollination contributed across this production cycle.</span>
          {/if}
          {#if cell.plant?.floweringDaysRemaining}
            <span>Waiting preserves forage for {cell.plant.floweringDaysRemaining} more day{cell.plant.floweringDaysRemaining === 1 ? '' : 's'}, but late harvest can reduce yield or quality.</span>
          {/if}
        </div>
      {:else}
        <p class="not-ready">This production cycle is not ready to harvest.</p>
      {/if}
    {/if}

    {#if cell.soil}
      <div class="soil-panel" data-soil-diagnostic>
        <p class="eyebrow">Soil and exposure</p>
        <dl class="soil-grid">
          <div><dt>Nitrogen</dt><dd>{cell.soil.n}</dd></div>
          <div><dt>Phosphorus</dt><dd>{cell.soil.p}</dd></div>
          <div><dt>Potassium</dt><dd>{cell.soil.k}</dd></div>
          <div><dt>Moisture</dt><dd>{cell.soil.moisture}</dd></div>
          <div><dt>Soil quality</dt><dd>{cell.soil.quality}</dd></div>
          <div><dt>Site light</dt><dd>{cell.soil.siteLight}</dd></div>
        </dl>
      </div>
    {/if}
  {/if}
</section>

<style>
  .detail-card { display: grid; gap: .8rem; }
  .detail-heading { display: flex; align-items: center; gap: .65rem; }
  .detail-heading span { font-size: 1.7rem; }
  .detail-heading h2, .detail-card h2 { margin: 0; }
  .stats, .soil-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 1px; margin: 0; border: 1px solid #5e4725; background: #5e4725; }
  .stats div, .soil-grid div { display: grid; gap: .2rem; padding: .55rem .6rem; background: #120e08; }
  dt { color: #9c8357; font-size: .68rem; letter-spacing: .08em; text-transform: uppercase; }
  dd { margin: 0; color: #ead7aa; font-size: .86rem; }
  .colony-stats { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .soil-panel, .pressure-panel, .symptoms, .harvest-preview { display: grid; gap: .55rem; padding-top: .75rem; border-top: 1px solid #3d2e19; }
  .soil-grid { grid-template-columns: repeat(3,minmax(0,1fr)); }
  .pressure-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: .35rem; }
  .pressure-grid span { display: grid; gap: .2rem; padding: .45rem; border: 1px solid #594322; color: #ae9567; font-size: .68rem; text-align: center; }
  .pressure-grid strong { color: #e6c97f; font-size: 1rem; }
  .notice { display: grid; gap: .2rem; padding: .65rem .75rem; border: 1px solid #67522c; color: #dac79a; background: #1a140a; }
  .notice strong { color: #efd58e; font-family: 'Cinzel',serif; font-size: .76rem; }
  .notice span { font-size: .77rem; line-height: 1.4; }
  .notice.warning { border-color: #ac7d27; background: #261c08; }
  .notice.danger { border-color: #a45139; background: #26110b; }
  .notice.healthy { border-color: #55703c; background: #111a0b; }
  .symptoms ul { display: grid; gap: .45rem; margin: 0; padding: 0; list-style: none; }
  .symptoms li { display: grid; gap: .15rem; padding-left: .65rem; border-left: 3px solid #98713a; }
  .symptoms li[data-severity='critical'] { border-left-color: #c45f42; }
  .symptoms li[data-severity='warning'] { border-left-color: #d39b37; }
  .symptoms strong { color: #e5c985; font-size: .78rem; }
  .symptoms span, .harvest-preview span { color: #b9a681; font-size: .74rem; line-height: 1.4; }
  .harvest-preview > strong { color: #ebd89e; }
  .hive-bonus { color: #b6d78f !important; }
  .not-ready { margin: 0; color: #a99671; font-size: .78rem; }
  @media (max-width: 370px) { .soil-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
</style>
