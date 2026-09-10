<script lang="ts">
  import GardenGrid from '$lib/components/garden/GardenGrid.svelte';
  import AreaScene from '$lib/components/scene/AreaScene.svelte';
  import SceneLayer from '$lib/components/scene/SceneLayer.svelte';
  import type { GardenVisualState } from '$lib/presentation/scene';

  let {
    visual,
    onselect,
    harvestEffect = null
  }: {
    visual: GardenVisualState;
    onselect: (cellId: string) => void;
    harvestEffect?: { token: number; cellId: string; plantKey: string; stage: number } | null;
  } = $props();
</script>

<AreaScene area="garden" label="Illustrated tavern courtyard with twelve selectable garden plots" class="garden-scene-frame">
  <SceneLayer src="/assets/scenes/garden-environment.webp" name="garden environment" z={0} essential />
  <div class="garden-light" aria-hidden="true"></div>
  <div class="garden-plane-grid">
    <GardenGrid plots={visual.plots} selectedId={visual.selectedCellId} scale={1.85} {harvestEffect} {onselect} />
  </div>
  <SceneLayer
    src="/assets/scenes/garden/garden-atmosphere.webp"
    name="garden bees and leaves"
    x={922}
    y={180}
    width={620}
    height={330}
    z={4}
    class="garden-atmosphere"
  />
  <SceneLayer
    src="/assets/scenes/garden/garden-foreground.webp"
    name="garden foreground foliage"
    x={0}
    y={611}
    width={960}
    height={330}
    z={5}
    class="garden-foreground"
  />
  {#if visual.status === 'pending'}
    <div class="scene-status pending" aria-hidden="true">Gathering the selected crop…</div>
  {:else if visual.status === 'error'}
    <div class="scene-status error" aria-hidden="true">The harvest result is unresolved. Use the inspector to retry.</div>
  {/if}
</AreaScene>

<style>
  :global(.garden-scene-frame) { margin-top: 1rem; border: 1px solid #725426; box-shadow: inset 0 0 0 1px #120b04; }
  .garden-light { position: absolute; inset: 0; z-index: 1; background: linear-gradient(120deg,#fff1a714,transparent 35%),radial-gradient(ellipse at 51% 49%,transparent 20%,#06100640 86%); pointer-events: none; }
  .garden-plane-grid { position: absolute; left: 538px; top: 138px; z-index: 2; width: 596px; height: 639px; }
  :global(.garden-atmosphere) { animation: garden-drift 6s ease-in-out infinite alternate; opacity: .78; }
  :global(.garden-foreground) { filter: drop-shadow(0 -12px 18px #020401a8); }
  :global([data-area-scene='garden'][data-scene-visible='false'] .garden-atmosphere) { animation-play-state: paused; }
  .scene-status { position: absolute; top: 24px; left: 50%; z-index: 20; transform: translateX(-50%); padding: .55rem .9rem; border: 1px solid #98733b; border-radius: 4px; color: #f3ddb0; background: #151007e8; box-shadow: 0 8px 20px #0008; font-family: 'Cinzel',serif; font-size: 13px; }
  .scene-status.error { border-color: #a8543c; color: #ffd0bd; }
  @keyframes garden-drift { from { transform: translate3d(-4px,2px,0); } to { transform: translate3d(7px,-4px,0); } }
  @media (prefers-reduced-motion: reduce) { :global(.garden-atmosphere) { animation: none; } }
</style>
