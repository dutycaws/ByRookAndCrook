import type { ApiaryCommandKind, GardenCommandKind } from './contracts';

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
