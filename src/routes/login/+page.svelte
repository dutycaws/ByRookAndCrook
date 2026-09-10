<script lang="ts">
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();
</script>

<svelte:head>
  <title>Sign in · By Rook and Crook</title>
  <meta name="description" content="Open your tavern ledger." />
</svelte:head>

<main class="login-shell">
  <section class="login-card" aria-labelledby="login-title">
    <div class="sigil" aria-hidden="true">
      <img src="/raven.svg" alt="" width="64" height="64" />
    </div>
    <p class="eyebrow">The keeper's ledger</p>
    <h1 id="login-title">By Rook <span>&amp;</span> Crook</h1>
    <p class="lede">The garden waits beyond the old courtyard wall.</p>

    <form method="POST" class="stack-form">
      <label>
        <span>Email</span>
        <input name="email" type="email" autocomplete="email" required />
      </label>
      <label>
        <span>Password</span>
        <input name="password" type="password" autocomplete="current-password" required />
      </label>

      {#if form?.message}
        <p class="form-message error" role="alert">{form.message}</p>
      {/if}

      <button class="primary-button" type="submit">Open the ledger</button>
    </form>
  </section>
</main>
