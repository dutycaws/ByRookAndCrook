# Bar interaction prototype

This throwaway prototype compares four card-first layouts on the existing bar route:

- A: Face-side float — a fan at lower left with a short chat beside the patron.
- B: Player’s hand — a centered hand with a compact chat floating above it.
- C: Conversation ribbon — a shallow conversation ribbon above the hand.
- D: Previous countertop — the earlier Variant B kept as a reference.

Run `npm run prototype:bar`, then open `/bar?variant=a` on the local server. Variant keys are case-insensitive. Use the floating arrows or left and right keys to switch layouts. A missing or invalid variant opens the regular `/bar` page.

Select a patron to reveal the persistent fan, then select a card to open its chat. The fan stays visible in chat and Journal. Escape closes the current layer and returns focus to the card or patron. Messages, cards, and serving outcomes stay in memory; no inventory or gold changes. “Reset demo” clears the prototype state and “Clear prototype” removes the query parameter.

The earlier countertop layout was closest to the desired feel. The persistent fan and card-first flow are the accepted direction; the new layout winner is pending review. Keep this as the primary source on the disposable `codex/prototype-bar-interactions` branch while reviewing the four layouts.
