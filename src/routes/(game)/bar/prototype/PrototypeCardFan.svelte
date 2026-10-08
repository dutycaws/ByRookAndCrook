<script lang="ts">
  import { tick } from 'svelte';
  import type { MockCard, BarPrototypeVariant } from './types';

  let {
    cards,
    selectedCardId,
    variant,
    oncard
  }: {
    cards: readonly MockCard[];
    selectedCardId: string | null;
    variant: Extract<BarPrototypeVariant, 'A' | 'B' | 'C'>;
    oncard: (id: string) => void;
  } = $props();

  function railKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const rail = event.currentTarget as HTMLElement;
    const buttons = [...rail.querySelectorAll<HTMLButtonElement>('button')];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || buttons.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    buttons[(index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  }

  async function selectCard(id: string) {
    oncard(id);
    await tick();
    document.querySelector<HTMLTextAreaElement>('[data-prototype-conversation-input]')
      ?.focus({ preventScroll: true });
  }
</script>

<div class="hand-space {variant}" role="group" aria-label="Your hand">
  <div class="card-fan" data-prototype-cardrail role="group" tabindex="-1" aria-label="Cards for {variant === 'A' ? 'this patron' : variant === 'B' ? 'this conversation' : 'the conversation'}" onkeydown={railKeydown}>
    {#each cards as card, index (card.id)}
      <button
        type="button"
        class="fan-card {card.color}"
        class:selected={selectedCardId === card.id}
        aria-pressed={selectedCardId === card.id}
        data-prototype-card-id={card.id}
        style={`--card-index:${index};--card-count:${cards.length};--fan-tilt:${(index - (cards.length - 1) / 2) * 12}deg;--mobile-tilt:${(index - (cards.length - 1) / 2) * 8}deg;--ribbon-tilt:${(index - (cards.length - 1) / 2) * 5}deg;--fan-lift:${Math.abs(index - (cards.length - 1) / 2) * 8}px;--ribbon-lift:${Math.abs(index - (cards.length - 1) / 2) * 3}px`}
        onclick={() => selectCard(card.id)}
      >
        <span class="card-type">{card.kind === 'intent' ? 'Intent' : 'Hospitality'}</span>
        <strong>{card.title}</strong>
        <span class="card-detail">{card.detail}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .hand-space { position: relative; width: fit-content; max-width: 100%; color: #f1e4c5; pointer-events: auto; }
  .card-fan { display: flex; align-items: end; min-height: 9.25rem; padding: .35rem .75rem .1rem; }
  .fan-card { position: relative; z-index: calc(10 + var(--card-index)); display: grid; width: clamp(6.1rem, 10.4vw, 8.25rem); height: 8rem; flex: 0 1 clamp(6.1rem, 10.4vw, 8.25rem); align-content: start; gap: .28rem; margin-right: -2.15rem; padding: .62rem .54rem; border: 1px solid #b3934d; border-radius: .55rem .55rem .7rem .7rem; color: #f2e7cb; background: linear-gradient(155deg, #65502a, #281b0c 68%); box-shadow: 0 6px 15px rgb(0 0 0 / .5), inset 0 0 0 2px rgb(242 220 161 / .11); text-align: left; transform: translateY(var(--fan-lift)) rotate(var(--fan-tilt)); transform-origin: 50% 105%; transition: transform 160ms ease, translate 160ms ease, border-color 160ms ease, box-shadow 160ms ease; cursor: pointer; }
  .fan-card:last-child { margin-right: 0; }
  .fan-card.sage { background: linear-gradient(155deg, #48613d, #192218 68%); }
  .fan-card.copper { background: linear-gradient(155deg, #925b37, #2d160c 68%); }
  .fan-card.plum { background: linear-gradient(155deg, #6d506b, #241625 68%); }
  .fan-card:hover { translate: 0 -8px; }
  .fan-card.selected { z-index: 30; border-color: #ffe08a; box-shadow: 0 0 0 2px rgb(246 211 118 / .4), 0 12px 22px rgb(0 0 0 / .58), inset 0 0 0 2px rgb(242 220 161 / .18); translate: 0 -13px; }
  .fan-card:focus-visible { outline: 2px solid #ffe08a; outline-offset: 3px; }
  .card-type { color: #e9cc7a; font-size: .57rem; letter-spacing: .08em; text-transform: uppercase; }
  .fan-card strong { font: 600 .75rem/1.15 'Cinzel', Georgia, serif; }
  .card-detail { color: #d7c8a7; font-size: .62rem; line-height: 1.25; }

  /* A: loose fan tucked into the lower-left corner beside the patron. */
  .hand-space.A .card-fan { justify-content: start; }
  .hand-space.A .fan-card { width: clamp(5.8rem, 9.7vw, 7.5rem); flex-basis: clamp(5.8rem, 9.7vw, 7.5rem); }

  /* B: a wider, centered hand with cards angled toward the player. */
  .hand-space.B { margin-inline: auto; }
  .hand-space.B .card-fan { justify-content: center; }
  .hand-space.B .fan-card { height: 8.45rem; }

  /* C: the same hand opened into a shallow ribbon. */
  .hand-space.C { width: 100%; }
  .hand-space.C .card-fan { min-height: 6.3rem; justify-content: center; padding-top: .05rem; }
  .hand-space.C .fan-card { width: clamp(7rem, 13vw, 10rem); height: 5.05rem; flex-basis: clamp(7rem, 13vw, 10rem); align-content: center; transform: translateY(var(--ribbon-lift)) rotate(var(--ribbon-tilt)); }
  .hand-space.C .card-detail { display: none; }
  .hand-space.C .fan-card.selected { translate: 0 -4px; }

  @media (max-width: 620px) {
    .hand-space, .hand-space.A, .hand-space.B, .hand-space.C { width: 100%; }
    .card-fan, .hand-space.A .card-fan, .hand-space.B .card-fan, .hand-space.C .card-fan { width: 100%; min-height: 8.45rem; justify-content: center; padding: .3rem .2rem .25rem; }
    .fan-card, .hand-space.A .fan-card, .hand-space.B .fan-card, .hand-space.C .fan-card { width: clamp(5.2rem, 24vw, 6rem); height: 7.35rem; flex-basis: clamp(5.2rem, 24vw, 6rem); margin-right: -1.5rem; padding: .52rem .42rem; transform: translateY(calc(var(--fan-lift) * .65)) rotate(var(--mobile-tilt)); }
    .fan-card:last-child { margin-right: 0; }
    .fan-card strong { font-size: .68rem; }
    .card-detail { font-size: .56rem; }
    .hand-space.C .fan-card { transform: translateY(var(--ribbon-lift)) rotate(var(--ribbon-tilt)); }
  }
  @media (prefers-reduced-motion: reduce) {
    .fan-card { transition: none; }
  }
</style>
