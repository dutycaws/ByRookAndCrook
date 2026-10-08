# Bar interaction prototype

The wide B layout is locked: select a patron, see the hand, choose a card, and chat rises over the faded hand. This throwaway prototype now compares three treatments of that layout:

- B: Top ledger.
- E: Right folio.
- F: Left folio (recommended).

All three share the soft treatment: 320ms hand and 240ms chat entrances, 32% inactive-hand opacity, 68% selected-card opacity, 82% chat opacity, and a chat up to 700px wide by 310px high with full card detail, a three-row composer, and five recent messages. Only Journal placement differs. F remains the default URL selection.

Old A/C/D layouts remain accessible by direct query parameter for reference. The floating switcher compares B/E/F. Journal opens only when its scene-tool button is selected; it is not open by default. Journal suppresses chat while preserving the card and draft. Trinkets use scene slots in overview mode; an empty collection offers sample trinkets for the experiment.

Run `npm run prototype:bar`, then open `/bar?variant=B` on the local server. Variant keys are case-insensitive. Use the floating arrows or left and right keys to switch treatments. A missing or invalid variant opens the regular `/bar` page.

Select a patron to reveal the persistent fan, then select a card to open its chat over the faded hand. The fan stays visible in Journal. Escape closes the current layer and returns focus to the card or patron. Messages, cards, and serving outcomes stay in memory; no inventory or gold changes. “Reset demo” clears the prototype state and “Clear prototype” removes the query parameter.

B's wide fan and card-first flow are accepted. Use the switcher to compare Journal placement: B Top ledger, E Right folio, and F Left folio. Keep this as the primary source on the disposable `codex/prototype-bar-interactions` branch. Reduced motion replaces entrances with brief fades; no prototype actions write game state.
