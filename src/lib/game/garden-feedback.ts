import type { ApiaryCommandKind, GardenCommandKind, GardenCommandPreview } from './contracts';

type ReceiptFields = {
  normalizedPayload: unknown;
  result: unknown;
};

/**
 * Provides presentation labels for authoritative cell IDs. The receipt remains
 * the source of truth; this only turns an already-confirmed cell ID into the
 * board label the player recognizes.
 */
export type GardenFeedbackOptions = {
  cellLabel?: (cellId: string) => string | undefined;
};

export type GardenPreviewFeedbackOptions = GardenFeedbackOptions & {
  itemName?: (itemKey: string) => string | undefined;
};

export type GardenPreviewFeedback = {
  summary: string;
  targets: string[];
  details: string[];
  resourceWarning?: string;
};

function fields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, key: string): string | undefined {
  const entry = fields(value)[key];
  return typeof entry === 'string' && entry.length > 0 ? entry : undefined;
}

function count(value: unknown, key: string): number | undefined {
  const entry = fields(value)[key];
  return typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0 ? entry : undefined;
}

function displayName(value: string | undefined): string | undefined {
  return value?.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cell(
  receipt: ReceiptFields,
  options: GardenFeedbackOptions,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const id = text(receipt.result, key) ?? text(receipt.normalizedPayload, key);
    if (id) return options.cellLabel ? options.cellLabel(id) ?? id : undefined;
  }
  return undefined;
}

function firstCell(receipt: ReceiptFields, options: GardenFeedbackOptions): string | undefined {
  for (const source of [fields(receipt.result), fields(receipt.normalizedPayload)]) {
    const ids = source.cellIds;
    if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== 'string') continue;
    return options.cellLabel ? options.cellLabel(ids[0]) ?? ids[0] : undefined;
  }
  return undefined;
}

function targetCount(receipt: ReceiptFields): number | undefined {
  return count(receipt.result, 'targetCount') ?? count(receipt.result, 'quantityConsumed');
}

function plural(quantity: number, singular: string, pluralForm = `${singular}s`): string {
  return `${quantity} ${quantity === 1 ? singular : pluralForm}`;
}

function number(value: unknown, key: string): number | undefined {
  const entry = fields(value)[key];
  return typeof entry === 'number' && Number.isFinite(entry) ? entry : undefined;
}

function array(value: unknown, key: string): unknown[] {
  const entry = fields(value)[key];
  return Array.isArray(entry) ? entry : [];
}

function plotIdList(preview: GardenCommandPreview): string[] {
  const fromPayload = array(preview.normalizedPayload, 'cellIds')
    .filter((id): id is string => typeof id === 'string');
  if (fromPayload.length) return fromPayload;
  const direct = text(preview.normalizedPayload, 'cellId');
  if (direct) return [direct];
  return array(preview, 'targets')
    .map((target) => text(target, 'cellId'))
    .filter((id): id is string => !!id);
}

function plotNames(ids: string[], options: GardenPreviewFeedbackOptions): string[] {
  return ids.map((id) => options.cellLabel?.(id)).filter((name): name is string => !!name);
}

function itemName(preview: GardenCommandPreview, options: GardenPreviewFeedbackOptions, key: string): string | undefined {
  const itemKey = text(preview.normalizedPayload, key);
  return itemKey ? options.itemName?.(itemKey) ?? displayName(itemKey) : undefined;
}

