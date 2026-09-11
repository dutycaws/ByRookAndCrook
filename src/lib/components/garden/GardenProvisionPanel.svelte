<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type {
    ApiaryCommandKind,
    ApiaryCommandPayload,
    ApiaryCommandPreview,
    GameSnapshot,
    GardenCell,
    GardenCommandKind,
    GardenCommandPayload,
    GardenCommandPreview
  } from '$lib/game/contracts';

  let { snapshot, selected }: { snapshot: GameSnapshot; selected: GardenCell | null } = $props();

  type Scope = 'garden' | 'apiary';
  type Kind = GardenCommandKind | ApiaryCommandKind;
  type Payload = GardenCommandPayload | ApiaryCommandPayload;
  type Preview = GardenCommandPreview | ApiaryCommandPreview;

  let shopItemKey = $state('');
  let shopQuantity = $state(1);
  let feedQuantity = $state(1);
  let honeyQuantity = $state(1);
  let treatmentItemKey = $state('');
  let splitTargetHiveId = $state('');
  let preview = $state<Preview | null>(null);
  let previewScope = $state<Scope>('garden');
  let previewPayload = $state<Payload | null>(null);
  let previewSignature = $state('');
  let pendingAction = $state<{ signature: string; actionId: string; revision: number } | null>(null);
  let pending = $state(false);
  let message = $state<string | null>(null);
  let messageError = $state(false);

  let garden = $derived(snapshot.garden);
  let inventory = $derived(garden?.inventory ?? []);
  let shop = $derived(garden?.shop ?? []);
  let nextExpansion = $derived(garden?.expansions.find((expansion) => expansion.available) ?? null);
  let colony = $derived(selected?.hive?.colony ?? null);
  let emptyHives = $derived(snapshot.cells.filter((cell) => cell.unlocked !== false && cell.kind === 'beehive' && cell.hive && !cell.hive.hasColony));
  let treatments = $derived(inventory.filter((item) => item.kind === 'treatment' && item.quantity > 0));
  let hasCurrentPreview = $derived(!!preview && previewSignature === makeSignature(previewScope, preview.commandKind, previewPayload));

  function makeSignature(scope: Scope, kind: Kind, payload: Payload | null) {
    return `${scope}:${kind}:${JSON.stringify(payload)}`;
  }

  function actionLabel(kind: Kind) {
    return ({
      plant: 'plant seed', move: 'move or swap', remove: 'remove plant', water: 'water plots', amend: 'amend soil',
      incorporate_clover: 'incorporate clover', compost_ingredient: 'start compost', purchase: 'purchase supplies', expand: 'expand garden',
      install_hive: 'install hive', install_colony: 'install colony', feed: 'feed colony', treat: 'treat colony',
      split: 'split colony', extract_honey: 'extract honey'
    } satisfies Record<Kind, string>)[kind];
  }

  function inventoryQuantity(kind: 'equipment' | 'colony' | 'feed') {
    return inventory.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.quantity, 0);
  }

  function previewEnhancer(scope: Scope, kind: Kind, payload: () => Payload | null): SubmitFunction {
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
      pending = true;
      message = null;
      return async ({ result }) => {
        pending = false;
        const data = 'data' in result ? result.data as { preview?: Preview; message?: string } | undefined : undefined;
        if (result.type === 'success' && data?.preview) {
          preview = data.preview;
          previewScope = scope;
          previewPayload = nextPayload;
          previewSignature = makeSignature(scope, kind, nextPayload);
          messageError = false;
        } else {
          message = data?.message ?? 'The authoritative preview is unavailable.';
          messageError = true;
        }
      };
    };
  }

  const commitPreview: SubmitFunction = ({ formData, cancel }) => {
    if (!preview || !previewPayload || !hasCurrentPreview) {
      cancel();
      message = 'Preview this action again before committing it.';
      messageError = true;
      return;
    }
    const currentSignature = makeSignature(previewScope, preview.commandKind, previewPayload);
    if (!pendingAction || pendingAction.signature !== currentSignature || pendingAction.revision !== snapshot.save.revision) {
      pendingAction = { signature: currentSignature, actionId: crypto.randomUUID(), revision: snapshot.save.revision };
    }
    formData.set('saveId', snapshot.save.id);
    formData.set('actionId', pendingAction.actionId);
    formData.set('expectedRevision', String(pendingAction.revision));
    formData.set('commandKind', preview.commandKind);
    formData.set('payload', JSON.stringify(previewPayload));
    pending = true;
    message = null;
    return async ({ result, update }) => {
      pending = false;
      const data = 'data' in result ? result.data as { message?: string; conflict?: boolean; pendingAction?: object } | undefined : undefined;
      if (result.type === 'error') {
        message = 'The outcome is unknown. Retry to recover the same action.';
        messageError = true;
        return;
      }
      if (result.type === 'success') {
        message = data?.message ?? 'The garden ledger has been updated.';
        messageError = false;
        preview = null;
        previewPayload = null;
        previewSignature = '';
        pendingAction = null;
      } else if (data?.pendingAction) {
        message = data.message ?? 'The outcome is unknown. Retry to recover the same action.';
        messageError = true;
      } else {
        message = data?.message ?? 'The action was rejected.';
        messageError = true;
        pendingAction = null;
      }
      await update({ reset: false, invalidateAll: result.type === 'success' || !!data?.conflict });
    };
  };

  function fieldValue(key: string, item: unknown) {
    if ((key === 'itemKey' || key === 'treatmentItemKey') && typeof item === 'string') {
      const entry = inventory.find((candidate) => candidate.itemKey === item) ?? shop.find((candidate) => candidate.itemKey === item);
      if (entry) return `${entry.name} (${item})`;
    }
    if (typeof item === 'number' || typeof item === 'string') return String(item);
    return JSON.stringify(item);
  }
