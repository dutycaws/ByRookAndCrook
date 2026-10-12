# Simplified gameplay card workflows

The shared hand uses direct scene selection, meaningful action/resource cards, authoritative previews, and explicit confirmation. Quantity entry is removed where the action has a standard amount; watering, fertilizer strength, and Shop bulk purchases retain their strategic choices.

## Implemented behavior

- Feed one item; extract the complete safe honey surplus; select a medicine when several are owned; select a split destination directly on the Garden scene.
- Choose amendments and compost ingredients from owned-resource cards. Compost consumes one ingredient unit. Fixed Garden actions and move destinations open confirmation directly.
- Preserve water dose and batch targeting, fertilizer strength, removal compost eligibility, Shop prices/stock, and unresolved-command identity.
- Keep physical crafting minigames, Bar dialogue/serving, trinket choices, and closing confirmation.

## Server rules

A forward migration removes the 20-unit extraction cap, validates unlocked empty same-save split destinations, and restricts ingredient compost to one available unreserved unit. A second forward migration includes the split destination and exact transferred resources in the preview. Protected honey stays at four units; the folio labels its distinct food reserve explicitly. Both migrations were applied locally without resetting saves.

## Verification

- Database checks passed across apiary commands (64 assertions), Garden compost/reservation rules (27), and Garden commands (53). The apiary suite was rerun after adding split transfer preview metadata. Coverage includes extraction above 20 units, treatment restrictions, same-save/unlocked/empty split destinations, stale revisions, duplicate retries, and one-unit unreserved composting.
- 58 tests passed in seven relevant integration/unit suites: apiary commands, Garden commands, Shop stock, Garden feedback/camera, scene motion, and card effects.
- Final type check passed with zero errors and warnings; the production build and `git diff --check` passed. These checks were repeated after the final inspection-height and move-consequence fixes.

## Browser verification

Inspected the running application on desktop (1280×720 and 1440×1000) and mobile (390×844). Verified automatic extraction of 29 honey with a four-unit reserve, missing feed/medicine guidance, split destination selection and transfer preview, seed selection, one-unit ingredient composting, amendment strength and inventory limits, eligible removal compost defaults, clover incorporation, move/swap confirmation, water dose/batch previews, and Shop quantity/stock/affordability controls. Keyboard changes refresh previews while disabling confirmation; Escape restores the preceding resource/action card and its focus. No gameplay mutations were submitted against the player's save.

The final browser pass compacted shared inspections for short desktop windows and added the explicit move/swap consequence that soil remains with its plot. Mobile confirmations stack below the scene and do not create horizontal page overflow. Long inspections scroll within their relevant surface.

Live successful feeding, medicine consumption, and split commits were unavailable with this save's supplies/colony strength; database tests cover those rules. Browser tooling cannot emulate reduced motion; the reduced-motion CSS branches were reviewed and the existing motion/effect tests passed. Network fault injection was not performed in the browser; retry identity and duplicate handling are covered by the command checks.

## Local screenshots

Screenshots remain outside Git.

| Flow | Before | After |
| --- | --- | --- |
| Colony | [Before](/tmp/rook-simplified-gameplay/colony-before.jpg) | [After](/tmp/rook-simplified-gameplay/colony-after.jpg) |
| Garden | [Before](/tmp/rook-simplified-gameplay/garden-before.jpg) | [After](/tmp/rook-simplified-gameplay/garden-after.jpg) |
| Shop | [Before](/tmp/rook-simplified-gameplay/shop-before.jpg) | [After](/tmp/rook-simplified-gameplay/shop-after.jpg) |

Additional mobile captures: [colony](/tmp/rook-simplified-gameplay/colony-mobile-after.jpg), [Shop](/tmp/rook-simplified-gameplay/shop-mobile-after.jpg).

## Branch integration

`codex/issue-35-relationship-garden` was fast-forwarded to `01fe9cd`, including both `codex/prototype-unified-card-workflows` and `codex/unified-hand-implementation`. All follow-up changes for this ticket are on issue 35. No remote push was performed for this consolidation.

Baseline screenshots are local only: [colony](/tmp/rook-simplified-gameplay/colony-before.jpg), [Garden](/tmp/rook-simplified-gameplay/garden-before.jpg), and [Shop](/tmp/rook-simplified-gameplay/shop-before.jpg).
