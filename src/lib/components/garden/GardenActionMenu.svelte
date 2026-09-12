<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { GameSnapshot, GardenCell, GardenCommandKind, GardenCommandPayload, GardenCommandPreview } from '$lib/game/contracts';
  import GardenProvisionPanel from './GardenProvisionPanel.svelte';

  type Pane = 'root' | 'plant' | 'water' | 'amend' | 'move' | 'remove' | 'clover' | 'compost' | 'apiary' | 'preview';
  type BatchKind = 'water' | 'amend';
  let {
    snapshot, selected, batchMode = null, batchTargetIds = new Set<string>(), moveTargetId = null,
    onstartbatch = () => {}, oncancelbatch = () => {}, onstartmove = () => {}, oncancelmove = () => {},
    onclose = () => {}, harvest = undefined
  }: {
    snapshot: GameSnapshot; selected: GardenCell | null; batchMode?: BatchKind | null; batchTargetIds?: Set<string>;
    moveTargetId?: string | null; onstartbatch?: (kind: BatchKind) => void | Promise<void>; oncancelbatch?: () => void;
    onstartmove?: () => void | Promise<void>; oncancelmove?: () => void; onclose?: () => void | Promise<void>; harvest?: import('svelte').Snippet;
  } = $props();

  let pane = $state<Pane>('root');
  let menu = $state<HTMLElement>();
  let position = $state({ left: 0, top: 0, mobile: false, flipped: false });
  let seedItemKey = $state('');
  let waterDose = $state(10);
  let amendmentKey = $state('');
  let amendmentDose = $state(1);
  let compostRemoval = $state(true);
  let compostBatchId = $state('');
  let compostQuantity = $state(1);
  let preview = $state<GardenCommandPreview | null>(null);
  let previewPayload = $state<GardenCommandPayload | null>(null);
  let previewSignature = $state('');
  let pending = $state<string | null>(null);
  let pendingAction = $state<{ id: string; signature: string; revision: number } | null>(null);
  let message = $state<string | null>(null);
  let messageError = $state(false);
  let lastSelected = $state<string | null>(null);

  const seeds = $derived(snapshot.garden?.inventory.filter((item) => item.kind === 'seed' && item.quantity > 0) ?? []);
  const amendments = $derived(snapshot.garden?.inventory.filter((item) => item.kind === 'amendment' && item.quantity > 0) ?? []);
  const targets = $derived(batchMode ? [...batchTargetIds] : selected ? [selected.id] : []);
  const compostableBatches = $derived(snapshot.ingredients.filter((batch) => {
    const available = batch.quantity - (batch.consumedQuantity ?? 0) - (batch.compostedQuantity ?? 0);
    return available > 0 && batch.id !== snapshot.brewery.activeSession?.ingredientBatchId && batch.id !== snapshot.bakery.activeSession?.ingredientBatchId;
  }));
  const hasApiaryAction = $derived(Boolean(selected && (
    (selected.kind === 'empty' && (snapshot.garden?.inventory.some((item) => item.kind === 'equipment' && item.quantity > 0) ?? false))
    || (selected.kind === 'beehive' && (!selected.hive?.hasColony
      ? (snapshot.garden?.inventory.some((item) => item.kind === 'colony' && item.quantity > 0) ?? false)
      : true))
  )));
  const target = $derived(moveTargetId ? snapshot.cells.find((cell) => cell.id === moveTargetId) ?? null : null);
  const canPreview = $derived(!!preview && previewSignature === signature(preview.commandKind, previewPayload));

  $effect(() => {
    if (!selected || selected.id === lastSelected) return;
    lastSelected = selected.id;
    pane = 'root'; preview = null; previewPayload = null; previewSignature = ''; message = null;
    void positionMenu();
  });

  onMount(() => {
    const reposition = () => void positionMenu();
    let frame = 0;
    const followAnchor = () => { void positionMenu(); frame = requestAnimationFrame(followAnchor); };
    frame = requestAnimationFrame(followAnchor);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', outside, true);
    void focusPane();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); document.removeEventListener('pointerdown', outside, true); };
  });

  function signature(kind: GardenCommandKind, payload: GardenCommandPayload | null) { return `${kind}:${JSON.stringify(payload)}`; }
  function label(kind: GardenCommandKind) { return ({ plant: 'Plant', water: 'Water', amend: 'Fertilize', move: 'Move', remove: 'Remove', incorporate_clover: 'Incorporate clover', compost_ingredient: 'Compost', purchase: 'Purchase', expand: 'Expand' } satisfies Record<GardenCommandKind, string>)[kind]; }
  function anchor(): HTMLElement | null { return selected ? document.querySelector<HTMLElement>(`[data-garden-anchor="${CSS.escape(selected.id)}"]`) : null; }

  function positionMenu() {
    const node = anchor(); const viewport = document.querySelector<HTMLElement>('[data-garden-camera-viewport]');
    if (!node || !viewport || !selected) return;
    const a = node.getBoundingClientRect(); const v = viewport.getBoundingClientRect();
    if (a.right < v.left || a.left > v.right || a.bottom < v.top || a.top > v.bottom) { dismiss(); return; }
    const width = menu?.offsetWidth ?? 245; const height = menu?.offsetHeight ?? 220;
    const parentWidth = menu?.querySelector<HTMLElement>('[data-garden-menu-parent]')?.offsetWidth ?? 154;
    const cascadeWidth = pane === 'root' ? width : width + parentWidth + 10;
    const compactViewport = window.matchMedia('(max-width: 620px)').matches;
    const mobile = compactViewport || cascadeWidth + 16 > v.width;
    let left = a.right + 10; let top = a.top - 8; let flipped = false;
    if (!mobile && pane !== 'root') {
      const placeLeft = v.right - a.right < a.left - v.left;
      if (placeLeft) {
        left = Math.max(v.left + 8, Math.min(a.left - width - 10, v.right - width - parentWidth - 18));
        flipped = true;
      } else {
        left = Math.max(v.left + parentWidth + 18, Math.min(a.right + 10, v.right - width - 8));
      }
    } else {
      if (mobile || left + width > v.right - 8) left = Math.max(v.left + 8, a.left - width - 10);
      if (mobile || left < v.left + 8) { left = Math.max(v.left + 8, Math.min(a.left, v.right - width - 8)); top = Math.min(v.bottom - height - 8, a.bottom + 8); }
      flipped = !mobile && left < a.left;
    }
    top = Math.max(v.top + 8, Math.min(top, v.bottom - height - 8));
    position = { left, top, mobile, flipped };
  }
  function outside(event: PointerEvent) {
    const target = event.target as HTMLElement;
    // A board click is a deliberate selection/targeting action and its button
    // handler decides whether to switch plots or keep the move source.
    if (target.closest('[data-garden-cell], [data-garden-batch-toolbar]')) return;
    if (!menu?.contains(target) && !anchor()?.contains(target)) dismiss();
  }
  function focusPane() {
    requestAnimationFrame(() => menu?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')?.focus());
  }
  function dismiss() { if (batchMode) oncancelbatch(); if (moveTargetId) oncancelmove(); void onclose(); }
  function back() { if (pane === 'preview') { pane = selected?.kind === 'empty' ? 'plant' : 'root'; preview = null; } else { pane = 'root'; } void positionMenu(); focusPane(); }
  function keyboard(event: KeyboardEvent) { if (event.key !== 'Escape') return; event.preventDefault(); if (pane !== 'root') back(); else dismiss(); }
  function choose(next: Pane) { pane = next; message = null; void positionMenu(); focusPane(); }
  async function startBatch(kind: BatchKind) { pane = kind; message = null; await onstartbatch(kind); void positionMenu(); }
  async function startMove() { pane = 'move'; message = null; await onstartmove(); void positionMenu(); }

  function currentPayload(kind: GardenCommandKind): GardenCommandPayload | null {
    if (!selected) return null;
    if (kind === 'plant') return (seedItemKey || seeds[0]?.itemKey) ? { cellId: selected.id, seedItemKey: seedItemKey || seeds[0]!.itemKey } : null;
    if (kind === 'water') return targets.length ? { cellIds: targets, dose: waterDose } : null;
    if (kind === 'amend') return targets.length && (amendmentKey || amendments[0]?.itemKey) ? { cellIds: targets, itemKey: amendmentKey || amendments[0]!.itemKey, dose: amendmentDose } : null;
    if (kind === 'move') return target ? { sourceCellId: selected.id, targetCellId: target.id } : null;
    if (kind === 'remove') return { cellId: selected.id, compost: compostRemoval };
    if (kind === 'incorporate_clover') return { cellId: selected.id };
    if (kind === 'compost_ingredient') return (compostBatchId || compostableBatches[0]?.id) ? { cellId: selected.id, ingredientBatchId: compostBatchId || compostableBatches[0]!.id, quantity: compostQuantity } : null;
    return null;
  }
  function previewAction(kind: GardenCommandKind): SubmitFunction {
    return ({ formData, cancel }) => {
      const payload = currentPayload(kind); if (!payload) { cancel(); message = kind === 'move' ? 'Select a destination plot on the board.' : 'Choose the required item first.'; messageError = true; return; }
      formData.set('commandKind', kind); formData.set('payload', JSON.stringify(payload)); pending = `preview:${kind}`; message = null;
      return async ({ result }) => {
        pending = null; const body = 'data' in result ? result.data as { preview?: GardenCommandPreview; message?: string } | undefined : undefined;
        if (result.type === 'success' && body?.preview) { preview = body.preview; previewPayload = payload; previewSignature = signature(kind, payload); pane = 'preview'; messageError = false; await positionMenu(); focusPane(); }
        else { message = body?.message ?? 'The authoritative preview is unavailable.'; messageError = true; }
      };
    };
  }
  const commit: SubmitFunction = ({ formData, cancel }) => {
    if (!preview || !previewPayload || !canPreview) { cancel(); message = 'Preview this action again before confirming it.'; messageError = true; return; }
    const commandKind = preview.commandKind;
    const key = signature(commandKind, previewPayload);
    if (!pendingAction || pendingAction.signature !== key || pendingAction.revision !== snapshot.save.revision) pendingAction = { id: crypto.randomUUID(), signature: key, revision: snapshot.save.revision };
    formData.set('saveId', snapshot.save.id); formData.set('actionId', pendingAction.id); formData.set('expectedRevision', String(pendingAction.revision)); formData.set('commandKind', commandKind); formData.set('payload', JSON.stringify(previewPayload)); pending = `commit:${commandKind}`;
    return async ({ result, update }) => {
      pending = null; const body = 'data' in result ? result.data as { message?: string; pendingAction?: object; conflict?: boolean } | undefined : undefined;
      if (result.type === 'error' || body?.pendingAction) { message = body?.message ?? 'The outcome is unknown. Retry this exact action.'; messageError = true; return; }
      if (result.type === 'success') { message = body?.message ?? `${label(commandKind)} complete.`; messageError = false; preview = null; previewPayload = null; previewSignature = ''; pendingAction = null; if (batchMode) oncancelbatch(); if (moveTargetId) oncancelmove(); pane = 'root'; }
      else { message = body?.message ?? 'The action was rejected.'; messageError = true; pendingAction = null; }
      await update({ reset: false, invalidateAll: result.type === 'success' || !!body?.conflict });
    };
  };
</script>

<svelte:window onkeydown={keyboard} />

{#if selected}
  <div bind:this={menu} role="dialog" tabindex="-1" class:mobile={position.mobile} class:flipped={position.flipped} class="garden-action-menu" data-garden-action-menu data-menu-pane={pane} aria-label={`Actions for ${selected.layoutKey}`} style={`left:${position.left}px;top:${position.top}px`}>
    {#if pane !== 'root' && !position.mobile}
      <aside class="parent-pane" data-garden-menu-parent aria-label="Plot action categories">
        <p class="eyebrow">{selected.layoutKey} · actions</p>
        {#if selected.kind === 'empty'}<button type="button" onclick={() => choose('plant')}>Plant</button>{/if}
        {#if selected.kind !== 'beehive'}<button type="button" onclick={() => choose('water')}>Water</button><button type="button" onclick={() => choose('amend')}>Fertilize</button>{/if}
        {#if selected.kind !== 'empty'}<button type="button" onclick={startMove}>Move</button>{/if}
        {#if hasApiaryAction}<button type="button" onclick={() => choose('apiary')}>Apiary</button>{/if}
      </aside>
    {/if}
    <div class="menu-card">
    <header><span class="eyebrow">{selected.layoutKey}{#if position.mobile && pane !== 'root'} / {pane === 'amend' ? 'Fertilize' : pane === 'clover' ? 'Clover' : pane[0].toUpperCase() + pane.slice(1)}{/if}</span>{#if pane !== 'root'}<button type="button" class="back" data-garden-menu-back onclick={back}>‹ Back</button>{/if}<button type="button" class="dismiss" aria-label="Close plot actions" onclick={dismiss}>×</button></header>
    {#if pane === 'root'}
      <h2>Plot actions</h2>
      <div class="menu-actions" data-garden-menu-root>
        {#if selected.kind === 'empty'}<button type="button" data-garden-action="plant" onclick={() => choose('plant')}>🌱 Plant <b>›</b></button>{/if}
        {#if selected.kind !== 'beehive'}<button type="button" data-garden-action="water" onclick={() => choose('water')}>💧 Water <b>›</b></button><button type="button" data-garden-action="fertilize" onclick={() => choose('amend')}>✦ Fertilize <b>›</b></button>{/if}
        {#if selected.kind !== 'empty'}<button type="button" data-garden-action="move" onclick={startMove}>↔ Move <b>›</b></button>{/if}
        {#if selected.kind === 'plant' && selected.plant?.speciesKey === 'clover'}<button type="button" data-garden-action="incorporate-clover" onclick={() => choose('clover')}>☘ Incorporate clover <b>›</b></button>{/if}
        {#if selected.kind === 'plant'}<button type="button" data-garden-action="remove" onclick={() => choose('remove')}>× Remove plant <b>›</b></button>{/if}
        {#if compostableBatches.length && selected.kind !== 'beehive'}<button type="button" data-garden-action="compost" onclick={() => choose('compost')}>♻ Compost ingredient <b>›</b></button>{/if}
        {#if hasApiaryAction}<button type="button" data-garden-action="apiary" onclick={() => choose('apiary')}>♜ Apiary <b>›</b></button>{/if}
        {#if harvest}<div class="harvest-action">{@render harvest()}</div>{/if}
      </div>
    {:else if pane === 'plant'}
      <h2>Plant</h2><form method="POST" action="?/preview" use:enhance={previewAction('plant')}><label>Seed<select bind:value={seedItemKey} aria-label="Seed">{#each seeds as seed}<option value={seed.itemKey}>{seed.name} · {seed.quantity}</option>{/each}</select></label><button type="submit" data-garden-command="plant" disabled={!!pending || !seeds.length}>Preview planting</button></form>
    {:else if pane === 'water'}
      <h2>Water</h2><p class="help">{targets.length} plot{targets.length === 1 ? '' : 's'} selected.</p><label>Amount <output>{waterDose}</output><input aria-label="Water amount" type="range" min="1" max="40" step="1" bind:value={waterDose} /></label><div class="batch-row">{#if !batchMode}<button type="button" class="plain" data-batch-start="water" onclick={() => startBatch('water')}>Add plots</button>{:else}<button type="button" class="plain" onclick={oncancelbatch}>Cancel selection</button>{/if}<form method="POST" action="?/preview" use:enhance={previewAction('water')}><button type="submit" data-garden-command="water" disabled={!!pending}>Preview water</button></form></div>
    {:else if pane === 'amend'}
      <h2>Fertilize</h2><p class="help">{targets.length} plot{targets.length === 1 ? '' : 's'} selected.</p><label>Amendment<select bind:value={amendmentKey} aria-label="Amendment">{#each amendments as item}<option value={item.itemKey}>{item.name} · {item.quantity}</option>{/each}</select></label><label>Strength <output>{['Light','Medium','Heavy'][amendmentDose - 1]} · {amendmentDose}</output><input aria-label="Fertilizer strength" type="range" min="1" max="3" step="1" bind:value={amendmentDose} /></label><div class="batch-row">{#if !batchMode}<button type="button" class="plain" data-batch-start="amend" onclick={() => startBatch('amend')}>Add plots</button>{:else}<button type="button" class="plain" onclick={oncancelbatch}>Cancel selection</button>{/if}<form method="POST" action="?/preview" use:enhance={previewAction('amend')}><button type="submit" data-garden-command="amend" disabled={!!pending || !amendments.length}>Preview fertilize</button></form></div>
    {:else if pane === 'move'}
      <h2>Move</h2><p class="help">{target ? `Destination: ${target.layoutKey}. Its occupant will swap.` : 'Select a destination plot on the board.'}</p><form method="POST" action="?/preview" use:enhance={previewAction('move')}><button type="submit" data-garden-command="move" disabled={!!pending || !target}>Preview move</button></form>
    {:else if pane === 'remove'}
      <h2>Remove plant</h2><p class="help">This removes the plant permanently.</p><label class="check"><input type="checkbox" bind:checked={compostRemoval} /> Compost eligible biomass</label><form method="POST" action="?/preview" use:enhance={previewAction('remove')}><button type="submit" data-garden-command="remove" disabled={!!pending}>Preview removal</button></form>
    {:else if pane === 'clover'}
      <h2>Incorporate clover</h2><p class="help">Established clover is sacrificed and releases local soil benefits over three days.</p><form method="POST" action="?/preview" use:enhance={previewAction('incorporate_clover')}><button type="submit" data-garden-command="incorporate_clover" disabled={!!pending}>Preview incorporation</button></form>
    {:else if pane === 'compost'}
      <h2>Compost ingredient</h2><label>Ingredient batch<select bind:value={compostBatchId} aria-label="Ingredient batch">{#each compostableBatches as batch}<option value={batch.id}>{batch.plantName} · {batch.quantity - (batch.consumedQuantity ?? 0) - (batch.compostedQuantity ?? 0)} available</option>{/each}</select></label><label>Units <output>{compostQuantity}</output><input aria-label="Compost quantity" type="range" min="1" max="20" step="1" bind:value={compostQuantity} /></label><form method="POST" action="?/preview" use:enhance={previewAction('compost_ingredient')}><button type="submit" data-garden-command="compost_ingredient" disabled={!!pending || !compostableBatches.length}>Preview compost</button></form>
    {:else if pane === 'apiary'}
      <GardenProvisionPanel {snapshot} {selected} />
    {:else if pane === 'preview' && preview}
      {@const currentPreview = preview}
      <h2>Confirm {label(currentPreview.commandKind)}</h2><p class="help">Authoritative preview · revision {currentPreview.basedOnRevision}</p>{#if 'cellIds' in (previewPayload ?? {})}<p class="help" data-garden-preview-targets>Targets: {(previewPayload as { cellIds: string[] }).cellIds.map((id) => snapshot.cells.find((cell) => cell.id === id)?.layoutKey ?? id).join(', ')}</p>{/if}<dl>{#each Object.entries(currentPreview).filter(([key]) => !['commandKind','basedOnRevision','rulesVersion','normalizedPayload','targets','canCommit'].includes(key)) as [key,value]}<div><dt>{key.replaceAll(/([A-Z])/g, ' $1')}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>{/each}</dl>{#if currentPreview.canCommit === false}<p class="error" role="alert">This cannot be completed with the current resources.</p>{:else}<form method="POST" action="?/command" use:enhance={commit}><button type="submit" data-garden-confirm={currentPreview.commandKind} disabled={!!pending}>{pending?.startsWith('commit:') ? 'Applying…' : pendingAction && messageError ? `Retry ${label(currentPreview.commandKind)}` : label(currentPreview.commandKind)}</button></form>{/if}
    {/if}
    {#if message}<p class:error={messageError} class="feedback" role={messageError ? 'alert' : 'status'}>{message}</p>{/if}
    </div>
  </div>
{/if}

<style>
  .garden-action-menu { position: fixed; z-index: 60; width: min(17.5rem, calc(100vw - 1rem)); overflow: visible; color: #ecd79f; font-family: Cinzel,serif; }
  .menu-card { position: relative; z-index: 1; max-height: min(75vh, 30rem); overflow-y: auto; padding: .6rem; border: 1px solid #b1863c; border-radius: 4px; background: linear-gradient(135deg,#241708f7,#100a05fa); box-shadow: 0 12px 30px #000b, inset 0 0 0 1px #523516; }
  .parent-pane { position:absolute; right:calc(100% + 10px); top:0; z-index:0; display:grid; gap:.3rem; width:8.5rem; padding:.55rem; border:1px solid #956c2b; border-radius:4px; background:#160d06f5; box-shadow:0 8px 20px #0009; } .parent-pane .eyebrow { margin:0 0 .2rem; } .parent-pane button { min-height:29px; border:1px solid #5e421d; color:#d9bf80; background:#211407; font:inherit; font-size:.65rem; text-align:left; cursor:pointer; } .parent-pane button:hover,.parent-pane button:focus-visible { background:#624518; outline:1px solid #f9e1a0; } .flipped .parent-pane { right:auto; left:calc(100% + 10px); }
  header { display:flex; align-items:center; min-height: 24px; gap:.4rem; border-bottom:1px solid #5c401d; } .eyebrow { margin-right:auto; color:#cda54e; font-size:.62rem; letter-spacing:.1em; } .dismiss,.back,.plain { border:0; color:#dcc384; background:transparent; cursor:pointer; } .dismiss { font-size:1.2rem; } .back { font-size:.7rem; }
  h2 { margin:.55rem 0; color:#f3d991; font-size:.92rem; } .menu-actions { display:grid; gap:.35rem; } .menu-actions > button,.garden-action-menu form > button { display:flex; justify-content:space-between; width:100%; min-height:38px; padding:.45rem .55rem; border:1px solid #765324; color:#ead39b; background:#201407; font:inherit; font-size:.72rem; cursor:pointer; text-align:left; } .menu-actions button:hover,.menu-actions button:focus-visible,.garden-action-menu form > button:hover,.garden-action-menu form > button:focus-visible { background:#5b3f16; outline:1px solid #ffe9a8; outline-offset:1px; } .harvest-action :global(button) { width:100%; } form,label { display:grid; gap:.45rem; } label { color:#c9ad70; font-size:.7rem; } .check { display:flex; align-items:center; } select,input { min-height:34px; border:1px solid #765324; color:#f0dca8; background:#100a05; } output { float:right; color:#f4dc96; } input[type='range'] { width:100%; accent-color:#c6963d; } .help { margin:.35rem 0 .6rem; color:#b29c72; font-family:Georgia,serif; font-size:.76rem; line-height:1.35; } .batch-row { display:flex; align-items:center; justify-content:space-between; gap:.4rem; margin-top:.55rem; } .batch-row form { flex:1; } .batch-row .plain { padding:.4rem; font-family:inherit; font-size:.67rem; text-decoration:underline; } dl { display:grid; gap:.3rem; margin:.45rem 0 .7rem; } dl div { display:flex; justify-content:space-between; gap:.5rem; font-size:.65rem; } dt { color:#a89161; } dd { max-width:58%; margin:0; overflow-wrap:anywhere; text-align:right; } .feedback,.error { margin:.55rem 0 0; padding:.4rem; border:1px solid #5d6939; color:#d4e0ad; font-family:Georgia,serif; font-size:.72rem; } .error { border-color:#9d4d3b; color:#ffd0ba; } .mobile { width:min(19rem, calc(100vw - 1rem)); } .mobile .parent-pane { display:none; }
</style>
