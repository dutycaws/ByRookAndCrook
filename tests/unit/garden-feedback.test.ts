import { describe, expect, it } from 'vitest';
import { apiarySuccessFeedback, gardenCommandPreviewFeedback, gardenSuccessFeedback } from '../../src/lib/game/garden-feedback';

const labels: Record<string, string> = {
  'cell-11': 'C11',
  'cell-3': 'C3',
  'cell-5': 'C5'
};
const options = { cellLabel: (cellId: string) => labels[cellId] };

describe('Garden action preview feedback', () => {
  const previewOptions = {
    ...options,
    itemName: (itemKey: string) => ({ pumpkin_seed: 'Pumpkin Seeds', soil_blend: 'Soil Blend' })[itemKey]
  };

  it('describes planting with the selected seed and plot names', () => {
    expect(gardenCommandPreviewFeedback({
      commandKind: 'plant', basedOnRevision: 4, rulesVersion: 'garden-v1',
      normalizedPayload: { cellId: 'cell-11', seedItemKey: 'pumpkin_seed' },
      requiresAuthoritativeValidation: true
    }, previewOptions)).toEqual({
      summary: 'Plant Pumpkin Seeds in plot C11.', targets: ['C11'], details: []
    });
  });

  it('summarizes watering dose, moisture changes, and a translated care warning', () => {
    expect(gardenCommandPreviewFeedback({
      commandKind: 'water', basedOnRevision: 4, rulesVersion: 'garden-v1',
      normalizedPayload: { cellIds: ['cell-11', 'cell-5'], dose: 7 },
      sameDosePerTarget: 7, targetCount: 2, resourceCost: 0, canCommit: true,
      targets: [
        { cellId: 'cell-11', before: 32, after: 39, warning: null },
        { cellId: 'cell-5', before: 83, after: 90, warning: 'overwatering' }
      ]
    }, previewOptions)).toEqual({
      summary: 'Increase moisture by 7 per plot across 2 plots.',
      targets: ['C11', 'C5'],
      details: ['C11: soil moisture will increase.', 'C5: soil moisture will increase.'],
      resourceWarning: "C5: additional water may leave the soil too wet for this plant."
    });
  });

  it('shows amendment quantities, soil changes, and missing inventory in player language', () => {
    expect(gardenCommandPreviewFeedback({
      commandKind: 'amend', basedOnRevision: 4, rulesVersion: 'garden-v1',
      normalizedPayload: { cellIds: ['cell-3', 'cell-5'], itemKey: 'soil_blend', dose: 2 },
      itemKey: 'soil_blend', sameDosePerTarget: 2, targetCount: 2,
      resourceCost: 4, available: 3, canCommit: false,
      targets: [{
        cellId: 'cell-3', before: { n: 10, p: 20, k: 30, quality: 40 },
        after: { n: 14, p: 22, k: 33, quality: 42 }, warning: 'nutrient-excess'
      }]
    }, previewOptions)).toEqual({
      summary: 'Apply Soil Blend to 2 plots: 2 units per plot (4 units total).',
      targets: ['C3', 'C5'],
      details: ['C3: soil nutrients and quality will change.'],
      resourceWarning: 'Need 4 units of Soil Blend; 3 units available.'
    });
    expect(gardenCommandPreviewFeedback({
      commandKind: 'amend', basedOnRevision: 4, rulesVersion: 'garden-v1',
      normalizedPayload: { cellIds: ['cell-3'], itemKey: 'soil_blend', dose: 1 },
      sameDosePerTarget: 1, targetCount: 1, resourceCost: 1, available: 3, canCommit: true,
      targets: [{ cellId: 'cell-3', before: { n: 10 }, after: { n: 14 }, warning: null }]
    }, previewOptions).summary).toContain('1 unit per plot (1 unit total)');
  });

  it('translates excessive amendment warnings when inventory is sufficient', () => {
    const result = gardenCommandPreviewFeedback({
      commandKind: 'amend', basedOnRevision: 4, rulesVersion: 'garden-v1',
      normalizedPayload: { cellIds: ['cell-3'], itemKey: 'soil_blend', dose: 1 },
      sameDosePerTarget: 1, targetCount: 1, resourceCost: 1, available: 3, canCommit: true,
      targets: [{ cellId: 'cell-3', before: { n: 10 }, after: { n: 14 }, warning: 'nutrient-excess' }]
    }, previewOptions);

    expect(result.details).toEqual(['C3: soil nutrient levels will change.']);
    expect(result.resourceWarning).toBe('C3: the added nutrients may be too much for this plant.');
    expect(JSON.stringify(result)).not.toMatch(/\d+%|→|nutrient-excess|requiresAuthoritativeValidation/i);
  });
});

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
