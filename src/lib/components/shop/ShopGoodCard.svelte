<script lang="ts">
  import type { GardenInventoryItem } from '$lib/game/contracts';

  type ShopGood = Pick<GardenInventoryItem, 'itemKey' | 'name'>;

  let {
    item,
    eyebrow,
    detail,
    meta,
    icon,
    artUrl = null,
    category = undefined,
    gardenSeedKey = undefined,
    unavailable = false
  }: {
    item: ShopGood;
    eyebrow: string;
    detail: string;
    meta: string;
    icon: string;
    artUrl?: string | null;
    category?: string;
    gardenSeedKey?: string;
    unavailable?: boolean;
  } = $props();
</script>

<div
  class="shop-hand-card good-card"
  data-good-key={item.itemKey}
  data-good-category={category}
  data-garden-seed-card={gardenSeedKey}
  data-social-seed={['seed_charm_bloom', 'seed_insight_iris', 'seed_rumor_thyme'].includes(item.itemKey) ? item.itemKey : undefined}
>
  <div class="shop-card-art good-art" aria-hidden="true">
    <span>{icon}</span>
    {#if artUrl}<img src={artUrl} alt="" onerror={(event) => event.currentTarget.remove()} />{/if}
  </div>
  <div class="shop-card-copy">
    <p class="eyebrow">{eyebrow}</p>
    <h3>{item.name}</h3>
    <p>{detail}</p>
  </div>
  <div class="shop-card-meta">
    <span class:sold-out={unavailable}>{meta}</span>
    <span aria-hidden="true">↗</span>
  </div>
</div>

<style>
  .shop-hand-card { display: grid; height: 100%; min-height: 12rem; grid-template-rows: minmax(4rem, auto) 1fr auto; gap: .5rem; }
  .shop-card-art { position: relative; display: grid; min-height: 4.4rem; place-items: center; overflow: hidden; color: #f0d58c; background: radial-gradient(circle, #3d2a14, #120c06); font-size: 2.3rem; }
  .shop-card-art img { position: absolute; inset: .25rem; width: calc(100% - .5rem); height: calc(100% - .5rem); object-fit: contain; }
  .shop-card-copy { min-width: 0; align-self: center; }
  .shop-card-copy .eyebrow { color: #b6d382; font: 600 .62rem 'Cinzel', serif; letter-spacing: .1em; text-transform: uppercase; }
  .shop-card-copy h3 { margin: .2rem 0 .35rem; color: #f1d990; font: 600 .92rem/1.2 'Cinzel', serif; overflow-wrap: anywhere; }
  .shop-card-copy p:not(.eyebrow) { margin: .25rem 0 0; color: #c9bc9c; font-size: .74rem; line-height: 1.4; }
  .shop-card-meta { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding-top: .45rem; border-top: 1px solid #70562c; color: #d1b979; font-size: .7rem; }
  .shop-card-meta > span:last-child { color: #f0d58c; font-size: .95rem; }
  .sold-out { color: #e7836b !important; }
  .good-card .shop-card-copy h3 { font-size: .86rem; }
</style>
