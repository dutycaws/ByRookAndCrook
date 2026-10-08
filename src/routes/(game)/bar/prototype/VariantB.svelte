<script lang="ts">
  import TavernScene from '$lib/components/tavern/TavernScene.svelte';
  import type { BarPrototypeModel } from './types';

  let model: BarPrototypeModel = $props();
  let latestPatronReply = $derived([...model.history].reverse().find((entry) => entry.kind === 'patron') ?? null);

  function railKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const rail = event.currentTarget as HTMLElement;
    const cards = [...rail.querySelectorAll<HTMLButtonElement>('button')];
    const index = cards.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || cards.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    cards[(index + (event.key === 'ArrowLeft' ? -1 : 1) + cards.length) % cards.length]?.focus();
  }
</script>

<div class="variant-b">
  <TavernScene
    patrons={model.patrons}
    selected={model.selected}
    focusedKey={model.focusedKey}
    trinkets={model.trinkets}
    day={model.day}
    gold={model.gold}
    archiveHref={model.archiveHref}
    disabled={false}
    closeDisabled={false}
    cardSelected={Boolean(model.selectedCard)}
    composerOpen={model.mode === 'talk'}
    deckOpen={model.mode === 'cards'}
    onselect={model.onselect}
    onfocus={model.onfocus}
    onback={model.onback}
    ontalk={model.ontalk}
    ondeck={model.ondeck}
    onclose={model.onclose}
    onkeepsake={model.onkeepsake}
  >
    {#snippet interaction()}
      {#if model.selected && (model.mode === 'talk' || model.mode === 'cards')}
        <section class="countertop" aria-label="Countertop cards and composer for {model.selected.name}">
          <header class="countertop-heading">
            <div>
              <p class="eyebrow">On the counter · mock cards</p>
              <h2>{model.selected.name}</h2>
            </div>
            <span class="counter-context">Choose a card, then talk or serve</span>
          </header>

          <div class="card-spread" data-prototype-cardrail role="group" aria-label="Card spread" onkeydown={railKeydown}>
            {#each model.cards as card (card.id)}
              <button
                type="button"
                class="spread-card {card.color}"
                class:selected={model.selectedCardId === card.id}
                aria-pressed={model.selectedCardId === card.id}
                onclick={() => model.oncard(card.id)}
              >
                <span class="card-type">{card.kind === 'intent' ? 'Intent' : 'Hospitality'}</span>
                <strong>{card.title}</strong>
                <span class="card-description">{card.detail}</span>
                {#if model.selectedCardId === card.id}<span class="selected-stamp">READY</span>{/if}
              </button>
            {/each}
          </div>

          <div class="counter-dock">
            <div class="dock-selected">
              <span class="dock-label">Selected card</span>
              <strong>{model.selectedCard?.title ?? 'No card selected'}</strong>
              <span>{model.selectedCard?.kind === 'hospitality' ? 'Serving preview is available.' : model.selectedCard?.kind === 'intent' ? 'Use this intent in a note.' : 'Choose any sample card.'}</span>
            </div>
            <label class="counter-composer">
              <span class="dock-label">Message to {model.selected.name}</span>
              <textarea value={model.draft} oninput={(event) => model.ondraft(event.currentTarget.value)} placeholder="Write a short note…" rows="2"></textarea>
            </label>
            <div class="counter-actions">
              <button type="button" class="send" onclick={model.onsend}>Send</button>
              <button type="button" disabled={model.selectedCard?.kind !== 'hospitality'} onclick={model.onserve}>Serve preview</button>
            </div>
          </div>

          {#if model.notice}<p class="counter-notice" role="status">{model.notice}</p>{/if}
        </section>
      {/if}
    {/snippet}
  </TavernScene>

  {#if model.selected && (model.mode === 'talk' || model.mode === 'cards') && latestPatronReply}
    <aside class="near-patron-reply" aria-live="polite">
      <span>{model.selected.name}</span>
      <p>{latestPatronReply.text}</p>
    </aside>
  {/if}

  {#if model.selected}
    <button class="journal-opener" type="button" data-prototype-opener="journal" aria-expanded={model.mode === 'journal'} onclick={model.onjournal}>
      Journal <span aria-hidden="true">↗</span>
    </button>
  {/if}

  {#if model.mode === 'journal' && model.selected}
    <aside class="paper-journal" aria-label="Journal for {model.selected.name}">
      <header>
        <div><span class="paper-kicker">Tavern notes · {model.selected.name}</span><h2>Journal</h2></div>
        <button type="button" aria-label="Close Journal" onclick={model.onjournalclose}>×</button>
      </header>
      <p class="paper-lede">A record of what was said and shared at the counter.</p>
      {#if model.history.length}
        <div class="paper-entries" aria-live="polite">
          {#each model.history as entry (entry.id)}
            <article class:service={entry.kind === 'service'}>
              <time>{entry.kind === 'service' ? 'Hospitality preview' : entry.label ?? 'You'}</time>
              <p>{entry.text}</p>
            </article>
          {/each}
        </div>
      {:else}
        <p class="paper-empty">The page is blank for now. Start with a card or a note.</p>
      {/if}
      <button type="button" class="paper-close" onclick={model.onjournalclose}>Return to the counter</button>
    </aside>
  {/if}
</div>

<style>
  .variant-b { position: relative; min-width: 0; color: #eee2c4; }
  .variant-b :global(.scene-interaction) { right: .8rem; bottom: 4.35rem; left: .8rem; width: auto; max-height: min(42vh, calc(100dvh - 15rem), 24rem); padding: .55rem .7rem; overflow: auto; }
  .countertop { display: grid; gap: .45rem; }
  .countertop-heading { display: flex; align-items: end; justify-content: space-between; gap: .75rem; }
  .eyebrow, .dock-label { margin: 0; color: #dabf78; font: 700 .64rem 'Cinzel', Georgia, serif; letter-spacing: .08em; text-transform: uppercase; }
  .countertop-heading h2 { margin: .08rem 0 0; color: #f0d27a; font: 600 1rem 'Cinzel', Georgia, serif; }
  .counter-context { color: #cdbd99; font-size: .73rem; }
  .card-spread { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .45rem; }
  .spread-card { position: relative; display: grid; min-height: 4.4rem; align-content: start; gap: .25rem; padding: .45rem; border: 1px solid #725c35; border-radius: .35rem .35rem .55rem .55rem; color: #f1e5c8; background: linear-gradient(160deg, #51401f, #20160a 72%); text-align: left; cursor: pointer; box-shadow: inset 0 0 0 2px rgb(239 213 151 / .08), 0 4px 8px rgb(0 0 0 / .35); }
  .spread-card.sage { background: linear-gradient(160deg, #38482f, #14190f 72%); }
  .spread-card.copper { background: linear-gradient(160deg, #70452c, #26130b 72%); }
  .spread-card.plum { background: linear-gradient(160deg, #57405a, #1c1220 72%); }
  .spread-card:hover { translate: 0 -2px; }
  .spread-card.selected { border-color: #f1cf78; box-shadow: inset 0 0 0 2px rgb(241 207 120 / .3), 0 0 0 2px rgb(241 207 120 / .26); }
  .spread-card:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  .card-type { color: #dfc983; font-size: .61rem; letter-spacing: .08em; text-transform: uppercase; }
  .spread-card strong { font: 600 .83rem 'Cinzel', Georgia, serif; }
  .card-description { color: #cfbf9c; font-size: .7rem; line-height: 1.3; }
  .selected-stamp { position: absolute; top: .4rem; right: .35rem; padding: .12rem .24rem; border: 1px solid #e6c56f; color: #f3d67e; font-size: .5rem; letter-spacing: .08em; }
  .counter-dock { display: grid; grid-template-columns: minmax(9rem, .8fr) minmax(12rem, 1.5fr) auto; align-items: end; gap: .55rem; padding-top: .45rem; border-top: 1px solid rgb(225 200 143 / .28); }
  .dock-selected { display: grid; gap: .14rem; min-width: 0; }
  .dock-selected strong { color: #f2dc9c; font: 600 .83rem 'Cinzel', Georgia, serif; }
  .dock-selected span:last-child { color: #c7b994; font-size: .68rem; }
  .counter-composer { display: grid; gap: .2rem; }
  .counter-composer textarea { width: 100%; min-height: 3rem; resize: vertical; padding: .45rem .55rem; border: 1px solid #6f5830; border-radius: .25rem; color: #f3e9d0; background: #110c07; font: inherit; font-size: .79rem; line-height: 1.4; }
  .counter-composer textarea:focus-visible { outline: 2px solid #f0d27a; outline-offset: 1px; }
  .counter-actions { display: flex; flex-wrap: wrap; gap: .35rem; }
  .counter-actions button, .journal-opener, .paper-journal button { min-height: 2.2rem; padding: .4rem .6rem; border: 1px solid #806631; border-radius: .3rem; color: #f0e4c5; background: #2a1c0a; font: inherit; font-size: .73rem; cursor: pointer; }
  .counter-actions button.send { color: #211607; background: #dfbd65; font-weight: 700; }
  .counter-actions button:disabled { opacity: .48; cursor: not-allowed; }
  .counter-notice { margin: 0; color: #d8c589; font-size: .72rem; }
  .journal-opener { position: absolute; z-index: 22; top: 3.1rem; right: 1rem; min-height: 2rem; background: rgb(24 17 9 / .94); }
  .journal-opener:focus-visible, .counter-actions button:focus-visible, .paper-journal button:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  .near-patron-reply { position: absolute; z-index: 21; top: 3.1rem; left: 1rem; width: min(20rem, calc(100% - 2rem)); padding: .5rem .65rem; border: 1px solid rgb(190 157 90 / .68); border-radius: .65rem .65rem .65rem .15rem; color: #eee3c8; background: rgb(18 13 7 / .92); box-shadow: 0 5px 18px rgb(0 0 0 / .35); }
  .near-patron-reply span { color: #e3c975; font: 600 .68rem 'Cinzel', Georgia, serif; }
  .near-patron-reply p { margin: .2rem 0 0; font-size: .76rem; line-height: 1.4; }
  .paper-journal { position: absolute; z-index: 24; top: 4.7rem; left: 50%; display: grid; width: min(49rem, calc(100% - 2rem)); max-height: min(55vh, calc(100dvh - 15rem), 27rem); padding: clamp(.85rem, 2vw, 1.35rem); overflow: auto; border: 1px solid #d0b777; color: #302517; background: linear-gradient(165deg, rgb(242 231 200 / .97), rgb(206 187 143 / .96)); box-shadow: 0 16px 45px rgb(0 0 0 / .58), inset 0 0 25px rgb(124 87 39 / .12); transform: translateX(-50%) rotate(-.3deg); }
  .paper-journal header { display: flex; align-items: start; justify-content: space-between; gap: .8rem; padding-bottom: .55rem; border-bottom: 1px solid rgb(75 56 31 / .32); }
  .paper-kicker { color: #775d32; font: 700 .66rem 'Cinzel', Georgia, serif; letter-spacing: .1em; text-transform: uppercase; }
  .paper-journal h2 { margin: .2rem 0 0; font: 600 1.7rem 'Cinzel', Georgia, serif; }
  .paper-journal header button { min-width: 2rem; padding: 0; color: #47331b; background: transparent; font-size: 1.25rem; }
  .paper-lede { margin: .8rem 0; color: #5a4528; font-family: Georgia, serif; font-style: italic; }
  .paper-entries { display: grid; gap: .65rem; }
  .paper-entries article { padding: .5rem 0 .55rem .75rem; border-left: 2px solid #9d7439; }
  .paper-entries article.service { border-color: #6c7c4c; }
  .paper-entries time { color: #795e31; font: 700 .67rem 'Cinzel', Georgia, serif; text-transform: uppercase; }
  .paper-entries p { margin: .2rem 0 0; font: .91rem/1.5 Georgia, serif; }
  .paper-empty { color: #5d482c; font-family: Georgia, serif; }
  .paper-close { justify-self: start; margin-top: 1rem; color: #f2e7cc !important; }
  @media (max-width: 1000px) {
    .variant-b :global(.scene-interaction) { position: static; width: auto; max-height: none; margin-top: .5rem; overflow: visible; }
    .journal-opener { position: static; display: block; margin: .5rem 0 .5rem auto; }
    .near-patron-reply { position: static; width: auto; margin-top: .5rem; }
    .paper-journal { position: relative; top: auto; left: auto; width: auto; max-height: 60vh; margin-top: .55rem; transform: none; }
  }
  @media (max-width: 650px) {
    .countertop-heading { align-items: start; flex-direction: column; gap: .2rem; }
    .card-spread { grid-template-columns: repeat(2, minmax(0, 1fr)); max-height: 15rem; overflow: auto; }
    .spread-card { min-height: 5rem; }
    .counter-dock { grid-template-columns: 1fr; align-items: stretch; }
    .counter-actions { justify-content: stretch; }
    .counter-actions button { flex: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .spread-card { transition: none; }
  }
</style>
