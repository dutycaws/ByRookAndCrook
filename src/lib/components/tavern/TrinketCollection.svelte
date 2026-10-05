<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { TRINKET_ARTWORK, TRINKET_EFFECT_CATALOG, type OwnedTrinket } from '$lib/game/trinkets';

  type SwapCommand = {
    saveId: string;
    trinketId: string;
    targetSlot: number | null;
    actionId: string;
    expectedRevision: number;
  };
  type Props = { collection: OwnedTrinket[]; saveId: string; revision: number; selectedId: string; disabled?: boolean; onselect: (id: string) => void };
  let { collection, saveId, revision, selectedId, disabled = false, onselect }: Props = $props();
  let pendingCommand = $state<SwapCommand | null>(null);
  let pending = $state(false);
  let message = $state('');
  let messageKind = $state<'status' | 'error'>('status');
  const slots = [0, 1, 2, 3] as const;
  let selectedItem = $derived(collection.find((item) => item.id === selectedId) ?? null);
  let overflow = $derived(collection.filter((item) => item.slot === null));

  async function sendSwap(command: SwapCommand) {
    pending = true;
    message = '';
    try {
      const response = await fetch('/api/trinkets/swap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command)
      });
      let body: { receipt?: { status?: string }; message?: string } = {};
      try { body = await response.json(); } catch { /* Keep the command for a safe retry if the result is unknown. */ }
      if (!response.ok) {
        message = body.message ?? 'The keepsake arrangement could not be changed.';
        messageKind = response.status >= 500 ? 'error' : 'status';
        if (response.status < 500) {
          pendingCommand = null;
          if (response.status === 409) await invalidateAll();
        }
        return;
      }

      pendingCommand = null;
      message = body.receipt?.status === 'unchanged'
        ? 'That keepsake is already in the chosen place.'
        : command.targetSlot === null ? 'Keepsake returned to the collection.' : `Keepsake moved to slot ${command.targetSlot + 1}.`;
      messageKind = 'status';
      try { await invalidateAll(); }
      catch { message = 'The swap was saved, but the latest collection could not be loaded. Refresh the bar to continue.'; }
    } catch {
      message = 'The swap result is unknown. Retry the same arrangement to check whether it was saved.';
      messageKind = 'error';
    } finally {
      pending = false;
    }
  }

  function move(trinketId: string, targetSlot: number | null) {
    if (disabled || pending || pendingCommand) return;
    const command: SwapCommand = {
      saveId,
      trinketId,
      targetSlot,
      actionId: crypto.randomUUID(),
      expectedRevision: revision
    };
    pendingCommand = command;
    void sendSwap(command);
  }

  function retry() {
    if (pendingCommand && !pending && !disabled) void sendSwap(pendingCommand);
  }
</script>

