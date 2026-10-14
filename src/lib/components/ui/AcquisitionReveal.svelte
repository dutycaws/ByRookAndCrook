<script lang="ts">
  import { tick } from 'svelte';
  import type { AcquisitionCard } from '$lib/game/acquisition';
  import CardHandCard from './CardHandCard.svelte';

  let {
    open,
    id,
    eyebrow = 'Item acquired',
    title,
    description,
    quantityLabel,
    imageSrc,
    imageAlt = '',
    icon = '✧',
    artKind = 'item',
    details = [],
    dismissLabel = 'Continue',
    ondismiss,
    focusReturn = null
  }: Omit<AcquisitionCard, 'artKind'> & {
    open: boolean;
    artKind?: AcquisitionCard['artKind'];
    dismissLabel?: string;
    ondismiss: () => void;
    focusReturn?: HTMLElement | null;
  } = $props();

  let visible = $state(false);
  let closing = $state(false);
  let continueButton = $state<HTMLButtonElement>();
  let wasOpen = false;
  let presentedId = '';
  let previousFocus: HTMLElement | null = null;
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  const dialogId = $derived(`acquisition-${id.replace(/[^a-z\d_-]/gi, '-')}`);

  $effect(() => {
    if (open && (!wasOpen || id !== presentedId)) {
      wasOpen = true;
      presentedId = id;
      if (dismissTimer) clearTimeout(dismissTimer);
      closing = false;
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      visible = true;
      void tick().then(() => continueButton?.focus({ preventScroll: true }));
    } else if (!open) {
      wasOpen = false;
      visible = false;
    }
  });

  function dismiss() {
    if (!visible || closing) return;
    closing = true;
    dismissTimer = setTimeout(async () => {
      ondismiss();
      await tick();
      const target = focusReturn ?? document.querySelector<HTMLElement>('.workflow-heading h1')
        ?? (previousFocus?.isConnected ? previousFocus : null);
      if (target?.isConnected) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
      visible = false;
      closing = false;
      wasOpen = false;
    }, prefersReducedMotion() ? 0 : 160);
  }

  function prefersReducedMotion() {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!visible || event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  }

  $effect(() => () => {
    if (dismissTimer) clearTimeout(dismissTimer);
  });
</script>

<svelte:window onkeydowncapture={handleKeydown} />

