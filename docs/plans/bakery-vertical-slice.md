# Bakery vertical slice implementation record

Status: implemented for GitHub issue #5 on the `gpt6-first-pass` branch.

## Player flow

The Bakery is a protected top-level tavern area. A keeper may use one available ingredient to begin an herb loaf, fold the dough six times, score it exactly three times, place it in the oven, and remove it at any time. Preparation and oven state survive reloads because every accepted gesture is a database command and the oven begins on the database clock.

Removing the loaf creates a persistent food item. A qualifying loaf also creates a separate intent card. The Bar already owns food service and dialogue selection, so it exposes the loaf as hospitality while exposing the card independently as the player-selected characterization of their message. Baking does not create a beverage, a legacy Pour Ale entitlement, or an automatic serving payment.

The shared daily craft is optional. A save can start at most one brew or bake per tavern day. The reservation is taken under the save lock when the craft starts, remains after completion, and clears when the next day commits. Active baking, including an overbaked loaf, blocks day close and new dialogue until the loaf is removed. Closing without starting either craft remains valid.

## Persistent model

Migrations `202609090018_bakery_vertical_slice.sql` and `202609090019_bakery_input_validation.sql` add the following records and commands. The second migration keeps null gesture inputs within the public validation contract.

- `tavern_saves.daily_craft_kind`, backfilled for any current-day brew;
- `bake_sessions`, with frozen ingredient inputs, preparation counts, the server oven timestamp, final timing evidence, quality, and rule version;
- `bake_actions`, an immutable replay ledger for start, fold, score, oven, and completion commands;
- Bakery provenance on `foods`; and
- a food source foreign key on `intent_cards`.

The Bakery RPCs derive ownership from `auth.uid()`, lock the owned save, check exact action replay before mutable eligibility rules, and reject a reused action ID whose payload changed. Players receive read access to their own sessions and action receipts and cannot write production, inventory, rewards, timing, or outcome records directly.

All effects at completion share one database transaction: validate the active session and available ingredient, derive elapsed time from the saved oven timestamp, calculate quality, create the food and optional intent, consume one ingredient, complete the session, close the daily craft, increment the save revision, and record the receipt. A failed transaction consumes and creates nothing. An identical retry returns the original receipt.

## Versioned bake rules

The product design document establishes the interaction and a 30-second ideal bake. The following `bake-v1` values are new authored balance additions because the design does not provide exact thresholds or a scoring formula:

| Rule | `bake-v1` value |
| --- | --- |
| Preparation | Six folds and exactly three scores |
| Gesture score | 0 points below 30%, 1 from 30–59%, 2 from 60–100% |
| Red timing | Before 20 seconds or after 42 seconds |
| Yellow timing | 20–27.999 seconds or 34.001–42 seconds |
| Green timing | 28–34 seconds |
| Technique | Rounded from the 18 available gesture points to 0–6 |
| Base quality | Frozen ingredient quality, technique, and bounded bake bonus; capped at 4 before timing |
| Timing addition | Red +0, yellow +1, green +2 |

The cap makes otherwise identical red, yellow, and green removals strictly ordered. The committed elapsed milliseconds, band, technique score, and quality remain historical evidence if rules change later.

Food names are also new authored pilot content: Charred Herb Brick, Sunken Herb Loaf, Rustic Herb Bread, Hearth Herb Loaf, Golden Herb Loaf, Master Baker's Herb Loaf, and Resplendent Hearth Loaf for quality levels 0–6.

Qualifying bake rewards use the published intent catalog: quality 2–3 earns fine Rumor, quality 4 earns superior Charm, and quality 5–6 earns exceptional Insight. These rewards characterize future player text and never represent food service.

## Recovery and compatibility

Current-day brew sessions are backfilled into the shared craft reservation during migration, whether active or completed. Historical brew and serving receipts keep their prior meaning. Existing generic food rows remain valid; Bakery provenance is required only for new Bakery-produced food.

The browser retains an action ID after a lost response. Retrying sends the same save, subject, revision, and bounded gesture value. The authoritative snapshot exposes the active stage, counts, oven timestamp, production history, reward sources, and daily craft owner. An early or long-overdue loaf can always be removed, so a bake cannot permanently trap a tavern day.

## Verification

The Bakery has pgTAP and authenticated integration coverage for persistent phases, exact replay, changed payload rejection, shared brew/bake serialization, server-owned timing, ordered quality, atomic inventory and rewards, denied direct writes, active-session day blocking, and no-craft closing.

Playwright drives the full harvest-to-loaf journey in desktop and mobile Chromium, reloads after preparation and during the oven, removes an ideal loaf, and verifies that its food and intent reward appear in separate Bar controls. Static Svelte/TypeScript checks and generated database types cover the public application contract.
