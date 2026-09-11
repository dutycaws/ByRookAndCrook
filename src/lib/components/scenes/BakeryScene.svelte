<script lang="ts">
  import { onMount } from 'svelte';
  import AreaScene from '$lib/components/scene/AreaScene.svelte';
  import SceneLayer from '$lib/components/scene/SceneLayer.svelte';
  import { SCENE_HEIGHT, SCENE_WIDTH, clamp, foldPreviewTransform, gestureDistancePercent } from '$lib/game/scene-motion';
  import type { BakeVisualState, SceneTransform } from '$lib/presentation/scene';

  let {
    visual,
    disabled = false,
    oncommit
  }: {
    visual: BakeVisualState;
    disabled?: boolean;
    oncommit: (kind: 'fold' | 'score', value: number) => void;
  } = $props();

  let scene = $state<HTMLDivElement>();
  let sceneTransform = $state<SceneTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  let gestureSurface = $state<HTMLButtonElement>();
  let pointerId = $state<number | null>(null);
  let pointerType = $state('none');
  let startX = $state(0);
  let currentX = $state(0);
  let currentY = $state(0);
  let pointerMoved = $state(false);
  let settling = $state(false);
  let reducedMotion = $state(false);
  let frozenOven = $state<{ appearance: 'pale' | 'ideal' | 'overbaked'; riseProgress: number }>({
    appearance: 'pale',
    riseProgress: 0
  });
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let trackedPhase: BakeVisualState['phase'] | null = null;

  const scoringBounds = {
    left: SCENE_WIDTH * .356,
    right: SCENE_WIDTH * .644,
    top: SCENE_HEIGHT * .55,
    bottom: SCENE_HEIGHT * .835
  };

  let phase = $derived(visual.phase);
  let interaction = $derived(phase === 'folding' || phase === 'scoring' ? phase : null);
  let preparationPhase = $derived(!['ready', 'baking', 'result'].includes(phase));
  let active = $derived(pointerId !== null);
  let preview = $derived(foldPreviewTransform(startX, currentX, SCENE_WIDTH));
  let showRest = $derived(phase === 'folding' && visual.folds.complete === 0 && !active && !settling);
  let showActiveFold = $derived(phase === 'folding' && active);
  let showConfirmed = $derived(
    phase === 'scoring' || settling || phase === 'folding' && visual.folds.complete > 0 && !active
  );
  let toolLeft = $derived(clamp(currentX - 8, 598, 1058));
  let toolTop = $derived(clamp(currentY - 35, 500, 725));
  let inserting = $derived(phase === 'baking' && visual.oven.elapsedMs < 1_250);
  let showPeel = $derived(phase === 'ready' || phase === 'result' || inserting);
  let resultOverbaked = $derived((visual.result.qualityIndex ?? 4) < 3);
  let paleOpacity = $derived(
    phase === 'ready' ? 1 : phase === 'baking' ? Math.max(0, 1 - visual.oven.crustProgress) : 0
  );
  let idealOpacity = $derived(
    phase === 'result'
      ? resultOverbaked ? 0 : 1
      : phase === 'baking'
        ? Math.min(1, visual.oven.crustProgress) * (1 - visual.oven.overbakeProgress)
        : 0
  );
  let overbakedOpacity = $derived(
    phase === 'result'
      ? resultOverbaked ? 1 : 0
      : phase === 'baking' ? visual.oven.overbakeProgress : 0
  );
  let renderedAppearance = $derived(
    reducedMotion
      ? frozenOven.appearance
      : phase === 'result' ? resultOverbaked ? 'overbaked' : 'ideal' : visual.oven.appearance
  );
  let renderedRise = $derived(reducedMotion ? frozenOven.riseProgress : visual.oven.riseProgress);
  let renderedPaleOpacity = $derived(reducedMotion ? renderedAppearance === 'pale' ? 1 : 0 : paleOpacity);
  let renderedIdealOpacity = $derived(reducedMotion ? renderedAppearance === 'ideal' ? 1 : 0 : idealOpacity);
  let renderedOverbakedOpacity = $derived(reducedMotion ? renderedAppearance === 'overbaked' ? 1 : 0 : overbakedOpacity);
  let sceneLabel = $derived(
    phase === 'folding'
      ? `Illustrated dough folding bench, ${visual.folds.complete} of 6 folds confirmed.`
      : phase === 'scoring'
        ? `Illustrated loaf scoring bench, ${visual.scores.complete} of 3 scores confirmed.`
        : phase === 'ready'
          ? 'Illustrated stone oven with the prepared loaf waiting on its peel.'
          : phase === 'baking'
            ? `Illustrated stone oven baking the loaf; timing is ${visual.oven.band}.`
            : phase === 'result'
              ? 'Illustrated stone oven with the confirmed finished loaf on its peel.'
              : phase === 'blocked'
                ? 'Illustrated bakery bench at rest while the Brewery uses today’s kitchen craft.'
                : phase === 'empty'
                  ? 'Illustrated bakery bench waiting for a harvested ingredient.'
                  : 'Illustrated full-width bakery preparation bench.'
  );

  function scenePoint(event: PointerEvent) {
    const bounds = scene!.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - sceneTransform.offsetX) / Math.max(.001, sceneTransform.scale),
      y: (event.clientY - bounds.top - sceneTransform.offsetY) / Math.max(.001, sceneTransform.scale)
    };
  }

  function begin(event: PointerEvent) {
    if (disabled || !scene || !interaction) return;
    const point = scenePoint(event);
    if (interaction === 'scoring' && (
      point.x < scoringBounds.left || point.x > scoringBounds.right
      || point.y < scoringBounds.top || point.y > scoringBounds.bottom
    )) return;
    pointerId = event.pointerId;
    pointerType = event.pointerType || 'unknown';
    startX = point.x;
    currentX = point.x;
    currentY = point.y;
    pointerMoved = false;
    try {
      gestureSurface?.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events cannot establish capture; real active pointers still do.
    }
    if (interaction === 'scoring') {
      currentX = clamp(point.x, SCENE_WIDTH * .36, SCENE_WIDTH * .64);
      currentY = clamp(point.y, SCENE_HEIGHT * .55, SCENE_HEIGHT * .79);
    }
  }

  function move(event: PointerEvent) {
    if (pointerId !== event.pointerId || !scene || !interaction) return;
    const point = scenePoint(event);
    if (Math.hypot(point.x - startX, point.y - currentY) >= 1) pointerMoved = true;
    currentX = point.x;
    currentY = point.y;
    if (interaction === 'scoring') {
      currentX = clamp(point.x, SCENE_WIDTH * .36, SCENE_WIDTH * .64);
      currentY = clamp(point.y, SCENE_HEIGHT * .55, SCENE_HEIGHT * .79);
    }
  }

  function finish(event: PointerEvent) {
    if (pointerId !== event.pointerId || !scene || !interaction) return;
    const kind = interaction;
    const value = gestureDistancePercent(startX, scenePoint(event).x, SCENE_WIDTH);
    if (gestureSurface?.hasPointerCapture(event.pointerId)) gestureSurface.releasePointerCapture(event.pointerId);
    pointerId = null;
    pointerType = 'none';
    const validScore = kind !== 'scoring' || pointerMoved && value >= 10;
    pointerMoved = false;
    if (!validScore) return;
    settling = kind === 'folding';
    clearTimeout(settleTimer);
    if (settling) settleTimer = setTimeout(() => (settling = false), reducedMotion ? 0 : 260);
    oncommit(kind === 'folding' ? 'fold' : 'score', value);
  }

  function resetGesture(event?: PointerEvent) {
    if (event && pointerId !== event.pointerId) return;
    if (pointerId !== null && gestureSurface?.hasPointerCapture(pointerId)) gestureSurface.releasePointerCapture(pointerId);
    pointerId = null;
    pointerType = 'none';
    pointerMoved = false;
    settling = false;
  }

  function keyboardCommit(event: KeyboardEvent) {
    if (event.repeat || !['Enter', ' '].includes(event.key) || disabled || !interaction) return;
    event.preventDefault();
    oncommit(interaction === 'folding' ? 'fold' : 'score', 70);
  }

  function freezeOvenVisual() {
    frozenOven = {
      appearance: phase === 'result' ? resultOverbaked ? 'overbaked' : 'ideal' : visual.oven.appearance,
      riseProgress: phase === 'result' ? 1 : visual.oven.riseProgress
    };
  }

  $effect(() => {
    if (phase !== trackedPhase || disabled) {
      trackedPhase = phase;
      resetGesture();
      if (reducedMotion) freezeOvenVisual();
    }
  });

  onMount(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      const shouldReduce = media.matches;
      if (shouldReduce && !reducedMotion) freezeOvenVisual();
      reducedMotion = shouldReduce;
    };
    update();
    media.addEventListener('change', update);
    return () => {
      clearTimeout(settleTimer);
      resetGesture();
      media.removeEventListener('change', update);
    };
  });
