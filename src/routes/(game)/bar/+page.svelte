<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { isActiveSettlement } from '$lib/game/evolving-world';
  import type { TrinketSlot } from '$lib/game/trinkets';
  import type { WorkflowChoice } from '$lib/components/ui/workflow';
  import { waitForBurn, type ResolvedBurnAction } from '$lib/card-effects';
  import NpcDialogue from '$lib/components/NpcDialogue.svelte';
  import WorkflowHand from '$lib/components/ui/WorkflowHand.svelte';
  import CardWorkflowFrame from '$lib/components/ui/CardWorkflowFrame.svelte';
  import Dialog from '$lib/components/ui/Dialog.svelte';
  import FloatingSurface from '$lib/components/ui/FloatingSurface.svelte';
  import ResidentInspector from '$lib/components/tavern/ResidentInspector.svelte';
  import SettlementInterlude from '$lib/components/tavern/SettlementInterlude.svelte';
  import TavernScene from '$lib/components/tavern/TavernScene.svelte';
  import BarStatusRail from '$lib/components/tavern/BarStatusRail.svelte';
  import TrinketCollection from '$lib/components/tavern/TrinketCollection.svelte';
  import type { PageProps, SubmitFunction } from './$types';

  let { data, form }: PageProps = $props();

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
  let deckOpen = $state(Boolean(validInitialSelection()));
  let cardSelected = $state(false);
  let workflowMode = $state<'actions' | 'talk' | 'serve'>('actions');
  let workflowFocusId = $state<string | null>(validInitialSelection() ? 'bar:talk' : null);
  let dialogueHand = $state<{
    items: WorkflowChoice[];
    selectedId: string | null;
    choose: (id: string) => void | Promise<void>;
    burningId: string | null;
    burnTurnId: string | null;
    burnAction?: ResolvedBurnAction;
    completeBurn: () => void;
  } | null>(null);
  let burningDialogueId: string | null = null;
  let dialogueBurnController: AbortController | null = null;
  let dialogueBusy = $state(false);
  let hydrated = $state(false);
  let pending = $state(false);
	let opening = $state(false);
  let closeDialogOpen = $state(false);
  let closeError = $state<string | null>(null);
  let closeCommand: { actionId: string; saveId: string; revision: number } | null = $state(null);
  let keepsakeDialogOpen = $state(false);
  let keepsakeBusy = $state(false);
  let selectedTrinketSlot = $state<TrinketSlot | null>(null);
  let selectedTrinketId = $state('');

  const patrons = $derived(data.snapshot?.patrons ?? []);
	const dailyDeck = $derived(data.snapshot?.dailyDeck);
	const serviceOpen = $derived(!dailyDeck || dailyDeck.phase === 'service');
  const collection = $derived(data.snapshot?.trinkets?.collection ?? []);
  const patron = $derived(patrons.find((resident) => resident.instanceId === selectedInstanceId) ?? null);
  const journal = $derived(patron ? data.journals[patron.instanceId] ?? null : null);
  const interactionBlocked = $derived(!hydrated || pending || dialogueBusy || keepsakeBusy || !!closeCommand);
  const codexHref = $derived(patron
    ? `/codex?section=residents&resident=${encodeURIComponent(patron.instanceId)}`
    : '/codex?section=residents');
  const codexCursorHref = $derived(patron && journal?.questArchive.nextCursor
    ? `/codex?section=residents&resident=${encodeURIComponent(patron.instanceId)}&questCursor=${encodeURIComponent(journal.questArchive.nextCursor)}`
    : codexHref);

  const residentActions: WorkflowChoice[] = [
    { id: 'bar:talk', title: 'Talk', description: 'Share a thought or ask what has been on their mind.', eyebrow: 'A quiet word', icon: '“', actionLabel: 'Choose', burn: true },
    { id: 'bar:serve', title: 'Offer food or drink', description: 'Choose a finished item from the house.', eyebrow: 'From the kitchen or cellar', icon: '♨', actionLabel: 'Browse', burn: true },
    { id: 'bar:back-room', title: 'Back to the room', description: 'Return to the common room scene.', eyebrow: 'The tavern', icon: '←', actionLabel: 'Return', burn: true }
  ];
  const workflowItems = $derived.by((): WorkflowChoice[] => {
    if (!patron) return [];
		// The service hand is authoritative and contains only physical daily copies.
		// Navigation remains in the frame rather than looking like a playable card.
		if (dailyDeck?.phase === 'service' && (workflowMode === 'talk' || workflowMode === 'serve')) {
			return dialogueHand?.items.filter((item) => item.id !== 'dialogue:start') ?? [];
		}
    if (workflowMode === 'talk') {
      return [
        ...(dialogueHand?.items.filter((item) => item.id === 'dialogue:start' || item.id.startsWith('dialogue:intent:')) ?? []),
        { id: 'bar:open-serving', title: 'Offer from house stock', description: 'Choose a finished food or drink to include in a conversation.', eyebrow: 'Serving', icon: '♨', actionLabel: 'Choose', burn: true },
        { id: 'bar:back-actions', title: 'Resident actions', description: 'Return to the resident’s action cards.', eyebrow: patron.name, icon: '←', actionLabel: 'Back', burn: true }
      ];
    }
    if (workflowMode === 'serve') {
      const stockChoices = dialogueHand?.items.filter((item) => item.id.startsWith('dialogue:service:')) ?? [];
      return [
        ...(stockChoices.length ? stockChoices : [{ id: 'bar:no-stock', title: 'No finished offerings', description: 'Prepare food or drink before offering something to this resident.', eyebrow: 'The house is out', icon: '◇', disabled: true }]),
        { id: 'bar:back-actions', title: 'Resident actions', description: 'Return to the resident’s action cards.', eyebrow: patron.name, icon: '←', actionLabel: 'Back', burn: true }
      ];
    }
    return residentActions;
  });
  const selectedWorkflowId = $derived(workflowMode === 'talk' || workflowMode === 'serve'
    ? dialogueHand?.selectedId ?? null
    : null);

  function updateDialogueHand(hand: NonNullable<typeof dialogueHand>) {
    const nextBurnTurnId = hand.burnTurnId;
    const nextBurnDuration = hand.burnAction?.durationMs;
    dialogueHand = hand;
    if (nextBurnTurnId === burningDialogueId) return;

    dialogueBurnController?.abort();
    dialogueBurnController = null;
    burningDialogueId = nextBurnTurnId;
    if (!nextBurnTurnId || !nextBurnDuration) return;

    const controller = new AbortController();
    dialogueBurnController = controller;
    void waitForBurn(nextBurnDuration, controller.signal).then((completed) => {
      if (!completed || dialogueBurnController !== controller) return;
      if (dialogueHand?.burnTurnId === nextBurnTurnId) dialogueHand.completeBurn();
      dialogueBurnController = null;
      burningDialogueId = null;
    });
  }

  function clearDialogueHand() {
    dialogueBurnController?.abort();
    dialogueBurnController = null;
    burningDialogueId = null;
    dialogueHand = null;
  }

  onDestroy(() => dialogueBurnController?.abort());

  async function focusWorkflowChoice(id: string | null) {
    if (!id) return;
    await tick();
    [...document.querySelectorAll<HTMLElement>('[data-workflow-choice]')]
      .find((choice) => choice.dataset.workflowChoice === id)
      ?.focus({ preventScroll: true });
  }

  async function backToActions() {
    if (interactionBlocked) return;
    const previousMode = workflowMode;
    workflowMode = 'actions';
    journalOpen = false;
    talkOpen = false;
    deckOpen = true;
    workflowFocusId = previousMode === 'serve' ? 'bar:serve' : 'bar:talk';
    await focusWorkflowChoice(workflowFocusId);
  }

  async function chooseWorkflowChoice(id: string) {
    if (interactionBlocked || !patron) return;
    workflowFocusId = id;

    if (id === 'bar:talk') {
      workflowMode = 'talk';
      journalOpen = false;
      talkOpen = false;
      deckOpen = true;
      workflowFocusId = 'dialogue:start';
      await focusWorkflowChoice(workflowFocusId);
    } else if (id === 'bar:serve') {
      workflowMode = 'serve';
      journalOpen = false;
      talkOpen = false;
      deckOpen = true;
      workflowFocusId = dialogueHand?.items.find((item) => item.id.startsWith('dialogue:service:'))?.id ?? 'bar:back-actions';
      await focusWorkflowChoice(workflowFocusId);
    } else if (id === 'bar:back-room') {
      await returnToBar();
    } else if (id === 'bar:open-serving') {
      workflowMode = 'serve';
      workflowFocusId = dialogueHand?.items.find((item) => item.id.startsWith('dialogue:service:'))?.id ?? 'bar:back-actions';
      await focusWorkflowChoice(workflowFocusId);
    } else if (id === 'bar:back-actions') {
      await backToActions();
    } else if (id.startsWith('dialogue:')) {
      await dialogueHand?.choose(id);
    }
  }

  $effect(() => {
    if (selectedInstanceId && !patrons.some((resident) => resident.instanceId === selectedInstanceId)) {
      selectedInstanceId = null;
      journalOpen = false;
      talkOpen = false;
      deckOpen = false;
      cardSelected = false;
      workflowMode = 'actions';
      workflowFocusId = null;
      clearDialogueHand();
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
      deckOpen = Boolean(nextSelection);
      cardSelected = false;
      journalOpen = false;
      workflowMode = 'actions';
      workflowFocusId = nextSelection ? 'bar:talk' : null;
      clearDialogueHand();
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

  async function selectPatron(instanceId: string) {
    if (interactionBlocked || !patrons.some((resident) => resident.instanceId === instanceId)) return;
    selectedInstanceId = instanceId;
    focusedInstanceId = instanceId;
    keepsakeDialogOpen = false;
    selectedTrinketSlot = null;
    journalOpen = false;
    talkOpen = false;
    deckOpen = true;
    cardSelected = false;
    workflowMode = 'actions';
    workflowFocusId = 'bar:talk';
    clearDialogueHand();
    await tick();
    await focusWorkflowChoice(workflowFocusId);
  }

  async function returnToBar() {
    if (interactionBlocked) return;
    const returningInstanceId = selectedInstanceId;
    selectedInstanceId = null;
    journalOpen = false;
    talkOpen = false;
    deckOpen = false;
    cardSelected = false;
    workflowMode = 'actions';
    workflowFocusId = null;
    clearDialogueHand();
    clearPatronUrl();
    await tick();
    if (!returningInstanceId) return;
    const actorKey = `patron:${returningInstanceId}`;
    const target = [...document.querySelectorAll<HTMLButtonElement>('button[data-scene-actor]')]
      .find((button) => button.dataset.sceneActor === actorKey);
    target?.focus({ preventScroll: true });
  }

  async function setJournalOpen(open: boolean) {
    journalOpen = open;
    await tick();
    document.querySelector<HTMLElement>(open
      ? '[data-bar-control="journal-close"]'
      : '[data-bar-control="journal"]')?.focus({ preventScroll: true });
  }

  async function handleFrameBack() {
    if (journalOpen) {
      await setJournalOpen(false);
      return;
    }
    if (workflowMode === 'actions') await returnToBar();
    else await backToActions();
  }

  async function handleEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;

    if (keepsakeDialogOpen) {
      event.preventDefault();
      event.stopPropagation();
      await closeKeepsakeDialog();
      return;
    }

    if (journalOpen) {
      event.preventDefault();
      event.stopPropagation();
      await setJournalOpen(false);
      return;
    }

    if (talkOpen) {
      event.preventDefault();
      event.stopPropagation();
      talkOpen = false;
      deckOpen = true;
      workflowFocusId = dialogueHand?.selectedId ?? (workflowMode === 'serve'
        ? dialogueHand?.items.find((item) => item.id.startsWith('dialogue:service:'))?.id ?? 'bar:back-actions'
        : 'dialogue:start');
      await focusWorkflowChoice(workflowFocusId);
      return;
    }

    if (dialogueBusy) return;

    if (patron && !interactionBlocked) {
      event.preventDefault();
      event.stopPropagation();
      await handleFrameBack();
    }
  }

  async function openKeepsake(slot: TrinketSlot) {
    if (interactionBlocked || patron) return;
    selectedTrinketSlot = slot;
    selectedTrinketId = collection.find((item) => item.slot === slot)?.id ?? collection.find((item) => item.slot === null)?.id ?? '';
    keepsakeDialogOpen = true;
    await tick();
    document.querySelector<HTMLButtonElement>('[aria-label="Close keepsake details"]')?.focus({ preventScroll: true });
  }

  async function closeKeepsakeDialog(completed = false) {
    if (keepsakeBusy && !completed) return;
    const returningSlot = selectedTrinketSlot;
    keepsakeDialogOpen = false;
    selectedTrinketSlot = null;
    if (completed) keepsakeBusy = false;
    await tick();
    if (returningSlot !== null) document.querySelector<HTMLElement>(`[data-keepsake-slot="${returningSlot + 1}"]`)?.focus({ preventScroll: true });
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

	const enhanceOpen: SubmitFunction = ({ formData, cancel }) => {
		if (!data.snapshot || opening) { cancel(); return; }
		formData.set('revision', String(data.snapshot.save.revision));
		opening = true;
		return async ({ result, update }) => {
			try { await update({ reset: false, invalidateAll: true }); }
			finally { opening = false; }
		};
	};
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
      <CardWorkflowFrame
        title={patron?.name ?? 'The Bar'}
        eyebrow={patron ? 'A resident at the bar' : 'The common room'}
        location={patron ? 'The tavern · Bar' : 'The tavern · Common room'}
        onback={patron ? handleFrameBack : undefined}
        backLabel={journalOpen ? 'Close journal' : workflowMode === 'actions' ? 'Return to room' : 'Resident actions'}
        showFolio={!serviceOpen || (patron
          ? workflowMode === 'actions' || journalOpen || talkOpen || dialogueBusy || Boolean(data.dialogueUnavailable)
          : patrons.length === 0)}
        showHand={!!patron && (deckOpen || talkOpen)}
        inspectionMode={!journalOpen && talkOpen ? 'dialogue' : 'folio'}
      >
        {#snippet scene()}
          <TavernScene
            presentation="player-hand"
            renderInteraction={false}
            renderStatus={false}
            {patrons}
            selected={patron}
            focusedKey={focusedInstanceId}
            trinkets={collection}
            day={data.snapshot?.save.currentDay ?? 1}
            gold={data.snapshot?.save.gold ?? 0}
            archiveHref={codexHref}
            disabled={!serviceOpen || !hydrated || pending || dialogueBusy || keepsakeBusy || !!closeCommand}
			phase={dailyDeck?.phase ?? 'service'}
            closeDisabled={!hydrated || pending || dialogueBusy || keepsakeBusy}
            onselect={selectPatron}
            onfocus={(instanceId) => (focusedInstanceId = instanceId)}
            onback={returnToBar}
            onclose={() => { closeError = null; closeDialogOpen = true; }}
            onkeepsake={openKeepsake}
          />
        {/snippet}
        {#snippet status()}
			<BarStatusRail embedded day={data.snapshot?.save.currentDay ?? 1} gold={data.snapshot?.save.gold ?? 0} phase={dailyDeck?.phase ?? 'service'} disabled={interactionBlocked || !serviceOpen} presentation={patron ? 'player-hand' : 'default'} onclose={() => { closeError = null; closeDialogOpen = true; }} />
        {/snippet}
        {#snippet controls()}
          {#if patron}
            <button
              class="journal-control"
              type="button"
              data-bar-control="journal"
              aria-controls="resident-journal"
              aria-expanded={journalOpen}
              onclick={() => setJournalOpen(!journalOpen)}
            >
              {journalOpen ? 'Close journal' : 'Journal'}
            </button>
          {/if}
        {/snippet}
        {#snippet folio()}
			{#if !serviceOpen}
				<section class="prep-panel" aria-labelledby="prep-title">
					<p class="eyebrow">Today's guests are here</p>
					<h2 id="prep-title">Prepare the common room</h2>
					<p>{patrons.length ? `${patrons.map((guest) => guest.name).join(', ')} ${patrons.length === 1 ? 'is' : 'are'} expected today.` : 'The room is quiet today.'} You may visit the garden or shop, make food or drink, or open now.</p>
					<nav aria-label="Preparation places"><a href="/garden">Garden</a><a href="/shop">Shop</a><a href="/bakery">Bakery</a><a href="/brewery">Brewery</a></nav>
					<form method="POST" action="?/open" use:enhance={enhanceOpen}><button class="primary-button" disabled={!hydrated || opening || pending}>{opening ? 'Shuffling the hand…' : 'Open the tavern'}</button></form>
					{#if form?.message}<p class="form-message" role="status">{form.message}</p>{/if}
				</section>
			{:else}
          {#if patron}
            {#if data.snapshot && journal}
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
                barHand={true}
                externalHand={true}
                frameMode={true}
                cardBurnStyle={data.cardBurnStyle}
                suspended={journalOpen || (workflowMode !== 'talk' && workflowMode !== 'serve')}
                blocked={pending || !!closeCommand}
                focusActive={true}
                composerOpen={talkOpen}
                {deckOpen}
                onbusychange={(busy) => {
                  dialogueBusy = busy;
                  if (busy && workflowMode !== 'talk' && workflowMode !== 'serve') {
                    workflowMode = 'talk';
                    talkOpen = true;
                    deckOpen = false;
                    workflowFocusId = 'dialogue:start';
                  }
                }}
                oncomposerchange={(open) => {
                  talkOpen = open;
                  if (!open) {
                    deckOpen = true;
                    workflowFocusId = dialogueHand?.selectedId ?? (workflowMode === 'serve'
                      ? dialogueHand?.items.find((item) => item.id.startsWith('dialogue:service:'))?.id ?? 'bar:back-actions'
                      : 'dialogue:start');
                  }
                }}
                ondeckchange={(open) => (deckOpen = open)}
                onselectionchange={(selected) => {
                  cardSelected = selected;
                  if (selected) journalOpen = false;
                }}
                onworkflowhandchange={updateDialogueHand}
              />
            {:else if !journalOpen && (workflowMode === 'talk' || workflowMode === 'serve')}
              <p class="quiet-room" role="status">This resident’s journal is unavailable right now.</p>
            {/if}

            {#if journalOpen || (workflowMode !== 'talk' && workflowMode !== 'serve')}
              {@const snapshot = data.snapshot}
              <ResidentInspector
                {patron}
                {journal}
                history={snapshot?.history ?? []}
                archiveHref={codexCursorHref}
                {codexHref}
                {journalOpen}
                interactionOpen={talkOpen}
                onjournalchange={setJournalOpen}
              />
            {/if}
          {:else if patrons.length === 0}
            <p class="quiet-room" role="status">The common room is quiet. The scene’s keepsake slots still open their manager; past residents are in the Codex.</p>
			{/if}
			{/if}
        {/snippet}
        {#snippet hand()}
          {#if patron && (deckOpen || talkOpen)}
            <WorkflowHand
              items={workflowItems}
              label={workflowMode === 'talk' ? `Conversation choices for ${patron.name}` : workflowMode === 'serve' ? `Offerings for ${patron.name}` : `Actions for ${patron.name}`}
              selectedId={selectedWorkflowId}
              focusId={workflowFocusId}
              burnStyle={data.cardBurnStyle}
              burningId={dialogueHand?.burningId}
              burnAction={dialogueHand?.burnAction}
              pending={interactionBlocked || talkOpen || journalOpen}
              muted={talkOpen || journalOpen}
              onchoose={chooseWorkflowChoice}
            />
          {/if}
        {/snippet}
      </CardWorkflowFrame>

      {#if keepsakeDialogOpen && selectedTrinketSlot !== null && data.snapshot && !patron}
        <FloatingSurface
          as="section"
          id="keepsake-manager"
          class={'keepsake-surface ' + (selectedTrinketSlot % 2 === 0 ? 'slot-left' : 'slot-right')}
          role="region"
          aria-labelledby="keepsake-title"
          style={'--slot-row:' + (selectedTrinketSlot < 2 ? '.19' : '.34')}
        >
          <header class="keepsake-heading">
            <h2 id="keepsake-title">Keepsake slot {selectedTrinketSlot + 1}</h2>
            <button type="button" class="surface-close" aria-label="Close keepsake details" disabled={keepsakeBusy} onclick={() => closeKeepsakeDialog()}>×</button>
          </header>
          <div class="keepsake-body">
            <TrinketCollection
              {collection}
              saveId={data.snapshot.save.id}
              revision={data.snapshot.save.revision}
              selectedId={selectedTrinketId}
              targetSlot={selectedTrinketSlot}
              disabled={!hydrated || pending || !!closeCommand}
              onselect={(id) => (selectedTrinketId = id)}
              onbusychange={(busy) => (keepsakeBusy = busy)}
              oncomplete={() => closeKeepsakeDialog(true)}
            />
          </div>
        </FloatingSurface>
      {/if}
    </div>
  {/if}
</main>


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



<style>
  .bar-page { width: min(100%, 100rem); margin-inline: auto; padding: clamp(.5rem, 1.8vw, 1.25rem); }
  .bar-shell { position: relative; min-width: 0; container-type: inline-size; --bar-scene-height: calc(100cqw * 9 / 16); }
  .return-link:focus-visible, .text-button:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
  .quiet-room { margin: 0; padding: .3rem 0; color: #b9aa88; font-size: .9rem; }
	.prep-panel { display: grid; gap: .85rem; max-width: 42rem; padding: clamp(1rem, 3vw, 1.6rem); border: 1px solid #6d5328; background: linear-gradient(145deg, rgb(41 30 15 / .94), rgb(18 13 8 / .94)); color: #eadabd; }
	.prep-panel h2, .prep-panel p { margin: 0; }
	.prep-panel h2 { color: #f4de9d; font: 600 1.35rem 'Cinzel', Georgia, serif; }
	.prep-panel p { line-height: 1.5; }
	.prep-panel nav { display: flex; flex-wrap: wrap; gap: .5rem; }
	.prep-panel nav a { min-height: 2.6rem; display: inline-flex; align-items: center; padding: .35rem .7rem; border: 1px solid #806631; color: #f0daa1; text-decoration: none; }
	.prep-panel nav a:hover { border-color: #d2ac5a; background: rgb(111 80 29 / .35); }
	.prep-panel nav a:focus-visible { outline: 2px solid #ffe49c; outline-offset: 2px; }
  .codex-transfer { display: grid; justify-items: start; gap: .65rem; max-width: 40rem; margin: clamp(2rem, 12vh, 7rem) auto; color: #e8ddc4; }
  .codex-transfer .eyebrow { margin: 0; color: #d3b46d; font: 600 .7rem 'Cinzel', Georgia, serif; letter-spacing: .09em; text-transform: uppercase; }
  .codex-transfer h1 { margin: 0; color: #f0d27a; font: 600 clamp(1.5rem, 4vw, 2.25rem) 'Cinzel', Georgia, serif; }
  .codex-transfer p:not(.eyebrow) { max-width: 34rem; margin: 0 0 .3rem; color: #c9bb9b; line-height: 1.5; }
  .return-link { color: #ddc998; text-underline-offset: .2em; }
  .bar-empty-state { max-width: 36rem; margin: 8vh auto; text-align: center; }
  .bar-empty-state .text-button { display: block; margin: .6rem auto; }
  .journal-control { display: inline-flex; min-height: 2.75rem; align-items: center; justify-content: center; padding: .4rem .75rem; border: 1px solid #806631; color: #ebd9ad; background: rgb(17 12 6 / .92); font: inherit; font-size: .84rem; font-weight: 650; white-space: nowrap; cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease; }
  .journal-control:hover { border-color: #c49b4e; background: #392910; }
  .journal-control:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  .bar-shell :global(.keepsake-surface) { position: absolute; z-index: 60; top: calc(var(--bar-scene-height) * var(--slot-row) + 3.5rem); display: grid; grid-template-rows: auto minmax(0, 1fr); width: min(24rem, calc(100% - 2rem)); max-height: min(65dvh, 32rem); padding: 1rem; overflow: hidden; background: rgb(32 24 19 / .76); }
  .bar-shell :global(.slot-left) { left: calc(3.5% + 3.5rem); }
  .bar-shell :global(.slot-right) { right: calc(15% + 3.5rem); }
  .keepsake-heading { display: flex; gap: 1rem; align-items: center; justify-content: space-between; padding-bottom: .75rem; border-bottom: 1px solid rgb(230 205 161 / .25); }
  .keepsake-heading h2 { margin: 0; color: #e3ca8d; font: 600 .8rem 'Cinzel', Georgia, serif; }
  .surface-close { width: 2.75rem; height: 2.75rem; flex: 0 0 auto; border: 1px solid #8c754a; border-radius: .5rem; background: transparent; color: #eee2c4; font-size: 1.2rem; cursor: pointer; }
  .surface-close:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  .surface-close:disabled { opacity: .5; cursor: wait; }
  .keepsake-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding-top: .75rem; }
  @media (max-width: 820px) { .bar-shell { --bar-scene-height: calc(100cqw * 2 / 3); } }
  @media (max-width: 620px) { .bar-shell :global(.keepsake-surface) { left: 1rem; right: 1rem; width: auto; } }
  .dialog-copy { color: #d6c8a6; line-height: 1.5; }
  .full-button { width: 100%; }
  .primary-button:focus-visible, .inline-button:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
</style>
