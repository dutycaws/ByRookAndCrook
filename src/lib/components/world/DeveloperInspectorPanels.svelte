<script lang="ts">
  import type { DeveloperInspector } from '$lib/game/evolving-world/developer-inspector';
  let { inspector }: { inspector: DeveloperInspector } = $props();
  const label=(value:string)=>value.replaceAll('_',' ');
</script>

<section class="panel" aria-labelledby="world-entities"><p class="eyebrow">Local diagnostics</p><h2 id="world-entities">World entities</h2>
  <ul>{#each inspector.entities as entity (entity.id)}<li><strong>{entity.key}</strong> <span>{entity.kind} · {entity.lifecycle} · relevance {entity.relevance}</span><small>{entity.history.map((entry)=>entry.eventKind).join(' → ') || 'No lifecycle history'}</small></li>{:else}<li>No canonical entities yet.</li>{/each}</ul>
</section>
<section class="panel" aria-labelledby="world-settlements"><p class="eyebrow">Queue metadata</p><h2 id="world-settlements">Settlement jobs</h2>
  {#each inspector.settlements as settlement (settlement.id)}<article><h3>Day {settlement.dayNumber} · {settlement.status}</h3>{#each settlement.jobs as job (job.id)}<div class="job"><strong>{job.ordinal}. {label(job.kind)} — {job.status}</strong><small>Attempts: {job.attempts.map((attempt)=>`${attempt.attempt}:${attempt.status}`).join(', ') || 'none'} · checkpoints: {job.checkpoints.map((checkpoint)=>checkpoint.stage).join(', ') || 'none'}</small>{#if job.status==='failed'}<form method="POST" action="?/requeueSettlement"><input type="hidden" name="jobId" value={job.id}/><label>Reason <input name="reason" minlength="3" maxlength="240" required /></label><button>Requeue eligible job</button></form>{/if}</div>{/each}</article>{:else}<p>No settlement records.</p>{/each}
</section>
<section class="panel" aria-labelledby="world-art"><p class="eyebrow">Nonblocking art queue</p><h2 id="world-art">Runtime art</h2>
  <ul>{#each inspector.artJobs as job (job.id)}<li><strong>{job.entityId}</strong><span>{job.status} · attempt {job.attempt} · {job.appearanceVersion}</span>{#if job.status.startsWith('failed_')}<form method="POST" action="?/requeueArt"><input type="hidden" name="jobId" value={job.id}/><label>Reason <input name="reason" minlength="3" maxlength="240" required /></label><button>Requeue art job</button></form>{/if}</li>{:else}<li>No runtime-art jobs.</li>{/each}</ul>
  <form method="POST" action="?/setArtAppearance" class="appearance"><h3>Queue a new public appearance</h3><label>Entity ID <input name="entityId" required pattern="[0-9a-fA-F-]{36}" /></label><label>New version <input name="appearanceVersion" maxlength="128" required /></label><label>Public appearance <textarea name="publicAppearance" maxlength="1000" required></textarea></label><label>Reason <input name="reason" minlength="3" maxlength="240" required /></label><button>Record appearance override</button></form>
</section>
<section class="panel" aria-labelledby="world-overrides"><p class="eyebrow">Append-only local audit</p><h2 id="world-overrides">Developer overrides</h2><ul>{#each inspector.overrides as override (override.id)}<li><strong>{label(override.operation)}</strong><span>{override.outcome}</span><small>{new Date(override.createdAt).toLocaleString()}</small></li>{:else}<li>No local overrides recorded.</li>{/each}</ul></section>
<style>
  section{padding:1rem;margin-block:1rem}ul{padding:0;margin:0;list-style:none}li,article{display:grid;gap:.25rem;padding:.7rem 0;border-top:1px solid rgb(202 168 97 / .28)}li:first-child,article:first-of-type{border-top:0}.job{display:grid;gap:.35rem;padding:.65rem;border-top:1px solid rgb(202 168 97 / .18)}small,span{color:var(--ink-muted,#cdbd96)}form{display:flex;flex-wrap:wrap;gap:.55rem;align-items:end;margin-top:.45rem}label{display:grid;gap:.2rem;font-size:.85rem}input,textarea{max-width:30rem}button{align-self:end}.appearance{display:grid;max-width:42rem;margin-top:1rem}
  @media(max-width:600px){form{align-items:stretch}button{align-self:stretch}}
</style>
