<script lang="ts">
  import { tick } from 'svelte';
  import type { BarPrototypeModel } from './types';
  let { model }: { model: BarPrototypeModel } = $props();
  let latestEntries = $derived(model.history.slice(-3));

  async function closeConversation() {
    model.onchatclose();
    await tick();
    if (model.selectedCardId) {
      document.querySelector<HTMLButtonElement>('[data-prototype-card-id="' + model.selectedCardId + '"]')
        ?.focus({ preventScroll: true });
    }
  }
</script>

<section class="conversation-card" aria-label="Conversation with {model.selected?.name}">
  <header>
    <div>
      <p class="conversation-kicker">Card selected · {model.selectedCard?.kind === 'hospitality' ? 'hospitality' : 'intent'}</p>
      <h2>{model.selected?.name}</h2>
    </div>
    <button class="close-chat" type="button" aria-label="Close conversation" onclick={closeConversation}>×</button>
  </header>

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
    <span>To {model.selected?.name}</span>
    <textarea data-prototype-conversation-input value={model.draft} oninput={(event) => model.ondraft(event.currentTarget.value)} placeholder="Write a short note…" rows="2"></textarea>
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
</style>
