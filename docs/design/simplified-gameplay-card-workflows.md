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
- Final type/build checks and browser evidence are recorded below after UI integration.

Baseline screenshots are local only: [colony](/tmp/rook-simplified-gameplay/colony-before.jpg), [Garden](/tmp/rook-simplified-gameplay/garden-before.jpg), and [Shop](/tmp/rook-simplified-gameplay/shop-before.jpg).
