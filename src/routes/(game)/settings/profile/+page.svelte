<script lang="ts">
  import { BURN_TREATMENTS } from '$lib/card-effects';
  import type { PageProps } from './$types';
  let { data, form }: PageProps = $props();
  let profile: any = $derived(data.community.profile as any);
</script>

<svelte:head>
  <title>Profile settings · By Rook and Crook</title>
</svelte:head>

<main class="page-shell community-page">
  <header><p class="eyebrow">Keeper account</p><h1>Profile</h1><p>Manage your gameplay preferences and community profile.</p></header>
  <form method="POST" action="?/saveCardEffects" class="community-card form-stack">
    <h2 id="gameplay-preferences-title">Gameplay preferences</h2>
    <p>Choose a card burn effect. Random picks one effect per burn action and keeps it consistent across that action.</p>
    <label for="card-burn-style">Card burn effect</label>
    <select id="card-burn-style" name="cardBurnStyle" value={form?.cardBurnStyle ?? data.cardBurnStyle} aria-describedby="card-burn-style-help">
      {#each BURN_TREATMENTS as treatment}
        <option value={treatment.value}>{treatment.name} · {treatment.preview}</option>
      {/each}
      <option value="random">Random · each burn action</option>
    </select>
    <small id="card-burn-style-help">Saved to your account. Used whenever cards burn away.</small>
    {#if form?.cardEffectsError}<p class="community-notice" role="alert">{form.cardEffectsError}</p>{/if}
    {#if form?.cardEffectsMessage}<p class="community-notice" role="status">{form.cardEffectsMessage}</p>{/if}
    <button class="primary-action">Save gameplay preferences</button>
  </form>
  {#if form?.message}<p class="community-notice">{form.message}</p>{/if}
  <form method="POST" action="?/save" class="community-card form-stack">
    <label>Display name <input name="displayName" value={profile.displayName} minlength="2" maxlength="40" required /></label>
    <label>Author bio <textarea name="bio" maxlength="300">{profile.bio}</textarea></label>
    <label><input type="checkbox" name="attest" checked={profile.adultAttested} /> I attest that I am at least 18 years old.</label>
    <section class="community-notice" aria-labelledby="mature-summary">
      <h2 id="mature-summary">Mature community content</h2>
      <p>May include stronger language, substance use, trauma, horror, and non-graphic sexual or violent themes. Explicit sexual content, graphic gore, sexual violence, hate, and actionable self-harm content remain prohibited.</p>
      <p>Turning this off permanently removes mature community NPCs and their player-visible stories from this tavern. They will not return to this save.</p>
    </section>
    <label><input type="checkbox" name="mature" checked={profile.matureEnabled} /> Show mature community NPCs after adult attestation.</label>
    {#if !profile.matureEnabled}<label><input type="checkbox" name="confirmMature" /> I have read the content summary and confirm this setting.</label>{/if}
    <label><input type="checkbox" name="terms" checked={profile.creatorTermsAccepted} /> I accept the Community Creator Terms v1 for submitted content.</label>
    <button class="primary-action">Save profile</button>
  </form>
</main>
