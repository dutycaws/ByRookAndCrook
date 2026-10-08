<script lang="ts">
  import type { PrototypeModel, ShopCategoryKey } from './types';
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
  function chooseCategory(key: ShopCategoryKey, id: string) { model.onCategory(key, id); }
</script>

<section class="fan-stage" aria-label={model.stage === 'categories' ? 'Shop category hand' : `${model.category.label} hand`}>
  {#if leaving && model.leavingCategory}
    <div class="leaving-card" class:burning={model.burningCategory === model.leavingCategory.key} aria-hidden="true">
      <span>{model.leavingCategory.icon}</span><strong>{model.leavingCategory.label}</strong>
    </div>
  {/if}
  <div class="fan-viewport" data-prototype-wheel class:fade-hand={model.stage === 'preview' || model.stage === 'result'}>
    <div class="fan-track" class:category-fan={model.stage === 'categories'}>
      {#if model.stage === 'categories'}
        {#each model.categories as category, index (category.key)}
          <button
            id={`shop-category-${category.key}`}
            class="fan-card category-card"
            class:burning={model.burningCategory === category.key}
            style={fanStyle(index, model.categories.length)}
            type="button"
            onclick={(event) => chooseCategory(category.key, (event.currentTarget as HTMLButtonElement).id)}
          >
            <span class="card-icon">{category.icon}</span>
            <strong>{category.label}</strong>
            <small>{category.count} {category.count === 1 ? 'item' : 'items'}</small>
            <span class="card-note">{category.description}</span>
          </button>
        {/each}
      {:else if model.stage === 'items' || model.stage === 'preview' || model.stage === 'result'}
        {#each model.entries as entry, index (entry.key)}
          <button
            id={`shop-item-${safeId(entry.key)}`}
            class="fan-card item-card"
            style={fanStyle(index, model.entries.length)}
            type="button"
            disabled={model.stage === 'preview' || model.stage === 'result'}
            onclick={(event) => model.onEntry(entry, (event.currentTarget as HTMLButtonElement).id)}
          >
            {#if entry.art}<img src={entry.art} alt="" loading="lazy" />{:else}<span class="card-icon">{entry.icon}</span>{/if}
            <strong>{entry.name}</strong>
            <small>{entry.price} gold</small>
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
  .fan-viewport.fade-hand { opacity: .32; }
  .fan-track { display: flex; width: max-content; min-width: 100%; align-items: end; justify-content: center; padding-inline: 1.6rem; }
  .fan-card { position: relative; flex: 0 0 124px; display: grid; min-height: 178px; margin-inline: -25px; padding: .7rem .58rem; align-content: center; justify-items: center; gap: .28rem; border: 1px solid rgba(211, 171, 96, .68); border-radius: 1rem; color: #f1e4c4; background: linear-gradient(155deg, #493018, #20160e 68%, #110d08); box-shadow: 0 10px 18px rgba(0,0,0,.36); text-align: center; transform: translate(var(--shift), var(--lift)) rotate(var(--tilt)); transform-origin: 50% 112%; transition: transform .19s ease, opacity .19s ease, box-shadow .19s ease, border-color .19s ease; scroll-snap-align: center; animation: card-deal .22s ease both; animation-delay: var(--deal-delay); }
  .category-fan .fan-card { flex-basis: 150px; min-height: 207px; margin-inline: -18px; }
  .fan-card:hover, .fan-card:focus-visible { z-index: 6; border-color: #f2d080; box-shadow: 0 0 0 2px rgba(236, 197, 111, .28), 0 14px 23px rgba(0,0,0,.48); transform: translate(var(--shift), calc(var(--lift) - .55rem)) rotate(0deg); }
  .fan-card:focus-visible { outline: 2px solid #f1ce7d; outline-offset: 3px; }
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
  @media (max-width: 700px) {
    .fan-track { min-width: 100%; justify-content: flex-start; padding-inline: 2rem 3.25rem; }
    .fan-card { flex-basis: 108px; min-height: 156px; margin-inline: -30px; }
    .category-fan .fan-card { flex-basis: 124px; min-height: 178px; margin-inline: -22px; }
    .fan-card img { width: 45px; height: 50px; }
    .fan-card strong { font-size: .7rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .fan-viewport, .fan-card { transition: none; }
    .fan-card { animation: none; }
    .leaving-card, .leaving-card.burning::after { animation: none; }
    .leaving-card { opacity: .72; border-color: #edca79; filter: none; }
  }
</style>
