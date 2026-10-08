# Bar interaction prototype

This throwaway prototype compares three ways to talk with a patron on the existing bar route:

- A: Beside the patron
- B: Countertop spread
- C: Conversation thread

Run `npm run prototype:bar`, then open `/bar?variant=A` on the local server. Switch with the floating arrows or the left and right keys. A missing or invalid variant uses the regular `/bar` page.

The demo flow is overview → select and zoom a patron → Talk or Card Deck → choose an intent or hospitality card → preview a mock reply or serving result → Journal → Escape or Back to overview.

Messages, cards, and serving outcomes stay in memory. “Reset demo” clears that state; “Clear prototype” removes the `variant` query and returns to the regular page.

The design verdict is pending. No variant has been selected or promoted. Keep this primary source on the disposable `codex/prototype-bar-interactions` branch and review the three layouts before folding any design into the real bar.
