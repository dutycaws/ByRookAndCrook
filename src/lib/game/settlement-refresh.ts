export interface CoalescedRefreshOptions<T> {
  isTerminal(value: T): boolean;
  onValue(value: T): void;
  onError(error: unknown): void;
  onPendingChange(pending: boolean): void;
}

/** Serializes refresh requests and guarantees one trailing read for events received mid-flight. */
export function createSettlementRefreshQueue<T>(
  load: () => Promise<T | null>,
  options: CoalescedRefreshOptions<T>
) {
  let active = true;
  let terminal = false;
  let reading = false;
  let refreshAgain = false;
  let currentRun: Promise<void> | null = null;

  const refresh = (): Promise<void> => {
    if (!active || terminal) return Promise.resolve();
    if (reading) {
      refreshAgain = true;
      return currentRun ?? Promise.resolve();
    }

    reading = true;
    options.onPendingChange(true);
    currentRun = (async () => {
      do {
        refreshAgain = false;
        try {
          const value = await load();
          if (!active || !value) continue;
          if (options.isTerminal(value)) {
            terminal = true;
            refreshAgain = false;
          }
          options.onValue(value);
        } catch (error) {
          if (active) options.onError(error);
        }
      } while (active && !terminal && refreshAgain);
    })().finally(() => {
      reading = false;
      currentRun = null;
      if (active) options.onPendingChange(false);
      if (active && !terminal && refreshAgain) void refresh();
    });
    return currentRun;
  };

  return {
    refresh,
    dispose() {
      active = false;
      refreshAgain = false;
    }
  };
}
