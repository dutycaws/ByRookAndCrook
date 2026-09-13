<script lang="ts">
  export type PortraitCandidateState = 'generating' | 'ready' | 'failed' | 'stale' | 'selected' | 'superseded';
  export type PortraitCandidate = {
    id: string;
    ordinal: number;
    state: PortraitCandidateState;
    previewUrl: string | null;
    altText: string;
    width: number | null;
    height: number | null;
    hasAlpha: boolean | null;
    mimeType: string | null;
    failureReason: string | null;
  };
  export type PortraitBatch = {
    id: string;
    status: 'idle' | 'generating' | 'partial' | 'ready' | 'failed';
    requested: number;
    completed: number;
    failed: number;
    errorCode: string | null;
  };
  export type PortraitWorkspace = {
    available: boolean;
    reason: string | null;
    styleLabel: string;
    styleVersion: string;
    visualInputHash: string | null;
    selectedCandidateId: string | null;
    candidates: PortraitCandidate[];
    activeBatch: PortraitBatch | null;
    creditsRemaining: number | null;
  };
  type VisualSummary = Array<{ label: string; values: string[] }>;

  let {
    revision,
    editable,
    portrait,
    visualSummary,
    itemOptions = []
  }: {
    revision: number;
    editable: boolean;
    portrait: PortraitWorkspace;
    visualSummary: VisualSummary;
    itemOptions?: string[];
  } = $props();

  let selectedCandidateId = $state<string | null>(null);
  let noteLength = $state(0);
  let requestedCount = $state('2');
  $effect(() => {
    selectedCandidateId = portrait.selectedCandidateId;
  });

  const readyCandidates = $derived(portrait.candidates.filter((candidate) => candidate.state === 'ready' || candidate.state === 'selected'));
  const selectedCandidate = $derived(portrait.candidates.find((candidate) => candidate.id === selectedCandidateId) ?? null);
  const persistedCandidateSelected = $derived(Boolean(selectedCandidateId && selectedCandidateId === portrait.selectedCandidateId));
  const batchStatus = $derived(portrait.activeBatch?.status ?? 'idle');
  const batchMessage = $derived.by(() => {
    const batch = portrait.activeBatch;
    if (!batch) return null;
    if (batch.status === 'generating') return `Generating ${batch.completed} of ${batch.requested} alternatives. This status is saved and will survive a refresh.`;
    if (batch.status === 'partial') return `${batch.completed} alternative${batch.completed === 1 ? '' : 's'} ready; ${batch.failed} could not be created. Select a ready portrait or request another batch.`;
    if (batch.status === 'failed') return batch.errorCode ? `No portrait could be created (${batch.errorCode.replaceAll('_', ' ')}). No substitute image was used.` : 'No portrait could be created. No substitute image was used.';
    if (batch.status === 'ready') return `${batch.completed} alternative${batch.completed === 1 ? '' : 's'} ready. Choose one deliberately before you continue.`;
    return null;
  });
  function candidateStatus(candidate: PortraitCandidate): string {
    if (candidate.state === 'selected') return 'selected';
    if (candidate.state === 'stale') return 'stale after visual edit';
    if (candidate.state === 'superseded') return 'superseded';
    return candidate.state;
  }
</script>

