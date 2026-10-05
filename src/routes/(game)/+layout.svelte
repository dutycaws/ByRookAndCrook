<script lang="ts">
  import { page } from '$app/state';
  import { afterNavigate } from '$app/navigation';
  import { onMount, setContext } from 'svelte';
  import { SETTLEMENT_USER_ID_CONTEXT } from '$lib/game/settlement-context';
  import TavernHeader from '$lib/components/tavern/TavernHeader.svelte';
  import type { LayoutProps } from './$types';

  interface TavernReport {
    id: string;
    text: string;
    day: number;
    unread: boolean;
    notified?: boolean;
    instanceId?: string | null;
  }

  let { data, children }: LayoutProps = $props();
  setContext(SETTLEMENT_USER_ID_CONTEXT, () => data.userId);

  const shownKey = 'byrc:codex-report-notices:v1';
  let ready = $state(false);
  let activeReport = $state<TavernReport | null>(null);
  let toastNode = $state<HTMLElement>();
  let shownIds = new Set<string>();
  let expirationTimer: ReturnType<typeof setTimeout> | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let expirationStartedAt = 0;
  let remainingMs = 6000;
  let pointerInside = false;
  let focusInside = false;
  let dispatching = $state(false);
  let settleToCodex = $state(false);
  let settleX = $state(0);
  let settleY = $state(-80);

  function stopExpiration() {
    if (!expirationTimer) return;
    clearTimeout(expirationTimer);
    expirationTimer = undefined;
    remainingMs = Math.max(0, remainingMs - (Date.now() - expirationStartedAt));
  }

  function startExpiration() {
    if (!activeReport || dispatching || pointerInside || focusInside || expirationTimer) return;
    expirationStartedAt = Date.now();
    expirationTimer = setTimeout(() => {
      expirationTimer = undefined;
      sendToCodex();
    }, remainingMs);
  }

  function pauseExpiration() {
    stopExpiration();
  }

  function resumeExpiration() {
    if (!pointerInside && !focusInside) startExpiration();
  }

  function enterPointer() {
    pointerInside = true;
    pauseExpiration();
  }

  function leavePointer() {
    pointerInside = false;
    resumeExpiration();
  }

  function enterFocus() {
    focusInside = true;
    pauseExpiration();
  }

  function leaveFocus(event: FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && toastNode?.contains(next)) return;
    focusInside = false;
    resumeExpiration();
  }

  function isFullyVisible(element: HTMLElement | null): element is HTMLElement {
    if (!element || element.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(element);
    if (style.visibility !== 'visible' || Number(style.opacity) <= 0) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? document.documentElement.clientWidth);
    const bottom = top + (viewport?.height ?? document.documentElement.clientHeight);
    return rect.left >= left && rect.top >= top && rect.right <= right && rect.bottom <= bottom;
  }

  function sendToCodex() {
    if (!activeReport) return;
    const destination = document.querySelector<HTMLElement>('[data-codex-nav]');
    const from = toastNode?.getBoundingClientRect();
    const to = isFullyVisible(destination) ? destination.getBoundingClientRect() : null;
    if (from && to) {
      settleX = to.left + to.width / 2 - (from.left + from.width / 2);
      settleY = to.top + to.height / 2 - (from.top + from.height / 2);
      settleToCodex = true;
    } else {
      settleX = 0;
      settleY = 0;
      settleToCodex = false;
    }
    dispatching = true;
    settleTimer = setTimeout(() => {
      activeReport = null;
      dispatching = false;
      settleToCodex = false;
      settleTimer = undefined;
      remainingMs = 6000;
    }, 360);
  }

  function clearToast(restoreFocus = false) {
    if (expirationTimer) clearTimeout(expirationTimer);
    if (settleTimer) clearTimeout(settleTimer);
    expirationTimer = undefined;
    settleTimer = undefined;
    activeReport = null;
    dispatching = false;
    settleToCodex = false;
    remainingMs = 6000;
    pointerInside = false;
    focusInside = false;
    if (restoreFocus) requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-codex-nav]')?.focus());
  }

  function reportHref(report: TavernReport): string {
    const resident = report.instanceId ? `&resident=${encodeURIComponent(report.instanceId)}` : '';
    return `/codex?section=chronicle${resident}#tavern-report-${encodeURIComponent(report.id)}`;
  }

  async function acknowledgeShown(reportId: string) {
    if (typeof window === 'undefined') return;
    try {
      await fetch('/api/codex/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportIds: [reportId], seenOnly: true })
      });
    } catch {
      // The session record still prevents an immediate repeat; unread stays server-authoritative.
    }
  }

  onMount(() => {
    try {
      const stored = sessionStorage.getItem(shownKey);
      const ids: unknown = stored ? JSON.parse(stored) : [];
      if (Array.isArray(ids)) shownIds = new Set(ids.filter((id): id is string => typeof id === 'string').slice(-500));
    } catch {
      shownIds = new Set();
    }
    ready = true;
    return () => {
      if (expirationTimer) clearTimeout(expirationTimer);
      if (settleTimer) clearTimeout(settleTimer);
    };
  });

  afterNavigate(({ to }) => {
    if (to?.url.pathname === '/codex' && activeReport) clearToast();
  });

  $effect(() => {
    const reports = data.tavernReports as TavernReport[];
    if (!ready || activeReport || (page.url.pathname === '/codex' && page.url.searchParams.get('section') === 'chronicle')) return;
    const next = reports?.find((report) => report.unread && !report.notified && !shownIds.has(report.id));
    if (!next) return;
    activeReport = next;
    shownIds.add(next.id);
    try { sessionStorage.setItem(shownKey, JSON.stringify([...shownIds].slice(-500))); } catch { /* Database delivery state remains authoritative. */ }
    remainingMs = 6000;
    void acknowledgeShown(next.id);
    requestAnimationFrame(startExpiration);
  });

  function onToastKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && activeReport && focusInside) {
      event.preventDefault();
      clearToast(true);
    }
  }
