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
    min-width: 0;
    overflow: hidden;
    border: 1px solid #6b4e24;
    background: radial-gradient(circle at 50% 30%, #6c4b25, #1c1209 64%, #090603);
    view-transition-name: shop-merchant;
  }
  .shop-composed-scene :global(.composed-scene) { display: block; width: 100%; }
  .shop-composed-scene :global([data-scene-composition='shop']) { min-width: 100%; }
  .shop-composed-scene :global([data-scene-actor='shop-elara']) { border-radius: 50%; }
  .shop-composed-scene :global([data-scene-actor='shop-elara']:focus-visible) { outline-offset: -7px; }
  .detail-mode { box-shadow: inset 0 0 0 1px #bd9140; }

  @media (max-width: 799px) {
    .shop-composed-scene { max-width: 48rem; margin-inline: auto; }
  }
</style>
