<script lang="ts">
  // Three disposable treatments of one shared burn-to-navigate workflow tree.
  import { tick, untrack } from 'svelte';
  import type { Snippet } from 'svelte';
  import CardHand from '$lib/components/ui/CardHand.svelte';
  import CardHandCard from '$lib/components/ui/CardHandCard.svelte';
  import CardBurnSurface from '$lib/components/ui/CardBurnSurface.svelte';
  import { resolveBurnAction, type BurnStyle } from '$lib/card-effects';
  import { getWorkflow } from './workflows';
  import type { WorkflowArea, WorkflowVariant, WorkflowChoice, WorkflowResult } from './types';

  let { area, variant, burnStyle = 'drip', scene }: {
    area: WorkflowArea; variant: WorkflowVariant; burnStyle?: BurnStyle;
    scene: Snippet<[{ selectedId: string | null; focused: boolean; onselect: (id: string) => void }]>;
  } = $props();
  const workflow = $derived(getWorkflow(area));
  let nodeId = $state(untrack(() => workflow.initialNodeId));
  let history = $state<string[]>([]);
  let transition = $state<{ target: string; choice: string | null; result?: WorkflowResult; back?: boolean } | null>(null);
  let burn = $state(untrack(() => resolveBurnAction(burnStyle)));
  let feedback = $state<WorkflowResult | null>(null);
  let draft = $state('');
  let sent = $state<Array<{ speaker: string; text: string }>>([]);
  let surface = $state<HTMLElement>();
  let input = $state<HTMLTextAreaElement>();
  const node = $derived(workflow.nodes[nodeId] ?? workflow.nodes[workflow.initialNodeId]);
  const focused = $derived(node.id !== workflow.initialNodeId);
  const directRoot = $derived((area === 'bar' || area === 'garden') && !focused);
  const busy = $derived(transition !== null);
  const visibleChoices = $derived(node.chat?.input && draft.trim()
    ? [{ id: 'send-reply', title: 'Send reply', eyebrow: 'TALK', detail: 'Offer your words, then listen.', icon: '“' }, ...node.choices]
    : node.choices);

  function navigate(target: string, choice: string | null = null, result?: WorkflowResult, back = false) {
    if (busy || (!workflow.nodes[target] && !result)) return;
    burn = resolveBurnAction(burnStyle);
    transition = { target, choice, result, back };
    if (directRoot || visibleChoices.length === 0) void completeTransition();
  }
  function choose(choice: WorkflowChoice) {
    if (choice.id === 'send-reply') {
      navigate(nodeId, choice.id, { title: 'Reply offered', detail: node.chat?.input?.response.text ?? '' });
      return;
    }
    navigate(choice.next ?? nodeId, choice.id, choice.result);
  }
  async function completeTransition() {
    if (!transition) return;
    const action = transition;
    transition = null;
    if (action.choice === 'send-reply') {
      sent = [...sent, { speaker: 'You', text: draft.trim() }, ...(node.chat?.input ? [node.chat.input.response] : [])];
      draft = '';
    } else if (action.target !== nodeId) {
      const target = workflow.nodes[action.target]?.id ?? action.target;
      const prior = history.lastIndexOf(target);
      history = action.back || prior >= 0 ? history.slice(0, prior >= 0 ? prior : -1) : [...history, node.id];
      nodeId = target;
      sent = []; draft = '';
    }
    feedback = action.choice === 'send-reply' ? null : action.result ?? null;
    await tick();
    if (node.kind === 'chat') input?.focus({ preventScroll: true });
    else surface?.querySelector<HTMLElement>('[data-card-hand] button:not(:disabled)')?.focus({ preventScroll: true });
  }
  function back() { if (history.length) navigate(history[history.length - 1], null, undefined, true); }
  function escape(event: KeyboardEvent) {
    if (event.key === 'Escape' && history.length && !busy) { event.preventDefault(); back(); }
  }
</script>

