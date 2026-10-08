<script lang="ts">
  import ShopScene from '$lib/components/shop/ShopScene.svelte';
  import OrbitCards from './OrbitCards.svelte';
  import PreviewCard from './PreviewCard.svelte';
  import type { PrototypeModel } from './types';
  let { model }: { model: PrototypeModel } = $props();
</script>

<div class="variant-b">
  <div class="scene"><ShopScene assets={model.assets} detailMode={model.stage === 'preview' || model.stage === 'result'} /></div>
  <aside class="orbit-rail">
    <OrbitCards {model} />
    {#if model.stage === 'preview' || model.stage === 'result'}<div class="preview"><PreviewCard {model} /></div>{/if}
  </aside>
  <p class="scene-caption">B · Unobstructed scene with a right-side orbit</p>
</div>

<style>
  .variant-b { position: relative; height: clamp(370px, calc(100dvh - 292px), 600px); min-height: 0; overflow: hidden; border-radius: 1rem; isolation: isolate; background: radial-gradient(ellipse at 42% 42%, rgba(97, 65, 32, .24), transparent 64%); }
  .scene { position: absolute; inset: 0; z-index: 0; }
  .scene :global(.shop-composed-scene) { width: 100%; height: 100%; }
  .scene :global(.area-scene.composed-scene) { width: 100%; height: 100%; min-height: 0; aspect-ratio: auto; border-radius: 1rem; }
  .scene :global(.area-scene-plane) { transform-origin: top left; }
  .orbit-rail { position: absolute; z-index: 2; inset: 0 0 0 auto; display: grid; width: min(40%, 470px); min-width: 330px; place-items: center; background: linear-gradient(90deg, rgba(18, 12, 7, 0), rgba(18, 12, 7, .22) 18%, rgba(18, 12, 7, .88) 100%); }
  .preview { position: absolute; z-index: 5; inset: .55rem; display: grid; align-content: center; padding: .35rem; background: linear-gradient(90deg, rgba(18, 12, 7, .08), rgba(18, 12, 7, .82) 18%, rgba(18, 12, 7, .92)); }
  .scene-caption { position: absolute; left: .65rem; top: .6rem; margin: 0; padding: .35rem .55rem; border: 1px solid rgba(224, 184, 107, .3); border-radius: 999px; color: #d8c59c; background: rgba(20, 14, 8, .72); font-size: .62rem; }
  @media (max-width: 850px) {
    .variant-b { display: flex; height: auto; min-height: 0; overflow: visible; flex-direction: column; gap: 0; }
    .scene { position: relative; inset: auto; }
    .scene :global(.shop-composed-scene) { height: auto; }
    .scene :global(.area-scene.composed-scene) { height: auto; aspect-ratio: 4 / 3; }
    .orbit-rail { position: relative; inset: auto; width: 100%; min-width: 0; min-height: 310px; margin-top: -.7rem; background: none; }
    .orbit-rail :global(.orbit-deck) { width: min(100%, 340px); }
    .preview { position: absolute; z-index: 5; inset: 0; display: grid; width: calc(100% - 1rem); margin: 0 auto; padding: .35rem; align-content: center; background: linear-gradient(90deg, rgba(18, 12, 7, .08), rgba(18, 12, 7, .82) 18%, rgba(18, 12, 7, .92)); }
  }
</style>
