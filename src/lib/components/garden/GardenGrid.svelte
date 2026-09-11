<script lang="ts">
  import type { GardenVisualPlot } from '$lib/presentation/scene';
  import {
    GARDEN_HEX_HEIGHT,
    GARDEN_HEX_WIDTH,
    hexGridBounds,
    oddRHexPosition
  } from '$lib/game/hex';

  let {
    plots,
    selectedId,
    scale = 1,
    onselect,
    harvestEffect = null
  }: {
    plots: GardenVisualPlot[];
    selectedId: string | null;
    scale?: number;
    onselect: (cellId: string) => void;
    harvestEffect?: {
      token: number;
      cellId: string;
      plantKey: string;
      stage: number;
    } | null;
  } = $props();

  const supportedCrops = new Set(['hops', 'fennel', 'pepper', 'chamomile', 'tomatoes', 'lavender', 'sage']);
  const plotAsset = '/assets/scenes/garden/garden-plot-base.webp';
  const hiveAsset = '/assets/scenes/garden/garden-beehive.webp';
  let failedAssets = $state<Set<string>>(new Set());

  function cellLabel(cell: GardenVisualPlot): string {
    if (cell.kind === 'empty') return `${cell.layoutKey}, empty garden plot`;
    if (cell.kind === 'beehive') return `${cell.layoutKey}, beehive`;
    return `${cell.layoutKey}, ${cell.plantName}, growth stage ${cell.stage}${cell.harvestable ? ', ready to harvest' : ''}`;
  }

  function cropAsset(plantKey: string | null, stage: number | null): string | null {
    if (!plantKey || !supportedCrops.has(plantKey) || stage === null || stage < 1 || stage > 3) return null;
    return `/assets/scenes/garden/garden-crop-${plantKey}-stage-${stage}.webp`;
  }

  function markFailed(path: string) {
    failedAssets = new Set([...failedAssets, path]);
  }

  function moveFocus(event: KeyboardEvent, cell: GardenVisualPlot) {
    const delta = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    }[event.key];
    if (!delta) return;

    const target = plots.find((plot) => plot.col === cell.col + delta[0] && plot.row === cell.row + delta[1]);
    if (!target) return;
    const grid = (event.currentTarget as HTMLElement).closest('[data-garden-grid]');
    event.preventDefault();
    onselect(target.id);
    requestAnimationFrame(() => {
      grid?.querySelector<HTMLElement>(`[data-cell-id="${target.id}"]`)?.focus();
    });
  }

  let bounds = $derived(hexGridBounds(plots));
</script>

