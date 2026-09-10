<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SCENE_HEIGHT,
    SCENE_WIDTH,
    advanceStirPhase,
    beginCircularStir,
    clamp,
    createCircularStirState,
    releaseCircularStir,
    sampleCircularStir,
    tickCircularStir,
    type CircularStirState,
    type ScenePoint
  } from '$lib/game/scene-motion';

  let {
    speed,
    mode = 'physical',
    disabled = false,
    onspeed
  }: {
    speed: number;
    mode?: 'physical' | 'assisted';
    disabled?: boolean;
    onspeed: (speed: number) => void;
  } = $props();

  const liquidEllipse = { centerX: 836, centerY: 463, radiusX: 391, radiusY: 118 };
  let scene = $state<HTMLDivElement>();
  let tracker = $state<CircularStirState>(createCircularStirState());
  let pointerId = $state<number | null>(null);
  let phase = $state(Math.PI / 2);
  let reducedMotion = $state(false);
  let visible = $state(true);
  let frame = 0;
  let lastFrameAt: number | null = null;
  let trackedMode: 'physical' | 'assisted' = 'physical';

  function scenePoint(event: PointerEvent): ScenePoint {
    const bounds = scene!.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / Math.max(1, bounds.width) * SCENE_WIDTH,
      y: (event.clientY - bounds.top) / Math.max(1, bounds.height) * SCENE_HEIGHT,
      timestamp: event.timeStamp
    };
  }

  function publish(next: number) {
    const bounded = clamp(next, 0, 100);
    if (Math.abs(bounded - speed) >= 0.05) onspeed(bounded);
  }

  function needsFrame() {
    return visible && (mode === 'assisted' ? speed > 0 : tracker.dragging || tracker.speed > 0 || tracker.decayStartedAt !== null);
  }

  function scheduleFrame() {
    if (!frame && needsFrame()) frame = requestAnimationFrame(animate);
  }

  function animate(timestamp: number) {
    frame = 0;
    if (!visible) return;
    const elapsed = lastFrameAt === null ? 0 : Math.min(100, timestamp - lastFrameAt);
    lastFrameAt = timestamp;

    if (mode === 'physical') {
      tracker = tickCircularStir(tracker, timestamp);
      publish(tracker.speed);
    }
    const motionSpeed = mode === 'physical' ? tracker.speed : speed;
    if (!reducedMotion) phase = advanceStirPhase(phase, motionSpeed, tracker.direction, elapsed);
    if (needsFrame()) frame = requestAnimationFrame(animate);
    else lastFrameAt = null;
  }

  function begin(event: PointerEvent) {
    if (disabled || mode !== 'physical' || !scene) return;
    pointerId = event.pointerId;
    scene.setPointerCapture(event.pointerId);
    tracker = beginCircularStir(tracker, scenePoint(event), liquidEllipse);
    scheduleFrame();
  }

  function move(event: PointerEvent) {
    if (pointerId !== event.pointerId || mode !== 'physical' || !scene) return;
    const update = sampleCircularStir(tracker, scenePoint(event), liquidEllipse);
    tracker = update.state;
    if (update.accepted) publish(tracker.speed);
    scheduleFrame();
  }

  function release(event: PointerEvent) {
    if (pointerId !== event.pointerId) return;
    if (scene?.hasPointerCapture(event.pointerId)) scene.releasePointerCapture(event.pointerId);
    pointerId = null;
    tracker = releaseCircularStir(tracker, event.timeStamp);
    scheduleFrame();
  }

  $effect(() => {
    if (mode !== trackedMode) {
      trackedMode = mode;
      pointerId = null;
      tracker = createCircularStirState();
      lastFrameAt = null;
    }
    speed;
    scheduleFrame();
  });

  onMount(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => (reducedMotion = media.matches);
    const updateVisibility = () => {
      visible = document.visibilityState === 'visible';
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        lastFrameAt = null;
      }
      if (!visible && mode === 'physical') {
        if (pointerId !== null && scene?.hasPointerCapture(pointerId)) scene.releasePointerCapture(pointerId);
        pointerId = null;
        tracker = createCircularStirState();
        publish(0);
      } else scheduleFrame();
    };
    updateMotion();
    updateVisibility();
    media.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      media.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  });

  let displayPhase = $derived(reducedMotion ? Math.PI / 2 : phase);
  let motionSpeed = $derived(mode === 'physical' ? tracker.speed : speed);
  let paddleX = $derived(Math.cos(displayPhase) * 205);
  let paddleY = $derived(Math.sin(displayPhase) * 45);
  let paddleRotation = $derived(clamp(Math.cos(displayPhase) * 12, -12, 12));
  let liquidX = $derived(Math.cos(displayPhase) * 3 * (motionSpeed / 100));
  let liquidY = $derived(Math.sin(displayPhase) * 3 * (motionSpeed / 100));
