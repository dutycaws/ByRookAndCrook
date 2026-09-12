<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type {
    GameSnapshot,
    GardenCell,
    GardenCommandKind,
    GardenCommandPayload,
    GardenCommandPreview,
    GardenCommandReceipt
  } from '$lib/game/contracts';
  import { gardenSuccessFeedback } from '$lib/game/garden-feedback';

  let {
    snapshot,
    selected,
    batchMode = null,
    batchTargetIds = new Set<string>(),
    onstartbatch = () => {},
    oncancelbatch = () => {}
  }: {
    snapshot: GameSnapshot;
    selected: GardenCell | null;
    batchMode?: 'water' | 'amend' | null;
    batchTargetIds?: Set<string>;
    onstartbatch?: (kind: 'water' | 'amend') => void;
    oncancelbatch?: () => void;
  } = $props();

  type PendingAction = {
    signature: string;
    actionId: string;
    expectedRevision: number;
  };

  let waterDose = $state(10);
  let amendmentKey = $state('');
  let amendmentDose = $state(1);
  let seedItemKey = $state('');
  let moveTargetId = $state('');
  let compostRemoval = $state(true);
  let compostBatchId = $state('');
  let compostQuantity = $state(1);
  let preview = $state<GardenCommandPreview | null>(null);
  let previewPayload = $state<GardenCommandPayload | null>(null);
  let previewSignature = $state('');
  let pendingAction = $state<PendingAction | null>(null);
  let pendingLabel = $state<string | null>(null);
  let message = $state<string | null>(null);
  let messageError = $state(false);

  let unlocked = $derived(snapshot.cells.filter((cell) => cell.unlocked !== false));
  let seedItems = $derived(snapshot.garden?.inventory.filter((item) => item.kind === 'seed' && item.quantity > 0) ?? []);
  let amendments = $derived(snapshot.garden?.inventory.filter((item) => item.kind === 'amendment' && item.quantity > 0) ?? []);
  let compostableBatches = $derived(snapshot.ingredients.filter((batch) => {
    const available = batch.quantity - (batch.consumedQuantity ?? 0) - (batch.compostedQuantity ?? 0);
    return available > 0 && batch.id !== snapshot.brewery.activeSession?.ingredientBatchId
      && batch.id !== snapshot.bakery.activeSession?.ingredientBatchId;
  }));
  let careIds = $derived(batchMode ? [...batchTargetIds] : selected ? [selected.id] : []);
  let canUsePreview = $derived(!!preview && previewSignature === signature(preview.commandKind, previewPayload));

  function signature(kind: GardenCommandKind, payload: GardenCommandPayload | null) {
    return `${kind}:${JSON.stringify(payload)}`;
  }

  function label(kind: GardenCommandKind) {
    return ({
      plant: 'plant seed', move: 'move or swap', remove: 'remove plant', water: 'water plots',
      amend: 'amend soil', incorporate_clover: 'incorporate clover', compost_ingredient: 'start compost',
      purchase: 'purchase', expand: 'expand garden'
    } satisfies Record<GardenCommandKind, string>)[kind];
  }

  function clearPreview(clearMessage = true) {
    preview = null;
    previewPayload = null;
    previewSignature = '';
    if (clearMessage) message = null;
  }

  function previewEnhancer(kind: GardenCommandKind, payload: () => GardenCommandPayload | null): SubmitFunction {
    return ({ formData, cancel }) => {
      const nextPayload = payload();
      if (!nextPayload) {
        cancel();
        message = 'Choose every value needed for this action.';
        messageError = true;
        return;
      }
      formData.set('commandKind', kind);
      formData.set('payload', JSON.stringify(nextPayload));
      pendingLabel = `preview:${kind}`;
      message = null;
      return async ({ result }) => {
        pendingLabel = null;
        const data = 'data' in result ? result.data as { preview?: GardenCommandPreview; message?: string } | undefined : undefined;
        if (result.type === 'success' && data?.preview) {
          preview = data.preview;
          previewPayload = nextPayload;
          previewSignature = signature(kind, nextPayload);
          messageError = false;
        } else {
          message = data?.message ?? 'The authoritative preview is unavailable.';
          messageError = true;
        }
      };
    };
  }

  const commitPreview: SubmitFunction = ({ formData, cancel }) => {
    if (!preview || !previewPayload || !canUsePreview) {
      cancel();
      message = 'Preview this action again before committing it.';
      messageError = true;
      return;
    }
    const currentSignature = signature(preview.commandKind, previewPayload);
    if (!pendingAction || pendingAction.signature !== currentSignature || pendingAction.expectedRevision !== snapshot.save.revision) {
      pendingAction = {
        signature: currentSignature,
        actionId: crypto.randomUUID(),
        expectedRevision: snapshot.save.revision
      };
    }
    formData.set('saveId', snapshot.save.id);
    formData.set('actionId', pendingAction.actionId);
    formData.set('expectedRevision', String(pendingAction.expectedRevision));
    formData.set('commandKind', preview.commandKind);
    formData.set('payload', JSON.stringify(previewPayload));
    pendingLabel = `commit:${preview.commandKind}`;
    message = null;
    return async ({ result, update }) => {
      pendingLabel = null;
      const data = 'data' in result ? result.data as { message?: string; conflict?: boolean; pendingAction?: object; receipt?: GardenCommandReceipt } | undefined : undefined;
      if (result.type === 'error') {
        message = 'The outcome is unknown. Retry to recover the same action.';
        messageError = true;
        return;
      } else if (result.type === 'success') {
        message = data?.receipt
          ? gardenSuccessFeedback(data.receipt.commandKind, data.receipt, {
              cellLabel: (id) => snapshot.cells.find((cell) => cell.id === id)?.layoutKey
            })
          : data?.message ?? 'Garden action complete';
        messageError = false;
        pendingAction = null;
        clearPreview(false);
      } else if (data?.pendingAction) {
        message = data?.message ?? 'The outcome is unknown. Retry to recover the same action.';
        messageError = true;
      } else {
        message = data?.message ?? 'The garden action was rejected.';
        messageError = true;
        pendingAction = null;
      }
      await update({ reset: false, invalidateAll: result.type === 'success' || !!data?.conflict });
    };
  };

  function value(value: unknown) {
    if (typeof value === 'number' || typeof value === 'string') return String(value);
    return JSON.stringify(value);
  }

  function fieldValue(key: string, item: unknown) {
    if (key === 'itemKey' && typeof item === 'string') {
      const catalogItem = snapshot.garden?.inventory.find((entry) => entry.itemKey === item)
        ?? snapshot.garden?.shop.find((entry) => entry.itemKey === item);
      if (catalogItem) return `${catalogItem.name} (${item})`;
    }
    return value(item);
  }
