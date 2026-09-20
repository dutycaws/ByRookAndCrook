<script lang="ts">
  import type { PageProps } from './$types';
  import PrivilegedWorkspaceNav from '$lib/components/community/PrivilegedWorkspaceNav.svelte';

  let { data, form }: PageProps = $props();
  let admin = $derived(data.community.capabilities.includes('admin'));
  let reportResolutions = $state<Record<string, string>>({});

  const describeJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
  type OptionChoice = { id: string; kind: string; value: string; targetKinds: string[] };
  type Sheet = { identity?: { name?: string; shortDescription?: string }; campaign?: { milestones?: Array<{ title?: string; startingPlan?: Array<{ action?: string; approach?: string }>; permanentLoss?: { kind?: string; warning?: string } | null }> } };
  type ReviewerSubmission = {
    npcId: string; versionId: string; sheet: Sheet; frozenSheetHash?: string; candidateHash?: string;
    optionRegistryVersion?: string; optionChoices?: OptionChoice[]; evolutionPreview?: Record<string, unknown>;
    prospectivePackage?: { state?: string; definitionHash?: string; packageHash?: string; terminalOutcomes?: string[] }; evaluation?: { status?: string; result?: unknown } | null;
  };
  const submissions = $derived(data.queue as unknown as ReviewerSubmission[]);
  const optionGroups = (submission: ReviewerSubmission) => {
    const choices = Array.isArray(submission.optionChoices) ? submission.optionChoices : [];
    return ['quest_action', 'quest_approach', 'world_effect', 'social_capability'].map((kind) => ({ kind, choices: choices.filter((choice) => choice.kind === kind) })).filter((group) => group.choices.length);
  };
  const campaignRequirements = (sheet: Sheet) => {
    const steps = sheet.campaign?.milestones?.flatMap((milestone) => milestone.startingPlan ?? []) ?? [];
    return { actions: [...new Set(steps.map((step) => step.action).filter(Boolean))], approaches: [...new Set(steps.map((step) => step.approach).filter(Boolean))] };
  };
  const readableKind = (kind: string) => kind.replace(/[._]/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  const reportResolution = (id: string) => reportResolutions[id] ?? 'dismiss';
  const reportAction = (id: string) => reportResolution(id) === 'dismiss' ? 'none' : reportResolution(id);
  const reportUphold = (id: string) => reportResolution(id) === 'dismiss' ? 'false' : 'true';
</script>

<main class="page-shell community-page review-desk-page">
  <PrivilegedWorkspaceNav capabilities={data.community.capabilities} current="review" />
  <header>
    <p class="eyebrow">Community governance</p>
    <h1>Review desk</h1>
    <p>Only authorized reviewers can read submissions, protected report evidence, or resolve content reports.</p>
  </header>

  {#if form?.message}
    <p class="community-notice" role="status" aria-live="polite">{form.message}</p>
  {/if}

  <section class="review-desk-summary" aria-label="Review desk summary">
    <div><strong>{submissions.length}</strong><span>submitted {submissions.length === 1 ? 'version' : 'versions'}</span></div>
    <div><strong>{data.moderation.length}</strong><span>open moderation {data.moderation.length === 1 ? 'item' : 'items'}</span></div>
    {#if admin}<div><strong>{data.users.length}</strong><span>matching access {data.users.length === 1 ? 'record' : 'records'}</span></div>{/if}
  </section>

  <section>
    <h2>Submitted versions</h2>
    <p>The author supplied character sheet is frozen in the review candidate. Reviewers choose from server-issued option IDs; the server resolves the package and verifies campaign coverage before publication.</p>
    <div class="community-grid two reviewer-submission-grid">
      {#each submissions as item (item.versionId)}
        {@const requirements = campaignRequirements(item.sheet ?? {})}
        <article class="community-card reviewer-submission-card">
          <header class="reviewer-submission-heading">
            <div><p class="eyebrow">Immutable submitted version</p><h3>{item.sheet?.identity?.name ?? 'Unnamed NPC'}</h3><p>{item.sheet?.identity?.shortDescription ?? 'No description supplied.'}</p></div>
            <span class="status-pill">{item.prospectivePackage?.state ?? 'awaiting review'}</span>
          </header>
          <section class="reviewer-checklist" aria-label="Review checklist">
            <h4>Review checklist</h4>
            <ul>
              <li><span>Automated evaluation</span><strong>{item.evaluation?.status ?? 'not started'}</strong></li>
              <li><span>Campaign coverage</span><strong>{requirements.actions.length + requirements.approaches.length} required choices</strong></li>
              <li><span>Permanent outcomes</span><strong>{item.prospectivePackage?.terminalOutcomes?.length ?? 0} authored</strong></li>
              <li><span>Available capabilities</span><strong>{item.optionChoices?.length ?? 0} server issued</strong></li>
            </ul>
          </section>
          {#if item.prospectivePackage?.terminalOutcomes?.length}
            <aside class="community-notice"><strong>Authored permanent-loss outcomes:</strong> {item.prospectivePackage.terminalOutcomes.join(', ')}. They are allowed only when the campaign’s authored conditions occur.</aside>
          {/if}
          <p class="reviewer-requirements"><strong>Campaign-required coverage:</strong> actions: {requirements.actions.join(', ') || 'none'} · approaches: {requirements.approaches.join(', ') || 'none'}. Select matching server options to approve.</p>
          <details class="reviewer-technical-evidence">
            <summary>Technical evidence</summary>
            <dl class="reviewer-facts">
              <div><dt>Candidate hash</dt><dd><code title={item.candidateHash}>{item.candidateHash?.slice(0, 16) ?? '—'}…</code></dd></div>
              <div><dt>Frozen sheet</dt><dd><code title={item.frozenSheetHash}>{item.frozenSheetHash?.slice(0, 16) ?? '—'}…</code></dd></div>
              <div><dt>Package state</dt><dd>{item.prospectivePackage?.state ?? 'awaiting review'}</dd></div>
              <div><dt>Registry</dt><dd>{item.optionRegistryVersion ?? '—'}</dd></div>
            </dl>
            <details><summary>Evolution preview</summary><p>This prospective resident definition is derived from the frozen sheet.</p><pre>{describeJson(item.evolutionPreview)}</pre></details>
            <details><summary>Evaluation details</summary><pre>{describeJson(item.evaluation?.result)}</pre></details>
          </details>
          <form method="POST" action="?/comment" class="reviewer-stage reviewer-comment-form">
            <input type="hidden" name="npcId" value={item.npcId} />
            <input type="hidden" name="versionId" value={item.versionId} />
            <div class="reviewer-stage-heading"><span>1</span><div><h4>Leave actionable feedback</h4><p>Anchor the note to the section the author should revise.</p></div></div>
            <label>Draft section<select name="section"><option value="identity">Identity</option><option value="appearance">Appearance</option><option value="personality">Personality</option><option value="lore">Lore</option><option value="skills">Skills</option><option value="campaign">Campaign</option></select></label>
            <label>What needs to change?<textarea name="body" required placeholder="Explain the specific change and why it matters."></textarea></label>
            <button class="secondary-action">Add review comment</button>
          </form>
          <form method="POST" action="?/decide" class="reviewer-approval reviewer-stage">
            <input type="hidden" name="versionId" value={item.versionId} />
            <input type="hidden" name="decision" value="approve" />
            <div class="reviewer-stage-heading"><span>2</span><div><h4>Approve a capability package</h4><p>Select only the server-issued capabilities supported by the frozen submission.</p></div></div>
            <fieldset>
              <legend>Reviewer-selected capabilities</legend>
              <p>These IDs are issued by the server for this candidate. The author cannot set them, and the raw capability package is never editable here.</p>
              {#each optionGroups(item) as group}
                <fieldset class="option-group">
                  <legend>{readableKind(group.kind)}</legend>
                  {#each group.choices as option}
                    <label><input type="checkbox" name="optionId" value={option.id} /> <span><strong>{option.value}</strong><small>{option.id}{option.targetKinds?.length ? ` · targets: ${option.targetKinds.join(', ')}` : ''}</small></span></label>
                  {/each}
                </fieldset>
              {/each}
            </fieldset>
            <label>Approval notes<textarea name="notes" placeholder="Record why this package is ready."></textarea></label>
            <button class="primary-action">Approve selected package</button>
          </form>
          <form method="POST" action="?/decide" class="reviewer-nonapproval reviewer-stage">
            <input type="hidden" name="versionId" value={item.versionId} />
            <h4>Or return this submission</h4>
            <label>Required explanation<textarea name="notes" required placeholder="Tell the author what must change, or why this submission cannot proceed."></textarea></label>
            <div class="reviewer-button-row"><button name="decision" value="request_changes">Request changes</button><button class="quiet-danger" name="decision" value="reject">Reject submission</button></div>
          </form>
          <form method="POST" action="?/publish" class="reviewer-stage reviewer-publish-stage">
            <input type="hidden" name="versionId" value={item.versionId} />
            <div class="reviewer-stage-heading"><span>3</span><div><h4>Publish the approved package</h4><p>{item.prospectivePackage?.state === 'approved' ? 'Approval is recorded. Publishing makes this immutable package available to new saves.' : 'Approve a package before publication becomes available.'}</p></div></div>
            <button class="primary-action" disabled={item.prospectivePackage?.state !== 'approved'}>Publish approved immutable package</button>
          </form>
        </article>
      {:else}
        <p class="community-empty">No submitted versions await review.</p>
      {/each}
    </div>
  </section>

  <section id="report-detail" aria-live="polite">
    <h2>Reports and retirement</h2>
    <p>Report evidence is private to authorized reviewers. Do not copy a transcript, personal information, or frozen evidence outside this review process.</p>

    {#if data.reportDetail}
      <article class="community-card">
        <p class="eyebrow">Selected report</p>
        <h3>{data.reportDetail.category}</h3>
        <p>Filed {new Date(data.reportDetail.createdAt).toLocaleString()} against version {data.reportDetail.versionId}.</p>
        <p><strong>Frozen evidence:</strong> this snapshot was captured when the report was filed and cannot be edited here.</p>
        <details open>
          <summary>Frozen evidence record</summary>
          <pre>{describeJson(data.reportDetail.evidence)}</pre>
        </details>
        <details>
          <summary>Frozen conversation transcript — private</summary>
          <pre>{describeJson(data.reportDetail.transcript)}</pre>
        </details>
        <details>
          <summary>Version and generation metadata</summary>
          <pre>{describeJson({ frozenVersion: data.reportDetail.frozenVersion, generationMetadata: data.reportDetail.generationMetadata })}</pre>
        </details>
        {#if data.reportDetail.appeals?.length}
          <h4>Appeals</h4>
          <ul>
            {#each data.reportDetail.appeals as appeal}
              <li>{appeal.status}: {appeal.body}</li>
            {/each}
          </ul>
        {/if}
        <a href="?">Close report detail</a>
      </article>
    {:else if data.selectedReportId}
      <p class="community-notice">This report is unavailable or you no longer have permission to read it.</p>
    {/if}

    <div class="community-grid">
      {#each data.moderation as item}
        <article class="community-card">
          {#if item.kind === 'report'}
            <p class="eyebrow">Open report</p>
            <h3>{item.category}</h3>
            <p>Filed {new Date(item.createdAt).toLocaleString()}.</p>
            <a href={`?report=${item.id}#report-detail`}>Review protected evidence</a>
            <form method="POST" action="?/resolveReport" class="report-resolution-form">
              <input type="hidden" name="reportId" value={item.id} />
              <input type="hidden" name="action" value={reportAction(item.id)} />
              <input type="hidden" name="uphold" value={reportUphold(item.id)} />
              <fieldset>
                <legend>Resolution</legend>
                <label><input type="radio" name={`resolution-${item.id}`} value="dismiss" checked={reportResolution(item.id) === 'dismiss'} onchange={() => reportResolutions = { ...reportResolutions, [item.id]: 'dismiss' }} /> Dismiss the report</label>
                <label><input type="radio" name={`resolution-${item.id}`} value="reinstate" checked={reportResolution(item.id) === 'reinstate'} onchange={() => reportResolutions = { ...reportResolutions, [item.id]: 'reinstate' }} /> Uphold and reinstate</label>
                <label><input type="radio" name={`resolution-${item.id}`} value="pause" checked={reportResolution(item.id) === 'pause'} onchange={() => reportResolutions = { ...reportResolutions, [item.id]: 'pause' }} /> Uphold and pause</label>
                <label><input type="radio" name={`resolution-${item.id}`} value="quarantine" checked={reportResolution(item.id) === 'quarantine'} onchange={() => reportResolutions = { ...reportResolutions, [item.id]: 'quarantine' }} /> Uphold and quarantine</label>
                <label><input type="radio" name={`resolution-${item.id}`} value="ban" checked={reportResolution(item.id) === 'ban'} onchange={() => reportResolutions = { ...reportResolutions, [item.id]: 'ban' }} /> Uphold and ban</label>
              </fieldset>
              <label>Message to reporter<textarea name="reviewerReason" required placeholder="Explain the resolution to the reporter."></textarea></label>
              <label>Message to creator<textarea name="creatorReason" required placeholder="Explain the resolution and any next step to the creator."></textarea></label>
              <button class:quiet-danger={reportResolution(item.id) === 'quarantine' || reportResolution(item.id) === 'ban'}>{reportResolution(item.id) === 'dismiss' ? 'Dismiss report' : `Apply ${readableKind(reportResolution(item.id))}`}</button>
            </form>
          {:else if item.kind === 'retirement'}
            <p class="eyebrow">Retirement request</p>
            <h3>NPC {item.npcId}</h3>
            <p>{item.reason}</p>
            <p>Requested {new Date(item.createdAt).toLocaleString()}.</p>
            <form method="POST" action="?/retirement">
              <input type="hidden" name="requestId" value={item.id} />
              <textarea name="reason" required placeholder="Reviewer decision reason"></textarea>
              <button name="approve" value="true">Approve retirement</button>
              <button name="approve" value="false">Reject retirement</button>
            </form>
          {/if}
        </article>
      {:else}
        <p class="community-empty">No open reports or retirement requests.</p>
      {/each}
    </div>
  </section>

  {#if admin}
    <section class="admin-access-section">
      <h2>Access administration</h2>
      <form class="community-card" method="GET">
        <input name="q" value={data.query} placeholder="Search email" />
        <button>Search users</button>
      </form>
      <div class="community-grid">
        {#each data.users as user}
          <article class="community-card">
            <h3>{user.displayName ?? user.email}</h3>
            <small>{user.email}</small>
            <p>{describeJson(user.capabilities)}</p>
            <form method="POST" action="?/capability">
              <input type="hidden" name="userId" value={user.userId} />
              <select name="capability"><option>npc_author</option><option>npc_reviewer</option><option>prompt_manager</option><option>admin</option></select>
              <input name="reason" minlength="3" required placeholder="Audit reason" />
              <button name="enabled" value="true">Grant</button>
              <button name="enabled" value="false">Revoke</button>
            </form>
          </article>
        {/each}
      </div>
      <details class="community-card danger-zone">
        <summary>Danger zone · permanent NPC removal</summary>
        <form method="POST" action="?/quarantine">
          <p>Purge removes the NPC from saves and permanently deletes its private portrait master and runtime sprite. Governance-safe hashes and audit reasons remain.</p>
          <label>NPC ID <input name="npcId" required pattern="[0-9a-fA-F-]{36}" autocomplete="off" /></label>
          <label>Audit reason <textarea name="reason" minlength="3" required></textarea></label>
          <label>Type PURGE to confirm <input name="confirmation" required pattern="PURGE" autocomplete="off" /></label>
          <button class="quiet-danger" name="purge" value="true">Permanently purge NPC</button>
        </form>
      </details>
      <details class="community-card audit-disclosure"><summary>Audit trail</summary><pre>{describeJson(data.audit)}</pre></details>
    </section>
  {/if}
</main>
