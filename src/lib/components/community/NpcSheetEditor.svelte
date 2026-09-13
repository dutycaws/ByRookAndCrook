<script lang="ts">
  import type { NpcSheet } from '$lib/game/npc-sheet';
  import { prettyJson } from '$lib/game/community-npc-ui';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { onMount } from 'svelte';
  let { sheet, revision, editable = true, conflict = false, message = '' }: { sheet: NpcSheet; revision: number; editable?: boolean; conflict?: boolean; message?: string } = $props();
  let formElement: HTMLFormElement; let status = $state('Saved'); let frozen = $state(false); let hydrated = $state(false); let debounce: ReturnType<typeof setTimeout> | undefined;
  const statusTone = () => conflict || frozen || status.includes('failed') || status.includes('Conflict') ? 'danger' : status === 'Saving…' ? 'working' : 'ready';
  $effect(() => {
    if (!editable) status = 'Read-only';
    if (conflict) { frozen = true; status = 'Conflict — refresh before editing'; }
  });
  onMount(() => { hydrated = true; });
  function schedule() { if (!hydrated || !editable || frozen) return; status = 'Saving…'; if (debounce) clearTimeout(debounce); debounce = setTimeout(() => formElement.requestSubmit(), 750); }
  const autosave: SubmitFunction = () => async ({ result, update }) => {
    if (result.type === 'failure') {
      await update({ reset: false, invalidateAll: false });
      const data = result.data as { conflict?: boolean; message?: string } | undefined;
      if (data?.conflict) {
        frozen = true;
        status = 'Conflict — refresh before editing';
      } else status = data?.message ?? 'Save failed';
      return;
    }
    await update({ reset: false, invalidateAll: true });
    status = 'Saved';
  };
</script>

{#if message}<p class="community-notice" class:community-error={conflict} role={conflict ? 'alert' : 'status'}>{message}</p>{/if}
{#if !editable}<p class="community-notice npc-editor-readonly" role="status">This immutable submitted draft is read-only. Reviewer decisions may open a new revision.</p>{/if}
<form bind:this={formElement} method="POST" action="?/save" class:has-conflict={conflict || frozen} class="npc-editor" use:enhance={autosave} oninput={schedule}>
  <input type="hidden" name="revision" value={revision} />
  <div class="npc-editor-toolbar" aria-label="Draft save status">
    <div><span class="eyebrow">Draft revision {revision}</span><p class="autosave-status {statusTone()}" aria-live="polite">{status}</p></div>
    {#if editable && !frozen}<p class="autosave-helper">Your changes save automatically after a short pause.</p>{/if}
  </div>
  <fieldset disabled={!hydrated || !editable || frozen}>
  <section class="editor-section identity-section"><div class="editor-section-heading"><span>01</span><div><h2>Identity</h2><p>The public-facing introduction and the boundaries of the character's voice.</p></div></div><div class="editor-fields two-column"><label>Name <input name="name" value={sheet.identity.name} required /></label><label>Title <input name="title" value={sheet.identity.title} required /></label></div><div class="editor-fields"><label>Short description <textarea name="shortDescription" required>{sheet.identity.shortDescription}</textarea></label><label>Voice and speech rules <textarea name="voice" required>{sheet.identity.voice}</textarea></label><label>Audience <select name="rating"><option value="standard" selected={sheet.rating === 'standard'}>Standard</option><option value="mature" selected={sheet.rating === 'mature'}>Mature</option></select></label></div></section>
  <section class="editor-section"><div class="editor-section-heading"><span>02</span><div><h2>Appearance</h2><p>Concrete details give the scene artist and dialogue writer a shared visual anchor.</p></div></div><div class="editor-fields two-column"><label>Physical appearance <textarea name="physicalAppearance" required>{sheet.appearance.physicalAppearance}</textarea></label><label>Attire <textarea name="attire" required>{sheet.appearance.attire}</textarea></label><label>Notable features <textarea name="notableFeatures" required>{sheet.appearance.notableFeatures}</textarea></label><label>Default mood <textarea name="mood" required>{sheet.appearance.mood}</textarea></label></div></section>
  <section class="editor-section"><div class="editor-section-heading"><span>03</span><div><h2>Personality</h2><p>One item per line. These are authored constraints, not suggestions for the model to ignore.</p></div></div><div class="editor-fields two-column">{#each Object.entries(sheet.personality) as [name, entries]}<label>{name}<textarea name={name} required>{entries.join('\n')}</textarea></label>{/each}</div></section>
  <section class="editor-section"><div class="editor-section-heading"><span>04</span><div><h2>Lore</h2><p>Supporting entities, facts, and relationships are explicit records. Keep secrets behind trust thresholds.</p></div></div><div class="editor-fields"><label>Supporting entities <textarea name="entities">{prettyJson(sheet.lore.entities)}</textarea></label><label>Facts <textarea name="facts">{prettyJson(sheet.lore.facts)}</textarea></label><label>Relationships <textarea name="relationships">{prettyJson(sheet.lore.relationships)}</textarea></label><label>NPC UUID references <textarea name="npcReferences">{prettyJson(sheet.lore.npcReferences)}</textarea></label></div></section>
  <section class="editor-section"><div class="editor-section-heading"><span>05</span><div><h2>Skills</h2><p>Scores total 10, include one 4, and one score of 1 or lower.</p></div></div><div class="skill-grid">{#each Object.entries(sheet.skills) as [skill, score]}<label>{skill}<input name={'skill-' + skill} type="number" min="0" max="4" step="1" value={score} required /></label>{/each}</div></section>
  <section class="editor-section"><div class="editor-section-heading"><span>06</span><div><h2>Campaign</h2><p>Define the durable pull and at least two bounded milestones before submitting for review.</p></div></div><div class="editor-fields"><label>Durable goal <textarea name="durableGoal" required>{sheet.campaign.durableGoal}</textarea></label><label>Ordered milestones (at least two). Each includes targets, difficulty, outcomes, and a bounded starting plan.<textarea name="milestones" required>{prettyJson(sheet.campaign.milestones)}</textarea></label></div></section>
  <div class="npc-editor-footer"><p>Saving keeps this revision editable. Submission freezes a reviewed snapshot.</p><button class="primary-action" type="submit">Save draft revision {revision}</button></div>
  </fieldset>
</form>
