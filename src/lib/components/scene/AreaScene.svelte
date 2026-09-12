<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { SCENE_DESIGN_SIZE, type SceneTransform } from '$lib/presentation/scene';

  type Area = 'garden' | 'brewery' | 'bakery' | 'shop';
  type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
    area: Area;
    label: string;
    children: Snippet;
    element?: HTMLDivElement;
    transform?: SceneTransform;
    fallback?: string | null;
    onvisibility?: (visible: boolean) => void;
  };

  let {
    area,
    label,
    children,
    element = $bindable(),
    transform = $bindable({ scale: 1, offsetX: 0, offsetY: 0 }),
    fallback = null,
    onvisibility,
    class: className = '',
    ...attributes
  }: Props = $props();

  let visible = $state(true);
  let reducedMotion = $state(false);
  let transformReady = $state(false);

  onMount(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let readyFrame = 0;
    const resize = new ResizeObserver(([entry]) => {
      const bounds = entry.contentRect;
      const sceneFirstPhone = bounds.width <= 620;
      const scale = sceneFirstPhone
        ? bounds.height / SCENE_DESIGN_SIZE.height
        : bounds.width / SCENE_DESIGN_SIZE.width;
      transform = {
        scale,
        offsetX: sceneFirstPhone ? (bounds.width - SCENE_DESIGN_SIZE.width * scale) / 2 : 0,
        offsetY: 0
      };
      transformReady = false;
      cancelAnimationFrame(readyFrame);
      readyFrame = requestAnimationFrame(() => {
        readyFrame = requestAnimationFrame(() => (transformReady = true));
      });
    });
    const updateVisibility = () => {
      visible = document.visibilityState === 'visible';
      onvisibility?.(visible);
    };
    const updateMotion = () => (reducedMotion = media.matches);
    if (element) resize.observe(element);
    updateVisibility();
    updateMotion();
    document.addEventListener('visibilitychange', updateVisibility);
    media.addEventListener('change', updateMotion);
    return () => {
      cancelAnimationFrame(readyFrame);
      resize.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
      media.removeEventListener('change', updateMotion);
    };
  });
</script>

<div
  {...attributes}
  bind:this={element}
  class="area-scene {className}"
  data-area-scene={area}
  data-scene-visible={visible}
  data-reduced-motion={reducedMotion}
  data-scene-scale={transform.scale}
  data-scene-offset-x={transform.offsetX}
  data-scene-offset-y={transform.offsetY}
  data-scene-ready={transformReady}
  aria-busy={!transformReady}
  role="group"
  aria-label={label}
>
  <div
    class="area-scene-plane"
    inert={!transformReady}
    style={`width:${SCENE_DESIGN_SIZE.width}px;height:${SCENE_DESIGN_SIZE.height}px;transform:translate(${transform.offsetX}px,${transform.offsetY}px) scale(${transform.scale})`}
  >
    {@render children()}
  </div>
  {#if fallback}
    <div class="scene-fallback" role="status">
      <strong>Scene artwork unavailable</strong>
      <span>{fallback}</span>
    </div>
  {/if}
</div>

<style>
  .area-scene {
    position: relative;
    width: 100%;
    aspect-ratio: 1672 / 941;
    overflow: hidden;
    isolation: isolate;
    background: #0a0704;
  }
  @media (max-width: 620px) {
    .area-scene { aspect-ratio: 4 / 3; }
  }
  .area-scene-plane {
    position: absolute;
    top: 0;
    left: 0;
    overflow: hidden;
    transform-origin: top left;
  }
  .area-scene[data-scene-ready='false'] .area-scene-plane { pointer-events: none; }
  .scene-fallback {
    position: absolute;
    inset: 0;
    z-index: 100;
    display: grid;
    place-content: center;
    gap: .35rem;
    padding: 2rem;
    color: #ead8a6;
    background: radial-gradient(circle at 50% 35%, #4b3118, #100b06 68%);
    text-align: center;
  }
  .scene-fallback strong { font-family: 'Cinzel', serif; }
</style>
