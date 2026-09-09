<script lang="ts">
  import type { GardenCell } from '$lib/game/contracts';
  import {
    GARDEN_HEX_HEIGHT,
    GARDEN_HEX_WIDTH,
    hexGridBounds,
    oddRHexPosition
  } from '$lib/game/hex';

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

  let bounds = $derived(hexGridBounds(cells));
</script>

<div class="garden-grid-scroll">
  <div
    class="garden-grid"
    aria-label="Tavern garden plots"
    style={`--hex-width: ${GARDEN_HEX_WIDTH}px; --hex-height: ${GARDEN_HEX_HEIGHT}px; width: ${bounds.width}px; height: ${bounds.height}px`}
  >
    <div class="sunwash" aria-hidden="true"></div>
    {#each cells as cell (cell.id)}
      {@const position = oddRHexPosition(cell)}
      <button
        type="button"
        class="hex-cell {cell.kind}"
        class:selected={cell.id === selectedId}
        class:mature={cell.harvestable}
        style={`--cell-x: ${position.x}px; --cell-y: ${position.y}px`}
        data-layout-key={cell.layoutKey}
        data-col={cell.col}
        data-row={cell.row}
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
</div>
