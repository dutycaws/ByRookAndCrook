<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { PUBLIC_SUPABASE_URL } from '$env/static/public';
  import ComposedScene from '$lib/components/scene/ComposedScene.svelte';
  import { getSceneComposition, type SceneActorDefinition } from '$lib/presentation/scene-composition';
  import { barResidentArtworkId, sceneRuntimeAssetPublicUrl } from '$lib/game/scene-runtime-assets';
  import { barSceneCameraForFocus, barScenePatronPlacements, type BarScenePatronPlacement } from '$lib/game/bar-scene';
  import type { Patron } from '$lib/game/serving';
  import { TRINKET_ARTWORK, type OwnedTrinket, type TrinketSlot } from '$lib/game/trinkets';
  import BarStatusRail from './BarStatusRail.svelte';
  import FloatingSurface from '$lib/components/ui/FloatingSurface.svelte';

  type ScenePresentation = 'default' | 'player-hand';

  type Props = {
    patrons: Patron[];
    selected: Patron | null;
    focusedKey: string | null;
    trinkets: OwnedTrinket[];
    day: number;
    gold: number;
    archiveHref: string;
    disabled?: boolean;
    closeDisabled?: boolean;
    presentation?: ScenePresentation;
    // Kept in the public contract for callers migrating away from the old action buttons.
    cardSelected?: boolean;
    composerOpen?: boolean;
    deckOpen?: boolean;
    interaction: Snippet;
    onselect: (instanceId: string) => void;
    onfocus: (instanceId: string) => void;
    onback: () => void;
    ontalk?: () => void;
    ondeck?: () => void;
    onclose: () => void;
    onkeepsake: (slot: TrinketSlot) => void;
  };

  let {
    patrons,
    selected,
    focusedKey,
    trinkets,
    day,
    gold,
    archiveHref,
    disabled = false,
    closeDisabled = disabled,
    presentation = 'default',
    composerOpen = false,
    deckOpen = false,
    interaction,
    onselect,
    onfocus,
    onback,
    onclose,
    onkeepsake
  }: Props = $props();

  const composition = getSceneComposition('bar');
  const trinketAnchors: readonly { slot: TrinketSlot; left: string; top: string }[] = [
    { slot: 0, left: '3.5%', top: '19%' },
    { slot: 1, left: '85%', top: '19%' },
    { slot: 2, left: '3.5%', top: '34%' },
    { slot: 3, left: '85%', top: '34%' }
  ];
  let frame: HTMLElement;
  let frameSize = $state({ width: 0, height: 0 });

  onMount(() => {
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      frameSize = { width: entry.contentRect.width, height: entry.contentRect.height };
    });
    observer.observe(frame);
    return () => observer.disconnect();
  });

  /** Scene identity follows the save-specific resident, even when artwork is shared. */
  function actorKey(patron: Pick<Patron, 'instanceId'>) { return `patron:${patron.instanceId}`; }

  function gridActor(patron: Patron, placement: BarScenePatronPlacement): SceneActorDefinition {
    return {
      kind: 'actor', key: actorKey(patron), label: `Speak with ${patron.name}`, placeholder: `${patron.name} artwork`,
      x: placement.x, y: placement.y, width: placement.width, height: placement.height, depth: 5,
      compact: placement.compact, hitBounds: placement.hitBounds,
      entrance: { x: -45, y: 0 }, exit: { x: -70, y: 0 }
    };
  }

  let placements = $derived(barScenePatronPlacements(patrons.map((patron) => patron.instanceId)));
  let useAuthoredPilot = $derived(patrons.length <= 2 && patrons.every((patron) => Boolean(barResidentArtworkId(patron.name))));
  let sceneActors = $derived(patrons
    .filter((patron) => !selected || patron.instanceId === selected.instanceId)
    .map((patron) => {
      const artworkId = barResidentArtworkId(patron.name);
      const authored = artworkId ? composition.actors.find((actor) => actor.key === artworkId) : null;
      return useAuthoredPilot && authored
        ? { ...authored, key: actorKey(patron), label: `Speak with ${patron.name}`, placeholder: `${patron.name} artwork` }
        : gridActor(patron, placements.get(patron.instanceId)!);
    }));
  let assetByKey = $derived(Object.fromEntries(patrons.map((patron) => {
    const artworkId = barResidentArtworkId(patron.name);
    return [actorKey(patron), {
      src: artworkId ? sceneRuntimeAssetPublicUrl(artworkId, PUBLIC_SUPABASE_URL) : patron.sceneStorageKey
    }];
  })));
  let sceneAssets = $derived({
    'bar-background': { src: sceneRuntimeAssetPublicUrl('bar-background', PUBLIC_SUPABASE_URL) },
    'bar-counter-occlusion': { src: sceneRuntimeAssetPublicUrl('bar-counter-occlusion', PUBLIC_SUPABASE_URL) },
    ...assetByKey
  });
  let actorNames = $derived(Object.fromEntries(patrons.map((patron) => [actorKey(patron), patron.name])));
  let selectedActorKey = $derived(selected ? actorKey(selected) : null);
  let cameraTarget = $derived.by(() => {
    if (!selected) return null;
    const actor = sceneActors.find((candidate) => candidate.key === actorKey(selected));
    if (!actor) return null;
    const placement = frameSize.width <= 620 ? actor.compact : actor;
    return { x: placement.x, y: placement.y, width: placement.width, height: placement.height };
  });
  let focusedActorKey = $derived.by(() => {
    const focused = focusedKey ? patrons.find((patron) => patron.instanceId === focusedKey) : null;
    return focused ? actorKey(focused) : null;
  });
  let camera = $derived(barSceneCameraForFocus({
    viewportWidth: frameSize.width,
    viewportHeight: frameSize.height,
    designWidth: composition.plane.width,
    designHeight: composition.plane.height,
    mobile: frameSize.width <= 620,
    target: cameraTarget
  }));

  function instanceForActor(key: string) {
    return patrons.find((patron) => actorKey(patron) === key)?.instanceId ?? null;
  }
