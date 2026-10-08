<script lang="ts">
  import { BURN_TREATMENTS, type PrototypeModel } from './types';
  let { model }: { model: PrototypeModel } = $props();
  const entry = $derived(model.selectedEntry);
  const burnDuration = $derived(BURN_TREATMENTS.find((treatment) => treatment.value === model.burnTreatment)?.durationMs ?? 1000);
  const bridgeTransform = $derived.by(() => {
    const transform = model.previewBridgeTransform;
    if (!transform) return undefined;
    if (model.previewBridgeAnimating) return 'transform: none; transform-origin: top left;';
    return `transform: translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scaleX}, ${transform.scaleY}); transform-origin: top left;`;
  });
</script>

{#if entry}
  <article
    id="shop-preview-card"
    class="preview-card"
    class:bridge-transitioning={model.transitionPhase === 'item-zoom' && model.previewBridgeAnimating}
    style={bridgeTransform}
    aria-label={`${entry.name} preview`}
  >
    <div
      class="preview-card-face"
      class:success={model.stage === 'result'}
      class:burning={model.transitionPhase === 'order-burn'}
      class:burn-crawl={model.burnTreatment === 'crawl'}
      class:burn-drip={model.burnTreatment === 'drip'}
      class:burn-ash={model.burnTreatment === 'ash'}
      class:skip-entry-animation={model.variant === 'C'}
      style={`--burn-duration:${burnDuration}ms`}
      data-burn-treatment={model.transitionPhase === 'order-burn' ? model.burnTreatment : undefined}
      data-burn-duration={model.transitionPhase === 'order-burn' ? burnDuration : undefined}
    >
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
          <button id="shop-buy" type="button" class="order-button" disabled={!model.affordable || model.transitionPhase !== 'idle'} onclick={model.onBuy}>Mock order · {entry.price} gold</button>
        {/if}
      </div>
    </div>
  </article>
{/if}

<style>
  .preview-card { position: relative; z-index: 8; width: min(100%, 570px); transform-origin: top left; }
  .preview-card.bridge-transitioning { transition: transform .2s cubic-bezier(.2, .72, .28, 1); }
  .preview-card-face { position: relative; display: grid; box-sizing: border-box; grid-template-columns: 112px minmax(0, 1fr); gap: 1rem; width: 100%; padding: 1rem; overflow: hidden; border: 1px solid rgba(223, 183, 105, .76); border-radius: 1.15rem; color: #f0e4c7; background: linear-gradient(145deg, rgba(49, 33, 19, .98), rgba(17, 13, 9, .98)); box-shadow: 0 18px 42px rgba(0,0,0,.58); animation: preview-in .2s ease both; }
  .preview-card-face.skip-entry-animation { animation: none; }
  .preview-card-face.success { border-color: rgba(148, 188, 122, .8); }
  .preview-card-face.burning { border-color: #f3a84e; animation: inspection-burn-away var(--burn-duration) ease-in forwards; }
  .preview-card-face.burning.burn-crawl { animation-name: inspection-crawl-away; }
  .preview-card-face.burning.burn-drip { animation-name: inspection-drip-away; }
  .preview-card-face.burning.burn-ash { animation-name: inspection-ash-away; }
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
  @keyframes inspection-burn-away { 0%, 65% { opacity: 1; filter: brightness(1.05); } 100% { opacity: 0; filter: brightness(.45) grayscale(.9); } }
  @keyframes inspection-crawl-away {
    0%, 18% { clip-path: inset(0 round 1rem); opacity: 1; }
    72% { clip-path: inset(30% round 1rem); opacity: .88; }
    100% { clip-path: inset(50% round 1rem); opacity: 0; filter: brightness(.45) grayscale(.8); }
  }
  @keyframes inspection-drip-away {
    0%, 14% { clip-path: inset(0 0 0 0 round 1rem); opacity: 1; }
    56% { clip-path: inset(45% 0 0 0 round 1rem); opacity: 1; }
    82% { clip-path: inset(78% 0 0 0 round 1rem); opacity: .8; }
    100% { clip-path: inset(100% 0 0 0 round 1rem); opacity: 0; filter: brightness(.35) grayscale(.9); }
  }
  @keyframes inspection-ash-away {
    0%, 17% { clip-path: polygon(0 0,42% 0,50% 8%,58% 0,100% 0,100% 42%,92% 50%,100% 58%,100% 100%,58% 100%,50% 92%,42% 100%,0 100%,0 58%,8% 50%,0 42%); opacity: 1; }
    64% { clip-path: polygon(40% 40%,46% 41%,50% 36%,54% 41%,60% 40%,60% 46%,64% 50%,60% 54%,60% 60%,54% 59%,50% 64%,46% 59%,40% 60%,40% 54%,36% 50%,40% 46%); opacity: .85; }
    100% { clip-path: polygon(50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%); opacity: 0; filter: grayscale(.9) blur(1px); }
  }
  @media (max-width: 600px) {
    .preview-card-face { grid-template-columns: 70px minmax(0, 1fr); gap: .65rem; padding: .72rem; border-radius: .9rem; }
    .preview-art { min-height: 88px; }
    .preview-art img { width: 60px; height: 70px; }
    .preview-art span { font-size: 2.3rem; }
    h2 { font-size: 1rem; }
    .description { margin: .3rem 0; font-size: .7rem; }
    .facts { gap: .4rem .65rem; }
  }
  @media (prefers-reduced-motion: reduce) { .preview-card-face { animation: none; } }
</style>
