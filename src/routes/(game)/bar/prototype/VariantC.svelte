<script lang="ts">
  import TavernScene from '$lib/components/tavern/TavernScene.svelte';
  import type { BarPrototypeModel } from './types';

  let model: BarPrototypeModel = $props();

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

<div class="variant-c">
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
        <section class="thread-dock" aria-label="Conversation with {model.selected.name}">
          <header class="thread-header">
            <div><p class="eyebrow">Conversation thread · mock</p><h2>{model.selected.name}</h2></div>
            <span class="thread-state">{model.history.length} notes</span>
          </header>

          <div class="thread-messages" aria-live="polite">
            {#if model.history.length}
              {#each model.history as entry (entry.id)}
                <article class="thread-message" class:service={entry.kind === 'service'} class:from-player={entry.kind === 'player'}>
                  <span>{entry.label ?? 'You'}</span><p>{entry.text}</p>
                </article>
              {/each}
            {:else}
              <p class="thread-empty">The thread is ready. Choose a card below to start.</p>
            {/if}
          </div>

          <div class="inline-card-rail" data-prototype-cardrail role="group" aria-label="Cards for this conversation" onkeydown={railKeydown}>
            {#each model.cards as card (card.id)}
              <button
                type="button"
                class="inline-card {card.color}"
                class:selected={model.selectedCardId === card.id}
                aria-pressed={model.selectedCardId === card.id}
                onclick={() => model.oncard(card.id)}
              >
                <span>{card.kind === 'intent' ? 'Intent' : 'Hospitality'}</span><strong>{card.title}</strong>
              </button>
            {/each}
          </div>

          <div class="composer-dock">
            <label>
              <span>Write to {model.selected.name}</span>
              <textarea value={model.draft} oninput={(event) => model.ondraft(event.currentTarget.value)} placeholder="Add a thought to the thread…" rows="2"></textarea>
            </label>
            <div class="composer-actions">
              <button type="button" class="send" onclick={model.onsend}>Send reply</button>
              <button type="button" disabled={model.selectedCard?.kind !== 'hospitality'} onclick={model.onserve}>Serve preview</button>
            </div>
          </div>
          {#if model.notice}<p class="thread-notice" role="status">{model.notice}</p>{/if}
        </section>
      {/if}
    {/snippet}
  </TavernScene>

  {#if model.selected}
    <button class="journal-opener" type="button" data-prototype-opener="journal" aria-expanded={model.mode === 'journal'} onclick={model.onjournal}>
      Journal <span aria-hidden="true">↗</span>
    </button>
  {/if}

  {#if model.mode === 'journal' && model.selected}
    <section class="reading-thread" aria-label="Expanded Journal thread for {model.selected.name}">
      <header>
        <div><p class="eyebrow">Reading mode · {model.selected.name}</p><h2>Journal thread</h2></div>
        <button type="button" aria-label="Close Journal" onclick={model.onjournalclose}>Close</button>
      </header>
      {#if model.history.length}
        <div class="reading-messages" aria-live="polite">
          {#each model.history as entry (entry.id)}
            <article class:service={entry.kind === 'service'} class:from-player={entry.kind === 'player'}>
              <span>{entry.label ?? 'You'}</span><p>{entry.text}</p>
            </article>
          {/each}
        </div>
      {:else}
        <div class="reading-empty">
          <span aria-hidden="true">✦</span><p>No entries yet. Return to Talk and begin a conversation.</p>
        </div>
      {/if}
      <button type="button" class="reading-return" onclick={model.onjournalclose}>Back to the thread</button>
    </section>
  {/if}
</div>

<style>
  .variant-c { position: relative; min-width: 0; color: #e9dfc8; }
  .variant-c :global(.scene-interaction) { right: .9rem; bottom: 4.4rem; left: auto; width: min(42rem, calc(100% - 1.8rem)); max-height: min(44vh, calc(100dvh - 14rem), 23rem); padding: .6rem .7rem; overflow: auto; }
  .thread-dock { display: grid; gap: .5rem; }
  .thread-header { display: flex; align-items: center; justify-content: space-between; gap: .7rem; }
  .eyebrow { margin: 0 0 .12rem; color: #d6b96e; font: 700 .64rem 'Cinzel', Georgia, serif; letter-spacing: .09em; text-transform: uppercase; }
  .thread-header h2, .reading-thread h2 { margin: 0; color: #f0d27a; font: 600 1.1rem 'Cinzel', Georgia, serif; }
  .thread-state { padding: .28rem .5rem; border: 1px solid rgb(201 168 96 / .4); border-radius: 999px; color: #d2c29d; font-size: .68rem; }
  .thread-messages { display: grid; max-height: 6rem; gap: .35rem; overflow: auto; padding: .1rem .1rem .25rem; }
  .thread-message { max-width: 88%; padding: .5rem .65rem; border-left: 2px solid #c4a057; border-radius: 0 .45rem .45rem 0; background: rgb(255 255 255 / .045); }
  .thread-message.from-player { justify-self: end; border-right: 2px solid #c4a057; border-left: 0; border-radius: .45rem 0 .45rem .45rem; background: rgb(188 146 58 / .12); }
  .thread-message.service { border-color: #91a66f; }
  .thread-message span { color: #dfc16d; font: 600 .67rem 'Cinzel', Georgia, serif; }
  .thread-message p { margin: .18rem 0 0; color: #e3dac5; font-size: .82rem; line-height: 1.45; }
  .thread-empty { margin: 0; color: #c4b594; font-size: .8rem; }
  .inline-card-rail { display: flex; gap: .45rem; overflow-x: auto; padding: .2rem .1rem .4rem; }
  .inline-card { display: grid; min-width: 8.8rem; min-height: 3.2rem; align-content: center; gap: .2rem; padding: .35rem .5rem; border: 1px solid #725b30; border-radius: .5rem; color: #efe4ca; background: linear-gradient(135deg, #4b3619, #1b1309); text-align: left; cursor: pointer; }
  .inline-card.sage { background: linear-gradient(135deg, #37462d, #151b10); }
  .inline-card.copper { background: linear-gradient(135deg, #6a4227, #21130b); }
  .inline-card.plum { background: linear-gradient(135deg, #523a51, #1b121f); }
  .inline-card span { color: #dcc37e; font-size: .6rem; text-transform: uppercase; letter-spacing: .08em; }
  .inline-card strong { font: 600 .75rem 'Cinzel', Georgia, serif; }
  .inline-card.selected { border-color: #f0d27a; box-shadow: 0 0 0 2px rgb(240 210 122 / .3); }
  .inline-card:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  .composer-dock { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: .55rem; padding-top: .55rem; border-top: 1px solid rgb(213 187 125 / .25); }
  .composer-dock label { display: grid; gap: .22rem; color: #d8c9a7; font-size: .72rem; }
  .composer-dock textarea { width: 100%; min-height: 2.5rem; resize: vertical; padding: .35rem .5rem; border: 1px solid #705a34; border-radius: .35rem; color: #f2ead8; background: #110c07; font: inherit; font-size: .8rem; line-height: 1.35; }
  .composer-dock textarea:focus-visible { outline: 2px solid #f0d27a; outline-offset: 1px; }
  .composer-actions { display: flex; flex-wrap: wrap; gap: .4rem; }
  .composer-actions button, .journal-opener, .reading-thread header button, .reading-return { min-height: 2.3rem; padding: .4rem .65rem; border: 1px solid #806631; border-radius: .35rem; color: #efe2bf; background: #2b1f0d; font: inherit; font-size: .74rem; cursor: pointer; }
  .composer-actions .send { color: #211607; background: #dfbd65; font-weight: 700; }
  .composer-actions button:disabled { opacity: .48; cursor: not-allowed; }
  .thread-notice { margin: 0; color: #d8c589; font-size: .72rem; }
  .journal-opener { position: absolute; z-index: 22; top: 3.1rem; right: 1rem; min-height: 2rem; background: rgb(24 17 9 / .94); }
  .journal-opener:focus-visible, .composer-actions button:focus-visible, .reading-thread button:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  .reading-thread { position: absolute; z-index: 24; top: 5.7rem; right: .9rem; display: grid; width: min(42rem, calc(100% - 1.8rem)); max-height: min(54vh, calc(100dvh - 15rem), 27rem); gap: .55rem; padding: .75rem; overflow: auto; border: 1px solid #8a6d3c; border-radius: .75rem; background: linear-gradient(155deg, rgb(25 20 13 / .98), rgb(16 12 8 / .98)); box-shadow: 0 8px 25px rgb(0 0 0 / .3); }
  .reading-thread > header { display: flex; align-items: center; justify-content: space-between; gap: .6rem; padding-bottom: .5rem; border-bottom: 1px solid rgb(204 177 117 / .26); }
  .reading-messages { display: grid; gap: .5rem; }
  .reading-messages article { max-width: min(55rem, 94%); padding: .5rem .65rem; border-left: 2px solid #bd9950; background: rgb(255 255 255 / .035); }
  .reading-messages article.from-player { justify-self: end; border-right: 2px solid #bd9950; border-left: 0; }
  .reading-messages article.service { border-color: #91a66f; }
  .reading-messages span { color: #e0c171; font: 600 .7rem 'Cinzel', Georgia, serif; }
  .reading-messages p { margin: .25rem 0 0; line-height: 1.55; }
  .reading-empty { display: flex; align-items: center; gap: .8rem; padding: .8rem; color: #c6b590; background: rgb(255 255 255 / .025); }
  .reading-empty span { color: #d8bc71; font-size: 1.4rem; }
  .reading-empty p { margin: 0; }
  .reading-return { justify-self: start; }
  @media (max-width: 1000px) {
    .variant-c :global(.scene-interaction) { position: static; width: auto; max-height: none; margin-top: .55rem; overflow: visible; }
    .journal-opener { position: static; display: block; margin: .5rem 0 .5rem auto; }
    .reading-thread { position: relative; top: auto; right: auto; width: auto; max-height: 60vh; margin-top: .55rem; }
  }
  @media (max-width: 620px) {
    .composer-dock { grid-template-columns: 1fr; }
    .composer-actions { justify-content: stretch; }
    .composer-actions button { flex: 1; }
    .thread-message, .reading-messages article { max-width: 96%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .inline-card { transition: none; }
  }
</style>