</script>

<div
  class="brewery-proof"
  class:physical={mode === 'physical'}
  class:disabled
  bind:this={scene}
  data-motion-proof="brewery"
  data-input-mode={mode}
  data-reduced-motion={reducedMotion}
  data-speed={Math.round(motionSpeed)}
  role="group"
  aria-label="Illustrated copper vat. Drag in a circle around the liquid to stir; keyboard users can select assisted stirring below."
  onpointerdown={begin}
  onpointermove={move}
  onpointerup={release}
  onpointercancel={release}
>
  <img class="layer environment" src="/assets/scenes/brewery-environment.webp" alt="" draggable="false" />
  <img
    class="layer wort"
    src="/assets/scenes/brewery/brewery-wort-surface.webp"
    alt=""
    draggable="false"
    style={`--liquid-x:${liquidX / 782 * 100}%;--liquid-y:${liquidY / 235 * 100}%;--agitation:${motionSpeed / 100}`}
  />
  <img
    class="layer paddle"
    src="/assets/scenes/brewery/brewery-paddle.webp"
    alt=""
    draggable="false"
    style={`--paddle-x:${paddleX / 184 * 100}%;--paddle-y:${paddleY / 570 * 100}%;--paddle-rotation:${paddleRotation}deg`}
  />
  <img class="layer rim" src="/assets/scenes/brewery/brewery-cauldron-foreground-rim.webp" alt="" draggable="false" />
  <div class="scene-shade" aria-hidden="true"></div>
  {#if mode === 'physical'}
    <div class="gesture-hint" aria-hidden="true"><span>↻</span> Circle the wort</div>
  {/if}
</div>

<style>
  .brewery-proof {
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
  .brewery-proof.physical { cursor: grab; touch-action: none; }
  .brewery-proof.physical:active { cursor: grabbing; }
  .brewery-proof.disabled { cursor: wait; opacity: .78; }
  .layer { position: absolute; display: block; max-width: none; pointer-events: none; }
  .environment { inset: 0; z-index: 0; width: 100%; height: 100%; }
  .wort {
    left: 26.615%;
    top: 36.663%;
    z-index: 2;
    width: 46.77%;
    height: 24.973%;
    opacity: calc(.94 + var(--agitation) * .06);
    transform: translate(var(--liquid-x), var(--liquid-y));
    filter: saturate(calc(1 + var(--agitation) * .08)) brightness(calc(1 + var(--agitation) * .05));
    -webkit-mask: url('/assets/scenes/brewery/brewery-wort-mask.webp') center / 100% 100% no-repeat;
    mask: url('/assets/scenes/brewery/brewery-wort-mask.webp') center / 100% 100% no-repeat;
    will-change: transform, filter;
  }
  .paddle {
    left: 44.498%;
    top: -2.125%;
    z-index: 3;
    width: 11.005%;
    height: 60.574%;
    transform: translate(var(--paddle-x), var(--paddle-y)) rotate(var(--paddle-rotation));
    transform-origin: 50% 91.228%;
    filter: drop-shadow(4px 9px 7px #0008);
    will-change: transform;
  }
  .rim { left: 23.923%; top: 47.822%; z-index: 4; width: 52.333%; height: 37.726%; }
  .scene-shade {
    position: absolute;
    inset: 0;
    z-index: 5;
    box-shadow: inset 0 0 44px 20px #08040170;
    pointer-events: none;
  }
  .gesture-hint {
    position: absolute;
    right: 2.5%;
    bottom: 3%;
    z-index: 6;
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
  .gesture-hint span { font-size: 1.3em; }
  @media (prefers-reduced-motion: reduce) {
    .wort, .paddle { will-change: auto; }
    .gesture-hint span { display: none; }
  }
</style>
