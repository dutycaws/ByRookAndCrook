<script lang="ts">
  import { tick } from 'svelte';
  import FloatingSurface from '$lib/components/ui/FloatingSurface.svelte';
  import {
    TRINKET_ARTWORK,
    TRINKET_EFFECT_CATALOG,
    type OwnedTrinket,
    type TrinketSlot
  } from '$lib/game/trinkets';
  import type { BarPrototypeModel } from './types';

  type Props = {
    model: BarPrototypeModel;
    treatment?: 'B' | 'E' | 'F';
  };

  type SlotAnchor = {
    slot: TrinketSlot;
    left: string;
    top: string;
  };

  let { model, treatment = 'B' }: Props = $props();

  const slotAnchors: readonly SlotAnchor[] = [
    { slot: 0, left: '3.5%', top: '19%' },
    { slot: 1, left: '85%', top: '19%' },
    { slot: 2, left: '3.5%', top: '34%' },
    { slot: 3, left: '85%', top: '34%' }
  ];

  let activeSlot = $state<TrinketSlot | null>(null);
  let activeSlotOpener = $state<HTMLButtonElement>();
  let selectedTrinketId = $state<string | null>(null);
  let localSlotAssignments = $state<Record<string, TrinketSlot | null>>({});
  let sampleTrinkets = $state<OwnedTrinket[]>([]);
  let announcement = $state('');
  let choosingTrinket = $state(false);

  let journalCloseButton = $state<HTMLButtonElement>();
  let slotCloseButton = $state<HTMLButtonElement>();
  let detailElement = $state<HTMLElement>();

  const collection = $derived([...model.trinkets, ...sampleTrinkets]);
  const selectedTrinket = $derived(
    collection.find((item) => item.id === selectedTrinketId) ?? null
  );
  const selectedTrinketSlot = $derived(
    selectedTrinket ? slotFor(selectedTrinket) : null
  );

  function slotFor(item: OwnedTrinket): TrinketSlot | null {
    return Object.prototype.hasOwnProperty.call(localSlotAssignments, item.id)
      ? localSlotAssignments[item.id]
      : item.slot;
  }

  async function openJournal() {
    if (!model.selected) return;
    activeSlot = null;
    activeSlotOpener = undefined;
    selectedTrinketId = null;
    model.onjournal();
    await tick();
    journalCloseButton?.focus({ preventScroll: true });
  }

  function closeJournal() {
    model.onjournalclose();
  }

  async function toggleSlotDetails(slot: TrinketSlot, event: MouseEvent) {
    if (model.selected) return;

    if (activeSlot === slot) {
      await closeSlotDetails();
      return;
    }

    activeSlotOpener = event.currentTarget as HTMLButtonElement;
    activeSlot = slot;
    selectedTrinketId = collection.find((item) => slotFor(item) === slot)?.id ?? null;
    choosingTrinket = selectedTrinketId === null;
    announcement = '';
    await tick();
    slotCloseButton?.focus({ preventScroll: true });
  }

  async function closeSlotDetails() {
    const opener = activeSlotOpener;
    activeSlot = null;
    activeSlotOpener = undefined;
    selectedTrinketId = null;
    await tick();
    if (!model.selected && opener?.isConnected && !opener.disabled) {
      opener.focus({ preventScroll: true });
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;

    if (activeSlot !== null && !model.selected) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void closeSlotDetails();
    } else if (model.mode === 'journal' && model.selected) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeJournal();
    }
  }

  $effect(() => {
    if (!model.selected || activeSlot === null) return;
    activeSlot = null;
    activeSlotOpener = undefined;
    selectedTrinketId = null;
  });

  async function selectTrinket(id: string) {
    selectedTrinketId = id;
    choosingTrinket = false;
    await tick();
    detailElement?.focus({ preventScroll: true });
  }

  function addSampleTrinkets() {
    if (sampleTrinkets.length > 0) return;

    sampleTrinkets = [
      {
        id: 'prototype-sample-copper-leaf',
        sourceNpcId: 'prototype-sample',
        sourceMilestoneId: 'prototype-sample',
        catalogId: 'food_revenue',
        artworkId: 'copper-leaf',
        name: 'Copper Leaf',
        dedication: 'Local preview sample dedication.',
        slot: null,
        earnedAt: 'prototype-preview'
      },
      {
        id: 'prototype-sample-brass-seal',
        sourceNpcId: 'prototype-sample',
        sourceMilestoneId: 'prototype-sample',
        catalogId: 'drink_revenue',
        artworkId: 'brass-seal',
        name: 'Brass Seal',
        dedication: 'Local preview sample dedication.',
        slot: null,
        earnedAt: 'prototype-preview'
      }
    ];
    selectedTrinketId = 'prototype-sample-copper-leaf';
    choosingTrinket = false;
    announcement = 'Two local sample trinkets added to the preview.';
  }

  async function placeSelectedTrinket() {
    const destination = activeSlot;
    if (!selectedTrinket || destination === null) return;

    const nextAssignments = { ...localSlotAssignments };
    for (const item of collection) {
      if (item.id !== selectedTrinket.id && slotFor(item) === destination) {
        nextAssignments[item.id] = null;
      }
    }

    nextAssignments[selectedTrinket.id] = destination;
    localSlotAssignments = nextAssignments;
    announcement = selectedTrinket.name + ' placed in slot ' + (destination + 1) + ' for this preview.';
    await tick();
    detailElement?.focus({ preventScroll: true });
  }

  async function removeSelectedTrinket() {
    if (!selectedTrinket || selectedTrinketSlot === null) return;
    const previousSlot = selectedTrinketSlot;
    localSlotAssignments = {
      ...localSlotAssignments,
      [selectedTrinket.id]: null
    };
    announcement = selectedTrinket.name + ' removed from slot ' + (previousSlot + 1) + ' in this preview.';
    await tick();
    detailElement?.focus({ preventScroll: true });
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="prototype-scene-tools treatment-{treatment.toLowerCase()}">
  <div
    class="scene-keepsake-anchors"
    class:has-patron={model.selected !== null}
    role="group"
    aria-label="Keepsake display slots"
    aria-hidden={model.selected ? 'true' : undefined}
    inert={model.selected !== null}
  >
    {#each slotAnchors as anchor (anchor.slot)}
      {@const item = collection.find((entry) => slotFor(entry) === anchor.slot) ?? null}
      <button
        class="scene-keepsake-place"
        class:active={activeSlot === anchor.slot}
        type="button"
        data-keepsake-slot={anchor.slot + 1}
        style={'left:' + anchor.left + ';top:' + anchor.top}
        aria-label={item
          ? 'Keepsake slot ' + (anchor.slot + 1) + ', ' + item.name + '. Open its details.'
          : 'Keepsake slot ' + (anchor.slot + 1) + ', empty. Open its collection.'}
        aria-expanded={activeSlot === anchor.slot}
        aria-controls="prototype-slot-details"
        aria-pressed={activeSlot === anchor.slot}
        disabled={model.selected !== null}
        onclick={(event) => void toggleSlotDetails(anchor.slot, event)}
      >
        {#if item}
          <span class="scene-keepsake-art" aria-hidden="true">
            <img src={TRINKET_ARTWORK[item.artworkId].src} alt="" />
          </span>
        {:else}
          <span class="scene-keepsake-empty" aria-hidden="true">◇</span>
        {/if}
      </button>
    {/each}
  </div>

  {#if model.selected}
    <div class="tool-buttons" role="group" aria-label="Scene tools">
      <button
        class="tool-button journal-opener"
        type="button"
        data-prototype-opener="journal"
        aria-expanded={model.mode === 'journal'}
        aria-controls="prototype-scene-journal"
        onclick={openJournal}
      >Journal</button>
    </div>
  {/if}

  {#if model.selected && model.mode === 'journal'}
    <FloatingSurface
      as="section"
      class="tool-popover journal-popover"
      id="prototype-scene-journal"
      role="region"
      aria-labelledby="prototype-journal-title"
      tabindex={-1}
      data-prototype-tool-open
    >
      <header class="popover-header journal-header">
        <div>
          <p class="eyebrow">{model.selected.name}</p>
          <h2 id="prototype-journal-title">Recent notes</h2>
        </div>
        <button
          bind:this={journalCloseButton}
          class="close-button"
          type="button"
          aria-label="Close journal"
          onclick={closeJournal}
        >×</button>
      </header>

      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable journal needs keyboard focus.) -->
      <div class="journal-body" role="region" tabindex="0" aria-label="Journal entries">
        {#if model.history.length > 0}
          <ol class="journal-entries">
            {#each model.history as entry (entry.id)}
              <li class="journal-entry">
                <span class="entry-label">{entry.label ?? entry.kind}</span>
                <p>{entry.text}</p>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="empty-message">Nothing has been recorded yet.</p>
        {/if}
      </div>

      <footer class="journal-footer">
        <a class="archive-link" href={model.archiveHref}>Open the archive</a>
      </footer>
    </FloatingSurface>
  {/if}

  {#if activeSlot !== null && !model.selected}
    <FloatingSurface
      as="section"
      class={'tool-popover slot-popover ' + (activeSlot % 2 === 0 ? 'slot-left' : 'slot-right')}
      id="prototype-slot-details"
      role="region"
      aria-labelledby="prototype-slot-title"
      tabindex={-1}
      style={'--slot-y:' + (activeSlot < 2 ? '19%' : '34%')}
      data-prototype-tool-open
    >
      <header class="popover-header">
        <div>
          <p class="eyebrow">Keepsake slot {activeSlot + 1}</p>
          <h2 id="prototype-slot-title">{choosingTrinket ? 'Choose a trinket' : selectedTrinket?.name ?? 'Empty slot'}</h2>
        </div>
        <button
          bind:this={slotCloseButton}
          class="close-button"
          type="button"
          aria-label="Close slot details"
          onclick={closeSlotDetails}
        >×</button>
      </header>

      <div class="slot-body">
      {#if choosingTrinket}
      {#if collection.length === 0}
        <div class="empty-collection">
          <p>Your collection is empty.</p>
          <button class="secondary-button" type="button" onclick={addSampleTrinkets}>
            Preview sample trinkets
          </button>
        </div>
      {:else}
        <div class="collection-heading">
          <h3>Collection</h3>
        </div>
        <ul class="collection-list" aria-label="Trinket collection">
          {#each collection as item (item.id)}
            {@const assignedSlot = slotFor(item)}
            <li>
              <button
                class="collection-item"
                type="button"
                aria-pressed={selectedTrinketId === item.id}
                onclick={() => selectTrinket(item.id)}
              >
                <img src={TRINKET_ARTWORK[item.artworkId].src} alt={TRINKET_ARTWORK[item.artworkId].alt} />
                <span class="collection-item-copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.id.startsWith('prototype-sample-')
                      ? 'Local sample'
                      : assignedSlot === null
                        ? 'In collection'
                        : 'In slot ' + (assignedSlot + 1)}
                  </small>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {:else if selectedTrinket}
        <article
          bind:this={detailElement}
          tabindex="-1"
          class="trinket-detail"
          aria-label={'Details for ' + selectedTrinket.name}
        >
          <div class="detail-copy">
            <p class="effect-label">{TRINKET_EFFECT_CATALOG[selectedTrinket.catalogId].label}</p>
            <p class="dedication">{selectedTrinket.dedication}</p>
          </div>
          <div class="detail-actions">
            {#if selectedTrinketSlot !== activeSlot}
              <button class="secondary-button" type="button" onclick={placeSelectedTrinket}>
                Place in slot {activeSlot + 1}
              </button>
            {/if}
            {#if selectedTrinketSlot !== null}
              <button class="text-button" type="button" onclick={removeSelectedTrinket}>
                Remove from slot {selectedTrinketSlot + 1}
              </button>
            {/if}
            <button class="text-button" type="button" onclick={() => (choosingTrinket = true)}>Replace trinket</button>
          </div>
        </article>
      {:else}
        <p class="selection-prompt">Choose a trinket to see its effect and dedication.</p>
      {/if}

      </div>

      {#if announcement}
        <p class="preview-feedback" role="status">{announcement}</p>
      {/if}
    </FloatingSurface>
  {/if}
</div>

<style>
  .prototype-scene-tools {
    position: absolute;
    z-index: 60;
    inset: 0 auto auto 0;
    width: 100%;
    height: var(--prototype-scene-height, 56.25vw);
    overflow: visible;
    pointer-events: none;
  }

  .scene-keepsake-anchors {
    position: absolute;
    z-index: 10;
    inset: 0;
    pointer-events: none;
    opacity: 1;
    transition: opacity 180ms ease;
  }

  .scene-keepsake-anchors.has-patron {
    opacity: 0;
    pointer-events: none;
  }

  .scene-keepsake-place {
    position: absolute;
    display: grid;
    width: clamp(2.75rem, 5vw, 3.4rem);
    height: clamp(2.75rem, 5vw, 3.4rem);
    place-items: center;
    padding: 0.22rem;
    border: 0;
    border-radius: 50%;
    color: #dfbf72;
    background: transparent;
    pointer-events: auto;
    cursor: pointer;
  }

  .scene-keepsake-place::before {
    position: absolute;
    inset: 0;
    border: 1px solid #c49a4a;
    border-radius: 50%;
    background: radial-gradient(circle, rgb(48 33 13 / 0.94), rgb(13 9 5 / 0.92));
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.65), inset 0 0 0 3px rgb(238 207 130 / 0.12);
    content: '';
    transition: border-color 150ms ease, box-shadow 150ms ease;
  }

  .scene-keepsake-place:hover::before,
  .scene-keepsake-place:focus-visible::before,
  .scene-keepsake-place.active::before {
    border-color: #ffe09a;
    box-shadow: 0 0 0 3px rgb(255 220 137 / 0.3), 0 2px 12px rgb(0 0 0 / 0.75);
  }

  .scene-keepsake-place:focus-visible {
    outline: 2px solid #f0d27a;
    outline-offset: 3px;
  }

  .scene-keepsake-place:disabled {
    cursor: default;
  }

  .scene-keepsake-art,
  .scene-keepsake-empty {
    position: relative;
    z-index: 1;
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
  }

  .scene-keepsake-art img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.6));
  }

  .scene-keepsake-empty {
    color: #dfbf72;
    font: 1.55rem Georgia, serif;
  }

  .tool-buttons {
    position: absolute;
    z-index: 30;
    inset: 0;
    pointer-events: none;
  }

  .tool-button,
  .secondary-button,
  .text-button,
  .close-button,
  .collection-item {
    min-height: 2.75rem;
    font: inherit;
  }

  .tool-button,
  .secondary-button,
  .collection-item {
    border: 1px solid rgb(232 209 166 / 35%);
    border-radius: 0.6rem;
    color: #f7ead2;
    background: rgb(30 22 17 / 0.91);
    cursor: pointer;
  }

  .journal-opener {
    position: absolute;
    min-width: 5.25rem;
    padding: 0.55rem 0.9rem;
    box-shadow: 0 0.25rem 0.8rem rgb(0 0 0 / 0.22);
    pointer-events: auto;
  }

  .treatment-b .journal-opener {
    top: calc(var(--prototype-scene-height) - 5.75rem);
    left: 50%;
    transform: translateX(-50%);
  }

  .treatment-e .journal-opener {
    top: 5.25rem;
    right: 1rem;
  }

  .treatment-f .journal-opener {
    top: 50%;
    left: 1rem;
    transform: translateY(-50%);
  }

  .tool-button[aria-expanded='true'],
  .collection-item[aria-pressed='true'] {
    border-color: #e5be72;
    background: #453523;
  }

  .tool-button:focus-visible,
  .secondary-button:focus-visible,
  .text-button:focus-visible,
  .close-button:focus-visible,
  .collection-item:focus-visible,
  .archive-link:focus-visible,
  .journal-body:focus-visible {
    outline: 3px solid #f0c76f;
    outline-offset: 2px;
  }

  .prototype-scene-tools :global(.tool-popover) {
    position: absolute;
    z-index: 40;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: min(24rem, calc(100vw - 2rem));
    min-width: min(20rem, calc(100vw - 2rem));
    max-height: min(42vh, 32rem);
    overflow: hidden;
    padding: 1rem;
    border: 1px solid rgb(230 205 161 / 45%);
    border-radius: 0.9rem;
    color: #f7ead2;
    background: rgb(32 24 19 / 0.76);
    box-shadow: 0 1rem 2.5rem rgb(0 0 0 / 0.34);
    -webkit-backdrop-filter: blur(12px) saturate(115%);
    backdrop-filter: blur(12px) saturate(115%);
    pointer-events: auto;
    animation: folio-open 180ms ease-out both;
  }

  .prototype-scene-tools :global(.journal-popover) {
    max-height: min(48vh, 30rem);
    padding: 0;
  }

  .treatment-f :global(.journal-popover) {
    top: 50%;
    left: 4.5rem;
    transform: translateY(-50%);
    width: min(26rem, calc(100vw - 6rem));
  }

  .treatment-e :global(.journal-popover) {
    top: 8.75rem;
    right: 1rem;
    left: auto;
    width: min(25rem, calc(100vw - 2rem));
  }

  .treatment-b :global(.journal-popover) {
    top: auto;
    bottom: 5.5rem;
    left: 50%;
    transform: translateX(-50%);
    width: min(44rem, calc(100vw - 2rem));
    max-height: min(30vh, 19rem);
  }

  .prototype-scene-tools :global(.slot-popover) {
    top: calc(var(--slot-y) + 3.35rem);
    max-height: min(40vh, 30rem);
  }

  .prototype-scene-tools :global(.slot-left) {
    right: auto;
    left: calc(3.5% + 3.5rem);
  }

  .prototype-scene-tools :global(.slot-right) {
    right: calc(15% + 3.5rem);
    left: auto;
  }

  .popover-header {
    display: flex;
    min-height: 3.8rem;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem 1rem 0.7rem;
    border-bottom: 1px solid rgb(232 209 166 / 0.22);
  }

  .journal-header {
    flex: 0 0 auto;
    border-bottom-color: rgb(232 209 166 / 0.3);
  }

  .popover-header h2,
  .collection-heading h3,
  .trinket-detail h3 {
    margin: 0;
    font-size: 1.05rem;
  }

  .eyebrow {
    margin: 0 0 0.2rem;
    color: #d4b87e;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .close-button {
    display: inline-grid;
    width: 2.75rem;
    flex: 0 0 2.75rem;
    place-items: center;
    border: 1px solid rgb(232 209 166 / 0.3);
    border-radius: 0.55rem;
    color: inherit;
    background: rgb(31 23 18 / 0.36);
    cursor: pointer;
    font-size: 1.5rem;
    line-height: 1;
  }

  .journal-body {
    min-height: 0;
    padding: 0.35rem 1rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .journal-entries,
  .collection-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .journal-entry {
    display: grid;
    grid-template-columns: minmax(5rem, 7rem) minmax(0, 1fr);
    gap: 0.6rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid rgb(232 209 166 / 0.16);
  }

  .entry-label,
  .collection-item small {
    color: #e1c17b;
    font-size: 0.78rem;
  }

  .journal-entry p,
  .empty-message,
  .empty-collection p,
  .selection-prompt,
  .dedication {
    margin: 0;
    line-height: 1.45;
  }

  .empty-message,
  .empty-collection,
  .selection-prompt {
    padding: 0.9rem 0;
    color: #e5d7bf;
  }

  .journal-footer {
    flex: 0 0 auto;
    padding: 0.35rem 1rem 0.75rem;
    border-top: 1px solid rgb(232 209 166 / 0.22);
  }

  .archive-link {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    color: #f1cd83;
    font-weight: 650;
    text-underline-offset: 0.18em;
  }

  .empty-collection {
    display: grid;
    gap: 0.6rem;
    justify-items: start;
  }

  .secondary-button {
    padding: 0.5rem 0.75rem;
    color: #f7ead2;
    background: #493b2a;
  }

  .collection-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 0 0.4rem;
  }

  .collection-list > li + li {
    border-top: 1px solid rgb(232 209 166 / 0.15);
  }

  .collection-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.7rem;
    padding: 0.45rem;
    border-color: transparent;
    border-radius: 0.4rem;
    background: transparent;
    text-align: left;
  }

  .collection-item img {
    width: 2.35rem;
    height: 2.35rem;
    flex: 0 0 2.35rem;
    object-fit: contain;
  }

  .collection-item-copy {
    display: grid;
    min-width: 0;
    gap: 0.1rem;
  }

  .collection-item-copy strong,
  .collection-item small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slot-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .trinket-detail { margin-top: 0; padding: 0.5rem 0; }

  .effect-label {
    margin: 0.35rem 0;
    color: #e9c987;
  }

  .dedication {
    color: #f0e3cf;
    font-size: 0.9rem;
  }

  .detail-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    padding-top: 0.65rem;
  }

  .text-button {
    padding: 0.3rem 0.5rem;
    border: 0;
    color: #edce91;
    background: transparent;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 0.18em;
  }

  .preview-feedback {
    margin: 0.6rem 0 0;
    color: #d9bc78;
    font-size: 0.75rem;
    line-height: 1.35;
  }

  @keyframes folio-open {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @media (max-width: 1000px) {
    .prototype-scene-tools :global(.journal-popover) {
      top: calc(var(--prototype-scene-height) + 3.7rem);
      right: 1rem;
      bottom: auto;
      left: 1rem;
      width: auto;
      max-height: min(42vh, 24rem);
      transform: none;
    }

    .treatment-b .journal-opener,
    .treatment-e .journal-opener,
    .treatment-f .journal-opener {
      top: calc(var(--prototype-scene-height) + 0.45rem);
      right: auto;
      left: 0.1rem;
      transform: none;
    }

    .prototype-scene-tools :global(.slot-popover) {
      top: calc(var(--slot-y) + 3.35rem);
      right: 1rem;
      left: 1rem;
      width: auto;
      max-height: min(42vh, 24rem);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .scene-keepsake-anchors {
      transition: none;
    }

    .prototype-scene-tools :global(.tool-popover) {
      animation: none;
    }
  }
</style>
