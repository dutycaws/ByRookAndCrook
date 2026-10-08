<script lang="ts">
  let {
    day,
    gold,
    disabled = false,
    statusOnly = false,
    onclose
  }: {
    day: number;
    gold: number;
    disabled?: boolean;
    statusOnly?: boolean;
    onclose: () => void;
  } = $props();
</script>

<div class="bar-status" class:status-only={statusOnly} aria-label="Tavern status">
  <p class="status-line"><span>Day {day}</span><span aria-hidden="true">·</span><span>{gold} gold</span></p>
  {#if !statusOnly}
    <button class="end-evening" type="button" {disabled} onclick={onclose}>
      <span aria-hidden="true">☾</span><span>End evening</span>
    </button>
  {/if}
</div>

<style>
  .bar-status { position: absolute; z-index: 13; top: .7rem; right: .75rem; left: .75rem; display: flex; align-items: start; justify-content: space-between; gap: .75rem; pointer-events: none; }
  .bar-status.status-only { justify-content: flex-start; }
  .status-line { display: inline-flex; align-items: center; gap: .5rem; margin: 0; padding: .45rem .65rem; border: 1px solid rgb(193 159 94 / .28); color: #e7d7af; background: rgb(14 10 6 / .78); font-size: .82rem; font-variant-numeric: tabular-nums; text-shadow: 0 1px 2px #000; }
  .status-line span[aria-hidden='true'] { color: #a89468; }
  .end-evening { display: inline-flex; min-height: 2.25rem; align-items: center; justify-content: center; gap: .45rem; padding: .4rem .65rem; border: 1px solid #806631; color: #ebd9ad; background: rgb(17 12 6 / .92); font: inherit; font-size: .84rem; font-weight: 650; white-space: nowrap; cursor: pointer; pointer-events: auto; transition: background-color 150ms ease, border-color 150ms ease; }
  .end-evening span:first-child { color: #e4c36b; }
  .end-evening:hover { border-color: #c49b4e; background: #392910; }
  .end-evening:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  .end-evening:disabled { opacity: .62; cursor: wait; }
  @media (max-width: 520px) { .bar-status { top: .45rem; right: .45rem; left: .45rem; } .status-line { gap: .35rem; padding: .35rem .5rem; font-size: .75rem; } .end-evening { min-height: 2rem; padding: .3rem .45rem; font-size: .76rem; } }
</style>
