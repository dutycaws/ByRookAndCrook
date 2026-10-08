<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { isActiveSettlement } from '$lib/game/evolving-world';
  import type { TrinketSlot } from '$lib/game/trinkets';
  import NpcDialogue from '$lib/components/NpcDialogue.svelte';
  import Dialog from '$lib/components/ui/Dialog.svelte';
  import ResidentInspector from '$lib/components/tavern/ResidentInspector.svelte';
  import SettlementInterlude from '$lib/components/tavern/SettlementInterlude.svelte';
  import TavernScene from '$lib/components/tavern/TavernScene.svelte';
  import TrinketCollection from '$lib/components/tavern/TrinketCollection.svelte';
  import BarInteractionPrototype from './prototype/BarInteractionPrototype.svelte';
  import type { BarPrototypeVariant } from './prototype/types';
  import type { PageProps, SubmitFunction } from './$types';

  let { data, form }: PageProps = $props();

  function parsePrototypeVariant(value: string | null): BarPrototypeVariant | null {
    return value === 'A' || value === 'B' || value === 'C' ? value : null;
  }

  let prototypeVariant = $state<BarPrototypeVariant | null>(
    import.meta.env.DEV ? parsePrototypeVariant(page.url.searchParams.get('variant')) : null
  );

  function validInitialSelection() {
    const requested = data.selectedNpcInstanceId;
    return requested && data.snapshot?.patrons.some((patron) => patron.instanceId === requested)
      ? requested
      : null;
  }

  let selectedInstanceId = $state<string | null>(validInitialSelection());
  let focusedInstanceId = $state<string | null>(validInitialSelection());
  let journalOpen = $state(false);
  let talkOpen = $state(false);
  let deckOpen = $state(false);
  let cardSelected = $state(false);
  let dialogueBusy = $state(false);
  let hydrated = $state(false);
  let pending = $state(false);
  let closeDialogOpen = $state(false);
  let closeError = $state<string | null>(null);
  let closeCommand: { actionId: string; saveId: string; revision: number } | null = $state(null);
  let keepsakeDialogOpen = $state(false);
  let selectedTrinketSlot = $state<TrinketSlot | null>(null);
  let selectedTrinketId = $state('');

  const patrons = $derived(data.snapshot?.patrons ?? []);
  const collection = $derived(data.snapshot?.trinkets?.collection ?? []);
  const patron = $derived(patrons.find((resident) => resident.instanceId === selectedInstanceId) ?? null);
  const journal = $derived(patron ? data.journals[patron.instanceId] ?? null : null);
  const interactionBlocked = $derived(!hydrated || pending || dialogueBusy || !!closeCommand);
  const codexHref = $derived(patron
    ? `/codex?section=residents&resident=${encodeURIComponent(patron.instanceId)}`
    : '/codex?section=residents');
  const codexCursorHref = $derived(patron && journal?.questArchive.nextCursor
    ? `/codex?section=residents&resident=${encodeURIComponent(patron.instanceId)}&questCursor=${encodeURIComponent(journal.questArchive.nextCursor)}`
    : codexHref);

  $effect(() => {
    if (selectedInstanceId && !patrons.some((resident) => resident.instanceId === selectedInstanceId)) {
      selectedInstanceId = null;
      journalOpen = false;
      talkOpen = false;
      deckOpen = false;
      cardSelected = false;
    }
    if (focusedInstanceId && !patrons.some((resident) => resident.instanceId === focusedInstanceId)) {
      focusedInstanceId = selectedInstanceId ?? patrons[0]?.instanceId ?? null;
    }
    if (!focusedInstanceId && patrons.length) focusedInstanceId = patrons[0].instanceId;
  });

  onMount(() => {
    hydrated = true;
    const syncBrowserSelection = () => {
      const requested = new URL(window.location.href).searchParams.get('npc');
      const nextSelection = requested && patrons.some((resident) => resident.instanceId === requested)
        ? requested
        : null;
      selectedInstanceId = nextSelection;
      if (nextSelection) focusedInstanceId = nextSelection;
      talkOpen = false;
      deckOpen = false;
      cardSelected = false;
      journalOpen = false;
    };
    window.addEventListener('popstate', syncBrowserSelection);
    return () => window.removeEventListener('popstate', syncBrowserSelection);
  });

  function clearPatronUrl() {
    if (!page.url.searchParams.has('npc')) return;
    const params = new URLSearchParams(page.url.searchParams);
    params.delete('npc');
    const query = params.toString();
    replaceState(`/bar${query ? `?${query}` : ''}`, page.state);
  }

  function selectPatron(instanceId: string) {
    if (interactionBlocked || !patrons.some((resident) => resident.instanceId === instanceId)) return;
    selectedInstanceId = instanceId;
    focusedInstanceId = instanceId;
    journalOpen = false;
    talkOpen = false;
    deckOpen = false;
    cardSelected = false;
  }

  async function returnToBar() {
    if (interactionBlocked) return;
    const returningInstanceId = selectedInstanceId;
    selectedInstanceId = null;
    journalOpen = false;
    talkOpen = false;
    deckOpen = false;
    cardSelected = false;
    clearPatronUrl();
    await tick();
    if (!returningInstanceId) return;
    const actorKey = `patron:${returningInstanceId}`;
    const target = [...document.querySelectorAll<HTMLButtonElement>('button[data-scene-actor]')]
      .find((button) => button.dataset.sceneActor === actorKey);
    target?.focus({ preventScroll: true });
  }

  async function toggleTalk() {
    if (interactionBlocked || !patron) return;
    const opening = !talkOpen;
    journalOpen = false;
    talkOpen = opening;
    deckOpen = false;
    if (opening) {
      await tick();
      document.querySelector<HTMLTextAreaElement>('.dialogue-form textarea')?.focus({ preventScroll: true });
    }
  }

  async function toggleDeck() {
    if (interactionBlocked || !patron) return;
    const opening = !deckOpen;
    journalOpen = false;
    deckOpen = opening;
    talkOpen = false;
    if (opening) {
      await tick();
      document.querySelector<HTMLButtonElement>('[data-card-index="0"]')?.focus({ preventScroll: true });
    }
  }

  function setJournalOpen(open: boolean) {
    journalOpen = open;
    if (open) {
      talkOpen = false;
      deckOpen = false;
    }
  }

  async function handleEscape(event: KeyboardEvent) {
    if (prototypeVariant) return;
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;

    if (journalOpen) {
      event.preventDefault();
      event.stopPropagation();
      journalOpen = false;
      await tick();
      document.querySelector<HTMLElement>('[data-bar-control="journal"]')?.focus({ preventScroll: true });
      return;
    }

    if (dialogueBusy) return;

    if (talkOpen || deckOpen) {
      event.preventDefault();
      event.stopPropagation();
      const control = talkOpen ? 'talk' : 'deck';
      talkOpen = false;
      deckOpen = false;
      await tick();
      document.querySelector<HTMLElement>(`[data-bar-control="${control}"]`)?.focus({ preventScroll: true });
      return;
    }

    if (patron && !interactionBlocked) {
      event.preventDefault();
      await returnToBar();
    }
  }

  function openKeepsake(slot: TrinketSlot) {
    if (interactionBlocked) return;
    selectedTrinketSlot = slot;
    selectedTrinketId = collection.find((item) => item.slot === slot)?.id ?? collection.find((item) => item.slot === null)?.id ?? '';
    keepsakeDialogOpen = true;
  }

  function closeKeepsakeDialog() {
    keepsakeDialogOpen = false;
    selectedTrinketSlot = null;
  }

  const enhanceClose: SubmitFunction = ({ formData, cancel }) => {
    if (!data.snapshot || pending) {
      cancel();
      return;
    }

    closeCommand ??= {
      actionId: crypto.randomUUID(),
      saveId: data.snapshot.save.id,
      revision: data.snapshot.save.revision
    };
    for (const [key, value] of Object.entries(closeCommand)) formData.set(key, String(value));
    pending = true;
    closeError = null;

    return async ({ result, update }) => {
      if (result.type === 'error' || (result.type === 'failure' && result.status >= 500)) {
        pending = false;
        closeError = 'The close result is uncertain. Retry the same close to check whether it was recorded.';
        return;
      }

      if (result.type === 'success') {
        closeDialogOpen = false;
        closeCommand = null;
      } else if (result.type === 'failure') {
        closeError = result.data?.message ?? 'The tavern could not close. Retry the same close.';
      }

      try {
        await update({ reset: false, invalidateAll: true });
        if (result.type === 'failure') await invalidateAll();
      } catch {
        closeError = result.type === 'success'
          ? 'The tavern closed, but the latest status could not be loaded. Refresh to continue.'
          : 'The latest tavern status could not be loaded. Retry the same close.';
      } finally {
        pending = false;
      }
    };
  };

  async function refreshCloseStatus() {
    pending = true;
    try {
      await invalidateAll();
      closeError = null;
    } catch {
      closeError = 'The latest tavern status could not be loaded. Try refreshing again.';
    } finally {
      pending = false;
    }
  }

  async function refreshBar() {
    pending = true;
    try {
      await invalidateAll();
    } finally {
      pending = false;
    }
  }
