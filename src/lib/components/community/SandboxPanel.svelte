<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { AuthoringCapabilities, AuthoringProviderState, AuthoringSandbox } from '$lib/game/authoring-workspace';
  type SandboxCollection = { active: AuthoringSandbox | null; preserved: AuthoringSandbox[] };
  let { revision, capability, provider, sandbox, quota }: { revision: number; capability: AuthoringCapabilities; provider: AuthoringProviderState; sandbox: SandboxCollection; quota: number | null } = $props();
  let pending = $state(false);
  const current = $derived(sandbox.active);
  function submit(): SubmitFunction { return () => { pending = true; return async ({ update }) => { await update({ reset: false, invalidateAll: true }); pending = false; }; }; }
</script>

<section class="workspace-panel sandbox-panel" aria-labelledby="sandbox-heading">
  <div class="workspace-panel-heading"><span class="workspace-step">06</span><div><p class="eyebrow">Try the voice</p><h2 id="sandbox-heading">Draft-pinned sandbox</h2><p>Private practice dialogue uses this draft only. It cannot change the game world or canonical sheet.</p></div></div>
  {#if !provider.available}<div class="workspace-callout unavailable" role="status"><strong>Sandbox is unavailable</strong><span>{provider.reason ?? 'The current provider is not configured for authoring.'}</span></div>
  {:else if !capability.canUseSandbox}<div class="workspace-callout unavailable" role="status"><strong>Sandbox is unavailable for this draft</strong><span>{capability.reasons.sandbox ?? 'This draft cannot start a sandbox right now.'}</span></div>
  {:else}
    {#if current?.turns.length}<div class="sandbox-transcript" aria-live="polite">{#each current.turns as turn (turn.id)}<article class:npc={turn.role === 'npc'} class:pending-turn={turn.status === 'pending'}><span>{turn.role === 'keeper' ? 'Tavern keeper' : 'Your NPC'}</span><p>{turn.content || (turn.status === 'pending' ? 'Thinking…' : 'No reply was returned.')}</p></article>{/each}</div>{:else}<p class="workspace-empty">Start a private exchange to see how this draft responds. The conversation is saved with this revision.</p>{/if}
    {#if sandbox.preserved.length}<div class="workspace-callout"><strong>Earlier conversations are preserved</strong><span>Saving a draft closes its sandbox. You can review those transcripts below while starting fresh on revision {revision}.</span></div>{/if}
    <form method="POST" action="?/sandbox" use:enhance={submit()} class="workspace-form"><input type="hidden" name="revision" value={revision} /><label>{current?.turns.length ? 'Continue the conversation' : 'A message from the tavern keeper'}<textarea name="message" minlength="1" maxlength="2000" required placeholder="How are preparations going?" disabled={pending || !!current?.pending}></textarea></label><div class="workspace-form-footer"><small>{quota === null ? 'Daily sandbox limit is available.' : `${quota} turns remain today.`}</small><button disabled={pending || !!current?.pending}>{pending || current?.pending ? 'Waiting for response…' : current?.turns.length ? 'Send message' : 'Start sandbox'}</button></div></form>
  {/if}
  {#if sandbox.preserved.length}<details class="preserved-sandboxes"><summary>Earlier sandbox transcripts ({sandbox.preserved.length})</summary>{#each sandbox.preserved as previous (previous.id)}<article><h3>Revision {previous.draftRevision}</h3>{#each previous.turns as turn (turn.id)}<p><strong>{turn.role === 'keeper' ? 'Keeper' : 'NPC'}:</strong> {turn.content}</p>{/each}</article>{/each}</details>{/if}
</section>