function targetChanges(
  preview: GardenCommandPreview,
  options: GardenPreviewFeedbackOptions,
  kind: 'water' | 'amend'
): { details: string[]; warnings: string[] } {
  const details: string[] = [];
  const warnings: string[] = [];

  for (const target of array(preview, 'targets')) {
    const id = text(target, 'cellId');
    const label = id ? options.cellLabel?.(id) : undefined;
    if (!label) continue;
    const before = fields(target).before;
    const after = fields(target).after;
    if (kind === 'water') {
      const moistureBefore = number(before, 'value') ?? (typeof before === 'number' ? before : undefined);
      const moistureAfter = number(after, 'value') ?? (typeof after === 'number' ? after : undefined);
      if (moistureBefore !== undefined && moistureAfter !== undefined) {
        details.push(moistureAfter > moistureBefore
          ? `${label}: soil moisture will increase.`
          : moistureAfter < moistureBefore
            ? `${label}: soil moisture will decrease.`
            : `${label}: soil moisture is already saturated; additional water may have little effect.`);
      }
      if (text(target, 'warning') === 'overwatering') {
        warnings.push(`${label}: additional water may leave the soil too wet for this plant.`);
      }
      continue;
    }

    const changed = (key: 'n' | 'p' | 'k' | 'quality') => {
      const from = number(before, key);
      const to = number(after, key);
      return from !== undefined && to !== undefined && from !== to;
    };
    const nutrientChanges = (['n', 'p', 'k'] as const).some(changed);
    const qualityChanges = changed('quality');
    if (nutrientChanges && qualityChanges) details.push(`${label}: soil nutrients and quality will change.`);
    else if (nutrientChanges) details.push(`${label}: soil nutrient levels will change.`);
    else if (qualityChanges) details.push(`${label}: soil quality will change.`);
    else if (number(before, 'n') !== undefined && number(after, 'n') !== undefined) {
      details.push(`${label}: no visible soil changes are expected.`);
    }
    if (text(target, 'warning') === 'nutrient-excess') {
      warnings.push(`${label}: the added nutrients may be too much for this plant.`);
    }
  }

  return { details, warnings };
}

/**
 * Turns the Garden RPC's authoritative planting, watering, and amendment
 * previews into player-facing copy without exposing its internal field names.
 */
export function gardenCommandPreviewFeedback(
  preview: GardenCommandPreview,
  options: GardenPreviewFeedbackOptions = {}
): GardenPreviewFeedback {
  const ids = plotIdList(preview);
  const names = plotNames(ids, options);
  const targetCount = count(preview, 'targetCount') ?? ids.length;
  const plots = plural(targetCount, 'plot');

  if (preview.commandKind === 'plant') {
    const seed = itemName(preview, options, 'seedItemKey');
    const target = names[0];
    return {
      summary: seed
        ? `Plant ${seed} in ${target ? `plot ${target}` : 'the selected plot'}.`
        : `Plant a seed in ${target ? `plot ${target}` : 'the selected plot'}.`,
      targets: names,
      details: []
    };
  }

  if (preview.commandKind === 'water') {
    const dose = number(preview, 'sameDosePerTarget') ?? number(preview.normalizedPayload, 'dose');
    const changes = targetChanges(preview, options, 'water');
    return {
      summary: dose === undefined
        ? `Water ${plots}.`
        : `Increase moisture by ${dose} per plot across ${plots}.`,
      targets: names,
      details: changes.details,
      ...(changes.warnings.length ? { resourceWarning: changes.warnings.join(' ') } : {})
    };
  }

  if (preview.commandKind === 'amend') {
    const amendment = itemName(preview, options, 'itemKey');
    const dose = number(preview, 'sameDosePerTarget') ?? number(preview.normalizedPayload, 'dose');
    const required = number(preview, 'resourceCost');
    const available = number(preview, 'available');
    const changes = targetChanges(preview, options, 'amend');
    const quantity = required ?? (dose === undefined ? undefined : dose * targetCount);
    const summary = dose !== undefined && quantity !== undefined
      ? `Apply ${amendment ?? 'fertilizer'} to ${plots}: ${plural(dose, 'unit')} per plot (${plural(quantity, 'unit')} total).`
      : `Fertilize ${plots}${amendment ? ` with ${amendment}` : ''}.`;
    const resourceWarning = preview.canCommit === false
      ? required !== undefined && available !== undefined
        ? `Need ${plural(required, 'unit')} of ${amendment ?? 'this amendment'}; ${plural(available, 'unit')} available.`
        : 'There is not enough amendment for every selected plot.'
      : changes.warnings.length ? changes.warnings.join(' ') : undefined;
    return {
      summary,
      targets: names,
      details: changes.details,
      ...(resourceWarning ? { resourceWarning } : {})
    };
  }

  return { summary: `Review the ${preview.commandKind.replaceAll('_', ' ')} action before applying it.`, targets: names, details: [] };
}

