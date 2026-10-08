<script lang="ts">
  import CategoryBurn from './CategoryBurn.svelte';
  import { BURN_TREATMENTS, type PrototypeModel, type ShopCategoryKey } from './types';
  let { model }: { model: PrototypeModel } = $props();
  const leaving = $derived(model.stage === 'items' && !!model.leavingCategory);
  function safeId(value: string) { return value.replace(/[^a-zA-Z0-9_-]/g, '-'); }
  function fanStyle(index: number, count: number) {
    const mid = (count - 1) / 2;
    const distance = index - mid;
    const angle = Math.max(-23, Math.min(23, distance * 7));
    const lift = -Math.max(0, 4 - Math.abs(distance)) * 5;
    const shift = 0;
    return `--tilt:${angle}deg;--lift:${lift}px;--shift:${shift}px;--deal-delay:${Math.abs(distance) * 18}ms`;
  }
  const burnDuration = $derived(BURN_TREATMENTS.find((treatment) => treatment.value === model.burnTreatment)?.durationMs ?? 1000);
  const burnPadding = '4.2rem';
  function chooseCategory(key: ShopCategoryKey, id: string) {
    if (model.transitionPhase !== 'idle') return;
    model.onCategory(key, id);
  }
</script>

<section class="fan-stage" aria-label={model.stage === 'categories' ? 'Shop category hand' : `${model.category.label} hand`}>
  {#if leaving && model.leavingCategory}
    <div class="leaving-card" class:burning={model.burningCategory === model.leavingCategory.key} aria-hidden="true">
      <span>{model.leavingCategory.icon}</span><strong>{model.leavingCategory.label}</strong>
    </div>
  {/if}
  <div class="fan-viewport" data-prototype-wheel class:fade-hand={model.stage === 'preview' || model.stage === 'result'} class:ember-hand={model.variant === 'C'} style={model.variant === 'C' ? `--fan-pad-block:${burnPadding}` : undefined}>
    <div class="fan-track" class:category-fan={model.stage === 'categories'}>
      {#if model.stage === 'categories'}
        {#each model.categories as category, index (category.key)}
          <button
            id={`shop-category-${category.key}`}
            class="fan-card category-card"
            class:burning={model.burningCategory === category.key}
            class:burn-dimmed={model.transitionPhase === 'category-burn' && model.burningCategory !== category.key}
            class:burn-crawl={model.burningCategory === category.key && model.burnTreatment === 'crawl'}
            class:burn-drip={model.burningCategory === category.key && model.burnTreatment === 'drip'}
            class:burn-ash={model.burningCategory === category.key && model.burnTreatment === 'ash'}
            style={`${fanStyle(index, model.categories.length)};--burn-duration:${burnDuration}ms`}
            data-burn-treatment={model.transitionPhase === 'category-burn' && model.burningCategory === category.key ? model.burnTreatment : undefined}
            data-burn-duration={model.transitionPhase === 'category-burn' && model.burningCategory === category.key ? burnDuration : undefined}
            aria-hidden={model.transitionPhase === 'category-burn' && model.burningCategory !== category.key}
            aria-disabled={model.transitionPhase !== 'idle'}
            tabindex={model.transitionPhase === 'category-burn' && model.burningCategory !== category.key ? -1 : undefined}
            type="button"
            onclick={(event) => chooseCategory(category.key, (event.currentTarget as HTMLButtonElement).id)}
          >
            <span
              class="category-card-face"
            >
              <span class="card-icon">{category.icon}</span>
              <strong>{category.label}</strong>
              <small>{category.count} {category.count === 1 ? 'item' : 'items'}</small>
              <span class="card-note">{category.description}</span>
            </span>
            {#if model.variant === 'C' && model.burningCategory === category.key}
              <CategoryBurn treatment={model.burnTreatment} durationMs={burnDuration} />
            {/if}
          </button>
        {/each}
      {:else if model.stage === 'items' || model.stage === 'preview' || model.stage === 'result'}
        {#each model.entries as entry, index (entry.key)}
          <button
            id={`shop-item-${safeId(entry.key)}`}
            class="fan-card item-card"
            class:sibling-burning={model.transitionPhase === 'item-burn' && model.transitionKey !== entry.key}
            class:burned-item={model.burnedEntryKeys.includes(entry.key) && model.transitionPhase !== 'item-burn'}
            class:previewed-item={model.variant === 'C' && (model.stage === 'preview' || model.stage === 'result') && model.selectedEntry?.key === entry.key}
            class:burn-crawl={model.transitionPhase === 'item-burn' && model.transitionKey !== entry.key && model.burnTreatment === 'crawl'}
            class:burn-drip={model.transitionPhase === 'item-burn' && model.transitionKey !== entry.key && model.burnTreatment === 'drip'}
            class:burn-ash={model.transitionPhase === 'item-burn' && model.transitionKey !== entry.key && model.burnTreatment === 'ash'}
            style={`${fanStyle(index, model.entries.length)};--burn-duration:${burnDuration}ms`}
            data-burn-treatment={model.transitionPhase === 'item-burn' && model.transitionKey !== entry.key ? model.burnTreatment : undefined}
            data-burn-duration={model.transitionPhase === 'item-burn' && model.transitionKey !== entry.key ? burnDuration : undefined}
            type="button"
            aria-hidden={(model.transitionPhase === 'item-burn' && model.transitionKey !== entry.key) || model.burnedEntryKeys.includes(entry.key) || (model.variant === 'C' && (model.stage === 'preview' || model.stage === 'result') && model.selectedEntry?.key === entry.key)}
            aria-disabled={model.stage !== 'items' || model.transitionPhase !== 'idle'}
            tabindex={(model.transitionPhase === 'item-burn' && model.transitionKey !== entry.key) || model.burnedEntryKeys.includes(entry.key) || (model.variant === 'C' && (model.stage === 'preview' || model.stage === 'result') && model.selectedEntry?.key === entry.key) ? -1 : undefined}
            onclick={(event) => model.onEntry(entry, (event.currentTarget as HTMLButtonElement).id)}
          >
            <span class="item-card-face">
              {#if entry.art}<img src={entry.art} alt="" loading="lazy" />{:else}<span class="card-icon">{entry.icon}</span>{/if}
              <strong>{entry.name}</strong>
              <small>{entry.price} gold</small>
            </span>
            {#if model.transitionPhase === 'item-burn' && model.transitionKey !== entry.key}
              <CategoryBurn treatment={model.burnTreatment} durationMs={burnDuration} />
            {/if}
          </button>
        {/each}
        {#if !model.entries.length}<p class="empty-hand">This shelf is empty for now.</p>{/if}
      {/if}
    </div>
  </div>
  {#if model.stage === 'items' && model.entries.length > 4}
    <p class="pan-cue">Swipe to browse · {model.entries.length} items</p>
  {/if}
</section>

<style>
  .fan-stage { position: relative; z-index: 2; min-width: 0; padding: .2rem 0 1.2rem; }
  .fan-viewport { min-width: 0; overflow-x: auto; overflow-y: visible; overscroll-behavior-inline: contain; scroll-snap-type: x mandatory; scrollbar-color: #806332 transparent; scrollbar-width: thin; padding: 1.7rem .35rem .7rem; transition: opacity .2s ease; }
  .fan-viewport.ember-hand { overflow-y: hidden; padding-block: var(--fan-pad-block, 4.2rem); }
  .fan-viewport.fade-hand { opacity: .32; }
  .fan-track { display: flex; width: max-content; min-width: 100%; align-items: end; justify-content: center; padding-inline: 1.6rem; }
  .fan-card { position: relative; flex: 0 0 124px; display: grid; min-height: 178px; margin-inline: -25px; padding: .7rem .58rem; align-content: center; justify-items: center; gap: .28rem; border: 1px solid rgba(211, 171, 96, .68); border-radius: 1rem; color: #f1e4c4; background: linear-gradient(155deg, #493018, #20160e 68%, #110d08); box-shadow: 0 10px 18px rgba(0,0,0,.36); text-align: center; transform: translate(var(--shift), var(--lift)) rotate(var(--tilt)); transform-origin: 50% 112%; transition: transform .19s ease, opacity .19s ease, box-shadow .19s ease, border-color .19s ease; scroll-snap-align: center; animation: card-deal .22s ease both; animation-delay: var(--deal-delay); }
  .category-fan .fan-card { flex-basis: 150px; min-height: 207px; margin-inline: -18px; }
  .category-card { display: block; padding: 0; border: 0; color: inherit; background: transparent; box-shadow: none; }
  .category-card-face { position: absolute; inset: 0; display: grid; min-height: 0; padding: .7rem .58rem; align-content: center; justify-items: center; gap: .28rem; border: 1px solid rgba(211, 171, 96, .68); border-radius: 1rem; color: #f1e4c4; background: linear-gradient(155deg, #493018, #20160e 68%, #110d08); box-shadow: 0 10px 18px rgba(0,0,0,.36); text-align: center; transform: none; transition: box-shadow .19s ease, border-color .19s ease; }
  .item-card { display: block; padding: 0; border-color: transparent; background: transparent; box-shadow: none; }
  .item-card-face { position: absolute; inset: 0; display: grid; padding: .7rem .58rem; align-content: center; justify-items: center; gap: .28rem; border: 1px solid rgba(211, 171, 96, .68); border-radius: 1rem; color: #f1e4c4; background: linear-gradient(155deg, #493018, #20160e 68%, #110d08); box-shadow: 0 10px 18px rgba(0,0,0,.36); text-align: center; transition: box-shadow .19s ease, border-color .19s ease; }
  .fan-card:hover, .fan-card:focus-visible { z-index: 6; border-color: #f2d080; box-shadow: 0 0 0 2px rgba(236, 197, 111, .28), 0 14px 23px rgba(0,0,0,.48); transform: translate(var(--shift), calc(var(--lift) - .55rem)) rotate(0deg); }
  .category-card:hover, .category-card:focus-visible { border-color: transparent; box-shadow: none; }
  .category-card:hover .category-card-face, .category-card:focus-visible .category-card-face { border-color: #f2d080; box-shadow: 0 0 0 2px rgba(236, 197, 111, .28), 0 14px 23px rgba(0,0,0,.48); }
  .item-card:hover .item-card-face, .item-card:focus-visible .item-card-face { border-color: #f2d080; box-shadow: 0 0 0 2px rgba(236, 197, 111, .28), 0 14px 23px rgba(0,0,0,.48); }
  .fan-card:focus-visible { outline: 2px solid #f1ce7d; outline-offset: 3px; }
  .fan-card.burn-dimmed { opacity: 0; filter: blur(1px); pointer-events: none; animation: none; }
  .category-card.burning { z-index: 8; pointer-events: none; }
  .category-card.burning .category-card-face { border-color: #f3a84e; animation: category-burn-away var(--burn-duration) ease-in forwards; }
  .category-card.burning.burn-crawl .category-card-face { animation-name: category-crawl-away; }
  .category-card.burning.burn-drip .category-card-face { animation-name: category-drip-away; }
  .category-card.burning.burn-ash .category-card-face { animation-name: category-ash-away; }
  .category-card.burning:hover, .category-card.burning:focus-visible { transform: translate(var(--shift), var(--lift)) rotate(var(--tilt)); }
  .category-card.burning:focus-visible { outline: none; box-shadow: none; }
  .category-card.burning:hover .category-card-face, .category-card.burning:focus-visible .category-card-face { border-color: #f3a84e; box-shadow: 0 0 0 2px rgba(236, 197, 111, .28), 0 0 16px rgba(244, 125, 36, .5); }
  .item-card.sibling-burning { z-index: 8; pointer-events: none; animation: none; transform: translate(var(--shift), var(--lift)) rotate(var(--tilt)); }
  .item-card.sibling-burning .item-card-face { border-color: #f3a84e; animation: category-burn-away var(--burn-duration) ease-in forwards; }
  .item-card.sibling-burning.burn-crawl .item-card-face { animation-name: category-crawl-away; }
  .item-card.sibling-burning.burn-drip .item-card-face { animation-name: category-drip-away; }
  .item-card.sibling-burning.burn-ash .item-card-face { animation-name: category-ash-away; }
  .item-card.burned-item, .item-card.previewed-item { visibility: hidden; opacity: 0; pointer-events: none; animation: none; }
  .fan-card img { width: 58px; height: 66px; object-fit: contain; filter: drop-shadow(0 3px 5px rgba(0,0,0,.55)); }
  .fan-card strong { display: -webkit-box; max-width: 100%; overflow: hidden; font-size: .77rem; line-height: 1.12; line-clamp: 2; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .fan-card small { color: #dccda9; font-size: .67rem; }
  .card-icon { color: #e7c373; font-size: 2.15rem; }
  .card-note { color: #c8b88e; font-size: .64rem; line-height: 1.25; }
  .empty-hand { align-self: center; padding: 1rem; color: #d9cba8; }
  .pan-cue { margin: .15rem .5rem 0; color: #cbb98e; font-size: .68rem; text-align: center; }
  .leaving-card { position: absolute; z-index: 5; left: 50%; top: .8rem; display: grid; width: 140px; height: 190px; place-content: center; gap: .3rem; border: 1px solid #e7b24c; border-radius: 1rem; color: #f1dfbc; background: #392416; box-shadow: 0 0 22px rgba(224, 146, 44, .45); text-align: center; transform: translateX(-50%); animation: ash-away .21s ease-out forwards; pointer-events: none; }
  .leaving-card span { color: #f6c871; font-size: 2rem; }
  .leaving-card.burning::after { position: absolute; content: ''; inset: 0; border-radius: inherit; background: linear-gradient(0deg, rgba(83, 48, 23, .2), rgba(247, 178, 71, .36)); animation: ember .21s ease-out forwards; }
  .leaving-card strong { font-size: .8rem; }
  @keyframes card-deal { from { opacity: 0; transform: translate(var(--shift), calc(var(--lift) + .55rem)) rotate(var(--tilt)); } to { opacity: 1; } }
  @keyframes ash-away { to { opacity: 0; transform: translate(-50%, -1.2rem) rotate(-4deg); filter: blur(2px); } }
  @keyframes ember { to { opacity: 0; transform: translateY(-1rem); } }
  @keyframes category-burn-away { 0%, 65% { opacity: 1; filter: brightness(1.05); } 100% { opacity: 0; filter: brightness(.55) grayscale(.85); } }
  @keyframes category-crawl-away {
    0%, 18% { clip-path: inset(0 round 1rem); opacity: 1; }
    72% { clip-path: inset(30% round 1rem); opacity: .88; }
    100% { clip-path: inset(50% round 1rem); opacity: 0; filter: brightness(.45) grayscale(.8); }
  }
  @keyframes category-drip-away {
    0%, 14% { clip-path: inset(0 0 0 0 round 1rem); opacity: 1; }
    56% { clip-path: inset(45% 0 0 0 round 1rem); opacity: 1; }
    82% { clip-path: inset(78% 0 0 0 round 1rem); opacity: .8; }
    100% { clip-path: inset(100% 0 0 0 round 1rem); opacity: 0; filter: brightness(.35) grayscale(.9); }
  }
  @keyframes category-ash-away {
    0%, 17% { clip-path: polygon(0 0,42% 0,50% 8%,58% 0,100% 0,100% 42%,92% 50%,100% 58%,100% 100%,58% 100%,50% 92%,42% 100%,0 100%,0 58%,8% 50%,0 42%); opacity: 1; }
    64% { clip-path: polygon(40% 40%,46% 41%,50% 36%,54% 41%,60% 40%,60% 46%,64% 50%,60% 54%,60% 60%,54% 59%,50% 64%,46% 59%,40% 60%,40% 54%,36% 50%,40% 46%); opacity: .85; }
    100% { clip-path: polygon(50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%,50% 50%); opacity: 0; filter: grayscale(.9) blur(1px); }
  }
  @media (max-width: 700px) {
    .fan-track { min-width: 100%; justify-content: flex-start; padding-inline: 2rem 3.25rem; }
    .fan-card { flex-basis: 108px; min-height: 156px; margin-inline: -30px; }
    .category-fan .fan-card { flex-basis: 124px; min-height: 178px; margin-inline: -22px; }
    .fan-card img { width: 45px; height: 50px; }
    .fan-card strong { font-size: .7rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .fan-viewport, .fan-card { transition: none; }
    .fan-card { animation: none; animation-delay: 0ms; }
    .leaving-card, .leaving-card.burning::after { animation: none; }
    .leaving-card { opacity: .72; border-color: #edca79; filter: none; }
  }
</style>
