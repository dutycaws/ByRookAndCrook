import { afterEach, describe, expect, it, vi } from 'vitest';

const startPortraitGenerationWorker = vi.fn();
const startWorldSettlementWorker = vi.fn();

vi.mock('$lib/server/community-npc-jobs/portrait-service', () => ({ startPortraitGenerationWorker }));
vi.mock('$lib/server/evolving-world/settlement-worker', () => ({ startWorldSettlementWorker }));

afterEach(() => {
  delete process.env.WORLD_SETTLEMENT_WORKER_MODE;
  startPortraitGenerationWorker.mockClear();
  startWorldSettlementWorker.mockClear();
  vi.resetModules();
});

describe('server worker bootstrap', () => {
  it('keeps the in-process settlement worker for a direct app start', async () => {
    await import('../../src/hooks.server');

    expect(startPortraitGenerationWorker).toHaveBeenCalledOnce();
    expect(startWorldSettlementWorker).toHaveBeenCalledOnce();
  });

  it('leaves settlement work to the supervised external process', async () => {
    process.env.WORLD_SETTLEMENT_WORKER_MODE = 'external';

    await import('../../src/hooks.server');

    expect(startPortraitGenerationWorker).toHaveBeenCalledOnce();
    expect(startWorldSettlementWorker).not.toHaveBeenCalled();
  });
});
