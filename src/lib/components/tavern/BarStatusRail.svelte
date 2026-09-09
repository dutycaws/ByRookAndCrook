<script lang="ts">
  let { day, gold, drinks, foods, recent }: { day: number; gold: number; drinks: number; foods: number; recent: number } = $props();
</script>

<aside class="tavern-rail tavern-status-rail" aria-labelledby="tavern-status-title">
  <div class="rail-title"><p class="eyebrow">Tavern status</p><h2 id="tavern-status-title">Tonight at the Rook</h2></div>
  <dl class="status-list">
    <div><dt>Tavern day</dt><dd>{day}</dd></div>
    <div aria-label="Tavern gold"><dt>Gold</dt><dd>{gold} gold</dd></div>
    <div><dt>Drinks ready</dt><dd>{drinks}</dd></div>
    <div><dt>Food ready</dt><dd>{foods}</dd></div>
    <div><dt>Recent servings</dt><dd>{recent}</dd></div>
  </dl>
  <div class="rail-routes" aria-label="Restock the tavern">
    <p class="eyebrow">Prepare for service</p>
    <a href="/garden">Tend the garden <span aria-hidden="true">→</span></a>
    <a href="/brewery">Brew a drink <span aria-hidden="true">→</span></a>
    <a href="/bakery">Bake some food <span aria-hidden="true">→</span></a>
  </div>
</aside>
