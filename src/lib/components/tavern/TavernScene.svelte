<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { PUBLIC_SUPABASE_URL } from '$env/static/public';
  import ComposedScene from '$lib/components/scene/ComposedScene.svelte';
  import { getSceneComposition, type SceneActorDefinition } from '$lib/presentation/scene-composition';
  import { barResidentArtworkId, sceneRuntimeAssetPublicUrl } from '$lib/game/scene-runtime-assets';
  import { barSceneCameraForFocus, barScenePatronPlacements, type BarScenePatronPlacement } from '$lib/game/bar-scene';
  import type { Patron } from '$lib/game/serving';
  import { TRINKET_ARTWORK, TRINKET_EFFECT_CATALOG, type OwnedTrinket, type TrinketSlot } from '$lib/game/trinkets';
  import BarStatusRail from './BarStatusRail.svelte';
  import TavernDeckBack from './TavernDeckBack.svelte';
  import FloatingSurface from '$lib/components/ui/FloatingSurface.svelte';

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
    cardSelected?: boolean;
    composerOpen?: boolean;
    deckOpen?: boolean;
    interaction: Snippet;
    onselect: (instanceId: string) => void;
    onfocus: (instanceId: string) => void;
    onback: () => void;
    ontalk: () => void;
    ondeck: () => void;
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
    cardSelected = false,
    composerOpen = false,
    deckOpen = false,
    interaction,
    onselect,
    onfocus,
    onback,
    ontalk,
    ondeck,
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

