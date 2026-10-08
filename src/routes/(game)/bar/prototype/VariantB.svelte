<script lang="ts">
  import TavernScene from '$lib/components/tavern/TavernScene.svelte';
  import PrototypeCardFan from './PrototypeCardFan.svelte';
  import PrototypeConversation from './PrototypeConversation.svelte';
  import PrototypeJournal from './PrototypeJournal.svelte';
  import type { BarPrototypeModel } from './types';

  let model: BarPrototypeModel = $props();

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
        <div class="player-stage">
          <div class="stage-controls">
            <button class="unfocus" type="button" aria-label="Close {model.selected.name} and return to the room" title="Return to the room" onclick={model.onback}>×</button>
            <button class="journal-toggle" type="button" data-prototype-opener="journal" aria-expanded={model.mode === 'journal'} onclick={model.onjournal}>Journal</button>
          </div>

          <div class="player-hand">
            <PrototypeCardFan cards={model.cards} selectedCardId={model.selectedCardId} variant="B" oncard={model.oncard} />
          </div>

          {#if model.mode === 'talk' && model.selectedCard}
            <div class="conversation-float"><PrototypeConversation {model} /></div>
          {/if}

          <PrototypeJournal {model} />
        </div>
      {/if}
    {/snippet}
  </TavernScene>
</div>

<style>
  .variant-b { position: relative; min-width: 0; color: #eee2c4; }
  .variant-b :global(.scene-interaction) { z-index: 20; inset: 0; width: auto; max-height: none; margin: 0; padding: 0; overflow: visible; border: 0; border-radius: 0; background: transparent; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; pointer-events: none; }
  .player-stage { position: absolute; inset: 0; pointer-events: none; }
  .stage-controls { position: absolute; z-index: 35; top: .65rem; right: .65rem; display: flex; align-items: center; justify-content: flex-end; gap: .4rem; pointer-events: auto; }
  .stage-controls button { min-height: 2rem; border: 1px solid rgb(197 161 89 / .78); color: #f5e9c9; background: rgb(19 14 8 / .89); box-shadow: 0 3px 10px rgb(0 0 0 / .35); cursor: pointer; }
  .stage-controls .unfocus { display: grid; width: 2rem; place-items: center; padding: 0; border-radius: 50%; font: 1.3rem/1 Georgia, serif; }
  .stage-controls .journal-toggle { min-height: 1.85rem; padding: .28rem .55rem; border-radius: 999px; font: 600 .68rem 'Cinzel', Georgia, serif; }
  .stage-controls button:hover, .stage-controls button:focus-visible { border-color: #ffe08a; }
  .stage-controls button:focus-visible { outline: 2px solid #ffe08a; outline-offset: 2px; }
  .conversation-float { position: absolute; z-index: 25; top: 4rem; right: 1.15rem; width: min(22rem, calc(100% - 2.3rem)); pointer-events: auto; }
  .player-hand { position: absolute; z-index: 28; right: 0; bottom: .1rem; left: 0; display: flex; justify-content: center; pointer-events: none; }
  .player-hand :global(.hand-space) { animation: hand-rise 270ms cubic-bezier(.2,.75,.25,1) both; }
  @keyframes hand-rise { from { opacity: 0; translate: 0 6rem; } to { opacity: 1; translate: 0 0; } }
  @media (max-width: 1000px) {
    .variant-b :global(.scene-interaction) { position: relative; inset: auto; width: auto; max-height: none; margin-top: .45rem; padding: 0; overflow: visible; pointer-events: auto; }
    .player-stage { position: relative; inset: auto; display: grid; gap: .25rem; pointer-events: auto; }
    .stage-controls { position: relative; inset: auto; min-height: 2rem; }
    .conversation-float { position: relative; inset: auto; width: auto; }
    .player-hand { position: relative; inset: auto; display: block; }
  }
  @media (max-width: 620px) {
    .stage-controls { margin-inline: .1rem; }
    .conversation-float { width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) { .player-hand :global(.hand-space) { animation: none; } }
</style>
