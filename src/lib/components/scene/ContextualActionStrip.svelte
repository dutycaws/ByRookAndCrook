<script lang="ts">
  import type { Snippet } from 'svelte';
  let { eyebrow, title, description, status = null, children }: {
    eyebrow: string;
    title: string;
    description: string;
    status?: string | null;
    children?: Snippet;
  } = $props();
</script>

<section class="action-strip" data-contextual-action aria-labelledby="context-action-title">
  <div>
    <p class="strip-eyebrow">{eyebrow}</p>
    <strong class="strip-title" id="context-action-title">{title}</strong>
    <p>{description}</p>
  </div>
  {#if status}<span class="strip-status" aria-live="polite">{status}</span>{/if}
  {#if children}<div class="strip-action">{@render children()}</div>{/if}
</section>

<style>
  .action-strip {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 1rem;
    min-width: 0;
    padding: .9rem 1rem;
    border: 1px solid #725426;
    background: linear-gradient(90deg, #251707, #100b06 55%, #181007);
    box-shadow: inset 0 1px #e6c46d17;
  }
  .strip-eyebrow { margin: 0 0 .2rem; color: #c89435; font: 600 .58rem 'Cinzel', serif; letter-spacing: .15em; text-transform: uppercase; }
  .strip-title { display: block; color: #e6c46d; font: 600 .95rem 'Cinzel', serif; }
  div > p:last-child { margin: .25rem 0 0; color: #9d8453; }
  .strip-status { min-width: 7rem; color: #ead8a6; font: 600 .72rem 'Cinzel', serif; text-align: right; }
  .strip-action { min-width: max-content; }
  @media (max-width: 620px) {
    .action-strip { grid-template-columns: 1fr; }
    .strip-status { min-width: 0; text-align: left; }
    .strip-action { min-width: 0; }
  }
</style>
