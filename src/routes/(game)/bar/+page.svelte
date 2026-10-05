<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { qualityLabel } from '$lib/game/contracts';
  import { reconcileBarSceneSelection, selectedBarPatron } from '$lib/game/bar-scene';
  import { isActiveSettlement } from '$lib/game/evolving-world';
  import type { ServeCommand } from '$lib/game/serving';
  import NpcDialogue from '$lib/components/NpcDialogue.svelte';
  import BarStatusRail from '$lib/components/tavern/BarStatusRail.svelte';
  import GuestInspector from '$lib/components/tavern/GuestInspector.svelte';
  import TavernScene from '$lib/components/tavern/TavernScene.svelte';
  import SettlementInterlude from '$lib/components/tavern/SettlementInterlude.svelte';
  import TrinketCollection from '$lib/components/tavern/TrinketCollection.svelte';
  import Tabs from '$lib/components/ui/Tabs.svelte';
  import Dialog from '$lib/components/ui/Dialog.svelte';
  import type { PageProps, SubmitFunction } from './$types';

  let { data, form }: PageProps = $props();

  type BarDestination = 'room' | 'journal' | 'keepsakes' | 'archive';
  const liveInteractionTabs = [
    { id: 'talk', label: 'Talk' },
    { id: 'serve', label: 'Serve' },
    { id: 'about', label: 'About' }
  ];
  const archiveInteractionTabs = [
    { id: 'talk', label: 'Conversations' },
    { id: 'about', label: 'About' }
  ];
  let interactionTab = $state('talk');
  let dialogueBusy = $state(false);
  let closeDialogOpen = $state(false);
  let lastAction = $state<'serve' | 'close' | null>(null);
  let selectedTrinketId = $state('');
  let currentView = $derived(page.url.searchParams.get('view') ?? 'room');
  let isJournal = $derived(!data.archived && currentView === 'journal');
  let isKeepsakes = $derived(!data.archived && currentView === 'keepsakes');
  let isCommonRoom = $derived(!data.archived && !isJournal && !isKeepsakes);
  let activeDestination = $derived(data.archived ? 'archive' : isJournal ? 'journal' : isKeepsakes ? 'keepsakes' : 'room');
  let interactionTabs = $derived((data.archived ? archiveInteractionTabs : liveInteractionTabs).map((tab) => ({ ...tab, disabled: (dialogueBusy || pending || !!unresolved || !!closeCommand) && tab.id !== interactionTab })));
  let showConversation = $derived(isJournal || (isCommonRoom && interactionTab === 'talk') || (data.archived && (data.snapshot?.roster.length ?? 0) > 0 && interactionTab === 'talk'));
  let closeError = $state<string | null>(null);

  $effect(() => {
    if (data.archived && interactionTab === 'serve') interactionTab = 'talk';
    const collection = data.snapshot?.trinkets?.collection ?? [];
    if (!collection.some((item) => item.id === selectedTrinketId)) selectedTrinketId = collection[0]?.id ?? '';
  });

  function destinationHref(destination: BarDestination) {
    const params = new URLSearchParams();
    if (destination === 'journal') params.set('view', 'journal');
    if (destination === 'keepsakes') params.set('view', 'keepsakes');
    if (destination === 'archive') params.set('archive', '1');
    const residentId = data.archived && destination !== 'archive' ? activePatronBeforeArchive ?? selectedInstanceId : selectedInstanceId;
    if (residentId) params.set('npc', residentId);
    const query = params.toString();
    return `/bar${query ? `?${query}` : ''}`;
  }

  function selectPatron(instanceId: string) {
    if (dialogueBusy || pending || unresolved || closeCommand) return;
    selectedInstanceId = instanceId;
    focusedInstanceId = instanceId;
    const params = new URLSearchParams(page.url.searchParams);
    params.set('npc', instanceId);
    const query = params.toString();
    replaceState(`/bar${query ? `?${query}` : ''}`, page.state);
  }
  function initialSelection() {
    const patrons = data.archived ? data.snapshot?.roster ?? [] : data.snapshot?.patrons ?? [];
    return data.selectedNpcInstanceId
      && patrons.some((entry) => entry.instanceId === data.selectedNpcInstanceId)
        ? data.selectedNpcInstanceId
        : patrons[0]?.instanceId ?? null;
  }
  const initialSelectedInstanceId = initialSelection();
  let activePatronBeforeArchive = $state(untrack(() => data.archived ? null : initialSelectedInstanceId));
  // Seed selection during SSR so hydration does not insert the conversation
  // composer after first paint and shift the whole mobile Bar layout.
  let selectedInstanceId = $state<string | null>(initialSelectedInstanceId);
  $effect(() => { if (!data.archived && selectedInstanceId) activePatronBeforeArchive = selectedInstanceId; });
  let focusedInstanceId = $state<string | null>(initialSelectedInstanceId);
  let itemSelection = $state('');
  let pending = $state(false);
  let unresolved = $state<ServeCommand | null>(null);
  let localError = $state<string | null>(null);
  let hydrated = $state(false);
  let closeCommand: {actionId:string;saveId:string;revision:number}|null=$state(null);
  let displayedPatrons = $derived(data.archived ? data.snapshot?.roster ?? [] : data.snapshot?.patrons ?? []);
  $effect(() => {
    if (selectedInstanceId && displayedPatrons.some((resident) => resident.instanceId === selectedInstanceId)) return;
    const requested = displayedPatrons.find((resident) => resident.instanceId === data.selectedNpcInstanceId)?.instanceId;
    selectedInstanceId = requested ?? displayedPatrons[0]?.instanceId ?? null;
    focusedInstanceId = selectedInstanceId;
  });
  const enhanceClose:SubmitFunction=({formData,cancel})=>{
    if(!data.snapshot||pending){cancel();return;}
    lastAction = 'close';
    closeCommand??={actionId:crypto.randomUUID(),saveId:data.snapshot.save.id,revision:data.snapshot.save.revision};
    for(const [key,value] of Object.entries(closeCommand))formData.set(key,String(value));
    pending=true;
    return async({result,update})=>{
      if(result.type==='error'||result.type==='failure'&&result.status>=500){closeError='Closing could not be confirmed. Retry closing to recover the result.';pending=false;return;}
      closeCommand=null;
      closeError=null;
      if(result.type==='success'){closeDialogOpen=false;lastAction=null;}
      try{await update({reset:false});if(result.type==='failure')await invalidateAll();}
      catch{closeError='The journal could not be refreshed. Refresh the bar to see the current day.';}finally{pending=false;}
    };
  };
  $effect(() => { hydrated = true; });
  let patron = $derived(selectedBarPatron(displayedPatrons, selectedInstanceId));
  let selectedKind = $derived(itemSelection.startsWith('food:') ? 'food' as const : 'beverage' as const);
  let selectedId = $derived(itemSelection.split(':', 2)[1] ?? '');
  let item = $derived(selectedKind === 'food'
    ? data.snapshot?.foods.find((food) => food.id === selectedId)
    : data.snapshot?.beverages.find((drink) => drink.id === selectedId));

  $effect(() => {
    if (unresolved) return;
    const patrons = displayedPatrons;
    const reconciled = reconcileBarSceneSelection(patrons, { selectedKey: selectedInstanceId, focusedKey: focusedInstanceId });
    selectedInstanceId = reconciled.selectedKey;
    focusedInstanceId = reconciled.focusedKey;
    const choices = [
      ...(data.snapshot?.beverages.map((drink) => `beverage:${drink.id}`) ?? []),
      ...(data.snapshot?.foods.map((food) => `food:${food.id}`) ?? [])
    ];
    if (!choices.includes(itemSelection)) itemSelection = choices[0] ?? '';
  });

  const enhanceServe: SubmitFunction = ({ formData, cancel }) => {
    if (!data.snapshot || pending || (!unresolved && !item)) { cancel(); return; }
    lastAction = 'serve';
    unresolved ??= {
      saveId: data.snapshot.save.id, instanceId: patron?.instanceId ?? '', itemKind: selectedKind, itemId: selectedId,
      actionId: crypto.randomUUID(), expectedRevision: data.snapshot.save.revision
    };
    const command = unresolved;
    for (const [key, value] of Object.entries(command)) formData.set(key, String(value ?? ''));
    pending = true;
    localError = null;
    return async ({ result, update }) => {
      // Unknown outcomes retain the entire command; selection cannot alter a retry.
      if (result.type === 'error' || (result.type === 'failure' && result.status >= 500)) {
        pending = false;
        localError = 'The serving outcome is unknown. Retry the same pour to check whether it was recorded.';
        return;
      }
      unresolved = null;
      try {
        await update({ reset: false, invalidateAll: true });
        // Enhanced form failures do not invalidate loads, even when requested.
        if (result.type === 'failure') await invalidateAll();
      } catch {
        localError = result.type === 'success'
          ? 'Your pour was recorded, but the latest bar could not be loaded. Refresh the bar to continue.'
          : 'The bar could not be refreshed. Refresh the bar to continue.';
      } finally { pending = false; }
    };
  };

  async function refreshCloseStatus() {
    pending = true;
    try { await invalidateAll(); closeError = null; }
    catch { closeError = 'The latest tavern status could not be loaded. Try refreshing again.'; }
    finally { pending = false; }
  }

  function guardNavigation(event: MouseEvent) {
    if (dialogueBusy || pending || unresolved || closeCommand) event.preventDefault();
  }

  async function refreshBar() {
    pending = true;
    try { await invalidateAll(); localError = null; }
    catch { localError = 'The bar is still unavailable. Please try refreshing again.'; }
    finally { pending = false; }
  }

  function relationshipFeedback(value: number) {
    return value > 0 ? 'Trust grew' : value < 0 ? 'Trust was hurt' : 'Trust held steady';
  }
  function archivePageHref(cursor: string) {
    const params = new URLSearchParams();
    if (data.archived) params.set('archive', '1');
    if (patron) params.set('npc', patron.instanceId);
    params.set('questCursor', cursor);
    return `/bar?${params}`;
  }
