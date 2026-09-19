<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { PageProps } from './$types';

  type RegistryPrompt = { key: string; name: string; purpose: string; type: string; contractId: string; modelLane: string; workflow: string; revisionId: string; revision: number; contentHash: string };
  type Revision = { id: string; revision: number; body: string; contentHash: string; createdAt?: string; createdBy?: string };
  type StagedCandidate = { id: string; key: string; revision: number; warningCodes: string[] };
  type WorkflowNode = { key: string; name: string; purpose: string; type: string; modelLane: string; contractId: string; contractHash: string; dynamicData: string; templateVariables: string[] };
  type Workflow = { workflow: string; label: string; nodes: WorkflowNode[]; edges: Array<{ from: string; to: string; kind: string }> };

  let { data, form }: PageProps = $props();
  let activeView = $state<'body' | 'edit' | 'history' | 'workflow'>('body');
  let query = $state('');
  let typeFilter = $state('all');
  let statusFilter = $state('all');
  let editorBody = $state('');
  let staged = $state<Record<string, StagedCandidate>>({});
  let releaseLabel = $state('');
  let releaseReason = $state('');
  let safetyAcknowledged = $state(false);
  let restoreReason = $state('');
  let restoreLabel = $state('');
  let restoreSafetyAcknowledged = $state(false);
  let releaseDialog: HTMLDialogElement | undefined = $state();

  const summary = $derived(data.summary as Record<string, unknown>);
  const detail = $derived(data.detail as Record<string, unknown>);
  const prompts = $derived((Array.isArray(summary.prompts) ? summary.prompts : []) as RegistryPrompt[]);
  const manifest = $derived((detail.manifest ?? {}) as Record<string, unknown>);
  const revisions = $derived((Array.isArray(detail.revisions) ? detail.revisions : []) as Revision[]);
  const releaseHistory = $derived((Array.isArray(detail.releaseHistory) ? detail.releaseHistory : []) as Array<Record<string, unknown>>);
  const activePrompt = $derived(prompts.find((prompt) => prompt.key === data.selectedKey) ?? null);
  const activeRevision = $derived(revisions.find((revision) => revision.id === activePrompt?.revisionId) ?? revisions[0] ?? null);
  const activeBody = $derived(activeRevision?.body ?? '');
  const variables = $derived((Array.isArray(manifest.template_variables) ? manifest.template_variables : []) as string[]);
  const selectedWorkflow = $derived((data.workflows as Workflow[]).find((workflow) => workflow.workflow === data.selectedWorkflow) ?? (data.workflows as Workflow[])[0]);
  const selectedRunEvents = $derived((data.runs as Array<Record<string, unknown>>).filter((run) => String(run.executionId) === data.selectedRun));
  const selectedRun = $derived(selectedRunEvents[0] ?? null);
  const codeOnlyNodes = $derived(selectedWorkflow ? [...new Set(selectedWorkflow.edges.flatMap((edge) => [edge.from, edge.to]).filter((node) => !selectedWorkflow.nodes.some((prompt) => prompt.key === node)))] : []);
  const filteredPrompts = $derived(prompts.filter((prompt) => {
    const haystack = `${prompt.key} ${prompt.name} ${prompt.purpose} ${prompt.workflow} ${prompt.modelLane}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (typeFilter === 'all' || prompt.type === typeFilter) && (statusFilter === 'all' || (statusFilter === 'staged' ? !!staged[prompt.key] : statusFilter === 'active'));
  }));
  const stagedCandidates = $derived(Object.values(staged));
  const stagedWarnings = $derived(stagedCandidates.flatMap((candidate) => candidate.warningCodes));
  const editorBytes = $derived(new TextEncoder().encode(editorBody).byteLength);
  const localTemplateError = $derived(templateError(editorBody, variables));

  function linkFor(params: Record<string, string | undefined>) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    return `?${search.toString()}`;
  }
  function openEditor() { editorBody = activeBody; activeView = 'edit'; }
  function templateError(body: string, required: string[]) {
    if (new TextEncoder().encode(body).byteLength > 32768) return 'A prompt body must be at most 32 KiB.';
    if (!body.trim()) return 'A prompt body cannot be empty.';
    const found = [...body.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map((match) => match[1]);
    const unknown = found.find((item) => !required.includes(item));
    if (unknown) return `{{${unknown}}} is not a registered template variable.`;
    for (const variable of required) if (found.filter((item) => item === variable).length !== 1) return `{{${variable}}} must appear exactly once.`;
    return '';
  }
  function addCandidate(candidate: Record<string, unknown>) {
    if (!activePrompt || typeof candidate.revisionId !== 'string') return;
    staged = { ...staged, [activePrompt.key]: { id: candidate.revisionId, key: activePrompt.key, revision: Number(candidate.revision ?? 0), warningCodes: Array.isArray(candidate.warningCodes) ? candidate.warningCodes.filter((value): value is string => typeof value === 'string') : [] } };
  }
  function candidateEnhance(): SubmitFunction {
    return () => async ({ result, update }) => {
      if (result.type === 'success') addCandidate((result.data as Record<string, unknown>).candidate as Record<string, unknown>);
      await update({ reset: false, invalidateAll: true });
    };
  }
  function activationEnhance(): SubmitFunction {
    return () => async ({ result, update }) => {
      if (result.type === 'success') { staged = {}; safetyAcknowledged = false; releaseDialog?.close(); }
      await update({ reset: false, invalidateAll: true });
    };
  }
  function diffRows(before: string, after: string) {
    const oldLines = before.split('\n'); const newLines = after.split('\n'); const count = Math.max(oldLines.length, newLines.length);
    return Array.from({ length: count }, (_, index) => ({ line: index + 1, before: oldLines[index] ?? '', after: newLines[index] ?? '', changed: oldLines[index] !== newLines[index] }));
  }
  function nodeLabel(node: string) {
    if (selectedWorkflow?.nodes.some((item) => item.key === node)) return selectedWorkflow.nodes.find((item) => item.key === node)?.name ?? node;
    return node.replaceAll('.', ' · ').replaceAll('_', ' ');
  }
  function runEventFor(node: string) {
    return selectedRunEvents.find((event) => String(event.node) === node || String(event.promptKey) === node);
  }
</script>

<main class="page-shell community-page prompt-registry-page">
  <header class="prompt-registry-masthead">
    <div>
      <p class="eyebrow">Privileged model control plane</p>
      <h1>Prompt registry</h1>
      <p>Manage immutable prompt revisions and release them together. Models, tools, schemas, provider endpoints, image constraints, and workflow topology remain code-owned.</p>
    </div>
    <div class="prompt-release-summary">
      <span class="status-pill">Active release {String(summary.releaseNumber ?? '—')}</span>
      <strong>{String(summary.label ?? 'Registry unavailable')}</strong>
      <small>Activation affects newly started work only. Queued, running, retried, and historical work remain pinned.</small>
    </div>
  </header>

  {#if form?.message}
    <p class:community-error={form.conflict} class:community-success={!form.conflict} class="community-notice" role={form.conflict ? 'alert' : 'status'} aria-live="polite">{form.message}</p>
  {/if}

  <section class="prompt-registry-workbench" aria-label="Prompt registry workspace">
    <aside class="prompt-registry-rail workspace-panel" aria-label="Prompt search and registry list">
      <div class="workspace-panel-heading"><span class="workspace-step">01</span><div><p class="eyebrow">Registered call sites</p><h2>Find a prompt</h2><p>{prompts.length} closed, code-owned prompt keys.</p></div></div>
      <label>Search prompts<input bind:value={query} placeholder="Key, purpose, workflow…" /></label>
      <fieldset class="prompt-filter-set"><legend>Filter registry</legend><label>Type<select bind:value={typeFilter}><option value="all">All prompt types</option><option value="text_system">Text system</option><option value="image_template">Image template</option></select></label><label>Status<select bind:value={statusFilter}><option value="all">All statuses</option><option value="active">Active release</option><option value="staged">Staged in this browser</option></select></label></fieldset>
      <nav class="prompt-list" aria-label="Registered prompts">
        {#each filteredPrompts as prompt (prompt.key)}
          <a class:current={prompt.key === data.selectedKey} href={linkFor({ key: prompt.key, workflow: prompt.workflow })} aria-current={prompt.key === data.selectedKey ? 'page' : undefined}>
            <span><strong>{prompt.name}</strong><small>{prompt.key}</small></span><span class="prompt-list-meta"><small>{prompt.modelLane}</small><b>r{prompt.revision}</b>{#if staged[prompt.key]}<em>staged</em>{/if}</span>
          </a>
        {:else}<p class="workspace-empty">No registered prompts match these filters.</p>{/each}
      </nav>
    </aside>

    <section class="prompt-detail-panel workspace-panel" aria-labelledby="prompt-detail-heading">
      {#if activePrompt && activeRevision}
        <div class="workspace-panel-heading"><span class="workspace-step">02</span><div><p class="eyebrow">{activePrompt.type === 'image_template' ? 'Image template' : 'System message'}</p><h2 id="prompt-detail-heading">{activePrompt.name}</h2><p>{activePrompt.purpose}</p></div></div>
        <dl class="prompt-facts"><div><dt>Stable key</dt><dd><code>{activePrompt.key}</code></dd></div><div><dt>Active revision</dt><dd>r{activePrompt.revision}</dd></div><div><dt>Model lane</dt><dd>{activePrompt.modelLane}</dd></div><div><dt>Output contract</dt><dd><code>{activePrompt.contractId}</code></dd></div><div><dt>Content hash</dt><dd><code title={activePrompt.contentHash}>{activePrompt.contentHash.slice(0, 16)}…</code></dd></div><div><dt>Dynamic data</dt><dd>{String(manifest.dynamic_data ?? 'server-only')}</dd></div></dl>
        <p class="prompt-code-boundary"><strong>Code-owned boundary:</strong> The message role, provider/model, tools, response schema, parser, limits, endpoint, image size/format/reference assets, and workflow are shown for orientation but cannot be edited here.</p>
        <div class="prompt-view-controls" role="group" aria-label="Selected prompt view"><button class:secondary-action={activeView !== 'body'} type="button" onclick={() => activeView = 'body'}>Active body</button><button class:secondary-action={activeView !== 'edit'} type="button" onclick={openEditor}>Create revision</button><button class:secondary-action={activeView !== 'history'} type="button" onclick={() => activeView = 'history'}>History & compare</button><button class:secondary-action={activeView !== 'workflow'} type="button" onclick={() => activeView = 'workflow'}>Workflow context</button></div>

        {#if activeView === 'body'}
          <section class="prompt-body-view" aria-label="Active prompt body"><p class="eyebrow">Immutable active body · revision {activeRevision.revision}</p><pre>{activeBody}</pre></section>
        {:else if activeView === 'edit'}
          <form method="POST" action="?/candidate" use:enhance={candidateEnhance()} class="prompt-editor-form">
            <input type="hidden" name="key" value={activePrompt.key} /><input type="hidden" name="parentRevisionId" value={activeRevision.id} />
            <label>Complete prompt body<textarea name="body" bind:value={editorBody} spellcheck="true" required aria-describedby="prompt-editor-help">{editorBody}</textarea></label>
            <div id="prompt-editor-help" class="prompt-editor-meta"><span>{editorBytes.toLocaleString()} / 32,768 bytes</span><span>Dynamic data remains a separate bounded payload.</span></div>
            {#if variables.length}<aside class="workspace-callout" aria-label="Required template variables"><strong>Required template variables</strong><span>Keep each variable exactly once: {variables.map((variable) => `{{${variable}}}`).join(', ')}.</span></aside>{/if}
            {#if localTemplateError}<p class="workspace-callout warning" role="alert">{localTemplateError}</p>{/if}
            <label>Change note<textarea name="changeNote" minlength="1" maxlength="1000" required placeholder="Explain the wording change and why it is safe."></textarea></label>
            <div class="workspace-form-footer"><small>Saving creates an immutable candidate. It has no runtime effect until it is included in an activated release.</small><button disabled={!!localTemplateError}>Create candidate revision</button></div>
          </form>
        {:else if activeView === 'history'}
          <section class="prompt-history" aria-label="Prompt revision history">
            <h3>Unified comparison</h3><p class="workspace-muted">Active revision r{activeRevision.revision} compared with the current editor body or the selected historical body.</p>
            <div class="prompt-diff" aria-label="Unified prompt diff">{#each diffRows(activeBody, editorBody || activeBody) as row (row.line)}<div class:changed={row.changed}><span>{row.line}</span><del>{row.before || ' '}</del><ins>{row.after || ' '}</ins></div>{/each}</div>
            <h3>Immutable revision history</h3><div class="prompt-history-list">{#each revisions as revision (revision.id)}<article class:active={revision.id === activeRevision.id}><div><strong>Revision {revision.revision}</strong><code>{revision.contentHash.slice(0, 16)}…</code></div><button type="button" class="secondary-action" onclick={() => { editorBody = revision.body; activeView = 'history'; }}>Compare</button></article>{/each}</div>
            <h3>Release history</h3><div class="prompt-history-list">{#each releaseHistory as release (String(release.releaseId))}<article><div><strong>Release {String(release.releaseNumber)}</strong><small>{String(release.label ?? 'Untitled release')}</small></div><button type="button" class="secondary-action" onclick={() => { restoreLabel = `Restore release ${String(release.releaseNumber)}`; restoreReason = ''; }}>Prepare restore</button></article>{/each}</div>
            {#if restoreLabel}<form method="POST" action="?/restore" class="prompt-restore-form"><input type="hidden" name="expectedReleaseId" value={String(summary.activeReleaseId ?? '')} /><input type="hidden" name="restoreReleaseId" value={String(releaseHistory.find((release) => `Restore release ${String(release.releaseNumber)}` === restoreLabel)?.releaseId ?? '')} /><label>New release label<input name="label" bind:value={restoreLabel} required /></label><label>Restore reason<textarea name="reason" bind:value={restoreReason} required placeholder="Why should this historical version become the next release?"></textarea></label><label class="prompt-check"><input type="checkbox" name="acknowledgeSafety" value="true" bind:checked={restoreSafetyAcknowledged} /> I acknowledge any safety-language warnings carried by this historical release.</label><button disabled={!restoreReason.trim()}>Restore in new release</button></form>{/if}
          </section>
        {:else}
          <section class="prompt-workflow-context"><p>This prompt belongs to <strong>{activePrompt.workflow.replaceAll('_', ' ')}</strong>. Select its workflow below to inspect the code-owned path and its branch conditions.</p><a class="primary-action" href={linkFor({ key: activePrompt.key, workflow: activePrompt.workflow, run: undefined })}>Open workflow explorer</a></section>
        {/if}
      {:else}<p class="workspace-empty">The selected registered prompt is unavailable.</p>{/if}
    </section>

    <aside class="prompt-release-tray workspace-panel" aria-labelledby="release-tray-heading">
      <div class="workspace-panel-heading"><span class="workspace-step">03</span><div><p class="eyebrow">Atomic release</p><h2 id="release-tray-heading">Release tray</h2><p>{stagedCandidates.length ? `${stagedCandidates.length} candidate${stagedCandidates.length === 1 ? '' : 's'} staged in this browser.` : 'Create a candidate, then stage it here.'}</p></div></div>
      <p class="workspace-callout"><strong>Expected active release</strong><span>R{String(summary.releaseNumber ?? '—')} · only a matching active release can be replaced.</span></p>
      <div class="prompt-staged-list">{#each stagedCandidates as candidate (candidate.key)}<article><div><strong>{candidate.key}</strong><small>Candidate r{candidate.revision}</small>{#if candidate.warningCodes.length}<em>Safety acknowledgement required</em>{/if}</div><button class="secondary-action" type="button" onclick={() => { const copy = { ...staged }; delete copy[candidate.key]; staged = copy; }}>Remove</button></article>{:else}<p class="workspace-empty">No candidates are staged. Candidate revisions remain immutable even if removed from this tray.</p>{/each}</div>
      {#if stagedCandidates.length}
        <form method="POST" action="?/activate" use:enhance={activationEnhance()} class="prompt-activation-form">
          <input type="hidden" name="expectedReleaseId" value={String(summary.activeReleaseId ?? '')} /><input type="hidden" name="candidates" value={JSON.stringify(Object.fromEntries(stagedCandidates.map((candidate) => [candidate.key, candidate.id])))} /><input type="hidden" name="acknowledgements" value={JSON.stringify(safetyAcknowledged ? ['safety_language_changed'] : [])} />
          <label>Release label<input name="label" bind:value={releaseLabel} required placeholder="For example: Dialogue clarity pass" /></label><label>Release reason<textarea name="reason" bind:value={releaseReason} required placeholder="Describe why this collection should be activated together."></textarea></label>
          {#if stagedWarnings.length}<label class="prompt-check"><input type="checkbox" bind:checked={safetyAcknowledged} /> I reviewed and acknowledge the safety-language warning for each affected candidate.</label>{/if}
          <button type="button" disabled={!releaseLabel.trim() || !releaseReason.trim() || (stagedWarnings.length > 0 && !safetyAcknowledged)} onclick={() => releaseDialog?.showModal()}>Review activation</button>
          <dialog bind:this={releaseDialog} class="prompt-confirm-dialog" aria-labelledby="release-confirm-heading"><h3 id="release-confirm-heading">Activate this release?</h3><p>This replaces active release R{String(summary.releaseNumber ?? '—')} for newly started work only. Existing work remains pinned to its recorded release.</p><ul>{#each stagedCandidates as candidate}<li>{candidate.key} → revision {candidate.revision}</li>{/each}</ul><div><button type="button" class="secondary-action" onclick={() => releaseDialog?.close()}>Cancel</button><button>Activate release</button></div></dialog>
        </form>
      {/if}
    </aside>
  </section>

  <section class="workspace-panel prompt-workflow-explorer" aria-labelledby="workflow-heading">
    <div class="workspace-panel-heading"><span class="workspace-step">04</span><div><p class="eyebrow">Code-owned topology</p><h2 id="workflow-heading">Workflow explorer</h2><p>Prompt nodes open their editor. Validation, persistence, failure, and storage nodes are read-only application steps.</p></div></div>
    <div class="prompt-workflow-tabs" role="tablist" aria-label="Workflow selection">{#each data.workflows as workflow}<a role="tab" aria-selected={workflow.workflow === data.selectedWorkflow} tabindex={workflow.workflow === data.selectedWorkflow ? 0 : -1} href={linkFor({ key: data.selectedKey, workflow: workflow.workflow, run: undefined })}>{workflow.label}</a>{/each}</div>
    {#if selectedWorkflow}
      <div class="prompt-workflow-graph" aria-label={`${selectedWorkflow.label} workflow graph`}>
        <div class="prompt-graph-nodes">{#each selectedWorkflow.nodes as node (node.key)}<a class:current={node.key === data.selectedKey} class:visited={!!runEventFor(node.key)} class:failed={String(runEventFor(node.key)?.status ?? '') === 'failed'} href={linkFor({ key: node.key, workflow: selectedWorkflow.workflow, run: data.selectedRun || undefined })}><strong>{node.name}</strong><small>{node.key}</small><span>{node.modelLane} · revision {prompts.find((prompt) => prompt.key === node.key)?.revision ?? 'Legacy prompt version'}</span>{#if runEventFor(node.key)}<em>{String(runEventFor(node.key)?.status)} · attempt {String(runEventFor(node.key)?.attempt)}</em>{/if}</a>{/each}</div>
        <div class="prompt-code-nodes" aria-label="Read-only application nodes">{#each codeOnlyNodes as node (node)}<div><b>Code only</b><strong>{nodeLabel(node)}</strong><small>Validation, persistence, storage, commit, or fallback behavior remains application-owned.</small></div>{/each}</div>
        <div class="prompt-graph-edges" aria-label="Workflow transitions">{#each selectedWorkflow.edges as edge, index (`${edge.from}-${edge.to}-${index}`)}<span class={`edge-${edge.kind}`}><b>{edge.kind === 'always' ? 'Required' : edge.kind === 'conditional' ? 'Conditional' : 'Retry'}</b>{nodeLabel(edge.from)} <i>→</i> {nodeLabel(edge.to)}</span>{/each}</div>
      </div>
      <details class="prompt-workflow-outline" open><summary>Authoritative workflow sequence</summary><ol>{#each selectedWorkflow.edges as edge, index (`outline-${edge.from}-${edge.to}-${index}`)}<li><strong>{edge.kind === 'always' ? 'Required' : edge.kind === 'conditional' ? 'Conditional branch' : 'Retry path'}:</strong> {nodeLabel(edge.from)} → {nodeLabel(edge.to)}{#if edge.kind === 'conditional'} when the code-owned validation or workflow condition permits it.{:else if edge.kind === 'retry'} when the bounded retry condition is met.{:else}.{/if}</li>{/each}</ol></details>
    {/if}
  </section>

  <section class="workspace-panel prompt-execution-ledger" aria-labelledby="ledger-heading">
    <div class="workspace-panel-heading"><span class="workspace-step">05</span><div><p class="eyebrow">Privacy-safe operations</p><h2 id="ledger-heading">Recent execution ledger</h2><p>Showing up to 20 of at most 50 retained runs for this workflow. This ledger excludes prompt text, dynamic game data, outputs, private reasoning, provider errors, credentials, and storage references.</p></div></div>
    <div class="prompt-ledger-list">{#each data.runs as run (String(run.executionId) + ':' + String(run.attempt) + ':' + String(run.node))}<a class:selected={String(run.executionId) === data.selectedRun} href={linkFor({ key: data.selectedKey, workflow: data.selectedWorkflow, run: String(run.executionId) })}><span><strong>{String(run.status)}</strong><small>{String(run.promptKey)} · {String(run.node)}</small></span><span><small>{String(run.model ?? 'Model unavailable')}</small><small>{run.durationMs === null || run.durationMs === undefined ? '—' : `${String(run.durationMs)} ms`}</small></span></a>{:else}<p class="workspace-empty">No safe execution events are available for this workflow.</p>{/each}</div>
    {#if selectedRun}<aside class="prompt-run-overlay" aria-live="polite"><strong>Selected safe run overlay · {selectedRunEvents.length} visited event{selectedRunEvents.length === 1 ? '' : 's'}</strong><dl><div><dt>Opaque ID</dt><dd><code>{String(selectedRun.executionId)}</code></dd></div><div><dt>Release / revision</dt><dd><code>{String(selectedRun.releaseId)}</code> / <code>{String(selectedRun.revisionId)}</code></dd></div><div><dt>Model</dt><dd>{String(selectedRun.model ?? 'Not recorded')}</dd></div><div><dt>Tokens</dt><dd>{String(selectedRun.inputTokens ?? '—')} in · {String(selectedRun.outputTokens ?? '—')} out</dd></div><div><dt>Result</dt><dd>{String(selectedRun.status)}{selectedRun.errorCode ? ` · ${String(selectedRun.errorCode)}` : ''}</dd></div></dl><ol>{#each selectedRunEvents as event}<li><code>{String(event.node)}</code> — {String(event.status)}, attempt {String(event.attempt)}</li>{/each}</ol></aside>{/if}
  </section>
</main>
