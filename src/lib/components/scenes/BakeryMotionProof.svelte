<script lang="ts">
  import { onMount } from 'svelte';
  import AreaScene from '$lib/components/scene/AreaScene.svelte';
  import SceneLayer from '$lib/components/scene/SceneLayer.svelte';
  import { SCENE_HEIGHT, SCENE_WIDTH, clamp, foldPreviewTransform, gestureDistancePercent } from '$lib/game/scene-motion';
  import type { SceneTransform } from '$lib/presentation/scene';

  let {
    phase,
    foldCount = 0,
    scoreCount = 0,
    disabled = false,
    oncommit
  }: {
    phase: 'folding' | 'scoring';
    foldCount?: number;
    scoreCount?: number;
    disabled?: boolean;
    oncommit: (kind: 'fold' | 'score', value: number) => void;
  } = $props();

  let scene = $state<HTMLDivElement>();
  let sceneTransform = $state<SceneTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  let gestureSurface = $state<HTMLButtonElement>();
  let pointerId = $state<number | null>(null);
  let startX = $state(0);
  let currentX = $state(0);
  let currentY = $state(0);
  let settling = $state(false);
  let reducedMotion = $state(false);
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  function scenePoint(event: PointerEvent) {
    const bounds = scene!.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - sceneTransform.offsetX) / Math.max(.001, sceneTransform.scale),
      y: (event.clientY - bounds.top - sceneTransform.offsetY) / Math.max(.001, sceneTransform.scale)
    };
  }

  function begin(event: PointerEvent) {
    if (disabled || !scene) return;
    const point = scenePoint(event);
    pointerId = event.pointerId;
    startX = point.x;
    currentX = point.x;
    currentY = point.y;
    gestureSurface?.setPointerCapture(event.pointerId);
    if (phase === 'scoring') {
      currentX = clamp(point.x, SCENE_WIDTH * .36, SCENE_WIDTH * .64);
      currentY = clamp(point.y, SCENE_HEIGHT * .55, SCENE_HEIGHT * .79);
    }
  }

  function move(event: PointerEvent) {
    if (pointerId !== event.pointerId || !scene) return;
    const point = scenePoint(event);
    currentX = point.x;
    currentY = point.y;
    if (phase === 'scoring') {
      currentX = clamp(point.x, SCENE_WIDTH * .36, SCENE_WIDTH * .64);
      currentY = clamp(point.y, SCENE_HEIGHT * .55, SCENE_HEIGHT * .79);
    }
  }

  function finish(event: PointerEvent) {
    if (pointerId !== event.pointerId || !scene) return;
    const value = gestureDistancePercent(startX, scenePoint(event).x, SCENE_WIDTH);
    if (gestureSurface?.hasPointerCapture(event.pointerId)) gestureSurface.releasePointerCapture(event.pointerId);
    pointerId = null;
    settling = phase === 'folding';
    clearTimeout(settleTimer);
    if (settling) settleTimer = setTimeout(() => (settling = false), reducedMotion ? 0 : 260);
    oncommit(phase === 'folding' ? 'fold' : 'score', value);
  }

  function cancel(event?: PointerEvent) {
    if (event && pointerId !== event.pointerId) return;
    if (event && gestureSurface?.hasPointerCapture(event.pointerId)) gestureSurface.releasePointerCapture(event.pointerId);
    pointerId = null;
    settling = false;
  }

  function keyboardCommit(event: MouseEvent) {
    if (event.detail === 0 && !disabled) oncommit(phase === 'folding' ? 'fold' : 'score', 70);
  }

  onMount(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => (reducedMotion = media.matches);
    update();
    media.addEventListener('change', update);
    return () => {
      clearTimeout(settleTimer);
      media.removeEventListener('change', update);
    };
  });

  let active = $derived(pointerId !== null);
  let preview = $derived(foldPreviewTransform(startX, currentX, SCENE_WIDTH));
  let showRest = $derived(phase === 'folding' && foldCount === 0 && !active && !settling);
  let showActiveFold = $derived(phase === 'folding' && active);
  let showConfirmed = $derived(phase === 'scoring' || settling || phase === 'folding' && foldCount > 0 && !active);
  let toolLeft = $derived(clamp(currentX - 8, 598, 1058));
  let toolTop = $derived(clamp(currentY - 35, 500, 725));
</script>

<AreaScene
  area="bakery"
  label={phase === 'folding' ? 'Illustrated dough folding surface' : 'Illustrated loaf scoring surface'}
  class="bakery-proof"
  bind:element={scene}
  bind:transform={sceneTransform}
  data-motion-proof="bakery"
  data-phase={phase}
  data-transient={active ? 'active' : settling ? 'settling' : 'idle'}
  data-reduced-motion={reducedMotion}
