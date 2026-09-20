<script lang="ts">
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  let admin = $derived(data.community.capabilities.includes('admin'));

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
</script>

<main class="page-shell community-page">
  <header>
    <p class="eyebrow">Community governance</p>
    <h1>Review desk</h1>
    <p>Only authorized reviewers can read submissions, protected report evidence, or resolve content reports.</p>
  </header>

  {#if form?.message}
    <p class="community-notice">{form.message}</p>
  {/if}

  <section>
    <h2>Submitted versions</h2>
    <p>The author supplied character sheet is frozen in the review candidate. Reviewers choose from server-issued option IDs; the server resolves the package and verifies campaign coverage before publication.</p>
    <div class="community-grid two reviewer-submission-grid">
      {#each submissions as item (item.versionId)}
        {@const requirements = campaignRequirements(item.sheet ?? {})}
        <article class="community-card">
          <p class="eyebrow">Immutable submitted version</p>
          <h3>{item.sheet?.identity?.name ?? 'Unnamed NPC'}</h3>
          <p>{item.sheet?.identity?.shortDescription ?? 'No description supplied.'}</p>
          <dl class="reviewer-facts">
            <div><dt>Candidate hash</dt><dd><code title={item.candidateHash}>{item.candidateHash?.slice(0, 16) ?? '—'}…</code></dd></div>
            <div><dt>Frozen sheet</dt><dd><code title={item.frozenSheetHash}>{item.frozenSheetHash?.slice(0, 16) ?? '—'}…</code></dd></div>
            <div><dt>Package state</dt><dd>{item.prospectivePackage?.state ?? 'awaiting review'}</dd></div>
            <div><dt>Registry</dt><dd>{item.optionRegistryVersion ?? '—'}</dd></div>
          </dl>
          <details>
            <summary>Evolution preview</summary>
            <p>This is the prospective resident definition derived from the frozen sheet. Capability permissions are selected separately below.</p>
            <pre>{describeJson(item.evolutionPreview)}</pre>
          </details>
          {#if item.prospectivePackage?.terminalOutcomes?.length}
            <aside class="community-notice"><strong>Authored permanent-loss outcomes:</strong> {item.prospectivePackage.terminalOutcomes.join(', ')}. They are allowed only when the campaign’s authored conditions occur.</aside>
          {/if}
          <p class="reviewer-requirements"><strong>Campaign-required coverage:</strong> actions: {requirements.actions.join(', ') || 'none'} · approaches: {requirements.approaches.join(', ') || 'none'}. Select matching server options to approve.</p>
          <p>Evaluation: {item.evaluation?.status ?? 'not started'}</p>
          <details>
            <summary>Evaluation details</summary>
            <pre>{describeJson(item.evaluation?.result)}</pre>
          </details>
          <form method="POST" action="?/comment">
            <input type="hidden" name="npcId" value={item.npcId} />
            <input type="hidden" name="versionId" value={item.versionId} />
            <input name="section" value="identity" />
            <textarea name="body" required placeholder="Review comment"></textarea>
            <button>Comment</button>
          </form>
          <form method="POST" action="?/decide" class="reviewer-approval">
            <input type="hidden" name="versionId" value={item.versionId} />
            <input type="hidden" name="decision" value="approve" />
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
            <textarea name="notes" placeholder="Approval notes for the author"></textarea>
            <button class="primary-action">Approve selected package</button>
          </form>
          <form method="POST" action="?/decide" class="reviewer-nonapproval">
            <input type="hidden" name="versionId" value={item.versionId} />
            <textarea name="notes" required placeholder="Required notes for changes or rejection"></textarea>
            <button name="decision" value="request_changes">Request changes</button>
            <button name="decision" value="reject">Reject submission</button>
          </form>
          <form method="POST" action="?/publish">
            <input type="hidden" name="versionId" value={item.versionId} />
            <button class="primary-action">Publish approved immutable package</button>
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
            <form method="POST" action="?/resolveReport">
              <input type="hidden" name="reportId" value={item.id} />
              <label>Action <select name="action"><option>none</option><option>reinstate</option><option>pause</option><option>quarantine</option><option>ban</option></select></label>
              <textarea name="reviewerReason" required placeholder="Reason for reporter"></textarea>
              <textarea name="creatorReason" required placeholder="Reason for creator"></textarea>
              <button name="uphold" value="true">Uphold</button>
              <button name="uphold" value="false">Dismiss</button>
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
    <section>
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
      <h2>Permanent NPC removal</h2>
      <form class="community-card" method="POST" action="?/quarantine">
        <p>Purge removes the NPC from saves and permanently deletes its private portrait master and runtime sprite. Governance-safe hashes and audit reasons remain.</p>
        <label>NPC ID <input name="npcId" required pattern="[0-9a-fA-F-]{36}" autocomplete="off" /></label>
        <label>Audit reason <textarea name="reason" minlength="3" required></textarea></label>
        <label>Type PURGE to confirm <input name="confirmation" required pattern="PURGE" autocomplete="off" /></label>
        <button name="purge" value="true">Permanently purge NPC</button>
      </form>
      <h2>Audit trail</h2>
      <pre class="community-card">{describeJson(data.audit)}</pre>
    </section>
  {/if}
</main>
