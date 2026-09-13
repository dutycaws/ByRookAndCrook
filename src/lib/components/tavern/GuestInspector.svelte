<script lang="ts">
  import type { Journal } from '$lib/game/dialogue';
  import type { BarSnapshot, Patron } from '$lib/game/serving';

  let { patrons, selected, journal, stock, archived = false, disabled = false, onselect, onarchive }: {
    patrons: Patron[];
    selected: Patron;
    journal: Journal;
    stock: BarSnapshot;
    archived?: boolean;
    disabled?: boolean;
    onselect: (instanceId: string) => void;
    onarchive: (archived: boolean) => void;
  } = $props();
  let visible = $state<Patron[]>([]);
  let query = $state('');
  let cursor = $state<string | null>(null);
  let loading = $state(false);
  let actionMessage = $state('');
  let reportOpen = $state(false);
  let reportEvidence = $state('');
  let sharePreview = $state<{ contentHash: string; transcript: unknown[] } | null>(null);
  let includeDisplayName = $state(false);
  let hydrated = $state(false);
  $effect(() => {
    hydrated = true;
    visible = patrons;
    cursor = patrons.length === 20 ? patrons.at(-1)?.instanceId ?? null : null;
  });

  async function loadRoster(replace = false) {
    if (loading) return;
    loading = true; actionMessage = '';
    try {
      const params = new URLSearchParams();
      if (!replace && cursor) params.set('cursor', cursor);
      if (query.trim()) params.set('q', query.trim());
      if (archived) params.set('archive', '1');
      const response = await fetch(`/api/npcs/roster?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      visible = replace ? body.residents : [...visible, ...body.residents.filter((entry: Patron) => !visible.some((current) => current.instanceId === entry.instanceId))];
      cursor = body.nextCursor;
    } catch (cause) { actionMessage = cause instanceof Error ? cause.message : 'The guest ledger could not be refreshed.'; }
    finally { loading = false; }
  }
  function search(event: SubmitEvent) { event.preventDefault(); void loadRoster(true); }
  async function npcAction(payload: Record<string, unknown>) {
    actionMessage = '';
    try {
      const response = await fetch('/api/npcs/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      return body;
    } catch (cause) { actionMessage = cause instanceof Error ? cause.message : 'That action could not be completed.'; return null; }
  }
  async function dismiss() { const result = await npcAction({ action: 'dismiss', instanceId: selected.instanceId }); if (result) window.location.assign('/bar'); }
  async function report() { const result = await npcAction({ action: 'report', versionId: selected.versionId, category: 'player report', evidence: reportEvidence }); if (result) { reportOpen = false; reportEvidence = ''; actionMessage = result.message; } }
  async function previewShare() { const result = await npcAction({ action: 'share-preview', instanceId: selected.instanceId }); if (result) sharePreview = result.preview; }
  async function share() { if (!sharePreview) return; const result = await npcAction({ action: 'share', instanceId: selected.instanceId, contentHash: sharePreview.contentHash, includeDisplayName }); if (result) actionMessage = `Share link: /shares/${result.token}`; }
</script>

<aside class="tavern-rail guest-inspector" aria-labelledby="current-guest-title">
  <div class="rail-title"><p class="eyebrow">Current guest</p><h2 id="current-guest-title">{selected.name}</h2><p>{selected.title}</p></div>
  <form class="guest-search" onsubmit={search}>
    <label class="sr-only" for="guest-search">Find a guest</label><input id="guest-search" bind:value={query} maxlength="80" placeholder="Find a guest" />
    <button class="text-button" disabled={!hydrated || loading}>{loading ? 'Searching…' : 'Find'}</button>
  </form>
  <button class="text-button" type="button" onclick={() => onarchive(!archived)}>{archived ? 'Back to active guests' : 'View dismissed guests'}</button>
  <div class="guest-switcher" role="group" aria-label="Choose a patron">
    {#each visible as guest (guest.instanceId)}
      <button type="button" class:selected={selected.instanceId === guest.instanceId} aria-pressed={selected.instanceId === guest.instanceId}
        {disabled} onclick={() => onselect(guest.instanceId)}>
        <span class="patron-monogram" aria-hidden="true">{guest.name.slice(0, 1)}</span>
        <span><strong>{guest.name}</strong><small>{guest.title}</small></span>
      </button>
    {/each}
  </div>
  {#if cursor}<button class="text-button roster-more" disabled={!hydrated || loading} onclick={() => void loadRoster()}>{loading ? 'Loading…' : 'Show more guests'}</button>{/if}
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
    {#if selected.creator}<p class="eyebrow story-origin">Community NPC</p><p class="muted">Created by <a href={`/creators/${selected.creator.profile}`}>{selected.creator.displayName}</a></p>{:else}<p class="eyebrow story-origin">Tavern resident</p>{/if}
  </section>
  <section class="guest-section hospitality-counts" aria-label="Hospitality inventory">
    <p class="eyebrow">Ready to offer</p>
    <div><span><strong>{stock.beverages.length}</strong> drinks</span><span><strong>{stock.foods.length}</strong> foods</span></div>
  </section>
  <section class="guest-section guest-safety" aria-label="Guest controls">
    <p class="eyebrow">Guest controls</p>
    <details><summary>Dismiss from this tavern</summary><p class="muted">This removes this resident from this save. Their historical record remains.</p><button type="button" class="text-button danger" onclick={dismiss}>Confirm dismissal</button></details>
    <details bind:open={reportOpen}><summary>Report this NPC</summary><p class="consequence-warning" role="note">Submitting attaches the full conversation transcript and frozen encountered-version metadata for reviewer evidence.</p><label for="npc-report">What needs review?</label><textarea id="npc-report" bind:value={reportEvidence} maxlength="2000" rows="3"></textarea><button type="button" class="text-button" disabled={!reportEvidence.trim()} onclick={report}>Submit report</button></details>
    <details><summary>Share conversation</summary><p class="muted">Preview the exact transcript before sharing. A created link is immutable and cannot be revoked.</p>{#if !sharePreview}<button type="button" class="text-button" onclick={previewShare}>Preview share</button>{:else}<p>{sharePreview.transcript.length} transcript entries will be shared exactly as shown.</p><div class="share-preview" aria-label="Exact conversation share preview">{#each sharePreview.transcript as entry,index (index)}<pre>{JSON.stringify(entry, null, 2)}</pre>{/each}</div><label><input type="checkbox" bind:checked={includeDisplayName} /> Include my display name</label><button type="button" class="text-button" onclick={share}>Create immutable link</button>{/if}</details>
    {#if actionMessage}<p class="form-message" role="status">{actionMessage}</p>{/if}
  </section>
</aside>
