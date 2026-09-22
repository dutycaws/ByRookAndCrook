import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SettlementInterlude, {
  nextSettlementPoll,
  SETTLEMENT_POLL_LIMIT
} from '$lib/components/tavern/SettlementInterlude.svelte';
import type { PublicSettlementStatus } from '$lib/game/evolving-world';

const id = '11111111-1111-4111-8111-111111111111';

function settlement(overrides: Partial<PublicSettlementStatus> = {}): PublicSettlementStatus {
  return {
    id,
    dayNumber: 4,
    status: 'processing',
    progress: { completed: 2, total: 5 },
    publicDigest: null,
    publicSummary: null,
    morningNews: null,
    ...overrides
  };
}

describe('SettlementInterlude', () => {
  it('renders a calm active settlement state with qualitative progress', () => {
    const { body } = render(SettlementInterlude, { props: { settlement: settlement() } });
    expect(body).toContain('The world is turning');
    expect(body).toContain('2 of 5 moments settled');
    expect(body).not.toContain('provider');
    expect(body).not.toContain('saveId');
  });

  it('renders only safe terminal public text', () => {
    const { body } = render(SettlementInterlude, {
      props: { settlement: settlement({ status: 'completed', publicSummary: 'Mara returned with a safe road rumor.', morningNews: 'The north road is clear at dawn.' }) }
    });
    expect(body).toContain('A new day has dawned');
    expect(body).toContain('Mara returned with a safe road rumor.');
    expect(body).toContain('The north road is clear at dawn.');
    expect(body).not.toContain(id);
  });

  it('caps repeated scheduling across response replacements and pauses while hidden', () => {
    let state: { settlementId: string | null; count: number } = { settlementId: id, count: 0 };
    for (let index = 0; index < SETTLEMENT_POLL_LIMIT; index += 1) {
      const instruction = nextSettlementPoll(state, id, true);
      expect(instruction.shouldSchedule).toBe(true);
      state = { settlementId: instruction.settlementId, count: instruction.count };
    }
    expect(nextSettlementPoll(state, id, true)).toEqual({ settlementId: id, count: SETTLEMENT_POLL_LIMIT, shouldSchedule: false, delayed: true });
    expect(nextSettlementPoll(state, id, false)).toEqual({ settlementId: id, count: SETTLEMENT_POLL_LIMIT, shouldSchedule: false, delayed: false });
    expect(nextSettlementPoll(state, '22222222-2222-4222-8222-222222222222', true)).toEqual({ settlementId: '22222222-2222-4222-8222-222222222222', count: 1, shouldSchedule: true, delayed: false });
  });
});
