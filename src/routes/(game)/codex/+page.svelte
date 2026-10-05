<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';
  import PublicCodexEntities from '$lib/components/world/PublicCodexEntities.svelte';
  import PublicCodexChronicle from '$lib/components/world/PublicCodexChronicle.svelte';
  import NpcHistory from '$lib/components/tavern/NpcHistory.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const section = $derived.by(() => {
    const requested = page.url.searchParams.get('section');
    if (requested === 'chronicle' || requested === 'world' || requested === 'residents') return requested;
    return data.residents.length ? 'residents' : 'chronicle';
  });
  const requestedResidentId = $derived(page.url.searchParams.get('resident'));
  const focusedResident = $derived(data.residents.find((resident) => resident.instanceId === requestedResidentId) ?? null);
  const explicitResident = $derived(!!requestedResidentId && !!focusedResident);
  const currentResidents = $derived(data.residents.filter((resident) => data.journals[resident.instanceId]?.availability === 'present'));
  const pastResidents = $derived(data.residents.filter((resident) => data.journals[resident.instanceId]?.availability !== 'present'));
  const historyHref = $derived.by(() => {
    const cursor = focusedResident ? data.journals[focusedResident.instanceId]?.questArchive.nextCursor : null;
    if (!focusedResident || !cursor) return null;
    return `/codex?section=residents&resident=${encodeURIComponent(focusedResident.instanceId)}&questCursor=${encodeURIComponent(cursor)}`;
  });

  function residentLinkId(instanceId: string): string {
    return `resident-link-${instanceId}`;
  }

  function residentHref(instanceId: string): string {
    return `/codex?section=residents&resident=${encodeURIComponent(instanceId)}`;
  }

  async function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !explicitResident) return;
    event.preventDefault();
    const returnToChronicle = section === 'chronicle';
    const selectedResidentId = requestedResidentId;
    const chronicleHash = returnToChronicle ? page.url.hash : '';
    const destination = returnToChronicle ? `/codex?section=chronicle${chronicleHash}` : '/codex?section=residents';
    await goto(destination);
    await tick();

    if (returnToChronicle && chronicleHash) {
      try {
        const entry = document.getElementById(decodeURIComponent(chronicleHash.slice(1)));
        if (entry instanceof HTMLElement) {
          entry.focus();
          return;
        }
      } catch {
        // Fall back to the chronicle heading when the fragment is malformed or no longer present.
      }
    }

    const focusTarget = returnToChronicle
      ? document.getElementById('world-chronicle-title')
      : (selectedResidentId ? document.getElementById(residentLinkId(selectedResidentId)) : null)
        ?? document.getElementById('resident-list-title');
    focusTarget?.focus();
  }
</script>