<div class="tavern-scene-stack" class:focused={selected}>
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

    <BarStatusRail day={day} gold={gold} disabled={closeDisabled} onclose={onclose} />

    {#if !selected}
      <div class="scene-keepsake-anchors" role="group" aria-label="Keepsake display slots">
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
            disabled={disabled}
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
    {/if}
  </figure>

  {#if selected}
    <div class="scene-actions" aria-label={`Actions for ${selected.name}`}>
      <button class="back-to-bar" type="button" data-bar-control="back" disabled={disabled} onclick={onback}>Back to bar</button>
      <div class="focus-actions">
        <button
          class:active={composerOpen}
          type="button"
          data-bar-control="talk"
          aria-expanded={composerOpen}
          aria-controls="resident-conversation"
          {disabled}
          onclick={ontalk}
        >Talk</button>
        <button
          class:active={deckOpen}
          class:has-selection={cardSelected}
          type="button"
          data-bar-control="deck"
          aria-expanded={deckOpen}
          aria-controls="resident-conversation"
          aria-label={cardSelected ? 'Open the card deck. A card is selected.' : 'Open the card deck'}
          {disabled}
          onclick={ondeck}
        ><TavernDeckBack /><span>Card Deck</span></button>
      </div>
    </div>
  {:else}
    <a class="archive-link" href={archiveHref}>Past residents</a>
  {/if}

  <FloatingSurface
    as="section"
    class="scene-interaction"
    id="resident-conversation"
    aria-label={selected ? `Interaction with ${selected.name}` : 'Resident interaction'}
    hidden={!selected || (!composerOpen && !deckOpen)}
    inert={!selected || (!composerOpen && !deckOpen)}
  >
    {@render interaction()}
  </FloatingSurface>
</div>

<style>
  .tavern-scene-stack { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto; min-width: 0; }
  .tavern-scene-stack .tavern-scene { position: relative; grid-area: auto; width: 100%; min-width: 0; min-height: 0; max-height: none; aspect-ratio: 16 / 9; overflow: hidden; margin: 0; border: 1px solid rgb(193 159 94 / .4); background: #120d07; box-shadow: 0 12px 32px rgb(0 0 0 / .38); }
  .tavern-scene :global(.composed-scene) { position: absolute; inset: 0; width: 100%; height: 100%; }
  .tavern-scene :global(.scene-composition) { transform: translate(var(--bar-camera-x, 0px), var(--bar-camera-y, 0px)) scale(var(--bar-camera-scale, 1)); transform-origin: top left; transition: transform 280ms cubic-bezier(.2,.7,.2,1); }
  .scene-vignette { position: absolute; z-index: 8; inset: 0; pointer-events: none; background: linear-gradient(180deg, rgb(8 6 3 / .25), transparent 19%, transparent 72%, rgb(8 5 2 / .56)); }
  .scene-keepsake-anchors { position: absolute; z-index: 10; inset: 0; pointer-events: none; }
  .scene-keepsake-place { position: absolute; display: grid; width: clamp(2.7rem, 5vw, 3.4rem); height: clamp(2.7rem, 5vw, 3.4rem); place-items: center; padding: .22rem; border: 0; border-radius: 50%; color: #dfbf72; background: transparent; pointer-events: auto; cursor: pointer; }
  .scene-keepsake-place::before { position: absolute; inset: 0; border: 1px solid #c49a4a; border-radius: 50%; background: radial-gradient(circle, rgb(48 33 13 / .94), rgb(13 9 5 / .92)); box-shadow: 0 2px 10px rgb(0 0 0 / .65), inset 0 0 0 3px rgb(238 207 130 / .12); content: ''; }
  .scene-keepsake-place:hover::before, .scene-keepsake-place:focus-visible::before { border-color: #ffe09a; box-shadow: 0 0 0 3px rgb(255 220 137 / .3), 0 2px 12px rgb(0 0 0 / .75); }
  .scene-keepsake-place:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
  .scene-keepsake-place:disabled { cursor: wait; opacity: .65; }
  .scene-keepsake-art, .scene-keepsake-empty { position: relative; z-index: 1; display: grid; width: 100%; height: 100%; place-items: center; }
  .scene-keepsake-art img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 2px 3px rgb(0 0 0 / .6)); }
  .scene-keepsake-empty { color: #dfbf72; font: 1.55rem Georgia, serif; }
  :global(.scene-interaction) { position: absolute; z-index: 16; right: .9rem; bottom: 4.15rem; width: min(clamp(20rem, 34vw, 34rem), calc(100% - 1.8rem)); max-height: min(52vh, calc(100% - 16rem), 460px); padding: .75rem .85rem; overflow: auto; }
  .scene-actions { position: absolute; z-index: 14; right: .9rem; bottom: .9rem; left: .9rem; display: flex; align-items: end; justify-content: space-between; gap: .65rem; pointer-events: none; }
  .scene-actions button { min-height: 2.65rem; border: 1px solid #806631; padding: .55rem .8rem; color: #efdfb7; background: rgb(17 12 6 / .92); font: inherit; font-weight: 650; cursor: pointer; pointer-events: auto; transition: border-color 150ms ease, background-color 150ms ease, transform 150ms ease; }
  .scene-actions button:hover, .scene-actions button.active, .scene-actions button.has-selection { border-color: #d3ae57; background: rgb(61 43 17 / .95); }
  .scene-actions button:hover { transform: translateY(-1px); }
  .scene-actions button:disabled { cursor: wait; opacity: .6; }
  .scene-actions button:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
  .focus-actions { display: flex; gap: .45rem; }
  .focus-actions button { display: inline-flex; align-items: center; gap: .4rem; }
  .archive-link { position: absolute; z-index: 14; right: 1rem; bottom: 1rem; color: #f0d27a; font-size: .83rem; text-decoration: underline; text-underline-offset: .18em; }
  .archive-link:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
  @media (max-width: 820px) { .tavern-scene-stack .tavern-scene { aspect-ratio: 3 / 2; } }
  @media (max-width: 1000px) {
    :global(.scene-interaction) { position: static; width: auto; max-height: none; margin-top: .55rem; padding: .55rem .65rem; overflow: visible; }
    .scene-actions { position: static; align-items: center; margin-top: .55rem; }
    .scene-actions button { min-height: 2.8rem; padding-inline: .65rem; font-size: .9rem; }
    .archive-link { position: static; justify-self: start; margin-top: .45rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .tavern-scene :global(.scene-composition), .scene-actions button { transition: none; }
  }
</style>
