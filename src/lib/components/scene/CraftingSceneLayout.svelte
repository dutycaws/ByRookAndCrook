<script lang="ts">
  import type { Snippet } from 'svelte';
  import SceneRail from './SceneRail.svelte';

  let {
    area,
    statusTitle,
    inspectorTitle,
    status,
    scene,
    inspector,
    action
  }: {
    area: 'garden' | 'brewery' | 'bakery';
    statusTitle: string;
    inspectorTitle: string;
    status: Snippet;
    scene: Snippet;
    inspector: Snippet;
    action?: Snippet;
  } = $props();
</script>

<div class="crafting-layout" class:withoutAction={!action} data-crafting-layout={area}>
  <div class="desktop-status">
    <SceneRail eyebrow="Tavern status" title={statusTitle}>{@render status()}</SceneRail>
  </div>
  <div class="crafting-scene">{@render scene()}</div>
  {#if action}<div class="crafting-action">{@render action()}</div>{/if}
  <div class="crafting-inspector">
    <SceneRail eyebrow="Current context" title={inspectorTitle} kind="inspector">{@render inspector()}</SceneRail>
  </div>
  <details class="mobile-status">
    <summary>{statusTitle}</summary>
    <div>{@render status()}</div>
  </details>
</div>

<style>
  .crafting-layout {
    display: grid;
    grid-template-columns: minmax(190px, 16fr) minmax(520px, 58fr) minmax(230px, 22fr);
    grid-template-areas: 'status scene inspector' 'status action inspector';
    align-items: start;
    gap: 8px;
  }
  .desktop-status { grid-area: status; }
  .crafting-scene { grid-area: scene; min-width: 0; }
  .crafting-action { grid-area: action; min-width: 0; }
  .crafting-inspector { grid-area: inspector; min-width: 0; }
  .mobile-status { display: none; }
  .crafting-layout.withoutAction { grid-template-areas: 'status scene inspector'; }
  :global(.crafting-layout .scene-rail .detail-card) { min-height: 0; border: 0; box-shadow: none; background: transparent; padding: 0; }
  :global(.crafting-layout .scene-rail .secondary-link) { margin-top: .75rem; }
  @media (max-width: 1000px) {
    .crafting-layout {
      grid-template-columns: minmax(0, 1fr) minmax(230px, .45fr);
      grid-template-areas: 'scene scene' 'action action' 'inspector status';
    }
    .crafting-layout.withoutAction { grid-template-areas: 'scene scene' 'inspector status'; }
  }
  @media (max-width: 620px) {
    .crafting-layout { grid-template-columns: 1fr; grid-template-areas: 'scene' 'action' 'inspector' 'mobile-status'; }
    .crafting-layout.withoutAction { grid-template-areas: 'scene' 'inspector' 'mobile-status'; }
    .desktop-status { display: none; }
    .mobile-status { display: block; grid-area: mobile-status; border: 1px solid #493719; background: #151008; }
    .mobile-status summary { min-height: 48px; padding: .85rem 1rem; color: #e6c46d; font-family: 'Cinzel', serif; cursor: pointer; }
    .mobile-status > div { padding: 0 1rem 1rem; }
  }
</style>
