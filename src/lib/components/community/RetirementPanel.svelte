<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { AuthoringCapabilities, AuthoringRetirement } from '$lib/game/authoring-workspace';
  let { capability, retirement }: { capability: AuthoringCapabilities; retirement: AuthoringRetirement | null } = $props();
  let pending = $state(false);
  function submit(): SubmitFunction { return () => { pending = true; return async ({ update }) => { await update({ reset: false, invalidateAll: true }); pending = false; }; }; }
</script>

<section class="workspace-panel retirement-panel" aria-labelledby="retirement-heading">
  <div class="workspace-panel-heading"><span class="workspace-step">06</span><div><p class="eyebrow">Governed change</p><h2 id="retirement-heading">Retirement request</h2><p>Approval stops future pool sampling. It does not rewrite players’ existing world history.</p></div></div>
  {#if retirement}<div class:approved={retirement.status === 'approved'} class:rejected={retirement.status === 'rejected'} class="retirement-state"><strong>{retirement.status === 'open' ? 'Pending review' : retirement.status === 'approved' ? 'Retirement approved' : 'Retirement request declined'}</strong><p>{retirement.reason}</p>{#if retirement.decisionReason}<p><strong>Reviewer note:</strong> {retirement.decisionReason}</p>{/if}</div>{/if}
  {#if !retirement || retirement.status === 'rejected'}{#if capability.canRequestRetirement}<form method="POST" action="?/retire" use:enhance={submit()} class="workspace-form"><label>Why should this NPC be retired?<textarea name="reason" minlength="10" maxlength="2000" required placeholder="Explain the reason for reviewer consideration."></textarea></label><button disabled={pending}>{pending ? 'Requesting retirement…' : retirement ? 'Request another review' : 'Request retirement review'}</button></form>{:else}<div class="workspace-callout unavailable"><strong>Retirement is unavailable</strong><span>{capability.reasons.retirement ?? 'This NPC cannot be retired from this workspace.'}</span></div>{/if}{/if}
</section>
