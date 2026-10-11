<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { GameSnapshot, IngredientBatch, QualityIndex } from '$lib/game/contracts';
  import type { BurnStyle } from '$lib/card-effects';
  import { resolveBurnAction } from '$lib/card-effects';
  import {
    SCENE_DESIGN_SIZE,
    deriveBakeVisualState,
    type BakeVisualState,
    type BrewVisualState
  } from '$lib/presentation/scene';
  import type { GuidedStirTelemetry } from '$lib/game/scene-motion';
  import { qualityLabel } from '$lib/game/contracts';
  import BreweryScene from '$lib/components/scenes/BreweryScene.svelte';
  import BakeryScene from '$lib/components/scenes/BakeryScene.svelte';
  import CardHand from '$lib/components/ui/CardHand.svelte';
  import CardHandCard from '$lib/components/ui/CardHandCard.svelte';
  import CardBurnSurface from '$lib/components/ui/CardBurnSurface.svelte';

  type CraftingArea = 'brewery' | 'bakery';
  type IngredientChoice = {
    id: string;
    plantName: string;
    icon: string;
    qualityIndex: QualityIndex;
    quantity: number;
    brewBonus: number;
    bakeBonus: number;
    sample: boolean;
  };

  let {
    area,
    snapshot,
    variant,
    burnStyle = 'drip'
  }: {
    area: CraftingArea;
    snapshot: GameSnapshot | null;
    variant: 'A' | 'B' | 'C';
    burnStyle?: BurnStyle;
  } = $props();

  let selectedIngredientId = $state<string | null>(null);
  let mode = $state<'selection' | 'mini-game'>('selection');
  let burning = $state(false);
  let reducedMotion = $state(false);
  let selectedBurnStyle = $state<BurnStyle>(untrack(() => burnStyle));
  let brewTelemetry = $state<GuidedStirTelemetry | null>(null);
  let brewVisual = $state<BrewVisualState>({
    area: 'brewery', designSize: SCENE_DESIGN_SIZE, phase: 'setup', session: null, pending: false, error: null
  });
  let brewQuality = $state<QualityIndex>(5);
  let bakePhase = $state<BakeVisualState['phase']>('setup');
  let foldCount = $state(0);
  let scoreCount = $state(0);
  let bakeStartedAt = $state<string | null>(null);
  let elapsedMs = $state(0);
  let bakeQuality = $state<QualityIndex>(5);
  let playElement = $state<HTMLDivElement>();
  let surface = $state<HTMLElement>();

  let burn = $state(untrack(() => resolveBurnAction(burnStyle)));
  const pantry = $derived.by((): IngredientChoice[] => {
    const available = (snapshot?.ingredients ?? []).flatMap((batch: IngredientBatch) => {
      const quantity = batch.quantity;
      return quantity > 0 ? [{
        id: batch.id,
        plantName: batch.plantName,
        icon: batch.icon,
        qualityIndex: batch.qualityIndex,
        quantity,
        brewBonus: batch.brewBonus,
        bakeBonus: batch.bakeBonus,
        sample: false
      } satisfies IngredientChoice] : [];
    });
    return available.length ? available : [{
      id: 'prototype-sample-pepper',
      plantName: 'Pepper',
      icon: '🌶️',
      qualityIndex: 5,
      quantity: 1,
      brewBonus: 0,
      bakeBonus: 0,
      sample: true
    } satisfies IngredientChoice];
  });
  const ingredient = $derived(pantry.find((item) => item.id === selectedIngredientId) ?? pantry[0] ?? null);
  const ovenBand = $derived(classifyOven(elapsedMs));
  const bakeVisual = $derived.by(() => {
    const base = deriveBakeVisualState(snapshot, {
      elapsedMs,
      ovenBand,
      pending: false,
      error: null
    });
    return {
      ...base,
      phase: bakePhase,
      folds: { complete: foldCount, required: 6 },
      scores: { complete: scoreCount, required: 3 },
      oven: { ...base.oven, startedAt: bakeStartedAt, elapsedMs, band: ovenBand },
      result: { qualityIndex: bakeQuality }
    } satisfies BakeVisualState;
  });

  $effect(() => {
    const first = pantry[0];
    if (!selectedIngredientId || !pantry.some((item) => item.id === selectedIngredientId)) {
      selectedIngredientId = first?.id ?? null;
    }
  });

  $effect(() => {
    if (area !== 'bakery' || bakePhase !== 'baking' || !bakeStartedAt) {
      elapsedMs = 0;
      return;
    }
    const startedAt = Date.parse(bakeStartedAt);
    const sampleClock = () => (elapsedMs = Math.max(0, Date.now() - startedAt));
    sampleClock();
    const timer = window.setInterval(sampleClock, 100);
    return () => window.clearInterval(timer);
  });

  onMount(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => (reducedMotion = motion.matches);
    syncMotion();
    motion.addEventListener('change', syncMotion);
    return () => motion.removeEventListener('change', syncMotion);
  });

  function classifyOven(value: number): BakeVisualState['oven']['band'] {
    const rules = snapshot?.bakery.rules;
    if (rules && value >= rules.greenStartMs && value <= rules.greenEndMs) return 'green';
    if (rules && value >= rules.yellowStartMs && value <= rules.yellowEndMs) return 'yellow';
    if (!rules) {
      if (value >= 26_000 && value <= 32_000) return 'green';
      if (value >= 20_000 && value <= 40_000) return 'yellow';
    }
    return 'red';
  }

  function beginBurn() {
    if (!ingredient || burning || mode !== 'selection') return;
    selectedIngredientId = ingredient.id;
    burn = resolveBurnAction(selectedBurnStyle);
    burning = true;
  }

  function focusControl(selector: string) {
    void tick().then(() => requestAnimationFrame(() => {
      surface?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    }));
  }

  function enterMiniGame() {
    if (!ingredient || !burning) return;
    burning = false;
    mode = 'mini-game';
    if (area === 'brewery') {
      const startedAt = new Date().toISOString();
      brewTelemetry = null;
      brewQuality = ingredient.qualityIndex;
      brewVisual = {
        area: 'brewery',
        designSize: SCENE_DESIGN_SIZE,
        phase: 'active',
        session: {
          id: `prototype-brew-${Date.now()}`,
          startedAt,
          durationSeconds: 15,
          countdownSeconds: 2,
          stirRulesVersion: 'guide-v2'
        },
        pending: false,
        error: null
      };
    } else {
      bakePhase = 'folding';
      foldCount = 0;
      scoreCount = 0;
      bakeStartedAt = null;
      elapsedMs = 0;
      bakeQuality = ingredient.qualityIndex;
    }
    void tick().then(() => requestAnimationFrame(() => {
      const selector = area === 'brewery' ? '.beat-control' : '.gesture-surface';
      playElement?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    }));
  }

  function onBrewTelemetry(telemetry: GuidedStirTelemetry) {
    const priorPhase = brewTelemetry?.phase;
    brewTelemetry = telemetry;
    if (telemetry.phase === 'scored' && priorPhase !== 'scored') focusControl('.beat-control');
    if (telemetry.phase !== 'complete' || brewVisual.phase !== 'active') return;
    const target = Math.max(1, telemetry.targetTicks);
    const score = Math.min(1, (telemetry.perfectTicks + telemetry.goodTicks * 0.6) / target);
    brewQuality = Math.max(0, Math.min(6, Math.round(score * 6))) as QualityIndex;
    brewVisual = { ...brewVisual, phase: 'result', session: null };
    focusControl('.reset-action');
  }

  function onBakeCommit(kind: 'fold' | 'score', _value: number) {
    if (kind === 'fold' && bakePhase === 'folding') {
      foldCount = Math.min(6, foldCount + 1);
      if (foldCount >= 6) bakePhase = 'scoring';
    } else if (kind === 'score' && bakePhase === 'scoring') {
      scoreCount = Math.min(3, scoreCount + 1);
      if (scoreCount >= 3) {
        bakePhase = 'ready';
        focusControl('.action-panel .primary-action');
      }
    }
  }

  function beginBaking() {
    if (bakePhase !== 'ready') return;
    bakeStartedAt = new Date().toISOString();
    elapsedMs = 0;
    bakePhase = 'baking';
    focusControl('.action-panel .primary-action');
  }

  function finishBaking() {
    if (bakePhase !== 'baking') return;
    bakeQuality = ovenBand === 'green' ? 5 : ovenBand === 'yellow' ? 3 : elapsedMs < 20_000 ? 1 : 0;
    bakePhase = 'result';
    focusControl('.reset-action');
  }

  function resetCraft() {
    mode = 'selection';
    burning = false;
    brewTelemetry = null;
    brewVisual = {
      area: 'brewery',
      designSize: SCENE_DESIGN_SIZE,
      phase: 'setup',
      session: null,
      pending: false,
      error: null
    };
    bakePhase = 'setup';
    foldCount = 0;
    scoreCount = 0;
    bakeStartedAt = null;
    elapsedMs = 0;
    focusControl('[data-card-hand] button[aria-pressed="true"], [data-card-hand] button');
  }