<div class="garden-grid-scroll" data-garden-board>
  <div
    class="garden-grid"
    data-garden-grid
    role="group"
    aria-label={`Tavern garden, ${plots.length} unlocked plots`}
    style={`--hex-width: ${GARDEN_HEX_WIDTH * scale}px; --hex-height: ${GARDEN_HEX_HEIGHT * scale}px; width: ${bounds.width * scale}px; height: ${bounds.height * scale}px`}
  >
    <div class="sunwash" aria-hidden="true"></div>
    {#each plots as cell (cell.id)}
      {@const position = oddRHexPosition(cell)}
      {@const path = cropAsset(cell.plantKey, cell.stage)}
      <div
        class="plot-node {cell.kind}"
        class:selected={cell.id === selectedId}
        style={`--cell-x: ${position.x * scale}px; --cell-y: ${position.y * scale}px; --plot-z: ${cell.row}`}
      >
        <div class="plot-art" aria-hidden="true">
          {#if !failedAssets.has(plotAsset)}
            <img class="plot-base" src={plotAsset} alt="" draggable="false" onerror={() => markFailed(plotAsset)} />
          {:else}
            <span class="plot-base-fallback" data-plot-fallback></span>
          {/if}
          {#if cell.kind === 'beehive'}
            {#if !failedAssets.has(hiveAsset)}
              <img class="hive-art" src={hiveAsset} alt="" draggable="false" onerror={() => markFailed(hiveAsset)} />
            {:else}
              <span class="hive-fallback" data-hive-fallback>Apiary</span>
            {/if}
          {:else if cell.kind === 'plant' && path && !failedAssets.has(path)}
            <img class="crop-art" src={path} alt="" draggable="false" onerror={() => markFailed(path)} />
          {:else if cell.kind === 'plant'}
            <span class="crop-fallback" data-crop-fallback={cell.plantKey}>{cell.plantKey === 'clover' ? '☘' : '✿'}</span>
          {/if}
          {#if harvestEffect?.cellId === cell.id}
            {@const effectPath = cropAsset(harvestEffect.plantKey, harvestEffect.stage)}
            {#if effectPath}
              {#key harvestEffect.token}
                <img class="harvest-ghost" data-harvest-effect src={effectPath} alt="" draggable="false" />
              {/key}
            {/if}
          {/if}
        </div>
        <button
          type="button"
          class="hex-cell {cell.kind}"
          class:selected={cell.id === selectedId}
          class:mature={cell.harvestable}
          data-layout-key={cell.layoutKey}
          data-garden-cell
          data-cell-id={cell.id}
          data-unlocked="true"
          data-col={cell.col}
          data-row={cell.row}
          aria-label={cellLabel(cell)}
          aria-pressed={cell.id === selectedId}
          onclick={() => onselect(cell.id)}
          onkeydown={(event) => moveFocus(event, cell)}
        >
          <span class="visually-hidden">{cellLabel(cell)}</span>
          {#if cell.harvestable}
            <span class="ready-dot" title="Ready to harvest" aria-hidden="true"></span>
          {/if}
        </button>
      </div>
    {/each}
  </div>
</div>

<style>
  .garden-grid-scroll { width: 100%; min-width: min-content; height: 100%; overflow: visible; padding: 12px; }
  .garden-grid { position: relative; margin: 0; filter: drop-shadow(0 18px 24px #0008); }
  .sunwash { position: absolute; inset: -75px; background: radial-gradient(circle, #f1c7681c, transparent 58%); pointer-events: none; }
  .plot-node { position: absolute; top: var(--cell-y); left: var(--cell-x); width: var(--hex-width); height: var(--hex-height); z-index: calc(3 + var(--plot-z)); }
  .plot-node.selected { z-index: 90; }
  .plot-art { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
  .plot-base { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; filter: drop-shadow(0 7px 7px #0008); transition: filter 140ms ease; }
  .plot-base-fallback { position: absolute; inset: 3%; background: radial-gradient(ellipse at 50% 45%,#32200f 0 55%,#1a1008 56% 66%,#746442 67% 72%,transparent 73%); clip-path: polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%); filter: drop-shadow(0 7px 7px #0008); }
  .crop-art, .harvest-ghost { position: absolute; left: -14%; top: -38%; width: 128%; height: 140%; object-fit: contain; object-position: center bottom; filter: drop-shadow(0 9px 6px #0008); }
  .hive-art { position: absolute; left: -34%; top: -47%; width: 168%; height: 150%; object-fit: contain; object-position: center bottom; filter: drop-shadow(0 11px 8px #0009); }
  .hive-fallback { position: absolute; left: 9%; right: 9%; bottom: 19%; display: grid; min-height: 46%; place-items: center; border: 3px solid #79613b; color: #d5ad5f; background: repeating-linear-gradient(0deg,#432d16 0 12px,#614322 13px 15px); box-shadow: 0 8px 10px #0008; font-family: 'Cinzel',serif; font-size: calc(var(--hex-width) * .08); }
  .crop-fallback { position: absolute; inset: 22% 16% 17%; display: grid; place-items: center; color: #9cab64; font-size: calc(var(--hex-width) * .34); text-shadow: 0 4px 8px #000; }
  .garden-grid .hex-cell { position: absolute; inset: 0; z-index: 4; width: 100%; height: 100%; padding: 0; border: 0; color: transparent; background: transparent; clip-path: polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%); cursor: pointer; transform: none; }
  .garden-grid .hex-cell::before { display: none; content: none; }
  .hex-cell::after { position: absolute; inset: 3px; padding: 4px; background: #f2c75a; clip-path: inherit; content: ''; opacity: 0; -webkit-mask: linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); mask: linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
  .hex-cell:hover::after, .hex-cell.selected::after { opacity: 1; }
  .hex-cell:hover + *, .plot-node:has(.hex-cell:hover) .plot-base, .plot-node.selected .plot-base { filter: drop-shadow(0 0 8px #efc75b) drop-shadow(0 7px 7px #0008); }
  .hex-cell:focus-visible { outline: none; filter: drop-shadow(0 0 6px #fff3bd) drop-shadow(0 0 2px #241402); }
  .hex-cell:focus-visible::after { opacity: 1; background: #fff2ad; }
  .ready-dot { position: absolute; top: 15%; right: 19%; width: 9px; height: 9px; border: 1px solid #e9f6b9; border-radius: 50%; background: #9bd265; box-shadow: 0 0 10px #91cf58; }
  .harvest-ghost { z-index: 5; animation: harvest-lift 620ms ease-out both; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  @keyframes harvest-lift { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(-70px) scale(.9); } }
  @media (prefers-reduced-motion: reduce) { .harvest-ghost { animation: none; opacity: 0; } }
</style>
