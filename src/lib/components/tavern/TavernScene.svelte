<script lang="ts">
  import { PUBLIC_SUPABASE_URL } from '$env/static/public';
  import ComposedScene from '$lib/components/scene/ComposedScene.svelte';
  import { getSceneComposition, type SceneActorDefinition } from '$lib/presentation/scene-composition';
  import { sceneRuntimeAssetPublicUrl } from '$lib/game/scene-runtime-assets';
  import { barScenePatronPlacements, type BarScenePatronPlacement } from '$lib/game/bar-scene';
  import type { Journal } from '$lib/game/dialogue';
  import type { Patron } from '$lib/game/serving';

  type Props = { patrons: Patron[]; selected: Patron | null; focusedKey: string | null; journals: Record<string, Journal>; day: number; disabled?: boolean; onselect: (instanceId: string) => void; onfocus: (instanceId: string) => void; };
  let { patrons, selected, focusedKey, journals, day, disabled = false, onselect, onfocus }: Props = $props();
  const composition = getSceneComposition('bar');
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
  let selectedJournal = $derived(selected ? journals[selected.instanceId] ?? null : null);
  let latest = $derived(selectedJournal?.turns.at(-1));
  function instanceForActor(key: string) { return patrons.find((patron) => actorKey(patron) === key)?.instanceId ?? null; }
</script>

<figure class="tavern-scene" aria-label="The tavern common room">
  <ComposedScene {composition} actors={sceneActors} assets={sceneAssets} {actorNames} {selectedActorKey} {focusedActorKey} {disabled}
    onactorselect={(key) => { const instanceId = instanceForActor(key); if (instanceId) onselect(instanceId); }}
    onactorfocus={(key) => { const instanceId = instanceForActor(key); if (instanceId) onfocus(instanceId); }} />
  <div class="scene-vignette" aria-hidden="true"></div><p class="bar-context-line">The common room · Day {day}</p>
  {#if selected && selectedJournal}
    <figcaption class="scene-dialogue"><div><strong>{selected.name}</strong><span>{selected.title}</span><span class="scene-facts">Relationship {selected.relationship} / 100{selectedJournal.questStatus==='active'?` · ${selectedJournal.risk} risk`:''}</span></div><p>{latest?.reply ?? (selectedJournal.intention ? `${selectedJournal.intention.goal} — ${selectedJournal.intention.motivation}` : selected.description)}</p></figcaption>
  {:else}<figcaption class="scene-dialogue empty-room-copy"><p>The fire is warm, but no guest is waiting at the bar.</p></figcaption>{/if}
</figure>

<style>
  .tavern-scene :global(.composed-scene) { position: absolute; inset: 0; width: 100%; height: 100%; }
  .empty-room-copy { display: block; }.empty-room-copy p { grid-column: 1 / -1; }
</style>
