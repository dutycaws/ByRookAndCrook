<script lang="ts">
  import { onMount, tick, untrack, type Snippet } from 'svelte';
  import type { GameSnapshot, GardenCell } from '$lib/game/contracts';
  import GardenCarePanel from './GardenCarePanel.svelte';
  import GardenProvisionPanel from './GardenProvisionPanel.svelte';

  let {
    snapshot,
    selected,
    batchMode = null,
    batchTargetIds = new Set<string>(),
    openRequest = null,
    onstartbatch = () => {},
    oncancelbatch = () => {},
    harvest = undefined
  }: {
    snapshot: GameSnapshot;
    selected: GardenCell | null;
    batchMode?: 'water' | 'amend' | null;
    batchTargetIds?: Set<string>;
    openRequest?: string | null;
    onstartbatch?: (kind: 'water' | 'amend') => void;
    oncancelbatch?: () => void;
    harvest?: Snippet;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let trigger = $state<HTMLButtonElement>();
  let inlineSurface = $state<HTMLDivElement>();
  let desktopOpen = $state(untrack(() => Boolean(openRequest)));
  let mobile = $state(false);
  let mounted = $state(false);
  let handledOpenRequest: string | null = untrack(() => openRequest);
  let restoreTriggerOnClose = true;

  onMount(() => {
    const query = window.matchMedia('(max-width: 620px)');
    mobile = query.matches;
    mounted = true;
    if (openRequest && query.matches) queueMicrotask(() => void showMobileActions());

    const update = () => void transitionBreakpoint(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });

  $effect(() => {
    const request = openRequest;
    if (!mounted || !request || request === handledOpenRequest) return;
    handledOpenRequest = request;
    void revealActions();
  });

  function focusSelectorFor(element: Element | null) {
    if (!(element instanceof HTMLElement)) return null;
    for (const attribute of ['data-batch-start', 'data-garden-command', 'data-apiary-command']) {
      const value = element.getAttribute(attribute);
      if (value) return `[${attribute}="${value}"]`;
    }
    return element.id ? `#${CSS.escape(element.id)}` : null;
  }

  async function focusAction(container: HTMLElement | undefined, selector: string | null = null) {
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const matching = selector ? container?.querySelector<HTMLElement>(selector) : null;
    const firstAction = container?.querySelector<HTMLElement>(
      '[data-batch-start], [data-garden-command], [data-apiary-command], summary, select, input, button:not([aria-label="Close actions"])'
    );
    (matching ?? firstAction)?.focus();
  }

  async function showMobileActions(focusSelector: string | null = null) {
    restoreTriggerOnClose = true;
    if (!dialog?.open) dialog?.showModal();
    await focusAction(dialog, focusSelector);
  }

  async function revealActions() {
    if (mobile) {
      await showMobileActions();
    } else {
      desktopOpen = true;
      await tick();
      await focusAction(inlineSurface);
    }
  }

  async function transitionBreakpoint(nextMobile: boolean) {
    if (mobile === nextMobile) return;

    const active = document.activeElement;
    const actionsWereOpen = mobile ? Boolean(dialog?.open) : desktopOpen;
    const focusWasInActions = mobile
      ? Boolean(active && dialog?.contains(active))
      : Boolean(active && inlineSurface?.contains(active));
    const focusSelector = focusSelectorFor(active);

    if (mobile && dialog?.open) {
      restoreTriggerOnClose = false;
      dialog.close();
    }

    mobile = nextMobile;
    desktopOpen = !nextMobile && actionsWereOpen;

    if (nextMobile && actionsWereOpen) {
      await showMobileActions(focusSelector);
    } else if (!nextMobile && actionsWereOpen && focusWasInActions) {
      await tick();
      await focusAction(inlineSurface, focusSelector);
    } else if (focusWasInActions) {
      await restoreTriggerFocus();
    }
  }

  async function openActions() {
    if (mobile) {
      await showMobileActions();
    } else {
      desktopOpen = !desktopOpen;
    }
  }

  async function restoreTriggerFocus() {
    await tick();
    trigger?.focus();
  }

  function closeDialog() {
    restoreTriggerOnClose = true;
    dialog?.close();
  }

  function dialogClosed() {
    if (restoreTriggerOnClose) void restoreTriggerFocus();
    restoreTriggerOnClose = true;
  }

  function startBatch(kind: 'water' | 'amend') {
    restoreTriggerOnClose = false;
    onstartbatch(kind);
    if (mobile) dialog?.close();
  }

  function handleEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || mobile || !desktopOpen || batchMode) return;
    event.preventDefault();
    desktopOpen = false;
    void restoreTriggerFocus();
  }
</script>

<svelte:window onkeydown={handleEscape} />

<section class="garden-actions" aria-label={`Actions for ${selected?.layoutKey ?? 'selected plot'}`}>
  <button
    bind:this={trigger}
    type="button"
    class="primary-button actions-trigger"
    data-garden-actions-trigger
    aria-expanded={mobile ? undefined : desktopOpen}
    aria-controls={mobile ? undefined : 'garden-actions-inline'}
    onclick={openActions}
  >
    Actions
  </button>

  {#if !mobile && desktopOpen}
    <div bind:this={inlineSurface} id="garden-actions-inline" class="actions-surface">
      {#if selected?.kind !== 'beehive'}<GardenCarePanel {snapshot} {selected} {batchMode} {batchTargetIds} onstartbatch={startBatch} {oncancelbatch} />{/if}
      {#if selected?.kind === 'empty' || selected?.kind === 'beehive'}<GardenProvisionPanel {snapshot} {selected} />{/if}
      {#if harvest}{@render harvest()}{/if}
    </div>
  {/if}

  <dialog bind:this={dialog} class="actions-dialog" aria-labelledby="garden-actions-title" onclose={dialogClosed}>
    <div class="dialog-heading">
      <div><p class="eyebrow">Selected plot</p><h2 id="garden-actions-title">Actions for {selected?.layoutKey ?? 'plot'}</h2></div>
      <button type="button" class="text-button" aria-label="Close actions" onclick={closeDialog}>Close</button>
    </div>
    {#if mobile}
      {#if selected?.kind !== 'beehive'}<GardenCarePanel {snapshot} {selected} {batchMode} {batchTargetIds} onstartbatch={startBatch} {oncancelbatch} />{/if}
      {#if selected?.kind === 'empty' || selected?.kind === 'beehive'}<GardenProvisionPanel {snapshot} {selected} />{/if}
      {#if harvest}{@render harvest()}{/if}
    {/if}
  </dialog>
</section>

<style>
  .garden-actions { display: grid; gap: .65rem; }
  .actions-trigger { width: 100%; }
  .actions-surface { display: grid; gap: .8rem; }
  .actions-dialog { width: min(100%, 42rem); max-height: min(80dvh, 46rem); margin: auto 0 0; padding: 1rem; border: 1px solid #80612d; color: #e6d0a2; background: #120e08; box-shadow: 0 -14px 36px #000c; overflow: auto; }
  .actions-dialog::backdrop { background: #000a; }
  .dialog-heading { display: flex; align-items: start; justify-content: space-between; gap: .75rem; padding-bottom: .75rem; border-bottom: 1px solid #4a371c; }
  .dialog-heading h2 { margin: .2rem 0 0; font-size: 1rem; }
  .text-button { min-height: 36px; padding: .3rem .55rem; border: 1px solid #5c4727; color: #bda572; background: transparent; }
  @media (min-width: 621px) { .actions-dialog { display: none; } }
  @media (max-width: 620px) { .actions-dialog { padding-bottom: max(1rem, env(safe-area-inset-bottom)); } }
</style>
