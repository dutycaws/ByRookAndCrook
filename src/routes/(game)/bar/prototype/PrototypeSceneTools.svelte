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

  let { model, treatment = 'B' }: Props = $props();
  const slots: readonly TrinketSlot[] = [0, 1, 2, 3];

  let trinketsOpen = $state(false);
  let selectedSlot = $state<TrinketSlot>(0);
  let selectedTrinketId = $state<string | null>(null);
  let localSlotAssignments = $state<Record<string, TrinketSlot | null>>({});
  let sampleTrinkets = $state<OwnedTrinket[]>([]);
  let announcement = $state('');

  let journalCloseButton = $state<HTMLButtonElement>();
  let trinketsButton = $state<HTMLButtonElement>();
  let trinketsCloseButton = $state<HTMLButtonElement>();
  let detailElement = $state<HTMLElement>();

  const collection = $derived([...model.trinkets, ...sampleTrinkets]);
  const selectedTrinket = $derived(
    collection.find((item) => item.id === selectedTrinketId) ?? null
  );
  const selectedTrinketSlot = $derived(
    selectedTrinket ? slotFor(selectedTrinket) : null
  );
  const equippedBySlot = $derived(
    slots.map((slot) => collection.find((item) => slotFor(item) === slot) ?? null)
  );

  function slotFor(item: OwnedTrinket): TrinketSlot | null {
    return Object.prototype.hasOwnProperty.call(localSlotAssignments, item.id)
      ? localSlotAssignments[item.id]
      : item.slot;
  }

  async function openJournal() {
    trinketsOpen = false;
    model.onjournal();
    await tick();
    journalCloseButton?.focus({ preventScroll: true });
  }

  function closeJournal() {
    model.onjournalclose();
  }

  async function toggleTrinkets() {
    if (trinketsOpen) {
      await closeTrinkets();
      return;
    }

    if (model.mode === 'journal') model.onjournalclose();
    trinketsOpen = true;
    await tick();
    trinketsCloseButton?.focus({ preventScroll: true });
  }

  async function closeTrinkets() {
    trinketsOpen = false;
    await tick();
    trinketsButton?.focus({ preventScroll: true });
  }

  function handlePopupKeydown(event: KeyboardEvent, popup: 'journal' | 'trinkets') {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (popup === 'journal') closeJournal();
    else void closeTrinkets();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (trinketsOpen) handlePopupKeydown(event, 'trinkets');
    else if (model.mode === 'journal') handlePopupKeydown(event, 'journal');
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
    announcement = 'Two local sample trinkets added to the preview.';
  }

  async function selectTrinket(id: string) {
    selectedTrinketId = id;
    await tick();
    detailElement?.focus({ preventScroll: true });
    detailElement?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  async function placeSelectedTrinket() {
    if (!selectedTrinket) return;

    const nextAssignments = { ...localSlotAssignments };

    for (const item of collection) {
      if (item.id !== selectedTrinket.id && slotFor(item) === selectedSlot) {
        nextAssignments[item.id] = null;
      }
    }

    nextAssignments[selectedTrinket.id] = selectedSlot;
    localSlotAssignments = nextAssignments;
    announcement = `${selectedTrinket.name} placed in slot ${selectedSlot + 1} for this preview.`;
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
    announcement = `${selectedTrinket.name} removed from slot ${previousSlot + 1} in this preview.`;
    await tick();
    detailElement?.focus({ preventScroll: true });
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="prototype-scene-tools treatment-{treatment.toLowerCase()}" aria-label="Scene tools">
  <div class="tool-buttons" role="group" aria-label="Journal and trinkets">
    <button
      class="tool-button"
      type="button"
      data-prototype-opener="journal"
      aria-expanded={model.mode === 'journal'}
      aria-controls="prototype-scene-journal"
      disabled={!model.selected}
      onclick={openJournal}
    >Journal</button>
    <button
      bind:this={trinketsButton}
      class="tool-button"
      type="button"
      aria-expanded={trinketsOpen}
      aria-controls="prototype-scene-trinkets"
      onclick={toggleTrinkets}
    >Trinkets</button>
  </div>

  {#if model.mode === 'journal'}
    <FloatingSurface
      as="section"
      class="tool-popover journal-popover"
      id="prototype-scene-journal"
      role="region"
      aria-labelledby="prototype-journal-title"
      tabindex={-1}
      data-prototype-tool-open
      onkeydown={(event) => handlePopupKeydown(event, 'journal')}
    >
      <header class="popover-header">
        <div>
          <p class="eyebrow">{model.selected?.name ?? 'Bar journal'}</p>
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

      {#if model.history.length > 0}
        <ol class="journal-entries" aria-label="Journal entries">
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

      <a class="archive-link" href={model.archiveHref}>Open the archive</a>
    </FloatingSurface>
  {/if}

  {#if trinketsOpen}
    <FloatingSurface
      as="section"
      class="tool-popover trinkets-popover"
      id="prototype-scene-trinkets"
      role="region"
      aria-labelledby="prototype-trinkets-title"
      tabindex={-1}
      data-prototype-tool-open
      onkeydown={(event) => handlePopupKeydown(event, 'trinkets')}
    >
      <header class="popover-header">
        <div>
          <p class="eyebrow">Keepsake collection</p>
          <h2 id="prototype-trinkets-title">Trinkets</h2>
        </div>
        <button
          bind:this={trinketsCloseButton}
          class="close-button"
          type="button"
          aria-label="Close trinkets"
          onclick={closeTrinkets}
        >×</button>
      </header>

      <div class="slot-picker" role="group" aria-label="Choose a trinket slot">
        {#each slots as slot}
          {@const item = equippedBySlot[slot]}
          <button
            class="slot-button"
            type="button"
            aria-pressed={selectedSlot === slot}
            aria-label={`Slot ${slot + 1}${item ? `, ${item.name}` : ', empty'}`}
            onclick={() => (selectedSlot = slot)}
          >
            <span class="slot-number">Slot {slot + 1}</span>
            <span class="slot-name">{item?.name ?? 'Empty'}</span>
          </button>
        {/each}
      </div>

      <div class="collection-heading">
        <h3>Collection</h3>
      </div>

      {#if collection.length === 0}
        <div class="empty-collection">
          <p>Your collection is empty.</p>
          <button class="secondary-button" type="button" onclick={addSampleTrinkets}>
            Preview sample trinkets
          </button>
        </div>
      {:else}
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
                        : `In slot ${assignedSlot + 1}`}
                  </small>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if selectedTrinket}
        <article bind:this={detailElement} tabindex="-1" class="trinket-detail" aria-label={`Details for ${selectedTrinket.name}`}>
          <div class="detail-copy">
            <p class="eyebrow">Selected trinket</p>
            <h3>{selectedTrinket.name}</h3>
            <p class="effect-label">{TRINKET_EFFECT_CATALOG[selectedTrinket.catalogId].label}</p>
            <p class="dedication">{selectedTrinket.dedication}</p>
          </div>
          <div class="detail-actions">
            {#if selectedTrinketSlot !== selectedSlot}
              <button class="secondary-button" type="button" onclick={placeSelectedTrinket}>
                Place in slot {selectedSlot + 1}
              </button>
            {/if}
            {#if selectedTrinketSlot !== null}
              <button class="text-button" type="button" onclick={removeSelectedTrinket}>
                Remove from slot {selectedTrinketSlot + 1}
              </button>
            {/if}
          </div>
        </article>
      {/if}

      {#if announcement}<p class="preview-feedback" role="status">{announcement}</p>{/if}
    </FloatingSurface>
  {/if}
</div>

<style>
  .prototype-scene-tools {
    position: absolute;
    z-index: 60;
    display: grid;
    gap: 0.5rem;
    width: max-content;
    max-width: calc(100vw - 2rem);
  }

  .treatment-b {
    top: 4rem;
    left: 1rem;
  }

  .treatment-e {
    top: 50%;
    left: 1rem;
  }

  .treatment-f {
    top: 4rem;
    right: 1rem;
  }

  .tool-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .tool-button,
  .secondary-button,
  .text-button,
  .close-button,
  .slot-button,
  .collection-item {
    min-height: 2.75rem;
    font: inherit;
  }

  .tool-button,
  .secondary-button,
  .slot-button,
  .collection-item {
    border: 1px solid rgb(232 209 166 / 35%);
    border-radius: 0.6rem;
    color: #f7ead2;
    background: rgb(30 22 17 / 91%);
    cursor: pointer;
  }

  .tool-button {
    padding: 0.55rem 0.9rem;
    box-shadow: 0 0.25rem 0.8rem rgb(0 0 0 / 22%);
  }

  .tool-button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  .tool-button[aria-expanded='true'],
  .slot-button[aria-pressed='true'],
  .collection-item[aria-pressed='true'] {
    border-color: #e5be72;
    background: #453523;
  }

  .prototype-scene-tools :global(.tool-popover) {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0;
    z-index: 2;
    width: min(20rem, calc(100vw - 2rem));
    min-width: min(20rem, calc(100vw - 2rem));
    max-height: min(40vh, 32rem);
    overflow: auto;
    padding: 1rem;
    border: 1px solid rgb(230 205 161 / 45%);
    border-radius: 0.9rem;
    color: #f7ead2;
    background: #201813;
    box-shadow: 0 1rem 2.5rem rgb(0 0 0 / 42%);
    animation: popover-fade-in 140ms ease-out both;
  }

  .treatment-f :global(.tool-popover) {
    right: 0;
    left: auto;
  }

  .popover-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.7rem;
    border-bottom: 1px solid rgb(232 209 166 / 22%);
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
    border: 1px solid rgb(232 209 166 / 30%);
    border-radius: 0.55rem;
    color: inherit;
    background: transparent;
    cursor: pointer;
    font-size: 1.5rem;
    line-height: 1;
  }

  .journal-entries,
  .collection-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .journal-entry {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.6rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid rgb(232 209 166 / 16%);
  }

  .entry-label,
  .collection-item small {
    color: #d4b87e;
    font-size: 0.78rem;
  }

  .journal-entry p,
  .empty-message,
  .empty-collection p,
  .dedication {
    margin: 0;
    line-height: 1.45;
  }

  .empty-message,
  .empty-collection {
    padding: 0.9rem 0;
    color: #e5d7bf;
  }

  .archive-link {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    color: #f1cd83;
    font-weight: 650;
    text-underline-offset: 0.18em;
  }

  .slot-picker {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.45rem;
    padding: 0.85rem 0 1rem;
    border-bottom: 1px solid rgb(232 209 166 / 16%);
  }

  .slot-button {
    display: grid;
    min-width: 0;
    align-content: center;
    gap: 0.15rem;
    padding: 0.4rem;
    text-align: left;
  }

  .slot-number {
    color: #d4b87e;
    font-size: 0.72rem;
  }

  .slot-name {
    overflow: hidden;
    font-size: 0.8rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .collection-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 0 0.4rem;
  }


  .collection-list > li + li {
    border-top: 1px solid rgb(232 209 166 / 15%);
  }

  .collection-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.7rem;
    padding: 0.45rem;
    border-color: transparent;
    border-radius: 0.4rem;
    text-align: left;
  }

  .collection-item img,
  .trinket-art {
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

  .trinket-detail {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: 0.9rem;
    margin-top: 0.75rem;
    padding-top: 0.85rem;
    border-top: 1px solid rgb(232 209 166 / 22%);
  }

  .effect-label {
    margin: 0.35rem 0;
    color: #e9c987;
  }

  .dedication {
    color: #ded0bb;
    font-size: 0.9rem;
  }

  .detail-actions {
    display: grid;
    justify-items: stretch;
    gap: 0.3rem;
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

  .tool-button:focus-visible,
  .secondary-button:focus-visible,
  .text-button:focus-visible,
  .close-button:focus-visible,
  .slot-button:focus-visible,
  .collection-item:focus-visible,
  .archive-link:focus-visible {
    outline: 3px solid #f0c76f;
    outline-offset: 2px;
  }

  .trinket-detail:focus-visible { outline: 2px solid #f0c76f; outline-offset: 2px; }
  .preview-feedback { margin: .6rem 0 0; color: #d9bc78; font-size: .75rem; line-height: 1.35; }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    clip-path: inset(50%);
  }

  @keyframes popover-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @media (max-width: 1000px) {
    .prototype-scene-tools {
      top: calc(var(--prototype-scene-height, 100vw) + 0.45rem);
      right: auto;
      left: 0.1rem;
      width: min(calc(100vw - 1.5rem), 25rem);
      max-width: calc(100vw - 1.5rem);
    }

    .tool-buttons {
      gap: 0.35rem;
    }

    .tool-button {
      min-height: 2.75rem;
      padding: 0.45rem 0.75rem;
    }

    .prototype-scene-tools :global(.tool-popover) {
      right: auto;
      left: 0;
      width: min(20rem, calc(100vw - 2rem));
      min-width: min(20rem, calc(100vw - 2rem));
      max-height: min(40vh, 32rem);
    }

    .trinket-detail {
      grid-template-columns: minmax(0, 1fr);
    }

    .detail-actions {
      grid-template-columns: repeat(2, minmax(0, max-content));
      justify-content: start;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .prototype-scene-tools :global(.tool-popover) {
      animation: none;
    }
  }
</style>