</script>

<section class="workbench" aria-labelledby="garden-care-title">
  <div class="workbench-heading">
    <div><p class="eyebrow">Garden actions</p><h2 id="garden-care-title">Tend {selected?.layoutKey ?? 'selected land'}</h2></div>
    {#if batchMode}<button type="button" class="text-button" onclick={oncancelbatch}>Cancel batch</button>{/if}
  </div>

  <details class="tool-group" open>
    <summary>{batchMode ? `Batch ${batchMode} · ${careIds.length} plots` : `Care ${selected?.layoutKey ?? ''}`}</summary>
    <p class="help">{batchMode ? 'Choose plots in the garden, then preview the shared care.' : 'Care applies to this plot. Add plots to use the same dose on several.'}</p>
    <div class="batch-actions">
      {#if !batchMode}
        <button type="button" class="text-button" data-batch-start="water" onclick={() => onstartbatch('water')}>Add plots for water</button>
        <button type="button" class="text-button" data-batch-start="amend" onclick={() => onstartbatch('amend')}>Add plots for soil care</button>
      {:else}
        <span>{careIds.length} selected</span>
      {/if}
    </div>
    <div class="tool-row">
      <form method="POST" action="?/preview" use:enhance={previewEnhancer('water', () => careIds.length ? { cellIds: careIds, dose: waterDose } : null)}>
        <label>Water dose <input type="number" min="1" max="40" bind:value={waterDose} /></label>
        <button type="submit" class="secondary-button" data-garden-command="water" disabled={!!pendingLabel || careIds.length === 0 || (batchMode !== null && batchMode !== 'water')}>Preview water</button>
      </form>
      <form method="POST" action="?/preview" use:enhance={previewEnhancer('amend', () => careIds.length && (amendmentKey || amendments[0]?.itemKey) ? { cellIds: careIds, itemKey: amendmentKey || amendments[0]!.itemKey, dose: amendmentDose } : null)}>
        <label>Amendment
          <select bind:value={amendmentKey} disabled={!amendments.length}>
            {#each amendments as item}<option value={item.itemKey}>{item.name} · {item.quantity}</option>{/each}
          </select>
        </label>
        <label>Dose per plot <input type="number" min="1" max="3" bind:value={amendmentDose} /></label>
        <button type="submit" class="secondary-button" data-garden-command="amend" disabled={!!pendingLabel || careIds.length === 0 || !amendments.length || (batchMode !== null && batchMode !== 'amend')}>Preview amendment</button>
      </form>
    </div>
  </details>

  {#if selected?.kind === 'empty'}
    <details class="tool-group" open>
      <summary>Plant plot {selected.layoutKey}</summary>
      <form method="POST" action="?/preview" use:enhance={previewEnhancer('plant', () => (seedItemKey || seedItems[0]?.itemKey) ? { cellId: selected!.id, seedItemKey: seedItemKey || seedItems[0]!.itemKey } : null)}>
        <label>Seed
          <select bind:value={seedItemKey} disabled={!seedItems.length}>
            {#each seedItems as item}<option value={item.itemKey}>{item.name} · {item.quantity}</option>{/each}
          </select>
        </label>
        <button type="submit" class="secondary-button" data-garden-command="plant" disabled={!!pendingLabel || !seedItems.length}>Preview planting</button>
      </form>
    </details>
  {/if}

  {#if selected && selected.kind !== 'empty'}
    <details class="tool-group">
      <summary>Move or swap {selected.layoutKey}</summary>
      <form method="POST" action="?/preview" use:enhance={previewEnhancer('move', () => (moveTargetId || unlocked.find((cell) => cell.id !== selected!.id)?.id) ? { sourceCellId: selected!.id, targetCellId: moveTargetId || unlocked.find((cell) => cell.id !== selected!.id)!.id } : null)}>
        <label>Destination
          <select bind:value={moveTargetId}>
            {#each unlocked.filter((cell) => cell.id !== selected!.id) as cell}<option value={cell.id}>{cell.layoutKey} · {cell.plantName ?? (cell.kind === 'beehive' ? 'Hive' : 'Open soil')}</option>{/each}
          </select>
        </label>
        <p class="help">The occupant moves or swaps. Each plot keeps its own soil.</p>
        <button type="submit" class="secondary-button" data-garden-command="move" disabled={!!pendingLabel}>Preview move or swap</button>
      </form>
    </details>
  {/if}

  {#if selected?.kind === 'plant'}
    <details class="tool-group">
      <summary>Plant lifecycle actions</summary>
      {#if selected.plant?.speciesKey === 'clover'}
        <form method="POST" action="?/preview" use:enhance={previewEnhancer('incorporate_clover', () => ({ cellId: selected!.id }))}>
          <p class="help">Established clover is sacrificed and releases local soil benefits over three days.</p>
          <button type="submit" class="secondary-button" data-garden-command="incorporate_clover" disabled={!!pendingLabel}>Preview clover incorporation</button>
        </form>
      {/if}
      <form method="POST" action="?/preview" use:enhance={previewEnhancer('remove', () => ({ cellId: selected!.id, compost: compostRemoval }))}>
        <label class="check-row"><input type="checkbox" bind:checked={compostRemoval} /> Compost eligible biomass</label>
        <p class="help">Removal is permanent. Seedlings that are too young are removed without creating compost.</p>
        <button type="submit" class="danger-button" data-garden-command="remove" disabled={!!pendingLabel}>Preview removal</button>
      </form>
    </details>
  {/if}

  {#if selected && compostableBatches.length}
    <details class="tool-group">
      <summary>Compost a pantry ingredient</summary>
      <form method="POST" action="?/preview" use:enhance={previewEnhancer('compost_ingredient', () => (compostBatchId || compostableBatches[0]?.id) ? { cellId: selected!.id, ingredientBatchId: compostBatchId || compostableBatches[0]!.id, quantity: compostQuantity } : null)}>
        <label>Ingredient batch
          <select bind:value={compostBatchId}>
            {#each compostableBatches as batch}<option value={batch.id}>{batch.plantName} · {batch.quantity - (batch.consumedQuantity ?? 0) - (batch.compostedQuantity ?? 0)} available</option>{/each}
          </select>
        </label>
        <label>Units <input type="number" min="1" max="20" bind:value={compostQuantity} /></label>
        <button type="submit" class="secondary-button" data-garden-command="compost_ingredient" disabled={!!pendingLabel}>Preview compost</button>
      </form>
    </details>
  {/if}

  {#if preview && canUsePreview}
    <section class="preview-card" aria-live="polite" data-garden-preview>
      <p class="eyebrow">Authoritative preview</p>
      <h3>{label(preview.commandKind)}</h3>
      <dl>
        <div><dt>Based on revision</dt><dd>{preview.basedOnRevision}</dd></div>
        {#each Object.entries(preview).filter(([key]) => !['commandKind','basedOnRevision','rulesVersion','normalizedPayload','targets'].includes(key)) as [key, item]}
          <div><dt>{key.replaceAll(/([A-Z])/g, ' $1')}</dt><dd>{fieldValue(key, item)}</dd></div>
        {/each}
      </dl>
      {#if Array.isArray(preview.targets)}
        <details><summary>Per-plot consequences</summary><pre>{JSON.stringify(preview.targets, null, 2)}</pre></details>
      {/if}
      {#if preview.canCommit === false}
        <p class="form-message error" role="alert">You do not have what this action needs.</p>
      {:else}
        <form method="POST" action="?/command" use:enhance={commitPreview} data-garden-command={preview.commandKind}>
          <button type="submit" class="primary-button" disabled={!!pendingLabel}>
            {pendingLabel?.startsWith('commit:') ? 'Applying…' : pendingAction && messageError ? `Retry ${label(preview.commandKind)}` : `Apply ${label(preview.commandKind)}`}
          </button>
        </form>
        {#if preview.canCommit === undefined}<p class="help">Availability is checked again when you apply this action.</p>{/if}
      {/if}
    </section>
  {/if}

  {#if message}
    <div class="form-message" class:error={messageError} role={messageError ? 'alert' : 'status'} aria-live="polite">{message}</div>
  {/if}
</section>

<style>
  .workbench { display: grid; gap: .7rem; padding-top: .9rem; border-top: 1px solid #4a371c; }
  .workbench-heading { display: flex; align-items: end; justify-content: space-between; gap: .5rem; }
  .workbench-heading h2 { margin: .2rem 0 0; font-size: 1rem; }
  .text-button { min-height: 36px; padding: .3rem .55rem; border: 1px solid #5c4727; color: #bda572; background: transparent; }
  .tool-group { padding: .55rem .6rem; border: 1px solid #4e3a1e; background: #110d07; }
  summary { color: #dabd72; cursor: pointer; font-family: 'Cinzel',serif; font-size: .75rem; }
  .tool-group form, .tool-row { display: grid; gap: .55rem; margin-top: .6rem; }
  .tool-row { grid-template-columns: repeat(2,minmax(0,1fr)); }
  label { display: grid; gap: .25rem; color: #a99267; font-size: .7rem; }
  input, select { min-width: 0; min-height: 38px; padding: .4rem .45rem; border: 1px solid #624a26; border-radius: 0; color: #e2cc97; background: #090704; }
  .check-row { display: flex; align-items: center; gap: .4rem; }
  .check-row input { min-height: auto; }
  .batch-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; margin-top: .55rem; color: #c9ad69; font-size: .7rem; }
  .secondary-button, .danger-button { min-height: 40px; padding: .45rem .6rem; border: 1px solid #70552c; color: #d8bc78; background: #1a1309; font-family: 'Cinzel',serif; font-size: .67rem; }
  .danger-button { border-color: #884932; color: #e2a58f; background: #21100b; }
  button:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: .5; }
  .help { margin: .45rem 0 0; color: #9f8b66; font-size: .67rem; line-height: 1.4; }
  .preview-card { display: grid; gap: .55rem; padding: .7rem; border: 1px solid #ad8335; background: #1b1307; }
  .preview-card h3 { margin: 0; color: #e6cb84; font-size: .9rem; text-transform: capitalize; }
  .preview-card dl { display: grid; gap: .25rem; margin: 0; }
  .preview-card dl div { display: flex; justify-content: space-between; gap: .5rem; }
  .preview-card dt { color: #9f8960; font-size: .65rem; text-transform: capitalize; }
  .preview-card dd { max-width: 55%; margin: 0; overflow-wrap: anywhere; color: #dfc789; font-size: .68rem; text-align: right; }
  pre { max-height: 12rem; overflow: auto; color: #c5b083; font-size: .6rem; white-space: pre-wrap; }
  @media (max-width: 460px) { .tool-row { grid-template-columns: 1fr; } }
</style>
