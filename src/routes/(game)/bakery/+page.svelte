<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount, tick, untrack } from 'svelte';
  import CardWorkflowFrame from '$lib/components/ui/CardWorkflowFrame.svelte';
  import WorkflowHand from '$lib/components/ui/WorkflowHand.svelte';
  import WorkflowInspection from '$lib/components/ui/WorkflowInspection.svelte';
  import type { WorkflowChoice } from '$lib/components/ui/workflow';
  import { resolveBurnAction, waitForBurn, type ResolvedBurnAction } from '$lib/card-effects';
  import BakeryScene from '$lib/components/scenes/BakeryScene.svelte';
  import { qualityLabel } from '$lib/game/contracts';
  import { deriveBakeVisualState } from '$lib/presentation/scene';
  import type { PageProps, SubmitFunction } from './$types';

  type BakeryCommandKind = 'start' | 'fold' | 'score' | 'oven' | 'complete' | 'advance';
  interface FrozenBakeryCommand {
    kind: BakeryCommandKind;
    actionId: string;
    saveId: string;
    expectedRevision: number;
    ingredientBatchId?: string;
    recipeKey?: string;
    sessionId?: string;
    value?: number;
  }
  interface BakeryGeneratedRecipe { entityId: string; recipeKey: string; name: string; }

  let { data, form }: PageProps = $props();
  let snapshot = $derived(data.snapshot);
  let selectedIngredientId = $state<string | null>(null);
  let focusReturnId = $state<string | null>(null);
  let archiveOpen = $state(false);
  let archiveHeading = $state<HTMLHeadingElement>();
  let selectedRecipeKey = $state('herb-loaf');
  let pending = $state(false);
  let transportError = $state<string | null>(null);
  let unresolved = $state<FrozenBakeryCommand | null>(null);
  let gestureValue = $state(70);
  let startForm = $state<HTMLFormElement>();
  let foldForm = $state<HTMLFormElement>();
  let scoreForm = $state<HTMLFormElement>();
  let elapsedMs = $state(0);
  let hydrated = $state(false);
  let startBurning = $state(false);
  let startBurnAction = $state<ResolvedBurnAction | undefined>();

  onMount(() => { hydrated = true; });

  let session = $derived(snapshot?.bakery.activeSession ?? null);
  let rules = $derived(snapshot?.bakery.rules);
  let ingredients = $derived(snapshot?.ingredients ?? []);
  let availableIngredients = $derived(ingredients.filter((ingredient) => ingredient.quantity > 0));
  let generatedRecipes = $derived(data.generatedRecipes as BakeryGeneratedRecipe[]);
  let recipeName = $derived(
    selectedRecipeKey === 'herb-loaf'
      ? 'Herb loaf'
      : generatedRecipes.find((recipe) => `generated-${recipe.recipeKey}` === selectedRecipeKey)?.name ?? 'Generated loaf'
  );
  let choices = $derived<WorkflowChoice[]>(availableIngredients.map((ingredient) => ({
    id: ingredient.id,
    title: ingredient.plantName,
    eyebrow: 'Bakery ingredient',
    description: `${qualityLabel(ingredient.qualityIndex)} quality · Bake affinity +${ingredient.bakeBonus}`,
    icon: ingredient.icon,
    meta: `${ingredient.quantity} unit${ingredient.quantity === 1 ? '' : 's'} available · ${recipeName}`,
    actionLabel: 'Inspect ingredient'
  })));
  let selectedIngredient = $derived(availableIngredients.find((ingredient) => ingredient.id === selectedIngredientId) ?? null);
  let selectedChoice = $derived(choices.find((choice) => choice.id === selectedIngredientId) ?? null);
  let latestFood = $derived(snapshot?.bakery.foods[0] ?? null);
  let latestCard = $derived(
    snapshot?.bakery.intentCards.find((card) => card.sourceFoodId === latestFood?.id) ?? null
  );
  let bakedToday = $derived(latestFood?.dayNumber === snapshot?.save.currentDay);
  let ovenBand = $derived(classifyOven(elapsedMs));
  let ovenMarker = $derived(Math.min(100, elapsedMs / 500));
  let visualError = $derived(transportError ?? (form?.message && !form?.success ? form.message : null));
  let visual = $derived(deriveBakeVisualState(snapshot ?? null, { elapsedMs, ovenBand, pending, error: visualError }));
  let blockedByBrewery = $derived(Boolean(!session && snapshot?.save.dailyCraftKind === 'brew'));
  let canChooseIngredient = $derived(Boolean(snapshot && !session && !blockedByBrewery && availableIngredients.length > 0));

  $effect(() => {
    const currentIngredients = snapshot?.ingredients ?? [];
    if (selectedIngredientId && !currentIngredients.some((ingredient) => ingredient.id === selectedIngredientId && ingredient.quantity > 0)) {
      selectedIngredientId = null;
      focusReturnId = null;
    }
  });

  $effect(() => {
    const active = session;
    if (!active || active.status !== 'baking' || !active.ovenStartedAt) {
      elapsedMs = 0;
      return;
    }
    return untrack(() => {
      const sample = () => { elapsedMs = Math.max(0, Date.now() - Date.parse(active.ovenStartedAt!)); };
      sample();
      const timer = window.setInterval(sample, 100);
      return () => window.clearInterval(timer);
    });
  });

  function classifyOven(value: number): 'red' | 'yellow' | 'green' {
    if (!rules) return 'red';
    if (value >= rules.greenStartMs && value <= rules.greenEndMs) return 'green';
    if (value >= rules.yellowStartMs && value <= rules.yellowEndMs) return 'yellow';
    return 'red';
  }

  function randomActionId() { return crypto.randomUUID(); }

  function inspectIngredient(id: string) {
    if (pending || unresolved) return;
    focusReturnId = null;
    selectedIngredientId = id;
    transportError = null;
  }

  function cancelInspection() {
    if (pending || unresolved) return;
    focusReturnId = selectedIngredientId;
    selectedIngredientId = null;
  }

  function openArchive() {
    if (pending || unresolved) return;
    selectedIngredientId = null;
    focusReturnId = null;
    archiveOpen = true;
    void tick().then(() => archiveHeading?.focus({ preventScroll: true }));
  }

  function returnToCraft() {
    if (archiveOpen) {
      archiveOpen = false;
      void tick().then(() => document.querySelector<HTMLButtonElement>('[data-archive-toggle="bakery"]')?.focus({ preventScroll: true }));
      return;
    }
    cancelInspection();
  }

  function confirmStart() {
    if (!selectedIngredientId || pending) return;
    startForm?.requestSubmit();
  }

  function commitSceneGesture(kind: 'fold' | 'score', value: number) {
    if (pending || unresolved) return;
    gestureValue = value;
    if (kind === 'fold') foldForm?.requestSubmit();
    else scoreForm?.requestSubmit();
  }

  function submitKeyboardGesture(kind: 'fold' | 'score') {
    if (pending || unresolved) return;
    gestureValue = 70;
    if (kind === 'fold') foldForm?.requestSubmit();
    else scoreForm?.requestSubmit();
  }

  function retrying(kind: BakeryCommandKind) { return unresolved?.kind === kind; }

  function commandEnhancer(kind: BakeryCommandKind): SubmitFunction {
    return ({ formData, cancel }) => {
      if (!snapshot || pending) { cancel(); return; }
      const active = session;
      if (unresolved && unresolved.kind !== kind) { cancel(); return; }
      if (!unresolved && kind !== 'start' && kind !== 'advance' && !active) { cancel(); return; }

      const command = unresolved ?? {
        kind,
        actionId: randomActionId(),
        saveId: snapshot.save.id,
        expectedRevision: snapshot.save.revision,
        ingredientBatchId: kind === 'start' ? selectedIngredientId ?? undefined : undefined,
        recipeKey: kind === 'start' ? selectedRecipeKey : undefined,
        sessionId: kind !== 'start' && kind !== 'advance' ? active?.id : undefined,
        value: kind === 'fold' || kind === 'score' ? gestureValue : undefined
      };
      if (kind === 'start' && (!command.ingredientBatchId || !canChooseIngredient)) { cancel(); return; }
      unresolved = command;
      formData.set('saveId', command.saveId);
      formData.set('actionId', command.actionId);
      formData.set('expectedRevision', String(command.expectedRevision));
      if (command.ingredientBatchId) formData.set('ingredientBatchId', command.ingredientBatchId);
      if (command.recipeKey) formData.set('recipeKey', command.recipeKey);
      if (command.sessionId) formData.set('sessionId', command.sessionId);
      if (kind === 'fold') formData.set('distance', String(command.value));
      if (kind === 'score') formData.set('length', String(command.value));
      pending = true;
      transportError = null;

      return async ({ result, update }) => {
        if (result.type === 'error' || result.type === 'failure' && result.status >= 500) {
          pending = false;
          transportError = 'The response was lost. Retry the same bakery action to check its result.';
          return;
        }
        if (kind === 'start' && result.type === 'success') {
          const burn = resolveBurnAction(data.cardBurnStyle);
          startBurnAction = burn;
          startBurning = true;
          await tick();
          await waitForBurn(burn.durationMs);
          startBurning = false;
          startBurnAction = undefined;
          selectedIngredientId = null;
          focusReturnId = null;
        }
        unresolved = null;
        try {
          await update({ reset: false, invalidateAll: true });
        } finally {
          pending = false;
        }
      };
    };
  }

  const enhanceStart = commandEnhancer('start');
  const enhanceFold = commandEnhancer('fold');
  const enhanceScore = commandEnhancer('score');
  const enhanceOven = commandEnhancer('oven');
  const enhanceComplete = commandEnhancer('complete');
  const enhanceAdvance = commandEnhancer('advance');
