<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    id,
    title,
    open = $bindable(false),
    children
  }: {
    id: string;
    title: string;
    open?: boolean;
    children: Snippet;
  } = $props();

  let dialog: HTMLDialogElement;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  function handleClose() {
    open = false;
  }
</script>

<dialog bind:this={dialog} class="ui-dialog" aria-labelledby={`${id}-title`} onclose={handleClose}>
  <div class="dialog-frame">
    <header>
      <h2 id={`${id}-title`}>{title}</h2>
      <button class="dialog-dismiss" type="button" aria-label="Close dialog" onclick={() => (open = false)}>×</button>
    </header>
    <div class="dialog-content">
      {@render children()}
    </div>
  </div>
</dialog>

<style>
  .ui-dialog {
    width: min(34rem, calc(100vw - 2rem));
    max-width: none;
    max-height: min(90vh, 42rem);
    padding: 0;
    overflow: auto;
    border: 1px solid #8b6f35;
    color: #e2d2ae;
    background: linear-gradient(145deg, #21190e, #100d08 72%);
    box-shadow: 0 24px 80px rgb(0 0 0 / .65), inset 0 0 0 1px rgb(255 223 155 / .05);
  }

  :global(html:has(dialog.ui-dialog[open])), :global(body:has(dialog.ui-dialog[open])) { overflow: hidden; }
  .ui-dialog::backdrop { background: rgb(7 5 3 / .74); backdrop-filter: blur(2px); }
  .dialog-frame { padding: clamp(1rem, 4vw, 1.5rem); }
  .dialog-frame > header { display: flex; align-items: start; justify-content: space-between; gap: 1rem; }
  .dialog-frame h2 { margin: 0; color: #f0d27a; font-family: 'Cinzel', serif; font-size: clamp(1.2rem, 4vw, 1.65rem); }
  .dialog-dismiss { display: grid; flex: 0 0 auto; width: 2.5rem; height: 2.5rem; place-items: center; border: 1px solid #6f582b; color: #eddaaa; background: #191208; font: inherit; font-size: 1.4rem; cursor: pointer; }
  .dialog-dismiss:hover { background: #392910; }
  .dialog-dismiss:focus-visible { outline: 2px solid #f0d27a; outline-offset: 2px; }
  .dialog-content { padding-top: 1rem; }

  @media (prefers-reduced-motion: reduce) { .ui-dialog::backdrop { backdrop-filter: none; } }
</style>
