<script lang="ts">
  import type { Journal } from '$lib/game/dialogue';
  import type { Patron, ServeReceipt } from '$lib/game/serving';
  import { qualityLabel } from '$lib/game/contracts';

  let {
    name,
    journal,
    history,
    instanceId,
    description = null,
    relationshipStage = null,
    archiveHref = null
  }: {
    name: string;
    journal: Journal | null;
    history: ServeReceipt[];
    instanceId: string;
    description?: string | null;
    relationshipStage?: Patron['relationshipStage'] | null;
    archiveHref?: string | null;
  } = $props();

  const titleId = $derived(`npc-history-${instanceId.replace(/[^a-zA-Z0-9_-]/g, '-')}-title`);
  const hospitality = $derived(history
    .filter((receipt) => receipt.instanceId === instanceId)
    .toSorted((left, right) => right.dayNumber - left.dayNumber || right.committedRevision - left.committedRevision));
  const stageLabel = $derived(relationshipStage ?? '');
  const availabilityLabel = $derived(journal?.availability === 'present' ? 'At the tavern'
    : journal?.availability === 'dead' ? 'Remembered'
      : journal?.availability === 'departed' ? 'Departed'
        : journal?.availability === 'dismissed' ? 'Dismissed'
          : journal?.availability === 'quarantined' ? 'Unavailable'
            : journal?.availability === 'removed' ? 'Removed' : 'History unavailable');
  const activeSetbacks = $derived.by(() => {
    const quest = journal?.currentQuest;
    if (!quest || journal?.questLifecycleStatus !== 'active') return [];
    return (journal.questHistory ?? [])
      .filter((event) => event.questId === quest.id && event.outcome === 'setback')
      .toSorted((left, right) => left.day - right.day);
  });
  const earlierEvolution = $derived.by(() => {
    const currentSummary = journal?.disposition?.summary;
    return (journal?.evolution ?? []).filter((entry) => entry.disposition.summary !== currentSummary);
  });

  function stepLabel(action: string): string {
    if (action === 'prepare') return 'Prepare';
    if (action === 'attempt') return 'Attempt';
    if (action === 'wait') return 'Wait';
    return 'Abandon';
  }
</script>