{#if visible}
  {#key id}
  <div class="acquisition-layer" class:closing aria-live="polite">
    <span class="visually-hidden">Item acquired: {title}{quantityLabel ? `, ${quantityLabel}` : ''}</span>
    <div
      class="acquisition-dialog"
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${dialogId}-title`}
      aria-describedby={description ? `${dialogId}-description` : undefined}
      tabindex="-1"
    >
      <CardHandCard
        class="acquisition-card"
        label={`${eyebrow}: ${title}${quantityLabel ? `, ${quantityLabel}` : ''}`}
        selected
        interactive={false}
      >
        <div class="acquisition-art" data-art-kind={artKind} aria-hidden="true">
          {#if artKind === 'bottle'}
            <svg class="fallback-art" viewBox="0 0 180 190" focusable="false">
              <path d="M68 15h44v27l15 18v96c0 10-8 18-18 18H71c-10 0-18-8-18-18V60l15-18V15Z" />
              <path class="bottle-neck" d="M68 28h44M67 61h46" />
              <path class="bottle-liquid" d="M58 94h64v62c0 8-6 14-14 14H72c-8 0-14-6-14-14V94Z" />
              <path class="bottle-label" d="M65 105h50v34H65z" />
              <path class="bottle-label-mark" d="M82 125c6-11 12-11 18 0-6 8-12 8-18 0Z" />
              <path class="bottle-highlight" d="M76 67v24m0 48v12" />
            </svg>
          {:else if artKind === 'loaf'}
            <svg class="fallback-art loaf-art" viewBox="0 0 220 170" focusable="false">
              <path d="M24 116c0-35 27-68 64-76 40-9 89 11 105 47 7 15 6 36 0 50-7 15-22 23-42 23H68c-26 0-44-14-44-44Z" />
              <path class="loaf-score" d="M62 112c6-24 20-43 40-55m-10 64c6-24 20-43 40-55m-11 64c6-24 20-42 39-53" />
              <path class="loaf-glow" d="M40 115c5-29 24-52 50-62" />
            </svg>
          {:else}
            <span class="item-icon">{icon}</span>
          {/if}
          {#if imageSrc}<img src={imageSrc} alt={imageAlt} onerror={(event) => event.currentTarget.remove()} />{/if}
        </div>
        <div class="acquisition-copy">
          <p class="eyebrow">{eyebrow}</p>
          <h2 id={`${dialogId}-title`}>{title}</h2>
          {#if description}<p id={`${dialogId}-description`}>{description}</p>{/if}
          {#if details.length}<dl>{#each details as detail (detail.label)}<div><dt>{detail.label}</dt><dd>{detail.value}</dd></div>{/each}</dl>{/if}
        </div>
        <div class="acquisition-action">
          {#if quantityLabel}<span>{quantityLabel}</span>{/if}
          <button bind:this={continueButton} type="button" onclick={dismiss}>{dismissLabel}<span aria-hidden="true"> →</span></button>
        </div>
      </CardHandCard>
    </div>
  </div>
  {/key}
{/if}

<style>
  .acquisition-layer { position: fixed; z-index: 120; inset: 0; display: grid; place-items: center; padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left)); pointer-events: none; }
  .acquisition-dialog { width: min(24rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); overflow: auto; outline: none; pointer-events: auto; }
  :global(.card-hand-card.acquisition-card) { min-height: 0; padding: 1rem; border-color: #e6bf69; box-shadow: 0 0 0 1px #f8d98b55, 0 0 26px #e9b8534d, 0 18px 60px #050301b8, inset 0 0 22px #f8d98b14; }
  .acquisition-art { position: relative; display: grid; min-height: 9rem; place-items: center; overflow: hidden; border: 1px solid #bb944c55; border-radius: .55rem; background: radial-gradient(ellipse at center, #9b713641, #191108 72%); }
  .acquisition-art img { position: absolute; inset: .4rem; width: calc(100% - .8rem); height: calc(100% - .8rem); object-fit: contain; filter: drop-shadow(0 10px 10px #0009); }
  .item-icon { color: #f1d181; font-size: 5rem; text-shadow: 0 0 24px #f1d18166; }
  .fallback-art { width: 7.3rem; height: 8rem; overflow: visible; filter: drop-shadow(0 10px 9px #0009); fill: #634620; stroke: #e4c17b; stroke-linecap: round; stroke-linejoin: round; stroke-width: 3; }
  .bottle-neck { fill: none; stroke: #f0d99e; stroke-width: 4; }
  .bottle-liquid { fill: #a24b24; stroke: #f0cc72; }
  .bottle-label { fill: #ead7a4; stroke: #926d32; stroke-width: 2; }
  .bottle-label-mark { fill: #a24b24; stroke: none; }
  .bottle-highlight, .loaf-glow { fill: none; stroke: #fff0ba; stroke-width: 4; opacity: .7; }
  .loaf-art { width: 10rem; }
  .loaf-art path:first-child { fill: #a5682d; stroke: #f1cf7f; stroke-width: 4; }
  .loaf-score { fill: none; stroke: #603414; stroke-width: 9; stroke-linecap: round; }
  .loaf-glow { stroke: #ffdf95; stroke-width: 3; }
  .acquisition-copy { display: grid; align-content: start; gap: .45rem; padding: .85rem .25rem; text-align: center; }
  .acquisition-copy .eyebrow { margin: 0; color: #e6c77e; font-size: .67rem; letter-spacing: .12em; text-transform: uppercase; }
  .acquisition-copy h2 { margin: 0; color: #f5df9c; font-family: 'Cinzel', serif; font-size: clamp(1.25rem, 5vw, 1.65rem); line-height: 1.15; overflow-wrap: anywhere; }
  .acquisition-copy > p:not(.eyebrow) { margin: 0; color: #d7c7a5; font-size: .88rem; line-height: 1.45; }
  .acquisition-copy dl { display: flex; flex-wrap: wrap; justify-content: center; gap: .45rem 1rem; margin: .2rem 0 0; color: #d7c7a5; font-size: .76rem; }
  .acquisition-copy dl div { display: flex; gap: .3rem; }
  .acquisition-copy dt { color: #c2a86f; }
  .acquisition-copy dd { margin: 0; color: #f1db9e; }
  .acquisition-action { display: flex; align-items: center; justify-content: space-between; gap: .7rem; padding-top: .7rem; border-top: 1px solid #bd985255; }
  .acquisition-action > span { color: #ead49a; font-size: .78rem; }
  .acquisition-action button { min-height: 44px; padding: .55rem .8rem; border: 1px solid #dfbe72; border-radius: .45rem; color: #fff0c2; background: #493318; font: inherit; font-size: .8rem; cursor: pointer; }
  .acquisition-action button:hover { background: #5f431f; }
  .acquisition-action button:focus-visible { outline: 2px solid #fff0bd; outline-offset: 3px; }
  .closing .acquisition-dialog { animation: acquisition-dismiss 160ms ease-in both; }
  :global(.acquisition-layer:not(.closing)) .acquisition-dialog { animation: acquisition-arrive 340ms cubic-bezier(.2,.8,.2,1) both; }
  @keyframes acquisition-arrive { from { opacity: 0; transform: translateY(6px) scale(.86); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes acquisition-dismiss { to { opacity: 0; transform: translateY(4px) scale(.96); } }
  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  @media (prefers-reduced-motion: reduce) { :global(.acquisition-layer:not(.closing)) .acquisition-dialog, .closing .acquisition-dialog { animation: none; } }
</style>