<section class="trinket-collection panel" aria-labelledby="trinket-title">
  <header class="trinket-heading">
    <div><p class="eyebrow">Keepsakes</p><h2 id="trinket-title">The four active places</h2></div>
    <p>Displayed keepsakes add their bonuses. Moving them is free.</p>
  </header>

  <div class="trinket-slots" aria-label="Four active trinket slots">
    {#each slots as slot (slot)}
      {@const equipped = collection.find((item) => item.slot === slot) ?? null}
      <article class:occupied={equipped} class="trinket-slot">
        <span class="slot-label">Slot {slot + 1}</span>
        {#if equipped}
          <img class="trinket-art" src={TRINKET_ARTWORK[equipped.artworkId].src} alt={TRINKET_ARTWORK[equipped.artworkId].alt} />
          <strong>{equipped.name}</strong>
          <small>{TRINKET_EFFECT_CATALOG[equipped.catalogId].label}</small>
          <button class="trinket-text-button" type="button" disabled={disabled || pending || !!pendingCommand}
            aria-label={`Unequip ${equipped.name} from slot ${slot + 1}`} onclick={() => move(equipped.id, null)}>Return to collection</button>
        {:else}
          <span class="empty-slot-mark" aria-hidden="true">◇</span>
          <strong>Empty place</strong>
          <small>New quest keepsakes fill the first open place.</small>
        {/if}
      </article>
    {/each}
  </div>

  {#if collection.length > 0}
    <div class="trinket-move-controls">
      <label for="keepsake-to-move">Choose a keepsake</label>
      <select id="keepsake-to-move" value={selectedId} onchange={(event) => onselect((event.currentTarget as HTMLSelectElement).value)} disabled={disabled || pending || !!pendingCommand}>
        {#each collection as item (item.id)}
          <option value={item.id}>{item.name}{item.slot === null ? ' · Collection' : ` · Slot ${item.slot + 1}`}</option>
        {/each}
      </select>
      <div class="trinket-slot-actions" aria-label="Choose active slot">
        {#each slots as slot (slot)}
          <button type="button" disabled={disabled || pending || !!pendingCommand || !selectedItem}
            onclick={() => selectedItem && move(selectedItem.id, slot)}>Move to slot {slot + 1}</button>
        {/each}
      </div>
    </div>

    <div class="trinket-inventory" aria-label="Keepsake collection">
      <h3>Collected keepsakes</h3>
      {#each collection as item (item.id)}
        <article class="trinket-item">
          <img class="trinket-art" src={TRINKET_ARTWORK[item.artworkId].src} alt={TRINKET_ARTWORK[item.artworkId].alt} />
          <div><strong>{item.name}</strong><small>{TRINKET_EFFECT_CATALOG[item.catalogId].label} · {item.slot === null ? 'In collection' : `Active in slot ${item.slot + 1}`}</small><p>{item.dedication}</p></div>
        </article>
      {/each}
    </div>
    {#if overflow.length > 0}<p class="trinket-overflow-note">{overflow.length} keepsake{overflow.length === 1 ? '' : 's'} wait{overflow.length === 1 ? 's' : ''} in the collection until you choose a place.</p>{/if}
  {:else}
    <p class="trinket-empty-copy">Your first keepsake arrives when a connected resident completes their first authored quest.</p>
  {/if}

  {#if pendingCommand && !pending}<button class="trinket-retry" type="button" onclick={retry}>Retry the same swap</button>{/if}
  {#if message}<p class:trinket-error={messageKind === 'error'} class="trinket-message" role={messageKind}>{message}</p>{/if}
</section>

<style>
  .trinket-collection { display: grid; gap: .8rem; min-width: 0; margin: 0; padding: .9rem; border-color: #654b20; background: linear-gradient(145deg, rgb(29 21 10 / .96), rgb(12 9 5 / .96)); }
  .trinket-heading { display: flex; align-items: end; justify-content: space-between; gap: .8rem; padding-bottom: .55rem; border-bottom: 1px solid rgb(128 96 44 / .5); }
  .trinket-heading .eyebrow { margin: 0 0 .1rem; font-size: .67rem; }
  .trinket-heading h2 { margin: 0; color: #e7c871; font-family: 'Cinzel', serif; font-size: 1rem; }
  .trinket-heading > p { max-width: 20rem; margin: 0; color: #a99363; font-size: .83rem; text-align: right; }
  .trinket-slots { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .45rem; }
  .trinket-slot { display: grid; align-content: start; justify-items: center; gap: .3rem; min-width: 0; min-height: 8.2rem; padding: .45rem .35rem; border: 1px dashed #51401f; background: rgb(5 4 2 / .38); text-align: center; }
  .trinket-slot.occupied { border-style: solid; border-color: #80602e; background: linear-gradient(160deg, rgb(77 55 18 / .3), rgb(12 9 5 / .42)); }
  .slot-label { color: #a98d56; font-family: 'Cinzel', serif; font-size: .64rem; letter-spacing: .08em; text-transform: uppercase; }
  .trinket-art { display: block; width: 2rem; height: 2rem; object-fit: contain; filter: drop-shadow(0 2px 3px rgb(0 0 0 / .5)); }
  .trinket-slot strong, .trinket-item strong { color: #e6ca7a; font-family: 'Cinzel', serif; font-size: .78rem; }
  .trinket-slot small, .trinket-item small { color: #a89468; font-size: .72rem; line-height: 1.25; }
  .empty-slot-mark { color: #675126; font-size: 1.35rem; line-height: 1.2; }
  .trinket-text-button, .trinket-slot-actions button, .trinket-retry { min-height: 2rem; border: 1px solid #705329; padding: .27rem .45rem; color: #e2c373; background: #171108; font-size: .76rem; cursor: pointer; }
  .trinket-text-button:hover, .trinket-slot-actions button:hover, .trinket-retry:hover { border-color: #d2aa51; background: #261b0b; }
  .trinket-text-button:disabled, .trinket-slot-actions button:disabled, .trinket-retry:disabled { opacity: .55; cursor: not-allowed; }
  .trinket-move-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .4rem .55rem; align-items: center; }
  .trinket-move-controls > label { color: #b6a073; font-size: .83rem; }
  .trinket-move-controls select { grid-column: 1 / -1; min-height: 2.4rem; min-width: 0; border: 1px solid #60481f; padding: .35rem .5rem; color: #ead8a6; background: #0e0b06; font: inherit; }
  .trinket-move-controls select:disabled { color: #8d7c56; cursor: not-allowed; }
  .trinket-slot-actions { display: flex; flex-wrap: wrap; gap: .35rem; }
  .trinket-inventory { display: grid; gap: .4rem; }
  .trinket-inventory h3 { margin: .1rem 0; color: #c2a96d; font-family: 'Cinzel', serif; font-size: .77rem; }
  .trinket-item { display: grid; grid-template-columns: 2rem minmax(0, 1fr); align-items: center; gap: .5rem; padding: .4rem .5rem; border-left: 2px solid #73552a; background: rgb(6 5 3 / .38); }
  .trinket-item > div { display: grid; gap: .15rem; min-width: 0; }
  .trinket-item p { margin: 0; color: #bba880; font-size: .78rem; line-height: 1.25; }
  .trinket-empty-copy, .trinket-overflow-note, .trinket-message { margin: 0; color: #ad9a6d; font-size: .84rem; }
  .trinket-message { color: #a9c981; }
  .trinket-message.trinket-error { color: #ffc0af; }
  .trinket-retry { justify-self: start; }
  @media (max-width: 520px) {
    .trinket-heading { align-items: start; flex-direction: column; }
    .trinket-heading > p { text-align: left; }
    .trinket-slot { min-height: 7.8rem; padding-inline: .22rem; }
    .trinket-slot strong { overflow-wrap: anywhere; font-size: .69rem; }
    .trinket-slot small { font-size: .65rem; }
    .trinket-slot-actions button { flex: 1 1 calc(50% - .35rem); }
  }
</style>
