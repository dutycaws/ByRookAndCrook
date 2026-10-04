<script lang="ts">
  import { setContext } from 'svelte';
  import SettlementInterlude from '$lib/components/tavern/SettlementInterlude.svelte';
  import { SETTLEMENT_USER_ID_CONTEXT } from '$lib/game/settlement-context';
  import type { SettlementBroadcastConnection, SettlementBroadcastSource } from '$lib/game/settlement-broadcast';
  import type { PublicSettlementStatus } from '$lib/game/evolving-world';

  setContext(SETTLEMENT_USER_ID_CONTEXT, () => 'settlement-probe-user');

  const settlement: PublicSettlementStatus = {
    id: '11111111-1111-4111-8111-111111111111',
    dayNumber: 2,
    status: 'processing',
    progress: { completed: 2, total: 8 },
    publicDigest: null,
    publicSummary: null,
    morningNews: null
  };
  let { data } = $props<{ data: { loadCount: number } }>();
  let channelCount = $state(0);
  let publishSettlementChanged: ((id: string) => void) | null = null;
  let updateConnection: ((connection: SettlementBroadcastConnection) => void) | null = null;

  const broadcastSource: SettlementBroadcastSource = (_userId, handlers) => {
    channelCount += 1;
    publishSettlementChanged = handlers.onSettlementChanged;
    updateConnection = handlers.onConnection;
    handlers.onConnection('connecting');
    queueMicrotask(() => handlers.onConnection('connected'));
    return () => {
      channelCount -= 1;
      publishSettlementChanged = null;
      updateConnection = null;
    };
  };

  function reconnect() {
    updateConnection?.('reconnecting');
    updateConnection?.('connected');
  }
</script>

<output data-testid="settlement-load-count">{data.loadCount}</output>
<SettlementInterlude {settlement} {broadcastSource} />
<section aria-label="Settlement broadcast test controls">
  <button data-testid="send-unrelated-settlement-change" onclick={() => publishSettlementChanged?.('22222222-2222-4222-8222-222222222222')}>Send unrelated update</button>
  <button data-testid="send-settlement-change" onclick={() => publishSettlementChanged?.(settlement.id)}>Send settlement update</button>
  <button data-testid="reconnect-settlement-channel" onclick={reconnect}>Reconnect channel</button>
  <output data-testid="settlement-channel-count">{channelCount}</output>
</section>
