<script lang="ts">
  // Question: which floating conversation surface best supports the bar flow? Three layouts share /bar?variant= on the existing route.
  import { tick } from 'svelte';
  import PrototypeSwitcher from '$lib/components/ui/PrototypeSwitcher.svelte';
  import type { OwnedTrinket } from '$lib/game/trinkets';
  import type { Patron } from '$lib/game/serving';
  import VariantA from './VariantA.svelte';
  import VariantB from './VariantB.svelte';
  import VariantC from './VariantC.svelte';
  import {
    PROTOTYPE_CARDS,
    type BarPrototypeModel,
    type BarPrototypeVariant,
    type MockEntry,
    type PrototypeMode
  } from './types';

  type Props = {
    variant: BarPrototypeVariant;
    patrons: Patron[];
    trinkets: OwnedTrinket[];
    day: number;
    gold: number;
    archiveHref: string;
    onvariantchange: (variant: BarPrototypeVariant | null) => void;
  };

  let { variant, patrons, trinkets, day, gold, archiveHref, onvariantchange }: Props = $props();
  let selectedInstanceId = $state<string | null>(null);
  let focusedInstanceId = $state<string | null>(null);
  let mode = $state<PrototypeMode>('overview');
  let journalReturnMode = $state<PrototypeMode>('overview');
  let draft = $state('');
  let selectedCardId = $state<string | null>(null);
  let historyByNpc = $state<Record<string, MockEntry[]>>({});
  let messageSequence = $state(0);
  let notice = $state('');

  const selected = $derived(patrons.find((patron) => patron.instanceId === selectedInstanceId) ?? null);
  const activeCard = $derived(PROTOTYPE_CARDS.find((card) => card.id === selectedCardId) ?? null);
  const history = $derived(selected ? historyByNpc[selected.instanceId] ?? [] : []);

  function choosePatron(instanceId: string) {
    if (!patrons.some((patron) => patron.instanceId === instanceId)) return;
    selectedInstanceId = instanceId;
    focusedInstanceId = instanceId;
    mode = 'overview';
    notice = '';
  }

  async function returnToOverview() {
    const returningInstanceId = selectedInstanceId;
    selectedInstanceId = null;
    mode = 'overview';
    notice = '';
    await tick();
    if (!returningInstanceId) return;
    const actorKey = 'patron:' + returningInstanceId;
    const target = [...document.querySelectorAll<HTMLButtonElement>('button[data-scene-actor]')]
      .find((button) => button.dataset.sceneActor === actorKey);
    target?.focus({ preventScroll: true });
  }

  function toggleTalk() {
    mode = mode === 'talk' ? 'overview' : 'talk';
  }

  function toggleCards() {
    mode = mode === 'cards' ? 'overview' : 'cards';
  }

  function openJournal() {
    if (mode === 'journal') {
      void closeJournal();
      return;
    }
    journalReturnMode = mode;
    mode = 'journal';
  }

  async function closeJournal() {
    mode = journalReturnMode;
    await tick();
    document.querySelector<HTMLButtonElement>('[data-prototype-opener="journal"]')
      ?.focus({ preventScroll: true });
  }

  function appendEntries(entries: Omit<MockEntry, 'id'>[]) {
    if (!selected) return;
    const previous = historyByNpc[selected.instanceId] ?? [];
    const nextEntries = entries.map((entry) => ({ ...entry, id: ++messageSequence }));
    historyByNpc = { ...historyByNpc, [selected.instanceId]: [...previous, ...nextEntries] };
  }

  function sendMessage() {
    if (!selected) return;
    const message = draft.trim() || (activeCard?.kind === 'intent'
      ? 'Tell me more about ' + activeCard.title.toLowerCase() + '.'
      : '');
    if (!message) {
      notice = 'Write a note or choose an intent card first.';
      return;
    }
    const reply = activeCard?.id === 'intent-kindness'
      ? selected.name + ' pauses, then shares what has been weighing on them.'
      : selected.name + ' tells you about a winding road and a familiar face along it.';
    appendEntries([
      { kind: 'player', label: 'You', text: message },
      { kind: 'patron', label: selected.name, text: reply }
    ]);
    draft = '';
    mode = 'talk';
    notice = 'Mock reply added to this resident’s journal.';
  }

  function serveCard() {
    if (!selected || activeCard?.kind !== 'hospitality') {
      notice = 'Choose a hospitality card to preview a serving outcome.';
      return;
    }
    appendEntries([{
      kind: 'service',
      label: 'Mock hospitality',
      text: selected.name + ' accepts ' + activeCard.title.toLowerCase() + ' with a grateful smile. No inventory or gold changed.'
    }]);
    mode = 'talk';
    notice = 'Mock serving outcome added to this resident’s journal.';
  }

  function mockClose() {
    notice = 'Ending the evening is read-only in this prototype.';
  }

  function mockKeepsake(slot: 0 | 1 | 2 | 3) {
    notice = 'Keepsake slot ' + (slot + 1) + ' is read-only in this prototype.';
  }

  function resetPrototype() {
    selectedInstanceId = null;
    focusedInstanceId = null;
    mode = 'overview';
    journalReturnMode = 'overview';
    draft = '';
    selectedCardId = null;
    historyByNpc = {};
    messageSequence = 0;
    notice = 'Prototype state reset.';
  }

  function stateForDebug() {
    return {
      variant,
      selectedNpc: selected ? { id: selected.instanceId, name: selected.name } : null,
      focusedNpc: focusedInstanceId,
      mode,
      journalReturnMode,
      unsentDraft: draft,
      selectedCard: activeCard,
      mockHistoryByNpc: historyByNpc,
      notice
    };
  }

  let model = $derived({
    patrons,
    trinkets,
    day,
    gold,
    archiveHref,
    selected,
    focusedKey: focusedInstanceId,
    mode,
    journalReturnMode,
    draft,
    selectedCardId,
    selectedCard: activeCard,
    cards: PROTOTYPE_CARDS,
    history,
    notice,
    onselect: choosePatron,
    onfocus: (instanceId: string) => (focusedInstanceId = instanceId),
    onback: returnToOverview,
    ontalk: toggleTalk,
    ondeck: toggleCards,
    onclose: mockClose,
    onkeepsake: mockKeepsake,
    onmode: (nextMode: PrototypeMode) => (mode = nextMode),
    onjournal: openJournal,
    onjournalclose: closeJournal,
    ondraft: (value: string) => (draft = value),
    oncard: (id: string) => (selectedCardId = id),
    onsend: sendMessage,
    onserve: serveCard
  } satisfies BarPrototypeModel);

  async function handleEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    if (mode === 'journal') {
      event.preventDefault();
      event.stopPropagation();
      await closeJournal();
      return;
    }
    if (mode === 'talk' || mode === 'cards') {
      event.preventDefault();
      event.stopPropagation();
      const opener = mode === 'talk' ? 'talk' : 'deck';
      mode = 'overview';
      await tick();
      document.querySelector<HTMLElement>('[data-bar-control="' + opener + '"]')
        ?.focus({ preventScroll: true });
      return;
    }
    if (selected) {
      event.preventDefault();
      event.stopPropagation();
      await returnToOverview();
    }
  }
