<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { tick } from 'svelte';
  import {
    TRINKET_ARTWORK,
    TRINKET_EFFECT_CATALOG,
    type OwnedTrinket,
    type TrinketSlot
  } from '$lib/game/trinkets';

  type SwapCommand = {
    saveId: string;
    trinketId: string;
    targetSlot: number | null;
    actionId: string;
    expectedRevision: number;
  };

  type Props = {
    collection: OwnedTrinket[];
    saveId: string;
    revision: number;
    selectedId: string;
    targetSlot?: TrinketSlot | null;
    disabled?: boolean;
    onselect: (id: string) => void;
    oncomplete?: () => void;
    onbusychange?: (busy: boolean) => void;
  };

  let {
    collection,
    saveId,
    revision,
    selectedId,
    targetSlot = null,
    disabled = false,
    onselect,
    oncomplete,
    onbusychange
  }: Props = $props();

  let pendingCommand = $state<SwapCommand | null>(null);
  let pending = $state(false);
  let message = $state('');
  let messageKind = $state<'status' | 'error'>('status');
  let replacementOpen = $state(false);
  let collectionHeading = $state<HTMLHeadingElement>();
  let previousTargetSlot: TrinketSlot | null | undefined;
  const targetItem = $derived(targetSlot === null ? null : collection.find((item) => item.slot === targetSlot) ?? null);
  const isBusy = $derived(pending || pendingCommand !== null);

  $effect(() => {
    const nextTargetSlot = targetSlot;
    if (previousTargetSlot !== undefined && nextTargetSlot !== previousTargetSlot) {
      replacementOpen = false;
    }
    previousTargetSlot = nextTargetSlot;
  });

  $effect(() => {
    onbusychange?.(isBusy);
  });

  async function sendSwap(command: SwapCommand) {
    pending = true;
    message = '';

    try {
      const response = await fetch('/api/trinkets/swap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command)
      });

      let body: { receipt?: { status?: string }; message?: string } = {};
      try {
        body = await response.json();
      } catch {
        // Keep the command for a safe retry if the result is unknown.
      }

      if (!response.ok) {
        message = body.message ?? 'The keepsake arrangement could not be changed.';
        messageKind = response.status >= 500 ? 'error' : 'status';

        if (response.status < 500) {
          pendingCommand = null;
          if (response.status === 409) await invalidateAll();
        }

        return;
      }

      pendingCommand = null;
      message = body.receipt?.status === 'unchanged'
        ? 'That keepsake is already in the chosen place.'
        : command.targetSlot === null
          ? 'Keepsake returned to the collection.'
          : `Keepsake moved to slot ${command.targetSlot + 1}.`;
      messageKind = 'status';

      try {
        await invalidateAll();
        if (command.targetSlot !== null) oncomplete?.();
      } catch {
        message = 'The swap was saved, but the latest collection could not be loaded. Refresh the bar to continue.';
        messageKind = 'error';
      }
    } catch {
      message = 'The swap result is unknown. Retry the same arrangement to check whether it was saved.';
      messageKind = 'error';
    } finally {
      pending = false;
    }
  }

  function move(trinketId: string, nextSlot: TrinketSlot | null) {
    if (disabled || pending || pendingCommand) return;

    const command: SwapCommand = {
      saveId,
      trinketId,
      targetSlot: nextSlot,
      actionId: crypto.randomUUID(),
      expectedRevision: revision
    };

    pendingCommand = command;
    void sendSwap(command);
  }

  function retry() {
    if (pendingCommand && !pending && !disabled) void sendSwap(pendingCommand);
  }

  async function openReplacement() {
    replacementOpen = true;
    await tick();
    collectionHeading?.focus({ preventScroll: true });
  }

  function removeTarget() {
    if (!targetItem) return;
    void openReplacement();
    move(targetItem.id, null);
  }

  function replaceTargetWith(item: OwnedTrinket) {
    if (targetSlot === null) return;
    onselect(item.id);
    move(item.id, targetSlot);
  }
</script>

