<script lang="ts">
  import type { BarPrototypeModel } from './types';
  let { model }: { model: BarPrototypeModel } = $props();
</script>

{#if model.mode === 'journal' && model.selected}
  <aside class="journal-sheet" aria-label="Journal for {model.selected.name}">
    <header>
      <div><p class="journal-kicker">Tavern notes · {model.selected.name}</p><h2>Journal</h2></div>
      <button type="button" aria-label="Close Journal" onclick={model.onjournalclose}>×</button>
    </header>
    {#if model.history.length}
      <div class="journal-entries" aria-live="polite">
        {#each model.history as entry (entry.id)}
          <article class:service={entry.kind === 'service'}>
            <span>{entry.label ?? 'You'}</span><p>{entry.text}</p>
          </article>
        {/each}
      </div>
    {:else}
      <p class="journal-empty">No notes yet. Choose a card to start a conversation.</p>
    {/if}
  </aside>
{/if}

<style>
  .journal-sheet { position: absolute; z-index: 45; top: 3.2rem; left: 50%; display: grid; width: min(33rem, calc(100% - 2rem)); max-height: min(56vh, 28rem); gap: .65rem; padding: .85rem; overflow: auto; border: 1px solid #d0b777; color: #302517; background: linear-gradient(165deg, rgb(242 231 200 / .98), rgb(206 187 143 / .98)); box-shadow: 0 16px 45px rgb(0 0 0 / .58); transform: translateX(-50%); }
  .journal-sheet > header { display: flex; align-items: start; justify-content: space-between; gap: .6rem; padding-bottom: .45rem; border-bottom: 1px solid rgb(75 56 31 / .3); }
  .journal-kicker { margin: 0; color: #775d32; font: 700 .65rem 'Cinzel', Georgia, serif; letter-spacing: .08em; text-transform: uppercase; }
  .journal-sheet h2 { margin: .15rem 0 0; font: 600 1.45rem 'Cinzel', Georgia, serif; }
  .journal-sheet header button { display: grid; width: 2rem; height: 2rem; place-items: center; border: 1px solid #725a32; border-radius: 50%; color: #47331b; background: transparent; font: 1.3rem/1 Georgia, serif; cursor: pointer; }
  .journal-sheet header button:focus-visible { outline: 2px solid #69502b; outline-offset: 2px; }
  .journal-entries { display: grid; gap: .55rem; }
  .journal-entries article { padding: .45rem .1rem .45rem .7rem; border-left: 2px solid #9d7439; }
  .journal-entries article.service { border-color: #6c7c4c; }
  .journal-entries span { color: #795e31; font: 700 .65rem 'Cinzel', Georgia, serif; text-transform: uppercase; }
  .journal-entries p { margin: .15rem 0 0; font: .88rem/1.45 Georgia, serif; }
  .journal-empty { margin: 0; color: #5d482c; font: italic .9rem Georgia, serif; }
  @media (max-width: 1000px) { .journal-sheet { position: relative; top: auto; left: auto; width: 100%; max-height: 55vh; margin-top: .5rem; transform: none; } }
</style>
