<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { AuthoringCapabilities, AuthoringSceneCandidate } from '$lib/game/authoring-workspace';
  let { revision, scenes, capability, quota }: { revision: number; scenes: { selectedAssetId: string | null; candidates: AuthoringSceneCandidate[] }; capability: AuthoringCapabilities; quota: number | null } = $props();
  let pending = $state<string | null>(null);
  function submit(label: string): SubmitFunction { return () => { pending = label; return async ({ update }) => { await update({ reset: false, invalidateAll: true }); pending = null; }; }; }
</script>

<section class="workspace-panel" aria-labelledby="scene-heading" id="scene-candidates">
  <div class="workspace-panel-heading"><span class="workspace-step">03</span><div><p class="eyebrow">Set the scene</p><h2 id="scene-heading">Scene candidates</h2><p>Choose artwork already available in local prototype media. The studio never creates or substitutes artwork.</p></div></div>
  {#if capability.canEdit}<form method="POST" action="?/scene" use:enhance={submit('scene')} class="workspace-form compact"><input type="hidden" name="revision" value={revision} /><label>Describe the scene you need<textarea name="prompt" minlength="10" maxlength="2000" required placeholder="A quiet lantern-lit table near the tavern window…"></textarea></label><div class="workspace-form-footer"><small>{quota === null ? 'Scene request limit is available.' : `${quota} requests remain today.`}</small><button disabled={pending !== null}>{pending === 'scene' ? 'Checking local media…' : 'Find scene candidates'}</button></div></form>{/if}
  <div class="scene-grid">{#each scenes.candidates as scene (scene.id)}<article class:selected={scene.selected} class="scene-candidate"><div class="scene-preview">{#if scene.previewUrl}<img src={scene.previewUrl} alt={scene.altText} />{:else}<div class="scene-placeholder"><span>Scene preview unavailable</span><small>Add an approved local derivative, then run the fixture command.</small></div>{/if}</div><div><h3>{scene.altText || 'Untitled scene'}</h3><p>{scene.selected ? 'Selected for this draft' : 'Available for this draft'}</p></div><form method="POST" action="?/selectScene" use:enhance={submit(scene.id)}><input type="hidden" name="revision" value={revision} /><input type="hidden" name="assetId" value={scene.id} /><button disabled={!capability.canEdit || scene.selected || pending !== null}>{scene.selected ? 'Selected scene' : pending === scene.id ? 'Selecting…' : 'Use this scene'}</button></form></article>{/each}</div>
  {#if !scenes.candidates.length}<p class="workspace-empty">No scene candidates are available yet. Add an approved local media derivative and run <code>npm run fixtures:users:local</code>, or request a local-media lookup above.</p>{/if}
</section>
