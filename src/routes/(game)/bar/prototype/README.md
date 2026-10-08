# Bar interaction prototype

This throwaway prototype compares four card-first layouts on the existing bar route:

- A: Face-side float — a fan at lower left with a short chat beside the patron.
- B: Player’s hand — a wide, arched four-card fan centered across the scene, with the conversation sliding over its lower edge. On mobile, the fan and conversation share the area below the scene controls.
- C: Conversation ribbon — a shallow conversation ribbon above the hand.
- D: Previous countertop — the earlier Variant B kept as a reference.

Run `npm run prototype:bar`, then open `/bar?variant=a` on the local server. Variant keys are case-insensitive. Use the floating arrows or left and right keys to switch layouts. A missing or invalid variant opens the regular `/bar` page.

Select a patron to reveal the persistent fan, then select a card to open its chat. In B, chat rises over the faded hand. The fan stays visible in Journal. Escape closes the current layer and returns focus to the card or patron. Messages, cards, and serving outcomes stay in memory; no inventory or gold changes. “Reset demo” clears the prototype state and “Clear prototype” removes the query parameter.

B's centered hand is the preferred arrangement. The wider arch and overlapping chat are the next experiment for review. Keep this as the primary source on the disposable `codex/prototype-bar-interactions` branch while reviewing the four layouts.
