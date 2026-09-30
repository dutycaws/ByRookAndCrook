<script module lang="ts">
  export const SETTLEMENT_POLL_LIMIT = 30;

  export function nextSettlementPoll(
    previous: { settlementId: string | null; count: number },
    settlementId: string | null,
    visible: boolean
  ): { settlementId: string | null; count: number; shouldSchedule: boolean; delayed: boolean } {
    const count = previous.settlementId === settlementId ? previous.count : 0;
    if (!settlementId || !visible) return { settlementId, count, shouldSchedule: false, delayed: false };
    if (count >= SETTLEMENT_POLL_LIMIT) return { settlementId, count, shouldSchedule: false, delayed: true };
    return { settlementId, count: count + 1, shouldSchedule: true, delayed: false };
  }
</script>

<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PublicSettlementStatus } from '$lib/game/evolving-world';

  export type { PublicSettlementStatus as SettlementInterludeData } from '$lib/game/evolving-world';

  let { settlement }: { settlement: PublicSettlementStatus | null } = $props();
  let polledSettlement = $state<PublicSettlementStatus | null>(null);
  let current = $derived(polledSettlement ?? settlement);
  let waiting = $state(false);
  let delayed = $state(false);
  let pollingSettlementId: string | null = null;
  let pollCount = 0;

  const pollable = (status: PublicSettlementStatus['status'] | undefined) => status === 'queued' || status === 'processing';
  const terminal = (status: PublicSettlementStatus['status'] | undefined) => status === 'completed' || status === 'unavailable';
  const statusCopy = (status: PublicSettlementStatus['status']) => {
    if (status === 'queued') return 'The night is settling';
    if (status === 'processing') return 'The world is turning';
    if (status === 'completed') return 'A new day has dawned';
    if (status === 'unavailable') return 'The tavern is ready';
    return 'The morning is ready';
  };
  const statusDetail = (status: PublicSettlementStatus['status']) => {
    if (status === 'queued') return 'Your regulars are following their plans after the doors close.';
    if (status === 'processing') return 'Stories beyond the tavern are finding their next chapter.';
    if (status === 'completed') return 'The tavern journal has been refreshed with what became known overnight.';
    if (status === 'unavailable') return 'The tavern is ready for the day ahead.';
    return 'The tavern is ready for the day ahead.';
  };
  const progressLabel = (progress: PublicSettlementStatus['progress']) => progress.total > 0
    ? `${Math.min(progress.completed, progress.total)} of ${progress.total} moments settled`
    : 'Gathering the morning’s news';

  function readSettlement(value: unknown): PublicSettlementStatus | null {
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
    const candidate = record?.settlement && typeof record.settlement === 'object' && !Array.isArray(record.settlement)
      ? record.settlement as Record<string, unknown> : record;
    if (!candidate || typeof candidate.id !== 'string' || !Number.isSafeInteger(candidate.dayNumber)
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

  $effect(() => {
    if (settlement?.id !== pollingSettlementId) {
      pollingSettlementId = settlement?.id ?? null;
      pollCount = 0;
      delayed = false;
      polledSettlement = null;
    }
  });

  $effect(() => {
    if (!current || !pollable(current.status) || typeof document === 'undefined') return;
    let timeout: number | undefined;
    let stopped = false;
    const clear = () => { if (timeout) window.clearTimeout(timeout); timeout = undefined; };
    const schedule = () => {
      clear();
      if (stopped || document.hidden || !current || !pollable(current.status)) return;
      const instruction = nextSettlementPoll({ settlementId: pollingSettlementId, count: pollCount }, current.id, !document.hidden);
      pollCount = instruction.count;
      if (!instruction.shouldSchedule) { delayed = instruction.delayed; return; }
      timeout = window.setTimeout(check, 1_500);
    };
    const check = async () => {
      if (stopped || document.hidden || !current || !pollable(current.status)) return;
      waiting = true;
      try {
        const response = await fetch(`/api/world-settlements/${encodeURIComponent(current.id)}`, { headers: { accept: 'application/json' } });
        if (response.ok) {
          const next = readSettlement(await response.json());
          if (next) polledSettlement = next;
          if (next && terminal(next.status)) await invalidateAll();
        }
      } catch {
        // Keep the player-facing state calm. A later poll can recover the view.
      } finally {
        waiting = false;
        schedule();
      }
    };
    const visibility = () => { if (!document.hidden) schedule(); else clear(); };
    document.addEventListener('visibilitychange', visibility);
    schedule();
    return () => { stopped = true; clear(); document.removeEventListener('visibilitychange', visibility); };
  });
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
        {#if delayed}<p class="settlement-helper">The night is taking longer than usual. You can leave this page open; the journal will refresh when morning is ready.</p>{:else if waiting}<p class="settlement-helper">Listening for the morning’s news…</p>{/if}
      {:else}
        {#if current.morningNews}<div class="morning-news"><strong>Morning news</strong><p>{current.morningNews}</p></div>{/if}
        {#if current.publicSummary || current.publicDigest}<div class="morning-summary"><strong>What the keeper learns</strong><p>{current.publicSummary ?? current.publicDigest}</p></div>{/if}
        {#if current.status === 'unavailable'}<p class="settlement-helper">The tavern opened without a new report. Your existing stories and progress remain safe.</p>{/if}
      {/if}
    </div>
  </section>
{/if}

<style>
  .settlement-interlude { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 1rem; align-items: start; margin: 1rem 0; padding: clamp(1rem, 2vw, 1.5rem); border: 1px solid #78602c; background: radial-gradient(circle at 90% 0%, rgb(193 144 43 / .19), transparent 14rem), linear-gradient(115deg, #282011, #100d07); box-shadow: inset 0 0 0 1px rgb(247 218 144 / .06), 0 12px 30px rgb(0 0 0 / .18); }
  .settlement-interlude.active { border-color: #9b7b38; }.settlement-crest { display: grid; width: 3rem; height: 3rem; place-items: center; border: 1px solid #9e7b34; border-radius: 50%; color: #f3d77d; background: #241a09; box-shadow: 0 0 0 4px rgb(229 191 93 / .06); font-size: 1.25rem; }
  .settlement-copy h2 { margin: .1rem 0 .25rem; color: #f0d27a; font-family: 'Cinzel', serif; font-size: clamp(1.25rem, 2.5vw, 1.7rem); }.settlement-copy > p:not(.eyebrow) { max-width: 52rem; margin: 0; color: #c9b68a; font-size: 1.08rem; }.settlement-progress { display: grid; grid-template-columns: minmax(8rem, 18rem) auto; gap: .65rem; align-items: center; margin-top: .9rem; color: #d7c087; font-size: .92rem; }.settlement-progress-track { height: .45rem; overflow: hidden; border: 1px solid #675124; background: #0c0905; }.settlement-progress-track span { display: block; height: 100%; background: linear-gradient(90deg, #9e7530, #e8c969, #8fb06d); transition: width 450ms ease; }.settlement-helper { margin: .75rem 0 0; color: #a89468; font-size: .94rem; }.morning-news, .morning-summary { margin-top: .85rem; padding: .75rem .85rem; border-left: 2px solid #92ae70; background: rgb(22 32 15 / .62); }.morning-summary { border-color: #bd9141; background: rgb(45 31 10 / .5); }.morning-news strong, .morning-summary strong { color: #e7c873; font-family: 'Cinzel', serif; font-size: .76rem; letter-spacing: .06em; text-transform: uppercase; }.morning-news p, .morning-summary p { margin: .3rem 0 0; color: #ddd0ad; }
  @media (max-width: 600px) { .settlement-interlude { grid-template-columns: 1fr; gap: .7rem; }.settlement-crest { width: 2.5rem; height: 2.5rem; }.settlement-progress { grid-template-columns: 1fr; gap: .35rem; } }
  @media (prefers-reduced-motion: reduce) { .settlement-progress-track span { transition: none; } }
</style>