</script>

<div class="tavern-scene-stack" class:focused={selected} class:player-hand={presentation === 'player-hand'}>
  <figure bind:this={frame} class="tavern-scene" aria-label="The tavern common room" style={`--bar-camera-scale:${camera.scale};--bar-camera-x:${camera.x}px;--bar-camera-y:${camera.y}px`}>
    <ComposedScene
      {composition}
      actors={sceneActors}
      assets={sceneAssets}
      {actorNames}
      {selectedActorKey}
      {focusedActorKey}
      {disabled}
      showSelectionHalo={false}
      onactorselect={(key) => { const instanceId = instanceForActor(key); if (instanceId) onselect(instanceId); }}
      onactorfocus={(key) => { const instanceId = instanceForActor(key); if (instanceId) onfocus(instanceId); }}
    />
    <div class="scene-vignette" aria-hidden="true"></div>

    <BarStatusRail day={day} gold={gold} disabled={closeDisabled} presentation={selected ? 'player-hand' : 'default'} onclose={onclose} />

    {#if selected}
      <button
        class="back-to-room"
        type="button"
        data-bar-control="back"
        aria-label="Return to the tavern room"
        title="Return to the tavern room"
        disabled={disabled}
        onclick={onback}
      >
        <span aria-hidden="true">×</span>
      </button>
    {/if}

    <div
      class="scene-keepsake-anchors"
      class:dismissed={selected}
      role="group"
      aria-label="Keepsake display slots"
      aria-hidden={Boolean(selected)}
      inert={Boolean(selected)}
    >
      {#each trinketAnchors as anchor (anchor.slot)}
        {@const item = trinkets.find((entry) => entry.slot === anchor.slot) ?? null}
        <button
          class="scene-keepsake-place"
          type="button"
          data-keepsake-slot={anchor.slot + 1}
          style={`left:${anchor.left};top:${anchor.top}`}
          aria-label={item
            ? `Keepsake slot ${anchor.slot + 1}, ${item.name}. Open the keepsake manager.`
            : `Keepsake slot ${anchor.slot + 1}, empty. Open the keepsake manager.`}
          disabled={disabled || Boolean(selected)}
          onclick={() => onkeepsake(anchor.slot)}
        >
          {#if item}
            <span class="scene-keepsake-art" aria-hidden="true">
              <img src={TRINKET_ARTWORK[item.artworkId].src} alt="" />
            </span>
          {:else}
            <span class="scene-keepsake-empty" aria-hidden="true">◇</span>
          {/if}
        </button>
      {/each}
    </div>
  </figure>

  {#if !selected}
    <a class="archive-link" href={archiveHref}>Past residents</a>
  {/if}

  <FloatingSurface
    as="section"
    class={presentation === 'player-hand' ? 'scene-interaction player-hand' : 'scene-interaction'}
    id="resident-conversation"
    aria-label={selected ? `Interaction with ${selected.name}` : 'Resident interaction'}
    hidden={!selected || (presentation !== 'player-hand' && !composerOpen && !deckOpen)}
    inert={!selected || (presentation !== 'player-hand' && !composerOpen && !deckOpen)}
  >
    {@render interaction()}
  </FloatingSurface>
</div>

<style>
  .tavern-scene-stack { position: relative; display: grid; grid-column: 1 / -1; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto; width: 100%; min-width: 0; }
  .tavern-scene-stack .tavern-scene { position: relative; grid-area: auto; width: 100%; min-width: 0; min-height: 0; max-height: none; aspect-ratio: 16 / 9; overflow: hidden; margin: 0; border: 1px solid rgb(193 159 94 / .4); background: #120d07; box-shadow: 0 12px 32px rgb(0 0 0 / .38); }
  .tavern-scene :global(.composed-scene) { position: absolute; inset: 0; width: 100%; height: 100%; }
  .tavern-scene :global(.scene-composition) { transform: translate(var(--bar-camera-x, 0px), var(--bar-camera-y, 0px)) scale(var(--bar-camera-scale, 1)); transform-origin: top left; transition: transform 280ms cubic-bezier(.2,.7,.2,1); }
  .scene-vignette { position: absolute; z-index: 8; inset: 0; pointer-events: none; background: linear-gradient(180deg, rgb(8 6 3 / .25), transparent 19%, transparent 72%, rgb(8 5 2 / .56)); }
  .scene-keepsake-anchors { position: absolute; z-index: 10; inset: 0; pointer-events: none; transition: opacity 180ms ease; }
  .scene-keepsake-anchors.dismissed { opacity: 0; }
  .scene-keepsake-place { position: absolute; display: grid; width: clamp(2.7rem, 5vw, 3.4rem); height: clamp(2.7rem, 5vw, 3.4rem); place-items: center; padding: .22rem; border: 0; border-radius: 50%; color: #dfbf72; background: transparent; pointer-events: auto; cursor: pointer; }
  .scene-keepsake-place::before { position: absolute; inset: 0; border: 1px solid #c49a4a; border-radius: 50%; background: radial-gradient(circle, rgb(48 33 13 / .94), rgb(13 9 5 / .92)); box-shadow: 0 2px 10px rgb(0 0 0 / .65), inset 0 0 0 3px rgb(238 207 130 / .12); content: ''; }
  .scene-keepsake-place:hover::before, .scene-keepsake-place:focus-visible::before { border-color: #ffe09a; box-shadow: 0 0 0 3px rgb(255 220 137 / .3), 0 2px 12px rgb(0 0 0 / .75); }
  .scene-keepsake-place:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
  .scene-keepsake-place:disabled { cursor: wait; opacity: .65; }
  .scene-keepsake-art, .scene-keepsake-empty { position: relative; z-index: 1; display: grid; width: 100%; height: 100%; place-items: center; }
  .scene-keepsake-art img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 2px 3px rgb(0 0 0 / .6)); }
  .scene-keepsake-empty { color: #dfbf72; font: 1.55rem Georgia, serif; }
  :global(.scene-interaction) { position: absolute; z-index: 16; right: .9rem; bottom: 4.15rem; width: min(clamp(20rem, 34vw, 34rem), calc(100% - 1.8rem)); max-height: min(52vh, calc(100% - 16rem), 460px); padding: .75rem .85rem; overflow: auto; }
  .tavern-scene-stack.player-hand :global(.scene-interaction) { inset: 0; width: auto; max-height: none; padding: 0; overflow: visible; border: 0; border-radius: 0; background: transparent; box-shadow: none; pointer-events: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .tavern-scene-stack.player-hand :global(.scene-interaction :is(a, button, input, select, textarea, [role='button'], [contenteditable='true'])) { pointer-events: auto; }
  .back-to-room { position: absolute; z-index: 17; top: .7rem; right: .75rem; display: grid; width: 44px; height: 44px; min-width: 44px; min-height: 44px; place-items: center; padding: 0; border: 1px solid #806631; border-radius: 50%; color: #efdfb7; background: rgb(17 12 6 / .92); font: inherit; font-size: 1.65rem; line-height: 1; cursor: pointer; }
  .back-to-room:hover { border-color: #d3ae57; background: rgb(61 43 17 / .95); }
  .back-to-room:disabled { cursor: wait; opacity: .6; }
  .back-to-room:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
  .archive-link { position: absolute; z-index: 14; right: 1rem; bottom: 1rem; color: #f0d27a; font-size: .83rem; text-decoration: underline; text-underline-offset: .18em; }
  .archive-link:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
  @media (max-width: 820px) { .tavern-scene-stack .tavern-scene { aspect-ratio: 3 / 2; } }
  @media (max-width: 1000px) {
    :global(.scene-interaction) { position: static; width: auto; max-height: none; margin-top: .55rem; padding: .55rem .65rem; overflow: visible; }
    .tavern-scene-stack.player-hand :global(.scene-interaction) { inset: auto; min-height: 360px; margin-top: .55rem; padding: .65rem; overflow: visible; background: transparent; border: 0; box-shadow: none; pointer-events: auto; }
    .back-to-room { top: .45rem; right: .45rem; }
    .archive-link { position: static; justify-self: start; margin-top: .45rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .tavern-scene :global(.scene-composition), .scene-keepsake-anchors { transition: none; }
  }
</style>
