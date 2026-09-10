<script lang="ts">
  import type { Journal, PatronKey } from '$lib/game/dialogue';
  import type { BarSnapshot, Patron } from '$lib/game/serving';

  let { patrons, selected, journal, stock, disabled = false, onselect }: {
    patrons: Patron[];
    selected: Patron;
    journal: Journal;
    stock: BarSnapshot;
    disabled?: boolean;
    onselect: (key: PatronKey) => void;
  } = $props();
</script>

<aside class="tavern-rail guest-inspector" aria-labelledby="current-guest-title">
  <div class="rail-title"><p class="eyebrow">Current guest</p><h2 id="current-guest-title">{selected.name}</h2><p>{selected.title}</p></div>
  <div class="guest-switcher" role="group" aria-label="Choose a patron">
    {#each patrons as guest (guest.key)}
      <button type="button" class:selected={selected.key === guest.key} aria-pressed={selected.key === guest.key}
        {disabled} onclick={() => onselect(guest.key as PatronKey)}>
        <span class="patron-monogram" aria-hidden="true">{guest.name.slice(0, 1)}</span>
        <span><strong>{guest.name}</strong><small>{guest.title}</small></span>
      </button>
    {/each}
  </div>
  <section class="guest-section" aria-label="Relationship">
    <div class="relationship-label"><span>Relationship</span><strong>{selected.relationship} / 100</strong></div>
    <meter min="0" max="100" value={selected.relationship}>{selected.relationship}</meter>
  </section>
  <section class="guest-section">
    <p class="eyebrow">Current quest</p>
    {#if journal.intention}
      <h3>{journal.intention.goal}</h3><p>{journal.intention.motivation}</p>
      {#if journal.questStatus === 'active'}<p class="quest-readiness">{journal.preparation === 2 ? 'Well prepared' : journal.preparation === 1 ? 'Some preparation' : 'Unprepared'} · {journal.risk} risk</p>{/if}
    {:else}<p class="muted">No active intention.</p>{/if}
    {#if journal.warning}<p class="consequence-warning" role="note">{journal.warning}</p>{/if}
  </section>
  <section class="guest-section">
    <p class="eyebrow">Conversation context</p>
    <p>{selected.description}</p>
    <p class="eyebrow story-origin">{selected.arcProgress === selected.arcTotal ? 'Previously resolved' : selected.arcProgress ? `Legacy chapter ${selected.arcProgress} of ${selected.arcTotal}` : 'Where their story began'}</p>
    <h3>{selected.arcTitle}</h3>
    <p class="muted">{selected.story}</p>
  </section>
  <section class="guest-section hospitality-counts" aria-label="Hospitality inventory">
    <p class="eyebrow">Ready to offer</p>
    <div><span><strong>{stock.beverages.length}</strong> drinks</span><span><strong>{stock.foods.length}</strong> foods</span></div>
  </section>
</aside>
