<script lang="ts">
  import { onMount } from 'svelte';
  import AreaScene from '$lib/components/scene/AreaScene.svelte';
  import type {
    SceneActorDefinition,
    SceneComposition,
    SceneDecorDefinition
  } from '$lib/presentation/scene-composition';
  import { isSceneActorInteractive } from '$lib/presentation/scene-composition';
  import {
    calculateSceneParallax,
    SETTLED_SCENE_PARALLAX,
    type SceneParallaxOffset
  } from '$lib/game/scene-parallax';

  export interface SceneRuntimeAsset {
    src: string | null;
    alt?: string;
  }

  type Props = {
    composition: SceneComposition;
    /** Routes may add validated community actors without changing the scene plane. */
    actors?: readonly SceneActorDefinition[];
    assets?: Record<string, SceneRuntimeAsset | undefined>;
    actorNames?: Record<string, string | undefined>;
    selectedActorKey?: string | null;
    focusedActorKey?: string | null;
    departingActorKey?: string | null;
    disabled?: boolean;
    class?: string;
    onactorselect?: (actorKey: string) => void;
    onactorfocus?: (actorKey: string) => void;
    onassetfailure?: (assetKey: string) => void;
  };

  let {
    composition,
    actors,
    assets = {},
    actorNames = {},
    selectedActorKey = null,
    focusedActorKey = null,
    departingActorKey = null,
    disabled = false,
    class: className = '',
    onactorselect,
    onactorfocus,
    onassetfailure
  }: Props = $props();

  let sceneElement = $state<HTMLDivElement>();
  let finePointer = $state(false);
  let reducedMotion = $state(false);
  let visible = $state(true);
  let hovering = $state(false);
  let parallax = $state<SceneParallaxOffset>(SETTLED_SCENE_PARALLAX);
  let failedAssets = $state(new Set<string>());
  let compact = $state(false);
  let sceneActors = $derived(actors ?? composition.actors);
  let retainedActors = $state<SceneActorDefinition[]>([]);
  let previousActors: readonly SceneActorDefinition[] = [];
  let departureTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let displayedActors = $derived([
    ...sceneActors,
    ...retainedActors.filter((actor) => !sceneActors.some((current) => current.key === actor.key))
  ]);
  let interactiveActors = $derived(isSceneActorInteractive(onactorselect));

  function runtimeAsset(key: string) {
    const asset = assets[key];
    return asset && !failedAssets.has(key) ? asset : null;
  }

  function placementStyle(layer: SceneDecorDefinition | SceneActorDefinition) {
    const placement = compact ? layer.compact : layer;
    return `left:${placement.x}px;top:${placement.y}px;width:${placement.width}px;height:${placement.height}px;z-index:${layer.depth}`;
  }

  /** Hit targets track an actor's compact scale while its illustration stays full size. */
  function actorHitStyle(actor: SceneActorDefinition) {
    const placement = compact ? actor.compact : actor;
    const xRatio = (actor.hitBounds.x - actor.x) / actor.width;
    const yRatio = (actor.hitBounds.y - actor.y) / actor.height;
    return `left:${placement.x + placement.width * xRatio}px;top:${placement.y + placement.height * yRatio}px;`
      + `width:${placement.width * actor.hitBounds.width / actor.width}px;height:${placement.height * actor.hitBounds.height / actor.height}px;z-index:${actor.depth}`;
  }

  function actorArtStyle(actor: SceneActorDefinition) {
    return `left:${(actor.x - actor.hitBounds.x) / actor.hitBounds.width * 100}%;top:${(actor.y - actor.hitBounds.y) / actor.hitBounds.height * 100}%;`
      + `width:${actor.width / actor.hitBounds.width * 100}%;height:${actor.height / actor.hitBounds.height * 100}%;`;
  }

  function parallaxStyle(layer: SceneDecorDefinition | SceneActorDefinition) {
    const factor = layer.kind === 'background' ? .45 : layer.kind === 'foreground' ? 1 : .72;
    return `transform:translate(${parallax.x * factor}px,${parallax.y * factor}px)`;
  }

  function failed(key: string) {
    failedAssets = new Set([...failedAssets, key]);
    onassetfailure?.(key);
  }

  function updateParallax(event: PointerEvent) {
    if (!sceneElement) return;
    parallax = calculateSceneParallax({
      clientX: event.clientX,
      clientY: event.clientY,
      bounds: sceneElement.getBoundingClientRect(),
      finePointer,
      hovering,
      reducedMotion,
      documentVisible: visible
    });
  }

  function settleParallax() {
    hovering = false;
    parallax = SETTLED_SCENE_PARALLAX;
  }

  function selectActor(actor: SceneActorDefinition) {
    if (!disabled && departingActorKey !== actor.key) onactorselect?.(actor.key);
  }

  function actorKeydown(event: KeyboardEvent, index: number) {
    const count = sceneActors.length;
    if (!count || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
      : (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + count) % count;
    sceneElement?.querySelector<HTMLButtonElement>(`[data-scene-actor-index="${next}"]`)?.focus();
  }

  onMount(() => {
    const fine = matchMedia('(pointer: fine) and (hover: hover)');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const updateFine = () => { finePointer = fine.matches; if (!finePointer) settleParallax(); };
    const updateMotion = () => { reducedMotion = motion.matches; if (reducedMotion) settleParallax(); };
    const updateVisibility = () => {
      visible = document.visibilityState === 'visible';
      if (!visible) settleParallax();
    };
    const resize = new ResizeObserver(([entry]) => {
      compact = entry.contentRect.width <= 620;
    });
    updateFine();
    updateMotion();
    updateVisibility();
    fine.addEventListener('change', updateFine);
    motion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    if (sceneElement) resize.observe(sceneElement);
    return () => {
      fine.removeEventListener('change', updateFine);
      motion.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
      resize.disconnect();
      departureTimers.forEach((timer) => clearTimeout(timer));
    };
  });

  $effect(() => {
    const nextActors = sceneActors;
    const activeKeys = new Set(nextActors.map((actor) => actor.key));
    const removed = previousActors.filter((actor) => !activeKeys.has(actor.key));
    previousActors = nextActors;
    if (!removed.length) return;
    if (reducedMotion) {
      retainedActors = retainedActors.filter((actor) => !removed.some((candidate) => candidate.key === actor.key));
      return;
    }
    retainedActors = [...retainedActors.filter((actor) => !removed.some((candidate) => candidate.key === actor.key)), ...removed];
    for (const actor of removed) {
      clearTimeout(departureTimers.get(actor.key));
      departureTimers.set(actor.key, setTimeout(() => {
        retainedActors = retainedActors.filter((candidate) => candidate.key !== actor.key);
        departureTimers.delete(actor.key);
      }, 300));
    }
  });
</script>

<AreaScene
  bind:element={sceneElement}
  area={composition.id}
  label={`${composition.id} illustrated scene`}
  designSize={composition.plane}
  class={`composed-scene ${className}`}
  onpointerenter={() => (hovering = true)}
  onpointerleave={settleParallax}
  onpointermove={updateParallax}
>
  {@const background = runtimeAsset(composition.background.key)}
  <div class="scene-composition" data-scene-composition={composition.id} data-scene-version={composition.version}>
    {#if background}
      <img class="scene-image scene-background" src={background.src ?? ''} alt={background.alt ?? composition.background.alt}
        draggable="false" style={`${placementStyle(composition.background)};${parallaxStyle(composition.background)}`}
        onerror={() => failed(composition.background.key)} />
    {:else}
      <div class="scene-art-fallback scene-background" role="img" aria-label={`${composition.background.alt} artwork unavailable`}
        style={`${placementStyle(composition.background)};${parallaxStyle(composition.background)}`}>
        <span>Scene artwork unavailable</span>
      </div>
    {/if}

    <div class="scene-actors" role="group" aria-label="Scene characters">
      {#each displayedActors as actor, index (actor.key)}
        {@const asset = runtimeAsset(actor.key)}
        {@const departing = departingActorKey === actor.key || !sceneActors.some((current) => current.key === actor.key)}
        {#if interactiveActors && !departing}
        <button
          class:selected={selectedActorKey === actor.key}
          class:departing={departing}
          class="scene-actor"
          type="button"
          tabindex={focusedActorKey && sceneActors.some((candidate) => candidate.key === focusedActorKey)
            ? (focusedActorKey === actor.key ? 0 : -1)
            : (index === 0 ? 0 : -1)}
          aria-label={actorNames[actor.key] ? `${actor.label}: ${actorNames[actor.key]}` : actor.label}
          aria-pressed={selectedActorKey === actor.key}
          aria-disabled={disabled || departingActorKey === actor.key}
          data-scene-actor={actor.key}
          data-scene-actor-index={index}
          data-scene-entrance-ms="450"
          data-scene-exit-ms="300"
          data-scene-entrance={`${actor.entrance.x},${actor.entrance.y}`}
          data-scene-exit={`${actor.exit.x},${actor.exit.y}`}
          style={`${actorHitStyle(actor)};${parallaxStyle(actor)};--scene-entrance-x:${actor.entrance.x}px;--scene-entrance-y:${actor.entrance.y}px;--scene-exit-x:${actor.exit.x}px;--scene-exit-y:${actor.exit.y}px`}
          onclick={() => selectActor(actor)}
          onkeydown={(event) => actorKeydown(event, index)}
          onfocus={() => onactorfocus?.(actor.key)}
        >
          <span class="scene-actor-visual">
            {#if asset}
              <img src={asset.src ?? ''} alt="" draggable="false" style={actorArtStyle(actor)} onerror={() => failed(actor.key)} />
            {:else}
              <span class="actor-placeholder" aria-hidden="true" style={actorArtStyle(actor)}>{actorNames[actor.key] ?? actor.placeholder}</span>
            {/if}
          </span>
        </button>
        {:else}
        <div
          class:departing={departing}
          class="scene-actor scene-actor-static"
          role="img"
          aria-label={actorNames[actor.key] ?? actor.placeholder}
          data-scene-actor={actor.key}
          data-scene-entrance-ms="450"
          data-scene-exit-ms="300"
          style={`${actorHitStyle(actor)};${parallaxStyle(actor)};--scene-entrance-x:${actor.entrance.x}px;--scene-entrance-y:${actor.entrance.y}px;--scene-exit-x:${actor.exit.x}px;--scene-exit-y:${actor.exit.y}px`}
        >
          <span class="scene-actor-visual">
            {#if asset}
              <img src={asset.src ?? ''} alt="" draggable="false" style={actorArtStyle(actor)} onerror={() => failed(actor.key)} />
            {:else}
              <span class="actor-placeholder" aria-hidden="true" style={actorArtStyle(actor)}>{actorNames[actor.key] ?? actor.placeholder}</span>
            {/if}
          </span>
        </div>
        {/if}
      {/each}
    </div>

    {#each composition.foreground as layer (layer.key)}
      {@const asset = runtimeAsset(layer.key)}
      {#if asset}
        <img class="scene-image scene-foreground" src={asset.src ?? ''} alt={asset.alt ?? layer.alt} draggable="false"
          style={`${placementStyle(layer)};${parallaxStyle(layer)}`} onerror={() => failed(layer.key)} />
      {/if}
    {/each}
  </div>
</AreaScene>

<style>
  .scene-composition { position: absolute; inset: 0; overflow: hidden; isolation: isolate; }
  .scene-image, .scene-art-fallback, .scene-actor { position: absolute; display: block; max-width: none; }
  .scene-image { pointer-events: none; transition: transform 120ms linear; }
  .scene-art-fallback { display: grid; place-items: center; color: #ead8a6; background: radial-gradient(circle at 50% 30%, #5b3b1c, #130d08 72%); }
  .scene-actors { position: absolute; inset: 0; z-index: 5; }
  .scene-actor { padding: 0; border: 0; background: transparent; transition: transform 120ms linear; }
  button.scene-actor { cursor: pointer; }
  .scene-actor-static { pointer-events: none; }
  .scene-actor-visual { position: absolute; inset: 0; display: block; animation: scene-actor-arrive 450ms ease-out both; }
  .scene-actor img { position: absolute; display: block; object-fit: contain; object-position: center bottom; pointer-events: none; }
  .scene-actor:focus-visible { outline: 3px solid #f3c95f; outline-offset: 4px; }
  .scene-actor.selected::after { content: ''; position: absolute; inset: 7%; border: 2px solid #f3c95f; border-radius: 50%; box-shadow: 0 0 18px #f3c95f99; }
  .actor-placeholder { position: absolute; display: grid; place-items: center; padding: 1rem; color: #ead8a6; background: linear-gradient(140deg, #382816cc, #120c07cc); border: 1px dashed #c89435; font-family: 'Cinzel', serif; text-align: center; }
  .scene-actor.departing { pointer-events: none; }
  .scene-actor.departing .scene-actor-visual { animation: scene-actor-depart 300ms ease-in both; }
  @keyframes scene-actor-arrive { from { opacity: 0; transform: translate(var(--scene-entrance-x), var(--scene-entrance-y)); } to { opacity: 1; transform: translate(0, 0); } }
  @keyframes scene-actor-depart { from { opacity: 1; transform: translate(0, 0); } to { opacity: 0; transform: translate(var(--scene-exit-x), var(--scene-exit-y)); } }
  @media (prefers-reduced-motion: reduce) { .scene-image, .scene-actor, .scene-actor-visual { transition: none; animation: none; } }
</style>
