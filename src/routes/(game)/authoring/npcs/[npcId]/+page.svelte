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
  import PrivilegedWorkspaceNav from '$lib/components/community/PrivilegedWorkspaceNav.svelte';
  import PrivilegedSectionNav from '$lib/components/community/PrivilegedSectionNav.svelte';
  import { page } from '$app/state';

  let { data, form }: PageProps = $props();
  let detail = $derived(data.detail as AuthoringWorkspaceDetail);
  const lifecycleLabel = $derived(detail.draft.lifecycle.replaceAll('_', ' '));
  const portrait = $derived(detail.portrait as AuthoringPortraitWorkspace);
  const settings = $derived(detail.settings as AuthoringSettingsWorkspace);
  // The authoring scene intentionally uses Neutral only. Optional expressions
  // are runtime variants and must not make the creator preview ambiguous.
  const selectedPortrait = $derived(portrait.candidates.find((candidate) => candidate.id === (portrait.selectedCandidateIds.neutral ?? portrait.selectedCandidateId)) ?? null);
  const selectedSetting = $derived(settings.settings.find((setting) => setting.id === settings.selectedSettingId) ?? null);
  const portraitSummary = $derived([
    { label: 'Title and role', values: [detail.draft.sheet.identity.title, detail.draft.sheet.identity.shortDescription].filter(Boolean) },
    { label: 'Physical appearance and silhouette', values: [detail.draft.sheet.appearance.physicalAppearance, detail.draft.sheet.appearance.silhouette].filter(Boolean) },
    { label: 'Attire, features, and palette', values: [detail.draft.sheet.appearance.attire, detail.draft.sheet.appearance.notableFeatures, ...detail.draft.sheet.appearance.palette].filter(Boolean) },
    { label: 'Mood and personality', values: [detail.draft.sheet.appearance.mood, ...detail.draft.sheet.personality.initialEntries.slice(0, 3).map((entry) => entry.text)].filter(Boolean) },
    { label: 'Content rating', values: [detail.draft.sheet.rating] }
  ]);
  const portraitItemOptions = $derived([...new Set([
    ...detail.draft.sheet.appearance.attire.split(/[;,\n]/),
    ...detail.draft.sheet.appearance.notableFeatures.split(/[;,\n]/)
  ].map((item) => item.trim()).filter((item) => item.length > 0 && item.length <= 120))].slice(0, 12));
  const readinessLabel = $derived(detail.preflight.length
    ? `${detail.preflight.length} prerequisite${detail.preflight.length === 1 ? '' : 's'} remaining`
    : !detail.capabilities.canSubmit
      ? 'Submission unavailable'
      : 'Ready for review');
  const sectionIds = ['overview', 'sheet', 'art', 'preview', 'review'] as const;
  type SectionId = typeof sectionIds[number];
  const activeSection = $derived((sectionIds.includes(page.url.searchParams.get('section') as SectionId) ? page.url.searchParams.get('section') : 'overview') as SectionId);
  const sectionItems = $derived([
    { id: 'overview', label: 'Overview', description: 'Readiness and next steps', href: '?section=overview', status: readinessLabel },
    { id: 'sheet', label: 'Sheet', description: 'Identity, story, and mechanics', href: '?section=sheet', count: detail.preflight.length },
    { id: 'art', label: 'Art', description: 'Sprites and setting', href: '?section=art', count: portrait.candidates.length },
    { id: 'preview', label: 'Preview', description: 'Scene, assistance, and sandbox', href: '?section=preview' },
    { id: 'review', label: 'Review', description: 'Submission and history', href: '?section=review', count: detail.preflight.length, status: detail.capabilities.canSubmit ? 'Available' : 'Unavailable' }
  ]);
</script>

