<script lang="ts">
  import { onMount } from 'svelte';
  import AreaScene from '$lib/components/scene/AreaScene.svelte';
  import SceneLayer from '$lib/components/scene/SceneLayer.svelte';
  import type { BrewVisualState, SceneTransform } from '$lib/presentation/scene';
  import {
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
    visual,
    mode = 'physical',
    disabled = false,
    onspeed
  }: {
    visual: BrewVisualState;
    mode?: 'physical' | 'assisted';
    disabled?: boolean;
    onspeed: (speed: number) => void;
  } = $props();

  const liquidEllipse = { centerX: 836, centerY: 463, radiusX: 391, radiusY: 118 };
  let scene = $state<HTMLDivElement>();
  let sceneTransform = $state<SceneTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  let tracker = $state<CircularStirState>(createCircularStirState());
  let pointerId = $state<number | null>(null);
  let pointerType = $state('none');
  let motionPhase = $state(Math.PI / 2);
  let reducedMotion = $state(false);
  let visible = $state(true);
  let frame = 0;
  let lastFrameAt: number | null = null;
  let trackedMode: 'physical' | 'assisted' = 'physical';
  let trackedInteractive = false;

  let speed = $derived(visual.agitation.speed);
  let interactive = $derived(visual.phase === 'active' && !disabled && mode === 'physical');
  let heated = $derived(visual.phase === 'active' || visual.phase === 'ready');
  let sceneLabel = $derived(
    visual.phase === 'active'
      ? 'Illustrated copper vat. Drag in a circle around the liquid to stir; keyboard users can select assisted stirring below.'
      : visual.phase === 'ready'
        ? 'Illustrated copper vat with a finished infusion ready to bottle.'
        : visual.phase === 'result'
          ? 'Illustrated brewery after the day’s batch has been bottled.'
          : visual.phase === 'blocked'
            ? 'Illustrated brewery at rest while the Bakery uses today’s kitchen craft.'
            : visual.phase === 'empty'
              ? 'Illustrated brewery waiting for a harvested ingredient.'
              : 'Illustrated brewery prepared for the next infusion.'
  );

  function scenePoint(event: PointerEvent): ScenePoint {
    const bounds = scene!.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - sceneTransform.offsetX) / Math.max(.001, sceneTransform.scale),
      y: (event.clientY - bounds.top - sceneTransform.offsetY) / Math.max(.001, sceneTransform.scale),
      timestamp: event.timeStamp
    };
  }

  function publish(next: number) {
    const bounded = clamp(next, 0, 100);
    if (Math.abs(bounded - speed) >= .05) onspeed(bounded);
  }

  function needsFrame() {
    if (!visible || visual.phase !== 'active') return false;
    return mode === 'assisted'
      ? speed > 0
      : tracker.dragging || tracker.speed > 0 || tracker.decayStartedAt !== null;
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
    const currentSpeed = mode === 'physical' ? tracker.speed : speed;
    if (!reducedMotion) motionPhase = advanceStirPhase(motionPhase, currentSpeed, tracker.direction, elapsed);
    if (needsFrame()) frame = requestAnimationFrame(animate);
    else lastFrameAt = null;
  }

  function begin(event: PointerEvent) {
    if (!interactive || !scene) return;
    pointerId = event.pointerId;
    pointerType = event.pointerType || 'unknown';
    try {
      scene.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events cannot establish capture; real active pointers still do.
    }
    tracker = beginCircularStir(tracker, scenePoint(event), liquidEllipse);
    scheduleFrame();
  }

  function move(event: PointerEvent) {
    if (pointerId !== event.pointerId || !interactive || !scene) return;
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

  function resetPhysicalInput(publishZero: boolean) {
    if (pointerId !== null && scene?.hasPointerCapture(pointerId)) scene.releasePointerCapture(pointerId);
    pointerId = null;
    pointerType = 'none';
    tracker = createCircularStirState();
    lastFrameAt = null;
    if (publishZero) publish(0);
  }

  $effect(() => {
    if (mode !== trackedMode || interactive !== trackedInteractive) {
      const shouldClearSpeed = mode !== 'assisted';
      trackedMode = mode;
      trackedInteractive = interactive;
      resetPhysicalInput(shouldClearSpeed);
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
      if (!visible && mode === 'physical') resetPhysicalInput(true);
      else scheduleFrame();
    };
    updateMotion();
    updateVisibility();
    media.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resetPhysicalInput(false);
      media.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  });

  let displayPhase = $derived(reducedMotion ? Math.PI / 2 : motionPhase);
  let motionSpeed = $derived(mode === 'physical' ? tracker.speed : speed);
  let effectSpeed = $derived(reducedMotion ? 0 : motionSpeed);
  let paddleX = $derived(Math.cos(displayPhase) * 205);
  let paddleY = $derived(Math.sin(displayPhase) * 45);
  let paddleRotation = $derived(clamp(Math.cos(displayPhase) * 12, -12, 12));
  let liquidX = $derived(Math.cos(displayPhase) * 3 * (effectSpeed / 100));
  let liquidY = $derived(Math.sin(displayPhase) * 3 * (effectSpeed / 100));
</script>

<AreaScene
  area="brewery"
  label={sceneLabel}
  class={`brewery-scene${interactive ? ' physical' : ''}${disabled ? ' disabled' : ''}`}
  bind:element={scene}
  bind:transform={sceneTransform}
  data-motion-proof="brewery"
  data-brew-phase={visual.phase}
  data-input-mode={mode}
  data-pointer-type={pointerType}
  data-reduced-motion={reducedMotion}
  data-speed={Math.round(motionSpeed)}
  onpointerdown={begin}
  onpointermove={move}
  onpointerup={release}
  onpointercancel={release}
>
  <SceneLayer src="/assets/scenes/brewery-environment.webp" name="Brewery environment" essential />
  <img class="layer brazier-fire" class:heated src="/assets/scenes/brewery/brewery-fire.webp" alt="" draggable="false" style={`--heat:${Math.max(.3, effectSpeed / 100)}`} />
  <img class="layer wort" src="/assets/scenes/brewery/brewery-wort-surface.webp" alt="" draggable="false" style={`--liquid-x:${liquidX / 782 * 100}%;--liquid-y:${liquidY / 235 * 100}%;--agitation:${effectSpeed / 100}`} />
  <img class="layer immersion-shadow" src="/assets/scenes/brewery/brewery-paddle-immersion-shadow.webp" alt="" draggable="false" style={`--paddle-x:${paddleX / 260 * 100}%;--paddle-y:${paddleY / 100 * 100}%;--agitation:${effectSpeed / 100}`} />
  <img class="layer paddle" src="/assets/scenes/brewery/brewery-paddle.webp" alt="" draggable="false" style={`--paddle-x:${paddleX / 184 * 100}%;--paddle-y:${paddleY / 570 * 100}%;--paddle-rotation:${paddleRotation}deg`} />
  <img class="layer rim" src="/assets/scenes/brewery/brewery-cauldron-foreground-rim.webp" alt="" draggable="false" />
  <img class="layer steam" class:heated src="/assets/scenes/brewery/brewery-steam.webp" alt="" draggable="false" style={`--agitation:${effectSpeed / 100}`} />
  <div class="scene-shade" aria-hidden="true"></div>
  {#if visual.pending || visual.error || visual.phase === 'empty' || visual.phase === 'blocked' || visual.phase === 'result'}
    <div class="phase-banner" class:error={Boolean(visual.error)} aria-hidden="true">
      <span>{visual.error ? 'Ledger interrupted' : visual.pending ? 'Updating the ledger' : visual.phase === 'empty' ? 'Pantry empty' : visual.phase === 'blocked' ? 'Kitchen occupied' : 'Batch bottled'}</span>
    </div>
  {/if}
  {#if interactive}
    <div class="gesture-hint" aria-hidden="true"><span>↻</span> Circle the wort</div>
  {/if}
</AreaScene>

<style>
  :global(.brewery-scene) {
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
  :global(.brewery-scene.physical) { cursor: grab; touch-action: none; }
  :global(.brewery-scene.physical:active) { cursor: grabbing; }
  :global(.brewery-scene.disabled) { cursor: wait; }
  .layer { position: absolute; display: block; max-width: none; pointer-events: none; }
  .brazier-fire {
    left: 26.914%; top: 59.511%; z-index: 1; width: 46.651%; height: 34.538%; opacity: 0;
    mix-blend-mode: screen; transform-origin: 50% 100%; filter: brightness(calc(.78 + var(--heat) * .2));
  }
  .brazier-fire.heated { opacity: .34; animation: fire-breathe 1.15s ease-in-out infinite alternate; }
  .wort {
    left: 26.615%; top: 36.663%; z-index: 2; width: 46.77%; height: 24.973%;
    opacity: calc(.94 + var(--agitation) * .06);
    transform: translate(var(--liquid-x), var(--liquid-y));
    filter: saturate(calc(1 + var(--agitation) * .08)) brightness(calc(1 + var(--agitation) * .05));
    -webkit-mask: url('/assets/scenes/brewery/brewery-wort-mask.webp') center / 100% 100% no-repeat;
    mask: url('/assets/scenes/brewery/brewery-wort-mask.webp') center / 100% 100% no-repeat;
    will-change: transform, filter;
  }
  .immersion-shadow {
    left: 42.225%; top: 46.44%; z-index: 2; width: 15.55%; height: 10.627%;
    opacity: calc(.46 + var(--agitation) * .18); transform: translate(var(--paddle-x), var(--paddle-y));
    will-change: transform, opacity;
  }
  .paddle {
    left: 44.498%; top: -2.125%; z-index: 3; width: 11.005%; height: 60.574%;
    transform: translate(var(--paddle-x), var(--paddle-y)) rotate(var(--paddle-rotation));
    transform-origin: 50% 91.228%; filter: drop-shadow(4px 9px 7px #0008); will-change: transform;
  }
  .rim { left: 23.923%; top: 47.822%; z-index: 4; width: 52.333%; height: 37.726%; }
  .steam {
    left: 29.665%; top: 4.251%; z-index: 5; width: 40.67%; height: 48.14%; opacity: 0;
    mix-blend-mode: screen; filter: brightness(.82) sepia(.18); transform-origin: 50% 100%;
  }
  .steam.heated { opacity: calc(.18 + var(--agitation) * .16); animation: steam-rise 3.8s ease-in-out infinite alternate; }
  .scene-shade { position: absolute; inset: 0; z-index: 6; box-shadow: inset 0 0 44px 20px #08040170; pointer-events: none; }
  .phase-banner {
    position: absolute; left: 50%; bottom: 4%; z-index: 8; padding: .45rem .8rem;
    border: 1px solid #a47a38aa; color: #f0d295; background: #100b06df;
    font: 600 .78rem 'Cinzel', serif; letter-spacing: .08em; text-transform: uppercase; transform: translateX(-50%);
  }
  .phase-banner.error { border-color: #a85f49; color: #ffd2c4; }
  .gesture-hint {
    position: absolute; right: 2.5%; bottom: 3%; z-index: 8; display: flex; align-items: center; gap: .45rem;
    padding: .4rem .65rem; border: 1px solid #a47a38aa; color: #f0d295; background: #100b06d9;
    font: 600 clamp(.55rem, 1.2vw, .8rem) 'Cinzel', serif; letter-spacing: .06em; text-transform: uppercase;
    pointer-events: none;
  }
  .gesture-hint span { font-size: 1.3em; }
  @keyframes fire-breathe {
    from { transform: scaleY(.97) translateY(2px); opacity: .28; }
    to { transform: scaleY(1.035) translateY(-2px); opacity: .4; }
  }
  @keyframes steam-rise {
    from { transform: translate3d(-3px, 4px, 0) scaleY(.98); }
    to { transform: translate3d(4px, -7px, 0) scaleY(1.025); }
  }
  :global(.brewery-scene[data-scene-visible='false']) .brazier-fire,
  :global(.brewery-scene[data-scene-visible='false']) .steam { animation-play-state: paused; }
  @media (prefers-reduced-motion: reduce) {
    .wort, .paddle, .immersion-shadow { will-change: auto; }
    .brazier-fire.heated, .steam.heated { animation: none; }
    .gesture-hint span { display: none; }
  }
</style>
