<script lang="ts">
  import type { PageProps } from './$types';
  import type { AuthoringWorkspaceDetail, AuthoringPortraitWorkspace, AuthoringSettingsWorkspace } from '$lib/game/authoring-workspace';
  import NpcSheetEditor from '$lib/components/community/NpcSheetEditor.svelte';
  import AssistancePanel from '$lib/components/community/AssistancePanel.svelte';
  import PortraitPanel from '$lib/components/community/PortraitPanel.svelte';
  import SettingPanel from '$lib/components/community/SettingPanel.svelte';
  import AuthoringScenePreview from '$lib/components/community/AuthoringScenePreview.svelte';
  import SandboxPanel from '$lib/components/community/SandboxPanel.svelte';
  import HistoryPanel from '$lib/components/community/HistoryPanel.svelte';
  import RetirementPanel from '$lib/components/community/RetirementPanel.svelte';

  let { data, form }: PageProps = $props();
  let detail = $derived(data.detail as AuthoringWorkspaceDetail);
  const lifecycleLabel = $derived(detail.draft.lifecycle.replaceAll('_', ' '));
  const portrait = $derived(detail.portrait as AuthoringPortraitWorkspace);
  const settings = $derived(detail.settings as AuthoringSettingsWorkspace);
  const selectedPortrait = $derived(portrait.candidates.find((candidate) => candidate.id === portrait.selectedCandidateId) ?? null);
  const selectedSetting = $derived(settings.settings.find((setting) => setting.id === settings.selectedSettingId) ?? null);
  const portraitSummary = $derived([
    { label: 'Title and role', values: [detail.draft.sheet.identity.title, detail.draft.sheet.identity.shortDescription].filter(Boolean) },
    { label: 'Physical appearance', values: [detail.draft.sheet.appearance.physicalAppearance].filter(Boolean) },
    { label: 'Attire and notable features', values: [detail.draft.sheet.appearance.attire, detail.draft.sheet.appearance.notableFeatures].filter(Boolean) },
    { label: 'Mood and personality', values: [detail.draft.sheet.appearance.mood, ...detail.draft.sheet.personality.values.slice(0, 2), ...detail.draft.sheet.personality.likes.slice(0, 1)].filter(Boolean) },
    { label: 'Content rating', values: [detail.draft.sheet.rating] }
  ]);
  const portraitItemOptions = $derived([...new Set([
    ...detail.draft.sheet.appearance.attire.split(/[;,\n]/),
    ...detail.draft.sheet.appearance.notableFeatures.split(/[;,\n]/)
  ].map((item) => item.trim()).filter((item) => item.length > 0 && item.length <= 120))].slice(0, 12));
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
    <a href="#portrait-artwork"><span>02</span> Create artwork</a>
    <a href="#setting-library"><span>03</span> Choose a setting</a>
    <a href="#scene-preview"><span>04</span> Preview the scene</a>
    <a href="#assistance-heading"><span>05</span> Refine a section</a>
    <a href="#sandbox-heading"><span>06</span> Try the voice</a>
    <a href="#history-heading"><span>07</span> Submit for review</a>
  </nav>

  <section class="workspace-intro" aria-label="How this workspace works">
    <div><p class="eyebrow">A calm way to author</p><h2>Build a person players will remember.</h2><p>Describe who they are, give them a place in the world, and test their voice before review. Every meaningful change is saved as a protected draft revision.</p></div>
    <ol><li><strong>Shape</strong><span>Write the authored truth.</span></li><li><strong>Test</strong><span>Try optional assistance and a private conversation.</span></li><li><strong>Submit</strong><span>Freeze a version when it is ready for review.</span></li></ol>
  </section>

  <section id="draft-editor" class="workspace-editor-region" aria-label="NPC draft editor">
    <div class="workspace-region-heading"><span class="workspace-step">01</span><div><p class="eyebrow">Shape the companion</p><h2>Author the draft</h2><p>The details below are the canonical source for this companion. Clear writing gives scenes, dialogue, and consequences a shared foundation.</p></div></div>
    <NpcSheetEditor sheet={detail.draft.sheet} revision={detail.draft.revision} editable={detail.capabilities.canEdit} message={form?.message} conflict={form?.conflict} relatedNpcs={detail.eligibleNpcs.map((npc) => ({ id: npc.npcId, name: npc.name }))}>
      <PortraitPanel revision={detail.draft.revision} editable={detail.capabilities.canEdit} {portrait} visualSummary={portraitSummary} itemOptions={portraitItemOptions} />
    </NpcSheetEditor>
  </section>

  <SettingPanel revision={detail.draft.revision} editable={detail.capabilities.canEdit} {settings} />

  <AuthoringScenePreview
    npcName={detail.draft.sheet.identity.name || 'This companion'}
    portrait={selectedPortrait ? { previewUrl: selectedPortrait.previewUrl, altText: selectedPortrait.altText } : null}
    setting={selectedSetting ? { previewUrl: selectedSetting.previewUrl, altText: selectedSetting.altText, name: selectedSetting.name } : null}
  />

  <AssistancePanel revision={detail.draft.revision} capability={detail.capabilities} provider={detail.provider.assistance} assistance={detail.assistance} quota={detail.quota.assistanceDaily} />

  <SandboxPanel revision={detail.draft.revision} capability={detail.capabilities} provider={detail.provider.sandbox} sandbox={detail.sandbox} quota={detail.quota.sandboxDaily} />

  <div class="workspace-columns review-columns">
    <HistoryPanel revision={detail.draft.revision} versions={detail.versions} preflight={detail.preflight} capability={detail.capabilities} />
    <RetirementPanel capability={detail.capabilities} retirement={detail.retirement} />
  </div>
</main>
