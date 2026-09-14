import { describe, expect, it } from 'vitest';
import { parseGeneratedSupplies } from '../../src/lib/server/evolving-world/generated-supplies';

const entityId = '18181818-1818-4181-8181-181818181818';
const questId = '28282828-2828-4282-8282-282828282828';
const projection = () => ({ version:'generated-shop-v1', catalog:[{ entityId, itemKey:'road-provisions', name:'Road provisions', price:12, dailyStock:3, remainingStock:2 }], inventory:[{ entityId, itemKey:'road-provisions', name:'Road provisions', quantity:1 }], successorQuest:{ questId, state:'active', suppliesUsed:1, summary:'Supplies can be prepared for this successor quest.' } });

describe('generated supply projection', () => {
  it('accepts only the bounded player-facing catalog, inventory, and quest fields', () => {
    expect(parseGeneratedSupplies(projection())).toMatchObject({ version:'generated-shop-v1', successorQuest:{ questId, suppliesUsed:1 } });
  });
  it('rejects private canonical mechanics and malformed finite values', () => {
    expect(() => parseGeneratedSupplies({ ...projection(), catalog:[{ ...projection().catalog[0], canonicalPayload:{} }] })).toThrow('Invalid generated supply catalog item');
    expect(() => parseGeneratedSupplies({ ...projection(), successorQuest:{ ...projection().successorQuest, payload:{} } })).toThrow('Invalid successor quest projection');
    expect(() => parseGeneratedSupplies({ ...projection(), catalog:[{ ...projection().catalog[0], remainingStock:11 }] })).toThrow('Invalid generated supply catalog item');
  });
});
