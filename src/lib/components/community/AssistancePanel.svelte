<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { AuthoringAssistance, AuthoringCapabilities, AuthoringProviderState, AuthoringSection } from '$lib/game/authoring-workspace';

  let { revision, capability, provider, assistance, quota }: {
    revision: number;
    capability: AuthoringCapabilities;
    provider: AuthoringProviderState;
    assistance: AuthoringAssistance[];
    quota: number | null;
  } = $props();

  let pending = $state<string | null>(null);
  const sections: Array<{ value: AuthoringSection; label: string }> = [
    { value: 'identity', label: 'Introduction' }, { value: 'appearance', label: 'Appearance' },
    { value: 'personality', label: 'Personality' }, { value: 'lore', label: 'Their world and what they reveal' },
    { value: 'skills', label: 'Skills' }, { value: 'campaign', label: 'Their story arc' }
  ];
  function submit(label: string): SubmitFunction {
    return () => {
      pending = label;
      return async ({ update }) => { await update({ reset: false, invalidateAll: true }); pending = null; };
    };
  }
</script>

<section class="workspace-panel" aria-labelledby="assistance-heading">
  <div class="workspace-panel-heading"><span class="workspace-step">05</span><div><p class="eyebrow">Try a refinement</p><h2 id="assistance-heading">Section assistance</h2><p>Ask for one focused change. Suggestions never alter the draft until you apply them.</p></div></div>
  {#if !provider.available}
    <div class="workspace-callout unavailable" role="status"><strong>Assistance is unavailable</strong><span>{provider.reason ?? 'The current provider is not configured for authoring.'}</span></div>
  {:else if !capability.canRequestAssistance}
    <div class="workspace-callout unavailable" role="status"><strong>Assistance is unavailable for this draft</strong><span>{capability.reasons.assistance ?? 'This draft cannot request assistance right now.'}</span></div>
  {:else}
    <form method="POST" action="?/assist" use:enhance={submit('request')} class="workspace-form">
      <input type="hidden" name="revision" value={revision} />
      <label>What should be improved?
        <select name="section" aria-label="Section to improve">{#each sections as section}<option value={section.value}>{section.label}</option>{/each}</select>
      </label>
      <label>Direction for the suggestion<textarea name="instruction" minlength="1" maxlength="2000" required placeholder="For example: make their boundaries clearer without changing their values."></textarea></label>
      <div class="workspace-form-footer"><small>{quota === null ? 'Daily request limit is available.' : `${quota} requests remain today.`}</small><button type="submit" disabled={pending !== null}>{pending === 'request' ? 'Creating suggestion…' : 'Create suggestion'}</button></div>
    </form>
  {/if}

  <div class="workspace-list" aria-live="polite">
    {#each assistance as suggestion (suggestion.id)}
      <article class:outdated={suggestion.state === 'outdated'} class="assistance-card">
        <header><div><span class="eyebrow">{suggestion.sectionLabel}</span><h3>{suggestion.state === 'suggested' ? 'Suggestion ready' : suggestion.state === 'creating' ? 'Preparing a suggestion' : suggestion.state === 'outdated' ? 'Suggestion is out of date' : suggestion.state === 'applied' ? 'Suggestion applied' : suggestion.state === 'discarded' ? 'Suggestion discarded' : suggestion.state === 'no_change' ? 'No useful change proposed' : 'Suggestion unavailable'}</h3></div><span class="status-pill">{suggestion.state.replaceAll('_', ' ')}</span></header>
        {#if suggestion.explanation}<p>{suggestion.explanation}</p>{/if}
        {#if suggestion.reason}<p class="workspace-muted">{suggestion.reason.replaceAll('_', ' ')}</p>{/if}
        {#if suggestion.comparison.length}
          <div class="assistance-comparison">{#each suggestion.comparison as row}<section><h4>{row.label}</h4><div><strong>Current</strong>{#if row.current.length}<ul>{#each row.current as item}<li>{item}</li>{/each}</ul>{:else}<span>Not yet described</span>{/if}</div><div><strong>Suggested</strong>{#if row.suggested.length}<ul>{#each row.suggested as item}<li>{item}</li>{/each}</ul>{:else}<span>No change suggested</span>{/if}</div></section>{/each}</div>
        {/if}
        {#if suggestion.actionable}
          <form method="POST" action="?/disposition" use:enhance={submit(suggestion.id)} class="workspace-actions"><input type="hidden" name="eventId" value={suggestion.id} /><input type="hidden" name="revision" value={revision} /><button name="accept" value="true" disabled={pending !== null}>Apply suggestion</button><button class="secondary-action" name="accept" value="false" disabled={pending !== null}>Discard</button></form>
        {:else if suggestion.state === 'outdated'}<p class="workspace-muted">This was based on an earlier revision and cannot be applied.</p>{/if}
      </article>
    {:else}<p class="workspace-empty">No suggestions yet. Ask for a focused refinement when you want a second set of eyes.</p>{/each}
  </div>
</section>
