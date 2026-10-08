<script lang="ts">
  import type { Journal } from '$lib/game/dialogue';
  import { relationshipStageFor } from '$lib/game/relationships';
  import type { Patron, ServeReceipt } from '$lib/game/serving';
  import FloatingSurface from '$lib/components/ui/FloatingSurface.svelte';
  import NpcHistory from '$lib/components/tavern/NpcHistory.svelte';

  type Props = {
    patron: Patron;
    journal: Journal | null;
    history: ServeReceipt[];
    archiveHref: string;
    codexHref: string;
    journalOpen: boolean;
    interactionOpen: boolean;
    onjournalchange: (open: boolean) => void;
  };

  let { patron, journal, history, archiveHref, codexHref, journalOpen, interactionOpen, onjournalchange }: Props = $props();
  const relationshipStage = $derived(patron.relationshipStage ?? relationshipStageFor(patron.relationship));
  const latestHospitality = $derived(
    history
      .filter((receipt) => receipt.instanceId === patron.instanceId)
      .toSorted((left, right) => right.dayNumber - left.dayNumber || right.committedRevision - left.committedRevision)[0] ?? null
  );
  const latestTurn = $derived(journal?.turns.at(-1) ?? null);
  const latestActivity = $derived.by(() => {
    if (latestTurn && (!latestHospitality || latestTurn.day >= latestHospitality.dayNumber)) {
      return { label: `Day ${latestTurn.day} · Conversation`, text: latestTurn.reply };
    }
    if (latestHospitality) {
      return { label: `Day ${latestHospitality.dayNumber} · Hospitality`, text: `Served ${latestHospitality.itemName}.` };
    }
    return null;
  });

</script>

<FloatingSurface
  as="aside"
  class="patron-surface"
  aria-labelledby="resident-focus-title"
>
  <header class="resident-heading">
    <h1 id="resident-focus-title">{patron.name}</h1>
    <div class="resident-meta">
      <p class="resident-title">{patron.title}</p>
      {#if relationshipStage}<span class="relationship-stage">{relationshipStage}</span>{/if}
    </div>
  </header>

  {#if journal}
    <div
      id="resident-journal"
      class="resident-journal"
      role="region"
      aria-label={`${patron.name}’s journal`}
      hidden={!journalOpen}
    >
        <NpcHistory
          name={patron.name}
          {journal}
          {history}
          description={patron.description}
          instanceId={patron.instanceId}
          {relationshipStage}
          {archiveHref}
        />
    </div>
    {#if !journalOpen && !interactionOpen}
      <div class="resident-summary" aria-label="Current story">
        {#if journal.currentQuest}
          <p class="summary-label">Current story · {journal.currentQuest.title}</p>
          <p class="summary-copy">{journal.currentQuest.objective}</p>
        {:else if journal.disposition?.summary}
          <p class="summary-label">How they seem lately</p>
          <p class="summary-copy">{journal.disposition.summary}</p>
        {:else if patron.description}
          <p class="summary-copy">{patron.description}</p>
        {:else}
          <p class="summary-copy">No current story to share.</p>
        {/if}
        {#if latestActivity}
          <p class="latest-activity"><span>{latestActivity.label}</span> {latestActivity.text}</p>
        {/if}
      </div>
    {/if}
    <div class="resident-links">
      <button
        type="button"
        class="journal-toggle"
        data-bar-control="journal"
        aria-expanded={journalOpen}
        aria-controls="resident-journal"
        onclick={() => onjournalchange(!journalOpen)}
      >{journalOpen ? 'Close journal' : 'Journal'}</button>
      <a class="journal-link" href={codexHref}>Open full Codex <span aria-hidden="true">→</span></a>
    </div>
  {:else}
    <p class="quiet-line" role="status">This resident’s journal is unavailable right now.</p>
    <a class="journal-link" href={codexHref}>Open the Codex</a>
  {/if}
</FloatingSurface>

<style>
  :global(.patron-surface) {
    position: absolute;
    z-index: 20;
    top: 3.7rem;
    right: .85rem;
    display: flex;
    flex-direction: column;
    width: clamp(280px, 27vw, 340px);
    min-width: 0;
    min-height: 0;
    max-height: min(40vh, 420px);
    padding: .65rem .8rem .6rem;
    overflow: hidden;
  }

  .resident-heading {
    flex: 0 0 auto;
    padding: 0 0 .45rem;
    border-bottom: 1px solid rgb(145 112 52 / 38%);
  }

  .resident-heading h1 {
    margin: 0;
    color: #f0d27a;
    font: 600 clamp(1.05rem, 1.5vw, 1.3rem) 'Cinzel', Georgia, serif;
  }

  .resident-meta {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: .25rem .6rem;
  }

  .resident-title {
    margin: .1rem 0 0;
    color: #c9bb9b;
    font-size: .82rem;
  }

  .relationship-stage {
    color: #d3b46d;
    font-size: .75rem;
  }

  .resident-summary {
    min-width: 0;
    padding-top: .45rem;
  }

  .summary-label {
    margin: 0 0 .18rem;
    color: #d3b46d;
    font-size: .72rem;
    font-weight: 650;
  }

  .summary-copy,
  .latest-activity {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    color: #eee2c3;
    font-size: .8rem;
    line-height: 1.4;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .latest-activity {
    margin-top: .3rem;
    color: #c9bb9b;
    font-size: .72rem;
  }

  .latest-activity span {
    color: #d3b46d;
    font-weight: 650;
  }

  .resident-journal {
    flex: 1 1 auto;
    min-block-size: 0;
    max-block-size: min(30vh, 290px);
    margin-top: .45rem;
    padding-top: .4rem;
    overflow: auto;
    border-top: 1px solid rgb(145 112 52 / 28%);
    overscroll-behavior: contain;
    scrollbar-color: #72562c transparent;
    scrollbar-width: thin;
  }

  .resident-journal[hidden] { display: none; }

  .resident-journal :global(.npc-history) {
    max-block-size: none;
    overflow: visible;
  }

  .resident-journal :global(.relationship-line) { display: none; }

  .resident-links {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    gap: .75rem;
    margin-top: .45rem;
    padding-top: .4rem;
    border-top: 1px solid rgb(145 112 52 / 28%);
  }

  .journal-toggle {
    min-height: 2rem;
    padding: .25rem .45rem;
    border: 1px solid rgb(193 159 94 / 36%);
    border-radius: .3rem;
    color: #f0d27a;
    background: transparent;
    font: inherit;
    font-size: .78rem;
    cursor: pointer;
  }

  .journal-toggle:hover { background: rgb(61 43 17 / .42); }

  .journal-toggle:focus-visible,
  .journal-link:focus-visible {
    outline: 2px solid #f0d27a;
    outline-offset: 3px;
  }

  .quiet-line {
    flex: 1 1 auto;
    margin: .8rem 0;
    color: #c9bb9b;
  }

  .journal-link {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: .35rem;
    margin: 0;
    color: #f0d27a;
    font-size: .88rem;
    text-underline-offset: .2em;
  }

  @media (max-width: 1000px) {
    :global(.patron-surface) {
      position: static;
      width: auto;
      max-height: none;
      margin-top: .65rem;
      padding: .55rem .15rem .4rem;
      overflow: visible;
      border: 1px solid rgb(193 159 94 / .34);
      border-radius: .55rem;
      background: rgb(18 12 8 / .38);
      box-shadow: none;
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
      animation: none;
    }

    .resident-journal {
      flex: 0 0 auto;
      max-block-size: none;
      overflow: visible;
    }
  }
</style>
