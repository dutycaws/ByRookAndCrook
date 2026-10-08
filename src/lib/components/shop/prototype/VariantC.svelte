<script lang="ts">
  import ShopScene from '$lib/components/shop/ShopScene.svelte';
  import CardFan from './CardFan.svelte';
  import PreviewCard from './PreviewCard.svelte';
  import type { PrototypeModel } from './types';
  let { model }: { model: PrototypeModel } = $props();
</script>

<div class="variant-c">
  <div class="scene"><ShopScene assets={model.assets} detailMode={model.stage === 'preview' || model.stage === 'result'} /></div>
  <div class="hand"><CardFan {model} /></div>
  {#if model.stage === 'preview' || model.stage === 'result'}<div class="preview"><PreviewCard {model} /></div>{/if}
  <p class="scene-caption">C · An ember-marked hand across the counter</p>
</div>

<style>
  .variant-c { position: relative; height: clamp(370px, calc(100dvh - 292px), 600px); min-height: 0; overflow: hidden; border-radius: 1rem; isolation: isolate; }
  .scene { position: absolute; inset: 0; z-index: 0; }
  .scene :global(.shop-composed-scene) { width: 100%; height: 100%; }
  .scene :global(.area-scene.composed-scene) { width: 100%; height: 100%; min-height: 0; aspect-ratio: auto; border-radius: 1rem; }
  .scene :global(.area-scene-plane) { top: -120px; transform-origin: top left; }
  .hand { position: absolute; z-index: 3; left: 0; right: 0; bottom: .15rem; }
  .preview { position: absolute; z-index: 6; left: 50%; bottom: 205px; width: min(570px, 70%); transform: translateX(-50%); }
  .scene-caption { position: absolute; z-index: 3; right: .8rem; top: .65rem; margin: 0; padding: .35rem .55rem; border: 1px solid rgba(224, 184, 107, .3); border-radius: 999px; color: #d8c59c; background: rgba(20, 14, 8, .72); font-size: .62rem; }
  @media (max-width: 780px) {
    .variant-c { display: flex; height: auto; min-height: 0; overflow: visible; flex-direction: column; gap: .15rem; }
    .scene { position: relative; inset: auto; }
    .scene :global(.shop-composed-scene) { height: auto; }
    .scene :global(.area-scene.composed-scene) { height: auto; min-height: 0; aspect-ratio: 4 / 3; }
    .scene :global(.area-scene-plane) { top: 0; }
    .hand { position: relative; inset: auto; margin-top: -1.15rem; }
    .preview { position: absolute; left: 50%; bottom: 0; width: calc(100% - 1rem); margin: 0; transform: translateX(-50%); }
  }
</style>