<svelte:window onkeydown={escape} />
<section bind:this={surface} class="workflow-stage" class:folio={variant === 'B'} class:spotlight={variant === 'C'}
  data-workflow-area={area} data-workflow-node={node.id} data-workflow-variant={variant} aria-label={`${workflow.title} prototype`}>
  {@render scene({ selectedId: node.scene?.id ?? node.id, focused, onselect: (id) => navigate(id) })}
  <header class="scene-heading">
    <div><h1>{workflow.title}</h1></div>
  </header>
  {#if history.length}
    <nav class="path" aria-label="Parent location">
      <span>{workflow.nodes[history[history.length - 1]]?.title ?? workflow.title}</span>
    </nav>
  {/if}
  {#if directRoot}
    <div class="target-hint">
      <p>{area === 'bar' ? 'Select a patron or keepsake in the scene.' : 'Select a garden plot to tend it.'}</p>
      {#if area === 'bar'}<button type="button" onclick={() => navigate('bar-journal')}>House journal</button>{/if}
    </div>
  {:else}
  {#key node.id}
  <section class="detail" class:root-node={node.id === workflow.initialNodeId} class:reading={node.kind === 'journal'} class:chatting={node.kind === 'chat'} aria-labelledby="workflow-node-title">
    {#if node.scene?.label && node.scene.label.toLocaleLowerCase() !== node.title.toLocaleLowerCase() && node.scene.label.toLocaleLowerCase() !== (history.length ? workflow.nodes[history[history.length - 1]]?.title?.toLocaleLowerCase() : '')}
      <p class="eyebrow">{node.scene.label}</p>
    {/if}
    <h2 id="workflow-node-title">{node.title}</h2>
    {#if node.kind !== 'chat'}<p class="description">{node.description}</p>{/if}
    {#if node.entries}
      <div class="journal-entries">{#each node.entries as entry}
        <article><small>{entry.when ?? 'Journal'}</small><h3>{entry.title}</h3><p>{entry.detail}</p></article>
      {/each}</div>
    {/if}
    {#if node.chat}
      <div class="messages" aria-live="polite">{#each [...node.chat.messages, ...sent] as message}
        <p><b>{message.speaker}</b><span>{message.text}</span></p>
      {/each}</div>
      {#if node.chat.input}
        <label class="reply-label" for="prototype-reply">Your reply</label>
        <textarea bind:this={input} id="prototype-reply" bind:value={draft} placeholder={node.chat.input.placeholder} disabled={busy} rows="2"></textarea>
      {/if}
    {/if}
    {#if node.result || feedback}
      {@const result = feedback ?? node.result!}
      <p class="result" role="status"><b>{result.title}</b><span>{result.detail}</span></p>
    {/if}
  </section>
  <div class="hand-dock" class:subdued={variant === 'C' && focused} aria-busy={busy}>
    <CardHand items={visibleChoices} getKey={(choice) => choice.id} label={`${node.title} choices`} selectedId={transition?.choice}>
      {#snippet card(choice, index)}
        <CardBurnSurface active={busy} treatment={burn.treatment} durationMs={burn.durationMs} oncomplete={index === 0 ? completeTransition : undefined}>
          <CardHandCard label={choice.title} disabled={busy} onclick={() => choose(choice)}>
            <div class="card-art" aria-hidden="true"><span>{choice.icon ?? '✧'}</span></div>
            <div class="card-copy"><p class="eyebrow">{choice.eyebrow ?? 'Choice'}</p><h3>{choice.title}</h3><p>{choice.detail}</p></div>
            <span class="card-action">{choice.result ? 'Make it so' : 'Choose'} <span aria-hidden="true">↗</span></span>
          </CardHandCard>
        </CardBurnSurface>
      {/snippet}
    </CardHand>
  </div>
  {/key}
  {/if}
</section>

<style>
  .workflow-stage { position: relative; isolation: isolate; min-height: 600px; height: calc(100dvh - 185px); max-height: 1000px; overflow: hidden; border: 1px solid #92723f77; border-radius: .85rem; background: #140e08; color: #f0dfb8; }
  .workflow-stage::after { content: ''; position: absolute; inset: 0; z-index: 1; pointer-events: none; background: linear-gradient(#0c080655,transparent 35%,#0c0806b3); }
  .target-hint { position: absolute; z-index: 3; bottom: 1rem; left: 50%; translate: -50% 0; display: flex; align-items: center; gap: 1rem; max-width: calc(100% - 2rem); padding: .65rem 1rem; border-radius: .6rem; background: #160f09b8; font-size: .8rem; }
  .target-hint button { min-height: 40px; white-space: nowrap; color: #f0d394; border: 1px solid #9b793c; border-radius: .4rem; padding: .4rem .6rem; background: #20170ac9; cursor: pointer; }
  .target-hint button:focus-visible { outline: 2px solid #f9d981; outline-offset: 3px; }
  .scene-heading { position: absolute; z-index: 3; top: 1rem; left: 1.3rem; right: 1.3rem; display: flex; align-items: start; justify-content: space-between; gap: 1rem; text-shadow: 0 2px 4px #000; pointer-events: none; }
  h1 { font-size: clamp(1.2rem, 2.2vw, 2rem); margin: 0; }
  h2 { font-size: 1.2rem; margin: .2rem 0 .45rem; }
  h3 { font-size: .9rem; margin: .2rem 0; }
  p { margin: 0; }
  .eyebrow { font-size: .62rem; letter-spacing: .12em; color: #d9b772; text-transform: uppercase; margin: 0; }
  .path { position: absolute; z-index: 3; top: 5.3rem; left: 1.3rem; display: flex; align-items: center; gap: .5rem; padding: .25rem .55rem; background: #130d08c9; border-radius: .3rem; font-size: .72rem; }
  .path { color: #e5d2ac; }
  .detail { position: absolute; z-index: 4; bottom: 21rem; left: 50%; transform: translateX(-50%); width: min(42rem,calc(100% - 3rem)); max-height: 13rem; overflow: auto; padding: .85rem 1.2rem; border: 1px solid #ac88523d; border-radius: .7rem; background: #20170bd9; backdrop-filter: blur(7px); animation: detail-enter 180ms ease-out; }
  .detail.root-node { width: min(36rem,calc(100% - 3rem)); max-height: 5.5rem; padding: .2rem 1rem; border-color: transparent; background: transparent; backdrop-filter: none; box-shadow: none; text-align: center; }
  .description { font-size: .8rem; line-height: 1.5; color: #dccba8; }
  .detail, .messages, .journal-entries { scrollbar-width: thin; scrollbar-color: #ab874e transparent; }
  .folio .detail { top: 8rem; bottom: auto; right: 1.3rem; left: auto; transform: none; width: 21rem; max-height: calc(100% - 30rem); background: #21180cb8; }
  .spotlight .detail { top: 8rem; bottom: auto; width: 26rem; max-height: calc(100% - 29rem); background: #20170be8; box-shadow: 0 1rem 4rem #0007; }
  .hand-dock { position: absolute; z-index: 5; left: 0; right: 0; bottom: 1.1rem; animation: deal-hand 200ms ease-out; }
  .hand-dock.subdued { opacity: .68; transition: opacity 160ms ease; }
  .hand-dock.subdued:hover, .hand-dock.subdued:focus-within { opacity: 1; }
  .card-art { min-height: 4.7rem; display: grid; place-items: center; border-radius: .4rem; background: radial-gradient(ellipse at center,#86602e66,transparent 70%); border-bottom: 1px solid #9d793f55; }
  .card-art span { font-size: 2.7rem; color: #e0bb73; text-shadow: 0 2px 8px #0007; }
  .card-copy p:not(.eyebrow) { font-size: .72rem; line-height: 1.4; color: #cbb894; margin-top: .4rem; }
  .card-action { font-size: .63rem; border-top: 1px solid #92754455; padding-top: .5rem; color: #e0c787; display: flex; justify-content: space-between; }
  .journal-entries article { padding: .6rem 0; border-bottom: 1px solid #9a79364d; }
  .journal-entries small { color: #c8a96b; font-size: .64rem; }
  .journal-entries p, .messages p { font-size: .8rem; line-height: 1.5; }
  .messages { max-height: 8rem; overflow: auto; margin: .6rem 0; }
  .messages p { display: grid; gap: .15rem; margin-bottom: .6rem; }
  .messages b, .result b { color: #dfbc75; }
  .reply-label { display: block; font-size: .7rem; margin: .4rem 0; }
  textarea { width: 100%; min-height: 60px; padding: .6rem; resize: vertical; color: #f0dfb8; background: #100c08c9; border: 1px solid #957441; border-radius: .4rem; font: inherit; font-size: .8rem; }
  .result { display: grid; gap: .25rem; margin-top: .65rem; padding-top: .6rem; border-top: 1px solid #98753f66; font-size: .8rem; }
  textarea:focus-visible { outline: 2px solid #f9d981; outline-offset: 3px; }
  @keyframes detail-enter { from { opacity: 0; } to { opacity: 1; } }
  @keyframes deal-hand { from { opacity: 0; translate: 0 12px; } to { opacity: 1; translate: 0 0; } }
  @media (max-width: 700px) {
    .workflow-stage { height: auto; min-height: 770px; max-height: none; padding-top: 340px; overflow: hidden; }
    .workflow-stage:has(.target-hint) { min-height: 390px; padding-bottom: 4rem; }
    .target-hint { bottom: .75rem; width: calc(100% - 1.3rem); max-width: none; padding: .6rem; font-size: .75rem; }
    .workflow-stage :global(.prototype-scene) { height: 340px; bottom: auto; }
    .scene-heading { left: .75rem; right: .75rem; top: .65rem; }
    .scene-heading h1 { font-size: 1.1rem; }
    .path { top: 4.6rem; left: .75rem; right: .75rem; width: fit-content; max-width: calc(100% - 1.5rem); }
    .detail, .folio .detail, .spotlight .detail { position: relative; inset: auto; transform: none; width: auto; margin: .5rem .65rem 0; max-height: 230px; padding: .8rem; }
    .hand-dock { position: relative; bottom: auto; margin-top: .2rem; }
    .workflow-stage::after { background: linear-gradient(#0c080655,transparent 25%,#0c080622 40%); }
    .card-art { min-height: 3.8rem; }
  }
  @media (prefers-reduced-motion: reduce) { .detail, .hand-dock { animation: none; transition: none; } }
</style>
