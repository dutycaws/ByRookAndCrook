<script lang="ts">
  import { dev } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import ShopMarket from '$lib/components/shop/ShopMarket.svelte';
  import GeneratedSupplies from '$lib/components/shop/GeneratedSupplies.svelte';
  import ShopPrototype from '$lib/components/shop/prototype/ShopPrototype.svelte';
  import PrototypeSwitcher from '$lib/components/ui/PrototypeSwitcher.svelte';
  import { BURN_TREATMENTS, DEFAULT_BURN_STYLE, type BurnStyle, type ShopVariant } from '$lib/components/shop/prototype/types';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const variants = ['A', 'B', 'C'] as const;
  const variantNames: Record<ShopVariant, string> = { A: 'Left orbit', B: 'Right orbit', C: 'Ember hand' };
  const variant = $derived(resolveVariant(page.url.searchParams.get('variant')));
  const BURN_STYLE_STORAGE_KEY = 'byrc-shop-burn-style';
  let burnStyle = $state<BurnStyle>(DEFAULT_BURN_STYLE);
  let storedBurnStyle = $state<BurnStyle>(DEFAULT_BURN_STYLE);
  let preferenceReady = $state(false);
  let ignoreCurrentBurnOverride = $state(false);

  function resolveBurnStyle(value: string | null): BurnStyle | null {
    if (value === 'random') return 'random';
    return BURN_TREATMENTS.find((treatment) => treatment.value === value)?.value ?? null;
  }

  function selectBurnStyle(style: BurnStyle) {
    storedBurnStyle = style;
    burnStyle = style;
    try {
      window.localStorage.setItem(BURN_STYLE_STORAGE_KEY, style);
    } catch {
      // Storage can be unavailable in private browsing or restricted environments.
    }
    const url = new URL(page.url);
    if (url.searchParams.has('burn')) {
      ignoreCurrentBurnOverride = true;
      url.searchParams.delete('burn');
      void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
    } else {
      ignoreCurrentBurnOverride = false;
    }
  }

  function resolveVariant(value: string | null): ShopVariant {
    const normalized = value?.toUpperCase();
    return normalized === 'A' || normalized === 'B' || normalized === 'C' ? normalized : 'C';
  }

  onMount(() => {
    try {
      storedBurnStyle = resolveBurnStyle(window.localStorage.getItem(BURN_STYLE_STORAGE_KEY)) ?? DEFAULT_BURN_STYLE;
    } catch {
      storedBurnStyle = DEFAULT_BURN_STYLE;
    }
    preferenceReady = true;
    const override = resolveBurnStyle(page.url.searchParams.get('burn'));
    burnStyle = override ?? storedBurnStyle;
  });

  $effect(() => {
    const override = resolveBurnStyle(page.url.searchParams.get('burn'));
    if (override) {
      if (!ignoreCurrentBurnOverride) burnStyle = override;
      return;
    }
    ignoreCurrentBurnOverride = false;
    if (preferenceReady) burnStyle = storedBurnStyle;
  });
</script>

<svelte:head>
  <title>Shop · By Rook and Crook</title>
  <meta name="description" content="Buy garden and apiary supplies from Elara Greenbloom." />
</svelte:head>

<main class="page-shell shop-page" class:prototype-page={dev && Boolean(data.snapshot)} class:ember-prototype={dev && Boolean(data.snapshot) && variant === 'C'}>
  {#if data.snapshot}
    {#if dev}
        <ShopPrototype snapshot={data.snapshot} {variant} {burnStyle} onBurnStyleChange={selectBurnStyle} />
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
