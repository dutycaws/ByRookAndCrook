<script lang="ts">
  import { onMount } from 'svelte';

  let {
    title = 'The page could not be opened',
    message = 'Something interrupted this page. Try again, or step back to the bar or garden.',
    barHref = '/bar',
    gardenHref = '/garden'
  }: {
    title?: string;
    message?: string;
    barHref?: string;
    gardenHref?: string;
  } = $props();

  let headingElement: HTMLHeadingElement | undefined;

  onMount(() => headingElement?.focus({ preventScroll: true }));

  function retry() {
    window.location.reload();
  }
</script>

<main class="route-error" aria-labelledby="route-error-title">
  <p class="eyebrow">A pause in the record</p>
  <h1 bind:this={headingElement} id="route-error-title" tabindex="-1">{title}</h1>
  <p class="route-error-message">{message}</p>
  <div class="route-error-actions">
    <button class="retry-button" type="button" onclick={retry}>Try this page again</button>
    <a href={barHref}>Return to the bar</a>
    <a href={gardenHref}>Visit the garden</a>
  </div>
</main>

<style>
  .route-error { display: grid; justify-items: start; gap: .55rem; width: min(48rem, calc(100% - 2rem)); margin: clamp(2rem, 8vh, 6rem) auto; padding: clamp(1.1rem, 3vw, 2rem) 0; border-block: 1px solid rgb(133 96 35 / 48%); }
  .route-error .eyebrow { margin: 0; }
  .route-error h1 { margin: 0; color: var(--gold-bright, #f0d27a); font: 600 clamp(1.35rem, 3vw, 1.8rem) 'Cinzel', Georgia, serif; }
  .route-error h1:focus-visible { outline: 2px solid #f0d27a; outline-offset: 4px; }
  .route-error-message { max-width: 42rem; margin: 0; color: var(--muted, #b9aa88); line-height: 1.5; }
  .route-error-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem 1rem; margin-top: .25rem; }
  .route-error-actions a { min-height: 2.75rem; display: inline-flex; align-items: center; color: #e8cd82; text-underline-offset: .2em; }
  .retry-button { min-height: 2.75rem; padding: .55rem .85rem; border: 1px solid #a57a32; color: #241909; background: #d8b45f; font: 600 .9rem 'Cinzel', Georgia, serif; cursor: pointer; transition: background-color 140ms ease, transform 140ms ease; }
  .retry-button:hover { background: #f0d27a; transform: translateY(-1px); }
  .retry-button:focus-visible, .route-error-actions a:focus-visible { outline: 3px solid #f0d27a; outline-offset: 3px; }
  @media (max-width: 560px) { .route-error-actions { align-items: stretch; flex-direction: column; width: 100%; }.route-error-actions a { min-height: 2.5rem; } }
  @media (prefers-reduced-motion: reduce) { .retry-button { transition: none; } }
</style>
