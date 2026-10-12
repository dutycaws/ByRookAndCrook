import { describe, expect, it } from 'vitest';
import { finishCommittedGardenAction } from '../../src/lib/components/garden/committed-action-lifecycle';

describe('committed Garden action lifecycle', () => {
  it('keeps the submitted action active until the refreshed plot can replace its card', async () => {
    const events: string[] = [];

    await finishCommittedGardenAction({
      playBurn: async () => { events.push('burn-confirmed-card'); },
      refreshSnapshot: async () => {
        events.push('refresh-started');
        await Promise.resolve();
        events.push('fresh-plot-loaded');
      },
      returnToUpdatedPlot: () => { events.push('clear-action-and-return-to-root'); }
    });

    expect(events).toEqual([
      'burn-confirmed-card',
      'refresh-started',
      'fresh-plot-loaded',
      'clear-action-and-return-to-root'
    ]);
  });

  it('does not clear the submitted action when the snapshot refresh fails', async () => {
    let returnedToPlot = false;

    await expect(finishCommittedGardenAction({
      playBurn: async () => undefined,
      refreshSnapshot: async () => { throw new Error('offline'); },
      returnToUpdatedPlot: () => { returnedToPlot = true; }
    })).rejects.toThrow('offline');

    expect(returnedToPlot).toBe(false);
  });
});