<svelte:head>
  <title>World codex · By Rook and Crook</title>
  <meta name="description" content="A shared record of the people, places, and changes discovered around your tavern." />
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<main class="codex-page">
  <header class="codex-heading">
    <p class="eyebrow">The keeper’s record</p>
    <h1>World codex</h1>
    <p>People, memories, and changes carried through the tavern.</p>
  </header>

  <nav class="codex-nav" aria-label="Codex destinations">
    <a href="/codex?section=residents" aria-current={section === 'residents' ? 'page' : undefined}>Residents <span>{data.residents.length}</span></a>
    <a href="/codex?section=chronicle" aria-current={section === 'chronicle' ? 'page' : undefined}>Chronicle</a>
    <a href="/codex?section=world" aria-current={section === 'world' ? 'page' : undefined}>Discoveries</a>
  </nav>

  {#if !data.snapshot}
    <section class="empty-destination" aria-labelledby="codex-empty-title">
      <h2 id="codex-empty-title">No tavern record yet</h2>
      <p>Open the garden to begin recording the people and places around your tavern.</p>
      <a href="/garden">Visit the garden</a>
    </section>
  {:else if section === 'residents'}
    <section class="destination" aria-labelledby="resident-list-title">
      <header class="destination-heading">
        <h2 id="resident-list-title" tabindex="-1">Residents</h2>
        <p>Choose a resident to read their shared journal.</p>
      </header>

      {#if data.residents.length === 0}
        <p class="empty-destination">No resident journals have been recorded yet.</p>
      {:else}
        <div class="resident-workspace" class:mobile-detail={explicitResident}>
          <aside class="resident-picker" aria-label="Current and past residents">
            {#if currentResidents.length}
              <section class="resident-group" aria-labelledby="current-residents-title">
                <h3 id="current-residents-title">Current</h3>
                <ul>
                  {#each currentResidents as resident (resident.instanceId)}
                    <li>
                      <a id={residentLinkId(resident.instanceId)} href={residentHref(resident.instanceId)} aria-current={focusedResident?.instanceId === resident.instanceId ? 'page' : undefined}>
                        <span>{resident.name}</span><small>At the tavern</small>
                      </a>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}
            {#if pastResidents.length}
              <section class="resident-group" aria-labelledby="past-residents-title">
                <h3 id="past-residents-title">Past residents</h3>
                <ul>
                  {#each pastResidents as resident (resident.instanceId)}
                    <li>
                      <a id={residentLinkId(resident.instanceId)} href={residentHref(resident.instanceId)} aria-current={focusedResident?.instanceId === resident.instanceId ? 'page' : undefined}>
                        <span>{resident.name}</span><small>{data.journals[resident.instanceId]?.availability ?? 'Past resident'}</small>
                      </a>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}
          </aside>

          {#if focusedResident}
            <article class="resident-reading" aria-label={`History for ${focusedResident.name}`}>
              <a class="back-link" href="/codex?section=residents">← All residents</a>
              <header class="resident-identity">
                <div class="resident-sprite" aria-label={`${focusedResident.name}'s neutral portrait`}>
                  {#if focusedResident.sceneStorageKey}
                    <img src={focusedResident.sceneStorageKey} alt="" />
                  {:else}
                    <span aria-hidden="true">{focusedResident.name.slice(0, 1)}</span>
                  {/if}
                </div>
                <div>
                  <h2>{focusedResident.name}</h2>
                  {#if focusedResident.title}<p>{focusedResident.title}</p>{/if}
                </div>
              </header>
              <NpcHistory
                name={focusedResident.name}
                journal={data.journals[focusedResident.instanceId] ?? null}
                history={data.hospitality}
                instanceId={focusedResident.instanceId}
                description={focusedResident.description}
                relationshipStage={focusedResident.relationshipStage}
                archiveHref={historyHref}
              />
            </article>
          {:else if requestedResidentId}
            <p class="resident-missing" role="status">That resident is not available in this journal.</p>
          {:else}
            <p class="resident-prompt">Choose a resident to open their journal.</p>
          {/if}
        </div>
      {/if}
    </section>
  {:else if section === 'chronicle'}
    <section class="destination" aria-label="Tavern chronicle">
      <div class="chronicle-layout" class:has-resident={!!focusedResident}>
        {#if data.codex}
          <PublicCodexChronicle events={data.codex.publicEvents} dispositions={data.codex.dispositions} reports={data.tavernReports} />
        {:else}
          <section class="chronicle-empty" aria-labelledby="world-chronicle-title"><p class="eyebrow">Shared record</p><h2 id="world-chronicle-title" tabindex="-1">Tavern chronicle</h2><p>No public changes have been recorded yet.</p></section>
        {/if}
        {#if focusedResident}
          <article class="resident-reading chronicle-resident" aria-label={`History for ${focusedResident.name}`}>
            <a class="back-link" href="/codex?section=chronicle">← Tavern chronicle</a>
            <header class="resident-identity">
              <div class="resident-sprite" aria-label={`${focusedResident.name}'s neutral portrait`}>
                {#if focusedResident.sceneStorageKey}<img src={focusedResident.sceneStorageKey} alt="" />{:else}<span aria-hidden="true">{focusedResident.name.slice(0, 1)}</span>{/if}
              </div>
              <div><h2>{focusedResident.name}</h2>{#if focusedResident.title}<p>{focusedResident.title}</p>{/if}</div>
            </header>
            <NpcHistory
              name={focusedResident.name}
              journal={data.journals[focusedResident.instanceId] ?? null}
              history={data.hospitality}
              instanceId={focusedResident.instanceId}
              description={focusedResident.description}
              relationshipStage={focusedResident.relationshipStage}
              archiveHref={historyHref}
            />
            <a class="history-destination" href={residentHref(focusedResident.instanceId)}>Open in Residents</a>
          </article>
        {/if}
      </div>
    </section>
  {:else}
    <section class="destination world-destination" aria-labelledby="world-discoveries-title">
      <header class="destination-heading"><h2 id="world-discoveries-title">Discoveries</h2><p>Places and things the tavern has learned about.</p></header>
      {#if data.codex}<PublicCodexEntities entities={data.codex.entities} />{:else}<p class="empty-destination">No world discoveries have been recorded yet.</p>{/if}
    </section>
  {/if}
</main>

<style>
  .codex-page { width: min(1240px, calc(100% - 2rem)); margin: 1.75rem auto 4rem; display: grid; gap: 1rem; }
  .codex-heading { padding: .25rem 0 .8rem; border-bottom: 1px solid rgb(133 96 35 / 40%); }
  .codex-heading .eyebrow { margin: 0 0 .2rem; }
  .codex-heading h1 { margin: 0; color: var(--gold-bright, #f0d27a); font: 600 clamp(1.5rem, 3vw, 2rem) 'Cinzel', Georgia, serif; }
  .codex-heading > p:last-child { margin: .3rem 0 0; color: var(--muted, #b9aa88); }
  .codex-nav { display: flex; gap: .25rem; overflow-x: auto; border-bottom: 1px solid rgb(133 96 35 / 42%); scrollbar-width: thin; }
  .codex-nav a { display: inline-flex; flex: 0 0 auto; align-items: center; gap: .4rem; min-height: 2.8rem; padding: .5rem .8rem; border-bottom: 2px solid transparent; color: #c4b58e; text-decoration: none; transition: color 140ms ease, border-color 140ms ease; }
  .codex-nav a[aria-current='page'] { border-color: #d6ae55; color: #f0d27a; }
  .codex-nav a span { color: #dec075; font-size: .82rem; }
  .codex-nav a:hover { color: #f4e3b0; }
  .codex-nav a:focus-visible, .resident-picker a:focus-visible, .back-link:focus-visible, .history-destination:focus-visible, .empty-destination a:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  #resident-list-title:focus-visible, #world-chronicle-title:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
  .destination { min-width: 0; }
  .destination-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: .45rem 0 .75rem; border-bottom: 1px solid rgb(133 96 35 / 30%); }
  .destination-heading h2 { margin: 0; color: #ead39a; font: 600 1.15rem 'Cinzel', Georgia, serif; }
  .destination-heading p { margin: 0; color: var(--muted, #b9aa88); }
  .resident-workspace { display: grid; grid-template-columns: minmax(13rem, .34fr) minmax(0, 1fr); align-items: start; gap: clamp(1rem, 3vw, 2.5rem); }
  .resident-picker { min-width: 0; }
  .resident-group { padding: .85rem 0; border-bottom: 1px solid rgb(133 96 35 / 30%); }
  .resident-group h3 { margin: 0 0 .35rem; color: #d7bf7b; font: 600 .77rem 'Cinzel', Georgia, serif; letter-spacing: .08em; text-transform: uppercase; }
  .resident-group ul { margin: 0; padding: 0; list-style: none; }
  .resident-group li + li { border-top: 1px solid rgb(133 96 35 / 18%); }
  .resident-group a { display: flex; align-items: baseline; justify-content: space-between; gap: .55rem; min-height: 2.75rem; padding: .55rem .1rem; color: #e2d2a6; text-decoration: none; }
  .resident-group a[aria-current='page'] { color: #ffe29b; }
  .resident-group a[aria-current='page'] span { text-decoration: underline; text-decoration-color: #c69b45; text-underline-offset: .25em; }
  .resident-group small { color: var(--muted, #b9aa88); font-size: .78rem; text-align: right; text-transform: capitalize; }
  .resident-reading { min-width: 0; padding: .9rem 0; border-top: 1px solid rgb(133 96 35 / 38%); }
  .back-link { display: none; margin-bottom: .7rem; color: #e4c675; text-underline-offset: .2em; }
  .resident-identity { display: flex; align-items: center; gap: .9rem; margin-bottom: .7rem; }
  .resident-sprite { display: grid; flex: 0 0 auto; width: clamp(4.5rem, 11vw, 7rem); aspect-ratio: 1; place-items: center; overflow: hidden; border-bottom: 1px solid rgb(133 96 35 / 42%); color: #e3ca8a; background: radial-gradient(ellipse at 50% 38%, rgb(116 86 40 / 40%), rgb(19 15 9 / 50%) 72%); font: 600 2rem 'Cinzel', Georgia, serif; }
  .resident-sprite img { width: 100%; height: 100%; object-fit: contain; }
  .resident-identity h2 { margin: 0; color: var(--gold-bright, #f0d27a); font: 600 clamp(1.15rem, 2.3vw, 1.5rem) 'Cinzel', Georgia, serif; }
  .resident-identity p:last-child { margin: .15rem 0 0; color: var(--muted, #b9aa88); }
  .resident-prompt, .resident-missing { margin: 1rem 0; color: var(--muted, #b9aa88); }
  .history-destination { display: inline-block; margin-top: .75rem; color: #e4c675; text-underline-offset: .2em; }
  .chronicle-layout { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: clamp(1rem, 3vw, 2.5rem); }
  .chronicle-layout.has-resident { grid-template-columns: minmax(0, 1fr) minmax(19rem, .85fr); }
  .chronicle-resident { padding-top: 0; }
  .chronicle-empty, .empty-destination { padding: 1rem 0; color: var(--muted, #b9aa88); }
  .chronicle-empty h2, .empty-destination h2 { margin: .1rem 0 .4rem; color: #ead39a; font: 600 1.1rem 'Cinzel', Georgia, serif; }
  .empty-destination a { color: #f0d27a; text-underline-offset: .2em; }
  .world-destination :global(.codex-groups) { margin-top: .8rem; }
  .world-destination :global(.codex-group) { border: 0; border-top: 1px solid rgb(133 96 35 / 35%); background: transparent; }
  .world-destination :global(.codex-group-heading) { border-bottom-color: rgb(133 96 35 / 22%); }
  .world-destination :global(.codex-entity-art) { max-width: 22rem; }

  @media (max-width: 760px) {
    .codex-page { width: min(100% - 1rem, 1240px); margin-top: .8rem; gap: .75rem; }
    .destination-heading { align-items: flex-start; flex-direction: column; gap: .15rem; }
    .resident-workspace, .chronicle-layout.has-resident { grid-template-columns: minmax(0, 1fr); gap: .5rem; }
    .resident-workspace.mobile-detail .resident-picker { display: none; }
    .resident-workspace:not(.mobile-detail) .resident-reading { display: none; }
    .resident-reading { padding-top: .7rem; }
    .back-link { display: inline-block; }
    .resident-identity { margin-top: .3rem; }
  }

  @media (prefers-reduced-motion: reduce) {
    .codex-nav a { transition: none; }
  }
</style>