<main class="page-shell community-page authoring-workspace">
  <PrivilegedWorkspaceNav capabilities={data.community.capabilities} current="authoring" />
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

  <PrivilegedSectionNav items={sectionItems} active={activeSection} label="Creator studio sections" />

  <section class="workspace-readiness authoring-section" aria-label="Draft readiness" hidden={activeSection !== 'overview'}>
    <div>
      <p class="eyebrow">Draft readiness</p>
      <strong>{readinessLabel}</strong>
    </div>
    <p>{detail.preflight.length ? 'Resolve the listed requirements before submitting a review version.' : detail.capabilities.canSubmit ? 'This draft can be submitted as an immutable review version.' : detail.capabilities.reasons.submit ?? 'This draft cannot be submitted right now.'}</p>
    {#if detail.preflight.length}
      <a href="?section=review">View {detail.preflight.length === 1 ? 'requirement' : 'requirements'}</a>
    {/if}
  </section>

  <section class="workspace-intro authoring-section" aria-label="How this workspace works" hidden={activeSection !== 'overview'}>
    <div><p class="eyebrow">A calm way to author</p><h2>Build a person players will remember.</h2><p>Describe who they are, give them a place in the world, and test their voice before review. Every meaningful change is saved as a protected draft revision.</p></div>
    <ol><li><strong>Shape</strong><span>Write the authored truth.</span></li><li><strong>Optional</strong><span>Use assistance or a private sandbox when useful.</span></li><li><strong>Submit</strong><span>Freeze a version when it is ready for review.</span></li></ol>
  </section>

  <section id="draft-editor" class="workspace-editor-region authoring-section" class:artwork-editor-region={activeSection === 'art'} aria-label="NPC draft editor" hidden={activeSection !== 'sheet' && activeSection !== 'art'}>
    <div class="workspace-region-heading" hidden={activeSection !== 'sheet'}><span class="workspace-step">01</span><div><p class="eyebrow">Shape the companion</p><h2>Author the draft</h2><p>The details below are the canonical source for this companion. Clear writing gives scenes, dialogue, and consequences a shared foundation.</p></div></div>
    <NpcSheetEditor sheet={detail.draft.sheet} revision={detail.draft.revision} editable={detail.capabilities.canEdit} message={form?.message} conflict={form?.conflict} relatedNpcs={detail.eligibleNpcs.map((npc) => ({ id: npc.npcId, name: npc.name }))} showSheet={activeSection === 'sheet'} showArtwork={activeSection === 'art'}>
      <PortraitPanel revision={detail.draft.revision} editable={detail.capabilities.canEdit} {portrait} npcId={detail.npcId} visualSummary={portraitSummary} itemOptions={portraitItemOptions} />
    </NpcSheetEditor>
  </section>

  <div class="authoring-section" hidden={activeSection !== 'art'}>
    <SettingPanel revision={detail.draft.revision} editable={detail.capabilities.canEdit} {settings} />
  </div>

  <div class="authoring-section preview-section" hidden={activeSection !== 'preview'}>
    <AuthoringScenePreview
      npcName={detail.draft.sheet.identity.name || 'This companion'}
      portrait={selectedPortrait ? { previewUrl: selectedPortrait.previewUrl, altText: selectedPortrait.altText } : null}
      setting={selectedSetting ? { previewUrl: selectedSetting.previewUrl, altText: selectedSetting.altText, name: selectedSetting.name } : null}
    />

    <AssistancePanel revision={detail.draft.revision} capability={detail.capabilities} provider={detail.provider.assistance} assistance={detail.assistance} quota={detail.quota.assistanceDaily} />

    <SandboxPanel revision={detail.draft.revision} capability={detail.capabilities} provider={detail.provider.sandbox} sandbox={detail.sandbox} quota={detail.quota.sandboxDaily} />
  </div>

  <div class="workspace-columns review-columns authoring-section" hidden={activeSection !== 'review'}>
    <HistoryPanel revision={detail.draft.revision} versions={detail.versions} preflight={detail.preflight} capability={detail.capabilities} />
    <RetirementPanel capability={detail.capabilities} retirement={detail.retirement} />
  </div>
</main>

<style>
  .workspace-readiness { display: grid; grid-template-columns: minmax(12rem, auto) minmax(0, 1fr) auto; align-items: center; gap: .8rem 1.25rem; padding: .75rem 1rem; border: 1px solid #675027; background: rgb(24 18 9 / .72); }
  .workspace-readiness p { margin: 0; color: var(--muted); }
  .workspace-readiness .eyebrow { margin-bottom: .15rem; }
  .workspace-readiness strong { color: var(--gold-bright); font-family: 'Cinzel', serif; }
  .workspace-readiness a { color: #f0d383; }
  .authoring-section { min-width: 0; }
  .artwork-editor-region { padding: 0; border: 0; background: transparent; box-shadow: none; }
  .preview-section { display: grid; gap: 1.2rem; }
  @media (max-width: 700px) { .workspace-readiness { grid-template-columns: 1fr; } }
</style>