</script>

<svelte:head>
  <title>The bar · By Rook and Crook</title>
  <meta name="description" content="Welcome the regulars, pour your finest mead, and follow their stories." />
</svelte:head>

<main class="bar-page">
  {#if data.settlement && isActiveSettlement(data.settlement)}
    <SettlementInterlude settlement={data.settlement} />
  {:else if !data.snapshot}
    <section class="empty-state bar-empty-state" aria-labelledby="bar-empty-title">
      <p class="eyebrow">The tavern is waiting</p>
      <h1 id="bar-empty-title">Open the doors</h1>
      <p>Start your tavern in the garden, then bring your first brew to the bar.</p>
      <a class="primary-button inline-button" href="/garden">Start your tavern</a>
    </section>
  {:else}
    <div class="bar-shell">
      <BarStatusRail
        day={data.snapshot.save.currentDay}
        gold={data.snapshot.save.gold}
        drinks={data.snapshot.beverages.length}
        foods={data.snapshot.foods.length}
        disabled={!hydrated || pending || !!unresolved || dialogueBusy}
        onclose={() => (closeDialogOpen = true)}
      />

      <nav class="destination-nav" aria-label="Tavern destinations">
        <a href={destinationHref('room')} aria-disabled={dialogueBusy || pending || !!unresolved || !!closeCommand} onclick={guardNavigation} aria-current={activeDestination === 'room' ? 'page' : undefined}>Common room</a>
        <a href={destinationHref('journal')} aria-disabled={dialogueBusy || pending || !!unresolved || !!closeCommand} onclick={guardNavigation} aria-current={activeDestination === 'journal' ? 'page' : undefined}>Keeper’s Journal</a>
        <a href={destinationHref('keepsakes')} aria-disabled={dialogueBusy || pending || !!unresolved || !!closeCommand} onclick={guardNavigation} aria-current={activeDestination === 'keepsakes' ? 'page' : undefined}>Keepsakes</a>
        <a href={destinationHref('archive')} aria-disabled={dialogueBusy || pending || !!unresolved || !!closeCommand} onclick={guardNavigation} aria-current={activeDestination === 'archive' ? 'page' : undefined}>Past residents</a>
      </nav>

      {#if data.archived && displayedPatrons.length > 0}
        <section class="resident-picker" aria-labelledby="resident-picker-title">
          <div>
            <p class="eyebrow">Read-only archive</p>
            <h1 id="resident-picker-title">Past residents</h1>
            <p>{displayedPatrons.length > 0 ? 'Choose a name to revisit their conversations and history.' : 'Departed and dismissed residents will be recorded here.'}</p>
          </div>
          {#if displayedPatrons.length > 0}
            <label for="archived-resident">Resident
              <select id="archived-resident" value={selectedInstanceId ?? ''} onchange={(event) => selectPatron(event.currentTarget.value)} disabled={!hydrated || dialogueBusy || pending || !!unresolved || !!closeCommand}>
                {#each displayedPatrons as resident (resident.instanceId)}
                  <option value={resident.instanceId}>{resident.name}</option>
                {/each}
              </select>
            </label>
          {/if}
        </section>
      {/if}

      <div class="bar-layout" class:with-scene={isCommonRoom}>
        {#if isCommonRoom}
          <div class="scene-stage" aria-label="The tavern common room">
            <TavernScene
              patrons={data.snapshot.patrons}
              selected={patron}
              focusedKey={focusedInstanceId}
              trinkets={data.snapshot.trinkets?.collection ?? []}
              response={patron ? data.journals[patron.instanceId]?.turns.at(-1)?.reply ?? null : null}
              journalHref={destinationHref('journal')}
              disabled={!hydrated || pending || !!unresolved || !!closeCommand || dialogueBusy}
                            onselect={selectPatron}
              onfocus={(instanceId) => (focusedInstanceId = instanceId)}
            />
          </div>
        {/if}

        <section class="destination-surface" aria-labelledby={data.archived && displayedPatrons.length === 0 ? 'archive-empty-title' : 'surface-title'}>
          {#if isJournal}
            <header class="surface-heading">
              <p class="eyebrow">The keeper’s record</p>
              <h1 id="surface-title">Keeper’s Journal</h1>
              <p>Hospitality, overnight news, and the stories your regulars carry.</p>
            </header>
            <SettlementInterlude settlement={data.settlement} />
            <section class="journal-history" aria-labelledby="history-title">
              <div class="section-heading"><div><p class="eyebrow">From the bar</p><h2 id="history-title">Recent hospitality</h2></div></div>
              {#if data.snapshot.history.length === 0}
                <p class="muted">Your first serving will begin the journal.</p>
              {:else}
                <ol class="history-list">
                  {#each data.snapshot.history as event (event.actionId)}
                    <li>
                      <div><strong>{event.itemName}</strong><small>Day {event.dayNumber} · {qualityLabel(event.qualityIndex)}</small></div>
                      <p>+{event.goldEarned} gold <span aria-hidden="true">·</span> {relationshipFeedback(event.relationshipChange)}</p>
                    </li>
                  {/each}
                </ol>
              {/if}
            </section>
            <div class="journal-resident-label">
              <p class="eyebrow">Resident journal</p>
              <h2>{patron?.name ?? 'No resident selected'}</h2>
            </div>
          {:else if isKeepsakes}
            <header class="surface-heading">
              <p class="eyebrow">On display in the common room</p>
              <h1 id="surface-title">Keepsakes</h1>
              <p>Arrange the four treasures that lend their quiet luck to the tavern.</p>
            </header>
            <TrinketCollection
              collection={data.snapshot.trinkets?.collection ?? []}
              saveId={data.snapshot.save.id}
              revision={data.snapshot.save.revision}
              disabled={!hydrated || pending || !!unresolved}
              selectedId={selectedTrinketId}
              onselect={(id) => (selectedTrinketId = id)}
            />
          {:else if !data.archived}
            <header class="surface-heading patron-heading">
              <p class="eyebrow">At the bar</p>
              {#if patron}
                <h1 id="surface-title">{patron.name}</h1>
                <p>{patron.title}</p>
              {:else}
                <h1 id="surface-title">The common room</h1>
                <p>Choose someone in the room to begin.</p>
              {/if}
            </header>
          {:else if data.archived && displayedPatrons.length > 0}
            <header class="surface-heading patron-heading">
              <p class="eyebrow">Past resident</p>
              <h1 id="surface-title">{patron?.name ?? 'Resident journal'}</h1>
              <p>{patron?.title ?? 'Choose a name from the archive.'}</p>
            </header>
          {/if}

          {#if data.archived && displayedPatrons.length === 0}
            <section class="archive-empty" role="status" aria-labelledby="archive-empty-title">
              <h2 id="archive-empty-title">No past residents yet</h2>
              <p>Departed and dismissed residents will have their conversations and story records here.</p>
              <a class="text-button" href={destinationHref('room')}>Return to the common room</a>
            </section>
          {/if}

          {#if isCommonRoom || (data.archived && displayedPatrons.length > 0)}
            <Tabs
              id="patron-actions"
              label={data.archived ? 'Past resident sections' : `Actions for ${patron?.name ?? 'the common room'}`}
              bind:value={interactionTab}
              tabs={interactionTabs}
            />
          {/if}

          <section
            class="interaction-panel"
            role={isCommonRoom || data.archived ? 'tabpanel' : 'region'}
            id="patron-actions-panel"
            aria-labelledby={isCommonRoom || data.archived ? `patron-actions-tab-${interactionTab}` : 'surface-title'}
            tabindex="-1"
            hidden={isKeepsakes || (data.archived && displayedPatrons.length === 0)}
          >
            {#if isJournal && !patron}
              <p class="empty-journal muted">Select a current guest in the common room to read their conversation and quest record.</p>
            {/if}

            <div class="conversation-host" class:journal-host={isJournal} hidden={!showConversation}>
              {#if patron && data.journals[patron.instanceId]}
                {#key patron.instanceId}
                  <NpcDialogue
                    npcId={patron.npcId}
                    name={patron.name}
                    journal={data.journals[patron.instanceId]}
                    stock={data.snapshot}
                    unavailable={data.dialogueUnavailable}
                    archived={data.archived}
                    archiveHref={data.journals[patron.instanceId].questArchive.nextCursor ? archivePageHref(data.journals[patron.instanceId].questArchive.nextCursor!) : null}
                    embedded={true}
                    journalOnly={isJournal || data.archived}
                  blocked={pending || !!unresolved || !!closeCommand}
                  onbusychange={(busy) => (dialogueBusy = busy)}
                  />
                {/key}
              {:else if isJournal}
                <p class="muted">No resident journal is available yet.</p>
              {:else}
                <p class="quiet-room">The common room is quiet. Choose a patron in the scene to begin.</p>
              {/if}
            </div>

            {#if interactionTab === 'serve' && isCommonRoom}
              <section class="serve-panel" aria-labelledby="serve-title">
                <div class="section-heading"><div><p class="eyebrow">From your cellar</p><h2 id="serve-title">Offer something</h2></div></div>
                {#if data.snapshot.beverages.length === 0 && data.snapshot.foods.length === 0 && !unresolved}
                  <div class="serve-empty">
                    <p>No hospitality is ready to serve.</p>
                    <div class="empty-actions"><a class="secondary-link compact" href="/brewery">Brew a drink</a><a class="secondary-link compact" href="/bakery">Bake some food</a></div>
                  </div>
                {:else}
                  <form method="POST" action="?/serve" use:enhance={enhanceServe}>
                    <fieldset disabled={!hydrated || pending || !!unresolved || !!closeCommand || dialogueBusy}>
                      <legend>Choose food or drink</legend>
                      <div class="pour-options">
                        {#each data.snapshot.beverages as drink (drink.id)}
                          <label class:selected={itemSelection === `beverage:${drink.id}`}>
                            <input type="radio" value={`beverage:${drink.id}`} bind:group={itemSelection} />
                            <span><strong>{drink.name}</strong><small>{qualityLabel(drink.qualityIndex)}</small></span>
                          </label>
                        {/each}
                        {#each data.snapshot.foods as food (food.id)}
                          <label class:selected={itemSelection === `food:${food.id}`}>
                            <input type="radio" value={`food:${food.id}`} bind:group={itemSelection} />
                            <span><strong>{food.name}</strong><small>{qualityLabel(food.qualityIndex)}</small></span>
                          </label>
                        {/each}
                      </div>
                    </fieldset>
                    {#if item && patron}<p class="pour-summary">{patron.name} receives this {qualityLabel(item.qualityIndex).toLowerCase()} offering.</p>{/if}
                    <button class="primary-button full-button" disabled={!hydrated || pending || !!closeCommand || dialogueBusy || (!item && !unresolved) || (!unresolved && (!patron || data.journals[patron.instanceId]?.availability !== 'present'))}>
                      {pending ? 'Serving…' : unresolved ? 'Retry the same serving' : `Serve to ${patron?.name ?? 'guest'}`}
                    </button>
                  </form>
                {/if}
                {#if localError}
                  <p class="form-message error" role="alert">{localError}</p>
                  {#if !unresolved}<button class="text-button" type="button" disabled={pending} onclick={refreshBar}>Refresh bar</button>{/if}
                {:else if form?.message && lastAction === 'serve'}
                  <div class="form-message" class:error={!('success' in form && form.success)} role={'success' in form ? 'status' : 'alert'}><p>{form.message}</p></div>
                {/if}
              </section>
            {/if}

            <div class="about-host" hidden={interactionTab !== 'about' || isJournal || isKeepsakes}>
              <GuestInspector
                selected={patron}
                journal={patron ? data.journals[patron.instanceId] ?? null : null}
                stock={data.snapshot}
                archived={data.archived}
                disabled={!hydrated || pending || !!unresolved || !!closeCommand || dialogueBusy}
                archiveHref={patron && data.journals[patron.instanceId]?.questArchive.nextCursor ? archivePageHref(data.journals[patron.instanceId].questArchive.nextCursor!) : null}
                onarchive={() => {}}
                embedded={true}
                includeArchive={false}
              />
            </div>
          </section>

          {#if isKeepsakes && (data.snapshot.trinkets?.collection ?? []).length === 0}
            <p class="empty-journal muted">Your collection is empty. Keep an eye out for a treasure worth displaying.</p>
          {/if}

        </section>
      </div>
    </div>

    <Dialog id="close-tavern" title="End the evening?" bind:open={closeDialogOpen}>
      <p class="dialog-copy">Your regulars will follow their intentions overnight. You can close without crafting today.</p>
      {#if closeError}
        <p class="form-message error" role="alert">{closeError}</p>
        <button class="text-button" type="button" disabled={pending} onclick={refreshCloseStatus}>Refresh the tavern</button>
      {:else if form?.message && lastAction === 'close'}
        <p class="form-message" class:error={!('success' in form && form.success)} role={'success' in form ? 'status' : 'alert'}>{form.message}</p>
      {/if}
      <form method="POST" action="?/close" use:enhance={enhanceClose}>
        <button class="primary-button full-button" disabled={!hydrated || pending || dialogueBusy || !!unresolved}>
          {pending ? 'Closing…' : closeCommand ? 'Retry the same close' : 'Close and begin next day'}
        </button>
      </form>
    </Dialog>
  {/if}
</main>

<style>
  .bar-page { width: min(100%, 88rem); margin-inline: auto; padding: clamp(.75rem, 2.8vw, 2rem); }
  .bar-shell { display: grid; gap: .45rem; min-width: 0; }
  .destination-nav { display: flex; gap: clamp(.15rem, 1vw, .55rem); overflow-x: auto; overflow-y: hidden; border-bottom: 1px solid rgb(193 159 94 / .18); scrollbar-width: thin; }
  .destination-nav a { position: relative; display: inline-flex; min-height: 2.75rem; flex: 0 0 auto; align-items: center; padding: .55rem .8rem; color: #b6a77f; text-decoration: none; font-size: .91rem; font-weight: 600; transition: color 140ms ease, background-color 140ms ease; }
  .destination-nav a::after { position: absolute; right: .75rem; bottom: -1px; left: .75rem; height: 2px; content: ''; background: transparent; }
  .destination-nav a[aria-current='page'] { color: #f0d27a; }
  .destination-nav a[aria-current='page']::after { background: #d6ae55; }
  .destination-nav a[aria-disabled='true'] { opacity: .58; cursor: wait; }
  .destination-nav a:hover { color: #f4e3b0; background: rgb(237 208 131 / .05); }
  .destination-nav a:focus-visible, .resident-picker select:focus-visible, .destination-surface button:focus-visible, .destination-surface a:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  .bar-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: clamp(1rem, 2.5vw, 2rem); align-items: start; min-width: 0; padding-top: 1rem; }
  .bar-layout.with-scene { grid-template-columns: minmax(0, 1.36fr) minmax(19rem, .84fr); }
  .scene-stage { min-width: 0; }
  .destination-surface { min-width: 0; }
  .with-scene .destination-surface { padding-left: clamp(.75rem, 1.8vw, 1.5rem); border-left: 1px solid rgb(193 159 94 / .25); }
  .surface-heading { margin: 0 0 1.1rem; }
  .surface-heading .eyebrow { margin: 0 0 .2rem; color: #ad9a72; font-size: .75rem; letter-spacing: .13em; text-transform: uppercase; }
  .surface-heading h1 { margin: 0; color: #f0d27a; font-family: 'Cinzel', serif; font-size: clamp(1.45rem, 2.4vw, 2rem); line-height: 1.15; }
  .surface-heading > p:last-child:not(.eyebrow) { margin: .3rem 0 0; color: #c9b891; }
  .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: 0 0 .7rem; }
  .section-heading h2, .journal-resident-label h2 { margin: 0; color: #ead8ad; font-family: 'Cinzel', serif; font-size: 1.12rem; }
  .section-heading .eyebrow, .journal-resident-label .eyebrow { margin: 0 0 .15rem; color: #a89468; font-size: .7rem; letter-spacing: .12em; text-transform: uppercase; }
  .journal-history { margin: 1.3rem 0 0; }
  .history-list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; border-top: 1px solid rgb(193 159 94 / .25); }
  .history-list li { display: flex; align-items: baseline; justify-content: space-between; gap: .7rem; padding: .7rem .1rem; border-bottom: 1px solid rgb(193 159 94 / .18); }
  .history-list li > div { display: grid; gap: .15rem; }
  .history-list strong { color: #e2d2ae; }
  .history-list small { color: #a89468; font-size: .8rem; }
  .history-list li > p { margin: 0; color: #c5b488; font-size: .85rem; text-align: right; }
  .journal-resident-label { margin: 1.5rem 0 .55rem; padding-top: .85rem; border-top: 1px solid rgb(193 159 94 / .25); }
  .archive-empty { padding: 1.2rem 0; border-top: 1px solid rgb(193 159 94 / .2); }
  .archive-empty h2 { margin: 0; color: #ead8ad; font-family: 'Cinzel', serif; font-size: 1.12rem; }
  .archive-empty p { color: #b9aa88; }
  .resident-picker { display: flex; align-items: end; justify-content: space-between; gap: 1rem; padding: .8rem 0; border-bottom: 1px solid rgb(193 159 94 / .2); }
  .resident-picker h1 { margin: 0; color: #f0d27a; font-family: 'Cinzel', serif; font-size: 1.3rem; }
  .resident-picker p:last-child { margin: .25rem 0 0; color: #b9aa88; font-size: .9rem; }
  .resident-picker label { display: grid; gap: .3rem; color: #c9b891; font-size: .82rem; }
  .resident-picker select { min-width: min(18rem, 44vw); min-height: 2.6rem; padding: .45rem .6rem; border: 1px solid #765324; color: #e2cc97; background: #100a05; font: inherit; }
  .serve-panel { padding-top: 1rem; }
  .serve-panel fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
  .serve-panel legend { margin-bottom: .35rem; color: #b8a87e; font-size: .83rem; }
  .pour-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr)); border-top: 1px solid rgb(193 159 94 / .22); }
  .pour-options label { display: flex; min-width: 0; align-items: center; gap: .65rem; padding: .65rem .35rem; border-bottom: 1px solid rgb(193 159 94 / .16); color: #d9c8a2; cursor: pointer; }
  .pour-options label.selected { color: #f2d884; background: rgb(214 174 85 / .08); }
  .pour-options input { accent-color: #d6ae55; }
  .pour-options label span { display: grid; min-width: 0; gap: .1rem; }
  .pour-options strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pour-options small { color: #a89468; }
  .pour-options :focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  .pour-summary { margin: .7rem 0; color: #d7c087; font-size: .88rem; }
  .serve-empty { padding: .4rem 0 .8rem; color: #c9b891; }
  .serve-empty p { margin: 0 0 .45rem; }
  .empty-actions { display: flex; flex-wrap: wrap; gap: .8rem; }
  .empty-journal { margin-top: 1rem; }
  .quiet-room { margin: 0; padding: .8rem 0; color: #b9aa88; }
  .interaction-panel { min-width: 0; padding-top: .75rem; }
  .conversation-host { margin-top: .4rem; animation: surface-in 150ms ease both; }
  .about-host { animation: surface-in 150ms ease both; }
  .conversation-host.journal-host { margin-top: .8rem; }
  .bar-empty-state { max-width: 40rem; margin: 4rem auto; padding: 2rem 0; text-align: center; }
  .bar-empty-state h1 { margin: .25rem 0; color: #f0d27a; font-family: 'Cinzel', serif; }
  .bar-empty-state p { color: #c9b891; }
  .dialog-copy { margin: .15rem 0 1rem; color: #c9b891; line-height: 1.55; }
  :global([hidden]) { display: none !important; }
  @keyframes surface-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 820px) {
    .bar-layout.with-scene { grid-template-columns: minmax(0, 1fr); gap: 1.1rem; }
    .with-scene .destination-surface { padding: 0; border: 0; }
    .scene-stage { max-width: 54rem; width: 100%; margin-inline: auto; }
  }
  @media (max-width: 560px) {
    .bar-page { padding: .5rem .8rem 1.5rem; }
    .destination-nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); overflow: visible; margin-inline: -.8rem; padding: .2rem .5rem; }
    .destination-nav a { min-width: 0; justify-content: center; }
    .destination-nav a { padding-inline: .65rem; font-size: .84rem; }
    .resident-picker { align-items: stretch; flex-direction: column; }
    .resident-picker select { width: 100%; min-width: 0; }
    .history-list li { align-items: start; flex-direction: column; gap: .3rem; }
    .history-list li > p { text-align: left; }
  }
  @media (prefers-reduced-motion: reduce) {
    .destination-nav a, .conversation-host, .about-host { animation: none; transition: none; }
  }
</style>
