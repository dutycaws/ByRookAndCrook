<script lang="ts">
  import type { PageProps } from './$types';
  import type { AuthoringWorkspaceDetail } from '$lib/game/authoring-workspace';
  import NpcSheetEditor from '$lib/components/community/NpcSheetEditor.svelte';
  import AssistancePanel from '$lib/components/community/AssistancePanel.svelte';
  import ScenePanel from '$lib/components/community/ScenePanel.svelte';
  import SandboxPanel from '$lib/components/community/SandboxPanel.svelte';
  import HistoryPanel from '$lib/components/community/HistoryPanel.svelte';
  import RetirementPanel from '$lib/components/community/RetirementPanel.svelte';

  let { data, form }: PageProps = $props();
  let detail = $derived(data.detail as AuthoringWorkspaceDetail);
  const lifecycleLabel = $derived(detail.draft.lifecycle.replaceAll('_', ' '));
</script>

<main class="page-shell community-page authoring-workspace">
  <a class="workspace-backlink" href="/authoring/npcs">← Creator studio</a>
  <header class="workspace-masthead">
    <div>
      <p class="eyebrow">Community NPC · author workspace</p>
      <h1>{detail.draft.sheet.identity.name || 'Untitled companion'}</h1>
      <p>{detail.draft.sheet.identity.title || 'A companion in progress'} · revision {detail.draft.revision}</p>
    </div>
    <div class="draft-state"><span class="status-pill">{lifecycleLabel}</span><small>{detail.draft.editable ? 'Changes save automatically while you work.' : 'This draft is now read-only.'}</small></div>
  </header>

  {#if form?.message}
    <div class:community-error={form.conflict} class:community-success={!form.conflict} class="community-notice" role={form.conflict ? 'alert' : 'status'} aria-live="polite">{form.message}</div>
  {/if}

  <nav class="workspace-stepper" aria-label="Authoring steps">
    <a href="#draft-editor"><span>01</span> Shape the companion</a>
    <a href="#assistance-heading"><span>02</span> Refine a section</a>
    <a href="#scene-heading"><span>03</span> Choose a scene</a>
    <a href="#sandbox-heading"><span>04</span> Try the voice</a>
    <a href="#history-heading"><span>05</span> Submit for review</a>
  </nav>

  <section class="workspace-intro" aria-label="How this workspace works">
    <div><p class="eyebrow">A calm way to author</p><h2>Build a person players will remember.</h2><p>Describe who they are, give them a place in the world, and test their voice before review. Every meaningful change is saved as a protected draft revision.</p></div>
    <ol><li><strong>Shape</strong><span>Write the authored truth.</span></li><li><strong>Test</strong><span>Try optional assistance and a private conversation.</span></li><li><strong>Submit</strong><span>Freeze a version when it is ready for review.</span></li></ol>
  </section>

  <section id="draft-editor" class="workspace-editor-region" aria-label="NPC draft editor">
    <div class="workspace-region-heading"><span class="workspace-step">01</span><div><p class="eyebrow">Shape the companion</p><h2>Author the draft</h2><p>The details below are the canonical source for this companion. Clear writing gives scenes, dialogue, and consequences a shared foundation.</p></div></div>
    <NpcSheetEditor sheet={detail.draft.sheet} revision={detail.draft.revision} editable={detail.capabilities.canEdit} message={form?.message} conflict={form?.conflict} relatedNpcs={detail.eligibleNpcs.map((npc) => ({ id: npc.npcId, name: npc.name }))} />
  </section>

  <div class="workspace-columns">
    <AssistancePanel revision={detail.draft.revision} capability={detail.capabilities} provider={detail.provider.assistance} assistance={detail.assistance} quota={detail.quota.assistanceDaily} />
    <ScenePanel revision={detail.draft.revision} scenes={detail.scenes} capability={detail.capabilities} quota={detail.quota.sceneDaily} />
  </div>

  <SandboxPanel revision={detail.draft.revision} capability={detail.capabilities} provider={detail.provider.sandbox} sandbox={detail.sandbox} quota={detail.quota.sandboxDaily} />

  <div class="workspace-columns review-columns">
    <HistoryPanel revision={detail.draft.revision} versions={detail.versions} preflight={detail.preflight} capability={detail.capabilities} />
    <RetirementPanel capability={detail.capabilities} retirement={detail.retirement} />
  </div>
</main>
