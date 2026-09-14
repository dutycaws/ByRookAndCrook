<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { AuthoringCapabilities, AuthoringPreflightIssue, AuthoringVersionHistory } from '$lib/game/authoring-workspace';
  let { revision, versions, preflight, capability }: { revision: number; versions: AuthoringVersionHistory[]; preflight: AuthoringPreflightIssue[]; capability: AuthoringCapabilities } = $props();
  let submitting = $state(false);
  let resolvingComment = $state<string | null>(null);
  function submit(): SubmitFunction { return () => { submitting = true; return async ({ update }) => { await update({ reset: false, invalidateAll: true }); submitting = false; }; }; }
  function resolveComment(commentId: string): SubmitFunction { return () => { resolvingComment = commentId; return async ({ update }) => { await update({ reset: false, invalidateAll: true }); resolvingComment = null; }; }; }
  const nextVersion = $derived(Math.max(0, ...versions.map((version) => version.number)) + 1);
</script>

<section class="workspace-panel history-panel" aria-labelledby="history-heading">
  <div class="workspace-panel-heading"><span class="workspace-step">07</span><div><p class="eyebrow">Review the work</p><h2 id="history-heading">Status and history</h2><p>Submitting freezes an immutable version for automated checks and reviewer judgment.</p></div></div>
  {#if preflight.length}<div class="workspace-callout warning" role="alert"><strong>Finish these before submitting</strong><ul>{#each preflight as issue}<li><a href={`#${issue.focusId}`}>{issue.sectionLabel}: {issue.message}</a></li>{/each}</ul></div>{/if}
  {#if capability.canSubmit}<form method="POST" action="?/submit" use:enhance={submit()} class="submission-bar"><input type="hidden" name="revision" value={revision} /><div><strong>{preflight.length ? 'Submission is not ready' : `Ready to submit version ${nextVersion}`}</strong><span>{preflight.length ? 'Resolve the listed prerequisites, then submit.' : 'The submitted version cannot be edited.'}</span></div><button class="primary-action" disabled={submitting || preflight.length > 0}>{submitting ? `Submitting version ${nextVersion}…` : `Submit version ${nextVersion}`}</button></form>{:else}<div class="workspace-callout unavailable"><strong>Submission is unavailable</strong><span>{capability.reasons.submit ?? 'This draft cannot be submitted right now.'}</span></div>{/if}
  <div class="version-timeline" aria-live="polite">
    {#if versions.length}
      {#each versions as version (version.id)}
        <article class="version-card">
          <header><div><span class="eyebrow">Version {version.number}</span><h3>{version.evaluation.state === 'pending' ? 'Checks in progress' : version.evaluation.state === 'passed' ? 'Checks passed' : version.evaluation.state === 'blocked' ? 'Needs author attention' : 'Checks could not complete'}</h3></div><span class="status-pill">{version.evaluation.state}</span></header>
          <p class="workspace-muted">{version.submittedAt ? `Submitted ${new Date(version.submittedAt).toLocaleString()}` : 'Submission recorded'}</p>
          {#if version.evaluation.hardBlocks.length}<section class="evaluation-list blocked"><h4>Hard blocks</h4><ul>{#each version.evaluation.hardBlocks as item}<li>{item}</li>{/each}</ul></section>{/if}
          {#if version.evaluation.advisories.length}<section class="evaluation-list"><h4>Advisories</h4><ul>{#each version.evaluation.advisories as item}<li>{item}</li>{/each}</ul></section>{/if}
          {#if version.reviewerDecision}<section class="reviewer-decision"><h4>Reviewer decision: {version.reviewerDecision.decision}</h4><p>{version.reviewerDecision.notes || 'No additional reviewer notes.'}</p></section>{/if}
          {#each version.comments as comment (comment.id)}<div class:resolved={comment.resolved} class="review-comment"><strong>{comment.sectionLabel}</strong><p>{comment.body}</p><div class="review-comment-footer"><span>{comment.resolved ? 'Resolved' : 'Open comment'}</span>{#if !comment.resolved && capability.canEdit}<form method="POST" action="?/resolveComment" use:enhance={resolveComment(comment.id)}><input type="hidden" name="commentId" value={comment.id} /><button class="secondary-action" disabled={resolvingComment !== null}>{resolvingComment === comment.id ? 'Resolving…' : 'Mark resolved'}</button></form>{/if}</div></div>{/each}
        </article>
      {/each}
    {:else}
      <p class="workspace-empty">No versions submitted yet. When you submit this draft, its immutable versions and review status will appear here.</p>
    {/if}
  </div>
</section>