</script>

<section class="provision-panel" aria-labelledby="provision-heading">
  <div><p class="eyebrow">Courtyard stores</p><h2 id="provision-heading">Supply and apiary</h2></div>

  <details class="provision-group">
    <summary>Purchase supplies · {snapshot.save.gold ?? 0} gold</summary>
    <form method="POST" action="?/preview" use:enhance={previewEnhancer('garden', 'purchase', () => (shopItemKey || shop[0]?.itemKey) ? { itemKey: shopItemKey || shop[0]!.itemKey, quantity: shopQuantity } : null)}>
      <label>Item
        <select bind:value={shopItemKey} disabled={!shop.length}>
          {#each shop as item}<option value={item.itemKey}>{item.name} · {item.price} gold</option>{/each}
        </select>
      </label>
      <label>Quantity <input type="number" min="1" max="20" bind:value={shopQuantity} /></label>
      <button type="submit" class="secondary-button" data-garden-command="purchase" disabled={pending || !shop.length}>Preview purchase</button>
    </form>
  </details>

  {#if nextExpansion}
    <details class="provision-group">
      <summary>Land expansion</summary>
      <p class="help">Unlock {nextExpansion.plotCount - (garden?.plotCount ?? 12)} new plots without changing existing plot identities.</p>
      <form method="POST" action="?/preview" use:enhance={previewEnhancer('garden', 'expand', () => ({ plotCount: nextExpansion!.plotCount }))}>
        <button type="submit" class="secondary-button" data-garden-command="expand" disabled={pending}>Preview {nextExpansion.plotCount}-plot expansion · {nextExpansion.price} gold</button>
      </form>
    </details>
  {/if}

  {#if selected?.kind === 'empty'}
    <details class="provision-group" open>
      <summary>Install hive on {selected.layoutKey}</summary>
      <p class="help">Empty hive equipment in inventory: {inventoryQuantity('equipment')}.</p>
      <form method="POST" action="?/apiaryPreview" use:enhance={previewEnhancer('apiary', 'install_hive', () => ({ cellId: selected!.id }))}>
        <button type="submit" class="secondary-button" data-apiary-command="install_hive" disabled={pending}>Preview hive installation</button>
      </form>
    </details>
  {/if}

  {#if selected?.kind === 'beehive' && selected.hive && !selected.hive.hasColony}
    <details class="provision-group" open>
      <summary>Populate this hive</summary>
      <p class="help">Replacement colonies in inventory: {inventoryQuantity('colony')}.</p>
      <form method="POST" action="?/apiaryPreview" use:enhance={previewEnhancer('apiary', 'install_colony', () => ({ hiveId: selected!.hive!.id }))}>
        <button type="submit" class="secondary-button" data-apiary-command="install_colony" disabled={pending}>Preview colony installation</button>
      </form>
    </details>
  {/if}

  {#if colony}
    <details class="provision-group" open>
      <summary>Manage colony</summary>
      <div class="apiary-actions">
        <form method="POST" action="?/apiaryPreview" use:enhance={previewEnhancer('apiary', 'feed', () => ({ colonyId: colony!.id, quantity: feedQuantity }))}>
          <label>Feed units <input type="number" min="1" max="10" bind:value={feedQuantity} /></label>
          <button type="submit" class="secondary-button" data-apiary-command="feed" disabled={pending}>Preview feeding</button>
        </form>
        <form method="POST" action="?/apiaryPreview" use:enhance={previewEnhancer('apiary', 'extract_honey', () => ({ colonyId: colony!.id, quantity: honeyQuantity }))}>
          <label>Honey units <input type="number" min="1" max="20" bind:value={honeyQuantity} /></label>
          <button type="submit" class="secondary-button" data-apiary-command="extract_honey" disabled={pending}>Preview safe extraction</button>
        </form>
        <form method="POST" action="?/apiaryPreview" use:enhance={previewEnhancer('apiary', 'treat', () => (treatmentItemKey || treatments[0]?.itemKey) ? { colonyId: colony!.id, treatmentItemKey: treatmentItemKey || treatments[0]!.itemKey } : null)}>
          <label>Treatment
            <select bind:value={treatmentItemKey} disabled={!treatments.length}>
              {#each treatments as item}<option value={item.itemKey}>{item.name} · {item.quantity}</option>{/each}
            </select>
          </label>
          <button type="submit" class="secondary-button" data-apiary-command="treat" disabled={pending || !treatments.length}>Preview treatment</button>
        </form>
        <form method="POST" action="?/apiaryPreview" use:enhance={previewEnhancer('apiary', 'split', () => (splitTargetHiveId || emptyHives[0]?.hive?.id) ? { sourceColonyId: colony!.id, targetHiveId: splitTargetHiveId || emptyHives[0]!.hive!.id } : null)}>
          <label>Empty destination hive
            <select bind:value={splitTargetHiveId} disabled={!emptyHives.length}>
              {#each emptyHives as cell}<option value={cell.hive!.id}>{cell.layoutKey} · equipment {cell.hive!.equipmentCondition}%</option>{/each}
            </select>
          </label>
          <button type="submit" class="secondary-button" data-apiary-command="split" disabled={pending || !emptyHives.length}>Preview colony split</button>
        </form>
      </div>
    </details>
  {/if}

  {#if preview && hasCurrentPreview}
    <section class="preview-card" aria-live="polite" data-provision-preview data-preview-scope={previewScope}>
      <p class="eyebrow">Authoritative preview</p>
      <h3>{actionLabel(preview.commandKind)}</h3>
      <dl>
        <div><dt>Based on revision</dt><dd>{preview.basedOnRevision}</dd></div>
        {#each Object.entries(preview).filter(([key]) => !['commandKind','basedOnRevision','rulesVersion','normalizedPayload'].includes(key)) as [key, item]}
          <div><dt>{key.replaceAll(/([A-Z])/g, ' $1')}</dt><dd>{fieldValue(key, item)}</dd></div>
        {/each}
      </dl>
      {#if preview.canCommit === false}
        <p class="form-message error" role="alert">This action cannot be committed with the current state or resources.</p>
      {:else}
        <form method="POST" action={previewScope === 'apiary' ? '?/apiaryCommand' : '?/command'} use:enhance={commitPreview} data-command-scope={previewScope}>
          <button type="submit" class="primary-button" disabled={pending} data-apiary-command={previewScope === 'apiary' ? preview.commandKind : undefined} data-garden-command={previewScope === 'garden' ? preview.commandKind : undefined}>
            {pending ? 'Committing…' : pendingAction && messageError ? `Retry ${actionLabel(preview.commandKind)}` : `Commit ${actionLabel(preview.commandKind)}`}
          </button>
        </form>
      {/if}
    </section>
  {/if}

  {#if message}<div class="form-message" class:error={messageError} role={messageError ? 'alert' : 'status'} aria-live="polite">{message}</div>{/if}
</section>

<style>
  .provision-panel { display: grid; gap: .7rem; padding-top: .9rem; border-top: 1px solid #4a371c; }
  .provision-panel h2 { margin: .2rem 0 0; font-size: 1rem; }
  .provision-group { padding: .55rem .6rem; border: 1px solid #4e3a1e; background: #110d07; }
  summary { color: #dabd72; cursor: pointer; font-family: 'Cinzel',serif; font-size: .75rem; }
  form, .apiary-actions { display: grid; gap: .55rem; margin-top: .6rem; }
  label { display: grid; gap: .25rem; color: #a99267; font-size: .7rem; }
  input, select { min-width: 0; min-height: 38px; padding: .4rem .45rem; border: 1px solid #624a26; border-radius: 0; color: #e2cc97; background: #090704; }
  .secondary-button { min-height: 40px; padding: .45rem .6rem; border: 1px solid #70552c; color: #d8bc78; background: #1a1309; font-family: 'Cinzel',serif; font-size: .67rem; }
  button:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: .5; }
  .help { margin: .45rem 0 0; color: #9f8b66; font-size: .67rem; line-height: 1.4; }
  .preview-card { display: grid; gap: .55rem; padding: .7rem; border: 1px solid #ad8335; background: #1b1307; }
  .preview-card h3 { margin: 0; color: #e6cb84; font-size: .9rem; text-transform: capitalize; }
  .preview-card dl { display: grid; gap: .25rem; margin: 0; }
  .preview-card dl div { display: flex; justify-content: space-between; gap: .5rem; }
  .preview-card dt { color: #9f8960; font-size: .65rem; text-transform: capitalize; }
  .preview-card dd { max-width: 58%; margin: 0; overflow-wrap: anywhere; color: #dfc789; font-size: .68rem; text-align: right; }
</style>
