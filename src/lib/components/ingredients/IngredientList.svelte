<script lang="ts">
  import { qualityLabel, type IngredientBatch } from '$lib/game/contracts';

  let { ingredients }: { ingredients: IngredientBatch[] } = $props();
</script>

{#if ingredients.length === 0}
  <div class="empty-state">
    <span aria-hidden="true">🧺</span>
    <h2>Your pantry is waiting</h2>
    <p>Harvest a mature garden crop and its ingredients will appear here.</p>
    <a class="primary-button inline-button" href="/garden">Visit the garden</a>
  </div>
{:else}
  <ul class="ingredient-list">
    {#each ingredients as ingredient (ingredient.id)}
      <li class="ingredient-card">
        <span class="ingredient-icon" aria-hidden="true">{ingredient.icon}</span>
        <div class="ingredient-main">
          <p class="eyebrow">{qualityLabel(ingredient.qualityIndex)} · {ingredient.quantity} unit{ingredient.quantity === 1 ? '' : 's'}</p>
          <h2>{ingredient.plantName}</h2>
          <p>Harvested {new Date(ingredient.createdAt).toLocaleString()}</p>
        </div>
        <dl class="modifier-list">
          <div><dt>Brew</dt><dd>+{ingredient.brewBonus}</dd></div>
          <div><dt>Bake</dt><dd>+{ingredient.bakeBonus}</dd></div>
        </dl>
      </li>
    {/each}
  </ul>
{/if}
