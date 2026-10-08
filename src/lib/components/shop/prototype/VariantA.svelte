<script lang="ts">
  import ShopScene from '$lib/components/shop/ShopScene.svelte';
  import OrbitCards from './OrbitCards.svelte';
  import PreviewCard from './PreviewCard.svelte';
  import type { PrototypeModel } from './types';
  let { model }: { model: PrototypeModel } = $props();
</script>

<div class="variant-a">
  <div class="scene"><ShopScene assets={model.assets} detailMode={model.stage === 'preview' || model.stage === 'result'} /></div>
  <div class="left-orbit"><OrbitCards {model} /></div>
  {#if model.stage === 'preview' || model.stage === 'result'}<div class="preview"><PreviewCard {model} /></div>{/if}
  <p class="scene-caption">A · Left orbit under Elara’s portrait</p>
</div>

<style>
  .variant-a { position: relative; height: clamp(370px, calc(100dvh - 292px), 600px); min-height: 0; overflow: hidden; border-radius: 1rem; isolation: isolate; }
  .scene { position: absolute; inset: 0; z-index: 0; }
  .scene :global(.shop-composed-scene) { width: 100%; height: 100%; }
  .scene :global(.area-scene.composed-scene) { width: 100%; height: 100%; min-height: 0; aspect-ratio: auto; border-radius: 1rem; }
  .scene :global(.area-scene-plane) { transform-origin: top left; }
  .left-orbit { position: absolute; z-index: 3; left: -1.2rem; bottom: -.15rem; width: min(36%, 380px); }
  .preview { position: absolute; z-index: 5; right: 1.2rem; bottom: 1.2rem; width: min(570px, 60%); }
  .scene-caption { position: absolute; z-index: 3; right: .8rem; top: .65rem; margin: 0; padding: .35rem .55rem; border: 1px solid rgba(224, 184, 107, .3); border-radius: 999px; color: #d8c59c; background: rgba(20, 14, 8, .72); font-size: .62rem; }
  @media (max-width: 780px) {
    .variant-a { display: flex; height: auto; min-height: 0; overflow: visible; flex-direction: column; gap: .45rem; }
    .scene { position: relative; inset: auto; }
    .scene :global(.shop-composed-scene) { height: auto; }
    .scene :global(.area-scene.composed-scene) { height: auto; min-height: 0; aspect-ratio: 4 / 3; }
    .left-orbit { position: relative; inset: auto; width: 100%; margin-top: -1.1rem; }
    .preview { position: absolute; z-index: 6; left: 50%; right: auto; bottom: 0; width: calc(100% - 1rem); margin: 0; transform: translateX(-50%); }
    .scene-caption { top: .5rem; right: .5rem; }
  }
  @media (prefers-reduced-motion: reduce) { .variant-a * { scroll-behavior: auto; } }
</style>