</script>

<svelte:head>
  <title>Bakery · By Rook and Crook</title>
  <meta name="description" content="Fold, score, and bake a persistent tavern loaf." />
</svelte:head>

<main class="page-shell bakery-page crafting-page bakery-live-page">
  {#if !snapshot}
    <section class="empty-state panel">
      <span aria-hidden="true">🥖</span><h1>No tavern kitchen yet</h1>
      <p>Start the tavern and harvest an ingredient before baking.</p>
      <a class="primary-button inline-button" href="/garden">Start in the garden</a>
    </section>
  {:else}
    <CardWorkflowFrame
      sceneAspect={1672 / 941}
      title="The Bakery"
      eyebrow={`Tavern day ${snapshot.save.currentDay} · Daily craft`}
      location="Tavern · Kitchen"
      inspectionMode={selectedChoice ? 'center' : 'folio'}
      onback={(archiveOpen || selectedChoice) && !pending && !unresolved ? returnToCraft : undefined}
      backLabel={archiveOpen ? 'Back to craft' : 'Choose another'}
    >
      {#snippet scene()}
        <BakeryScene {visual} disabled={pending || !!unresolved} oncommit={commitSceneGesture} />
      {/snippet}
      {#snippet status()}
        <dl class="workflow-status" aria-label="Bakery status">
          <div><dt>Phase</dt><dd>{session ? visual.phase : blockedByBrewery ? 'Brewery active' : canChooseIngredient ? 'Ready' : 'Empty pantry'}</dd></div>
          <div><dt>Pantry</dt><dd>{availableIngredients.length} batch{availableIngredients.length === 1 ? '' : 'es'}</dd></div>
          <div><dt>Finished</dt><dd>{snapshot.bakery.foods.length}</dd></div>
        </dl>
      {/snippet}
      {#snippet controls()}
        <div class="frame-links">
          <button type="button" data-archive-toggle="bakery" disabled={pending || !!unresolved} onclick={openArchive}>Bread archive</button>
        </div>
      {/snippet}
      {#snippet folio()}
        {#if archiveOpen}
          <section class="bakery-archive">
            <p class="eyebrow">Bakery inventory</p>
            <h2 bind:this={archiveHeading} tabindex="-1">Finished bread</h2>
            {#if snapshot.bakery.foods.length === 0}
              <p class="muted">No finished loaves yet.</p>
            {:else}
              <ul class="bake-history">
                {#each snapshot.bakery.foods as food (food.id)}
                  {@const intentCard = snapshot.bakery.intentCards.find((card) => card.sourceFoodId === food.id)}
                  <li><span aria-hidden="true">🥖</span><div><strong>{food.name}</strong>
                    <small>{qualityLabel(food.qualityIndex)} · Day {food.dayNumber}</small>
                    {#if intentCard}<p class="earned-card"><span>Intent card · {intentCard.tier}</span><strong>{intentCard.displayName}</strong><small>{intentCard.description}</small></p>{/if}
                  </div></li>
                {/each}
              </ul>
            {/if}
            <a class="secondary-link" href="/bar">Offer bread at the bar <span aria-hidden="true">→</span></a>
          </section>
        {:else if selectedChoice && selectedIngredient}
          <WorkflowInspection
            item={selectedChoice}
            onconfirm={confirmStart}
            oncancel={unresolved ? undefined : cancelInspection}
            confirmLabel="Use 1 unit"
            consequence={`This starts today's ${recipeName.toLowerCase()} and consumes one ${selectedIngredient.plantName} unit.`}
            pending={pending}
            burning={startBurning}
            burnAction={startBurnAction}
            error={visualError}
          >
            {#snippet options()}
              <label class="recipe-picker">
                <span>Recipe</span>
                <select bind:value={selectedRecipeKey} disabled={pending || !!unresolved} aria-label="Choose a bakery recipe">
                  <option value="herb-loaf">Herb loaf</option>
                  {#each generatedRecipes as recipe (recipe.entityId)}
                    <option value={`generated-${recipe.recipeKey}`}>{recipe.name}</option>
                  {/each}
                </select>
              </label>
            {/snippet}
          </WorkflowInspection>
        {:else if blockedByBrewery}
          <section class="workflow-note">
            <p class="eyebrow">Today's craft</p>
            <h2>A brew is active in the brewery</h2>
            <p>Finish the current brew before starting another craft.</p>
            <a class="secondary-link" href="/brewery">Return to the brewery <span aria-hidden="true">→</span></a>
          </section>
        {:else if session?.status === 'folding'}
          <section class="bakery-workbench">
            <div class="stage-heading"><div><p class="eyebrow">Stage 1 of 3 · Preparation</p>
              <h2>Fold the dough</h2></div><strong>{session.foldCount}/6</strong></div>
            <p>Drag across the dough for each fold. Longer, deliberate folds earn a steadier crumb.</p>
            <form bind:this={foldForm} method="POST" action="?/fold" use:enhance={enhanceFold}>
              <input type="hidden" name="distance" value={gestureValue} />
              <button class="secondary-button full-button" type="submit" disabled={!hydrated || pending || !!unresolved && !retrying('fold')}
                onclick={() => { if (!unresolved) gestureValue = 70; }}>
                {retrying('fold') ? 'Retry fold' : 'Fold dough with keyboard'}
              </button>
            </form>
            <div class="step-pips" aria-hidden="true">{#each Array(6) as _, index}<i class:done={index < session.foldCount}></i>{/each}</div>
          </section>
        {:else if session?.status === 'scoring'}
          <section class="bakery-workbench">
            <div class="stage-heading"><div><p class="eyebrow">Stage 2 of 3 · Shaping</p>
              <h2>Score the loaf</h2></div><strong>{session.scoreCount}/3</strong></div>
            <p>Swipe across the loaf exactly three times so steam can escape in the oven.</p>
            <form bind:this={scoreForm} method="POST" action="?/score" use:enhance={enhanceScore}>
              <input type="hidden" name="length" value={gestureValue} />
              <button class="secondary-button full-button" type="submit" disabled={!hydrated || pending || !!unresolved && !retrying('score')}
                onclick={() => { if (!unresolved) gestureValue = 70; }}>
                {retrying('score') ? 'Retry score' : 'Score loaf with keyboard'}
              </button>
            </form>
            <div class="step-pips" aria-hidden="true">{#each Array(3) as _, index}<i class:done={index < session.scoreCount}></i>{/each}</div>
          </section>
        {:else if session?.status === 'ready'}
          <section class="bakery-workbench oven-ready">
            <span aria-hidden="true">🥖</span><p class="eyebrow">Stage 3 of 3 · Oven</p>
            <h2>The loaf is ready to bake</h2>
            <p>The oven uses its own clock. Reloading cannot pause or restart the thirty-second bake.</p>
            <form method="POST" action="?/oven" use:enhance={enhanceOven}>
              <button class="primary-button full-button" type="submit" disabled={!hydrated || pending || !!unresolved && !retrying('oven')}>
                {retrying('oven') ? 'Retry putting loaf in oven' : 'Put loaf in oven'}
              </button>
            </form>
          </section>
        {:else if session?.status === 'baking'}
          <section class="bakery-workbench">
            <div class="stage-heading"><div><p class="eyebrow">Stage 3 of 3 · Oven</p>
              <h2>Watch the crust</h2></div><strong>{(elapsedMs / 1000).toFixed(1)}s</strong></div>
            <p>Remove it near 30 seconds. Early or late loaves still finish, but lose quality.</p>
            <div class="oven-timing" aria-label={`Oven timing: ${ovenBand}`}>
              <div class="timing-labels"><span>Too soon</span><span>Ideal · 30s</span><span>Too late</span></div>
              <div class="timing-track"><i class="yellow-one"></i><i class="green"></i><i class="yellow-two"></i>
                <b style={`left: calc(${ovenMarker}% - 3px)`}></b></div>
            </div>
            <div class="oven-readout {ovenBand}" role="status">
              <strong>{ovenBand === 'green' ? 'Ideal window' : ovenBand === 'yellow' ? 'Close' : elapsedMs < 20000 ? 'Too soon' : 'Overbaking'}</strong>
              <span>The loaf can always be removed.</span>
            </div>
            <form method="POST" action="?/complete" use:enhance={enhanceComplete}>
              <button class="primary-button full-button" type="submit" disabled={!hydrated || pending || !!unresolved && !retrying('complete')}>
                {retrying('complete') ? 'Retry taking out bread' : 'Take out bread'}
              </button>
            </form>
          </section>
        {:else if availableIngredients.length === 0}
          <section class="workflow-note">
            <p class="eyebrow">Bakery inventory</p>
            <h2>The pantry is empty</h2>
            <p>Harvest a mature crop before beginning today's loaf.</p>
            {#if bakedToday && latestFood}<p class="recent-craft">Latest: <strong>{latestFood.name}</strong> · {qualityLabel(latestFood.qualityIndex)}</p>{/if}
            <a class="primary-button inline-button" href="/garden">Visit the garden</a>
          </section>
        {:else}
          <section class="bakery-context">
            <p class="eyebrow">Kitchen</p>
            {#if latestFood}
              <h2>{latestFood.name}</h2>
              <p class="muted">Latest loaf · {qualityLabel(latestFood.qualityIndex)}</p>
            {:else}
              <h2>Ready for a new loaf</h2>
              <p class="muted">Choose an ingredient card to inspect its quality and bake affinity.</p>
            {/if}
            {#if latestCard}<p class="recent-card"><span>Intent card earned · {latestCard.tier}</span><strong>{latestCard.displayName}</strong><small>{latestCard.description}</small></p>{/if}
            {#if snapshot.save.dailyCraftKind === null}
              <form method="POST" action="?/advance" use:enhance={enhanceAdvance} class="rest-without-craft">
                <p>{snapshot.save.dayMinigameCompleted ? 'Craft another batch or close the tavern for today.' : 'Crafting is optional. The tavern may close without brewing or baking.'}</p>
                <button class="text-button full-button" type="submit" disabled={!hydrated || pending || !!unresolved && !retrying('advance')}>
                  {retrying('advance') ? 'Retry resting' : snapshot.save.dayMinigameCompleted ? 'Close tavern for today' : 'Rest without crafting'}
                </button>
              </form>
            {/if}
          </section>
        {/if}
        {#if !selectedChoice}
          {#if transportError}<p class="form-message error" role="alert">{transportError}</p>
          {:else if form?.message}<p class="form-message" class:error={!form?.success} role={form?.success ? 'status' : 'alert'}>{form.message}{#if 'conflict' in form && form.conflict}<span>The latest tavern state has been loaded.</span>{/if}</p>{/if}
        {/if}
      {/snippet}
      {#snippet hand()}
        {#if canChooseIngredient && !selectedChoice && !archiveOpen}
          <div class="ingredient-hand">
            <WorkflowHand
              items={choices}
              label="Bakery ingredients"
              selectedId={null}
              focusId={focusReturnId}
              burnStyle={data.cardBurnStyle}
              pending={pending || !!unresolved}
              onchoose={inspectIngredient}
            />
          </div>
        {/if}
      {/snippet}
    </CardWorkflowFrame>
    <form bind:this={startForm} method="POST" action="?/start" use:enhance={enhanceStart} hidden>
      <input type="hidden" name="saveId" value={snapshot.save.id} />
      <input type="hidden" name="ingredientBatchId" value={selectedIngredientId ?? ''} />
      <input type="hidden" name="recipeKey" value={selectedRecipeKey} />
      <input type="hidden" name="actionId" value="" />
      <input type="hidden" name="expectedRevision" value={snapshot.save.revision} />
    </form>
  {/if}
</main>

<style>
  .bakery-live-page { max-width: 1600px; }
  .workflow-status { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .35rem .7rem; margin: 0; }
  .workflow-status div { display: flex; gap: .3rem; align-items: baseline; color: #e3cfaa; font-size: .74rem; }
  .workflow-status dt { color: #bea879; }
  .workflow-status dd { margin: 0; font-weight: 650; }
  .frame-links { display: flex; gap: .4rem; }
  .frame-links button { display: inline-flex; min-height: 40px; align-items: center; padding: .35rem .55rem; border: 1px solid #9a793c; border-radius: .4rem; background: #20170ad9; color: #f0d394; font: inherit; font-size: .72rem; text-decoration: none; cursor: pointer; }
  .frame-links button:disabled { cursor: wait; opacity: .65; }
  .ingredient-hand { padding: 0 .8rem .4rem; }
  .workflow-note, .bakery-context, .bakery-archive, .bakery-workbench { display: grid; gap: .7rem; padding: .35rem 0; color: #f0dfb8; }
  .workflow-note h2, .bakery-context h2, .bakery-archive h2, .bakery-workbench h2 { margin: 0; color: #f0dfb8; font-size: 1.15rem; }
  .workflow-note p, .bakery-context p, .bakery-archive p, .bakery-workbench p { margin: 0; line-height: 1.45; }
  .workflow-note > p:not(.eyebrow), .bakery-context > p:not(.eyebrow), .bakery-archive > p:not(.eyebrow) { color: #cbb894; font-size: .82rem; }
  .workflow-note .eyebrow, .bakery-context .eyebrow, .bakery-archive .eyebrow, .bakery-workbench .eyebrow { margin: 0; color: #d9b772; font-size: .62rem; letter-spacing: .1em; text-transform: uppercase; }
  .recent-card { display: grid; gap: .2rem; margin: 0; padding: .55rem; border-left: 2px solid #c9a65b; background: #20170a; }
  .recent-card span { color: #d9b772; font-size: .62rem; text-transform: uppercase; }
  .recent-card strong { color: #f0dfb8; font-size: .78rem; }
  .recent-card small { color: #cbb894; font-size: .67rem; }
  .recipe-picker { display: grid; gap: .35rem; padding: .6rem; border: 1px solid #493719; border-radius: .4rem; color: #d9b772; background: #140e08; font-size: .72rem; }
  .recipe-picker select { width: 100%; min-height: 44px; padding: .5rem; border: 1px solid #80602f; border-radius: .35rem; background: #100c07; color: #f0dfb8; font: inherit; }
  .recipe-picker select:focus-visible { outline: 2px solid #ffe49c; outline-offset: 2px; }
  .bake-history { display: grid; gap: .5rem; margin: 0; padding: 0; list-style: none; }
  .bake-history > li { display: flex; gap: .65rem; padding: .6rem; border: 1px solid #493719; background: #100c07; }
  .bake-history > li > span { font-size: 1.4rem; }
  .bake-history strong, .bake-history small { display: block; }
  .bake-history small { color: #cbb894; font-size: .72rem; }
  .earned-card { display: grid; gap: .2rem; margin: .45rem 0 0 !important; padding: .45rem; border-left: 2px solid #c9a65b; background: #20170a; }
  .earned-card span { color: #d9b772; font-size: .62rem; text-transform: uppercase; }
  .earned-card strong { color: #f0dfb8; font-size: .78rem; }
  .earned-card small { color: #cbb894; font-size: .67rem; }
  .recent-craft { color: #e3cfaa; font-size: .8rem; }
  .stage-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  .stage-heading h2 { margin: 0; }
  .stage-heading > strong { color: #e0c787; font-family: 'Cinzel', serif; font-size: 1.25rem; white-space: nowrap; }
  .step-pips { display: flex; justify-content: center; gap: 9px; }
  .step-pips i { width: 38px; height: 5px; background: #3e2d17; }
  .step-pips i.done { background: #c9a65b; }
  .oven-ready { min-height: 24rem; align-content: center; justify-items: center; text-align: center; }
  .oven-ready > span { font-size: 3.5rem; filter: drop-shadow(0 12px 20px #000); }
  .timing-labels { display: flex; justify-content: space-between; color: #cbb894; font-size: .68rem; }
  .timing-track { position: relative; display: flex; height: 18px; margin: 7px 0 14px; overflow: hidden; border: 1px solid #80602f; background: #6f271d; }
  .timing-track i.yellow-one { width: 16%; margin-left: 40%; background: #b8892e; }
  .timing-track i.green { width: 12%; background: #638b43; }
  .timing-track i.yellow-two { width: 16%; background: #b8892e; }
  .timing-track b { position: absolute; top: -5px; width: 6px; height: 28px; background: #fff3c7; box-shadow: 0 0 8px #fff; }
  .oven-readout { display: flex; justify-content: space-between; gap: .5rem; margin-bottom: .2rem; padding: .65rem; border: 1px solid #493719; font-size: .75rem; }
  .oven-readout.red strong { color: #d9775e; }.oven-readout.yellow strong { color: #dbb95c; }.oven-readout.green strong { color: #8fbd6e; }
  .rest-without-craft { display: grid; gap: .5rem; padding-top: .6rem; border-top: 1px solid #493719; }
  .rest-without-craft p { color: #cbb894; font-size: .75rem; }
  .form-message { margin: 0; color: #d7c7a5; font-size: .78rem; }
  .form-message span { display: block; }
  .form-message.error { color: #f2aa8c; }
  @media (max-width: 700px) {
    .ingredient-hand { padding: 0 .25rem .3rem; }
    .workflow-note, .bakery-context, .bakery-archive, .bakery-workbench { padding: .25rem 0; }
    .workflow-status { font-size: .7rem; }
    .frame-links button { min-height: 36px; padding-inline: .4rem; font-size: .67rem; }
  }
</style>
