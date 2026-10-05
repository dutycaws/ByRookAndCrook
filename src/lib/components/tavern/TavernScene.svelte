<script lang="ts">
  import { PUBLIC_SUPABASE_URL } from '$env/static/public';
  import ComposedScene from '$lib/components/scene/ComposedScene.svelte';
  import { getSceneComposition, type SceneActorDefinition } from '$lib/presentation/scene-composition';
  import { sceneRuntimeAssetPublicUrl } from '$lib/game/scene-runtime-assets';
  import { barScenePatronPlacements, type BarScenePatronPlacement } from '$lib/game/bar-scene';
    import type { Patron } from '$lib/game/serving';
    import { TRINKET_ARTWORK, TRINKET_EFFECT_CATALOG, type OwnedTrinket, type TrinketSlot } from '$lib/game/trinkets';

  type Props = { patrons: Patron[]; selected: Patron | null; focusedKey: string | null; trinkets: OwnedTrinket[]; response?: string | null; journalHref?: string | null; disabled?: boolean; onselect: (instanceId: string) => void; onfocus: (instanceId: string) => void; };
  let { patrons, selected, focusedKey, trinkets, response = null, journalHref = null, disabled = false, onselect, onfocus }: Props = $props();
  const composition = getSceneComposition('bar');
  const trinketAnchors: readonly { slot: TrinketSlot; left: string; top: string }[] = [
    { slot: 0, left: '3.5%', top: '19%' },
    { slot: 1, left: '85%', top: '19%' },
    { slot: 2, left: '3.5%', top: '34%' },
    { slot: 3, left: '85%', top: '34%' }
  ];
  const authoredActorKeys: Record<string, 'bar-lira' | 'bar-torvin'> = { 'Lira Nightwind': 'bar-lira', 'Torvin Ashbeard': 'bar-torvin' };
  /** Scene identity follows the save-specific resident, even when artwork is shared. */
  function actorKey(patron: Pick<Patron, 'instanceId'>) { return `patron:${patron.instanceId}`; }
  function gridActor(patron: Patron, placement: BarScenePatronPlacement): SceneActorDefinition {
    return { kind: 'actor', key: actorKey(patron), label: `Speak with ${patron.name}`, placeholder: `${patron.name} artwork`,
      x: placement.x, y: placement.y, width: placement.width, height: placement.height, depth: 5,
      compact: placement.compact, hitBounds: placement.hitBounds,
      entrance: { x: -45, y: 0 }, exit: { x: -70, y: 0 } };
  }
  let placements = $derived(barScenePatronPlacements(patrons.map((patron) => patron.instanceId)));
  let useAuthoredPilot = $derived(patrons.length <= 2 && patrons.every((patron) => Boolean(authoredActorKeys[patron.name])));
  let sceneActors = $derived(patrons.map((patron) => {
    const authored = composition.actors.find((actor) => actor.key === authoredActorKeys[patron.name]);
    return useAuthoredPilot && authored
      ? { ...authored, key: actorKey(patron), label: `Speak with ${patron.name}`, placeholder: `${patron.name} artwork` }
      : gridActor(patron, placements.get(patron.instanceId)!);
  }));
  let assetByKey = $derived(Object.fromEntries(patrons.map((patron) => [actorKey(patron), { src: authoredActorKeys[patron.name] ? sceneRuntimeAssetPublicUrl(authoredActorKeys[patron.name], PUBLIC_SUPABASE_URL) : patron.sceneStorageKey }])));
  let sceneAssets = $derived({ 'bar-background': { src: sceneRuntimeAssetPublicUrl('bar-background', PUBLIC_SUPABASE_URL) }, 'bar-counter-occlusion': { src: sceneRuntimeAssetPublicUrl('bar-counter-occlusion', PUBLIC_SUPABASE_URL) }, ...assetByKey });
  let actorNames = $derived(Object.fromEntries(patrons.map((patron) => [actorKey(patron), patron.name])));
  let selectedActorKey = $derived(selected ? actorKey(selected) : null);
  let focusedActorKey = $derived.by(() => {
    const focused = focusedKey ? patrons.find((patron) => patron.instanceId === focusedKey) : null;
    return focused ? actorKey(focused) : null;
  });
  function instanceForActor(key: string) { return patrons.find((patron) => actorKey(patron) === key)?.instanceId ?? null; }
</script>