</script>

<svelte:window onkeydown={onToastKeydown} />

<div class="game-shell" data-hydrated={ready}>
  <TavernHeader userEmail={data.userEmail} capabilities={data.community.capabilities} codexUnreadCount={data.unreadCount} />

  {#if activeReport}
    <aside
      bind:this={toastNode}
      class="codex-report-toast"
      class:dispatching
      class:settle-to-codex={settleToCodex}
      style={`--settle-x:${settleX}px;--settle-y:${settleY}px`}
      aria-label="New tavern chronicle notice"
      aria-live="polite"
      role="region"
      tabindex="-1"
      onpointerenter={enterPointer}
      onpointerleave={leavePointer}
      onfocusin={enterFocus}
      onfocusout={leaveFocus}
    >
      <div class="toast-copy">
        <p class="eyebrow">Day {activeReport.day} · Tavern chronicle</p>
        <a
          class="toast-report-link"
          href={reportHref(activeReport)}
          aria-label={`Read full chronicle report in the Codex: ${activeReport.text}`}
          title={activeReport.text}
        >
          <span class="toast-report-text">{activeReport.text}</span>
          <span class="toast-report-action" aria-hidden="true">Read in the Codex</span>
        </a>
      </div>
      <button class="toast-dismiss" type="button" aria-label="Dismiss notice" onclick={() => clearToast(true)}>×</button>
    </aside>
  {/if}

  {@render children()}
</div>

<style>
  .game-shell { min-width: 0; }
  .codex-report-toast {
    position: fixed;
    top: 5.25rem;
    right: max(1rem, calc((100vw - 1240px) / 2));
    z-index: 120;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: .8rem;
    width: min(26rem, calc(100vw - 2rem));
    padding: .85rem 1rem;
    border: 1px solid #8b6b32;
    border-left: 3px solid #e0bb66;
    color: #e9d9ac;
    background: linear-gradient(115deg, rgb(42 31 13 / .98), rgb(20 17 9 / .98));
    box-shadow: 0 12px 34px rgb(0 0 0 / 58%);
    pointer-events: none;
    transform: translate(0, 0) scale(1);
    transform-origin: top right;
    transition: transform 360ms cubic-bezier(.2, .75, .25, 1), opacity 360ms ease;
  }
  .codex-report-toast.dispatching { opacity: .06; pointer-events: none; }
  .codex-report-toast.dispatching.settle-to-codex { transform: translate(var(--settle-x), var(--settle-y)) scale(.12); }
  .codex-report-toast.dispatching:not(.settle-to-codex) { transform: none; }
  .toast-copy { min-width: 0; }
  .toast-copy .eyebrow { margin: 0 0 .25rem; font-size: .67rem; }
  .toast-copy a, .toast-dismiss { pointer-events: auto; }
  .toast-report-link { display: grid; gap: .22rem; color: #f1e4bd; font-size: 1rem; line-height: 1.35; text-decoration: none; }
  .toast-report-text { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
  .toast-report-action { color: #e4c675; font-size: .82rem; text-decoration: underline; text-underline-offset: .2em; }
  .toast-dismiss { align-self: start; display: grid; width: 2.5rem; height: 2.5rem; place-items: center; border: 1px solid rgb(184 148 76 / 52%); color: #e9d9ac; background: transparent; font: 1.5rem/1 'EB Garamond', Georgia, serif; cursor: pointer; }
  .toast-report-link:focus-visible, .toast-dismiss:focus-visible { outline: 2px solid #f0d27a; outline-offset: 3px; }
  @media (max-width: 600px) {
    .codex-report-toast {
      top: auto;
      right: max(.5rem, calc((100vw - 28rem) / 2));
      bottom: calc(env(safe-area-inset-bottom, 0px) + .5rem);
      left: max(.5rem, calc((100vw - 28rem) / 2));
      width: auto;
      gap: .45rem;
      padding: .55rem .65rem;
    }
    .toast-copy .eyebrow { margin-bottom: .12rem; font-size: .61rem; }
    .toast-report-link { gap: .1rem; font-size: .86rem; line-height: 1.25; }
    .toast-report-action { font-size: .7rem; }
    .toast-dismiss { width: 2.25rem; height: 2.25rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .codex-report-toast { transition: opacity 160ms ease; }
    .codex-report-toast.dispatching { transform: none; }
  }
</style>
