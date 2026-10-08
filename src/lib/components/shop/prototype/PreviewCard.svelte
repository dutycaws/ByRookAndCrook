<script lang="ts">
  import type { PrototypeModel } from './types';
  let { model }: { model: PrototypeModel } = $props();
  const entry = $derived(model.selectedEntry);
</script>

{#if entry}
  <article class="preview-card" class:success={model.stage === 'result'} aria-label={`${entry.name} preview`}>
    <div class="preview-art">
      {#if entry.art}<img src={entry.art} alt="" />{:else}<span>{entry.icon}</span>{/if}
    </div>
    <div class="preview-copy">
      <p class="eyebrow">{model.stage === 'result' ? 'Mock order complete' : 'At the counter'}</p>
      <h2 id={model.stage === 'result' ? 'shop-result-title' : 'shop-preview-title'} tabindex="-1">{entry.name}</h2>
      <p class="description">{entry.description}</p>
      <dl class="facts">
        <div><dt>Cost</dt><dd>{entry.price} gold</dd></div>
        <div><dt>In stock</dt><dd>{model.stock}</dd></div>
        {#if entry.kind === 'expansion'}<div><dt>Garden</dt><dd>{model.plotCount} → {entry.plotCount} plots</dd></div>{/if}
      </dl>
      {#if model.stage === 'result'}
        <p class="result-copy">{model.result}</p>
      {:else}
        <p class="affordability" class:unavailable={!model.affordable}>
          {model.stock <= 0 ? 'Out of stock' : model.affordable ? 'Ready to order' : `You need ${entry.price - model.gold} more gold`}
        </p>
        <button id="shop-buy" type="button" class="order-button" disabled={!model.affordable} onclick={model.onBuy}>Mock order · {entry.price} gold</button>
      {/if}
    </div>
  </article>
{/if}

<style>
  .preview-card { position: relative; z-index: 8; display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 1rem; width: min(100%, 570px); padding: 1rem; border: 1px solid rgba(223, 183, 105, .76); border-radius: 1.15rem; color: #f0e4c7; background: linear-gradient(145deg, rgba(49, 33, 19, .98), rgba(17, 13, 9, .98)); box-shadow: 0 18px 42px rgba(0,0,0,.58); animation: preview-in .2s ease both; }
  .preview-card.success { border-color: rgba(148, 188, 122, .8); }
  .preview-art { display: grid; min-height: 136px; place-items: center; border: 1px solid rgba(209, 170, 97, .28); border-radius: .85rem; background: radial-gradient(circle, rgba(191, 142, 64, .2), rgba(20, 15, 10, .3)); }
  .preview-art img { width: 92px; height: 108px; object-fit: contain; filter: drop-shadow(0 5px 8px rgba(0,0,0,.55)); }
  .preview-art span { color: #e6c171; font-size: 3rem; }
  .eyebrow { margin: 0 0 .18rem; color: #d5b56e; font-size: .62rem; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; }
  h2 { margin: 0; font-size: 1.2rem; line-height: 1.12; }
  h2:focus { outline: none; }
  .description { margin: .4rem 0 .55rem; color: #d0c2a1; font-size: .78rem; line-height: 1.35; }
  .facts { display: flex; flex-wrap: wrap; gap: .8rem; margin: 0 0 .6rem; }
  .facts div { display: grid; gap: .1rem; }
  dt { color: #ae9d7b; font-size: .63rem; }
  dd { margin: 0; color: #f3d58b; font-size: .76rem; font-weight: 700; }
  .affordability, .result-copy { margin: .2rem 0 .55rem; color: #c6dda5; font-size: .72rem; }
  .affordability.unavailable { color: #e7ae88; }
  .order-button { min-height: 2.4rem; padding: .48rem .8rem; border: 1px solid #d6b465; border-radius: .7rem; color: #24190c; background: linear-gradient(#f0d48f, #c89842); font-weight: 750; }
  .order-button:disabled { border-color: #766b55; color: #a59a80; background: #393329; cursor: not-allowed; }
  .order-button:focus-visible { outline: 2px solid #f7d982; outline-offset: 3px; }
  @keyframes preview-in { from { opacity: 0; transform: translateY(.7rem); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 600px) {
    .preview-card { grid-template-columns: 70px minmax(0, 1fr); gap: .65rem; padding: .72rem; border-radius: .9rem; }
    .preview-art { min-height: 88px; }
    .preview-art img { width: 60px; height: 70px; }
    .preview-art span { font-size: 2.3rem; }
    h2 { font-size: 1rem; }
    .description { margin: .3rem 0; font-size: .7rem; }
    .facts { gap: .4rem .65rem; }
  }
  @media (prefers-reduced-motion: reduce) { .preview-card { animation: none; } }
</style>
