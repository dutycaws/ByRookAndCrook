<script lang="ts">
  let { value, min = 1, max, disabled = false, label = 'Quantity', onchange }: {
    value: number;
    min?: number;
    max: number;
    disabled?: boolean;
    label?: string;
    onchange: (value: number) => void;
  } = $props();
  const labelId = $props.id();

  function adjust(delta: number) {
    if (disabled || max < min) return;
    const next = Math.max(min, Math.min(max, value + delta));
    if (next !== value) onchange(next);
  }
</script>

<div class="quantity-picker">
  <span id={labelId}>{label}</span>
  <div class="quantity-control" role="group" aria-labelledby={labelId}>
    <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} disabled={disabled || max < min || value <= min} onclick={() => adjust(-1)}>−</button>
    <output aria-label={`${label} ${value}`} aria-live="polite" aria-atomic="true">{value}</output>
    <button type="button" aria-label={`Increase ${label.toLowerCase()}`} disabled={disabled || max < min || value >= max} onclick={() => adjust(1)}>+</button>
  </div>
</div>

<style>
  .quantity-picker { display: flex; align-items: center; justify-content: space-between; gap: .75rem; color: #d4c39f; font-size: .78rem; }
  .quantity-control { display: flex; align-items: center; gap: .45rem; }
  button { display: grid; width: 2.75rem; min-height: 44px; padding: 0; place-items: center; border: 1px solid #a17c3c; border-radius: .4rem; color: #f0d58c; background: #20170bd9; font: inherit; font-size: 1.15rem; line-height: 1; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .58; }
  button:focus-visible { outline: 2px solid #ffe49c; outline-offset: 2px; }
  output { display: grid; min-width: 2.25rem; min-height: 44px; place-items: center; border: 1px solid #755a2d; border-radius: .35rem; color: #f1e6ca; background: #0c0804; font-size: .95rem; font-variant-numeric: tabular-nums; }
</style>
