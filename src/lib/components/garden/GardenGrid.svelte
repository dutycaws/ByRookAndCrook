<script lang="ts">
  import type { GardenCell } from '$lib/game/contracts';

  let {
    cells,
    selectedId,
    onselect
  }: {
    cells: GardenCell[];
    selectedId: string | null;
    onselect: (cellId: string) => void;
  } = $props();

  function cellLabel(cell: GardenCell): string {
    if (cell.kind === 'empty') return `${cell.layoutKey}, empty garden plot`;
    if (cell.kind === 'beehive') return `${cell.layoutKey}, beehive`;
    return `${cell.layoutKey}, ${cell.plantName}, growth stage ${cell.growthStage}${cell.harvestable ? ', ready to harvest' : ''}`;
  }
</script>

<div class="garden-grid" aria-label="Tavern garden plots">
  <div class="sunwash" aria-hidden="true"></div>
  {#each cells as cell (cell.id)}
    <button
      type="button"
      class="hex-cell {cell.kind}"
      class:selected={cell.id === selectedId}
      class:mature={cell.harvestable}
      style={`--cell-x: ${cell.col * 92 + (cell.row % 2 === 1 ? 46 : 0)}px; --cell-y: ${cell.row * 71}px`}
      aria-label={cellLabel(cell)}
      aria-pressed={cell.id === selectedId}
      onclick={() => onselect(cell.id)}
    >
      <span class="hex-content">
        <span class="cell-icon" aria-hidden="true">
          {cell.kind === 'empty' ? '·' : (cell.icon ?? '🌱')}
        </span>
        <span class="cell-name">
          {cell.kind === 'empty' ? 'Open soil' : cell.kind === 'beehive' ? 'Beehive' : cell.plantName}
        </span>
        {#if cell.kind === 'plant'}
          <span class="cell-stage">Stage {cell.growthStage}/3</span>
        {/if}
      </span>
      {#if cell.harvestable}
        <span class="ready-dot" title="Ready to harvest" aria-hidden="true"></span>
      {/if}
    </button>
  {/each}
</div>
