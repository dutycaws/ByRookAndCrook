<script lang="ts">
  import { dev } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { GameSnapshot } from '$lib/game/contracts';
  import type { BarSnapshot } from '$lib/game/serving';
  import type { BurnStyle } from '$lib/card-effects';
  import UnifiedWorkflowPrototype from './UnifiedWorkflowPrototype.svelte';
  import CraftingWorkflowPrototype from './CraftingWorkflowPrototype.svelte';
  import WorkflowPrototypeScene from './WorkflowPrototypeScene.svelte';
  import type { WorkflowArea, WorkflowVariant } from './types';

  let { area, snapshot, barSnapshot = null, burnStyle = 'drip' }: { area: WorkflowArea; snapshot: GameSnapshot | null; barSnapshot?: BarSnapshot | null; burnStyle?: BurnStyle } = $props();
  const keys: WorkflowVariant[] = ['A', 'B', 'C'];
  const names = { A: 'Counter hand', B: 'Right folio', C: 'Inspection spotlight' };
  const variant = $derived(keys.includes(page.url.searchParams.get('variant') as WorkflowVariant) ? page.url.searchParams.get('variant') as WorkflowVariant : 'A');
  function changeVariant(offset: number) {
    const url = new URL(page.url);
    url.searchParams.set('variant', keys[(keys.indexOf(variant) + offset + keys.length) % keys.length]);
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
  }
  function switchKey(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest('input,textarea,select,button,[contenteditable],[data-card-hand],[data-prototype-minigame]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); changeVariant(event.key === 'ArrowRight' ? 1 : -1);
    }
  }
</script>

<svelte:window onkeydown={switchKey} />
<main class="workflow-prototype-host" data-disposable-prototype="unified-card-workflows">
  {#if area === 'brewery' || area === 'bakery'}
    <CraftingWorkflowPrototype {area} {snapshot} {variant} {burnStyle} />
  {:else}
    <UnifiedWorkflowPrototype {area} {variant} {burnStyle}>
      {#snippet scene(context)}
        <WorkflowPrototypeScene {area} {snapshot} {barSnapshot} {...context} />
      {/snippet}
    </UnifiedWorkflowPrototype>
  {/if}
  {#if dev}
    <nav class="prototype-switcher" aria-label="Prototype variants">
      <button type="button" aria-label="Previous prototype variant" onclick={() => changeVariant(-1)}>←</button>
      <span><small>Prototype</small> <b>{variant}</b> · {names[variant]}</span>
      <button type="button" aria-label="Next prototype variant" onclick={() => changeVariant(1)}>→</button>
      <a class="exit-prototype" href={`/${area}`} aria-label="Exit prototype">Exit</a>
    </nav>
  {/if}
</main>

<style>
  .workflow-prototype-host { width: min(1600px, calc(100% - 24px)); margin: .6rem auto; padding: 0 0 4.5rem; }
  .workflow-prototype-host :global([data-workflow-area='bar'] .path) { top: 6.5rem; }
  .prototype-switcher { position: fixed; z-index: 100; left: 50%; bottom: .65rem; transform: translateX(-50%); display: flex; align-items: center; gap: .5rem; max-width: calc(100% - 1rem); padding: .25rem .4rem; color: #fff2d3; background: #151322f5; border: 1px solid #a499cf; border-radius: 2rem; box-shadow: 0 4px 18px #0008; }
  .prototype-switcher span { white-space: nowrap; font-size: .75rem; text-align: center; }
  .prototype-switcher small { color: #b8b3ce; font-size: .6rem; }
  .prototype-switcher button { border: 0; border-radius: 50%; background: transparent; color: inherit; width: 40px; height: 40px; cursor: pointer; }
  .exit-prototype { padding: .4rem .5rem; border-left: 1px solid #554d6a; color: #f9df9e; font-size: .68rem; white-space: nowrap; }
  .prototype-switcher button:focus-visible, .prototype-switcher a:focus-visible { outline: 2px solid #f9df9e; outline-offset: 2px; }
  @media (max-width: 420px) {
    .prototype-switcher { gap: .2rem; }
    .prototype-switcher button { width: 34px; height: 34px; }
    .prototype-switcher span { font-size: .68rem; }
    .exit-prototype { padding: .35rem; font-size: .62rem; }
  }
</style>