<div class="tavern-scene-stack">
  <figure class="tavern-scene" aria-label="The tavern common room">
    <ComposedScene {composition} actors={sceneActors} assets={sceneAssets} {actorNames} {selectedActorKey} {focusedActorKey} {disabled}
      onactorselect={(key) => { const instanceId = instanceForActor(key); if (instanceId) onselect(instanceId); }}
      onactorfocus={(key) => { const instanceId = instanceForActor(key); if (instanceId) onfocus(instanceId); }} />
    <div class="scene-vignette" aria-hidden="true"></div>
    <div class="scene-keepsake-anchors" role="list" aria-label="Four fixed keepsake displays">
      {#each trinketAnchors as anchor (anchor.slot)}
        {@const item = trinkets.find((entry) => entry.slot === anchor.slot) ?? null}
        <div class="scene-keepsake-place" role="listitem" data-keepsake-slot={anchor.slot + 1} style={`left:${anchor.left};top:${anchor.top}`}>
          {#if item}
            <span class="scene-keepsake-art" role="img" aria-label={`${item.name}, displayed in keepsake place ${anchor.slot + 1}. ${TRINKET_EFFECT_CATALOG[item.catalogId].label}`}>
              <img src={TRINKET_ARTWORK[item.artworkId].src} alt="" />
            </span>
          {:else}
            <span class="scene-keepsake-empty" role="img" aria-label={`Keepsake display place ${anchor.slot + 1} is empty`}>◇</span>
          {/if}
        </div>
      {/each}
    </div>
    <figcaption class="scene-caption">
      {#if response}
        <p>{response}</p>
        {#if journalHref}<a href={journalHref}>Read the full exchange <span aria-hidden="true">→</span></a>{/if}
      {:else}
        <p><span aria-hidden="true">✦</span> Stories are always gathering in the common room.</p>
      {/if}
    </figcaption>
  </figure>

</div>

<style>
  .tavern-scene-stack { grid-area: scene; display: grid; align-content: start; gap: 6px; min-width: 0; }
  .tavern-scene-stack > :global(figure.tavern-scene) { grid-area: auto; }
  .tavern-scene :global(.composed-scene) { position: absolute; inset: 0; width: 100%; height: 100%; }
  .scene-caption { position: absolute; z-index: 10; right: 2%; bottom: .8rem; left: 2%; display: grid; gap: .3rem; margin: 0; padding: .55rem .75rem; border: 1px solid rgb(193 159 94 / .38); color: #e1d0a8; background: linear-gradient(110deg, rgb(14 10 6 / .91), rgb(20 14 7 / .82)); font-size: .84rem; letter-spacing: .01em; text-align: left; }
.scene-caption p { display: -webkit-box; overflow: hidden; margin: 0; color: #e1d0a8; line-height: 1.4; -webkit-box-orient: vertical; line-clamp: 3; -webkit-line-clamp: 3; }
.scene-caption p span { color: #d9b659; }
.scene-caption a { justify-self: start; color: #efcf78; font-size: .78rem; text-decoration: underline; text-underline-offset: .16em; }
.scene-caption a:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
:global(figure.tavern-scene) { height: auto !important; min-height: 0 !important; max-height: none !important; aspect-ratio: 16 / 9; }
@media (max-width: 820px) { :global(figure.tavern-scene) { aspect-ratio: 3 / 2; } }
  /* Decorative anchors share the art plane but never take patron hit targets. */
  .scene-keepsake-anchors,.scene-keepsake-place { pointer-events: none; }
  .scene-keepsake-anchors { position: absolute; z-index: 9; inset: 0; }
  .scene-keepsake-place { position: absolute; width: clamp(2.5rem, 5vw, 3.35rem); height: clamp(2.5rem, 5vw, 3.35rem); }
  .scene-keepsake-art,.scene-keepsake-empty { display: grid; width: 100%; height: 100%; place-items: center; border: 1px solid #c49a4a; border-radius: 50%; color: #dfbf72; background: radial-gradient(circle, rgb(48 33 13 / .94), rgb(13 9 5 / .92)); box-shadow: 0 2px 10px rgb(0 0 0 / .65), inset 0 0 0 3px rgb(238 207 130 / .12); }
  .scene-keepsake-art { box-sizing: border-box; padding: .35rem; }
  .scene-keepsake-art:hover { border-color: #ffe09a; box-shadow: 0 0 0 2px rgb(255 220 137 / .4), 0 2px 12px rgb(0 0 0 / .75); }
  .scene-keepsake-art img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 2px 3px rgb(0 0 0 / .6)); }
  .scene-keepsake-empty { box-sizing: border-box; border-style: dashed; border-color: rgb(196 154 74 / .58); opacity: .72; font: 1.7rem Georgia,serif; }


</style>