</script>

<svelte:window onkeydown={handleEscape} />

<svelte:head>
  <title>The bar · By Rook and Crook</title>
  <meta name="description" content="Welcome the regulars, pour your finest mead, and follow their stories." />
</svelte:head>

<main class="bar-page">
  {#if data.settlement && isActiveSettlement(data.settlement)}
    <SettlementInterlude settlement={data.settlement} />
  {:else if data.archived}
    <section class="codex-transfer" aria-labelledby="codex-transfer-title">
      <p class="eyebrow">Past residents</p>
      <h1 id="codex-transfer-title">Their stories live in the Codex.</h1>
      <p>Open the Codex for resident journals, conversations, hospitality, and past residents.</p>
      <a class="primary-button inline-button" href={codexHref}>Open the Codex</a>
      <a class="return-link" href="/bar">Return to the common room</a>
    </section>
  {:else if prototypeVariant && data.snapshot}
    <BarInteractionPrototype
      variant={prototypeVariant}
      patrons={data.snapshot.patrons}
      trinkets={data.snapshot.trinkets?.collection ?? []}
      day={data.snapshot.save.currentDay}
      gold={data.snapshot.save.gold}
      archiveHref={codexHref}
      onvariantchange={(variant) => (prototypeVariant = variant)}
    />
  {:else if !data.snapshot}
    <section class="empty-state bar-empty-state" aria-labelledby="bar-empty-title">
      <p class="eyebrow">The tavern is waiting</p>
      <h1 id="bar-empty-title">Open the doors</h1>
      <p>Start your tavern in the garden, then bring your first brew to the bar.</p>
      <a class="primary-button inline-button" href="/garden">Start your tavern</a>
      <button class="text-button" type="button" disabled={pending} onclick={refreshBar}>Refresh the bar</button>
    </section>
  {:else}
    <div class="bar-shell">
      <TavernScene
        {patrons}
        selected={patron}
        focusedKey={focusedInstanceId}
        trinkets={collection}
        day={data.snapshot.save.currentDay}
        gold={data.snapshot.save.gold}
        archiveHref={codexHref}
        disabled={!hydrated || pending || dialogueBusy || !!closeCommand}
        closeDisabled={!hydrated || pending || dialogueBusy}
        {cardSelected}
        composerOpen={talkOpen}
        {deckOpen}
        onselect={selectPatron}
        onfocus={(instanceId) => (focusedInstanceId = instanceId)}
        onback={returnToBar}
        ontalk={toggleTalk}
        ondeck={toggleDeck}
        onclose={() => { closeError = null; closeDialogOpen = true; }}
        onkeepsake={openKeepsake}
      >
        {#snippet interaction()}
          {#if patron && data.snapshot && journal}
            <NpcDialogue
              npcId={patron.npcId}
              instanceId={patron.instanceId}
              saveId={data.snapshot.save.id}
              name={patron.name}
              {journal}
              stock={data.snapshot}
              unavailable={data.dialogueUnavailable}
              archiveHref={null}
              embedded={true}
              blocked={pending || !!closeCommand}
              focusActive={true}
              composerOpen={talkOpen}
              deckOpen={deckOpen}
              onbusychange={(busy) => (dialogueBusy = busy)}
              oncomposerchange={(open) => {
                talkOpen = open;
                if (open) {
                  journalOpen = false;
                  deckOpen = false;
                }
              }}
              ondeckchange={(open) => {
                deckOpen = open;
                if (open) {
                  journalOpen = false;
                  talkOpen = false;
                }
              }}
              onselectionchange={(selected) => (cardSelected = selected)}
            />
          {:else if patron}
            <p class="quiet-line" role="status">This resident’s journal is unavailable right now.</p>
          {/if}
        {/snippet}
      </TavernScene>

      {#if patron}
        {@const snapshot = data.snapshot}
        <ResidentInspector
          {patron}
          {journal}
          history={snapshot.history}
          archiveHref={codexCursorHref}
          {codexHref}
          {journalOpen}
          interactionOpen={talkOpen || deckOpen}
          onjournalchange={setJournalOpen}
        />
      {:else if patrons.length === 0}
        <p class="quiet-room" role="status">The common room is quiet. The scene’s keepsake slots still open their manager; past residents are in the Codex.</p>
      {/if}
    </div>
  {/if}
</main>

{#if !prototypeVariant}
<Dialog id="close-tavern" title="End evening?" bind:open={closeDialogOpen}>
  <p class="dialog-copy">Your regulars will follow their intentions overnight. You can close without crafting today.</p>
  {#if closeError}
    <p class="form-message error" role="alert">{closeError}</p>
    <button class="text-button" type="button" disabled={pending} onclick={refreshCloseStatus}>Refresh tavern status</button>
  {:else if form?.message}
    <p class="form-message" role="status">{form.message}</p>
  {/if}
  <form method="POST" action="?/close" use:enhance={enhanceClose}>
    <button class="primary-button full-button" disabled={!hydrated || pending || dialogueBusy}>
      {pending ? 'Closing…' : closeCommand ? 'Retry the same close' : 'Close and begin the next day'}
    </button>
  </form>
</Dialog>

<Dialog id="keepsake-manager" title="Arrange a keepsake" bind:open={keepsakeDialogOpen}>
  {#if selectedTrinketSlot !== null}
    <p class="keepsake-context">Choose what belongs in display slot {selectedTrinketSlot + 1}.</p>
  {/if}
  {#if data.snapshot}
    <TrinketCollection
      collection={collection}
      saveId={data.snapshot.save.id}
      revision={data.snapshot.save.revision}
      selectedId={selectedTrinketId}
      targetSlot={selectedTrinketSlot}
      disabled={!hydrated || pending || !!closeCommand}
      onselect={(id) => (selectedTrinketId = id)}
      oncomplete={closeKeepsakeDialog}
    />
  {/if}
</Dialog>
{/if}

<style>
  .bar-page { width: min(100%, 100rem); margin-inline: auto; padding: clamp(.5rem, 1.8vw, 1.25rem); }
  .bar-shell { position: relative; min-width: 0; }
  .return-link:focus-visible, .text-button:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
  .quiet-room { margin: 0; padding: .3rem 0; color: #b9aa88; font-size: .9rem; }
  .codex-transfer { display: grid; justify-items: start; gap: .65rem; max-width: 40rem; margin: clamp(2rem, 12vh, 7rem) auto; color: #e8ddc4; }
  .codex-transfer .eyebrow { margin: 0; color: #d3b46d; font: 600 .7rem 'Cinzel', Georgia, serif; letter-spacing: .09em; text-transform: uppercase; }
  .codex-transfer h1 { margin: 0; color: #f0d27a; font: 600 clamp(1.5rem, 4vw, 2.25rem) 'Cinzel', Georgia, serif; }
  .codex-transfer p:not(.eyebrow) { max-width: 34rem; margin: 0 0 .3rem; color: #c9bb9b; line-height: 1.5; }
  .return-link { color: #ddc998; text-underline-offset: .2em; }
  .bar-empty-state { max-width: 36rem; margin: 8vh auto; text-align: center; }
  .bar-empty-state .text-button { display: block; margin: .6rem auto; }
  .keepsake-context { margin: 0 0 .8rem; color: #c9bb9b; }
  .dialog-copy { color: #d6c8a6; line-height: 1.5; }
  .full-button { width: 100%; }
  .primary-button:focus-visible, .inline-button:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
</style>
