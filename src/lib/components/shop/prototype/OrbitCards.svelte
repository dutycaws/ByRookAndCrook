<script lang="ts">
  import type { PrototypeModel, ShopCategoryKey } from './types';
  let { model }: { model: PrototypeModel } = $props();
  const dimmed = $derived(model.stage === 'preview' || model.stage === 'result');

  function position(index: number, count: number) {
    const angle = -90 + (360 * index) / Math.max(count, 1);
    const radians = (angle * Math.PI) / 180;
    return `--x:${50 + Math.cos(radians) * 35}%;--y:${50 + Math.sin(radians) * 36}%;--deal-delay:${Math.min(index * 12, 72)}ms`;
  }
  function safeId(value: string) { return value.replace(/[^a-zA-Z0-9_-]/g, '-'); }
  function pickCategory(key: ShopCategoryKey, id: string) { model.onCategory(key, id); }
</script>

<section class:dimmed class="orbit-deck" data-prototype-wheel aria-label={model.stage === 'categories' ? 'Shop categories' : `${model.category.label} items`}>
  <div class="orbit-ring" aria-hidden="true"></div>
  <div class="orbit-center" aria-hidden="true">
    <span class="center-mark">✧</span>
    <span>{model.stage === 'categories' ? 'Elara’s shelves' : model.category.label}</span>
  </div>
  {#if model.stage === 'categories'}
    {#each model.categories as category, index (category.key)}
      <button
        id={`shop-category-${category.key}`}
        class="orbit-card category-card"
        class:active={model.selectedCategory === category.key}
        style={position(index, model.categories.length)}
        type="button"
        disabled={dimmed}
        onclick={(event) => pickCategory(category.key, (event.currentTarget as HTMLButtonElement).id)}
      >
        <span class="card-icon">{category.icon}</span>
        <strong>{category.label}</strong>
        <small>{category.count} {category.count === 1 ? 'item' : 'items'}</small>
      </button>
    {/each}
  {:else if model.stage === 'items' || model.stage === 'preview' || model.stage === 'result'}
    {#each model.entries as entry, index (entry.key)}
      <button
        id={`shop-item-${safeId(entry.key)}`}
        class="orbit-card item-card"
        style={position(index, model.entries.length)}
        type="button"
        disabled={dimmed}
        onclick={(event) => model.onEntry(entry, (event.currentTarget as HTMLButtonElement).id)}
      >
        {#if entry.art}<img src={entry.art} alt="" loading="lazy" />{:else}<span class="card-icon">{entry.icon}</span>{/if}
        <strong>{entry.name}</strong>
        <small>{entry.price} gold</small>
      </button>
    {/each}
    {#if !model.entries.length}<p class="empty-shelf">Nothing is on this shelf yet.</p>{/if}
  {/if}
  {#if model.stage === 'items' && model.leavingCategory}
    <div class="orbit-exit-layer" aria-hidden="true">
      {#each model.categories as category, index (category.key)}
        <span class="orbit-card category-card exit-card" class:selected-exit={category.key === model.leavingCategory.key} style={position(index, model.categories.length)}>
          <span class="card-icon">{category.icon}</span><strong>{category.label}</strong><small>{category.count} {category.count === 1 ? 'item' : 'items'}</small>
        </span>
      {/each}
    </div>
  {/if}
</section>

<style>
  .orbit-deck { position: relative; width: min(100%, 440px); aspect-ratio: 1; margin: 0 auto; isolation: isolate; transition: opacity .2s ease, filter .2s ease; }
  .orbit-deck.dimmed { opacity: .32; filter: saturate(.6); pointer-events: none; }
  .orbit-ring { position: absolute; inset: 11%; border: 1px solid rgba(209, 164, 86, .4); border-radius: 50%; box-shadow: 0 0 38px rgba(201, 148, 63, .12), inset 0 0 42px rgba(201, 148, 63, .07); }
  .orbit-ring::before, .orbit-ring::after { position: absolute; content: ''; inset: 9%; border: 1px dashed rgba(209, 164, 86, .22); border-radius: 50%; }
  .orbit-ring::after { inset: 22%; border-style: solid; opacity: .55; }
  .orbit-center { position: absolute; z-index: 1; left: 50%; top: 50%; display: grid; width: 30%; aspect-ratio: 1; place-content: center; gap: .25rem; border: 1px solid rgba(217, 178, 105, .36); border-radius: 50%; color: #d6c59f; background: radial-gradient(circle, rgba(61, 40, 18, .9), rgba(18, 13, 8, .75)); font-size: .68rem; text-align: center; transform: translate(-50%, -50%); }
  .center-mark { color: #ebcc83; font-size: 1.6rem; }
  .orbit-card { position: absolute; z-index: 2; left: var(--x); top: var(--y); display: grid; width: 112px; min-height: 144px; padding: .65rem .55rem; align-content: center; justify-items: center; gap: .25rem; border: 1px solid rgba(210, 171, 96, .62); border-radius: 1rem; color: #f1e5c7; background: linear-gradient(150deg, rgba(74, 49, 23, .98), rgba(26, 18, 11, .98)); box-shadow: 0 8px 18px rgba(0, 0, 0, .36); text-align: center; transform: translate(-50%, -50%); transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; animation: orbit-deal .2s ease both; animation-delay: var(--deal-delay); }
  .orbit-card.item-card { animation-name: orbit-slide-in; animation-duration: .2s; }
  .orbit-card:hover:not(:disabled), .orbit-card:focus-visible { z-index: 5; border-color: #f1cd79; box-shadow: 0 0 0 2px rgba(235, 195, 110, .3), 0 10px 22px rgba(0, 0, 0, .48); transform: translate(-50%, -50%) scale(1.045); }
  .orbit-card:focus-visible { outline: 2px solid #f5d484; outline-offset: 3px; }
  .category-card { width: 126px; min-height: 152px; border-radius: 1.25rem; }
  .category-card.active { border-color: #f4d080; }
  .card-icon { color: #e6bf6f; font-size: 2rem; }
  .orbit-card img { width: 62px; height: 64px; object-fit: contain; filter: drop-shadow(0 3px 5px rgba(0,0,0,.55)); }
  .orbit-card strong { display: -webkit-box; max-width: 100%; overflow: hidden; font-size: .78rem; line-height: 1.15; line-clamp: 2; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .orbit-card small { color: #d4c49f; font-size: .67rem; }
  .empty-shelf { position: absolute; inset: 50% auto auto 50%; width: 60%; color: #d9cba8; text-align: center; transform: translate(-50%, -50%); }
  .orbit-exit-layer { position: absolute; z-index: 6; inset: 0; pointer-events: none; }
  .exit-card { animation: orbit-slide-out .2s ease-in both; animation-delay: calc(var(--deal-delay) / 3); }
  .exit-card.selected-exit { border-color: #f2c46e; box-shadow: 0 0 20px rgba(221, 151, 54, .52); }
  @keyframes orbit-deal { from { opacity: 0; translate: 0 .4rem; } to { opacity: 1; translate: 0 0; } }
  @keyframes orbit-slide-in { from { opacity: 0; translate: 1.1rem 0; } to { opacity: 1; translate: 0 0; } }
  @keyframes orbit-slide-out { to { opacity: 0; translate: -1.15rem 0; filter: blur(1px); } }
  @media (max-width: 600px) {
    .orbit-deck { width: min(100%, 330px); }
    .orbit-card { width: 86px; min-height: 116px; padding: .45rem .4rem; border-radius: .8rem; }
    .category-card { width: 98px; min-height: 124px; }
    .orbit-card img { width: 44px; height: 46px; }
    .orbit-card strong { font-size: .68rem; }
    .orbit-card small { font-size: .6rem; }
    .orbit-center { width: 28%; font-size: .59rem; }
  }
  @media (prefers-reduced-motion: reduce) { .orbit-deck, .orbit-card { transition: none; animation: none; } .orbit-exit-layer { display: none; } }
</style>