</script>

<AreaScene
  area="bakery"
  label={sceneLabel}
  class={`bakery-scene ${preparationPhase ? 'preparation' : 'oven'} ${phase}`}
  bind:element={scene}
  bind:transform={sceneTransform}
  data-motion-proof="bakery"
  data-bakery-phase={phase}
  data-transient={active ? 'active' : settling ? 'settling' : 'idle'}
  data-pointer-type={pointerType}
  data-reduced-motion={reducedMotion}
  data-loaf-appearance={renderedAppearance}
>
  <SceneLayer src="/assets/scenes/bakery-environment.webp" name="Bakery environment" essential />

  {#if preparationPhase}
    <img class="layer surface" src="/assets/scenes/bakery/bakery-preparation-surface.webp" alt="" draggable="false" />
    {#if phase === 'folding' || phase === 'scoring'}
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
      {#if visual.scores.complete > 0}
        <img class="layer dough groove groove-one" src="/assets/scenes/bakery/bakery-score-groove-01.webp" alt="" draggable="false" />
      {/if}
      {#if visual.scores.complete > 1}
        <img class="layer dough groove groove-two" src="/assets/scenes/bakery/bakery-score-groove-01.webp" alt="" draggable="false" />
      {/if}
      {#if visual.scores.complete > 2}
        <img class="layer dough groove groove-three" src="/assets/scenes/bakery/bakery-score-groove-01.webp" alt="" draggable="false" />
      {/if}
      {#if phase === 'scoring' && active}
        <img class="layer scoring-tool" src="/assets/scenes/bakery/bakery-scoring-tool.webp" alt="" draggable="false"
          style={`left:${toolLeft / SCENE_WIDTH * 100}%;top:${toolTop / SCENE_HEIGHT * 100}%`} />
      {/if}
    {/if}
  {:else}
    <img class="layer oven-embers" class:heated={phase === 'baking'} src="/assets/scenes/bakery/bakery-oven-embers.webp" alt="" draggable="false" />
    <img class="layer oven-steam" class:heated={phase === 'baking' || phase === 'result'} src="/assets/scenes/bakery/bakery-oven-steam.webp" alt="" draggable="false" />
    {#if showPeel}
      <img class="layer oven-peel" class:inserting class:extracted={phase === 'result'} src="/assets/scenes/bakery/bakery-oven-peel.webp" alt="" draggable="false" />
    {/if}
    <div class="loaf-stack" class:inserting class:extracted={phase === 'result'}
      style={`--rise:${renderedRise};--pale:${renderedPaleOpacity};--ideal:${renderedIdealOpacity};--overbaked:${renderedOverbakedOpacity}`}
      aria-hidden="true">
      <img class="loaf pale" src="/assets/scenes/bakery/bakery-loaf-pale.webp" alt="" draggable="false" />
      <img class="loaf ideal" src="/assets/scenes/bakery/bakery-loaf-ideal.webp" alt="" draggable="false" />
      <img class="loaf overbaked" src="/assets/scenes/bakery/bakery-loaf-overbaked.webp" alt="" draggable="false" />
    </div>
    <img class="layer oven-foreground" src="/assets/scenes/bakery/bakery-oven-foreground.webp" alt="" draggable="false" />
  {/if}

  <div class="scene-shade" aria-hidden="true"></div>
  {#if visual.pending || visual.error || phase === 'empty' || phase === 'blocked' || phase === 'result'}
    <div class="phase-banner" class:error={Boolean(visual.error)} aria-hidden="true">
      <span>{visual.error ? 'Ledger interrupted' : visual.pending ? 'Updating the ledger' : phase === 'empty' ? 'Pantry empty' : phase === 'blocked' ? 'Kitchen occupied' : 'Loaf confirmed'}</span>
    </div>
  {/if}
  {#if interaction}
    <button bind:this={gestureSurface} class="gesture-surface" type="button" {disabled}
      aria-label={interaction === 'folding'
        ? `Fold dough, ${visual.folds.complete} of 6 complete. Drag horizontally or press Enter or Space for a keyboard fold.`
        : `Score loaf, ${visual.scores.complete} of 3 complete. Drag across the loaf or press Enter or Space for a keyboard score.`}
      onpointerdown={begin} onpointermove={move} onpointerup={finish} onpointercancel={resetGesture} onkeydown={keyboardCommit}></button>
    <div class="gesture-hint" aria-hidden="true"><span>{interaction === 'folding' ? '↔' : '╱'}</span>
      {interaction === 'folding' ? 'Drag to fold' : 'Swipe to score'}</div>
  {/if}
</AreaScene>

<style>
  :global(.bakery-scene) { position:relative; width:100%; aspect-ratio:1672/941; overflow:hidden; border:1px solid #725426; background:#0a0704; box-shadow:inset 0 0 0 1px #120b04,0 18px 35px #0008; isolation:isolate; user-select:none; }
  .layer { position:absolute; display:block; max-width:none; pointer-events:none; }
  .surface { left:0; top:58.448%; z-index:1; width:100%; height:41.552%; }
  .dough { left:35.646%; top:56.854%; width:28.708%; height:26.567%; }
  .shadow { top:64.293%; z-index:2; opacity:.82; }
  .rest,.active-fold,.confirmed { z-index:3; opacity:0; transition:opacity 130ms ease,transform 260ms cubic-bezier(.2,.72,.2,1); }
  .rest.visible,.active-fold.visible,.confirmed.visible { opacity:1; }
  .active-fold { transform:translateX(var(--fold-x)) scaleX(var(--fold-scale)) rotate(var(--fold-rotation)); transform-origin:50% 82%; }
  .confirmed { transform:scale(.985); }
  .groove { z-index:4; transform-origin:50% 50%; }
  .groove-one { transform:translate(-3%,-3%) rotate(-8deg); }
  .groove-two { transform:translate(1%,2%) rotate(4deg); }
  .groove-three { transform:translate(5%,7%) rotate(15deg); }
  .scoring-tool { z-index:5; width:18.541%; height:7.439%; transform-origin:2.58% 50%; filter:drop-shadow(4px 7px 5px #0009); will-change:left,top; }
  .oven-embers { left:31.1%; top:30.818%; z-index:6; width:39.474%; height:29.224%; opacity:.42; mix-blend-mode:screen; transform-origin:50% 100%; }
  .oven-embers.heated { opacity:.72; animation:ember-breathe 1.1s ease-in-out infinite alternate; }
  .oven-steam { left:38.158%; top:12.009%; z-index:7; width:29.007%; height:34.325%; opacity:0; mix-blend-mode:screen; filter:sepia(.12) brightness(.92); }
  .oven-steam.heated { opacity:.26; animation:steam-rise 3.6s ease-in-out infinite alternate; }
  .oven-peel { left:30.024%; top:31.881%; z-index:9; width:55.024%; height:63.762%; transform:translate(8%,20%) scale(.9); transform-origin:42% 48%; filter:drop-shadow(8px 14px 10px #0009); }
  .oven-peel.inserting { animation:peel-in 1.15s cubic-bezier(.2,.72,.2,1) both; }
  .oven-peel.extracted { z-index:10; animation:peel-out .72s cubic-bezier(.2,.72,.2,1) both; }
  .loaf-stack { position:absolute; left:34.51%; top:27.949%; z-index:9; width:31.1%; height:44.102%; transform:translateY(calc((1 - var(--rise)) * 6%)) scale(calc(.86 + var(--rise) * .14)); transform-origin:50% 82%; filter:drop-shadow(0 14px 10px #000a); }
  .loaf-stack.inserting { animation:loaf-in 1.15s cubic-bezier(.2,.72,.2,1) both; }
  .loaf-stack.extracted { z-index:11; animation:loaf-out .72s cubic-bezier(.2,.72,.2,1) both; }
  .loaf { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; transition:opacity 1.1s linear; }
  .loaf.pale { opacity:var(--pale); }.loaf.ideal { opacity:var(--ideal); }.loaf.overbaked { opacity:var(--overbaked); }
  .oven-foreground { left:23.086%; top:45.696%; z-index:8; width:53.828%; height:31.881%; }
  .scene-shade { position:absolute; inset:0; z-index:12; box-shadow:inset 0 0 44px 18px #08040166; pointer-events:none; }
  .phase-banner { position:absolute; left:50%; bottom:4%; z-index:14; padding:.45rem .8rem; border:1px solid #a47a38aa; color:#f0d295; background:#100b06df; font:600 .78rem 'Cinzel',serif; letter-spacing:.08em; text-transform:uppercase; transform:translateX(-50%); }
  .phase-banner.error { border-color:#a85f49; color:#ffd2c4; }
  .gesture-surface { position:absolute; inset:0; z-index:13; width:100%; height:100%; padding:0; border:0; color:transparent; background:transparent; cursor:grab; touch-action:none; }
  .gesture-surface:active { cursor:grabbing; }.gesture-surface:focus-visible { outline:3px solid #e3b85b; outline-offset:-5px; }.gesture-surface:disabled { cursor:wait; }
  .gesture-hint { position:absolute; right:2.5%; bottom:3%; z-index:14; display:flex; align-items:center; gap:.45rem; padding:.4rem .65rem; border:1px solid #a47a38aa; color:#f0d295; background:#100b06d9; font:600 clamp(.55rem,1.2vw,.8rem) 'Cinzel',serif; letter-spacing:.06em; text-transform:uppercase; pointer-events:none; }
  .gesture-hint span { font-size:1.25em; }
  @keyframes ember-breathe { from { transform:scaleY(.96); filter:brightness(.9); } to { transform:scaleY(1.04); filter:brightness(1.13); } }
  @keyframes steam-rise { from { transform:translate3d(-3px,5px,0) scaleY(.98); } to { transform:translate3d(4px,-8px,0) scaleY(1.025); } }
  @keyframes peel-in { from { transform:translate(26%,30%) scale(.98); } to { transform:translate(-3%,-6%) scale(.78); } }
  @keyframes loaf-in { from { transform:translate(23%,22%) scale(.92); } to { transform:translate(0,0) scale(calc(.86 + var(--rise) * .14)); } }
  @keyframes peel-out { from { transform:translate(-3%,-6%) scale(.78); } to { transform:translate(8%,20%) scale(.9); } }
  @keyframes loaf-out { from { transform:translate(0,0) scale(1); } to { transform:translate(18%,24%) scale(1.06); } }
  :global(.bakery-scene[data-scene-visible='false']) .oven-embers,:global(.bakery-scene[data-scene-visible='false']) .oven-steam { animation-play-state:paused; }
  @media (prefers-reduced-motion:reduce) {
    .rest,.active-fold,.confirmed,.loaf { transition:none; }.active-fold { transform:none; }.scoring-tool { will-change:auto; }
    .oven-embers.heated,.oven-steam.heated,.oven-peel.inserting,.oven-peel.extracted,.loaf-stack.inserting,.loaf-stack.extracted { animation:none; }
    .gesture-hint span { display:none; }
  }
</style>
