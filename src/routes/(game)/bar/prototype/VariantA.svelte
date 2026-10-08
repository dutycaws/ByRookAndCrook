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

<div class="variant-a">
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
        <section class="patron-float" aria-label="Talk and card hand for {model.selected.name}">
          <header class="patron-heading">
            <div>
              <p class="eyebrow">Beside the patron · mock</p>
              <h2>{model.selected.name}</h2>
              <p>{model.selected.title ?? model.selected.status}</p>
            </div>
            <span class="talk-mark" aria-hidden="true">✦</span>
          </header>

          <div class="compact-thread" aria-label="Recent conversation" aria-live="polite">
            {#if model.history.length}
              {#each model.history.slice(-3) as entry (entry.id)}
                <p class:service={entry.kind === 'service'}><strong>{entry.label ?? 'You'}</strong> {entry.text}</p>
              {/each}
            {:else}
              <p class="quiet">A new conversation will leave a note in the Journal.</p>
            {/if}
          </div>

          <div class="card-hand" data-prototype-cardrail role="group" aria-label="Intent and hospitality cards" onkeydown={railKeydown}>
            {#each model.cards as card (card.id)}
              <button
                type="button"
                class="mock-card {card.color}"
                class:selected={model.selectedCardId === card.id}
                aria-pressed={model.selectedCardId === card.id}
                onclick={() => model.oncard(card.id)}
              >
                <small>{card.kind === 'intent' ? 'Intent' : 'Hospitality'}</small>
                <strong>{card.title}</strong>
                <span>{card.detail}</span>
              </button>
            {/each}
          </div>

          <div class="selected-card-line" aria-live="polite">
            {#if model.selectedCard}
              Selected: <strong>{model.selectedCard.title}</strong>
            {:else}
              Choose a card, or write a note.
            {/if}
          </div>
          <label class="message-field">
            <span>Leave a note</span>
            <textarea value={model.draft} oninput={(event) => model.ondraft(event.currentTarget.value)} placeholder="What would you like to say?" rows="2"></textarea>
          </label>
          <div class="float-actions">
            <button class="send-button" type="button" onclick={model.onsend}>Send note</button>
            <button type="button" disabled={model.selectedCard?.kind !== 'hospitality'} onclick={model.onserve}>Preview serving</button>
          </div>
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
    <aside class="journal-float" aria-label="{model.selected.name}’s Journal">
      <header>
        <div><p class="eyebrow">A page from the Journal</p><h2>{model.selected.name}</h2></div>
        <button type="button" aria-label="Close Journal" onclick={model.onjournalclose}>×</button>
      </header>
      <p class="journal-intro">Notes from the conversations and hospitality shared in this prototype.</p>
      <div class="journal-entries" aria-live="polite">
        {#if model.history.length}
          {#each model.history as entry (entry.id)}
            <article class="journal-entry" class:service={entry.kind === 'service'}>
              <span>{entry.label ?? 'You'}</span><p>{entry.text}</p>
            </article>
          {/each}
        {:else}
          <p class="quiet">No notes yet. Talk or offer a card to begin this page.</p>
        {/if}
      </div>
      <button class="journal-return" type="button" onclick={model.onjournalclose}>Return to the conversation</button>
    </aside>
  {/if}

  {#if model.notice}
    <p class="notice" role="status">{model.notice}</p>
  {/if}
</div>

<style>
  .variant-a { position: relative; min-width: 0; color: #eadfc4; }
  .variant-a :global(.scene-interaction) { right: auto; bottom: 4.5rem; left: .9rem; width: min(23rem, calc(100% - 1.8rem)); max-height: min(53vh, calc(100dvh - 15rem), 24rem); padding: .65rem .75rem; }
  .patron-float { display: grid; gap: .55rem; }
  .patron-heading { display: flex; align-items: start; justify-content: space-between; gap: .75rem; padding-bottom: .4rem; border-bottom: 1px solid rgb(218 192 133 / .23); }
  .eyebrow { margin: 0 0 .18rem; color: #d4b76f; font: 700 .63rem 'Cinzel', Georgia, serif; letter-spacing: .09em; text-transform: uppercase; }
  .patron-heading h2, .journal-float h2 { margin: 0; color: #f0d27a; font: 600 1.15rem 'Cinzel', Georgia, serif; }
  .patron-heading p:last-child { margin: .2rem 0 0; color: #c7b994; font-size: .8rem; }
  .talk-mark { color: #e6c56f; font-size: 1.4rem; }
  .compact-thread { max-height: 3.4rem; overflow: auto; }
  .compact-thread p { margin: .2rem 0; font-size: .76rem; line-height: 1.35; }
  .compact-thread p strong { color: #f0d27a; }
  .compact-thread p.service { color: #c4d3a0; }
  .quiet { margin: .3rem 0; color: #beaf8e; font-size: .8rem; line-height: 1.45; }
  .card-hand { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .4rem; }
  .mock-card { display: grid; min-height: 3.45rem; align-content: center; gap: .15rem; padding: .35rem .4rem; border: 1px solid #715a31; border-radius: .4rem; color: #f2e6ca; background: linear-gradient(145deg, #3c2b15, #171008); text-align: left; cursor: pointer; }
  .mock-card small { color: #d9c27e; font-size: .61rem; text-transform: uppercase; letter-spacing: .06em; }
  .mock-card strong { font: 600 .78rem 'Cinzel', Georgia, serif; }
  .mock-card span { display: none; }
  .mock-card.sage { background: linear-gradient(145deg, #263423, #12180f); }
  .mock-card.copper { background: linear-gradient(145deg, #49291c, #1d100b); }
  .mock-card.plum { background: linear-gradient(145deg, #392536, #171019); }
  .mock-card.selected, .mock-card:focus-visible { outline: 2px solid #f0d27a; outline-offset: 1px; border-color: #f0d27a; }
  .selected-card-line { min-height: 1rem; color: #d4c69f; font-size: .73rem; }
  .selected-card-line strong { color: #f0d27a; }
  .message-field { display: grid; gap: .25rem; color: #dbcda9; font-size: .73rem; }
  .message-field textarea { width: 100%; min-height: 2.5rem; resize: vertical; padding: .3rem .45rem; border: 1px solid #725b32; border-radius: .3rem; color: #f4ebd4; background: #120d08; font: inherit; }
  .message-field textarea:focus-visible { outline: 2px solid #f0d27a; outline-offset: 1px; }
  .float-actions { display: flex; flex-wrap: wrap; gap: .4rem; }
  .float-actions button, .journal-opener, .journal-return, .journal-float header button { min-height: 2.2rem; padding: .4rem .65rem; border: 1px solid #806631; border-radius: .3rem; color: #efe2bf; background: #2b1f0d; font: inherit; font-size: .75rem; cursor: pointer; }
  .float-actions .send-button { color: #211607; background: #dfbd65; font-weight: 700; }
  .float-actions button:disabled { opacity: .5; cursor: not-allowed; }
  .journal-opener { position: absolute; z-index: 22; top: 3.1rem; right: 1rem; min-height: 2rem; background: rgb(24 17 9 / .94); }
  .journal-opener:focus-visible, .journal-return:focus-visible, .float-actions button:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  .journal-float { position: absolute; z-index: 24; top: 5.7rem; right: .85rem; display: grid; width: min(24rem, calc(100% - 1.7rem)); max-height: min(55vh, calc(100dvh - 15rem), 25rem); padding: .85rem; overflow: auto; border: 1px solid #b99658; border-radius: .75rem; background: rgb(22 16 9 / .96); box-shadow: 0 14px 40px rgb(0 0 0 / .65); }
  .journal-float header { display: flex; align-items: start; justify-content: space-between; gap: .6rem; }
  .journal-float header button { min-width: 2rem; padding: 0; font-size: 1.2rem; }
  .journal-intro { margin: .7rem 0; color: #c8ba99; font-size: .8rem; line-height: 1.45; }
  .journal-entries { display: grid; gap: .55rem; min-height: 0; overflow: auto; padding-right: .2rem; }
  .journal-entry { padding: .55rem .65rem; border-left: 2px solid #c3a057; background: rgb(255 255 255 / .04); }
  .journal-entry.service { border-color: #90a56f; }
  .journal-entry span { color: #dfc16d; font: 600 .7rem 'Cinzel', Georgia, serif; }
  .journal-entry p { margin: .2rem 0 0; color: #e5dbc3; font-size: .82rem; line-height: 1.45; }
  .journal-return { justify-self: start; margin-top: .8rem; }
  .notice { margin: .4rem 0 0; color: #d8c589; font-size: .78rem; }
  .notice { position: absolute; z-index: 18; top: 5.7rem; left: 1rem; max-width: min(21rem, calc(100% - 2rem)); padding: .3rem .5rem; border-radius: .25rem; background: rgb(18 13 7 / .88); }
  @media (max-width: 1000px) {
    .variant-a :global(.scene-interaction) { position: static; width: auto; max-height: none; margin-top: .5rem; overflow: visible; }
    .journal-opener { position: static; display: block; margin: .5rem 0 .5rem auto; }
    .journal-float { position: relative; top: auto; right: auto; width: auto; max-height: 60vh; margin-top: .5rem; }
    .notice { position: static; max-width: none; margin: .4rem 0 0; padding: 0; background: transparent; }
  }
  @media (max-width: 520px) {
    .card-hand { gap: .3rem; }
    .mock-card { min-height: 4.5rem; padding: .4rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .variant-a :global(.scene-composition), .mock-card, .float-actions button { transition: none; }
  }
</style>