<section class="trinket-collection" aria-label="Keepsake slot details and collection">
  {#if targetSlot === null}
    <p class="trinket-empty-copy">Choose a keepsake spot in the room to see its details and collection.</p>
  {:else if targetItem && !replacementOpen}
    <article class="trinket-detail" aria-label={`${targetItem.name} details`}>
      <img
        class="trinket-detail-art"
        src={TRINKET_ARTWORK[targetItem.artworkId].src}
        alt={TRINKET_ARTWORK[targetItem.artworkId].alt}
      />
      <div class="trinket-detail-copy">
        <h2>{targetItem.name}</h2>
        <p class="trinket-effect">{TRINKET_EFFECT_CATALOG[targetItem.catalogId].label}</p>
        <p class="trinket-dedication">{targetItem.dedication}</p>
      </div>
    </article>

    <div class="trinket-actions" aria-label="Keepsake actions">
      <button
        class="trinket-action secondary"
        type="button"
        disabled={disabled || isBusy}
        onclick={removeTarget}
      >
        Remove
      </button>
      <button
        class="trinket-action"
        type="button"
        disabled={disabled || isBusy}
        onclick={openReplacement}
      >
        Replace
      </button>
    </div>
  {:else}
    {#if targetItem}
      <p class="trinket-context">
        Choose a keepsake to replace <strong>{targetItem.name}</strong> in slot {targetSlot + 1}.
      </p>
    {:else}
      <p class="trinket-context">Slot {targetSlot + 1} is empty. Choose a keepsake for this spot.</p>
    {/if}

    {#if collection.length}
      <div class="trinket-inventory" aria-label="Keepsake collection">
        <h2 bind:this={collectionHeading} tabindex="-1">Collection</h2>
        {#each collection as item (item.id)}
          <article class="trinket-item" class:selected={selectedId === item.id}>
            <img class="trinket-art" src={TRINKET_ARTWORK[item.artworkId].src} alt={TRINKET_ARTWORK[item.artworkId].alt} />
            <div class="trinket-item-copy">
              <strong>{item.name}</strong>
              <small>{TRINKET_EFFECT_CATALOG[item.catalogId].label}</small>
              <p>{item.dedication}</p>
              <small>{item.slot === null ? 'In collection' : `Active in slot ${item.slot + 1}`}</small>
            </div>
            <button
              class="trinket-action place-action"
              type="button"
              disabled={disabled || isBusy || item.slot === targetSlot}
              aria-label={item.slot === targetSlot
                ? `${item.name} is already in slot ${targetSlot + 1}`
                : `Place ${item.name} in slot ${targetSlot + 1}`}
              onclick={() => replaceTargetWith(item)}
            >
              {item.slot === targetSlot ? 'Here' : 'Place here'}
            </button>
          </article>
        {/each}
      </div>
    {:else}
      <p class="trinket-empty-copy">Your first keepsake arrives when a connected resident completes their first authored quest.</p>
    {/if}
  {/if}

  {#if pendingCommand && !pending}
    <button class="trinket-retry" type="button" onclick={retry} disabled={disabled}>
      Retry the same swap
    </button>
  {/if}
  {#if message}
    <p class="trinket-message" class:trinket-error={messageKind === 'error'} role={messageKind === 'error' ? 'alert' : 'status'}>{message}</p>
  {/if}
</section>

<style>
  .trinket-collection { display: grid; gap: .8rem; min-width: 0; margin: 0; padding: 0; }
  .trinket-detail { display: grid; grid-template-columns: 4rem minmax(0, 1fr); align-items: center; gap: .8rem; padding: .25rem 0; }
  .trinket-detail-art { display: block; inline-size: 4rem; block-size: 4rem; object-fit: contain; filter: drop-shadow(0 2px 4px rgb(0 0 0 / .5)); }
  .trinket-detail-copy { display: grid; gap: .25rem; min-width: 0; }
  .trinket-detail h2, .trinket-inventory h2 { margin: 0; color: #e6ca7a; font: 600 .95rem 'Cinzel', Georgia, serif; }
  .trinket-effect, .trinket-dedication { margin: 0; color: #c9bb9b; font-size: .83rem; line-height: 1.4; }
  .trinket-dedication { color: #bba880; }
  .trinket-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
  .trinket-action, .trinket-retry { min-height: 2.75rem; padding: .4rem .7rem; border: 1px solid #80602e; border-radius: .25rem; color: #f0d27a; background: #171108; font: 600 .78rem 'Cinzel', Georgia, serif; cursor: pointer; }
  .trinket-action:hover, .trinket-retry:hover { border-color: #d2aa51; background: #261b0b; }
  .trinket-action.secondary { color: #d8c7a2; background: transparent; }
  .trinket-action:disabled, .trinket-retry:disabled { opacity: .55; cursor: not-allowed; }
  .trinket-context, .trinket-empty-copy, .trinket-message { margin: 0; color: #c9bb9b; font-size: .84rem; line-height: 1.45; }
  .trinket-context strong { color: #e6ca7a; }
  .trinket-inventory { display: grid; gap: .45rem; }
  .trinket-inventory h2 { margin: .1rem 0; }
  .trinket-item { display: grid; grid-template-columns: 2.2rem minmax(0, 1fr) auto; align-items: center; gap: .55rem; padding: .5rem; border-left: 2px solid #73552a; background: rgb(6 5 3 / .32); }
  .trinket-item.selected { border-left-color: #e3c36f; }
  .trinket-art { display: block; inline-size: 2.2rem; block-size: 2.2rem; object-fit: contain; filter: drop-shadow(0 2px 3px rgb(0 0 0 / .5)); }
  .trinket-item-copy { display: grid; gap: .15rem; min-width: 0; }
  .trinket-item-copy strong { color: #e6ca7a; font: 600 .78rem 'Cinzel', Georgia, serif; }
  .trinket-item-copy small { color: #a89468; font-size: .72rem; line-height: 1.25; }
  .trinket-item-copy p { margin: 0; color: #bba880; font-size: .78rem; line-height: 1.3; }
  .place-action { min-width: 5rem; font-size: .72rem; }
  .trinket-retry { justify-self: start; }
  .trinket-message { color: #a9c981; }
  .trinket-message.trinket-error { color: #ffc0af; }
  .trinket-action:focus-visible, .trinket-retry:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }

  @media (max-width: 520px) {
    .trinket-item { grid-template-columns: 2rem minmax(0, 1fr); }
    .trinket-art { inline-size: 2rem; block-size: 2rem; }
    .place-action { grid-column: 2; justify-self: start; }
  }
</style>
