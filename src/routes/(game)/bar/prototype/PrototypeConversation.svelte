<script lang="ts">
  import { tick } from 'svelte';
  import type { BarPrototypeModel } from './types';
  let {
    model,
    presentation = 'standard',
    treatment = 'B'
  }: {
    model: BarPrototypeModel;
    presentation?: 'standard' | 'player-hand';
    treatment?: 'B' | 'E' | 'F';
  } = $props();
  let latestEntries = $derived(model.history.slice(presentation === 'standard' ? -3 : -5));

  async function closeConversation() {
    model.onchatclose();
    await tick();
    if (model.selectedCardId) {
      document.querySelector<HTMLButtonElement>('[data-prototype-card-id="' + model.selectedCardId + '"]')
        ?.focus({ preventScroll: true });
    }
  }
</script>

<section class="conversation-card" class:player-hand={presentation === 'player-hand'} data-treatment={treatment} aria-label="Conversation with {model.selected?.name}">
  {#if presentation === 'player-hand' && model.selectedCard}
    <header class="player-hand-header">
      <span class="card-thumb {model.selectedCard.color}" aria-hidden="true">{model.selectedCard.kind === 'hospitality' ? '♨' : '✦'}</span>
      <div class="card-identity">
        <p class="conversation-kicker">{model.selectedCard.kind === 'hospitality' ? 'Hospitality' : 'Intent'} card</p>
        <h2>{model.selectedCard.title}</h2>
        <span class="card-detail">{model.selectedCard.detail}</span>
      </div>
      <span class="recipient-name">{model.selected?.name}</span>
      <button class="close-chat" type="button" aria-label="Close conversation" onclick={closeConversation}>×</button>
    </header>
  {:else}
    <header>
      <div>
        <p class="conversation-kicker">Card selected · {model.selectedCard?.kind === 'hospitality' ? 'hospitality' : 'intent'}</p>
        <h2>{model.selected?.name}</h2>
      </div>
      <button class="close-chat" type="button" aria-label="Close conversation" onclick={closeConversation}>×</button>
    </header>
  {/if}

  <div class="recent-messages" aria-live="polite">
    {#if latestEntries.length}
      {#each latestEntries as entry (entry.id)}
        <p class:player={entry.kind === 'player'} class:service={entry.kind === 'service'}><strong>{entry.label ?? 'You'}</strong> {entry.text}</p>
      {/each}
    {:else}
      <p class="conversation-prompt">{model.selectedCard?.kind === 'hospitality'
        ? 'Offer this card to see a mock response.'
        : 'Write a thought, or send the card’s suggested prompt.'}</p>
    {/if}
  </div>

  <label class="conversation-composer">
    {#if presentation === 'standard'}<span>To {model.selected?.name}</span>{/if}
    <textarea data-prototype-conversation-input aria-label="Write to {model.selected?.name}" value={model.draft} oninput={(event) => model.ondraft(event.currentTarget.value)} placeholder="Write a short note…" rows={presentation === 'standard' ? 2 : 3}></textarea>
  </label>
  <div class="conversation-actions">
    {#if model.selectedCard?.kind === 'hospitality'}
      <button type="button" class="primary" onclick={model.onserve}>Offer {model.selectedCard.title}</button>
    {:else}
      <button type="button" class="primary" onclick={model.onsend}>Send</button>
    {/if}
  </div>
  {#if model.notice}<p class="conversation-notice" role="status">{model.notice}</p>{/if}
</section>

<style>
  .conversation-card { display: grid; gap: .48rem; min-width: 0; padding: .68rem .75rem; border: 1px solid #b4914c; border-radius: .7rem; color: #eee2c5; background: rgb(19 14 8 / .95); box-shadow: 0 9px 25px rgb(0 0 0 / .48), inset 0 1px 0 rgb(255 230 170 / .06); }
  .conversation-card > header { display: flex; align-items: start; justify-content: space-between; gap: .5rem; }
  .conversation-kicker { margin: 0 0 .12rem; color: #d6b96e; font: 700 .61rem 'Cinzel', Georgia, serif; letter-spacing: .08em; text-transform: uppercase; }
  .conversation-card h2 { margin: 0; color: #f0d27a; font: 600 1rem 'Cinzel', Georgia, serif; }
  .close-chat { display: grid; width: 1.8rem; height: 1.8rem; flex: 0 0 auto; place-items: center; padding: 0; border: 1px solid #735a2f; border-radius: 50%; color: #f3e6c5; background: #2b1f0d; font: 1.25rem/1 Georgia, serif; cursor: pointer; }
  .close-chat:hover, .close-chat:focus-visible { border-color: #f0d27a; }
  .recent-messages { display: grid; max-height: 7rem; gap: .3rem; overflow: auto; }
  .recent-messages p { margin: 0; padding: .35rem .45rem; border-left: 2px solid #b08d4c; color: #e7dcc3; background: rgb(255 255 255 / .035); font-size: .74rem; line-height: 1.4; }
  .recent-messages p.player { border-color: #d4b15e; }
  .recent-messages p.service { border-color: #94a972; }
  .recent-messages strong { color: #e3c975; }
  .recent-messages .conversation-prompt { color: #c8b995; font-style: italic; }
  .conversation-composer { display: grid; gap: .2rem; color: #d9cba8; font-size: .68rem; }
  .conversation-composer textarea { width: 100%; min-height: 2.6rem; resize: vertical; padding: .38rem .48rem; border: 1px solid #705a34; border-radius: .35rem; color: #f2ead8; background: #100b07; font: inherit; font-size: .77rem; line-height: 1.35; }
  .conversation-composer textarea:focus-visible { outline: 2px solid #f0d27a; outline-offset: 1px; }
  .conversation-actions { display: flex; justify-content: end; }
  .conversation-actions button { min-height: 2.15rem; padding: .38rem .65rem; border: 1px solid #806631; border-radius: .35rem; color: #211607; background: #dfbd65; font: inherit; font-size: .73rem; font-weight: 700; cursor: pointer; }
  .conversation-actions button:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  .conversation-notice { margin: 0; color: #d8c589; font-size: .68rem; }
  .conversation-card.player-hand { --composer-height: 5rem; grid-template-rows: 2.75rem minmax(2rem, 1fr) var(--composer-height) 2.75rem auto; gap: .28rem; padding: .55rem .72rem; border-color: #e0c783; color: #fff0c9; background: linear-gradient(165deg, rgb(50 38 19 / var(--chat-opacity, .9)), rgb(22 16 9 / var(--chat-opacity, .9))); }
  .player-hand-header { display: flex; min-width: 0; align-items: center; gap: .55rem; }
  .card-thumb { display: grid; width: 2rem; height: 2.45rem; flex: 0 0 auto; place-items: center; border: 1px solid #e4c56c; border-radius: .22rem .3rem .28rem .22rem; color: #ffe9a3; background: linear-gradient(155deg, #65502a, #281b0c 68%); box-shadow: inset 0 0 0 2px rgb(242 220 161 / .14); font: 1rem Georgia, serif; }
  .card-thumb.sage { background: linear-gradient(155deg, #48613d, #192218 68%); }
  .card-thumb.copper { background: linear-gradient(155deg, #925b37, #2d160c 68%); }
  .card-thumb.plum { background: linear-gradient(155deg, #6d506b, #241625 68%); }
  .card-identity { display: grid; min-width: 0; gap: .03rem; }
  .conversation-card.player-hand .conversation-kicker { margin: 0; font-size: .56rem; }
  .conversation-card.player-hand h2 { overflow: hidden; color: #ffe39a; font-size: .82rem; text-overflow: ellipsis; white-space: nowrap; }
  .card-identity .card-detail { overflow: hidden; color: #d4c399; font-size: .6rem; text-overflow: ellipsis; white-space: nowrap; }
  .recipient-name { margin-left: auto; color: #f1e4c6; font: 600 .68rem 'Cinzel', Georgia, serif; white-space: nowrap; }
  .conversation-card.player-hand .close-chat { width: 2.75rem; height: 2.75rem; }
  .conversation-card.player-hand .recent-messages { display: grid; min-height: 0; max-height: 100%; align-content: start; gap: .35rem; overflow-x: hidden; overflow-y: auto; }
  .conversation-card.player-hand .recent-messages p { min-width: 0; padding: .3rem .42rem; font-size: .74rem; line-height: 1.35; overflow-wrap: anywhere; white-space: normal; }
  .conversation-card.player-hand .conversation-composer { min-height: 0; display: block; }
  .conversation-card.player-hand .conversation-composer textarea { min-height: var(--composer-height); height: var(--composer-height); resize: none; padding: .42rem .55rem; color: #fff5da; background: #100b07; font-size: .85rem; }
  .conversation-card.player-hand .conversation-actions { align-items: center; }
  .conversation-card.player-hand .conversation-actions button { min-height: 2.75rem; padding: .24rem .7rem; }
  .conversation-card.player-hand .conversation-notice { max-height: 1rem; overflow: hidden; font-size: .6rem; }
  @media (max-width: 1000px) {
    .conversation-card.player-hand { gap: .2rem; padding: .4rem .5rem; }
    .card-thumb { width: 1.55rem; height: 1.9rem; font-size: .8rem; }
    .conversation-card.player-hand h2 { font-size: .78rem; }
    .card-identity .card-detail { display: none; }
    .recipient-name { font-size: .62rem; }
    .conversation-card.player-hand .recent-messages p { font-size: .74rem; }
    .conversation-card.player-hand .conversation-composer textarea { padding: .28rem .42rem; font-size: .85rem; }
    .conversation-card.player-hand .conversation-actions button { padding: .18rem .55rem; font-size: .73rem; }
  }
</style>
