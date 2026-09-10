# Patron serving vertical slice

Implemented locally on 2026-09-07. This extends the working garden and brewery into **serve a beverage → apply an optional social card → receive gold → change relationship/story state → recover the same result after reload**.

> Historical v1 record. `hospitality_events` is now the canonical food/drink ledger. Dialogue intent cards are independent from hospitality; only existing Pour Ale rows retain the legacy standalone-drink behavior described below. See the [current technical specification](../npc-dialogue.md).

## Source requirements and pilot decisions

The [Product Design Document](</home/hosm/Projects/braindump/Specifications/Cozy Tavern/Product Design Document.md>) makes NPC interactions the primary loop: patrons pay different amounts for different beverage qualities, cards enhance interactions, and hospitality influences story arcs. The prototype's `BarView.tsx` and `game-context.tsx` supply Lira Nightwind, Torvin Ashbeard, their story premises, initial relationships, payment tables, and quality thresholds.

This slice delivers serving mechanics and persisted story state. It does **not** implement the PDD's free-text LLM conversation system. The chapter summaries are deterministic draft content adapted from the prototype, pending human editorial approval; they are not presented as generated NPC dialogue or complete authored arcs.

| Rule | Serving v1 |
| --- | --- |
| Starting gold | 0 for existing and new saves; no prototype display balance is imported. |
| Patron state | Lira starts at relationship 45; Torvin at 22. Both stories begin at progress 0. |
| Lira base payment, qualities 0–6 | 2, 5, 8, 12, 18, 28, 45 gold. |
| Torvin base payment, qualities 0–6 | 1, 3, 6, 10, 16, 25, 40 gold. |
| Relationship | Repugnant −4; Awful −2; Potable/Decent +3; Great/Legendary/Resplendent +6. Clamp to 0–100. |
| Story | Great or better advances one step; Awful or worse regresses one; other quality holds steady. Clamp to the story's bounds, including setbacks after completion. Lira has five steps and Torvin four. |
| Card play | Optional, one earned Pour Ale card per pour. Apply the stored gold multiplier and relationship bonus. Gold rounds to the nearest whole coin. Cards do not change quality or prevent story setbacks. |
| Consumption | One bottle and the selected card are spent once. A card can accompany any owned available beverage; it need not accompany its source brew. |
| Time | Serving is independent of the daily crafting gate. Unserved stock and unused cards carry over to later days. |

Single-use card play is an explicit pilot default. A reusable deck, hand/draw/discard lifecycle, and deck loadouts require a later design decision; this slice does not establish them as final deck-building rules.

## Persistence and authorization

Migration `202609070003_patron_serving_slice.sql` adds gold to saves and creates:

- `patron_catalog`: static versioned pilot content and prices.
- `patron_states`: relationship and story progress for a patron within one save. Rows are first inserted by a successful serving command; GET only projects initial defaults.
- `serving_events`: immutable receipt, beverage/card consumption reference, gold and relationship deltas, story event, day, and committed revision. Unique `(save_id, beverage_id)` and `(save_id, card_id)` prevent reuse; composite foreign keys prevent cross-save references.

`get_bar_snapshot()` is a single SQL statement under player RLS. It returns the owned balance/revision, patrons, unserved beverages, unplayed cards, and the latest 20 serving receipts. The brewery retains production history, including bottles later served and cards later played. No historical rows are deleted as consumption.

`serve_beverage(...)` derives identity from `auth.uid()`, locks the owned save, checks typed receipt inputs before revision/availability checks, then calculates effects from saved quality and catalog/card values. Patron state, gold, revision, item consumption, and the receipt share one transaction. Player roles have select-only access; trusted service-role fixtures are never imported by the app runtime.

Lira/Torvin defaults appear for existing taverns without reseeding gardens or resetting accounts. The migration was applied to the running local database with `supabase migration up --local`.

## User experience and recovery

The protected `/bar` screen supports keyboard/touch patron selection, beverage choice, an optional card, transparent base payment/card effects, success/error announcements, an empty cellar state, and persistent hospitality history. The navigation and brewery result provide a direct path into the bar.

The client freezes the **whole command** on first submit, including action UUID, recipient, bottle, card, and expected revision. Unknown transport/server outcomes preserve that command and lock choices until retry. Identical retries return the original receipt. A stale revision reloads authoritative state without inventing a second payment. Reloading or another session reconstructs available items and history from Postgres. Unexpected snapshot-refresh failure after success is described as a recorded pour with a refresh problem.

## Acceptance evidence

- 42 serving pgTAP assertions cover all prices, quality thresholds, relationships, story regression/caps, card consumption, receipt replay/conflicts, permission denial, RLS, empty states, and transaction rollback after an injected receipt failure. The full database suite totals 160 assertions.
- Three real Auth/RPC integration tests cover identical parallel retries, two recipients competing for one bottle, serving without a card, cross-player inputs, and denied direct writes. The full integration suite totals seven tests.
- Desktop and mobile Chromium cover the full garden → brew → serve → reload → next-day path; lost serving responses with complete command replay and a second browser session; and stale views after a competing pour.
- The screenshot script captures bar selection, a completed pour, and the mobile result and fails if browser runtime errors occur.

## Next product boundary

Free-text dialogue can now read an authoritative patron/serving snapshot. Its provider adapter, secret configuration, streaming/error behavior, transcript persistence, authored arc boundaries, and evaluation cases should be implemented together. LLM output must not directly award gold, consume stock, or modify story progress. Cooking and renewable gardening are also still outstanding; finite starter crops limit this pilot's repeated play.


The NPC dialogue migration supersedes future fixed story-step changes described above. Existing chapter progress and receipts remain historical; new pours influence trust and overnight hospitality. See [NPC specification](../npc-dialogue.md).
