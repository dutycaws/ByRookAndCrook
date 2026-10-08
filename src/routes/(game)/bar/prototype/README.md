# Bar interaction prototype

The wide B layout is locked: select a patron, see the hand, choose a card, and chat rises over the faded hand. This throwaway prototype now compares three treatments of that layout:

- B: Balanced — 240ms hand / 180ms chat entrance, 42% background hand, 90% chat background, two-row composer, selected-card detail, tools at upper left.
- E: Quick — 170ms hand / 140ms chat, 55% hand, 96% chat, one-row composer, card title only, tools along the left scene edge.
- F: Soft — 320ms hand / 240ms chat, 32% hand, 82% chat, three-row composer and more recent messages, tools at upper right.

Old A/C/D layouts remain accessible by direct query parameter for reference. The floating switcher compares B/E/F. Journal and Trinkets open compact nonmodal popovers; Journal suppresses chat while preserving the card and draft. Trinket slot arrangements are local preview state; an empty collection offers sample trinkets for the experiment.

Run `npm run prototype:bar`, then open `/bar?variant=B` on the local server. Variant keys are case-insensitive. Use the floating arrows or left and right keys to switch treatments. A missing or invalid variant opens the regular `/bar` page.

Select a patron to reveal the persistent fan, then select a card to open its chat. In B, chat rises over the faded hand. The fan stays visible in Journal. Escape closes the current layer and returns focus to the card or patron. Messages, cards, and serving outcomes stay in memory; no inventory or gold changes. “Reset demo” clears the prototype state and “Clear prototype” removes the query parameter.

B's layout is accepted. Motion, opacity, information density, and utility placement remain open for comparison. Keep this as the primary source on the disposable `codex/prototype-bar-interactions` branch. Reduced motion replaces entrances with brief fades; no prototype actions write game state.
