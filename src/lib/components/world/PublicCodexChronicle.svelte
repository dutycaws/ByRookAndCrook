<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { PublicCodexDisposition, PublicCodexEvent } from '$lib/game/evolving-world';

  interface TavernReport {
    id: string;
    text: string;
    day: number;
    unread: boolean;
    instanceId?: string | null;
  }

  let {
    events,
    dispositions,
    reports = []
  }: {
    events: PublicCodexEvent[];
    dispositions: PublicCodexDisposition[];
    reports?: TavernReport[];
  } = $props();

  let mounted = $state(false);
  let saving = $state(false);
  let readError = $state('');
  const submitted = new Set<string>();
  const uniqueTavernReports = $derived(reports.filter((report) => !events.some((event) =>
    event.day === report.day && report.text === `${event.title}: ${event.summary}`
  )));

  function matchingWorldReports(event: PublicCodexEvent): TavernReport[] {
    return reports.filter((report) => report.day === event.day && report.text === `${event.title}: ${event.summary}`);
  }

  function reportAnchorId(reportId: string): string {
    return `tavern-report-${reportId}`;
  }

  function reportAnchorHref(reportId: string): string {
    return `#${encodeURIComponent(reportAnchorId(reportId))}`;
  }

  onMount(() => { mounted = true; });

  async function markViewed(reportIds: string[]) {
    if (typeof window === 'undefined' || !reportIds.length || saving) return;
    saving = true;
    readError = '';
    for (const id of reportIds) submitted.add(id);
    try {
      for (let offset = 0; offset < reportIds.length; offset += 100) {
        const response = await fetch('/api/codex/read', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reportIds: reportIds.slice(offset, offset + 100) })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message ?? 'The chronicle could not be marked as read.');
      }
      await invalidateAll();
    } catch (cause) {
      readError = cause instanceof Error ? cause.message : 'The chronicle could not be marked as read.';
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    if (!mounted) return;
    const unreadIds = reports.filter((report) => report.unread && !submitted.has(report.id)).map((report) => report.id);
    if (unreadIds.length) void markViewed(unreadIds);
  });

  function residentHref(instanceId: string): string {
    return `/codex?section=residents&resident=${encodeURIComponent(instanceId)}`;
  }
</script>

<section class="chronicle" aria-labelledby="world-chronicle-title">
  <header class="chronicle-heading">
    <p class="eyebrow">Shared record</p>
    <h2 id="world-chronicle-title" tabindex="-1">Tavern chronicle</h2>
    <p>Arrivals, departures, and changes that shape life around the tavern.</p>
  </header>

  {#if readError}
    <p class="read-error" role="alert">{readError} <button type="button" class="retry-link" disabled={saving} onclick={() => markViewed(reports.filter((report) => report.unread).map((report) => report.id))}>{saving ? 'Saving…' : 'Try again'}</button></p>
  {:else if saving}
    <p class="read-status" role="status">Saving your place in the chronicle…</p>
  {/if}

  {#if uniqueTavernReports.length}
    <section class="chronicle-section" aria-labelledby="tavern-notices-title">
      <h3 id="tavern-notices-title">Tavern notices</h3>
      <ol class="chronicle-list">
        {#each uniqueTavernReports as report (report.id)}
          <li id={reportAnchorId(report.id)} tabindex="-1">
            <p class="eyebrow">Day {report.day}{report.unread ? ' · Unread' : ''}</p>
            <p>{report.text}</p>
            {#if report.instanceId}<a href={residentHref(report.instanceId)}>Read this resident’s history</a>{/if}
          </li>
        {/each}
      </ol>
    </section>
  {:else if events.length === 0 && dispositions.length === 0}
    <p class="empty-state">No changes have been recorded in the chronicle yet.</p>
  {/if}

  {#if events.length || dispositions.length}
    <section class="chronicle-section" aria-labelledby="world-changes-title">
      <h3 id="world-changes-title">World record</h3>
      <ol class="chronicle-list">
        {#each events as event (`event-${event.id}-${event.day}`)}
          {@const worldReports = matchingWorldReports(event)}
          {@const eventAnchorId = worldReports[0] ? reportAnchorId(worldReports[0].id) : `world-event-${event.id}-${event.day}`}
          <li id={eventAnchorId} tabindex="-1">
            {#each worldReports.slice(1) as report (report.id)}
              <a id={reportAnchorId(report.id)} class="report-anchor-alias" href={reportAnchorHref(worldReports[0].id)} tabindex="-1" aria-label={`Go to world record: ${event.title}`}></a>
            {/each}
            <p class="eyebrow">Day {event.day} · Public event</p><h4>{event.title}</h4><p>{event.summary}</p>
          </li>
        {/each}
        {#each dispositions as disposition (`resident-${disposition.instanceId}-${disposition.day}-${disposition.provenance.profileRevision}`)}
          <li><p class="eyebrow">Day {disposition.day} · {disposition.name}</p><h4>{disposition.state}</h4><p>{disposition.summary}</p><small>Attributed to {disposition.name}{disposition.title ? `, ${disposition.title}` : ''}.</small></li>
        {/each}
      </ol>
    </section>
  {/if}
</section>

<style>
  .chronicle { min-width: 0; }
  .chronicle-heading { padding-bottom: .8rem; border-bottom: 1px solid rgb(133 96 35 / 45%); }
  .chronicle-heading .eyebrow { margin: 0 0 .2rem; }
  .chronicle-heading h2 { margin: 0; color: var(--gold-bright, #f0d27a); font: 600 clamp(1.15rem, 2.3vw, 1.5rem) 'Cinzel', Georgia, serif; }
  .chronicle-heading > p:last-child { margin: .35rem 0 0; color: var(--muted, #b9aa88); }
  .chronicle-section { padding: .9rem 0; border-bottom: 1px solid rgb(133 96 35 / 32%); }
  .chronicle-section h3 { margin: 0; color: #ead39a; font: 600 1rem 'Cinzel', Georgia, serif; }
  .chronicle-list { display: grid; gap: .7rem; margin: .55rem 0 0; padding: 0; list-style: none; }
  .chronicle-list li { position: relative; padding: .65rem 0 0; border-top: 1px solid rgb(133 96 35 / 24%); scroll-margin-top: 5.5rem; }
  .chronicle-list li:focus-visible, .chronicle-heading h2:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
  .report-anchor-alias { position: absolute; inset: 0 auto auto 0; display: block; width: 0; height: 0; overflow: hidden; }
  .chronicle-list li > :first-child { margin-top: 0; }
  .chronicle-list p { margin: .25rem 0; line-height: 1.45; }
  .chronicle-list h4 { margin: .2rem 0; color: #e9d49e; font-family: 'Cinzel', Georgia, serif; font-size: .92rem; }
  .chronicle-list a, .retry-link { color: var(--gold-bright, #f0d27a); text-underline-offset: .2em; }
  .chronicle-list a { display: inline-block; margin-top: .25rem; }
  .retry-link { border: 0; padding: .1rem .2rem; background: transparent; font: inherit; text-decoration: underline; cursor: pointer; }
  .read-error { color: #f0b6a6; }
  .read-status, .empty-state { color: var(--muted, #b9aa88); }
  @media (prefers-reduced-motion: reduce) { .chronicle { scroll-behavior: auto; } }
</style>
