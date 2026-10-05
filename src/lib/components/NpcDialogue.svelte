<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { DialogueInput, Journal, Offering } from '$lib/game/dialogue';
  import type { BarSnapshot } from '$lib/game/serving';
  let { npcId, name, journal, stock, unavailable, archiveHref = null, archived = false, embedded = false, journalOnly = false, blocked = false, onbusychange }: {npcId:string;name:string;journal:Journal;stock:BarSnapshot;unavailable:string|null;archiveHref?:string|null;archived?:boolean;embedded?:boolean;journalOnly?:boolean;blocked?:boolean;onbusychange?:(busy:boolean)=>void}=$props();
  let message=$state(''); let intentCardId=$state(''); let offeringSelection=$state(''); let busy=$state(false);
  let frozen=$state<DialogueInput|null>(null); let notice=$state(''); let failure=$state(false);
  let hydrated=$state(false);
  let restoredTurn=$state<string|null>(null);
  $effect(()=>{hydrated=true; if(journal.pending && journal.pending.turnId!==restoredTurn && !frozen) {
    restoredTurn=journal.pending.turnId; void recover(journal.pending.turnId);
  }});
  let cancelling=$state(false);
  let canRetry=$state(true);
  $effect(()=>{onbusychange?.(busy || frozen !== null);});
  onDestroy(()=>onbusychange?.(false));
  let operation=0;
  let posting:AbortController|undefined;
  let selectedIntent=$derived(stock.intentCards.find(card=>card.id===intentCardId));
  // Intent cards are individual stock items. Group identical effects for a
  // calmer picker while retaining a concrete stock ID for the dialogue API.
  let intentOptions=$derived.by(()=>{
    const grouped=new Map<string,{card:typeof stock.intentCards[number];count:number;ids:string[]}>();
    const tiersByName=new Map<string,Set<string>>();
    for(const card of stock.intentCards) {
      const nameKey=JSON.stringify([card.cardKey,card.displayName]);
      const tiers=tiersByName.get(nameKey) ?? new Set<string>();
      tiers.add(card.tier);
      tiersByName.set(nameKey,tiers);
      const key=JSON.stringify([card.cardKey,card.displayName,card.description,card.tier]);
      const existing=grouped.get(key);
      if(existing) { existing.count+=1; existing.ids.push(card.id); }
      else grouped.set(key,{card,count:1,ids:[card.id]});
    }
    return [...grouped.values()].map((option)=>({
      ...option,
      label: (tiersByName.get(JSON.stringify([option.card.cardKey,option.card.displayName]))?.size ?? 0) > 1
        ? `${option.card.displayName} · ${tierLabel(option.card.tier)}`
        : option.card.displayName
    }));
  });
  let selectedOffering=$derived(offeringSelection
    ? [...stock.beverages,...stock.foods].find(item=>`${item.kind}:${item.id}`===offeringSelection)
    : undefined);

  function tierLabel(tier:string) {
    return ({fine:'Fine',superior:'Superior',exceptional:'Exceptional'} as Record<string,string>)[tier] ?? tier;
  }

  async function acceptStatus(body:any, completedNotice='Your last reply was saved.') {
    failure=false;
    if(body.status==='completed') {
      frozen=null;message='';intentCardId='';offeringSelection='';notice=completedNotice;
      await invalidateAll();
    } else if(body.status==='cancelled'||body.status==='stale') {
      frozen=null;notice=body.status==='cancelled'?'Unfinished message cancelled.':'That message is closed. You can send a new message.';
      await invalidateAll();
    } else {
      frozen=body.input;message=body.input.message;intentCardId=body.input.intentCardId??'';
      offeringSelection=body.input.offering ? `${body.input.offering.kind}:${body.input.offering.itemId}` : '';
      canRetry=body.canRetry??body.status!=='processing';
      notice=body.status==='processing'?'Your conversation is still being completed. Check again shortly.'
        :canRetry?'The last reply was not completed. Retry the same message or cancel it.'
        :'This reply cannot be resumed. Cancel the unfinished message, then edit it before sending again.';
    }
  }
  async function recover(id:string) {
    if(blocked||busy)return;
    const current=++operation;busy=true;failure=false;
    try {
      const r=await fetch(`/api/dialogue/${id}`);const body=await r.json();
      if(current!==operation)return;
      if(!r.ok)throw new Error(body.message);
      await acceptStatus(body);
    } catch {
      if(current===operation){notice='The conversation could not be checked. Please retry.';failure=true;}
    } finally {if(current===operation)busy=false;}
  }
  async function send(event:SubmitEvent) {
    event.preventDefault(); if(blocked||busy||frozen&&!canRetry)return;
    if(!frozen)canRetry=true;
    const [offeringKind, offeringId] = offeringSelection.split(':', 2);
    const offering: Offering | null = offeringId && (offeringKind === 'food' || offeringKind === 'beverage')
      ? { kind: offeringKind, itemId: offeringId }
      : null;
    frozen??={turnId:crypto.randomUUID(),npcId,message,expectedConversationSequence:journal.sequence,
      interactionVersion:'dialogue-v2',intentCardId:intentCardId||null,offering};
    const command=frozen as DialogueInput;const current=++operation;
    const controller=new AbortController();posting=controller;
    busy=true;notice='';failure=false;
    try {
      const response=await fetch('/api/dialogue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command),signal:controller.signal});
      const body=await response.json();
      if(current!==operation)return;
      if(!response.ok) {
        canRetry=!['CONSISTENCY','CONTEXT_BUDGET'].includes(body.code);
        if([400,409,422].includes(response.status)) {
          // Only a confirmed closure (or a missing turn after POST has finished) releases the command.
          const closed=await fetch(`/api/dialogue/${command.turnId}`,{method:'DELETE'});
          if(current!==operation)return;
          if(closed.ok){const status=await closed.json();await acceptStatus(status);if(status.status==='completed')return;}
          else if(closed.status===404){frozen=null;await invalidateAll();}
        }
        throw new Error(body.message);
      }
      if(body.status==='completed')await acceptStatus(body,'Reply saved.');
      else {canRetry=false;notice='Your conversation is still being completed. Check again shortly.';}
    } catch(cause) {
      if(current===operation){failure=true;notice=cause instanceof Error?cause.message:'The result is unknown. Check the conversation before retrying.';}
    } finally {
      if(posting===controller)posting=undefined;
      if(current===operation)busy=false;
    }
  }
  async function cancel() {
    if(blocked||!frozen||cancelling)return;
    const command=frozen;const current=++operation;const pendingPost=posting;
    busy=true;cancelling=true;failure=false;
    try {
      const r=await fetch(`/api/dialogue/${command.turnId}`,{method:'DELETE'});
      const body=await r.json();
      if(!r.ok)throw new Error();
      if(!['completed','cancelled','stale'].includes(body.status))throw new Error();
      // Fence the server turn first. Aborting the browser request alone cannot cancel a generation.
      pendingPost?.abort();
      await acceptStatus(body);
    } catch {
      failure=true;notice='Cancellation could not be confirmed. Check the reply or try cancelling again.';
    } finally {cancelling=false;if(current===operation)busy=false;}
  }
</script>

<section class="npc-dialogue" class:embedded class:journal-only={journalOnly} aria-labelledby="conversation-heading">
  <h2 id="conversation-heading" class="sr-only">{journalOnly ? `Journal for ${name}` : `Talk with ${name}`}</h2>

  {#if journalOnly}
    {#if journal.availability!=='present' || archived}
      <div class="dialogue-unavailable" role="status"><p class="eyebrow">{archived ? 'Read-only archive' : journal.availability==='dead'?'In memory':journal.availability==='departed'?'Departed':'Unavailable'}</p><p>This character's story has lasting consequences. Their conversations remain in your journal.</p></div>
    {/if}
  {:else if journal.availability!=='present' || archived}
    <div class="dialogue-unavailable"><p class="eyebrow">{archived ? 'Read-only archive' : journal.availability==='dead'?'In memory':journal.availability==='departed'?'Departed':'Unavailable'}</p><p>This character's story has lasting consequences. Their conversations remain in your journal.</p></div>
  {:else}
    {#if unavailable}<p class="form-message dialogue-provider-notice" role="note">{unavailable}</p>{/if}
    <form onsubmit={send} class="dialogue-composer">
      <fieldset disabled={!hydrated||busy||!!unavailable||blocked}>
        <legend class="sr-only">Compose your message to {name}</legend>
        <div class="composer-row">
          <div class="keeper-seal" aria-hidden="true"><img src="/raven.svg" alt="" /><span>Keeper</span></div>
          <div class="parchment-input">
            <label for="npc-message" class="sr-only">Your message</label>
            <textarea id="npc-message" rows="2" maxlength="2000" required disabled={!!frozen} bind:value={message} placeholder="Say something…"></textarea>
            <div class="selection-summary" aria-live="polite">
              <span>{selectedIntent ? `Intent: ${selectedIntent.displayName} · ${tierLabel(selectedIntent.tier)}` : 'Speaking plainly'}</span>
              {#if selectedOffering}<span>Offering: {selectedOffering.name}</span>{/if}
            </div>
          </div>
          <button class="composer-send" aria-label={busy?'Considering your words…':frozen?'Retry the same message':'Speak'} disabled={!hydrated||busy||!!unavailable||blocked||!!frozen&&!canRetry||(!frozen&&!message.trim())}>
            <span>{busy?'Thinking…':frozen?'Retry':'Send'}</span><small>{frozen?'Same message':'Enter'}</small>
          </button>
        </div>

        <div class="composer-tools">
          <section class="intent-tool" aria-labelledby="intent-tool-title">
            <div class="tool-label"><p class="eyebrow" id="intent-tool-title">Choose your intent</p><span>Characterizes your words</span></div>
            <div class="intent-picker" role="group" aria-labelledby="intent-tool-title">
              <button type="button" class="intent-option" aria-pressed={intentCardId===''} disabled={!!frozen} onclick={()=>intentCardId=''}>
                <span>Plain</span>
              </button>
              {#each intentOptions as option (`${option.card.cardKey}:${option.card.displayName}:${option.card.description}:${option.card.tier}`)}
                <button type="button" class="intent-option intent-{option.card.cardKey}" class:selected={option.ids.includes(intentCardId)} aria-pressed={option.ids.includes(intentCardId)} aria-label={`${option.label}${option.count > 1 ? `, ${option.count} cards available` : ''}: ${option.card.description}`} title={option.card.description} disabled={!!frozen} onclick={()=>intentCardId=option.ids.includes(intentCardId)?'':option.card.id}>
                  <span>{option.label}</span>{#if option.count > 1}<small aria-hidden="true">×{option.count}</small>{/if}
                </button>
              {/each}
            </div>
          </section>

          <label class="hospitality-tool">
            <span><strong>Food &amp; drink</strong><small>Optional, separate from intent</small></span>
            <select bind:value={offeringSelection} aria-label="Offer hospitality" disabled={!!frozen}>
              <option value="">No food or drink</option>
              {#each stock.beverages as beverage}<option value={`beverage:${beverage.id}`}>Drink · {beverage.name}</option>{/each}
              {#each stock.foods as food}<option value={`food:${food.id}`}>Food · {food.name}</option>{/each}
            </select>
          </label>
        </div>
      </fieldset>
      {#if frozen}<div class="recovery-actions"><button type="button" class="text-button" disabled={busy||blocked} onclick={()=>recover(frozen!.turnId)}>Check reply</button><button type="button" class="text-button" disabled={cancelling||blocked} onclick={cancel}>{cancelling?'Cancelling…':'Cancel unfinished message'}</button></div>{/if}
    </form>
  {/if}
  {#if !journalOnly && notice}<p class="form-message dialogue-notice" class:error={failure} role={failure?'alert':'status'}>{notice}</p>{/if}

  {#snippet journalContent()}
    <div class="journal-drawer">
      {#if !journalOnly}<section class="npc-intention">
        <p class="eyebrow">{journal.availability==='present'?'Current quest':journal.availability==='dead'?'In memory':'Departed'} · {journal.questLifecycleStatus.replace('_',' ')}</p>
        {#if journal.currentQuest}<h3>{journal.currentQuest.title}</h3><p>{journal.currentQuest.objective}</p>{/if}
        {#if journal.questLifecycleStatus==='awaiting_transition'}<p>They are considering their next step.</p>{/if}
        {#if journal.questLifecycleStatus==='departing'}<p>They are leaving after the tavern closes.</p>{/if}
        {#if journal.questLifecycleStatus==='active'&&journal.currentQuest}
          <p>Readiness: {journal.currentQuest.readiness} · Risk: {journal.currentQuest.risk}. Food and drink can help their readiness.</p>
          <ol class="intention-steps" aria-label="Intended daily steps">
            {#each journal.currentQuest.plan as step,index}<li class:completed={index<journal.currentQuest.currentStep}>
              {index<journal.currentQuest.currentStep?'Done':index===journal.currentQuest.currentStep?'Next outing':'Later'}: {step.action==='prepare'?'Prepare':step.action==='attempt'?'Attempt the objective':step.action==='wait'?'Wait':'Abandon the objective'} · {step.approach}
            </li>{/each}
          </ol>
        {/if}
        {#if journal.farewellText}<p class="form-message" role="note">{journal.farewellText}</p>{/if}
      </section>{/if}
      {#if journal.disposition}
        <section class="npc-news" aria-label="How they seem lately">
          <p class="eyebrow">How they seem lately</p>
          <p>{journal.disposition.summary}</p>
        </section>
      {/if}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (The overflow transcript must be keyboard-scrollable.) -->
      <div class="npc-transcript" role="region" aria-label="Conversation history" tabindex="0">
        {#if journal.turns.length===0}<p class="muted">Ask about their plans, share advice, or simply get to know them.</p>{/if}
        {#each journal.turns as turn (turn.id)}
          <article class="npc-exchange"><p class="eyebrow">Day {turn.day}</p><p class="keeper-line"><strong>You</strong> {turn.message}</p><p><strong>{name}</strong> {turn.reply}</p></article>
        {/each}
      </div>
      {#if journal.evolution.length}
        <section class="npc-news" aria-label="What shaped them">
          <p class="eyebrow">What shaped them</p>
          <ul>{#each journal.evolution as entry (`${entry.createdAt}:${entry.profileRevision}`)}<li><small>Day {entry.day}</small> {entry.disposition.summary}</li>{/each}</ul>
        </section>
      {/if}
      {#if journal.questArchive.items.length}
        <section class="npc-news" aria-label="Quest archive"><p class="eyebrow">Quest archive</p>
          {#each journal.questArchive.items as quest (quest.id)}
            <article><p class="eyebrow">Days {quest.activationDay}–{quest.terminalDay} · {quest.origin === 'authored_milestone' ? 'Authored quest' : 'Successor quest'} · {quest.outcome}</p><h3>{quest.title}</h3><p>{quest.objective}</p>
              {#if quest.events.length}<ul>{#each quest.events as event (event.id)}<li><small>Day {event.day} · {event.outcome}</small> {event.text}</li>{/each}</ul>{/if}
            </article>
          {/each}
          {#if journal.questArchive.nextCursor && archiveHref}<a class="text-button" href={archiveHref}>Earlier quests</a>{/if}
        </section>
      {/if}
    </div>
  {/snippet}
  {#if journalOnly}
    <div class="journal-destination" aria-label="Conversation and quest journal">
      {@render journalContent()}
    </div>
  {:else if !embedded}
    <details class="dialogue-journal">
      <summary><span>Conversation journal</span><small>{journal.turns.length} exchange{journal.turns.length===1?'':'s'} · {journal.questLifecycleStatus.replace('_',' ')}</small></summary>
      {@render journalContent()}
    </details>
  {/if}
</section>

<style>
  .npc-dialogue.embedded {
    grid-area: auto;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
  }

  .embedded .composer-row {
    grid-template-columns: minmax(0, 1fr) 76px;
  }

  .embedded .keeper-seal {
    display: none;
  }

  .npc-dialogue.embedded .composer-tools {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: .6rem;
  }

  .npc-dialogue.embedded .intent-tool {
    display: block;
    min-width: 0;
  }

  .npc-dialogue.embedded .tool-label {
    display: block;
    margin-bottom: .35rem;
  }

  .embedded .tool-label .eyebrow {
    margin: 0;
    white-space: nowrap;
  }

  .embedded .tool-label span {
    display: none;
  }

  .npc-dialogue.embedded .intent-picker {
    display: flex;
    flex-flow: row wrap;
    align-items: center;
    gap: .35rem;
    min-width: 0;
    overflow: visible;
  }

  .intent-option {
    display: inline-flex;
    min-height: 34px;
    align-items: center;
    justify-content: center;
    gap: .35rem;
    padding: .35rem .65rem;
    border: 1px solid #735a31;
    border-radius: 999px;
    color: #d8c28f;
    background: #20180f;
    font: 600 12px 'EB Garamond', Georgia, serif;
    cursor: pointer;
    transition: color 140ms ease, background-color 140ms ease, border-color 140ms ease, transform 140ms ease;
  }

  .intent-option small {
    color: inherit;
    font-size: 10px;
    opacity: .8;
  }

  .intent-option.selected,
  .intent-option[aria-pressed='true'] {
    border-color: #e1bd61;
    color: #ffe6a0;
    background: #463419;
    box-shadow: inset 0 0 0 1px rgb(225 189 97 / 18%);
  }

  .intent-option:hover:not(:disabled) {
    border-color: #c29b51;
    transform: translateY(-1px);
  }

  .intent-option:focus-visible,
  .embedded .hospitality-tool select:focus-visible,
  .embedded .parchment-input textarea:focus-visible {
    outline: 2px solid #f0cd72;
    outline-offset: 2px;
  }

  .intent-option:disabled {
    cursor: not-allowed;
    opacity: .65;
  }

  .npc-dialogue.embedded .hospitality-tool {
    display: flex;
    flex-flow: row wrap;
    align-items: center;
    justify-content: space-between;
    gap: .5rem;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .npc-dialogue.embedded .hospitality-tool > span {
    display: flex;
    align-items: baseline;
    gap: .35rem;
  }

  .npc-dialogue.embedded .hospitality-tool strong {
    white-space: nowrap;
  }

  .npc-dialogue.embedded .hospitality-tool small {
    display: none;
  }

  .npc-dialogue.embedded .hospitality-tool select {
    width: min(100%, 15rem);
    max-width: 15rem;
  }

  .embedded.journal-only .journal-destination {
    min-width: 0;
  }

  .embedded.journal-only .journal-drawer {
    grid-template-columns: minmax(0, 1fr);
    padding-top: 0;
  }

  .embedded.journal-only .npc-news,
  .embedded.journal-only .npc-transcript {
    grid-column: auto;
  }

  @media (max-width: 700px) {
    .npc-dialogue.embedded .composer-tools {
      display: flex;
      gap: .5rem;
    }

    .npc-dialogue.embedded .intent-tool {
      display: block;
    }

    .npc-dialogue.embedded .hospitality-tool > span {
      align-items: baseline;
      flex-direction: row;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .intent-option {
      transition: none;
    }
  }
</style>
