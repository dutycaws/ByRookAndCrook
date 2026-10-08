<script lang="ts">
  import TavernScene from '$lib/components/tavern/TavernScene.svelte';
  import PrototypeCardFan from './PrototypeCardFan.svelte';
  import PrototypeConversation from './PrototypeConversation.svelte';
  import PrototypeSceneTools from './PrototypeSceneTools.svelte';
  import type { BarPrototypeModel, BarPrototypeVariant } from './types';

  type Treatment = Extract<BarPrototypeVariant, 'B' | 'E' | 'F'>;
  let { model, treatment }: { model: BarPrototypeModel; treatment: Treatment } = $props();
</script>

<div class="variant-b" data-treatment={treatment}>
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
        {#key treatment}
        <div class="player-interaction">
          <div class="stage-controls">
            <button class="unfocus" type="button" aria-label="Close {model.selected.name} and return to the room" title="Return to the room" onclick={model.onback}>×</button>
          </div>

          <div
            class="player-stage"
            class:has-chat={model.mode === 'talk' && Boolean(model.selectedCard)}
          >
            <div class="player-hand">
              <PrototypeCardFan cards={model.cards} selectedCardId={model.selectedCardId} variant="B" oncard={model.oncard} />
            </div>

            {#if model.mode === 'talk' && model.selectedCard}
              <div class="conversation-float"><PrototypeConversation {model} presentation="player-hand" {treatment} /></div>
            {/if}
          </div>
        </div>
        {/key}
      {/if}
    {/snippet}
  </TavernScene>
  <PrototypeSceneTools {model} {treatment} />
</div>

<style>
  .variant-b { position: relative; min-width: 0; color: #eee2c4; container-type: inline-size; --prototype-scene-height: calc(100cqw * 9 / 16); --hand-time: 240ms; --chat-time: 180ms; --chat-width: min(620px, 68vw); --chat-height: 270px; --chat-opacity: .9; --hand-opacity: .42; --selected-opacity: .76; }
  .variant-b[data-treatment='E'] { --hand-time: 170ms; --chat-time: 140ms; --chat-width: min(520px, 68vw); --chat-height: 230px; --chat-opacity: .96; --hand-opacity: .55; --selected-opacity: .84; }
  .variant-b[data-treatment='F'] { --hand-time: 320ms; --chat-time: 240ms; --chat-width: min(700px, 76vw); --chat-height: 310px; --chat-opacity: .82; --hand-opacity: .32; --selected-opacity: .68; }
  .variant-b :global(.scene-interaction) { z-index: 20; inset: 0; width: auto; max-height: none; margin: 0; padding: 0; overflow: visible; border: 0; border-radius: 0; background: transparent; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; pointer-events: none; }
  .player-interaction, .player-stage { position: absolute; inset: 0; pointer-events: none; }
  .stage-controls { position: absolute; z-index: 35; top: .65rem; right: .65rem; pointer-events: auto; }
  .unfocus { display: grid; width: 2.75rem; height: 2.75rem; place-items: center; padding: 0; border: 1px solid #b4914c; border-radius: 50%; color: #f5e9c9; background: rgb(19 14 8 / .89); font: 1.3rem/1 Georgia, serif; cursor: pointer; }
  .unfocus:hover { border-color: #ffe08a; }
  .unfocus:focus-visible { outline: 2px solid #ffe08a; outline-offset: 2px; }
  .conversation-float { position: absolute; z-index: 40; bottom: 1rem; left: 50%; display: flex; width: var(--chat-width); justify-content: center; transform: translateX(-50%); pointer-events: none; animation: composer-rise var(--chat-time) cubic-bezier(.2,.75,.25,1) both; }
  .conversation-float :global(.conversation-card) { width: 100%; height: var(--chat-height); pointer-events: auto; }
  .player-hand { position: absolute; z-index: 28; right: 0; bottom: 2rem; left: 0; display: flex; justify-content: center; pointer-events: none; }
  .player-hand :global(.fan-card) { transition: opacity 150ms ease, transform 150ms ease, translate 150ms ease, border-color 150ms ease, box-shadow 150ms ease; }
  .player-stage.has-chat .player-hand :global(.fan-card:not(.selected)) { opacity: var(--hand-opacity); }
  .player-stage.has-chat .player-hand :global(.fan-card.selected) { opacity: var(--selected-opacity); }
  .player-hand :global(.hand-space) { animation: hand-rise var(--hand-time) cubic-bezier(.2,.75,.25,1) both; }
  @keyframes hand-rise { from { opacity: 0; translate: 0 6rem; } to { opacity: 1; translate: 0 0; } }
  @keyframes composer-rise { from { opacity: 0; translate: 0 3rem; } to { opacity: 1; translate: 0 0; } }
  @keyframes entrance-fade { from { opacity: 0; } to { opacity: 1; } }
  @media (max-width: 1000px) {
    .variant-b { padding-bottom: 3.25rem; }
    .variant-b :global(.scene-interaction) { position: relative; inset: auto; width: auto; max-height: none; margin-top: .45rem; padding: 0; overflow: visible; pointer-events: auto; }
    .player-interaction { position: relative; inset: auto; }
    .stage-controls { position: relative; inset: auto; display: flex; justify-content: end; min-height: 2.75rem; }
    .player-stage { position: relative; inset: auto; height: calc(var(--chat-height) + 100px); pointer-events: auto; }
    .conversation-float { bottom: 14px; width: 92%; }
    .player-hand { right: 0; bottom: calc(var(--chat-height) - 140px); left: 0; }
  }
  @media (max-width: 820px) { .variant-b { --prototype-scene-height: calc(100cqw * 2 / 3); } }
  @media (prefers-reduced-motion: reduce) {
    .player-hand :global(.hand-space), .conversation-float { animation: entrance-fade 80ms ease-out both; }
    .player-hand :global(.fan-card) { transition: opacity 80ms ease; }
  }
</style>
