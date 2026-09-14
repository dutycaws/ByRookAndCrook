<script lang="ts">
  type PreviewAsset = {
    previewUrl: string | null;
    altText: string;
  };

  type SettingAsset = PreviewAsset & {
    name: string;
  };

  let {
    npcName,
    portrait = null,
    setting = null
  }: {
    npcName: string;
    portrait?: PreviewAsset | null;
    setting?: SettingAsset | null;
  } = $props();

  let portraitFailed = $state(false);
  let settingFailed = $state(false);
  $effect(() => {
    portrait?.previewUrl;
    portraitFailed = false;
  });
  $effect(() => {
    setting?.previewUrl;
    settingFailed = false;
  });

  const portraitReady = $derived(Boolean(portrait?.previewUrl && !portraitFailed));
  const settingReady = $derived(Boolean(setting?.previewUrl && !settingFailed));
  const selectionComplete = $derived(Boolean(portrait && setting));
  const previewReady = $derived(portraitReady && settingReady);
  const sceneLabel = $derived(`${npcName || 'This companion'} in ${setting?.name ?? 'their chosen setting'}`);
  const statusMessage = $derived.by(() => {
    if (selectionComplete && !previewReady) return 'Preview artwork is unavailable. Your saved selections are unchanged.';
    if (!portrait && !setting) return 'Select a portrait and setting to see the companion scene.';
    if (!portrait) return `Choose a transparent portrait to preview ${npcName || 'this companion'} in this setting.`;
    if (!setting) return 'Choose a setting to place this portrait in a scene.';
    return null;
  });
</script>

<section class="workspace-panel authoring-scene-preview" aria-labelledby="scene-preview-heading" id="scene-preview">
  <div class="workspace-panel-heading">
    <span class="workspace-step">04</span>
    <div>
      <p class="eyebrow">Preview the finished composition</p>
      <h2 id="scene-preview-heading">Meet them in the tavern</h2>
      <p>Review the persisted transparent sprite and setting together before you test dialogue or submit the companion.</p>
    </div>
  </div>

  <figure aria-labelledby="scene-preview-caption">
    <div class:incomplete={!previewReady} class="scene-stage" data-authoring-scene-preview data-preview-ready={previewReady}>
      {#if settingReady}
        <img class="scene-setting" src={setting?.previewUrl ?? ''} alt="" onerror={() => settingFailed = true} />
      {/if}
      {#if portraitReady}
        <img class="scene-portrait" src={portrait?.previewUrl ?? ''} alt="" onerror={() => portraitFailed = true} />
      {/if}
      {#if statusMessage}
        <div class="preview-status" role="status" aria-live="polite">
          <strong>Scene preview incomplete</strong>
          <span>{statusMessage}</span>
          <nav aria-label="Complete the scene preview">
            {#if !portrait}<a href="#portrait-artwork">Choose portrait</a>{/if}
            {#if !setting}<a href="#setting-library">Choose setting</a>{/if}
          </nav>
        </div>
      {/if}
    </div>
    <figcaption id="scene-preview-caption">
      <strong>{sceneLabel}</strong>
      <span>{previewReady ? 'This is how the selected art reads as one scene.' : 'The preview updates after each choice is confirmed.'}</span>
    </figcaption>
  </figure>
</section>

<style>
  .authoring-scene-preview,
  figure { display: grid; gap: .85rem; }
  figure { margin: 0; }
  .scene-stage {
    position: relative;
    width: 100%;
    min-height: clamp(13rem, 32vw, 28rem);
    aspect-ratio: 16 / 9;
    overflow: hidden;
    isolation: isolate;
    border: 1px solid #8e692d;
    border-radius: .35rem;
    background: radial-gradient(circle at 50% 28%, #49321b, #110d08 70%);
    box-shadow: inset 0 0 3rem #050301b8;
  }
  .scene-stage::after {
    content: '';
    position: absolute;
    inset: 58% 0 0;
    z-index: 2;
    pointer-events: none;
    background: linear-gradient(transparent, #090603b8);
  }
  .scene-stage.incomplete::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 3;
    background: #0907048f;
    pointer-events: none;
  }
  .scene-setting,
  .scene-portrait { position: absolute; display: block; user-select: none; pointer-events: none; }
  .scene-setting { inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .scene-portrait {
    z-index: 1;
    left: 50%;
    bottom: 0;
    width: min(44%, 34rem);
    height: 88%;
    object-fit: contain;
    object-position: center bottom;
    transform: translateX(-50%);
    filter: drop-shadow(0 1.1rem 1rem #000b);
  }
  .preview-status {
    position: absolute;
    inset: 50% auto auto 50%;
    z-index: 4;
    display: grid;
    width: min(34rem, calc(100% - 2rem));
    gap: .45rem;
    padding: 1.15rem 1.35rem;
    border: 1px solid #8e692d;
    border-radius: .35rem;
    color: #ead8a6;
    background: #120d08e8;
    text-align: center;
    transform: translate(-50%, -50%);
  }
  .preview-status strong { color: #f3c95f; font-family: 'Cinzel', serif; }
  .preview-status nav { display: flex; justify-content: center; flex-wrap: wrap; gap: .55rem 1rem; }
  .preview-status a { color: #f3c95f; text-underline-offset: .2em; }
  figcaption { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; color: #cbb98c; }
  figcaption strong { color: #f3c95f; font-family: 'Cinzel', serif; }
  figcaption span { text-align: right; }
  @media (max-width: 640px) {
    .scene-portrait { width: 60%; height: 90%; }
    figcaption { align-items: flex-start; flex-direction: column; gap: .25rem; }
    figcaption span { text-align: left; }
  }
</style>
