<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import AreaScene from '$lib/components/scene/AreaScene.svelte';
  import SceneLayer from '$lib/components/scene/SceneLayer.svelte';
  import type { BrewVisualState, SceneTransform } from '$lib/presentation/scene';
  import {
    advanceGuidedStir,
    beginGuidedPointer,
    clamp,
    endGuidedPointer,
    guidedStirTelemetry,
    guidedPointerSampleTime,
    handleGuidedKey,
    moveGuidedPointer,
    restoreGuidedStirState,
    serializeGuidedStirState,
    setGuidedStirVisibility,
    type GuidedStirState,
    type GuidedStirTelemetry,
    type ScenePoint
  } from '$lib/game/scene-motion';

  let {
    visual,
    saveId,
    disabled = false,
    ontelemetry
  }: {
    visual: BrewVisualState;
    saveId: string;
    disabled?: boolean;
    ontelemetry: (telemetry: GuidedStirTelemetry) => void;
  } = $props();

  const liquidEllipse = { centerX: 836, centerY: 463, radiusX: 391, radiusY: 118 };
  let scene = $state<HTMLDivElement>();
  let sceneTransform = $state<SceneTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  let controller = $state<GuidedStirState | null>(null);
  let telemetry = $state<GuidedStirTelemetry | null>(null);
  let pointerId = $state<number | null>(null);
  let pointerType = $state('none');
  let reducedMotion = $state(false);
  let visible = $state(true);
  let mounted = $state(false);
  let trackedSessionId: string | null = null;
  let trackedStorageKey: string | null = null;
  let frame = 0;
  let lastPublished = '';
  let lastStored = '';

  let interactive = $derived(
    visual.phase === 'active' && !disabled && controller?.phase !== 'complete'
  );
  let heated = $derived(visual.phase === 'active' || visual.phase === 'ready');
  let performance = $derived(telemetry?.performance ?? 'ready');
  let displayAngle = $derived(telemetry?.paddleAngle ?? Math.PI / 2);
  let guideAngle = $derived(telemetry?.guideAngle ?? displayAngle);
  let effectStrength = $derived(
    performance === 'perfect' ? 1
      : performance === 'good' ? .7
        : performance === 'grace' ? .5
          : performance === 'finding-rhythm' ? .35 : .18
  );
  let paddleX = $derived(Math.cos(displayAngle) * 205);
  let paddleY = $derived(Math.sin(displayAngle) * 45);
  let paddleRotation = $derived(clamp(Math.cos(displayAngle) * 12, -12, 12));
  let liquidX = $derived(Math.cos(displayAngle) * 3 * effectStrength);
  let liquidY = $derived(Math.sin(displayAngle) * 3 * effectStrength);
  let guideX = $derived(liquidEllipse.centerX + Math.cos(guideAngle) * liquidEllipse.radiusX);
  let guideY = $derived(liquidEllipse.centerY + Math.sin(guideAngle) * liquidEllipse.radiusY);
  let perfectArc = $derived(ellipseArc(guideAngle, Math.PI / 8));
  let goodArc = $derived(ellipseArc(guideAngle, Math.PI / 4));
  let sceneLabel = $derived(
    visual.phase === 'active'
      ? 'Illustrated copper vat. Hold and drag the paddle around the wort to follow the guide, or focus Stir on the beat for keyboard rhythm control.'
      : visual.phase === 'ready'
        ? 'Illustrated copper vat with a finished infusion ready to bottle.'
        : visual.phase === 'result'
          ? 'Illustrated brewery after the latest batch was bottled.'
          : visual.phase === 'blocked'
            ? 'Illustrated brewery at rest while the Bakery has an active loaf.'
            : visual.phase === 'empty'
              ? 'Illustrated brewery waiting for a harvested ingredient.'
              : 'Illustrated brewery prepared for the next infusion.'
  );

  function storageKey(sessionId: string) {
    return `by-rook-and-crook:brew:guide-v2:${saveId}:${sessionId}`;
  }

  function scenePoint(event: PointerEvent, timestamp = Date.now()): ScenePoint {
    const bounds = scene!.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - sceneTransform.offsetX) / Math.max(.001, sceneTransform.scale),
      y: (event.clientY - bounds.top - sceneTransform.offsetY) / Math.max(.001, sceneTransform.scale),
      timestamp
    };
  }

  function ellipseArc(center: number, halfWidth: number) {
    const start = center - halfWidth;
    const end = center + halfWidth;
    const x1 = liquidEllipse.centerX + Math.cos(start) * liquidEllipse.radiusX;
    const y1 = liquidEllipse.centerY + Math.sin(start) * liquidEllipse.radiusY;
    const x2 = liquidEllipse.centerX + Math.cos(end) * liquidEllipse.radiusX;
    const y2 = liquidEllipse.centerY + Math.sin(end) * liquidEllipse.radiusY;
    return `M ${x1} ${y1} A ${liquidEllipse.radiusX} ${liquidEllipse.radiusY} 0 0 1 ${x2} ${y2}`;
  }

  function emit(now: number, force = false) {
    if (!controller) return;
    telemetry = guidedStirTelemetry(controller, now, reducedMotion);
    const signature = [
      telemetry.phase,
      telemetry.inputKind,
      telemetry.direction,
      telemetry.performance,
      Math.ceil(telemetry.remainingMs / 100),
      telemetry.perfectTicks,
      telemetry.goodTicks,
      telemetry.totalTicks
    ].join(':');
    if (force || signature !== lastPublished) {
      lastPublished = signature;
      ontelemetry(telemetry);
    }
    if (trackedStorageKey) {
      const stored = serializeGuidedStirState(controller);
      if (stored !== lastStored) {
        localStorage.setItem(trackedStorageKey, stored);
        lastStored = stored;
      }
    }
  }

  function animate() {
    frame = 0;
    if (!controller || !visible) return;
    const now = Date.now();
    controller = advanceGuidedStir(controller, now, reducedMotion);
    emit(now);
    if (controller.phase !== 'complete') frame = requestAnimationFrame(animate);
  }

  function scheduleFrame() {
    if (!frame && controller && visible && controller.phase !== 'complete') {
      frame = requestAnimationFrame(animate);
    }
  }

  function initialiseController() {
    const session = visual.session;
    if (!mounted) return;
    if (!session) {
      if (trackedStorageKey && visual.phase === 'result') localStorage.removeItem(trackedStorageKey);
      trackedStorageKey = null;
      trackedSessionId = null;
      controller = null;
      telemetry = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      return;
    }
    if (trackedSessionId === session.id) return;
    trackedSessionId = session.id;
    trackedStorageKey = storageKey(session.id);
    lastStored = '';
    lastPublished = '';
    const config = {
      startedAtMs: Date.parse(session.startedAt),
      durationSeconds: session.durationSeconds,
      countdownSeconds: session.countdownSeconds
    };
    controller = restoreGuidedStirState(localStorage.getItem(trackedStorageKey), config, Date.now(), reducedMotion);
    emit(Date.now(), true);
    scheduleFrame();
  }

  function begin(event: PointerEvent) {
    if (!interactive || !scene || !controller) return;
    const update = beginGuidedPointer(controller, scenePoint(event), liquidEllipse, Date.now(), reducedMotion);
    controller = update.state;
    if (!update.accepted) return;
    pointerId = event.pointerId;
    pointerType = event.pointerType || 'unknown';
    try {
      scene.setPointerCapture(event.pointerId);
    } catch {
      // Some synthetic test pointers cannot establish capture.
    }
    emit(Date.now(), true);
    scheduleFrame();
  }

  function move(event: PointerEvent) {
    if (pointerId !== event.pointerId || !interactive || !scene || !controller) return;
    const events = event.getCoalescedEvents?.() ?? [event];
    const receivedAt = Date.now();
    let sampleClock = controller.clockAt;
    for (const sample of events.length > 0 ? events : [event]) {
      const sampleAt = guidedPointerSampleTime(receivedAt, event.timeStamp, sample.timeStamp, sampleClock);
      controller = moveGuidedPointer(controller, scenePoint(sample, sampleAt), liquidEllipse, sampleAt, reducedMotion).state;
      sampleClock = controller.clockAt;
    }
    if (!controller.pointerActive) {
      if (scene.hasPointerCapture(event.pointerId)) scene.releasePointerCapture(event.pointerId);
      pointerId = null;
    }
    emit(Date.now(), true);
    scheduleFrame();
  }

  function release(event: PointerEvent) {
    if (pointerId !== event.pointerId || !controller) return;
    if (scene?.hasPointerCapture(event.pointerId)) scene.releasePointerCapture(event.pointerId);
    pointerId = null;
    controller = endGuidedPointer(controller, Date.now(), reducedMotion);
    emit(Date.now(), true);
    scheduleFrame();
  }

  function stirKey(event: KeyboardEvent) {
    if (!interactive || !controller) return;
    if (!['ArrowLeft', 'ArrowRight', ' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    const update = handleGuidedKey(controller, event.key, Date.now(), event.repeat, reducedMotion);
    controller = update.state;
    if (update.accepted) {
      emit(Date.now(), true);
      scheduleFrame();
    }
  }

  $effect(() => {
    visual.session?.id;
    saveId;
    mounted;
    untrack(initialiseController);
  });

  onMount(() => {
    mounted = true;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => {
      reducedMotion = media.matches;
      if (controller) {
        controller = advanceGuidedStir(controller, Date.now(), reducedMotion);
        emit(Date.now(), true);
      }
    };
    const updateVisibility = () => {
      visible = document.visibilityState === 'visible';
      if (controller) {
        controller = setGuidedStirVisibility(controller, visible, Date.now(), reducedMotion);
        emit(Date.now(), true);
      }
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else scheduleFrame();
    };
    updateMotion();
    updateVisibility();
    media.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    initialiseController();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (controller) {
        controller = setGuidedStirVisibility(controller, false, Date.now(), reducedMotion);
        emit(Date.now(), true);
      }
      media.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  });
</script>

<AreaScene
  area="brewery"
  label={sceneLabel}
  class={`brewery-scene${interactive ? ' guided' : ''}${disabled ? ' disabled' : ''}`}
  bind:element={scene}
  bind:transform={sceneTransform}
  data-motion-proof="brewery"
  data-brew-phase={visual.phase}
  data-stir-phase={telemetry?.phase ?? 'ready'}
  data-input-kind={telemetry?.inputKind ?? 'none'}
  data-direction={telemetry?.direction === 1 ? 'clockwise' : telemetry?.direction === -1 ? 'counterclockwise' : 'none'}
  data-performance={performance}
  data-pointer-type={pointerType}
  data-reduced-motion={reducedMotion}
  data-paddle-angle={displayAngle}
  data-guide-angle={guideAngle}
  data-perfect-ticks={telemetry?.perfectTicks ?? 0}
  data-good-ticks={telemetry?.goodTicks ?? 0}
  data-total-ticks={telemetry?.totalTicks ?? 0}
  onpointerdown={begin}
  onpointermove={move}
  onpointerup={release}
  onpointercancel={release}
>
  <SceneLayer src="/assets/scenes/brewery-environment.webp" name="Brewery environment" essential />
  <img class="layer brazier-fire" class:heated src="/assets/scenes/brewery/brewery-fire.webp" alt="" draggable="false" style={`--heat:${Math.max(.3, effectStrength)}`} />
  <img class="layer wort" src="/assets/scenes/brewery/brewery-wort-surface.webp" alt="" draggable="false" style={`--liquid-x:${liquidX / 782 * 100}%;--liquid-y:${liquidY / 235 * 100}%;--agitation:${effectStrength}`} />
  {#if controller && visual.phase === 'active'}
    <svg class="stir-guide" viewBox="0 0 1672 941" aria-hidden="true">
      <path class="good-corridor" d={goodArc}></path>
      <path class="perfect-corridor" d={perfectArc}></path>
      <circle class="guide-marker" cx={guideX} cy={guideY} r="13"></circle>
      <circle class="guide-center" cx={guideX} cy={guideY} r="4"></circle>
    </svg>
  {/if}
  <img class="layer immersion-shadow" src="/assets/scenes/brewery/brewery-paddle-immersion-shadow.webp" alt="" draggable="false" style={`--paddle-x:${paddleX / 260 * 100}%;--paddle-y:${paddleY / 100 * 100}%;--agitation:${effectStrength}`} />
  <img class="layer paddle" src="/assets/scenes/brewery/brewery-paddle.webp" alt="" draggable="false" style={`--paddle-x:${paddleX / 184 * 100}%;--paddle-y:${paddleY / 570 * 100}%;--paddle-rotation:${paddleRotation}deg`} />
  <img class="layer rim" src="/assets/scenes/brewery/brewery-cauldron-foreground-rim.webp" alt="" draggable="false" />
  <img class="layer steam" class:heated src="/assets/scenes/brewery/brewery-steam.webp" alt="" draggable="false" style={`--agitation:${effectStrength}`} />
  <div class="scene-shade" aria-hidden="true"></div>
  {#if visual.pending || visual.error || visual.phase === 'empty' || visual.phase === 'blocked' || visual.phase === 'result'}
    <div class="phase-banner" class:error={Boolean(visual.error)} aria-hidden="true">
      <span>{visual.error ? 'Ledger interrupted' : visual.pending ? 'Updating the ledger' : visual.phase === 'empty' ? 'Pantry empty' : visual.phase === 'blocked' ? 'Kitchen occupied' : 'Batch bottled'}</span>
    </div>
  {/if}
  {#if interactive}
    <div class="gesture-hint" aria-hidden="true"><span>↻</span> Follow the guide</div>
    <button
      class="beat-control"
      type="button"
      onkeydown={stirKey}
      aria-keyshortcuts="ArrowLeft ArrowRight Space Enter"
      aria-describedby="stir-keyboard-help"
    >Stir on the beat</button>
    <span id="stir-keyboard-help" class="sr-only">Press Left or Right to choose a direction, then press Space, Enter, or the matching arrow once per second.</span>
  {/if}
</AreaScene>

<style>
  :global(.brewery-scene) {
    position: relative; width: 100%; aspect-ratio: 1672 / 941; overflow: hidden;
    border: 1px solid #725426; background: #0a0704;
    box-shadow: inset 0 0 0 1px #120b04, 0 18px 35px #0008;
    isolation: isolate; user-select: none;
  }
  :global(.brewery-scene.guided) { cursor: grab; touch-action: none; }
  :global(.brewery-scene.guided:active) { cursor: grabbing; }
  :global(.brewery-scene.disabled) { cursor: wait; }
  .layer { position: absolute; display: block; max-width: none; pointer-events: none; }
  .brazier-fire {
    left: 26.914%; top: 59.511%; z-index: 1; width: 46.651%; height: 34.538%; opacity: 0;
    mix-blend-mode: screen; transform-origin: 50% 100%; filter: brightness(calc(.78 + var(--heat) * .2));
  }
  .brazier-fire.heated { opacity: .34; animation: fire-breathe 1.15s ease-in-out infinite alternate; }
  .wort {
    left: 26.615%; top: 36.663%; z-index: 2; width: 46.77%; height: 24.973%;
    opacity: calc(.94 + var(--agitation) * .06); transform: translate(var(--liquid-x), var(--liquid-y));
    filter: saturate(calc(1 + var(--agitation) * .08)) brightness(calc(1 + var(--agitation) * .05));
    -webkit-mask: url('/assets/scenes/brewery/brewery-wort-mask.webp') center / 100% 100% no-repeat;
    mask: url('/assets/scenes/brewery/brewery-wort-mask.webp') center / 100% 100% no-repeat;
    will-change: transform, filter;
  }
  .stir-guide { position: absolute; inset: 0; z-index: 3; width: 100%; height: 100%; pointer-events: none; }
  .good-corridor, .perfect-corridor { fill: none; stroke-linecap: round; }
  .good-corridor { stroke: #e0aa45b8; stroke-width: 12; filter: drop-shadow(0 0 5px #d58c265c); }
  .perfect-corridor { stroke: #8fc260e8; stroke-width: 8; filter: drop-shadow(0 0 6px #8fc2608f); }
  .guide-marker { fill: #f4cf65; stroke: #251504; stroke-width: 4; filter: drop-shadow(0 0 8px #f0bd45); }
  .guide-center { fill: #fff0a4; }
  .immersion-shadow {
    left: 42.225%; top: 46.44%; z-index: 3; width: 15.55%; height: 10.627%;
    opacity: calc(.46 + var(--agitation) * .18); transform: translate(var(--paddle-x), var(--paddle-y));
    will-change: transform, opacity;
  }
  .paddle {
    left: 44.498%; top: -2.125%; z-index: 4; width: 11.005%; height: 60.574%;
    transform: translate(var(--paddle-x), var(--paddle-y)) rotate(var(--paddle-rotation));
    transform-origin: 50% 91.228%; filter: drop-shadow(4px 9px 7px #0008); will-change: transform;
  }
  .rim { left: 23.923%; top: 47.822%; z-index: 5; width: 52.333%; height: 37.726%; }
  .steam {
    left: 29.665%; top: 4.251%; z-index: 6; width: 40.67%; height: 48.14%; opacity: 0;
    mix-blend-mode: screen; filter: brightness(.82) sepia(.18); transform-origin: 50% 100%;
  }
  .steam.heated { opacity: calc(.18 + var(--agitation) * .16); animation: steam-rise 3.8s ease-in-out infinite alternate; }
  .scene-shade { position: absolute; inset: 0; z-index: 7; box-shadow: inset 0 0 44px 20px #08040170; pointer-events: none; }
  .phase-banner, .gesture-hint, .beat-control { z-index: 8; }
  .phase-banner {
    position: absolute; left: 50%; bottom: 4%; padding: .45rem .8rem;
    border: 1px solid #a47a38aa; color: #f0d295; background: #100b06df;
    font: 600 .78rem 'Cinzel', serif; letter-spacing: .08em; text-transform: uppercase; transform: translateX(-50%);
  }
  .phase-banner.error { border-color: #a85f49; color: #ffd2c4; }
  .gesture-hint {
    position: absolute; right: 2.5%; bottom: 3%; display: flex; align-items: center; gap: .45rem;
    padding: .4rem .65rem; border: 1px solid #a47a38aa; color: #f0d295; background: #100b06d9;
    font: 600 clamp(.55rem, 1.2vw, .8rem) 'Cinzel', serif; letter-spacing: .06em; text-transform: uppercase;
    pointer-events: none;
  }
  .gesture-hint span { font-size: 1.3em; }
  .beat-control {
    position: absolute; left: 2.5%; bottom: 3%; padding: .48rem .72rem;
    border: 1px solid #b58a42; color: #f6d77f; background: #171006e8;
    font: 700 clamp(.55rem, 1.2vw, .78rem) 'Cinzel', serif; letter-spacing: .05em; text-transform: uppercase;
    cursor: pointer;
  }
  .beat-control:focus-visible { outline: 3px solid #f5d369; outline-offset: 3px; }
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
