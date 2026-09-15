<script lang="ts">
  import PublicCodexEntities from '$lib/components/world/PublicCodexEntities.svelte';
  import PublicCodexChronicle from '$lib/components/world/PublicCodexChronicle.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>World codex · By Rook and Crook</title>
  <meta name="description" content="A shared record of the places, people, and changes discovered around your tavern." />
</svelte:head>

<main class="codex-page">
  <header class="codex-hero panel">
    <p class="eyebrow">The keeper’s record</p>
    <h1>World codex</h1>
    <p>Discoveries and changes that the tavern can safely share.</p>
  </header>

  {#if !data.snapshot}
    <section class="panel empty-state"><h2>Open the tavern first</h2><p>Start a garden and the world record will be ready for your discoveries.</p><a class="primary-button inline-button" href="/garden">Visit the garden</a></section>
  {:else if data.codex}
    <div class="codex-layout">
      <PublicCodexEntities entities={data.codex.entities} />
      <PublicCodexChronicle events={data.codex.publicEvents} dispositions={data.codex.dispositions} />
    </div>
  {/if}
</main>

<style>
  .codex-page { width:min(1380px, calc(100% - 2rem)); margin:2.5rem auto 4rem; display:grid; gap:1.25rem; }
  .codex-hero { padding:clamp(1.25rem, 3vw, 2.4rem); background:linear-gradient(115deg, rgba(42,31,13,.96), rgba(20,17,9,.95)); }
  .codex-hero h1 { margin:.2rem 0 .45rem; }
  .codex-hero p:last-child { max-width:48rem; color:var(--ink-muted, #cdbd96); }
  .codex-layout { display:grid; grid-template-columns:minmax(0, 1.75fr) minmax(280px, .85fr); align-items:start; gap:1.25rem; }
  :global(.codex-groups) { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:1rem; }
  :global(.codex-group) { min-height:11rem; padding:1rem; border:1px solid var(--line, #5f4822); background:rgba(20,17,9,.91); }
  :global(.codex-group-heading) { display:flex; align-items:baseline; justify-content:space-between; gap:1rem; border-bottom:1px solid var(--line, #5f4822); }
  :global(.codex-group-heading h2), :global(.codex-group-heading span) { margin:0 0 .65rem; }
  :global(.codex-group-heading span) { color:var(--gold, #d3a53c); }
  :global(.codex-placeholder) { margin:1rem 0; }
  :global(.codex-entity-list), :global(.codex-chronicle ol) { padding:0; margin:.9rem 0 0; list-style:none; }
  :global(.codex-entity-list li + li), :global(.codex-chronicle li + li) { border-top:1px solid rgba(133,101,43,.55); margin-top:.8rem; padding-top:.8rem; }
  :global(.codex-entity-list h3), :global(.codex-chronicle h3) { margin:.12rem 0 .35rem; }
  :global(.codex-entity-list p), :global(.codex-chronicle p) { margin:.25rem 0; }
  :global(.codex-entity-list small), :global(.codex-chronicle small) { color:var(--ink-muted, #cdbd96); }
  :global(.codex-chronicle) { padding:1.25rem; }
  :global(.codex-chronicle h2) { margin:.25rem 0 .5rem; }
  @media (max-width: 850px) { .codex-layout { grid-template-columns:1fr; } }
  @media (max-width: 560px) { .codex-page { width:min(100% - 1rem, 1380px); margin-top:1rem; } :global(.codex-groups) { grid-template-columns:1fr; } }
</style>