</script>

<section bind:this={surface} class="crafting-workflow" class:folio={variant === 'B'} class:spotlight={variant === 'C'}
  data-workflow-area={area} data-workflow-variant={variant} aria-label={`${area} ingredient and minigame prototype`}>
  {#if mode === 'selection'}
    <div class="selection-scene" aria-hidden="true">
      {#if area === 'brewery'}
        <BreweryScene visual={brewVisual} saveId="prototype-local" persistState={false} ontelemetry={() => {}} />
      {:else}
        <BakeryScene visual={bakeVisual} oncommit={() => {}} />
      {/if}
    </div>
    <div class="selection-shade" aria-hidden="true"></div>
    <div class="craft-setup">
      <header class="setup-heading">
        <p class="eyebrow">{area === 'brewery' ? 'Brewery' : 'Bakery'}</p>
        <h1>{area === 'brewery' ? 'Choose an ingredient to brew' : 'Choose an ingredient to bake'}</h1>
        <p>Select an ingredient card to continue.</p>
      </header>
      <div class="ingredient-panel">
        <div class="panel-copy">
          <p class="eyebrow">Ingredient hand</p>
          <h2>Choose one card</h2>
          {#if ingredient}
            {#if ingredient.sample}<p class="sample-note">A sample Pepper ingredient is ready to use.</p>{/if}
          {/if}
        </div>
        <div class="hand-dock" aria-busy={burning ? 'true' : 'false'}>
          <CardHand items={pantry} getKey={(item) => item.id} label={`${area} ingredient cards`} selectedId={selectedIngredientId}>
            {#snippet card(item, index)}
              <CardBurnSurface active={burning}
                treatment={burn.treatment} durationMs={reducedMotion ? 0 : burn.durationMs}
                oncomplete={item.id === selectedIngredientId ? enterMiniGame : undefined}>
                <CardHandCard label={`${item.plantName}, ${qualityLabel(item.qualityIndex)}, ${item.quantity} available`}
                  selected={item.id === selectedIngredientId} disabled={burning} onclick={() => (selectedIngredientId = item.id)}>
                  <div class="ingredient-art" aria-hidden="true"><span>{item.icon || '✧'}</span></div>
                  <div class="ingredient-copy">
                    <p class="eyebrow">{item.sample ? 'Sample ingredient' : `Pantry card ${index + 1}`}</p>
                    <h3>{item.plantName}</h3>
                    <p>{qualityLabel(item.qualityIndex)} · {item.quantity} unit{item.quantity === 1 ? '' : 's'}</p>
                    <p>{area === 'brewery' ? `Brew +${item.brewBonus}` : `Bake +${item.bakeBonus}`}</p>
                  </div>
                  <span class="card-action">Select ingredient <span aria-hidden="true">↗</span></span>
                </CardHandCard>
              </CardBurnSurface>
            {/snippet}
          </CardHand>
        </div>
      </div>
      <footer class="setup-footer">
          <span class="local-note">Prototype craft · safe to try</span>
        <div class="setup-actions">
          <label class="burn-picker">Card burn
            <select aria-label="Prototype card burn effect" bind:value={selectedBurnStyle} disabled={burning}>
              <option value="crawl">Crawl</option><option value="drip">Drip</option><option value="ash">Ash</option><option value="random">Random</option>
            </select>
          </label>
          <button class="primary-action" type="button" onclick={beginBurn} disabled={!ingredient || burning}>
            {burning ? 'Burning ingredient card…' : `Begin ${area === 'brewery' ? 'brew' : 'loaf'}`}
          </button>
        </div>
      </footer>
    </div>
  {:else}
    <div class="craft-play" data-prototype-minigame={area} bind:this={playElement}>
      <div class="active-scene">
        {#if area === 'brewery'}
          <BreweryScene visual={brewVisual} saveId="prototype-local" persistState={false} ontelemetry={onBrewTelemetry} />
        {:else}
          <BakeryScene visual={bakeVisual} oncommit={onBakeCommit} />
        {/if}
      </div>
      <header class="scene-hud">
        <div>
          <p class="eyebrow">{area === 'brewery' ? 'Brewery · Step 2 of 2' : 'Bakery · Step 2 of 2'}</p>
          <h1>{area === 'brewery' ? 'Stir the wort' : bakePhase === 'folding' ? 'Fold the dough' : bakePhase === 'scoring' ? 'Score the loaf' : bakePhase === 'ready' ? 'The loaf is ready for the oven' : bakePhase === 'baking' ? 'Watch the oven timing' : 'Loaf complete'}</h1>
        </div>
        <button type="button" class="reset-action" onclick={resetCraft}>Reset mini game</button>
      </header>
      {#if area === 'brewery'}
        {#if brewVisual.phase === 'active'}
          <div class="progress-panel" role="status" aria-live="polite">
            <span>{brewTelemetry?.phase === 'countdown' ? 'Find your rhythm' : brewTelemetry ? `${Math.ceil(brewTelemetry.remainingMs / 1000)} seconds remaining` : 'Preparing the vat'}</span>
            <small>{brewTelemetry ? `${brewTelemetry.perfectTicks} perfect · ${brewTelemetry.goodTicks} good beats` : 'Follow the guide around the wort.'}</small>
          </div>
        {:else if brewVisual.phase === 'result'}
          <div class="result-panel" role="status" aria-live="polite">
            <strong>Batch bottled · {qualityLabel(brewQuality)}</strong>
            <span>Your guided stir is complete. Start over to try another ingredient.</span>
          </div>
        {/if}
      {:else if bakePhase === 'folding' || bakePhase === 'scoring'}
        <div class="progress-panel" role="status" aria-live="polite">
          <span>{bakePhase === 'folding' ? `Fold ${foldCount} of 6` : `Score ${scoreCount} of 3`}</span>
          <small>{bakePhase === 'folding' ? 'Drag across the illustrated dough or use Enter or Space.' : 'Swipe across the loaf or use Enter or Space.'}</small>
        </div>
      {:else if bakePhase === 'ready'}
        <div class="action-panel">
          <p>The folded and scored loaf is on the peel.</p>
          <button type="button" class="primary-action" onclick={beginBaking}>Put loaf in oven</button>
        </div>
      {:else if bakePhase === 'baking'}
        <div class="action-panel oven-panel">
          <p aria-live="polite">{(elapsedMs / 1000).toFixed(1)} seconds · {ovenBand} timing</p>
          <button type="button" class="primary-action" onclick={finishBaking}>Take out bread</button>
        </div>
      {:else if bakePhase === 'result'}
        <div class="result-panel" role="status" aria-live="polite">
          <strong>Loaf complete · {qualityLabel(bakeQuality)}</strong>
          <span>The loaf is ready to enjoy.</span>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .crafting-workflow { position: relative; min-height: 600px; height: calc(100dvh - 185px); max-height: 1000px; overflow: hidden; border: 1px solid #92723f77; border-radius: .85rem; background: #140e08; color: #f0dfb8; }
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: clamp(1.35rem, 2.4vw, 2.1rem); }
  h2 { font-size: 1.05rem; }
  h3 { font-size: 1rem; }
  .eyebrow { color: #d9b772; font-size: .65rem; letter-spacing: .12em; text-transform: uppercase; }
  .selection-scene { position: absolute; inset: 0; }
  .selection-scene :global(.area-scene) { width: 100%; height: 100%; min-height: 0; max-height: none; aspect-ratio: auto; margin: 0; }
  .selection-shade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg,#0b0804a8 0%,#0d0906aa 28%,#0b0804a1 68%,#0b0804dd 100%); }
  .craft-setup { position: absolute; inset: 0; min-height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; padding: clamp(1rem, 3vw, 2.4rem); gap: 1.3rem; }
  .setup-heading { display: grid; gap: .45rem; justify-items: center; text-align: center; }
  .setup-heading > p:last-child { color: #cbb894; font-size: .84rem; }
  .ingredient-panel { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); align-content: center; gap: .5rem; padding: 0 1rem; border: 1px solid #a17b3a4a; border-radius: .8rem; background: radial-gradient(ellipse at 50% 10%, #563d1b55, #100c08c9 72%); }
  .panel-copy { display: grid; justify-items: center; gap: .35rem; text-align: center; }
  .sample-note { color: #c5ae7f; font-size: .72rem; }
  .hand-dock { min-width: 0; align-self: center; }
  .ingredient-art { min-height: 4.7rem; display: grid; place-items: center; border-radius: .4rem; background: radial-gradient(ellipse at center,#86602e66,transparent 70%); border-bottom: 1px solid #9d793f55; }
  .ingredient-art span { font-size: 2.9rem; color: #e0bb73; text-shadow: 0 2px 8px #0007; }
  .ingredient-copy { display: grid; align-content: start; gap: .32rem; }
  .ingredient-copy p:not(.eyebrow) { color: #cbb894; font-size: .72rem; }
  .card-action { display: flex; justify-content: space-between; padding-top: .45rem; border-top: 1px solid #92754455; color: #e0c787; font-size: .65rem; }
  .setup-footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .setup-actions { display: flex; align-items: end; gap: .7rem; }
  .burn-picker { display: grid; gap: .2rem; color: #d8c6a4; font-size: .65rem; }
  select { min-height: 44px; padding: .45rem .65rem; border: 1px solid #967745; border-radius: .4rem; color: #f5deb0; background: #20190fd9; font: inherit; }
  .local-note { color: #b9a988; font-size: .7rem; }
  .primary-action, .reset-action { min-height: 44px; padding: .65rem 1rem; border: 1px solid #d2a94e; border-radius: .55rem; color: #271b0b; background: linear-gradient(180deg,#f2cf76,#c8953f); font: inherit; font-weight: 700; cursor: pointer; }
  .primary-action:disabled { cursor: not-allowed; opacity: .6; }
  .reset-action { color: #f0dfb8; background: #20170bd9; border-color: #aa8955; }
  button:focus-visible { outline: 2px solid #ffe49c; outline-offset: 3px; }
  .folio .ingredient-panel { grid-template-columns: minmax(15rem,.75fr) minmax(0,1.5fr); grid-template-rows: 1fr; align-items: center; gap: 1rem; }
  .folio .panel-copy { justify-items: start; text-align: left; padding: 1rem; }
  .folio .hand-dock { width: 100%; }
  .spotlight .ingredient-panel { background: radial-gradient(ellipse at 50% 48%, #73522455, #100c08ee 68%); border-color: #d1ad5d88; box-shadow: inset 0 0 4rem #c08c3020; }
  .spotlight .ingredient-art { background: radial-gradient(ellipse at center,#c0903a66,transparent 72%); }
  .craft-play { position: absolute; inset: 0; overflow: hidden; }
  .active-scene { position: absolute; inset: 0; }
  .craft-play :global(.area-scene) { width: 100%; height: 100%; min-height: 0; max-height: none; aspect-ratio: auto; margin: 0; }
  .craft-play :global(.scene-interaction), .craft-play :global(.archive-link) { display: none; }
  .scene-hud { position: absolute; z-index: 8; top: 1rem; left: 1.3rem; right: 1.3rem; display: flex; align-items: start; justify-content: space-between; gap: 1rem; pointer-events: none; text-shadow: 0 2px 4px #000; }
  .scene-hud > div { display: grid; gap: .3rem; }
  .scene-hud button { pointer-events: auto; }
  .progress-panel, .action-panel, .result-panel { position: absolute; z-index: 8; bottom: 1rem; left: 50%; translate: -50% 0; width: min(28rem, calc(100% - 2rem)); display: grid; gap: .3rem; padding: .75rem 1rem; border: 1px solid #a17b3a88; border-radius: .65rem; background: #160f0ee8; text-align: center; box-shadow: 0 .4rem 1.6rem #0007; }
  .progress-panel span { font-weight: 700; }
  .progress-panel small, .result-panel span { color: #cbb894; font-size: .75rem; }
  .action-panel { justify-items: center; }
  .action-panel p { font-size: .78rem; }
  .result-panel strong { color: #f1d488; }
  @media (max-width: 700px) {
    .crafting-workflow { height: auto; min-height: 760px; max-height: none; }
    .craft-setup { padding: .8rem; gap: .8rem; }
    .ingredient-panel, .folio .ingredient-panel { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); gap: .3rem; padding: .5rem; }
    .folio .panel-copy { justify-items: center; text-align: center; padding: .45rem; }
    .setup-heading > p:last-child { max-width: 32rem; }
    .setup-footer { align-items: stretch; flex-direction: column; }
    .setup-actions { align-items: stretch; flex-direction: column; }
    .local-note { text-align: center; }
    .crafting-workflow:has(.craft-play) { min-height: 0; }
    .craft-play { position: relative; min-height: 0; padding-top: 340px; }
    .active-scene { height: 340px; bottom: auto; }
    .craft-play :global(.area-scene) { width: 100%; height: 340px; }
    .craft-play :global(.beat-control) {
      left: 50%; translate: -50% 0; bottom: 2%;
      min-height: 120px; min-width: 400px; font-size: 2rem;
    }
    .scene-hud { top: .65rem; left: .75rem; right: .75rem; }
    .scene-hud h1 { font-size: 1.1rem; max-width: 18rem; }
    .scene-hud .eyebrow { font-size: .56rem; }
    .reset-action { min-height: 40px; padding: .5rem .65rem; font-size: .72rem; }
    .progress-panel, .action-panel, .result-panel {
      position: relative; inset: auto; translate: none; width: auto; margin: .6rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .crafting-workflow :global(*) { scroll-behavior: auto !important; }
  }
</style>