<section class="workspace-panel portrait-panel" aria-labelledby="portrait-heading" id="portrait-artwork">
  <div class="workspace-panel-heading">
    <span class="workspace-step">02</span>
    <div>
      <p class="eyebrow">Create their character artwork</p>
      <h2 id="portrait-heading">Portrait sprite</h2>
      <p>Create and choose one full-body portrait with a transparent background. The style is fixed so companions share one visual language.</p>
    </div>
  </div>

  <div class="portrait-contract">
    <div>
      <span class="eyebrow">Locked visual language</span>
      <strong>{portrait.styleLabel}</strong>
      <small>{portrait.styleVersion}</small>
    </div>
    <p>Reference imagery and generation instructions stay private. You control only the character-specific direction below.</p>
  </div>

  <details class="portrait-summary" open>
    <summary>What will inform the image</summary>
    <dl>
      {#each visualSummary as item}
        <div>
          <dt>{item.label}</dt>
          <dd>{item.values.length ? item.values.join(' · ') : 'Not yet described'}</dd>
        </div>
      {/each}
    </dl>
  </details>

  {#if !portrait.available}
    <div class="workspace-callout unavailable" role="status">
      <strong>Portrait creation is unavailable</strong>
      <span>{portrait.reason ?? 'The portrait provider is not configured for this workspace.'}</span>
    </div>
  {:else if !editable}
    <div class="workspace-callout unavailable" role="status"><strong>Portrait selection is read-only</strong><span>This version is no longer editable.</span></div>
  {:else}
    <div class="workspace-form portrait-direction">
      <input type="hidden" name="revision" value={revision} />
      <div class="portrait-direction-grid">
        <label>Pose
          <select name="pose"><option value="automatic">From the character sheet</option><option value="relaxed">Relaxed</option><option value="confident">Confident</option><option value="guarded">Guarded</option><option value="working">Working</option></select>
        </label>
        <label>Expression
          <select name="expression"><option value="from_sheet">From the character sheet</option><option value="warm">Warm</option><option value="wary">Wary</option><option value="determined">Determined</option><option value="thoughtful">Thoughtful</option><option value="stern">Stern</option></select>
        </label>
        <label>Clothing condition
          <select name="clothingCondition"><option value="from_sheet">From the character sheet</option><option value="well_kept">Well-kept</option><option value="patched">Patched</option><option value="road_worn">Road-worn</option></select>
        </label>
        <label>Alternatives
          <select name="count" aria-label="Number of portrait alternatives" bind:value={requestedCount}><option value="1">1 alternative · costs 1 credit</option><option value="2">2 alternatives · costs 2 credits</option><option value="3">3 alternatives · costs 3 credits</option><option value="4">4 alternatives · costs 4 credits</option></select>
        </label>
      </div>
      <label>One detail to include <span class="field-hint">Optional; choose only a detail already named in their attire or notable features.</span>
        <select name="item"><option value="">No additional detail</option>{#each itemOptions as item}<option value={item}>{item}</option>{/each}</select>
      </label>
      <label>Composition note <span class="field-hint">Optional, 240 characters maximum · {noteLength}/240</span>
        <textarea name="note" maxlength="240" oninput={(event) => noteLength = (event.currentTarget as HTMLTextAreaElement).value.length} placeholder="For example: make the full silhouette clear at a glance."></textarea>
      </label>
      <div class="workspace-form-footer portrait-request-footer">
        <small>{portrait.creditsRemaining === null ? 'Image-credit availability will be checked before creation.' : `${portrait.creditsRemaining} image credit${portrait.creditsRemaining === 1 ? '' : 's'} remain today.`}</small>
        <button class="primary-action" type="submit" formaction="?/portrait" data-portrait-action="request" disabled={batchStatus === 'generating'}>{batchStatus === 'generating' ? 'Portrait batch in progress' : `Create ${requestedCount} alternative${requestedCount === '1' ? '' : 's'} · costs ${requestedCount} credit${requestedCount === '1' ? '' : 's'}`}</button>
      </div>
    </div>
  {/if}

  {#if batchMessage}
    <div class:warning={batchStatus === 'failed'} class:unavailable={batchStatus === 'failed'} class="workspace-callout portrait-batch-status" role={batchStatus === 'failed' ? 'alert' : 'status'} aria-live="polite">
      <strong>{batchStatus === 'generating' ? 'Creating portraits' : batchStatus === 'partial' ? 'Some portraits are ready' : batchStatus === 'failed' ? 'Portrait request could not finish' : 'Portraits ready for review'}</strong>
      <span>{batchMessage}</span>
    </div>
  {/if}

  {#if portrait.candidates.length}
    <fieldset class="portrait-candidate-fieldset" disabled={!editable} aria-describedby="portrait-selection-help">
      <legend>Choose a portrait</legend>
      <p id="portrait-selection-help" class="workspace-muted">Selection is deliberate: choose one ready candidate, then confirm it below. Stale and failed candidates remain visible for review but cannot be selected.</p>
      <div class="portrait-candidate-grid" aria-live="polite">
        {#each portrait.candidates as candidate (candidate.id)}
          <label class:selected={candidate.id === portrait.selectedCandidateId} class:current-choice={candidate.id === selectedCandidateId} class:stale={candidate.state === 'stale'} class:unavailable={candidate.state === 'failed' || candidate.state === 'superseded'} class="portrait-candidate">
            <input type="radio" name="candidate" value={candidate.id} bind:group={selectedCandidateId} disabled={candidate.state !== 'ready' && candidate.state !== 'selected'} />
            <span class="portrait-preview checkerboard">
              {#if candidate.previewUrl}
                <img src={candidate.previewUrl} alt={candidate.altText || `Portrait alternative ${candidate.ordinal}`} />
              {:else}
                <span class="portrait-preview-empty">{candidate.state === 'generating' ? 'Preparing transparent preview…' : candidate.state === 'failed' ? 'No usable image returned' : 'Preview unavailable'}</span>
              {/if}
            </span>
            <span class="portrait-candidate-copy">
              <span><strong>Alternative {candidate.ordinal}</strong><span class="status-pill">{candidateStatus(candidate)}</span></span>
              {#if candidate.state === 'failed'}<small>{candidate.failureReason?.replaceAll('_', ' ') ?? 'The provider did not return a valid transparent image.'}</small>{:else if candidate.state === 'stale'}<small>Visual details changed after this was created. Request a new portrait for the current character.</small>{:else}<small>{candidate.width && candidate.height ? `${candidate.width} × ${candidate.height}` : 'Dimensions pending'} · {candidate.hasAlpha ? 'Transparency verified' : 'Transparency pending'}{candidate.mimeType ? ` · ${candidate.mimeType.replace('image/', '').toUpperCase()}` : ''}</small>{/if}
            </span>
          </label>
        {/each}
      </div>
    </fieldset>
    <div class="workspace-form-footer portrait-select-footer">
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="candidateId" value={selectedCandidateId ?? ''} />
      <small>{persistedCandidateSelected ? 'This portrait is selected for the current visual details.' : selectedCandidate ? 'Confirm this choice to pin it to the current visual details.' : readyCandidates.length ? 'Choose a ready portrait to continue.' : 'No valid portrait is ready to select.'}</small>
      <button class="primary-action" type="submit" formaction="?/selectPortrait" data-portrait-action="select" disabled={!editable || !selectedCandidate || selectedCandidate.state !== 'ready'}>{persistedCandidateSelected ? 'Portrait selected' : 'Use selected portrait'}</button>
    </div>
  {:else}
    <p class="workspace-empty">No portrait alternatives are ready yet. A valid transparent portrait is required before this companion can be submitted.</p>
  {/if}
</section>
