<script lang="ts">
  import ShopMarket from '$lib/components/shop/ShopMarket.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Shop · By Rook and Crook</title>
  <meta name="description" content="Buy garden and apiary supplies from Elara Greenbloom." />
</svelte:head>

<main class="page-shell shop-page">
  {#if data.snapshot}
    <ShopMarket snapshot={data.snapshot} burnStyle={data.cardBurnStyle} supplies={data.supplies} {form} />
  {:else}
    <section class="panel empty-state" aria-labelledby="shop-onboarding-title">
      <p class="eyebrow">Elara's storefront</p>
      <h1 id="shop-onboarding-title">The shop opens with your tavern</h1>
      <p>Begin in the garden, then return here for seeds, soil care, and apiary supplies.</p>
      <a class="primary-button inline-button" href="/garden">Start in the garden</a>
    </section>
  {/if}
</main>

<style>
  .shop-page { width:min(1600px,calc(100% - 24px)); margin:1rem auto; padding:0; }
</style>
