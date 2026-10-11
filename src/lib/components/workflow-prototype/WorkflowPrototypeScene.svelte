<script lang="ts">
  // Disposable scene adapters: all commands are intentionally local callbacks.
  import { PUBLIC_SUPABASE_URL } from '$env/static/public';
  import { tick } from 'svelte';
  import type { GameSnapshot } from '$lib/game/contracts';
  import type { BarSnapshot } from '$lib/game/serving';
  import ShopScene from '$lib/components/shop/ShopScene.svelte';
  import TavernScene from '$lib/components/tavern/TavernScene.svelte';
  import GardenScene from '$lib/components/scenes/GardenScene.svelte';
  import BreweryScene from '$lib/components/scenes/BreweryScene.svelte';
  import BakeryScene from '$lib/components/scenes/BakeryScene.svelte';
  import { deriveGardenVisualState, deriveBrewVisualState, deriveBakeVisualState } from '$lib/presentation/scene';
  import { sceneRuntimeAssetPublicUrl, type SceneRuntimeAssetId } from '$lib/game/scene-runtime-assets';

  let { area, snapshot, barSnapshot = null, selectedId, focused, onselect }: {
    area: 'bar' | 'garden' | 'shop' | 'brewery' | 'bakery';
    snapshot: GameSnapshot | null;
    barSnapshot?: BarSnapshot | null;
    selectedId: string | null;
    focused: boolean;
    onselect: (id: string) => void;
  } = $props();
  let entityId = $state<string | null>(null);
  let sceneElement = $state<HTMLDivElement>();
  let hadFocus = false;
  const patrons = $derived(barSnapshot?.patrons ?? []);
  const patron = $derived(focused && entityId && selectedId !== 'trinkets' && selectedId !== 'close' ? patrons.find(p => p.instanceId === entityId) ?? null : null);
  const gardenVisual = $derived(deriveGardenVisualState(snapshot, focused ? entityId : null, false, null));
  const brewVisual = $derived({ ...deriveBrewVisualState(snapshot, { remainingMs: 17000, pending: false, error: null }), phase: 'setup' as const, session: null });
  const bakeVisual = $derived({ ...deriveBakeVisualState(snapshot, { elapsedMs: 0, ovenBand: 'red', pending: false, error: null }), phase: 'setup' as const });
  function sceneAsset(id: SceneRuntimeAssetId) {
    const url = sceneRuntimeAssetPublicUrl(id, PUBLIC_SUPABASE_URL);
    return url ? { src: url } : undefined;
  }
  const shopAssets = {
    'shop-background': sceneAsset('shop-background'),
    'shop-elara': sceneAsset('shop-elara'),
    'shop-counter-occlusion': sceneAsset('shop-counter-occlusion')
  };
  $effect(() => {
    const returning = hadFocus && !focused;
    hadFocus = focused;
    const returnId = entityId;
    if (returning && returnId) {
      entityId = null;
      void tick().then(() => {
      const selector = area === 'garden' ? `[data-cell-id="${returnId}"]` : `[data-scene-actor="patron:${returnId}"]`;
      sceneElement?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
      });
    }
  });
  function choosePlot(id: string) {
    entityId = id;
    const cell = snapshot?.cells.find(c => c.id === id);
    onselect(cell?.kind === 'beehive' ? 'plot-hive' : cell?.plantKey ? 'plot-growing' : 'plot-empty');
  }
</script>

<div bind:this={sceneElement} class="prototype-scene" data-prototype-scene={area}>
  {#if area === 'shop'}
    <ShopScene assets={shopAssets} detailMode={focused} />
  {:else if area === 'bar'}
    <TavernScene {patrons} selected={patron} focusedKey={patron?.instanceId ?? null}
      trinkets={barSnapshot?.trinkets?.collection ?? []} day={barSnapshot?.save.currentDay ?? 1}
      gold={barSnapshot?.save.gold ?? 0} archiveHref="/bar?prototype=hand&variant=A"
      presentation="player-hand" onselect={(id) => { entityId = id; onselect('resident'); }}
      onfocus={() => {}} onback={() => onselect('root')} onclose={() => onselect('close')}
      onkeepsake={() => { entityId = null; onselect('trinkets'); }}>
      {#snippet interaction()}{/snippet}
    </TavernScene>
  {:else if area === 'garden'}
    <GardenScene visual={gardenVisual} onselect={choosePlot} />
  {:else if area === 'brewery'}
    <BreweryScene visual={brewVisual} saveId="disposable-unified-hand" ontelemetry={() => {}} />
  {:else}
    <BakeryScene visual={bakeVisual} oncommit={() => {}} />
  {/if}
</div>

<style>
  .prototype-scene { position: absolute; inset: 0; overflow: hidden; }
  .prototype-scene :global(.area-scene), .prototype-scene :global(.tavern-scene-stack),
  .prototype-scene :global(.tavern-scene) { width: 100%; height: 100%; min-height: 0; max-height: none; aspect-ratio: auto; margin: 0; }
  .prototype-scene :global(.scene-interaction), .prototype-scene :global(.archive-link) { display: none; }
  .prototype-scene :global(.bar-status) { top: 3.5rem; left: 1.3rem; right: auto; }
  .prototype-scene :global(.back-to-room) { top: 5rem; right: 1rem; }
  .prototype-scene :global(.garden-camera-controls) { top: 5rem; bottom: auto; }
</style>
