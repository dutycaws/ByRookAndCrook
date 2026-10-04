import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SettlementInterlude from '$lib/components/tavern/SettlementInterlude.svelte';
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
    expect(body).toContain('Check for morning');
    expect(body).toContain('Connecting to overnight updates');
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

});
