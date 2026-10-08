<script lang="ts">
  import { tick } from 'svelte';
  import TavernScene from '$lib/components/tavern/TavernScene.svelte';
  import PrototypeCardFan from './PrototypeCardFan.svelte';
  import PrototypeJournal from './PrototypeJournal.svelte';
  import type { BarPrototypeModel } from './types';

  let model: BarPrototypeModel = $props();
  let latestEntries = $derived(model.history.slice(-2));

  async function closeConversation() {
    model.onchatclose();
    await tick();
    if (model.selectedCardId) {
      document.querySelector<HTMLButtonElement>('[data-prototype-card-id="' + model.selectedCardId + '"]')
        ?.focus({ preventScroll: true });
    }
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
    hideControls={true}
    deckOpen={Boolean(model.selected)}
    composerOpen={model.mode === 'talk'}
    onselect={model.onselect}
    onfocus={model.onfocus}
    onback={model.onback}
    ontalk={model.ontalk}
    ondeck={model.ondeck}
    onclose={model.onclose}
    onkeepsake={model.onkeepsake}
  >
    {#snippet interaction()}
      {#if model.selected}
        <div class="ribbon-stage">
          <div class="stage-controls">
            <button class="unfocus" type="button" aria-label="Close {model.selected.name} and return to the room" title="Return to the room" onclick={model.onback}>×</button>
            <button class="journal-toggle" type="button" data-prototype-opener="journal" aria-expanded={model.mode === 'journal'} onclick={model.onjournal}>Journal</button>
          </div>

          <div class="ribbon-hand">
            <PrototypeCardFan cards={model.cards} selectedCardId={model.selectedCardId} variant="C" oncard={model.oncard} />
          </div>

          {#if model.mode === 'talk' && model.selectedCard}
            <section class="conversation-ribbon" aria-label="Conversation ribbon with {model.selected.name}">
              <header>
                <div><span class="ribbon-kicker">{model.selectedCard.title} · {model.selected.name}</span>
                  {#if latestEntries.length}
                    <div class="ribbon-messages" aria-live="polite">
                      {#each latestEntries as entry (entry.id)}
                        <span class:service={entry.kind === 'service'}><b>{entry.label ?? 'You'}:</b> {entry.text}</span>
                      {/each}
                    </div>
                  {:else}
                    <div class="ribbon-messages"><span class="prompt">{model.selectedCard.kind === 'hospitality' ? 'Offer the card to see what happens.' : 'Send a note to begin the conversation.'}</span></div>
                  {/if}
                </div>
                <button class="ribbon-close" type="button" aria-label="Close conversation" onclick={closeConversation}>×</button>
              </header>
              <div class="ribbon-compose">
                <textarea data-prototype-conversation-input aria-label="Write to {model.selected.name}" value={model.draft} oninput={(event) => model.ondraft(event.currentTarget.value)} placeholder="Write a note…" rows="1"></textarea>
                {#if model.selectedCard.kind === 'hospitality'}
                  <button type="button" class="ribbon-send" onclick={model.onserve}>Offer</button>
                {:else}
                  <button type="button" class="ribbon-send" onclick={model.onsend}>Send</button>
                {/if}
              </div>
              {#if model.notice}<span class="ribbon-notice" role="status">{model.notice}</span>{/if}
            </section>
          {/if}

          <PrototypeJournal {model} />
        </div>
      {/if}
    {/snippet}
  </TavernScene>
</div>

<style>
  .variant-c { position: relative; min-width: 0; color: #eee2c4; }
  .variant-c :global(.scene-interaction) { z-index: 20; inset: 0; width: auto; max-height: none; margin: 0; padding: 0; overflow: visible; border: 0; border-radius: 0; background: transparent; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; pointer-events: none; }
  .ribbon-stage { position: absolute; inset: 0; pointer-events: none; }
  .stage-controls { position: absolute; z-index: 35; top: .65rem; right: .65rem; display: flex; align-items: center; justify-content: flex-end; gap: .4rem; pointer-events: auto; }
  .stage-controls button { min-height: 2rem; border: 1px solid rgb(197 161 89 / .78); color: #f5e9c9; background: rgb(19 14 8 / .89); box-shadow: 0 3px 10px rgb(0 0 0 / .35); cursor: pointer; }
  .stage-controls .unfocus { display: grid; width: 2rem; place-items: center; padding: 0; border-radius: 50%; font: 1.3rem/1 Georgia, serif; }
  .stage-controls .journal-toggle { min-height: 1.85rem; padding: .28rem .55rem; border-radius: 999px; font: 600 .68rem 'Cinzel', Georgia, serif; }
  .stage-controls button:hover, .stage-controls button:focus-visible, .ribbon-close:hover, .ribbon-close:focus-visible { border-color: #ffe08a; }
  .stage-controls button:focus-visible, .ribbon-close:focus-visible, .ribbon-send:focus-visible { outline: 2px solid #ffe08a; outline-offset: 2px; }
  .conversation-ribbon { position: absolute; z-index: 26; right: .9rem; bottom: 7rem; left: .9rem; display: grid; gap: .35rem; padding: .52rem .7rem; border: 1px solid #ad8b49; border-radius: .55rem; color: #eee2c4; background: rgb(17 13 8 / .95); box-shadow: 0 8px 20px rgb(0 0 0 / .46); pointer-events: auto; }
  .conversation-ribbon > header { display: flex; align-items: center; justify-content: space-between; gap: .5rem; min-width: 0; }
  .ribbon-kicker { display: block; margin-bottom: .1rem; color: #e7ca77; font: 700 .62rem 'Cinzel', Georgia, serif; letter-spacing: .04em; }
  .ribbon-messages { display: flex; gap: .75rem; overflow: hidden; color: #e9dfca; font-size: .67rem; line-height: 1.3; white-space: nowrap; }
  .ribbon-messages span { overflow: hidden; text-overflow: ellipsis; }
  .ribbon-messages b { color: #e2c574; }
  .ribbon-messages span.service { color: #c9d4ad; }
  .ribbon-messages .prompt { color: #c7b995; font-style: italic; }
  .ribbon-close { display: grid; width: 1.75rem; height: 1.75rem; flex: 0 0 auto; place-items: center; padding: 0; border: 1px solid #735a2f; border-radius: 50%; color: #f3e6c5; background: #2b1f0d; font: 1.2rem/1 Georgia, serif; cursor: pointer; }
  .ribbon-compose { display: flex; align-items: center; gap: .4rem; }
  .ribbon-compose textarea { min-width: 0; min-height: 2.05rem; flex: 1; resize: vertical; padding: .32rem .45rem; border: 1px solid #705a34; border-radius: .3rem; color: #f2ead8; background: #100b07; font: inherit; font-size: .72rem; line-height: 1.3; }
  .ribbon-compose textarea:focus-visible { outline: 2px solid #f0d27a; outline-offset: 1px; }
  .ribbon-send { min-height: 2.05rem; padding: .3rem .65rem; border: 1px solid #a88742; border-radius: .32rem; color: #211607; background: #dfbd65; font: 700 .72rem system-ui, sans-serif; cursor: pointer; }
  .ribbon-notice { color: #d8c589; font-size: .63rem; }
  .ribbon-hand { position: absolute; z-index: 28; right: 0; bottom: .05rem; left: 0; display: flex; justify-content: center; pointer-events: none; }
  .ribbon-hand :global(.hand-space) { animation: hand-rise 270ms cubic-bezier(.2,.75,.25,1) both; }
  @keyframes hand-rise { from { opacity: 0; translate: 0 6rem; } to { opacity: 1; translate: 0 0; } }
  @media (max-width: 1000px) {
    .variant-c :global(.scene-interaction) { position: relative; inset: auto; width: auto; max-height: none; margin-top: .45rem; padding: 0; overflow: visible; pointer-events: auto; }
    .ribbon-stage { position: relative; inset: auto; display: grid; gap: .25rem; pointer-events: auto; }
    .stage-controls { position: relative; inset: auto; min-height: 2rem; }
    .conversation-ribbon { position: relative; inset: auto; }
    .ribbon-hand { position: relative; inset: auto; display: block; }
  }
  @media (max-width: 620px) { .stage-controls { margin-inline: .1rem; } .ribbon-messages { display: grid; gap: .1rem; white-space: normal; } .ribbon-messages span:nth-child(1) { display: block; } }
  @media (prefers-reduced-motion: reduce) { .ribbon-hand :global(.hand-space) { animation: none; } }
</style>
