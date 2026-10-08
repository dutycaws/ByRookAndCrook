<script lang="ts">
  import type { BurnTreatment } from './types';

  let { treatment, durationMs }: { treatment: BurnTreatment; durationMs: number } = $props();
</script>

<span class="category-burn" data-treatment={treatment} style={`--burn-duration:${durationMs}ms`} aria-hidden="true">
  <span class="flame-tongue tongue-one"></span>
  <span class="flame-tongue tongue-two"></span>
  <span class="flame-tongue tongue-three"></span>
  <span class="flame-tongue tongue-four"></span>
  <span class="flame-tongue tongue-five"></span>
  <span class="flame-tongue tongue-six"></span>
  <span class="falling-ash ash-one"></span>
  <span class="falling-ash ash-two"></span>
  <span class="falling-ash ash-three"></span>
  {#if treatment === 'ash'}
    <span class="ash-fragment fragment-one"></span>
    <span class="ash-fragment fragment-two"></span>
    <span class="ash-fragment fragment-three"></span>
    <span class="ash-fragment fragment-four"></span>
    <span class="ash-fragment fragment-five"></span>
    <span class="ash-fragment fragment-six"></span>
  {/if}
</span>

<style>
  .category-burn { position: absolute; z-index: 3; inset: -.2rem; overflow: visible; border-radius: inherit; pointer-events: none; }
  .category-burn[data-treatment='crawl'] { inset: 0; }
  .category-burn[data-treatment='drip'] { inset: -.2rem 0; }
  .category-burn[data-treatment='ash'] { inset: -.65rem -.2rem; }
  .category-burn::before, .category-burn::after { position: absolute; content: ''; inset: 0; border-radius: inherit; opacity: 0; }

  .category-burn[data-treatment='crawl']::before {
    border: 5px solid rgba(255, 160, 46, .88);
    box-shadow: inset 0 0 22px rgba(255, 194, 81, .75), 0 0 14px rgba(236, 104, 28, .82);
    animation: crawl-in var(--burn-duration) ease-in forwards;
  }
  .category-burn[data-treatment='crawl']::after {
    background: radial-gradient(ellipse at center, rgba(58, 40, 27, .88), rgba(25, 17, 11, .3) 45%, transparent 72%);
    animation: crawl-char var(--burn-duration) ease-in forwards;
  }

  .category-burn[data-treatment='drip']::before {
    inset: -.25rem 0 auto;
    height: 1.35rem;
    border-radius: 45%;
    background: linear-gradient(180deg, #fff3ac, #ffad39 38%, rgba(216, 66, 23, .12));
    box-shadow: 0 0 14px rgba(255, 143, 35, .92), 0 3px 9px rgba(232, 76, 23, .82);
    clip-path: polygon(0 0, 100% 0, 100% 53%, 91% 32%, 83% 100%, 72% 40%, 62% 78%, 52% 24%, 42% 100%, 31% 38%, 22% 86%, 11% 31%, 0 70%);
    transform: translateY(-50%);
    animation: drip-front var(--burn-duration) ease-in forwards;
  }
  .category-burn[data-treatment='drip']::after {
    inset: 0 0 auto;
    height: .3rem;
    border-radius: 50%;
    background: linear-gradient(90deg, transparent, rgba(26, 20, 15, .95) 16% 84%, transparent);
    box-shadow: 0 0 5px rgba(24, 18, 13, .8);
    transform: translateY(-50%);
    animation: drip-char-front var(--burn-duration) ease-in forwards;
  }

  .category-burn[data-treatment='ash']::before {
    inset: .1rem;
    border: 1px solid rgba(240, 210, 160, .86);
    background: linear-gradient(145deg, rgba(93, 78, 61, .82), rgba(32, 28, 25, .8));
    clip-path: polygon(0 0, 42% 0, 50% 9%, 64% 0, 100% 0, 100% 32%, 92% 40%, 100% 52%, 100% 100%, 58% 100%, 50% 90%, 39% 100%, 0 100%, 0 59%, 9% 48%, 0 38%);
    animation: ash-char var(--burn-duration) ease-out forwards;
  }
  .category-burn[data-treatment='ash']::after {
    inset: .2rem;
    background: repeating-linear-gradient(125deg, transparent 0 17px, rgba(255, 221, 156, .9) 18px, transparent 20px 41px);
    clip-path: polygon(0 0, 42% 0, 50% 9%, 64% 0, 100% 0, 100% 32%, 92% 40%, 100% 52%, 100% 100%, 58% 100%, 50% 90%, 39% 100%, 0 100%, 0 59%, 9% 48%, 0 38%);
    animation: ash-crack var(--burn-duration) ease-out forwards;
  }

  .flame-tongue { position: absolute; z-index: 6; width: .72rem; height: 1.25rem; border-radius: 70% 15% 55% 20%; background: linear-gradient(180deg, #fff7bc, #ffbe41 35%, #f05b20 80%); filter: drop-shadow(0 0 5px rgba(255, 125, 30, .95)); opacity: 0; clip-path: polygon(50% 0, 100% 100%, 56% 74%, 30% 100%, 0 83%); }
  .category-burn[data-treatment='drip'] .flame-tongue { top: 0; animation: drip-tongue var(--burn-duration) ease-in forwards; }
  .category-burn[data-treatment='crawl'] .flame-tongue { animation: crawl-tongue var(--burn-duration) ease-in forwards; }
  .tongue-one { left: 13%; --flame-x: 22px; --flame-y: 20px; }
  .tongue-two { left: 38%; --flame-x: 9px; --flame-y: 28px; }
  .tongue-three { left: 65%; --flame-x: -12px; --flame-y: 24px; }
  .tongue-four { right: 12%; --flame-x: -21px; --flame-y: 17px; }
  .tongue-five { left: 27%; --flame-x: 26px; --flame-y: -16px; }
  .tongue-six { right: 26%; --flame-x: -27px; --flame-y: -14px; }
  .category-burn[data-treatment='crawl'] .tongue-one,
  .category-burn[data-treatment='crawl'] .tongue-two,
  .category-burn[data-treatment='crawl'] .tongue-three,
  .category-burn[data-treatment='crawl'] .tongue-four { top: 0; }
  .category-burn[data-treatment='crawl'] .tongue-five,
  .category-burn[data-treatment='crawl'] .tongue-six { bottom: 0; transform: rotate(180deg); }

  .falling-ash { position: absolute; z-index: 7; top: 100%; width: 4px; height: 4px; border-radius: 50%; background: linear-gradient(135deg, #fff3ce, #b9b4a8); box-shadow: 0 0 6px rgba(255, 222, 155, .9); opacity: 0; animation-duration: var(--burn-duration); animation-timing-function: ease-in; animation-fill-mode: forwards; }
  .category-burn[data-treatment='drip'] .falling-ash { top: calc(100% - .2rem); }
  .category-burn[data-treatment='ash'] .falling-ash { top: calc(100% - .65rem); }
  .ash-one { left: 25%; --ash-drift: -7px; --ash-drop: 12px; animation-name: ash-fall-one; }
  .ash-two { left: 52%; --ash-drift: 4px; --ash-drop: 18px; animation-name: ash-fall-two; }
  .ash-three { left: 76%; --ash-drift: -3px; --ash-drop: 24px; animation-name: ash-fall-three; }

  .ash-fragment { position: absolute; inset: 0; z-index: 5; border: 1px solid rgba(232, 217, 190, .75); background: linear-gradient(145deg, rgba(116, 105, 89, .95), rgba(34, 31, 27, .96)); opacity: 0; }
  .fragment-one { clip-path: polygon(0 0, 43% 0, 48% 31%, 0 38%); --ash-x: -26px; --ash-y: -30px; --ash-rotate: -18deg; }
  .fragment-two { clip-path: polygon(44% 0, 100% 0, 100% 32%, 52% 38%); --ash-x: 31px; --ash-y: -32px; --ash-rotate: 17deg; }
  .fragment-three { clip-path: polygon(0 39%, 48% 32%, 50% 67%, 0 61%); --ash-x: -37px; --ash-y: 2px; --ash-rotate: -12deg; }
  .fragment-four { clip-path: polygon(51% 39%, 100% 33%, 100% 63%, 52% 67%); --ash-x: 38px; --ash-y: 7px; --ash-rotate: 13deg; }
  .fragment-five { clip-path: polygon(0 63%, 49% 68%, 42% 100%, 0 100%); --ash-x: -25px; --ash-y: 31px; --ash-rotate: 16deg; }
  .fragment-six { clip-path: polygon(53% 69%, 100% 65%, 100% 100%, 45% 100%); --ash-x: 28px; --ash-y: 34px; --ash-rotate: -14deg; }
  .category-burn[data-treatment='ash'] .ash-fragment { animation: fracture var(--burn-duration) cubic-bezier(.2, .72, .28, 1) forwards; }

  @keyframes crawl-in {
    0% { opacity: 0; transform: scale(1.06); }
    16% { opacity: 1; }
    68% { opacity: .9; transform: scale(.68); }
    100% { opacity: 0; transform: scale(.24); filter: blur(5px); }
  }
  @keyframes crawl-char {
    0%, 22% { opacity: 0; }
    68% { opacity: .62; }
    100% { opacity: .08; transform: scale(.42); }
  }
  @keyframes drip-front { 0%, 14% { top: 0%; opacity: 1; transform: translateY(-50%); } 56% { top: 45%; opacity: 1; transform: translateY(-50%); } 82% { top: 78%; opacity: 1; transform: translateY(-50%); } 100% { top: 100%; opacity: .12; transform: translateY(-50%); } }
  @keyframes drip-char-front { 0%, 14% { top: 0%; opacity: 1; transform: translateY(-50%); } 56% { top: 45%; opacity: .95; transform: translateY(-50%); } 82% { top: 78%; opacity: .88; transform: translateY(-50%); } 100% { top: 100%; opacity: 0; transform: translateY(-50%); } }
  @keyframes drip-tongue { 0%, 14% { top: 0%; opacity: 0; transform: translateY(-100%) scaleY(.5); } 20% { opacity: 1; } 56% { top: 45%; opacity: 1; transform: translateY(-100%) scaleY(1.1); } 82% { top: 78%; opacity: 1; transform: translateY(-100%) scaleY(1); } 100% { top: 100%; opacity: 0; transform: translateY(-100%) scaleY(.65); } }
  @keyframes crawl-tongue { 0%, 8% { opacity: 0; } 18% { opacity: 1; } 68% { opacity: .95; transform: translate(var(--flame-x), var(--flame-y)) scale(.8); } 100% { opacity: 0; transform: translate(var(--flame-x), var(--flame-y)) scale(.3); } }
  @keyframes ash-fall-one { 0%, 30% { opacity: 0; transform: translate(0, 0) scale(.5); } 38% { opacity: 1; transform: translate(0, 2px) scale(1); } 100% { opacity: 0; transform: translate(var(--ash-drift), var(--ash-drop)) scale(.35); } }
  @keyframes ash-fall-two { 0%, 47% { opacity: 0; transform: translate(0, 0) scale(.5); } 55% { opacity: 1; transform: translate(0, 2px) scale(1); } 100% { opacity: 0; transform: translate(var(--ash-drift), var(--ash-drop)) scale(.35); } }
  @keyframes ash-fall-three { 0%, 62% { opacity: 0; transform: translate(0, 0) scale(.5); } 70% { opacity: 1; transform: translate(0, 2px) scale(1); } 100% { opacity: 0; transform: translate(var(--ash-drift), var(--ash-drop)) scale(.35); } }
  @keyframes ash-char {
    0% { opacity: 0; transform: scale(.98); }
    22% { opacity: .7; }
    75% { opacity: .92; }
    100% { opacity: .08; transform: scale(.9); }
  }
  @keyframes ash-crack {
    0%, 18% { opacity: 0; }
    32% { opacity: .9; }
    100% { opacity: .05; transform: scale(1.02); }
  }
  @keyframes fracture {
    0%, 16% { opacity: 0; transform: translate(0, 0) rotate(0); }
    30% { opacity: .95; }
    100% { opacity: 0; transform: translate(var(--ash-x), var(--ash-y)) rotate(var(--ash-rotate)) scale(.36); filter: blur(2px); }
  }

  @media (prefers-reduced-motion: reduce) {
    .category-burn, .category-burn::before, .category-burn::after, .falling-ash, .ash-fragment { animation: none !important; }
  }
</style>
