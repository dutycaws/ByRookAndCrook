<script lang="ts">
  import ComposedScene, { type SceneRuntimeAsset } from '$lib/components/scene/ComposedScene.svelte';
  import { getSceneComposition } from '$lib/presentation/scene-composition';

  type Props = {
    /**
     * Runtime media stays at the edge of the presentation layer. The stable
     * scene contract supplies the keys; local fixture storage supplies URLs.
     */
    assets?: Record<string, SceneRuntimeAsset | undefined>;
    detailMode?: boolean;
  };

  let { assets = {}, detailMode = false }: Props = $props();

  const composition = getSceneComposition('shop');
</script>

<div class:detail-mode={detailMode} class="shop-composed-scene" data-shop-scene data-shop-scene-persistent="true">
  <ComposedScene
    {composition}
    {assets}
    actorNames={{ 'shop-elara': 'Elara Greenbloom' }}
    class="shop-scene-compositor"
  />
</div>

<style>
  .shop-composed-scene {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    min-height: 0;
    max-width: none;
    margin: 0;
    overflow: hidden;
    background: #140d06;
    isolation: isolate;
  }
  .shop-composed-scene :global(.composed-scene) {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 100%;
  }
  .shop-composed-scene :global([data-scene-composition='shop']) {
    width: 100%;
    min-width: 100%;
    height: 100%;
  }
  .shop-composed-scene :global([data-scene-actor='shop-elara']) { border-radius: 50%; }
  .shop-composed-scene :global([data-scene-actor='shop-elara']:focus-visible) { outline-offset: -7px; }
  .detail-mode { box-shadow: inset 0 0 0 1px #bd9140; }
  @media (max-width: 799px) {
    .shop-composed-scene { max-width: none; margin: 0; }
  }
</style>
