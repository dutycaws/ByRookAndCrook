<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Snippet } from 'svelte';
  import type { ResolvedBurnAction } from '$lib/card-effects';
  import CardHandCard from './CardHandCard.svelte';
  import CardBurnSurface from './CardBurnSurface.svelte';
  import type { WorkflowChoice } from './workflow';
  let { item, onconfirm, oncancel, confirmLabel, consequence, pending = false, burning = false, burnAction, error, options }: {
    item: WorkflowChoice; onconfirm: () => void | Promise<void>; oncancel?: () => void;
    confirmLabel?: string; consequence?: string; pending?: boolean; burning?: boolean;
    burnAction?: ResolvedBurnAction; error?: string | null; options?: Snippet;
  } = $props();
  let surface = $state<HTMLDivElement>();
  let confirming = $state(false);
  let localError = $state<string | null>(null);
  onMount(() => { void tick().then(() => surface?.querySelector<HTMLElement>('[data-workflow-confirm]')?.focus({ preventScroll: true })); });
  async function confirm() {
    if (pending || burning || confirming || item.disabled) return;
    confirming = true; localError = null;
    try { await onconfirm(); }
    catch { localError = 'That action could not be completed. Try again.'; }
    finally { confirming = false; }
  }
</script>

<div class="workflow-inspection" bind:this={surface}>
  {#if error || localError}<p class="inspection-error" role="alert">{error ?? localError}</p>{/if}
  {#if options}<div class="inspection-options">{@render options()}</div>{/if}
  <CardBurnSurface active={burning} treatment={burnAction?.treatment ?? 'drip'} durationMs={burnAction?.durationMs ?? 1000}>
    <CardHandCard class="workflow-inspection-card" label={`${item.title}. ${consequence ?? item.description ?? ''} ${confirmLabel ?? item.actionLabel ?? 'Confirm'}.`} selected shimmer disabled={pending || burning || confirming || item.disabled} data-workflow-confirm={item.id} onclick={confirm}>
      <div class="inspection-art" aria-hidden="true">{item.icon ?? '✧'}</div>
      <div class="inspection-copy">
        {#if item.eyebrow}<p class="eyebrow">{item.eyebrow}</p>{/if}
        <h2>{item.title}</h2>
        {#if item.description}<p>{item.description}</p>{/if}
        {#if item.meta}<p class="inspection-meta">{item.meta}</p>{/if}
      </div>
      <span class="inspection-action">{pending || confirming ? 'Working…' : confirmLabel ?? item.actionLabel ?? 'Confirm'} <span aria-hidden="true">↗</span></span>
    </CardHandCard>
  </CardBurnSurface>
  {#if consequence}<p class="consequence">{consequence}</p>{/if}
  {#if oncancel}<button class="inspection-back" type="button" disabled={pending || burning || confirming} onclick={oncancel}>Choose another <span>· Escape</span></button>{/if}
</div>

<style>
  .workflow-inspection { display: grid; gap: .7rem; width: 100%; padding: .25rem; animation: inspect-arrive 200ms ease-out; }
  .workflow-inspection :global(.workflow-inspection-card) { min-height: 22rem; }
  .workflow-inspection :global(.workflow-inspection-card:disabled) { opacity: 1; }
  .inspection-options { padding: .8rem; border-radius: .5rem; background: #1b140ee8; }
  .inspection-art { display: grid; place-items: center; min-height: 7rem; font-size: 4rem; border-bottom: 1px solid #9d793f55; background: radial-gradient(ellipse at center,#86602e44,transparent 70%); }
  .inspection-copy { display: grid; align-content: start; gap: .5rem; }
  .inspection-copy h2, .inspection-copy p { margin: 0; }
  .inspection-copy h2 { font-size: 1.4rem; }
  .inspection-copy p { color: #d7c7a5; font-size: .9rem; line-height: 1.45; }
  .inspection-copy .eyebrow { color: #d9b772; font-size: .65rem; letter-spacing: .1em; text-transform: uppercase; }
  .inspection-copy .inspection-meta { color: #e5c788; }
  .inspection-action { display: flex; justify-content: space-between; padding-top: .7rem; border-top: 1px solid #92754455; color: #e0c787; font-size: .83rem; }
  .consequence { margin: 0; text-align: center; color: #cbb894; font-size: .78rem; }
  .inspection-back { justify-self: center; min-height: 44px; padding: .55rem .8rem; border: 1px solid #aa8955; border-radius: .55rem; color: #f0dfb8; background: #20170bd9; font: inherit; font-size: .78rem; cursor: pointer; }
  .inspection-back span { color: #cbb894; font-size: .68rem; }
  .inspection-back:focus-visible { outline: 2px solid #ffe49c; outline-offset: 3px; }
  .inspection-back:disabled { cursor: not-allowed; opacity: .6; }
  .inspection-error { margin: 0; padding: .65rem; color: #ffe2cc; background: #5d261ce6; border-radius: .4rem; font-size: .85rem; }
  @keyframes inspect-arrive { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: scale(1); } }
  @media (max-width: 700px) { .workflow-inspection :global(.workflow-inspection-card) { min-height: 19rem; } .inspection-art { min-height: 5.5rem; font-size: 3.5rem; } .inspection-copy h2 { font-size: 1.2rem; } .inspection-copy p { font-size: .85rem; } }
  @media (prefers-reduced-motion: reduce) { .workflow-inspection { animation: none; } }
</style>
