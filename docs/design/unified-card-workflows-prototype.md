# Unified card workflows — disposable prototype

Question: can the Shop's burn-to-navigate card hand become the common interaction
language for Garden, Bar, Brewery, Bakery, and Shop?

Branch: `codex/prototype-unified-card-workflows`. This is an experiment, not a live
gameplay implementation. Existing route loaders supply the scenes; all prototype
choices, conversations, orders, harvests, and crafting outcomes are local samples.
Reloading clears the experiment. No gameplay command or purchase is submitted.

## Run

From the repository, run `npm run prototype:hand` and open
`http://127.0.0.1:3000/shop?prototype=hand&variant=A`.
Use the prototype area links to move between all five routes. Remove
`prototype=hand` to see the current live interface. The prototype and its switcher
are development-only.

## Compare

- A — Counter hand: a broad Shop-style hand with concise details above it.
- B — Right folio: the same hand, with longer information in a floating side folio.
- C — Inspection spotlight: a centered inspection surface over a subdued hand.

The URL's `variant=A|B|C` preserves the chosen presentation across reloads and
prototype area links. The bottom switcher changes only presentation, not workflow
choices. Left/right arrows change variants when focus is outside a card hand or
input; inside the hand they move card focus. Escape returns one menu level.

Bar and Garden begin with direct scene selection. Click an NPC, keepsake, or plot;
the hand appears for its actions, never for choosing the target. Selection opens
immediately; action and submenu choices use the shared burn-and-deal transition.
Bar's house journal and End evening destinations remain discoverable in the scene.

## Shared tree

`WorkflowPrototypeHost` provides the route adapter and variant switcher.
`UnifiedWorkflowPrototype` owns menu history, local feedback, burn transitions,
contextual reading/input surfaces, and the hand for every menu level.
`CardHand` owns fan geometry, scroll, and keyboard movement. `CardHandCard` owns
the card frame and focus. `CardBurnSurface` uses the existing Crawl, Drip, and Ash
effects. `WorkflowPrototypeScene` adapts the existing scenes with local callbacks.
The data-only graphs in `workflows.ts` supply each route's choices.

There are no separate Garden, Bar, Shop, Brewery, or Bakery hand renderers in the
prototype. Differences are scene context, menu content, and the experimental
placement of the detail surface.

## Decision to capture

Choose the detail placement after comparing the same multi-step flow on desktop
and mobile. Then rewrite the selected treatment against the live action contracts;
do not merge this simulated workflow graph as gameplay code.

Screenshots are kept under `/tmp/rook-unified-prototype` and are not committed.

## Verification

- `npm run check`: zero errors and warnings.
- `npm run build`: passed with the Node adapter.
- Browser: inspected all five routes on desktop and mobile; exercised Shop category → item → mock order, Bar direct patron → talk → reply → journal, and Garden direct plot → action → submenu.
- Bar and Garden start with zero card hands. The selected patron stays focused through chat and journal; the selected empty plot stays selected through soil-care navigation.
- Checked card arrow-key navigation, Escape menu traversal, plot focus restoration, and mobile document overflow. Reduced-motion handling is present in the shared components; browser media emulation was unavailable.

Final local captures include `shop-before-desktop.png`, `shop-A-after.png`, `garden-root-final.png`, `garden-A-selected-final.png`, `bar-B-chat-final.png`, and `bar-B-journal-final.png`.

The prototype uses sample inventory, recipes, outcomes, and canned dialogue. Scenes use existing route data, but gameplay mutations and persistence are deliberately absent. This experiment compares the shared navigation and layout; wiring the chosen design to live gameplay is a separate implementation step.