>
  <SceneLayer src="/assets/scenes/bakery-environment.webp" name="Bakery environment" essential />
  <img class="layer surface" src="/assets/scenes/bakery/bakery-preparation-surface.webp" alt="" draggable="false" />
  <img class="layer dough shadow" src="/assets/scenes/bakery/bakery-dough-shadow.webp" alt="" draggable="false" />
  <img class="layer dough rest" class:visible={showRest} src="/assets/scenes/bakery/bakery-dough-rest.webp" alt="" draggable="false" />
  <img
    class="layer dough active-fold"
    class:visible={showActiveFold}
    src="/assets/scenes/bakery/bakery-dough-fold-active.webp"
    alt=""
    draggable="false"
    style={`--fold-x:${preview.translatePercent}%;--fold-scale:${preview.scaleX};--fold-rotation:${preview.rotationDegrees}deg`}
  />
  <img class="layer dough confirmed" class:visible={showConfirmed} src="/assets/scenes/bakery/bakery-dough-fold-confirmed.webp" alt="" draggable="false" />
  {#if scoreCount > 0}
    <img class="layer dough groove" src="/assets/scenes/bakery/bakery-score-groove-01.webp" alt="" draggable="false" />
  {/if}
  {#if phase === 'scoring' && active}
    <img
      class="layer scoring-tool"
      src="/assets/scenes/bakery/bakery-scoring-tool.webp"
      alt=""
      draggable="false"
      style={`left:${toolLeft / 1672 * 100}%;top:${toolTop / 941 * 100}%`}
    />
  {/if}
  <div class="scene-shade" aria-hidden="true"></div>
  <button
    bind:this={gestureSurface}
    class="gesture-surface"
    type="button"
    {disabled}
    aria-label={phase === 'folding'
      ? `Fold dough, ${foldCount} of 6 complete. Drag horizontally or press Enter for a keyboard fold.`
      : `Score loaf, ${scoreCount} of 3 complete. Drag horizontally or press Enter for a keyboard score.`}
    onpointerdown={begin}
    onpointermove={move}
    onpointerup={finish}
    onpointercancel={cancel}
    onclick={keyboardCommit}
  ></button>
  <div class="gesture-hint" aria-hidden="true">
    <span>{phase === 'folding' ? '↔' : '╱'}</span>
    {phase === 'folding' ? 'Drag to fold' : 'Swipe to score'}
  </div>
</AreaScene>

<style>
  :global(.bakery-proof) {
    position: relative;
    width: 100%;
    aspect-ratio: 1672 / 941;
    overflow: hidden;
    border: 1px solid #725426;
    background: #0a0704;
    box-shadow: inset 0 0 0 1px #120b04, 0 18px 35px #0008;
    isolation: isolate;
    user-select: none;
  }
  .layer { position: absolute; display: block; max-width: none; pointer-events: none; }
  .surface { left: 0; top: 58.448%; z-index: 1; width: 100%; height: 41.552%; }
  .dough { left: 35.646%; top: 56.854%; width: 28.708%; height: 26.567%; }
  .shadow { top: 64.293%; z-index: 2; opacity: .82; }
  .rest, .active-fold, .confirmed { z-index: 3; opacity: 0; transition: opacity 130ms ease, transform 260ms cubic-bezier(.2,.72,.2,1); }
  .rest.visible, .active-fold.visible, .confirmed.visible { opacity: 1; }
  .active-fold { transform: translateX(var(--fold-x)) scaleX(var(--fold-scale)) rotate(var(--fold-rotation)); transform-origin: 50% 82%; }
  .confirmed { transform: scale(.985); }
  .groove { z-index: 4; }
  .scoring-tool {
    z-index: 5;
    width: 18.541%;
    height: 7.439%;
    transform-origin: 2.58% 50%;
    filter: drop-shadow(4px 7px 5px #0009);
    will-change: left, top;
  }
  .scene-shade {
    position: absolute;
    inset: 0;
    z-index: 6;
    box-shadow: inset 0 0 44px 18px #08040166;
    pointer-events: none;
  }
  .gesture-surface {
    position: absolute;
    inset: 0;
    z-index: 7;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    color: transparent;
    background: transparent;
    cursor: grab;
    touch-action: none;
  }
  .gesture-surface:active { cursor: grabbing; }
  .gesture-surface:focus-visible { outline: 3px solid #e3b85b; outline-offset: -5px; }
  .gesture-surface:disabled { cursor: wait; }
  .gesture-hint {
    position: absolute;
    right: 2.5%;
    bottom: 3%;
    z-index: 8;
    display: flex;
    align-items: center;
    gap: .45rem;
    padding: .4rem .65rem;
    border: 1px solid #a47a38aa;
    color: #f0d295;
    background: #100b06d9;
    font: 600 clamp(.55rem, 1.2vw, .8rem) 'Cinzel', serif;
    letter-spacing: .06em;
    text-transform: uppercase;
    pointer-events: none;
  }
  .gesture-hint span { font-size: 1.25em; }
  @media (prefers-reduced-motion: reduce) {
    .rest, .active-fold, .confirmed { transition: none; }
    .active-fold { transform: none; }
    .scoring-tool { will-change: auto; }
  }
</style>
