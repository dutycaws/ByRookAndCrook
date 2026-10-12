<script lang="ts">
  import { tick } from 'svelte';
  import type { Snippet } from 'svelte';
  let { title, eyebrow, location, backLabel = 'Back', onback, focusKey, inspectionMode = 'folio', showFolio = true, showHand = true, sceneAspect, scene, status, folio, hand, controls }: {
    title: string; eyebrow?: string; location?: string; backLabel?: string; onback?: () => void;
    focusKey?: string | null; inspectionMode?: 'folio' | 'center' | 'dialogue'; showFolio?: boolean; showHand?: boolean; sceneAspect?: number; scene: Snippet;
    status?: Snippet; folio?: Snippet; hand?: Snippet; controls?: Snippet;
  } = $props();
  let folioElement = $state<HTMLElement>();
  $effect(() => {
    if (!focusKey || !folio || !showFolio) return;
    void tick().then(() => folioElement?.focus({ preventScroll: true }));
  });
  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !onback) return;
    if (document.querySelector('dialog[open]')) return;
    // Let native selects dismiss their own option list without leaving inspection.
    if (event.target instanceof HTMLSelectElement) return;
    event.preventDefault(); onback();
  }
</script>

<svelte:window onkeydown={escape} />
<section class="card-workflow-frame" class:native-aspect={!!sceneAspect} style:--workflow-scene-aspect={sceneAspect} class:centered={inspectionMode === 'center'} class:dialogue={inspectionMode === 'dialogue'} class:has-folio={showFolio && !!folio} class:has-hand={showHand && !!hand} aria-label={title}>
  <div class="workflow-scene">{@render scene()}</div>
  <header class="workflow-heading">
    <div>{#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}<h1>{title}</h1>
      {#if location || onback}<nav aria-label="Current location">{#if onback}<button type="button" onclick={onback}>← {backLabel}</button>{/if}{#if location}<span>{location}</span>{/if}</nav>{/if}
    </div>
    {#if status || controls}<div class="workflow-tools">{#if status}{@render status()}{/if}{#if controls}{@render controls()}{/if}</div>{/if}
  </header>
  {#if hand}<div class="workflow-dock" hidden={!showHand}>{@render hand()}</div>{/if}
  {#if folio}<section bind:this={folioElement} class="workflow-folio" hidden={!showFolio} tabindex="-1" aria-label={`${title} details`}>{@render folio()}</section>{/if}
</section>

<style>
  .card-workflow-frame { position: relative; isolation: isolate; width: 100%; min-height: 600px; height: calc(100dvh - 100px); max-height: 1100px; overflow: hidden; border: 1px solid #92723f77; border-radius: .85rem; background: #140e08; color: #f0dfb8; }
  .card-workflow-frame::after { content: ''; position: absolute; z-index: 1; inset: 0; pointer-events: none; background: linear-gradient(#0c080655,transparent 35%,#0c08068c); }
  .workflow-scene { position: absolute; inset: 0; }
  .workflow-scene :global(.area-scene) { width: 100%; height: 100%; min-height: 0; max-height: none; aspect-ratio: auto; margin: 0; }
  .card-workflow-frame .workflow-scene :global(.tavern-scene-stack) { height: 100%; display: block; }
  .card-workflow-frame .workflow-scene :global(.tavern-scene-stack .tavern-scene) { height: 100%; aspect-ratio: auto; border: 0; box-shadow: none; }
  .workflow-heading { position: absolute; z-index: 8; inset: 1rem 1.3rem auto; display: flex; justify-content: space-between; align-items: start; gap: 1rem; pointer-events: none; text-shadow: 0 2px 4px #000; }
  .workflow-heading h1 { margin: 0; font-size: clamp(1.2rem,2.2vw,2rem); }
  .eyebrow { margin: 0 0 .3rem; font-size: .62rem; color: #d9b772; letter-spacing: .1em; text-transform: uppercase; }
  .workflow-heading nav { display: flex; gap: .7rem; align-items: center; margin-top: .4rem; font-size: .78rem; }
  .workflow-heading button, .workflow-tools { pointer-events: auto; }
  .workflow-heading nav button { min-height: 40px; padding: .4rem .6rem; border: 1px solid #9a793c; border-radius: .4rem; background: #20170ad9; color: #f0d394; font: inherit; cursor: pointer; }
  .workflow-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: end; gap: .6rem; max-width: 50%; }
  .workflow-folio { position: absolute; z-index: 4; right: 1.3rem; top: 6rem; max-height: calc(100% - 26rem); width: min(25rem,35%); overflow: auto; padding: 1rem 1.1rem; border: 1px solid #a786454d; border-radius: .65rem; background: #1b140ed9; backdrop-filter: blur(4px); scrollbar-width: thin; animation: folio-arrive 180ms ease-out; }
  .card-workflow-frame:not(.has-hand) .workflow-folio { max-height: calc(100% - 7.3rem); }
  .workflow-folio :global(h2) { margin: 0 0 .6rem; font-size: 1.2rem; }
  .workflow-folio :global(p) { line-height: 1.5; }
  .workflow-dock { position: absolute; z-index: 5; left: 0; right: 0; bottom: .3rem; min-width: 0; animation: hand-arrive 200ms ease-out; }
  .card-workflow-frame.centered .workflow-folio { z-index: 6; left: 50%; right: auto; top: 6rem; bottom: auto; translate: -50% 0; width: min(24rem,calc(100% - 3rem)); max-height: calc(100% - 10rem); border: 0; padding: .25rem; background: transparent; backdrop-filter: none; overflow: auto; }
  .card-workflow-frame.dialogue .workflow-folio { z-index: 6; left: 50%; right: auto; top: auto; bottom: 2rem; translate: -50% 0; width: min(42rem,calc(100% - 3rem)); max-height: calc(100% - 9rem); }
  .workflow-folio[hidden], .workflow-dock[hidden] { display: none; }
  .workflow-folio:focus-visible, .workflow-heading button:focus-visible { outline: 2px solid #ffe49c; outline-offset: 3px; }
  @keyframes folio-arrive { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes hand-arrive { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @media (min-width: 1001px) { .card-workflow-frame.native-aspect { height: auto; min-height: 0; max-height: none; aspect-ratio: var(--workflow-scene-aspect); } }
  @media (min-width: 701px) and (max-height: 800px) {
    .card-workflow-frame.centered .workflow-folio { max-height: min(calc(100% - 8rem), calc(100dvh - 15rem)); }
  }
  @media (max-width: 700px) {
    .card-workflow-frame { display: flex; flex-direction: column; min-height: 340px; height: auto; max-height: none; padding-top: 340px; }
    .workflow-scene { bottom: auto; height: 340px; }
    .workflow-heading { inset: .8rem .8rem auto; }
    .workflow-heading h1 { font-size: 1.25rem; }
    .workflow-tools { font-size: .75rem; }
    .workflow-folio, .card-workflow-frame:not(.has-hand) .workflow-folio, .card-workflow-frame.centered .workflow-folio, .card-workflow-frame.dialogue .workflow-folio { position: relative; order: 2; inset: auto; translate: none; width: auto; max-height: 24rem; margin: .6rem; padding: .8rem; }
    .card-workflow-frame.centered .workflow-folio, .card-workflow-frame.dialogue .workflow-folio { order: 0; }
    .card-workflow-frame.centered .workflow-folio { max-height: none; }
    .workflow-dock { position: relative; order: 1; inset: auto; }
  }
  @media (prefers-reduced-motion: reduce) { .workflow-folio, .workflow-dock { animation: none; } }
</style>
