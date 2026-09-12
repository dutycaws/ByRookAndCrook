<script lang="ts">
  import type { GameSnapshot } from '$lib/game/contracts';

  let { snapshot }: { snapshot: GameSnapshot } = $props();

  type ReportEvent = { layoutKey: string; label: string; severity: string; message: string };

  function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function reportSummary(value: unknown): string | null {
    return isRecord(value) && typeof value.summary === 'string' ? value.summary : null;
  }

  function reportEvents(value: unknown): ReportEvent[] {
    if (!isRecord(value) || !Array.isArray(value.events)) return [];
    return value.events.flatMap((event) => isRecord(event)
      && typeof event.layoutKey === 'string'
      && typeof event.label === 'string'
      && typeof event.severity === 'string'
      && typeof event.message === 'string'
        ? [{ layoutKey: event.layoutKey, label: event.label, severity: event.severity, message: event.message }]
        : []);
  }

  let unlocked = $derived(snapshot.cells.filter((cell) => cell.unlocked !== false));
  let latestEvents = $derived(reportEvents(snapshot.garden?.latestReport));
</script>

<div class="garden-overview">
  <dl class="craft-status-list">
    <div><dt>Day</dt><dd>{snapshot.save.currentDay}</dd></div>
    <div><dt>Plots</dt><dd>{snapshot.garden?.plotCount ?? unlocked.length}</dd></div>
    <div><dt>Ready</dt><dd>{unlocked.filter((cell) => cell.harvestable).length}</dd></div>
    <div><dt>Gold</dt><dd>{snapshot.save.gold ?? 0}</dd></div>
  </dl>

  {#if snapshot.garden?.forecast.length}
    <section class="overview-section" aria-label="Three-day forecast">
      <p class="eyebrow">Three-day forecast</p>
      <div class="forecast-list">
        {#each snapshot.garden.forecast as day}
          <div>
            <strong>Day {day.dayNumber}</strong>
            <span>{day.name}</span>
            <small>Rain {day.rainfall} · Drying {day.drying >= 0 ? '+' : ''}{day.drying} · Light {day.lightDelta >= 0 ? '+' : ''}{day.lightDelta}</small>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if snapshot.garden?.latestReport}
    <details class="overview-section daily-report" open={latestEvents.length > 0}>
      <summary>Latest garden report</summary>
      {#if reportSummary(snapshot.garden.latestReport)}
        <p>{reportSummary(snapshot.garden.latestReport)}</p>
      {/if}
      {#if latestEvents.length}
        <ul>
          {#each latestEvents as event}
            <li data-severity={event.severity}>
              <strong>{event.layoutKey} · {event.label}</strong>
              <span>{event.message}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </details>
  {/if}

  {#if snapshot.garden?.compostJobs.length}
    <details class="overview-section compost-jobs">
      <summary>Compost in progress · {snapshot.garden.compostJobs.length}</summary>
      <ul>
        {#each snapshot.garden.compostJobs as job}
          <li><strong>{job.sourceLabel}</strong><span>Plot release day {job.readyDay} · {job.releasesRemaining} remaining</span></li>
        {/each}
      </ul>
    </details>
  {/if}
</div>

<style>
  .garden-overview { display: grid; gap: 1rem; }
  .overview-section { display: grid; gap: .55rem; padding-top: .8rem; border-top: 1px solid #3f301a; }
  .forecast-list { display: grid; gap: .35rem; }
  .forecast-list div { display: grid; grid-template-columns: auto 1fr; gap: .15rem .5rem; padding: .45rem .5rem; border: 1px solid #4f3d22; background: #120e08; }
  .forecast-list strong { color: #d8bc77; font-size: .7rem; }
  .forecast-list span { color: #dfcca0; font-size: .75rem; text-align: right; }
  .forecast-list small { grid-column: 1 / -1; color: #9d8962; font-size: .64rem; }
  .daily-report ul, .compost-jobs ul { display: grid; gap: .4rem; margin: 0; padding: 0; list-style: none; }
  .daily-report li strong, .daily-report li span, .compost-jobs li strong, .compost-jobs li span { display: block; }
  .daily-report li strong, .compost-jobs li strong { font-size: .72rem; }
  .daily-report li span, .compost-jobs li span { margin-top: .15rem; color: #aa9670; font-size: .68rem; line-height: 1.35; }
  summary { color: #d6b768; cursor: pointer; font-family: 'Cinzel',serif; font-size: .72rem; }
  .daily-report p { margin: 0; color: #b6a37d; font-size: .72rem; line-height: 1.4; }
  .daily-report li, .compost-jobs li { padding-left: .55rem; border-left: 3px solid #916f36; }
  .daily-report li[data-severity='critical'] { border-left-color: #bb5138; }
</style>