<section class="npc-history" aria-labelledby={titleId}>
  <header class="history-heading">
    <p class="eyebrow">{availabilityLabel}</p>
    <h2 id={titleId}>Journal</h2>
    {#if relationshipStage}<p class="relationship-line">Relationship <strong>{stageLabel}</strong></p>{/if}
  </header>

  {#if !journal}
    <p class="history-empty" role="status">Their journal is unavailable right now. Try again later.</p>
  {:else}
    {#if description}
      <section class="history-section" aria-label="Resident story">
        <h3>At the tavern</h3>
        <p>{description}</p>
      </section>
    {/if}

    <section class="history-section" aria-label="Quest history">
      <h3>{journal.currentQuest ? journal.currentQuest.title : journal.availability === 'present' ? 'No current quest' : 'Past intentions'}</h3>
      {#if journal.currentQuest}
        <p>{journal.currentQuest.objective}</p>
        <p class="quiet-line">
          {journal.questLifecycleStatus.replaceAll('_', ' ')}
          {#if journal.questLifecycleStatus === 'active'} · {journal.currentQuest.readiness} readiness · {journal.currentQuest.risk} risk{/if}
        </p>
        {#if journal.currentQuest.plan.length}
          <ol class="quest-steps" aria-label="Quest plan">
            {#each journal.currentQuest.plan as step, index (`${journal.currentQuest.id}:${index}`)}
              <li class:completed={index < journal.currentQuest.currentStep}>
                <small>{index < journal.currentQuest.currentStep ? 'Done' : index === journal.currentQuest.currentStep ? 'Next' : 'Later'}</small>
                <span>{stepLabel(step.action)} · {step.approach}</span>
              </li>
            {/each}
          </ol>
        {/if}
      {:else}
        <p class="quiet-line">No current intention.</p>
      {/if}

      {#if journal.questLifecycleStatus === 'awaiting_transition'}<p class="quiet-line">Considering a next step.</p>{/if}
      {#if journal.questLifecycleStatus === 'departing'}<p class="quiet-line">Leaving after the tavern closes.</p>{/if}
      {#if journal.farewellText}<p class="farewell">{journal.farewellText}</p>{/if}
      {#if activeSetbacks.length}
        <ul class="event-list" aria-label="Recent setbacks">
          {#each activeSetbacks as event (`${event.day}:${event.id}`)}
            <li><small>Day {event.day} · Setback</small><p>{event.text}</p></li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if journal.questArchive.items.length}
      <section class="history-section" aria-label="Completed quest history">
        <h3>Earlier quests</h3>
        <ol class="quest-archive">
          {#each journal.questArchive.items as quest (quest.id)}
            <li>
              <p class="quiet-line">Days {quest.activationDay}–{quest.terminalDay} · {quest.outcome}</p>
              <h4>{quest.title}</h4>
              <p>{quest.objective}</p>
              {#if quest.events.length}
                <ul class="event-list">
                  {#each quest.events as event (event.id)}
                    <li><small>Day {event.day} · {event.outcome}</small><p>{event.text}</p></li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ol>
        {#if journal.questArchive.nextCursor && archiveHref}
          <a class="history-link" href={archiveHref}>Earlier quest records</a>
        {/if}
      </section>
    {/if}

    {#if journal.disposition}
      <section class="history-section" aria-label="Recent disposition">
        <h3>How they seem lately</h3>
        <p>{journal.disposition.summary}</p>
        {#if journal.evolution.length > 1}
          <ol class="event-list evolution-list" aria-label="Earlier changes">
            {#each earlierEvolution as entry (`${entry.createdAt}:${entry.profileRevision}`)}
              <li><small>Day {entry.day}</small><p>{entry.disposition.summary}</p></li>
            {/each}
          </ol>
        {/if}
      </section>
    {:else if journal.evolution.length}
      <section class="history-section" aria-label="Resident changes">
        <h3>How they changed</h3>
        <ol class="event-list">
          {#each journal.evolution as entry (`${entry.createdAt}:${entry.profileRevision}`)}
            <li><small>Day {entry.day}</small><p>{entry.disposition.summary}</p></li>
          {/each}
        </ol>
      </section>
    {/if}

    <section class="history-section" aria-label="Conversation history">
      <h3>Conversations</h3>
      {#if journal.turns.length}
        <ol class="conversation-list" aria-label={`Conversation with ${name}`}>
          {#each journal.turns as turn (turn.id)}
            <li>
              <p class="quiet-line">Day {turn.day}</p>
              <p><strong>You</strong> {turn.message}</p>
              <p><strong>{name}</strong> {turn.reply}</p>
            </li>
          {/each}
        </ol>
      {:else}
        <p class="quiet-line">No conversations recorded yet.</p>
      {/if}
    </section>

    <section class="history-section" aria-label="Hospitality history">
      <h3>Hospitality</h3>
      {#if hospitality.length}
        <ol class="hospitality-list">
          {#each hospitality as receipt (receipt.actionId)}
            <li>
              <span><strong>{receipt.itemName}</strong><small>Day {receipt.dayNumber} · {qualityLabel(receipt.qualityIndex)} quality</small></span>
              <span class="hospitality-outcome">+{receipt.goldEarned} gold{receipt.relationshipChange ? ` · ${receipt.relationshipChange > 0 ? '+' : ''}${receipt.relationshipChange} relationship` : ''}</span>
            </li>
          {/each}
        </ol>
      {:else}
        <p class="quiet-line">No hospitality has been recorded.</p>
      {/if}
    </section>
  {/if}
</section>

<style>
  .npc-history {
    min-width: 0;
    max-block-size: min(65svh, 44rem);
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-color: #72562c transparent;
    scrollbar-width: thin;
  }

  .history-heading { padding-bottom: .9rem; border-bottom: 1px solid rgb(145 112 52 / 45%); }
  .history-heading .eyebrow { margin: 0 0 .2rem; }
  .history-heading h2 { margin: 0; color: var(--gold-bright, #f0d27a); font: 600 clamp(1.1rem, 2.3vw, 1.45rem) 'Cinzel', Georgia, serif; }
  .relationship-line { margin: .35rem 0 0; color: var(--muted, #b9aa88); }
  .relationship-line strong { color: var(--gold-bright, #f0d27a); text-transform: capitalize; }
  .history-section { padding: .85rem 0; border-bottom: 1px solid rgb(145 112 52 / 28%); }
  .history-section h3, .quest-archive h4 { margin: 0 0 .4rem; color: #ead39a; font-family: 'Cinzel', Georgia, serif; font-size: .92rem; }
  .history-section > p, .quest-archive p { margin: .25rem 0; line-height: 1.45; }
  .quiet-line, .event-list small, .hospitality-list small { color: var(--muted, #b9aa88); }
  .quest-steps, .event-list, .quest-archive, .conversation-list, .hospitality-list { margin: .55rem 0 0; padding: 0; list-style: none; }
  .quest-steps { display: flex; flex-wrap: wrap; gap: .4rem; }
  .quest-steps li { display: grid; gap: .1rem; padding: .35rem .5rem; border-left: 2px solid #806332; color: #d7c596; background: rgb(37 28 13 / 45%); font-size: .9rem; }
  .quest-steps li.completed { border-color: #849b60; }
  .quest-steps small { color: #c9aa61; font: .65rem 'Cinzel', Georgia, serif; text-transform: uppercase; }
  .event-list > li, .quest-archive > li, .conversation-list > li { padding: .65rem 0; border-top: 1px solid rgb(145 112 52 / 22%); }
  .event-list p, .conversation-list p { margin: .2rem 0; }
  .quest-archive h4 { margin-top: .25rem; }
  .farewell { padding-left: .7rem; border-left: 2px solid #ac7850; color: #dfbc85; }
  .history-link { display: inline-block; margin-top: .6rem; color: var(--gold-bright, #f0d27a); text-underline-offset: .2em; }
  .conversation-list { padding-right: .25rem; }
  .conversation-list strong { color: #e7cc7f; }
  .hospitality-list li { display: flex; align-items: baseline; justify-content: space-between; gap: .8rem; padding: .5rem 0; border-top: 1px solid rgb(145 112 52 / 22%); }
  .hospitality-list li > span:first-child { display: grid; gap: .08rem; }
  .hospitality-list strong { color: #e7cc7f; }
  .hospitality-outcome { color: #c3d59b; font-size: .88rem; text-align: right; }
  .history-empty { padding: .8rem 0; color: var(--muted, #b9aa88); }

  @media (max-width: 700px) {
    .npc-history { max-block-size: none; overflow: visible; overscroll-behavior: auto; }
    .hospitality-list li { align-items: flex-start; flex-direction: column; gap: .15rem; }
    .hospitality-outcome { text-align: left; }
  }

  @media (prefers-reduced-motion: reduce) {
    .npc-history { scroll-behavior: auto; }
  }
</style>
