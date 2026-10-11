<script lang="ts">
  import { dev } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { GameSnapshot } from '$lib/game/contracts';
  import type { BarSnapshot } from '$lib/game/serving';
  import type { BurnStyle } from '$lib/card-effects';
  import UnifiedWorkflowPrototype from './UnifiedWorkflowPrototype.svelte';
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
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest('input,textarea,select,[contenteditable], [data-card-hand]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); changeVariant(event.key === 'ArrowRight' ? 1 : -1);
    }
  }
</script>

<svelte:window onkeydown={switchKey} />
<main class="workflow-prototype-host" data-disposable-prototype="unified-card-workflows">
  <nav class="prototype-routes" aria-label="Prototype areas">
    {#each ['garden', 'bar', 'brewery', 'bakery', 'shop'] as route}
      <a aria-current={route === area ? 'page' : undefined} href={`/${route}?prototype=hand&variant=${variant}`}>{route}</a>
    {/each}
    <a class="live-link" href={`/${area}`}>Exit prototype</a>
  </nav>
  <UnifiedWorkflowPrototype {area} {variant} {burnStyle}>
    {#snippet scene(context)}
      <WorkflowPrototypeScene {area} {snapshot} {barSnapshot} {...context} />
    {/snippet}
  </UnifiedWorkflowPrototype>
  {#if dev}
    <nav class="prototype-switcher" aria-label="Prototype variants">
      <button type="button" aria-label="Previous prototype variant" onclick={() => changeVariant(-1)}>←</button>
      <span><b>{variant}</b> · {names[variant]} <small>Disposable · simulated actions</small></span>
      <button type="button" aria-label="Next prototype variant" onclick={() => changeVariant(1)}>→</button>
    </nav>
  {/if}
</main>

<style>
  .workflow-prototype-host { width: min(1600px, calc(100% - 24px)); margin: .6rem auto; padding: 0 0 4.5rem; }
  .workflow-prototype-host :global([data-workflow-area='bar'] .path) { top: 6.5rem; }
  .prototype-routes { display: flex; gap: .7rem; align-items: center; flex-wrap: wrap; padding: .3rem 0 .6rem; font-size: .75rem; }
  .prototype-routes a { text-transform: capitalize; color: #b7a58a; padding: .35rem .6rem; border-bottom: 1px solid transparent; }
  .prototype-routes a[aria-current] { color: #f2d183; border-color: #d8a64d; }
  .live-link { margin-left: auto; }
  .prototype-switcher { position: fixed; z-index: 100; left: 50%; bottom: .65rem; transform: translateX(-50%); display: flex; align-items: center; gap: .8rem; max-width: calc(100% - 1rem); padding: .25rem .4rem; color: #fff2d3; background: #151322f5; border: 1px solid #a499cf; border-radius: 2rem; box-shadow: 0 4px 18px #0008; }
  .prototype-switcher span { white-space: nowrap; font-size: .75rem; text-align: center; }
  .prototype-switcher small { display: block; color: #b8b3ce; font-size: .6rem; }
  .prototype-switcher button { border: 0; border-radius: 50%; background: transparent; color: inherit; width: 40px; height: 40px; cursor: pointer; }
  .prototype-switcher button:focus-visible, .prototype-routes a:focus-visible { outline: 2px solid #f9df9e; outline-offset: 2px; }
</style>
