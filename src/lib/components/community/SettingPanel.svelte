<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';

  export type CuratedSetting = {
    id: string;
    name: string;
    description: string;
    altText: string;
    previewUrl: string | null;
    selected: boolean;
  };
  export type SettingWorkspace = {
    available: boolean;
    reason: string | null;
    selectedSettingId: string | null;
    settings: CuratedSetting[];
  };

  let { revision, editable, settings }: { revision: number; editable: boolean; settings: SettingWorkspace } = $props();
  let pending = $state(false);
  let selectedSettingId = $state<string | null>(null);
  $effect(() => {
    selectedSettingId = settings.selectedSettingId;
  });
  const selectedSetting = $derived(settings.settings.find((setting) => setting.id === selectedSettingId) ?? null);
  const persistedSettingSelected = $derived(Boolean(selectedSettingId && selectedSettingId === settings.selectedSettingId));
  function submit(): SubmitFunction {
    return () => {
      pending = true;
      return async ({ update }) => {
        await update({ reset: false, invalidateAll: true });
        pending = false;
      };
    };
  }
</script>

<section class="workspace-panel setting-panel" aria-labelledby="setting-heading" id="setting-library">
  <div class="workspace-panel-heading">
    <span class="workspace-step">03</span>
    <div>
      <p class="eyebrow">Choose their setting</p>
      <h2 id="setting-heading">A place to meet</h2>
      <p>Pick the environment that will accompany this companion. Settings are curated, shared project assets; they are never generated from a creator prompt.</p>
    </div>
  </div>

  {#if !settings.available}
    <div class="workspace-callout warning" role="alert">
      <strong>Settings are temporarily unavailable</strong>
      <span>{settings.reason ?? 'The setting library could not be loaded, so this draft cannot be submitted yet.'}</span>
    </div>
  {:else if !settings.settings.length}
    <div class="workspace-callout warning" role="alert"><strong>Settings are temporarily unavailable</strong><span>The setting library did not return any approved environments, so submission is blocked until it is restored.</span></div>
  {:else}
    <fieldset class="setting-fieldset" disabled={!editable || pending}>
      <legend>Choose one setting</legend>
      <div class="setting-grid">
        {#each settings.settings as setting (setting.id)}
          <label class:selected={setting.selected} class:current-choice={setting.id === selectedSettingId} class="setting-card">
            <input type="radio" name="setting" value={setting.id} bind:group={selectedSettingId} />
            <span class="setting-preview">
              {#if setting.previewUrl}<img src={setting.previewUrl} alt={setting.altText} />{:else}<span class="setting-preview-empty">Setting preview unavailable</span>{/if}
            </span>
            <span class="setting-copy"><strong>{setting.name}</strong><small>{setting.description}</small>{#if setting.selected}<span class="status-pill">selected</span>{/if}</span>
          </label>
        {/each}
      </div>
    </fieldset>
    <form method="POST" action="?/selectSetting" use:enhance={submit()} class="workspace-form-footer setting-select-footer">
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="settingId" value={selectedSettingId ?? ''} />
      <small>{persistedSettingSelected ? 'This setting is selected for the current draft.' : selectedSetting ? 'Confirm this setting to use it for the current draft.' : 'Choose a setting before submitting.'}</small>
      <button class="primary-action" disabled={!editable || pending || !selectedSetting || persistedSettingSelected}>{pending ? 'Selecting setting…' : persistedSettingSelected ? 'Setting selected' : 'Use this setting'}</button>
    </form>
  {/if}
</section>
