<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Snippet } from 'svelte';
  import { waitForBurn, type BurnTreatment } from '$lib/card-effects';
  import CardBurnEffect from './CardBurnEffect.svelte';

  type Props = {
    active?: boolean;
    treatment?: BurnTreatment;
    durationMs?: number;
    children: Snippet;
    oncomplete?: () => void;
  };

  let {
    active = false,
    treatment = 'drip',
    durationMs = 1000,
    children,
    oncomplete
  }: Props = $props();

  let safeDuration = $derived(Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0);
  let wasActive = false;
  let activationSequence = 0;
  let controller: AbortController | null = null;

  $effect(() => {
    if (!active) {
      wasActive = false;
      activationSequence += 1;
      controller?.abort();
      controller = null;
      return;
    }

    if (wasActive) return;
    wasActive = true;

    const sequence = ++activationSequence;
    const activation = untrack(() => ({ duration: safeDuration, complete: oncomplete }));
    const activeController = new AbortController();
    controller = activeController;

    void waitForBurn(activation.duration, activeController.signal).then((completed) => {
      if (!completed || sequence !== activationSequence || controller !== activeController || !active) return;
      controller = null;
      activation.complete?.();
    });
  });

  onDestroy(() => {
    activationSequence += 1;
    controller?.abort();
    controller = null;
  });
</script>

<div
  class="card-burn-surface"
  data-burn-treatment={active ? treatment : undefined}
  data-burn-duration={active ? safeDuration : undefined}
  style={`--card-burn-duration:${safeDuration}ms`}
>
  <div
    class="card-burn-content"
    class:burning={active}
    data-burn-treatment={active ? treatment : undefined}
    data-burn-duration={active ? safeDuration : undefined}
    aria-hidden={active}
    inert={active}
  >
    {@render children()}
  </div>
  {#if active}
    <CardBurnEffect {active} {treatment} durationMs={safeDuration} />
  {/if}
</div>

<style>
  .card-burn-surface { position: relative; display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: visible; }
  .card-burn-content { position: relative; width: 100%; min-width: 0; min-height: 0; }
  .card-burn-content.burning { pointer-events: none; animation-duration: var(--card-burn-duration); animation-timing-function: ease-in; animation-fill-mode: forwards; will-change: clip-path, opacity, filter; }

  .card-burn-content.burning[data-burn-treatment='crawl'] { animation-name: card-burn-crawl-away; }
  .card-burn-content.burning[data-burn-treatment='drip'] { animation-name: card-burn-drip-away; }
  .card-burn-content.burning[data-burn-treatment='ash'] { animation-name: card-burn-ash-away; }

  @keyframes card-burn-crawl-away {
    0%, 18% { clip-path: inset(0 round 1rem); opacity: 1; }
    72% { clip-path: inset(30% round 1rem); opacity: .88; }
    100% { clip-path: inset(50% round 1rem); opacity: 0; filter: brightness(.45) grayscale(.8); }
  }
  @keyframes card-burn-drip-away {
    0%, 14% { clip-path: inset(0 0 0 0 round 1rem); opacity: 1; }
    56% { clip-path: inset(45% 0 0 0 round 1rem); opacity: 1; }
    82% { clip-path: inset(78% 0 0 0 round 1rem); opacity: .8; }
    100% { clip-path: inset(100% 0 0 0 round 1rem); opacity: 0; filter: brightness(.35) grayscale(.9); }
  }
  @keyframes card-burn-ash-away {
    0%, 17% { clip-path: polygon(0 0,42% 0,50% 8%,58% 0,100% 0,100% 42%,92% 50%,100% 58%,100% 100%,58% 100%,50% 92%,42% 100%,0 100%,0 58%,8% 50%,0 42%); opacity: 1; }
    64% { clip-path: polygon(40% 40%,46% 41%,50% 36%,54% 41%,60% 40%,60% 46%,64% 50%,60% 54%,60% 60%,54% 59%,50% 64%,46% 59%,40% 60%,40% 54%,36% 50%,40% 46%); opacity: .85; }
    100% { clip-path: polygon(50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%); opacity: 0; filter: grayscale(.9) blur(1px); }
  }

  @media (prefers-reduced-motion: reduce) {
    .card-burn-content.burning { animation: none !important; }
  }
</style>