</script>

<svelte:window onkeydown={handleEscape} />

<section class="bar-prototype" aria-label="Bar interaction prototype">
  {#if variant === 'A'}
    <VariantA {...model} />
  {:else if variant === 'B'}
    <VariantB {...model} />
  {:else}
    <VariantC {...model} />
  {/if}
  <PrototypeSwitcher current={variant} state={stateForDebug} onreset={resetPrototype} {onvariantchange} />
</section>

<style>
  .bar-prototype { width: 100%; }
  @media (min-width: 1001px) {
    .bar-prototype :global(.tavern-scene-stack .tavern-scene) {
      width: 100%;
      height: min(56.25vw, calc(100dvh - 11rem));
      aspect-ratio: auto;
    }
  }
  @keyframes prototype-surface-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .bar-prototype :global(.scene-interaction:not([hidden])),
  .bar-prototype :global(.journal-float),
  .bar-prototype :global(.paper-journal),
  .bar-prototype :global(.reading-thread) {
    animation: prototype-surface-fade 160ms ease-out both;
  }
  @media (prefers-reduced-motion: reduce) {
    .bar-prototype :global(.scene-interaction:not([hidden])),
    .bar-prototype :global(.journal-float),
    .bar-prototype :global(.paper-journal),
    .bar-prototype :global(.reading-thread) { animation: none; }
  }
  @media (max-width: 1000px) {
    .bar-prototype { padding-bottom: calc(4.5rem + env(safe-area-inset-bottom)); }
  }
</style>
