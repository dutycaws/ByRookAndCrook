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
Use the real top navigation to move between all five routes. Remove
`prototype=hand` to see the current live interface. The prototype and its switcher
are development-only.

## Compare

- A — Counter hand: a broad Shop-style hand with concise details above it.
- B — Right folio: the same hand, with longer information in a floating side folio.
- C — Inspection spotlight: a centered inspection surface over a subdued hand.

The URL's `variant=A|B|C` preserves the chosen presentation across reloads and
top navigation. The bottom switcher changes only presentation, not workflow
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

## Crafting interaction decision

For Brewery and Bakery, the shared card hand is the ingredient picker. Nothing is selected initially. Hovering or focusing a card gives it a subtle lift and shimmer. Click an ingredient once to bring it forward into a larger inspection card over the scene; the card explains that confirmation uses one ingredient. Activate that focused card again to confirm and burn into the minigame. Choose another ingredient or Escape returns to the hand with focus restored to that ingredient. There is no separate Begin button. After confirmation, the original scene controls take over: guided wort stirring in Brewery, and dough folding, loaf scoring, and oven timing in Bakery. Those physical steps are not card-menu choices. The prototype runs the existing minigame mechanics in local memory and returns to an unselected ingredient hand for another batch.

The real top navigation is the only area navigation. In development it preserves the hand prototype and selected A/B/C layout across the five experimental routes. The disposable bottom switcher retains the layout comparison and Exit prototype link. Burn-effect controls are omitted from gameplay surfaces; the card transitions still use the supplied burn preference. Native Enter and Space activate cards with the same select-then-confirm behavior. Focus moves to the enlarged confirmation card when inspection opens. Reduced motion keeps a steady highlight without the shimmer or zoom transition.

`CraftingWorkflowPrototype` adapts the shared hand to the existing `BreweryScene` and `BakeryScene`. Available pantry ingredients come from the route snapshot; an explicitly labelled sample ingredient keeps an empty pantry experiment usable. The Brewery scene has an optional memory-only session mode for this prototype. Live sessions retain their existing saved-state behavior.

The browser correction pass exercised actual dough-fold and loaf-score drags, Enter/Space alternatives, all six folds and three scores, and timed oven completion. Guided stirring registered both pointer input and keyboard beats, then completed its timer. The hand disappears during both minigames. Keyboard focus moves to the next oven action and returns to the ingredient hand on reset. Switching layout variants preserves an active session. Mobile progress and action controls sit immediately below the scene.

Local correction captures: `bakery-fold-after.jpg`, `bakery-score-after.jpg`, `bakery-oven-after.jpg`, `bakery-result-after.jpg`, `brewery-ingredients-after.jpg`, `brewery-stir-after.jpg`, `brewery-pointer-after.jpg`, `bakery-mobile-minigame.jpg`, and `brewery-mobile-minigame.jpg`. Both mobile routes have no document horizontal overflow; the native stirring button is repositioned within the cropped scene so its focus outline is visible.

The confirmation refinement passed `npm run check` with zero errors and warnings and `npm run build`. Desktop Bakery confirmed first-click selection and second-click minigame entry; its original keyboard fold registered. Mobile Brewery confirmed Enter selection and Space confirmation into the original stirring controls, with no document horizontal overflow. Start over cleared selection and restored ingredient-card focus. The real top navigation retained prototype B across Bakery, Brewery, and Shop. The rendered selected card had the shimmer animation; its reduced-motion suppression was reviewed in source because browser media emulation is unavailable. Local captures: `bakery-before-confirmation-refinement.jpg`, `bakery-selected-refinement.jpg`, `brewery-mobile-selected-refinement.jpg`, and `brewery-mobile-confirmed-refinement.jpg`.

The ingredient-focus refinement adds an opt-in looping 800 ms sheen to `CardHandCard`, shared by the disposable hands. Selecting an ingredient opens a larger centered inspection card instead of leaving a duplicate hand on screen. Its larger typography and single Use action explain the simulated one-unit consequence. Desktop and 390 px mobile inspection were checked in the browser: focus enters the card, Escape and Choose another restore the original hand-card focus, and confirmation enters the existing Bakery folding or Brewery stirring controls. A Bakery keyboard fold registered; resetting both routes clears selection. Mobile has no document horizontal overflow. Typecheck again reports zero errors and warnings, build passes, and reduced-motion suppression remains in source. Local before/after captures: `bakery-before-ingredient-spotlight.jpg`, `bakery-ingredient-inspection-desktop.jpg`, and `bakery-ingredient-inspection-mobile.jpg`. Pantry quantities remain unchanged because these are simulated prototype actions.
