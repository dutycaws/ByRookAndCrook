import { describe, expect, it, vi } from 'vitest';
import { createSettlementRefreshQueue } from '$lib/game/settlement-refresh';

interface Receipt { id: string; status: 'processing' | 'completed' }

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('settlement refresh queue', () => {
  it('coalesces mid-flight notifications into one trailing read and stops on terminal data', async () => {
    const reads: Array<ReturnType<typeof deferred<Receipt | null>>> = [];
    const load = vi.fn(() => {
      const next = deferred<Receipt | null>();
      reads.push(next);
      return next.promise;
    });
    const values: string[] = [];
    const pending: boolean[] = [];
    const queue = createSettlementRefreshQueue(load, {
      isTerminal: (value) => value.status === 'completed',
      onValue: (value) => values.push(value.status),
      onError: vi.fn(),
      onPendingChange: (value) => pending.push(value)
    });

    const run = queue.refresh();
    void queue.refresh();
    void queue.refresh();
    expect(load).toHaveBeenCalledTimes(1);

    reads[0].resolve({ id: 'settlement-1', status: 'processing' });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    reads[1].resolve({ id: 'settlement-1', status: 'completed' });
    await run;

    expect(values).toEqual(['processing', 'completed']);
    expect(pending).toEqual([true, false]);
    await queue.refresh();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('discards a response after the owning interlude is disposed', async () => {
    const response = deferred<Receipt | null>();
    const onValue = vi.fn();
    const queue = createSettlementRefreshQueue(() => response.promise, {
      isTerminal: (value) => value.status === 'completed',
      onValue,
      onError: vi.fn(),
      onPendingChange: vi.fn()
    });

    const run = queue.refresh();
    queue.dispose();
    response.resolve({ id: 'stale-settlement', status: 'completed' });
    await run;

    expect(onValue).not.toHaveBeenCalled();
  });
});
