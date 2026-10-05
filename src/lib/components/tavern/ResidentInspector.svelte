<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Journal } from '$lib/game/dialogue';
  import { relationshipStageFor } from '$lib/game/relationships';
  import type { Patron, ServeReceipt } from '$lib/game/serving';
  import NpcHistory from '$lib/components/tavern/NpcHistory.svelte';

  type Props = {
    patron: Patron;
    journal: Journal | null;
    history: ServeReceipt[];
    archiveHref: string;
    codexHref: string;
    interaction: Snippet;
  };

  let { patron, journal, history, archiveHref, codexHref, interaction }: Props = $props();
  const relationshipStage = $derived(patron.relationshipStage ?? relationshipStageFor(patron.relationship));
</script>

<aside class:has-journal={!!journal} class="patron-surface" aria-labelledby="resident-focus-title">
  <header class="resident-heading">
    <p class="eyebrow">Selected resident</p>
    <h1 id="resident-focus-title">{patron.name}</h1>
    <p class="resident-title">{patron.title}</p>
  </header>

  {#if journal}
    <div id="resident-conversation" class="resident-interaction" aria-label={`Talk or offer a card to ${patron.name}`}>
      {@render interaction()}
    </div>
    <div class="resident-journal">
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
    <a class="journal-link" href={codexHref}>Open the full Codex <span aria-hidden="true">→</span></a>
  {:else}
    {@render interaction()}
    <a class="journal-link" href={codexHref}>Open the Codex</a>
  {/if}
</aside>

<style>
  .patron-surface { min-width: 0; padding: .4rem 0 .25rem clamp(.25rem, 1vw, .8rem); color: #eee2c3; }
  .resident-heading { padding: .4rem 0 .85rem; border-bottom: 1px solid rgb(145 112 52 / 38%); }
  .resident-heading .eyebrow { margin: 0 0 .35rem; color: #d3b46d; font: 600 .67rem 'Cinzel', Georgia, serif; letter-spacing: .09em; text-transform: uppercase; }
  .resident-heading h1 { margin: 0; color: #f0d27a; font: 600 clamp(1.25rem, 2.4vw, 1.75rem) 'Cinzel', Georgia, serif; }
  .resident-title { margin: .25rem 0 0; color: #b9aa88; }
  .patron-surface :global(.quiet-line) { margin: 0; color: #b9aa88; font-size: .9rem; }
  .resident-interaction { min-width: 0; }
  .resident-interaction :global(.interaction-prompt) { margin: .65rem 0; color: #b9aa88; font-size: .88rem; }
  .resident-interaction :global(.interaction-prompt strong) { color: #e9d49f; }
  .resident-journal { max-block-size: min(46svh, 34rem); overflow: auto; overscroll-behavior: contain; scrollbar-color: #72562c transparent; scrollbar-width: thin; }
  .resident-journal :global(.npc-history) { max-block-size: none; overflow: visible; }
  .journal-link { display: inline-flex; align-items: center; gap: .35rem; margin: .8rem 0 .25rem; color: #f0d27a; font-size: .88rem; text-underline-offset: .2em; }
  .journal-link:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
  @keyframes resident-inspector-enter { from { opacity: 0; } to { opacity: 1; } }
  .patron-surface { animation: resident-inspector-enter 180ms ease-out both; }

  @media (min-width: 861px) {
    .patron-surface.has-journal {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr) auto;
      row-gap: .55rem;
      min-block-size: 0;
      max-block-size: calc(100dvh - 110px);
    }
    .resident-journal { min-block-size: 0; max-block-size: none; }
  }

  @media (max-width: 860px) {
    .patron-surface { padding: .1rem 0 .25rem; }
    .resident-journal { max-block-size: min(48svh, 34rem); }
    .resident-journal :global(.npc-history) { max-block-size: inherit; overflow: auto; }
  }

  @media (prefers-reduced-motion: reduce) {
    .patron-surface { animation-duration: 80ms; }
    .patron-surface :global(*) { scroll-behavior: auto !important; }
  }
</style>
