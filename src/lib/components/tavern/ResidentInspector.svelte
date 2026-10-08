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

  let {
    patron,
    journal,
    history,
    archiveHref,
    codexHref,
    journalOpen,
    interactionOpen,
    onjournalchange
  }: Props = $props();

  const relationshipStage = $derived(patron.relationshipStage ?? relationshipStageFor(patron.relationship));
</script>

{#if journalOpen}
  <FloatingSurface
    as="aside"
    class="patron-folio"
    aria-labelledby="resident-folio-title"
  >
    <header class="folio-heading">
      <div class="folio-identity">
        <p class="folio-eyebrow">Resident journal</p>
        <h2 id="resident-folio-title">{patron.name}</h2>
        <div class="folio-meta">
          <span>{patron.title}</span>
          {#if relationshipStage}<span class="relationship-stage">{relationshipStage}</span>{/if}
        </div>
      </div>
      <button
        class="folio-close"
        data-bar-control="journal-close"
        type="button"
        aria-label="Close journal"
        onclick={() => onjournalchange(false)}
      >
        <span aria-hidden="true">×</span>
      </button>
    </header>

    <!-- The bounded entry region is keyboard-focusable so its scroll position can be explored without moving the page. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      id="resident-journal"
      class="folio-body"
      role="region"
      aria-label={`${patron.name} journal entries`}
      tabindex="0"
    >
      {#if journal}
        <NpcHistory
          compact
          name={patron.name}
          {journal}
          {history}
          description={patron.description}
          instanceId={patron.instanceId}
          {relationshipStage}
          {archiveHref}
        />
      {:else}
        <p class="folio-unavailable" role="status">This resident’s journal is unavailable right now.</p>
      {/if}
    </div>

    <footer class="folio-footer">
      <a href={codexHref}>Open full Codex archive <span aria-hidden="true">→</span></a>
    </footer>
  </FloatingSurface>
{:else}
  <button
    class="journal-toggle"
    data-bar-control="journal"
    type="button"
    aria-label={interactionOpen ? 'Open the journal and pause the conversation' : 'Open resident journal'}
    onclick={() => onjournalchange(true)}
  >
    Journal
  </button>
{/if}

<style>
  :global(.patron-folio) {
    position: absolute;
    z-index: 30;
    inset-block-start: 8.75rem;
    inset-inline-end: 1rem;
    display: flex;
    flex-direction: column;
    inline-size: min(25rem, calc(100% - 2rem));
    min-inline-size: 0;
    max-block-size: min(48vh, 42rem);
    overflow: hidden;
    padding: 0;
    background: rgb(18 12 8 / .76);
  }

  .folio-heading {
    display: flex;
    flex: 0 0 auto;
    align-items: flex-start;
    justify-content: space-between;
    gap: .8rem;
    padding: .8rem .9rem .7rem;
    border-bottom: 1px solid rgb(145 112 52 / 42%);
  }

  .folio-identity { min-width: 0; }

  .folio-eyebrow {
    margin: 0 0 .2rem;
    color: #c9b57d;
    font: 600 .65rem 'Cinzel', Georgia, serif;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .folio-heading h2 {
    margin: 0;
    color: #f0d27a;
    font: 600 clamp(1.05rem, 1.5vw, 1.3rem) 'Cinzel', Georgia, serif;
  }

  .folio-meta {
    display: flex;
    flex-wrap: wrap;
    gap: .2rem .6rem;
    margin-top: .12rem;
    color: #c9bb9b;
    font-size: .78rem;
  }

  .relationship-stage { color: #d3b46d; }

  .folio-close {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    inline-size: 2.75rem;
    block-size: 2.75rem;
    border: 1px solid rgb(193 159 94 / 42%);
    border-radius: .35rem;
    color: #f0d27a;
    background: rgb(30 21 11 / .68);
    font: inherit;
    font-size: 1.35rem;
    line-height: 1;
    cursor: pointer;
  }

  .folio-body {
    flex: 1 1 auto;
    min-block-size: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: .25rem .9rem .65rem;
    scrollbar-color: #72562c transparent;
    scrollbar-width: thin;
  }

  .folio-unavailable { margin: .75rem 0; color: #c9bb9b; line-height: 1.45; }

  .folio-footer {
    flex: 0 0 auto;
    padding: .6rem .9rem .7rem;
    border-top: 1px solid rgb(145 112 52 / 30%);
  }

  .folio-footer a {
    display: inline-flex;
    align-items: center;
    gap: .35rem;
    color: #f0d27a;
    font-size: .84rem;
    text-underline-offset: .2em;
  }

  .journal-toggle {
    position: absolute;
    z-index: 20;
    inset-block-start: 8.75rem;
    inset-inline-end: 1rem;
    min-block-size: 2.75rem;
    padding: .4rem .7rem;
    border: 1px solid rgb(193 159 94 / 48%);
    border-radius: .4rem;
    color: #f0d27a;
    background: rgb(18 12 8 / .76);
    font: 600 .8rem 'Cinzel', Georgia, serif;
    cursor: pointer;
  }

  .journal-toggle:hover, .folio-close:hover { background: rgb(61 43 17 / .82); }

  .journal-toggle:focus-visible, .folio-close:focus-visible, .folio-footer a:focus-visible {
    outline: 2px solid #f0d27a;
    outline-offset: 3px;
  }

  @media (max-width: 1000px) {
    :global(.patron-folio), .journal-toggle {
      inset-block-start: calc(var(--bar-scene-height, 55svh) + 1rem);
      inset-inline-end: 1rem;
    }

    :global(.patron-folio) {
      inline-size: min(25rem, calc(100% - 2rem));
      max-block-size: min(48vh, 30rem);
    }
  }
</style>
