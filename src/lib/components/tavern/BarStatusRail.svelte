<script lang="ts">
  let {
    day,
    gold,
    drinks,
    foods,
    disabled = false,
    onclose
  }: {
    day: number;
    gold: number;
    drinks: number;
    foods: number;
    disabled?: boolean;
    onclose: () => void;
  } = $props();
</script>

<header class="bar-status" aria-label="Tavern status">
  <dl class="status-facts">
    <div><dt>Day</dt><dd>{day}</dd></div>
    <div><dt>Gold</dt><dd>{gold}</dd></div>
    <div><dt>Cellar</dt><dd>{drinks + foods} ready</dd></div>
  </dl>
  <button class="end-evening" type="button" {disabled} onclick={onclose}>
    <span aria-hidden="true">☾</span><span>End evening</span>
  </button>
</header>

<style>
  .bar-status {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: clamp(.75rem, 2vw, 1.5rem);
    padding: .75rem 0;
    border-bottom: 1px solid rgb(193 159 94 / .28);
  }

  .status-facts { display: flex; flex: 1 1 auto; align-items: center; gap: clamp(1rem, 3vw, 2.25rem); margin: 0; }
  .status-facts div { display: flex; align-items: baseline; gap: .4rem; white-space: nowrap; }
  .status-facts dt { color: #a89468; font-size: .85rem; }
  .status-facts dd { margin: 0; color: #e4cb8b; font-variant-numeric: tabular-nums; font-weight: 700; }
  .end-evening { display: inline-flex; min-height: 2.5rem; align-items: center; justify-content: center; gap: .5rem; padding: .45rem .8rem; border: 1px solid #806631; color: #ebd9ad; background: rgb(39 29 14 / .8); font: inherit; font-size: .88rem; font-weight: 650; white-space: nowrap; cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease; }
  .end-evening span:first-child { color: #e4c36b; }
  .end-evening:hover { border-color: #c49b4e; background: #392910; }
  .end-evening:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }

  @media (max-width: 600px) {
    .bar-status { flex-wrap: wrap; gap: .55rem .75rem; }
    .status-facts { justify-content: space-between; gap: .65rem; }
    .status-facts div { gap: .3rem; }
    .status-facts dt { font-size: .78rem; }
    .end-evening { min-height: 2.35rem; margin-left: auto; padding: .4rem .6rem; font-size: .82rem; }
  }
</style>
