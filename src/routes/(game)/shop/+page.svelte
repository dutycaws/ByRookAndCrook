<script lang="ts">
  import { dev } from '$app/environment';
  import { page } from '$app/state';
  import ShopMarket from '$lib/components/shop/ShopMarket.svelte';
  import GeneratedSupplies from '$lib/components/shop/GeneratedSupplies.svelte';
  import ShopPrototype from '$lib/components/shop/prototype/ShopPrototype.svelte';
  import PrototypeSwitcher from '$lib/components/ui/PrototypeSwitcher.svelte';
  import { resolveBurnStyle } from '$lib/card-effects';
  import type { ShopVariant } from '$lib/components/shop/prototype/types';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const variants = ['A', 'B', 'C'] as const;
  const variantNames: Record<ShopVariant, string> = { A: 'Left orbit', B: 'Right orbit', C: 'Ember hand' };
  const variant = $derived(resolveVariant(page.url.searchParams.get('variant')));
  const burnStyle = $derived((dev ? resolveBurnStyle(page.url.searchParams.get('burn')) : null) ?? data.cardBurnStyle);

  function resolveVariant(value: string | null): ShopVariant {
    const normalized = value?.toUpperCase();
    return normalized === 'A' || normalized === 'B' || normalized === 'C' ? normalized : 'C';
  }

</script>

<svelte:head>
  <title>Shop · By Rook and Crook</title>
  <meta name="description" content="Buy garden and apiary supplies from Elara Greenbloom." />
</svelte:head>

<main class="page-shell shop-page" class:prototype-page={dev && Boolean(data.snapshot)} class:ember-prototype={dev && Boolean(data.snapshot) && variant === 'C'}>
  {#if data.snapshot}
    {#if dev}
        <ShopPrototype snapshot={data.snapshot} {variant} {burnStyle} />
        <PrototypeSwitcher {variants} {variantNames} current={variant} />
    {:else}
      <ShopMarket snapshot={data.snapshot} />
      {#if data.supplies}
        <GeneratedSupplies supplies={data.supplies} saveId={data.snapshot.save.id} revision={data.snapshot.save.revision} {form} />
      {/if}
    {/if}
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
  .shop-page { width: min(1600px, calc(100% - 24px)); }
  .shop-page.prototype-page { margin-block-start: .5rem; padding-block-start: .6rem; padding-block-end: 4.5rem; }
  .shop-page.prototype-page.ember-prototype { padding-block-end: 8rem; }
</style>
