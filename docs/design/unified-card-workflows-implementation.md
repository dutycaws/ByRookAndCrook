# Unified card workflows

Approved treatment: Variant B, right folio. The live routes share
`CardWorkflowFrame`, `WorkflowHand`, and `WorkflowInspection` from the UI library.
`CardHand` owns fan geometry, horizontal scrolling, and arrow-key focus;
`CardHandCard` owns the interactive card and looping highlight;
`CardBurnSurface` owns the profile-selected burn visuals.

The scene remains the anchor. Desktop details appear in a floating, scrollable
folio over the scene; mobile cards sit directly below the scene, followed by the details folio. Active chat and ingredient confirmation take priority over the muted hand. Ingredient inspection
uses the centered enlarged card approved during the prototype refinement.

## Route responsibilities

- Bar: directly select a patron, then navigate their actions, conversation,
  offerings, and journal through the hand and folio. Dialogue recovery and
  settlement remain owned by the existing real game flows.
- Garden: directly select a plot, then use its contextual hand. Batch and move
  modes still target actual plots. Command previews, action IDs, revision checks,
  and unknown-outcome retries remain in the existing command layer.
- Shop: category and item hands include garden expansion. Item inspection leads
  to the existing preview and purchase commands; generated supplies retain their
  separate purchase action.
- Brewery and Bakery: select an available ingredient, inspect its one-unit
  consequence, and activate it again to confirm. The original stirring, folding,
  scoring, and oven controls then take over.

Card navigation may burn before changing local menus. Real game mutations keep
their existing validation and retry semantics; an animation is never evidence of
a successful command. Burn preference comes from the verified user's profile
metadata, including Random, and is edited in Settings / Profile.

## Accessibility and disposal

Native buttons support Enter and Space. The hand supports Left/Right and Home/End.
Escape returns from contextual surfaces, with route-owned target or card focus
restoration. Reduced motion suppresses shimmer, entrance transitions, and burn
delays. Secondary information has contextual destinations instead of permanent
dashboard blocks.

The disposable workflow graphs, simulated outcomes, sample inventories, variant
switcher, and prototype route gates are removed from this branch. Historical
prototype notes remain in `unified-card-workflows-prototype.md`; their run commands
apply to `codex/prototype-unified-card-workflows`, not this implementation branch.

Browser evidence is saved locally under `/tmp/rook-unified-implementation`.
Screenshots are not repository assets.


## Implementation verification

Verified on the live application without prototype query parameters, at desktop width 1644 and phone size 390 × 844:

- Bar: direct NPC selection, action/social/serving hands, attached-card chat, subdued background hand, journal scrolling, arrow-key navigation, Escape and focus return to the selected card or NPC. Serving the finished Pepper Bread saved the reply, consumed the offering, and updated gold from 18 to 43.
- Shop: category burn → stock hand → enlarged inspection → actual purchase → receipt folio and continuation hand. Soil builder and Hops seed purchases updated authoritative stock, inventory, and balances. An unaffordable expansion showed the 27-gold deficit and an affordable-goods destination. Keyboard continuation returned focus to the selected Hops seed card.
- Garden: direct plot selection, soil menu, amendment controls, authoritative preview and confirmation; applied one Soil builder to c9. Harvesting c6 from the shared hand yielded one Chamomile ingredient and updated ready count from six to five. Plot history stays collapsed.
- Bakery: ingredient inspection and Escape restoration, real fold and score inputs (pointer and keyboard), oven entry/removal, saved Legendary Master Baker's Herb Loaf. Bread archive opens on its heading and Escape restores its toggle.
- Brewery: real Chamomile confirmation consumed the harvested ingredient, restored the physical stirring minigame, registered counterclockwise pointer input, and bottled a Decent Honest Mead. Cellar archive opens on its heading and Escape restores its toggle.
- Closing: compact End evening action, confirmation dialog, Escape restoration, actual overnight settlement and its Check for morning control, completing from day 7 to day 8.

The wide Garden and crafting frames retain their native scene aspect to avoid a blank strip without cropping interactive targets. Bar uses cover scaling shared by artwork and hitboxes, with camera bounds tested for a tall desktop frame. The inherited chat transform animation was removed from the inner surface; the shared frame owns its entrance.

Checks:

- `npm run check`: zero errors, zero warnings.
- `npm run build`: passed.
- Targeted unit suites for card effects, Garden feedback, service cards, settlement interlude, and Bar scene/camera: 5 files, 50 tests passed.
- `git diff --check`: passed.

## Verification limits

Reduced-motion branches were checked in source and covered by existing effect tests; the connected browser does not expose reduced-motion emulation. Network-loss recovery and revision-conflict branches were preserved and reviewed, but were not deliberately injected into the browser. Brewery's keyboard rhythm controls remain present; this live brew used pointer input. Bakery's physical controls and hand/menu navigation were exercised with the keyboard.

## Local screenshots

Screenshots are saved outside the repository, in `/tmp/rook-unified-implementation/`, and are not committed. The baseline captures predate promotion of the approved prototype; inventory and day state can differ after real gameplay verification.

| Route | Before | After |
| --- | --- | --- |
| Bar | [Before](/tmp/rook-unified-implementation/bar-before.jpg) | [After](/tmp/rook-unified-implementation/bar-after.jpg) |
| Garden | [Before](/tmp/rook-unified-implementation/garden-before.jpg) | [After](/tmp/rook-unified-implementation/garden-after.jpg) |
| Shop | [Before](/tmp/rook-unified-implementation/shop-before.jpg) | [After](/tmp/rook-unified-implementation/shop-after.jpg) |
| Brewery | [Before](/tmp/rook-unified-implementation/brewery-before.jpg) | [After](/tmp/rook-unified-implementation/brewery-after.jpg) |
| Bakery | [Before](/tmp/rook-unified-implementation/bakery-before.jpg) | [After](/tmp/rook-unified-implementation/bakery-after.jpg) |

Additional captures: [Bar chat](/tmp/rook-unified-implementation/bar-chat-after.jpg), [right journal folio](/tmp/rook-unified-implementation/bar-journal-after.jpg), [Bar mobile](/tmp/rook-unified-implementation/bar-after-mobile.jpg), [Garden mobile](/tmp/rook-unified-implementation/garden-after-mobile.jpg), [Shop mobile](/tmp/rook-unified-implementation/shop-after-mobile.jpg), [Shop receipt](/tmp/rook-unified-implementation/shop-receipt-after.jpg), [Brewery ingredient inspection](/tmp/rook-unified-implementation/brewery-inspection-mobile.jpg), [Bakery mobile result](/tmp/rook-unified-implementation/bakery-after-mobile.jpg).
