import { describe, expect, it } from 'vitest';
import { apiarySuccessFeedback, gardenSuccessFeedback } from '../../src/lib/game/garden-feedback';

const labels: Record<string, string> = {
  'cell-11': 'C11',
  'cell-3': 'C3',
  'cell-5': 'C5'
};
const options = { cellLabel: (cellId: string) => labels[cellId] };

describe('confirmed Garden feedback', () => {
  it('uses the authoritative receipt fields for every Garden command', () => {
    expect(gardenSuccessFeedback('plant', {
      normalizedPayload: { cellId: 'cell-11' }, result: { cellId: 'cell-11', speciesKey: 'pepper' }
    }, options)).toBe('Planted pepper in C11');
    expect(gardenSuccessFeedback('move', {
      normalizedPayload: { sourceCellId: 'cell-3', targetCellId: 'cell-5' },
      result: { sourceCellId: 'cell-3', targetCellId: 'cell-5' }
    }, options)).toBe('Moved C3 to C5');
    expect(gardenSuccessFeedback('remove', {
      normalizedPayload: { cellId: 'cell-11' }, result: { cellId: 'cell-11', speciesKey: 'clover' }
    }, options)).toBe('Removed clover from C11');
    expect(gardenSuccessFeedback('water', {
      normalizedPayload: { cellIds: ['cell-11'] }, result: { targetCount: 1, cellId: 'cell-11' }
    }, options)).toBe('Watered C11');
    expect(gardenSuccessFeedback('water', {
      normalizedPayload: { cellIds: ['cell-11'] }, result: { targetCount: 1 }
    }, options)).toBe('Watered C11');
    expect(gardenSuccessFeedback('amend', {
      normalizedPayload: { cellIds: ['cell-3', 'cell-5'] }, result: { targetCount: 2 }
    }, options)).toBe('Fertilized 2 plots');
    expect(gardenSuccessFeedback('incorporate_clover', {
      normalizedPayload: { cellId: 'cell-11' }, result: { cellId: 'cell-11' }
    }, options)).toBe('Incorporated clover in C11');
    expect(gardenSuccessFeedback('compost_ingredient', {
      normalizedPayload: { cellId: 'cell-11' }, result: { cellId: 'cell-11', quantityConsumed: 2 }
    }, options)).toBe('Composted 2 ingredient units in C11');
    expect(gardenSuccessFeedback('purchase', {
      normalizedPayload: { itemKey: 'pepper_seed', quantity: 2 }, result: { itemKey: 'pepper_seed', quantity: 2 }
    }, options)).toBe('Purchase complete');
    expect(gardenSuccessFeedback('expand', {
      normalizedPayload: { plotCount: 16 }, result: { plotCount: 16 }
    }, options)).toBe('Garden expanded to 16 plots');
  });

  it('uses factual fallbacks when a receipt omits optional presentation data', () => {
    expect(gardenSuccessFeedback('water', {
      normalizedPayload: {}, result: { targetCount: 2 }
    })).toBe('Watered 2 plots');
    expect(gardenSuccessFeedback('plant', {
      normalizedPayload: {}, result: {}
    })).toBe('Planting complete');
    expect(gardenSuccessFeedback('plant', {
      normalizedPayload: { cellId: 'private-uuid' }, result: { cellId: 'private-uuid', speciesKey: 'pepper' }
    })).toBe('Planting complete');
  });
});

describe('confirmed Apiary feedback', () => {
  it('uses the authoritative receipt fields for every Apiary command', () => {
    expect(apiarySuccessFeedback('install_hive', {
      normalizedPayload: { cellId: 'cell-11' }, result: { cellId: 'cell-11' }
    }, options)).toBe('Installed hive at C11');
    expect(apiarySuccessFeedback('install_colony', {
      normalizedPayload: { hiveId: 'hive-1' }, result: { colonyId: 'colony-1' }
    })).toBe('Installed colony');
    expect(apiarySuccessFeedback('feed', {
      normalizedPayload: { colonyId: 'colony-1', quantity: 2 }, result: { unitsConsumed: 2 }
    })).toBe('Fed colony 2 units');
    expect(apiarySuccessFeedback('treat', {
      normalizedPayload: { colonyId: 'colony-1' }, result: { problem: 'varroa' }
    })).toBe('Started varroa treatment');
    expect(apiarySuccessFeedback('split', {
      normalizedPayload: { sourceColonyId: 'colony-1' }, result: { newColonyId: 'colony-2' }
    })).toBe('Split colony into a new hive');
    expect(apiarySuccessFeedback('extract_honey', {
      normalizedPayload: { colonyId: 'colony-1', quantity: 2 }, result: { quantity: 2 }
    })).toBe('Extracted 2 honey units');
  });
});
