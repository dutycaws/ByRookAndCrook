<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount, untrack } from 'svelte';
  import ContextualActionStrip from '$lib/components/scene/ContextualActionStrip.svelte';
  import CraftingSceneLayout from '$lib/components/scene/CraftingSceneLayout.svelte';
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
    sessionId?: string;
    value?: number;
  }

  let { data, form }: PageProps = $props();
  let snapshot = $derived(data.snapshot!);
  let selectedIngredientId = $state('');
  let pending = $state(false);
  let transportError = $state<string | null>(null);
  let unresolved = $state<FrozenBakeryCommand | null>(null);
  let gestureValue = $state(70);
  let foldForm = $state<HTMLFormElement>();
  let scoreForm = $state<HTMLFormElement>();
  let elapsedMs = $state(0);
  let hydrated = $state(false);

  onMount(() => {
    hydrated = true;
  });

  let session = $derived(data.snapshot?.bakery.activeSession ?? null);
  let rules = $derived(data.snapshot?.bakery.rules);
  let latestFood = $derived(data.snapshot?.bakery.foods[0] ?? null);
  let latestCard = $derived(
    data.snapshot?.bakery.intentCards.find((card) => card.sourceFoodId === latestFood?.id) ?? null
  );
  let ovenBand = $derived(classifyOven(elapsedMs));
  let ovenMarker = $derived(Math.min(100, elapsedMs / 500));
  let visualError = $derived(transportError ?? (form?.message && !form?.success ? form.message : null));
  let visual = $derived(deriveBakeVisualState(data.snapshot ?? null, { elapsedMs, ovenBand, pending, error: visualError }));

  $effect(() => {
    const ingredients = data.snapshot?.ingredients ?? [];
    if (!ingredients.some((ingredient) => ingredient.id === selectedIngredientId)) {
      selectedIngredientId = ingredients[0]?.id ?? '';
    }
  });

  $effect(() => {
    const active = session;
    if (!active || active.status !== 'baking' || !active.ovenStartedAt) {
      elapsedMs = 0;
      return;
    }
    return untrack(() => {
      const sample = () => {
        elapsedMs = Math.max(0, Date.now() - Date.parse(active.ovenStartedAt!));
      };
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

  function randomActionId() {
    return crypto.randomUUID();
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

  function retrying(kind: BakeryCommandKind) {
    return unresolved?.kind === kind;
  }

  function commandEnhancer(kind: BakeryCommandKind): SubmitFunction {
    return ({ formData, cancel }) => {
      if (!data.snapshot) return;
      const active = session;
      if (unresolved && unresolved.kind !== kind) { cancel(); return; }
      if (!unresolved && kind !== 'start' && kind !== 'advance' && !active) { cancel(); return; }

      const command = unresolved ?? {
        kind,
        actionId: randomActionId(),
        saveId: data.snapshot.save.id,
        expectedRevision: data.snapshot.save.revision,
        ingredientBatchId: kind === 'start' ? selectedIngredientId : undefined,
        sessionId: kind !== 'start' && kind !== 'advance' ? active!.id : undefined,
        value: kind === 'fold' || kind === 'score' ? gestureValue : undefined
      };
      unresolved = command;
      formData.set('saveId', command.saveId);
      formData.set('actionId', command.actionId);
      formData.set('expectedRevision', String(command.expectedRevision));
      if (command.ingredientBatchId) formData.set('ingredientBatchId', command.ingredientBatchId);
      if (command.sessionId) formData.set('sessionId', command.sessionId);
      if (kind === 'fold') formData.set('distance', String(command.value));
      if (kind === 'score') formData.set('length', String(command.value));
      pending = true;
      transportError = null;

      return async ({ result, update }) => {
        pending = false;
        if (result.type === 'error' || result.type === 'failure' && result.status >= 500) {
          transportError = 'The response was lost. Retry the same bakery action to check its result.';
          return;
        }
        unresolved = null;
        await update({ reset: false, invalidateAll: true });
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

<main class="page-shell bakery-page crafting-page">
  <div class="page-title-row">
    <div>
      <p class="eyebrow">Tavern day {data.snapshot?.save.currentDay ?? '—'} · Daily craft</p>
      <h1>The bakery</h1>
      <p>Fold the dough, score the loaf three times, then watch the oven’s narrow sweet spot.</p>
    </div>
    {#if data.snapshot}<div class="revision-badge">{data.snapshot.ingredients.length} pantry batch{data.snapshot.ingredients.length === 1 ? '' : 'es'}</div>{/if}
  </div>

  {#if !data.snapshot}
    <section class="empty-state panel">
      <span aria-hidden="true">🥖</span><h2>No tavern kitchen yet</h2>
      <p>Start the tavern and harvest an ingredient before baking.</p>
      <a class="primary-button inline-button" href="/garden">Start in the garden</a>
    </section>
  {:else}
    <CraftingSceneLayout area="bakery" statusTitle="Bakery ledger" inspectorTitle="Bakery inventory">
      {#snippet status()}
        <dl class="craft-status-list">
          <div><dt>Day</dt><dd>{snapshot.save.currentDay}</dd></div>
          <div><dt>Phase</dt><dd>{visual.phase}</dd></div>
          <div><dt>Folds</dt><dd>{visual.folds.complete}/{visual.folds.required}</dd></div>
          <div><dt>Scores</dt><dd>{visual.scores.complete}/{visual.scores.required}</dd></div>
        </dl>
      {/snippet}
      {#snippet scene()}
      <section class="bakery-workbench panel" aria-labelledby="bakery-stage">
        <BakeryScene {visual} disabled={pending || !!unresolved} oncommit={commitSceneGesture} />
        {#if snapshot.save.dayMinigameCompleted && snapshot.save.dailyCraftKind === 'bake'}
          <div class="bake-result" aria-live="polite">
            <span class="bread-result" aria-hidden="true">🥖</span>
            <p class="eyebrow">Day {snapshot.save.currentDay} bake complete</p>
            <h2 id="bakery-stage">{latestFood?.name ?? 'Loaf finished'}</h2>
            {#if latestFood}<p class="quality-display">{qualityLabel(latestFood.qualityIndex)}</p>{/if}
            {#if latestCard}
              <div class="card-reward">
                <span aria-hidden="true">🃏</span>
                <div><p class="eyebrow">Intent card earned · {latestCard.tier}</p>
                  <strong>{latestCard.displayName}</strong><small>{latestCard.description}</small></div>
              </div>
            {/if}
            <div class="result-actions">
              <a class="primary-button inline-button" href="/bar">Offer food at the bar</a>
              <form method="POST" action="?/advance" use:enhance={enhanceAdvance}>
                <button class="text-button" type="submit" disabled={!hydrated || pending}>
                  {retrying('advance') ? 'Retry resting' : 'Rest and begin next day'}
                </button>
              </form>
            </div>
          </div>
        {:else if snapshot.save.dailyCraftKind === 'brew'}
          <div class="empty-state">
            <span aria-hidden="true">🍺</span><h2 id="bakery-stage">Today’s craft is in the brewery</h2>
            <p>Only one brew or bake may use the tavern kitchen each day.</p>
            <a class="primary-button inline-button" href="/brewery">Return to the brewery</a>
          </div>
        {:else if session?.status === 'folding'}
          <div class="stage-heading"><div><p class="eyebrow">Stage 1 of 3 · Preparation</p>
            <h2 id="bakery-stage">Fold the dough</h2></div><strong>{session.foldCount}/6</strong></div>
          <p>Drag across the dough for each fold. Longer, deliberate folds earn a steadier crumb.</p>
          <form bind:this={foldForm} method="POST" action="?/fold" use:enhance={enhanceFold}>
            <input type="hidden" name="distance" value={gestureValue} />
            <button class="secondary-button full-button" type="submit" disabled={!hydrated || pending}
              onclick={() => { if (!unresolved) gestureValue = 70; }}>
              {retrying('fold') ? 'Retry fold' : 'Fold dough with keyboard'}
            </button>
          </form>
          <div class="step-pips" aria-hidden="true">{#each Array(6) as _, index}<i class:done={index < session.foldCount}></i>{/each}</div>
        {:else if session?.status === 'scoring'}
          <div class="stage-heading"><div><p class="eyebrow">Stage 2 of 3 · Shaping</p>
            <h2 id="bakery-stage">Score the loaf</h2></div><strong>{session.scoreCount}/3</strong></div>
          <p>Swipe across the loaf exactly three times so steam can escape in the oven.</p>
          <form bind:this={scoreForm} method="POST" action="?/score" use:enhance={enhanceScore}>
            <input type="hidden" name="length" value={gestureValue} />
            <button class="secondary-button full-button" type="submit" disabled={!hydrated || pending}
              onclick={() => { if (!unresolved) gestureValue = 70; }}>
              {retrying('score') ? 'Retry score' : 'Score loaf with keyboard'}
            </button>
          </form>
        {:else if session?.status === 'ready'}
          <div class="oven-ready">
            <span aria-hidden="true">🥖</span><p class="eyebrow">Stage 3 of 3 · Oven</p>
            <h2 id="bakery-stage">The loaf is ready to bake</h2>
            <p>The oven uses its own clock. Reloading cannot pause or restart the thirty-second bake.</p>
            <form method="POST" action="?/oven" use:enhance={enhanceOven}>
              <button class="primary-button full-button" type="submit" disabled={!hydrated || pending}>
                {retrying('oven') ? 'Retry putting loaf in oven' : 'Put loaf in oven'}
              </button>
            </form>
          </div>
        {:else if session?.status === 'baking'}
          <div class="stage-heading"><div><p class="eyebrow">Stage 3 of 3 · Oven</p>
            <h2 id="bakery-stage">Watch the crust</h2></div><strong>{(elapsedMs / 1000).toFixed(1)}s</strong></div>
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
            <button class="primary-button full-button" type="submit" disabled={!hydrated || pending}>
              {retrying('complete') ? 'Retry taking out bread' : 'Take out bread'}
            </button>
          </form>
        {:else if snapshot.ingredients.length === 0}
          <div class="empty-state"><span aria-hidden="true">🧺</span><h2 id="bakery-stage">The pantry is empty</h2>
            <p>Harvest a mature crop before beginning today’s loaf.</p>
            <a class="primary-button inline-button" href="/garden">Visit the garden</a></div>
        {:else}
          <div class="bake-setup">
            <p class="eyebrow">Choose one unit</p><h2 id="bakery-stage">Mix an herb loaf</h2>
            <p>Ingredient quality and its baking affinity set the loaf’s potential.</p>
            <form method="POST" action="?/start" use:enhance={enhanceStart}>
              <fieldset class="ingredient-picker" disabled={pending || !!unresolved}>
                <legend>Available ingredients</legend>
                {#each snapshot.ingredients as ingredient (ingredient.id)}
                  <label class:selected={selectedIngredientId === ingredient.id}>
                    <input type="radio" name="ingredient" value={ingredient.id} bind:group={selectedIngredientId} />
                    <span class="ingredient-icon" aria-hidden="true">{ingredient.icon}</span>
                    <span><strong>{ingredient.plantName}</strong>
                      <small>{qualityLabel(ingredient.qualityIndex)} · {ingredient.quantity} unit{ingredient.quantity === 1 ? '' : 's'} · Bake +{ingredient.bakeBonus}</small></span>
                  </label>
                {/each}
              </fieldset>
              <button class="primary-button full-button" type="submit" disabled={!hydrated || !selectedIngredientId || pending}>
                {retrying('start') ? 'Retry starting loaf' : 'Begin today’s loaf'}
              </button>
            </form>
          </div>
        {/if}

        {#if transportError}<div class="form-message error bake-message" role="alert">{transportError}</div>
        {:else if form?.message}<div class="form-message bake-message" class:error={!form?.success} role={form?.success ? 'status' : 'alert'}>
          {form.message}{#if 'conflict' in form && form.conflict}<span>The latest tavern state has been loaded.</span>{/if}</div>{/if}
      </section>
      {/snippet}
      {#snippet inspector()}
      <div class="bakery-ledger">
        <section class="detail-card"><p class="eyebrow">Bakery inventory</p><h2>Finished bread</h2>
          {#if snapshot.bakery.foods.length === 0}<p class="muted">No finished loaves yet.</p>
          {:else}<ul class="bake-history">{#each snapshot.bakery.foods as food (food.id)}
            <li><span aria-hidden="true">🥖</span><div><strong>{food.name}</strong>
              <small>{qualityLabel(food.qualityIndex)} · Day {food.dayNumber}</small></div></li>{/each}</ul>{/if}
        </section>
        {#if !session && snapshot.save.dailyCraftKind === null}
          <form method="POST" action="?/advance" use:enhance={enhanceAdvance} class="rest-without-craft">
            <p>Crafting is optional. The tavern may close without brewing or baking.</p>
            <button class="text-button full-button" type="submit" disabled={!hydrated || pending}>
              {retrying('advance') ? 'Retry resting' : 'Rest without crafting'}
            </button>
          </form>
        {/if}
        <a class="secondary-link" href="/ingredients">Choose from the pantry <span aria-hidden="true">→</span></a>
      </div>
      {/snippet}
      {#snippet action()}
        <ContextualActionStrip
          eyebrow="Bakery action"
          title={visual.phase === 'folding' ? 'Fold the dough six times' : visual.phase === 'scoring' ? 'Score the loaf three times' : visual.phase === 'ready' ? 'Put the scored loaf in the oven' : visual.phase === 'baking' ? 'Watch the oven clock' : visual.phase === 'result' ? 'The loaf is ready' : 'Prepare today’s loaf'}
          description={visual.phase === 'folding' || visual.phase === 'scoring' ? 'Drag directly across the illustrated dough or use the keyboard action in the scene panel.' : visual.phase === 'ready' ? 'The prepared loaf and peel are waiting at the stone oven.' : visual.phase === 'baking' ? 'The oven uses its server-backed start time and survives reloads.' : visual.phase === 'blocked' ? 'Today’s kitchen work is already underway in the Brewery.' : 'Choose one pantry ingredient; the familiar full-width Bakery workbench remains the preparation surface.'}
          status={pending ? 'Updating…' : visual.error ?? (visual.phase === 'baking' ? `${(visual.oven.elapsedMs / 1000).toFixed(1)} seconds` : `${snapshot.bakery.foods.length} loaves ready`)}
        >
          <a class="secondary-link compact-link" href="/ingredients">Pantry overview <span aria-hidden="true">→</span></a>
        </ContextualActionStrip>
      {/snippet}
    </CraftingSceneLayout>
  {/if}
</main>

<style>
  .bakery-workbench { min-height:600px; padding:30px; }
  .bakery-ledger { display:flex; flex-direction:column; gap:18px; }
  .stage-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; }
  .stage-heading h2,.bake-result h2,.oven-ready h2,.bake-setup h2 { margin:5px 0 8px; color:var(--gold-bright); font-family:'Cinzel',serif; }
  .stage-heading>strong { color:var(--gold-bright); font-family:'Cinzel',serif; font-size:24px; }
  .bakery-workbench p { color:var(--muted); }
  .step-pips { display:flex; justify-content:center; gap:9px; margin-top:18px; }
  .step-pips i { width:38px; height:5px; background:#3e2d17; }
  .step-pips i.done { background:var(--gold); }
  .oven-ready,.bake-result { display:grid; min-height:500px; place-items:center; align-content:center; text-align:center; }
  .oven-ready>span,.bread-result { font-size:76px; filter:drop-shadow(0 12px 20px #000); }
  .timing-labels { display:flex; justify-content:space-between; color:var(--muted); font-size:12px; }
  .timing-track { position:relative; display:flex; height:18px; margin:7px 0 14px; overflow:hidden; border:1px solid #80602f; background:#6f271d; }
  .timing-track i.yellow-one { width:16%; margin-left:40%; background:#b8892e; }
  .timing-track i.green { width:12%; background:#638b43; }
  .timing-track i.yellow-two { width:16%; background:#b8892e; }
  .timing-track b { position:absolute; top:-5px; width:6px; height:28px; background:#fff3c7; box-shadow:0 0 8px #fff; }
  .oven-readout { display:flex; justify-content:space-between; margin-bottom:16px; padding:11px 14px; border:1px solid var(--border); }
  .oven-readout.red strong { color:#d9775e; }.oven-readout.yellow strong { color:#dbb95c; }.oven-readout.green strong { color:#8fbd6e; }
  .card-reward { display:flex; max-width:480px; align-items:center; gap:14px; margin:20px auto; padding:14px 18px; border:1px solid #614823; background:#1e160c; text-align:left; }
  .card-reward>span { font-size:32px; }.card-reward small,.card-reward strong { display:block; }
  .result-actions { display:flex; align-items:center; justify-content:center; gap:12px; flex-wrap:wrap; }
  .bake-history { display:grid; gap:10px; margin:16px 0 0; padding:0; list-style:none; }
  .bake-history li { display:flex; gap:11px; padding:11px; border:1px solid var(--border); background:#100c07; }
  .bake-history strong,.bake-history small { display:block; }.bake-history small { color:var(--muted); }
  .rest-without-craft { padding:16px; border:1px solid var(--border); background:#151008; }
  .rest-without-craft p { margin-top:0; color:var(--muted); }
  .bake-message { margin-top:18px; }
  @media (max-width:800px) { .bakery-workbench { min-height:520px; padding:20px; } }
</style>
