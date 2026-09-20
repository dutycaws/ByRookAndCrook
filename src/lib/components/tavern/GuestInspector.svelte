<script lang="ts">
  import type { Journal } from '$lib/game/dialogue';
  import type { BarSnapshot, Patron } from '$lib/game/serving';

  let { selected, journal, stock, archived = false, disabled = false, onarchive }: {
    selected: Patron | null;
    journal: Journal | null;
    stock: BarSnapshot;
    archived?: boolean;
    disabled?: boolean;
    onarchive: (archived: boolean) => void;
  } = $props();
  let actionMessage = $state('');
  let reportOpen = $state(false);
  let reportEvidence = $state('');
  let sharePreview = $state<{ contentHash: string; transcript: unknown[] } | null>(null);
  let includeDisplayName = $state(false);
  async function npcAction(payload: Record<string, unknown>) {
    actionMessage = '';
    try {
      const response = await fetch('/api/npcs/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      return body;
    } catch (cause) { actionMessage = cause instanceof Error ? cause.message : 'That action could not be completed.'; return null; }
  }
  async function dismiss() { if (!selected) return; const result = await npcAction({ action: 'dismiss', instanceId: selected.instanceId }); if (result) window.location.assign('/bar'); }
  async function report() { if (!selected) return; const result = await npcAction({ action: 'report', versionId: selected.versionId, category: 'player report', evidence: reportEvidence }); if (result) { reportOpen = false; reportEvidence = ''; actionMessage = result.message; } }
  async function previewShare() { if (!selected) return; const result = await npcAction({ action: 'share-preview', instanceId: selected.instanceId }); if (result) sharePreview = result.preview; }
  async function share() { if (!sharePreview || !selected) return; const result = await npcAction({ action: 'share', instanceId: selected.instanceId, contentHash: sharePreview.contentHash, includeDisplayName }); if (result) actionMessage = `Share link: /shares/${result.token}`; }
</script>

<aside class="tavern-rail guest-inspector" aria-labelledby="current-guest-title">
  <div class="rail-title"><p class="eyebrow">Current guest</p><h2 id="current-guest-title">{selected?.name ?? 'No guest at the bar'}</h2><p>{selected?.title ?? 'The common room is quiet.'}</p></div>
  <button class="text-button" type="button" onclick={() => onarchive(!archived)}>{archived ? 'Back to active guests' : 'View dismissed guests'}</button>
  {#if selected && journal}
    <section class="guest-section" aria-label="Relationship">
      <div class="relationship-label"><span>Relationship</span><strong>{selected.relationship} / 100</strong></div>
    <meter min="0" max="100" value={selected.relationship}>{selected.relationship}</meter>
    </section>
    <section class="guest-section">
    <p class="eyebrow">Current quest</p>
    {#if journal.currentQuest}
      <h3>{journal.currentQuest.title}</h3><p>{journal.currentQuest.objective}</p>
      {#if journal.questLifecycleStatus === 'active'}<p class="quest-readiness">{journal.currentQuest.readiness} readiness · {journal.currentQuest.risk} risk</p><p class="muted">Food and drink can help readiness.</p>{/if}
    {:else}<p class="muted">No active intention.</p>{/if}
    {#if journal.questLifecycleStatus === 'awaiting_transition'}<p class="muted">Considering their next step.</p>{/if}
    {#if journal.questLifecycleStatus === 'departing'}<p class="consequence-warning" role="note">Leaving after the tavern closes.</p>{/if}
    {#if journal.farewellText}<p class="consequence-warning" role="note">{journal.farewellText}</p>{/if}
    </section>
    {#if journal.disposition}
      <section class="guest-section" aria-label="How they seem lately">
        <p class="eyebrow">How they seem lately</p>
        <p>{journal.disposition.summary}</p>
      </section>
    {/if}
    {#if journal.evolution.length}
      <section class="guest-section" aria-label="What shaped them">
        <p class="eyebrow">What shaped them</p>
        <ul>{#each journal.evolution as entry (`${entry.createdAt}:${entry.profileRevision}`)}<li><small>Day {entry.day}</small> {entry.disposition.summary}</li>{/each}</ul>
      </section>
    {/if}
    <section class="guest-section">
    <p class="eyebrow">Conversation context</p>
    <p>{selected.description}</p>
    {#if selected.creator}<p class="eyebrow story-origin">Community NPC</p><p class="muted">Created by <a href={`/creators/${selected.creator.profile}`}>{selected.creator.displayName}</a></p>{:else}<p class="eyebrow story-origin">Tavern resident</p>{/if}
    </section>
  {:else}
    <section class="guest-section"><p class="muted">Choose a guest in the illustrated room to see their relationship, quest, and conversation context.</p></section>
  {/if}
  <section class="guest-section hospitality-counts" aria-label="Hospitality inventory">
    <p class="eyebrow">Ready to offer</p>
    <div><span><strong>{stock.beverages.length}</strong> drinks</span><span><strong>{stock.foods.length}</strong> foods</span></div>
  </section>
  {#if selected}<section class="guest-section guest-safety" aria-label="Guest controls">
    <p class="eyebrow">Guest controls</p>
    <details><summary>Dismiss from this tavern</summary><p class="muted">This removes this resident from this save. Their historical record remains.</p><button type="button" class="text-button danger" onclick={dismiss}>Confirm dismissal</button></details>
    <details bind:open={reportOpen}><summary>Report this NPC</summary><p class="consequence-warning" role="note">Submitting attaches the full conversation transcript and frozen encountered-version metadata for reviewer evidence.</p><label for="npc-report">What needs review?</label><textarea id="npc-report" bind:value={reportEvidence} maxlength="2000" rows="3"></textarea><button type="button" class="text-button" disabled={!reportEvidence.trim()} onclick={report}>Submit report</button></details>
    <details><summary>Share conversation</summary><p class="muted">Preview the exact transcript before sharing. A created link is immutable and cannot be revoked.</p>{#if !sharePreview}<button type="button" class="text-button" onclick={previewShare}>Preview share</button>{:else}<p>{sharePreview.transcript.length} transcript entries will be shared exactly as shown.</p><div class="share-preview" aria-label="Exact conversation share preview">{#each sharePreview.transcript as entry,index (index)}<pre>{JSON.stringify(entry, null, 2)}</pre>{/each}</div><label><input type="checkbox" bind:checked={includeDisplayName} /> Include my display name</label><button type="button" class="text-button" onclick={share}>Create immutable link</button>{/if}</details>
    {#if actionMessage}<p class="form-message" role="status">{actionMessage}</p>{/if}
  </section>{/if}
</aside>
