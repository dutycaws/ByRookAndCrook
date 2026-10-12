<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import type { Snippet } from 'svelte';
  import { resolveBurnAction, waitForBurn, type BurnStyle, type ResolvedBurnAction } from '$lib/card-effects';
  import CardHand from './CardHand.svelte';
  import CardHandCard from './CardHandCard.svelte';
  import CardBurnSurface from './CardBurnSurface.svelte';
  import TavernCardArt from '$lib/components/tavern/TavernCardArt.svelte';
  import type { WorkflowChoice } from './workflow';

  let { items, label, selectedId = null, focusId = null, burnStyle = 'drip', burningId = null, burnAction, pending = false, muted = false, onchoose, card: renderCard }: {
    items: WorkflowChoice[]; label: string; selectedId?: string | null; focusId?: string | null; burnStyle?: BurnStyle;
    pending?: boolean; muted?: boolean; onchoose: (id: string) => void | Promise<void>;
    burningId?: string | null; burnAction?: ResolvedBurnAction;
    card?: Snippet<[WorkflowChoice, number]>;
  } = $props();
  let activeId = $state<string | null>(null);
  let burning = $state(false);
  let error = $state<string | null>(null);
  let burn = $state(untrack(() => resolveBurnAction(burnStyle)));
  let controller: AbortController | undefined;
  let handRoot = $state<HTMLDivElement>();
  const handId = $props.id();
  onDestroy(() => controller?.abort());
  $effect(() => {
    // Selection changes should restore focus even if the requested target stays the same.
    const selection = selectedId;
    const id = focusId ?? selection;
    if (!id) return;
    void tick().then(() => Array.from(handRoot?.querySelectorAll<HTMLButtonElement>('[data-workflow-choice]') ?? []).find((button) => button.dataset.workflowChoice === id)?.focus({ preventScroll: true }));
  });

  async function choose(item: WorkflowChoice) {
    if (pending || activeId || item.disabled) return;
    activeId = item.id;
    error = null;
    controller = new AbortController();
    const signal = controller.signal;
    try {
      if (item.burn === true) {
        burn = resolveBurnAction(burnStyle);
        burning = true;
        await tick();
        if (!await waitForBurn(burn.durationMs, signal)) return;
      }
      if (!signal.aborted) await onchoose(item.id);
    } catch {
      if (!signal.aborted) error = 'That action could not be completed. Try again.';
    } finally {
      if (!signal.aborted) { activeId = null; burning = false; }
    }
  }
</script>

<div bind:this={handRoot} class="workflow-hand" aria-busy={pending || !!activeId}>
  {#if error}<p class="hand-error" role="alert">{error}</p>{/if}
  <CardHand {items} getKey={(item) => item.id} {label} selectedId={activeId ?? selectedId} {muted}>
    {#snippet card(item, index)}
      <CardBurnSurface active={burning || burningId === item.id} treatment={(burnAction ?? burn).treatment} durationMs={(burnAction ?? burn).durationMs}>
        <CardHandCard label={item.title} aria-describedby={`${handId}-${index}-details`} selected={selectedId === null ? undefined : item.id === selectedId} disabled={pending || !!activeId || !!burningId || item.disabled} shimmer data-workflow-choice={item.id} onclick={() => choose(item)}>
          <span id={`${handId}-${index}-details`} class="sr-only">{[item.description, item.meta, item.actionLabel].filter(Boolean).join(' · ')}</span>
          {#if renderCard}{@render renderCard(item, index)}{:else}
            <div class="choice-art" aria-hidden="true">
              {#if item.artwork}
                <TavernCardArt kind={item.artwork.kind} seed={item.artwork.seed} />
              {:else}
                {item.icon ?? '✧'}
              {/if}
            </div>
            <div class="choice-copy">
              {#if item.eyebrow}<p class="eyebrow">{item.eyebrow}</p>{/if}
              <h3>{item.title}</h3>
              {#if item.description}<p>{item.description}</p>{/if}
              {#if item.meta}<p class="choice-meta">{item.meta}</p>{/if}
            </div>
            <span class="choice-action">{item.actionLabel ?? 'Choose'} <span aria-hidden="true">↗</span></span>
          {/if}
        </CardHandCard>
      </CardBurnSurface>
    {/snippet}
  </CardHand>
</div>

<style>
  .workflow-hand { min-width: 0; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .choice-art { min-height: 4.7rem; display: grid; place-items: center; border-bottom: 1px solid #9d793f55; border-radius: .4rem; background: radial-gradient(ellipse at center,#86602e66,transparent 70%); color: #e0bb73; font-size: 2.7rem; }
  .choice-art :global(svg) { display: block; width: 4.7rem; height: 4.7rem; }
  .choice-copy { display: grid; align-content: start; gap: .35rem; }
  .choice-copy h3, .choice-copy p { margin: 0; }
  .choice-copy h3 { font-size: 1rem; }
  .choice-copy p { color: #cbb894; font-size: .75rem; line-height: 1.4; }
  .choice-copy .eyebrow { color: #d9b772; font-size: .62rem; letter-spacing: .1em; text-transform: uppercase; }
  .choice-copy .choice-meta { color: #e0c787; }
  .choice-action { display: flex; justify-content: space-between; border-top: 1px solid #92754455; padding-top: .5rem; color: #e0c787; font-size: .68rem; }
  .hand-error { margin: .5rem 1rem; padding: .6rem; color: #ffe2cc; background: #5d261ce6; border-radius: .4rem; font-size: .8rem; }
</style>
