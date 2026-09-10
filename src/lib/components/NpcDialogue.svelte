<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { DialogueInput, Journal, Offering, PatronKey } from '$lib/game/dialogue';
  import type { BarSnapshot } from '$lib/game/serving';
  let { patronKey, name, journal, stock, unavailable }: {patronKey:PatronKey;name:string;journal:Journal;stock:BarSnapshot;unavailable:string|null}=$props();
  let message=$state(''); let intentCardId=$state(''); let offeringSelection=$state(''); let busy=$state(false);
  let frozen=$state<DialogueInput|null>(null); let notice=$state(''); let failure=$state(false);
  let hydrated=$state(false);
  let restoredTurn=$state<string|null>(null);
  $effect(()=>{hydrated=true; if(journal.pending && journal.pending.turnId!==restoredTurn && !frozen) {
    restoredTurn=journal.pending.turnId; void recover(journal.pending.turnId);
  }});
  let cancelling=$state(false);
  let canRetry=$state(true);
  let operation=0;
  let posting:AbortController|undefined;
  let selectedIntent=$derived(stock.intentCards.find(card=>card.id===intentCardId));
  let selectedOffering=$derived(offeringSelection
    ? [...stock.beverages,...stock.foods].find(item=>`${item.kind}:${item.id}`===offeringSelection)
    : undefined);

  function intentMark(cardKey:string) {
    return ({charm:'CH',insight:'IN',flirt:'FL',rumor:'RU',intimidate:'IM'} as Record<string,string>)[cardKey] ?? cardKey.slice(0,2).toUpperCase();
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
    event.preventDefault(); if(busy||frozen&&!canRetry)return;
    if(!frozen)canRetry=true;
    const [offeringKind, offeringId] = offeringSelection.split(':', 2);
    const offering: Offering | null = offeringId && (offeringKind === 'food' || offeringKind === 'beverage')
      ? { kind: offeringKind, itemId: offeringId }
      : null;
    frozen??={turnId:crypto.randomUUID(),patronKey,message,expectedConversationSequence:journal.sequence,
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
    if(!frozen||cancelling)return;
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

<section class="npc-dialogue" aria-labelledby="conversation-heading">
  <h2 id="conversation-heading" class="sr-only">Talk with {name}</h2>

  {#if journal.availability!=='present'}
    <div class="dialogue-unavailable"><p class="eyebrow">{journal.availability==='dead'?'In memory':'Departed'}</p><p>This character's story has lasting consequences. Their conversations remain in your journal.</p></div>
  {:else}
    {#if unavailable}<p class="form-message dialogue-provider-notice" role="note">{unavailable}</p>{/if}
    <form onsubmit={send} class="dialogue-composer">
      <fieldset disabled={!hydrated||busy||!!unavailable}>
        <legend class="sr-only">Compose your message to {name}</legend>
        <div class="composer-row">
          <div class="keeper-seal" aria-hidden="true"><img src="/raven.svg" alt="" /><span>Keeper</span></div>
          <div class="parchment-input">
            <label for="npc-message" class="sr-only">Your message</label>
            <textarea id="npc-message" rows="2" maxlength="2000" required disabled={!!frozen} bind:value={message} placeholder="Say something…"></textarea>
            <div class="selection-summary" aria-live="polite">
              <span>{selectedIntent ? `Intent: ${selectedIntent.displayName}` : 'Speaking plainly'}</span>
              {#if selectedOffering}<span>Offering: {selectedOffering.name}</span>{/if}
            </div>
          </div>
          <button class="composer-send" aria-label={busy?'Considering your words…':frozen?'Retry the same message':'Speak'} disabled={!hydrated||busy||!!unavailable||!!frozen&&!canRetry||(!frozen&&!message.trim())}>
            <span>{busy?'Thinking…':frozen?'Retry':'Send'}</span><small>{frozen?'Same message':'Enter'}</small>
          </button>
        </div>

        <div class="composer-tools">
          <section class="intent-tool" aria-labelledby="intent-tool-title">
            <div class="tool-label"><p class="eyebrow" id="intent-tool-title">Choose your intent</p><span>Characterizes your words</span></div>
            <div class="intent-card-tray" role="group" aria-labelledby="intent-tool-title">
              <button type="button" class="intent-card plain" class:selected={intentCardId===''} aria-pressed={intentCardId===''} disabled={!!frozen} onclick={()=>intentCardId=''}>
                <strong>Plain</strong><small>No added intent</small>
              </button>
              {#each stock.intentCards as card (card.id)}
                <button type="button" class="intent-card intent-{card.cardKey}" class:selected={intentCardId===card.id} aria-pressed={intentCardId===card.id} disabled={!!frozen} onclick={()=>intentCardId=intentCardId===card.id?'':card.id}>
                  <span class="intent-mark" aria-hidden="true">{intentMark(card.cardKey)}</span>
                  <strong>{card.displayName}</strong><small>{card.description}</small>
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
      {#if frozen}<div class="recovery-actions"><button type="button" class="text-button" disabled={busy} onclick={()=>recover(frozen!.turnId)}>Check reply</button><button type="button" class="text-button" disabled={cancelling} onclick={cancel}>{cancelling?'Cancelling…':'Cancel unfinished message'}</button></div>{/if}
    </form>
  {/if}
  {#if notice}<p class="form-message dialogue-notice" class:error={failure} role={failure?'alert':'status'}>{notice}</p>{/if}

  <details class="dialogue-journal">
    <summary><span>Conversation journal</span><small>{journal.turns.length} exchange{journal.turns.length===1?'':'s'} · {journal.questStatus}</small></summary>
    <div class="journal-drawer">
      <section class="npc-intention">
        <p class="eyebrow">{journal.availability==='present'?'Current intention':journal.availability==='dead'?'In memory':'Departed'} · {journal.questStatus}</p>
        {#if journal.intention}<h3>{journal.intention.goal}</h3><p>{journal.intention.motivation}</p>{/if}
        {#if journal.questStatus==='active'}<p>Readiness: {journal.preparation===2?'well prepared':journal.preparation===1?'some preparation':'unprepared'} · Risk: {journal.risk}</p>{/if}
        {#if journal.questStatus==='active'&&journal.intention}
          <ol class="intention-steps" aria-label="Intended daily steps">
            {#each journal.intention.steps as step,index}<li class:completed={index<journal.nextStep}>
              {index<journal.nextStep?'Done':index===journal.nextStep?'Next outing':'Later'}: {step.action==='prepare'?'Prepare':step.action==='attempt'?'Attempt the objective':step.action==='wait'?'Wait':'Abandon the objective'} · {step.approach}
            </li>{/each}
          </ol>
        {/if}
        {#if journal.warning}<p class="form-message error" role="note">{journal.warning}</p>{/if}
      </section>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (The overflow transcript must be keyboard-scrollable.) -->
      <div class="npc-transcript" role="region" aria-label="Conversation history" tabindex="0">
        {#if journal.turns.length===0}<p class="muted">Ask about their plans, share advice, or simply get to know them.</p>{/if}
        {#each journal.turns as turn (turn.id)}
          <article class="npc-exchange"><p class="eyebrow">Day {turn.day}</p><p class="keeper-line"><strong>You</strong> {turn.message}</p><p><strong>{name}</strong> {turn.reply}</p></article>
        {/each}
      </div>
      {#if journal.events.length}<div class="npc-news"><p class="eyebrow">News and remembered events</p><ul>{#each journal.events as event (event.id)}<li><small>Day {event.day}</small> {event.text}</li>{/each}</ul></div>{/if}
    </div>
  </details>
</section>
