<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { getContext, untrack } from 'svelte';
  import { createSettlementRefreshQueue } from '$lib/game/settlement-refresh';
  import {
    subscribeToSettlementBroadcast,
    type SettlementBroadcastConnection,
    type SettlementBroadcastSource
  } from '$lib/game/settlement-broadcast';
  import { SETTLEMENT_USER_ID_CONTEXT, type SettlementUserIdReader } from '$lib/game/settlement-context';
  import type { PublicSettlementStatus } from '$lib/game/evolving-world';

  export type { PublicSettlementStatus as SettlementInterludeData } from '$lib/game/evolving-world';

  let {
    settlement,
    broadcastSource
  }: {
    settlement: PublicSettlementStatus | null;
    broadcastSource?: SettlementBroadcastSource;
  } = $props();
  const readUserId = getContext<SettlementUserIdReader | undefined>(SETTLEMENT_USER_ID_CONTEXT);
  let polledSettlement = $state<PublicSettlementStatus | null>(null);
  let waiting = $state(false);
  let connection = $state<SettlementBroadcastConnection>('connecting');
  let readError = $state(false);
  let revalidationError = $state(false);
  let revalidating = $state(false);
  let refreshActiveSettlement: () => Promise<void> = () => Promise.resolve();

  const pollable = (status: PublicSettlementStatus['status'] | undefined) => status === 'queued' || status === 'processing';
  const terminal = (status: PublicSettlementStatus['status'] | undefined) => status === 'completed' || status === 'unavailable';
  let current = $derived(terminal(settlement?.status)
    ? settlement
    : polledSettlement?.id === settlement?.id ? polledSettlement : settlement);
  let currentId = $derived(current?.id ?? null);
  let currentStatus = $derived(current?.status);
  const statusCopy = (status: PublicSettlementStatus['status']) => {
    if (status === 'queued') return 'The night is settling';
    if (status === 'processing') return 'The world is turning';
    if (status === 'completed') return 'A new day has dawned';
    if (status === 'unavailable') return 'Overnight report unavailable';
    return 'The morning’s record is complete';
  };
  const statusDetail = (status: PublicSettlementStatus['status']) => {
    if (status === 'queued') return 'Your regulars are following their plans after the doors close.';
    if (status === 'processing') return 'Stories beyond the tavern are finding their next chapter.';
    if (status === 'completed') return 'The tavern journal has been refreshed with what became known overnight.';
    if (status === 'unavailable') return 'Your saved tavern progress remains safe, but overnight details could not be loaded.';
    return 'The overnight update is complete. Your regulars are back at the common room.';
  };
  const progressLabel = (progress: PublicSettlementStatus['progress']) => progress.total > 0
    ? `${Math.min(progress.completed, progress.total)} of ${progress.total} moments settled`
    : 'Gathering the morning’s news';
  const connectionDetail = (state: SettlementBroadcastConnection) => {
    if (state === 'connected') return 'Connected to overnight updates.';
    if (state === 'reconnecting') return 'Connection lost. Reconnecting to overnight updates…';
    if (state === 'signed_out') return 'Your session ended. Sign in again to receive overnight updates.';
    return 'Connecting to overnight updates…';
  };

  function readSettlement(value: unknown, expectedId: string): PublicSettlementStatus | null {
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
    const candidate = record?.settlement && typeof record.settlement === 'object' && !Array.isArray(record.settlement)
      ? record.settlement as Record<string, unknown> : record;
    if (!candidate || candidate.id !== expectedId || !Number.isSafeInteger(candidate.dayNumber)
      || !['queued', 'processing', 'completed', 'unavailable'].includes(String(candidate.status))
      || typeof candidate.publicDigest !== 'string' && candidate.publicDigest !== null
      || typeof candidate.publicSummary !== 'string' && candidate.publicSummary !== null
      || typeof candidate.morningNews !== 'string' && candidate.morningNews !== null) return null;
    const progressValue = candidate.progress;
    const progress = progressValue && typeof progressValue === 'object' && !Array.isArray(progressValue)
      && Number.isSafeInteger((progressValue as Record<string, unknown>).completed)
      && Number.isSafeInteger((progressValue as Record<string, unknown>).total)
      ? { completed: Math.max(0, Number((progressValue as Record<string, unknown>).completed)), total: Math.max(0, Number((progressValue as Record<string, unknown>).total)) }
      : null;
    if (!progress) return null;
    return {
      id: candidate.id,
      dayNumber: candidate.dayNumber as number,
      status: candidate.status as PublicSettlementStatus['status'],
      publicDigest: typeof candidate.publicDigest === 'string' && candidate.publicDigest.trim() ? candidate.publicDigest.trim() : null,
      publicSummary: typeof candidate.publicSummary === 'string' && candidate.publicSummary.trim() ? candidate.publicSummary.trim() : null,
      morningNews: typeof candidate.morningNews === 'string' && candidate.morningNews.trim() ? candidate.morningNews.trim() : null,
      progress
    };
  }

  async function refreshSettlement(settlementId: string): Promise<PublicSettlementStatus | null> {
    const response = await fetch(`/api/world-settlements/${encodeURIComponent(settlementId)}`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Settlement refresh failed with ${response.status}.`);
    return readSettlement(await response.json(), settlementId);
  }

  $effect(() => {
    const settlementId = currentId;
    const status = currentStatus;
    const userId = readUserId?.() ?? null;
    if (!settlementId || !pollable(status) || typeof document === 'undefined') return;
    if (!userId) {
      connection = 'signed_out';
      return;
    }

    waiting = false;
    const source = broadcastSource ?? subscribeToSettlementBroadcast;
    let active = true;
    let stopChannel: (() => void) | undefined;
    let stopRequested = false;
    let queue: ReturnType<typeof createSettlementRefreshQueue<PublicSettlementStatus>> | null = null;
    const stop = () => {
      if (stopChannel) {
        const cleanup = stopChannel;
        stopChannel = undefined;
        cleanup();
      } else {
        stopRequested = true;
      }
    };

    connection = 'connecting';
    readError = false;
    queue = createSettlementRefreshQueue(
      () => refreshSettlement(settlementId),
      {
        isTerminal: (next) => terminal(next.status),
        onValue: (next) => {
          if (!active || next.id !== settlementId) return;
          polledSettlement = next;
          readError = false;
          if (terminal(next.status)) {
            revalidationError = false;
            stop();
            queue?.dispose();
            void invalidateAll().catch(() => { revalidationError = true; });
          }
        },
        onError: () => { if (active) readError = true; },
        onPendingChange: (pending) => { if (active) waiting = pending; }
      }
    );
    const requestRefresh = () => queue?.refresh() ?? Promise.resolve();
    refreshActiveSettlement = requestRefresh;

    const handleConnection = (next: SettlementBroadcastConnection) => {
      if (!active) return;
      connection = next;
      // A read after every successful join closes the gap between the initial
      // status load and the moment the private channel becomes active.
      if (next === 'connected') void requestRefresh();
    };
    const handleSettlementChanged = (changedId: string) => {
      if (active && changedId === settlementId) void requestRefresh();
    };
    stopChannel = untrack(() => source(userId, {
      onSettlementChanged: handleSettlementChanged,
      onConnection: handleConnection
    }));
    if (stopRequested) stop();

    const refreshWhenVisible = () => {
      if (active && !document.hidden) void requestRefresh();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      active = false;
      waiting = false;
      queue?.dispose();
      stop();
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      if (refreshActiveSettlement === requestRefresh) refreshActiveSettlement = () => Promise.resolve();
    };
  });

  async function checkForMorning() {
    await refreshActiveSettlement();
  }

  async function refreshTavern() {
    revalidating = true;
    revalidationError = false;
    try {
      await invalidateAll();
    } catch {
      revalidationError = true;
    } finally {
      revalidating = false;
    }
  }
</script>

{#if current}
  <section class:active={pollable(current.status)} class="settlement-interlude" aria-labelledby="settlement-title" aria-live={pollable(current.status) ? 'polite' : 'off'} data-settlement-state={current.status}>
    <div class="settlement-crest" aria-hidden="true">✦</div>
    <div class="settlement-copy">
      <p class="eyebrow">Tavern day {current.dayNumber} · overnight journal</p>
      <h2 id="settlement-title">{statusCopy(current.status)}</h2>
      <p>{statusDetail(current.status)}</p>
      {#if pollable(current.status)}
        <div class="settlement-progress"><div class="settlement-progress-track" aria-hidden="true"><span style:width={`${current.progress && current.progress.total > 0 ? Math.min(100, Math.max(4, current.progress.completed / current.progress.total * 100)) : 20}%`}></span></div><span>{progressLabel(current.progress)}</span></div>
        <p class="settlement-helper" role={connection === 'signed_out' ? 'alert' : 'status'}>{connectionDetail(connection)}</p>
        {#if readError}<p class="settlement-helper" role="alert">The latest morning update could not be loaded. Check again when you’re ready.</p>{/if}
        <button class="settlement-retry" type="button" onclick={checkForMorning} disabled={waiting}>{waiting ? 'Checking…' : 'Check for morning'}</button>
      {:else}
        {#if current.morningNews}<div class="morning-news"><strong>Morning news</strong><p>{current.morningNews}</p></div>{/if}
        {#if current.publicSummary || current.publicDigest}<div class="morning-summary"><strong>What the keeper learns</strong><p>{current.publicSummary ?? current.publicDigest}</p></div>{/if}
        {#if revalidationError}<p class="settlement-helper" role="alert">Morning is ready, but the tavern journal could not be refreshed.</p><button class="settlement-retry" type="button" onclick={refreshTavern} disabled={revalidating}>{revalidating ? 'Refreshing…' : 'Refresh tavern'}</button>{/if}
      {/if}
    </div>
  </section>
{/if}

<style>
  .settlement-interlude { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 1rem; align-items: start; margin: 1rem 0; padding: clamp(1rem, 2vw, 1.5rem); border: 1px solid #78602c; background: radial-gradient(circle at 90% 0%, rgb(193 144 43 / .19), transparent 14rem), linear-gradient(115deg, #282011, #100d07); box-shadow: inset 0 0 0 1px rgb(247 218 144 / .06), 0 12px 30px rgb(0 0 0 / .18); }
  .settlement-interlude.active { border-color: #9b7b38; }.settlement-crest { display: grid; width: 3rem; height: 3rem; place-items: center; border: 1px solid #9e7b34; border-radius: 50%; color: #f3d77d; background: #241a09; box-shadow: 0 0 0 4px rgb(229 191 93 / .06); font-size: 1.25rem; }
  .settlement-copy h2 { margin: .1rem 0 .25rem; color: #f0d27a; font-family: 'Cinzel', serif; font-size: clamp(1.25rem, 2.5vw, 1.7rem); }.settlement-copy > p:not(.eyebrow) { max-width: 52rem; margin: 0; color: #c9b68a; font-size: 1.08rem; }.settlement-progress { display: grid; grid-template-columns: minmax(8rem, 18rem) auto; gap: .65rem; align-items: center; margin-top: .9rem; color: #d7c087; font-size: .92rem; }.settlement-progress-track { height: .45rem; overflow: hidden; border: 1px solid #675124; background: #0c0905; }.settlement-progress-track span { display: block; height: 100%; background: linear-gradient(90deg, #9e7530, #e8c969, #8fb06d); transition: width 450ms ease; }.settlement-helper { margin: .75rem 0 0; color: #a89468; font-size: .94rem; }.settlement-retry { margin-top: .55rem; border: 1px solid #9e7b34; padding: .45rem .75rem; color: #f0d27a; background: #241a09; cursor: pointer; }.settlement-retry:hover:not(:disabled), .settlement-retry:focus-visible { background: #3b2a0c; outline: 2px solid #f0d27a; outline-offset: 2px; }.settlement-retry:disabled { opacity: .7; cursor: wait; }.morning-news, .morning-summary { margin-top: .85rem; padding: .75rem .85rem; border-left: 2px solid #92ae70; background: rgb(22 32 15 / .62); }.morning-summary { border-color: #bd9141; background: rgb(45 31 10 / .5); }.morning-news strong, .morning-summary strong { color: #e7c873; font-family: 'Cinzel', serif; font-size: .76rem; letter-spacing: .06em; text-transform: uppercase; }.morning-news p, .morning-summary p { margin: .3rem 0 0; color: #ddd0ad; }
  @media (max-width: 600px) { .settlement-interlude { grid-template-columns: 1fr; gap: .7rem; }.settlement-crest { width: 2.5rem; height: 2.5rem; }.settlement-progress { grid-template-columns: 1fr; gap: .35rem; } }
  @media (prefers-reduced-motion: reduce) { .settlement-progress-track span { transition: none; } }
</style>