function targetsCopy(verb: string, receipt: ReceiptFields, options: GardenFeedbackOptions): string {
  const quantity = targetCount(receipt);
  const target = cell(receipt, options, 'cellId') ?? firstCell(receipt, options);
  if (quantity === 1 && target) return `${verb} ${target}`;
  if (quantity !== undefined) return `${verb} ${plural(quantity, 'plot')}`;
  return `${verb} selected plots`;
}

/**
 * Formats a short success announcement from a command receipt that has already
 * committed. It deliberately never treats submitted form input as confirmation.
 */
export function gardenSuccessFeedback(
  commandKind: GardenCommandKind,
  receipt: ReceiptFields,
  options: GardenFeedbackOptions = {}
): string {
  const target = cell(receipt, options, 'cellId');

  switch (commandKind) {
    case 'plant': {
      const plant = displayName(text(receipt.result, 'speciesKey'));
      return plant && target ? `Planted ${plant.toLowerCase()} in ${target}` : 'Planting complete';
    }
    case 'move': {
      const source = cell(receipt, options, 'sourceCellId');
      const destination = cell(receipt, options, 'targetCellId');
      return source && destination ? `Moved ${source} to ${destination}` : 'Move complete';
    }
    case 'remove': {
      const plant = displayName(text(receipt.result, 'speciesKey'));
      return plant && target ? `Removed ${plant.toLowerCase()} from ${target}` : 'Removal complete';
    }
    case 'water':
      return targetsCopy('Watered', receipt, options);
    case 'amend':
      return targetsCopy('Fertilized', receipt, options);
    case 'incorporate_clover':
      return target ? `Incorporated clover in ${target}` : 'Clover incorporated';
    case 'compost_ingredient': {
      const quantity = count(receipt.result, 'quantityConsumed');
      return quantity !== undefined && target
        ? `Composted ${plural(quantity, 'ingredient unit')} in ${target}`
        : 'Composting started';
    }
    case 'purchase':
      return 'Purchase complete';
    case 'expand': {
      const plots = count(receipt.result, 'plotCount');
      return plots !== undefined ? `Garden expanded to ${plural(plots, 'plot')}` : 'Garden expanded';
    }
  }
}

/** Formats concise, receipt-backed success copy for every Apiary command. */
export function apiarySuccessFeedback(
  commandKind: ApiaryCommandKind,
  receipt: ReceiptFields,
  options: GardenFeedbackOptions = {}
): string {
  switch (commandKind) {
    case 'install_hive': {
      const target = cell(receipt, options, 'cellId');
      return target ? `Installed hive at ${target}` : 'Hive installed';
    }
    case 'install_colony':
      return 'Installed colony';
    case 'feed': {
      const quantity = count(receipt.result, 'unitsConsumed');
      return quantity !== undefined ? `Fed colony ${plural(quantity, 'unit')}` : 'Colony fed';
    }
    case 'treat': {
      const problem = displayName(text(receipt.result, 'problem'));
      return problem ? `Started ${problem.toLowerCase()} treatment` : 'Treatment started';
    }
    case 'split':
      return 'Split colony into a new hive';
    case 'extract_honey': {
      const quantity = count(receipt.result, 'quantity');
      return quantity !== undefined ? `Extracted ${plural(quantity, 'honey unit')}` : 'Honey extracted';
    }
  }
}
