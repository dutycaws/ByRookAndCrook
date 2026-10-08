# Relationship and garden prototype specification

Decision baseline: October 4, 2026. This document consolidates the approved design discussion. It describes target behavior, not a claim that the behavior is implemented. The accompanying implementation gap plan will distinguish existing systems from required changes.

See the [implementation comparison and delivery plan](../plans/relationship-garden-delivery-plan.md) and [tracking issue](https://github.com/dutycaws/ByRookAndCrook/issues/35).

## Experience and priorities

The central experience is building relationships with independent NPCs and watching them grow. Their decisions can surprise the player while remaining consistent with their personalities and experiences.

Deep gardening is the major secondary system. The garden and tavern provide lasting home progression. Brewing and baking are shorter minigames that supply food and drink and vary the rhythm of play.

Time advances only when the player explicitly ends the day. Gardening, crafting, reading, and dialogue do not run down a clock or automatically close the day. Existing resource costs still matter; unlimited time does not imply unlimited ingredients or free production.

## NPC authorship and autonomy

Community authors define an NPC's personality, likes and dislikes, initial closed-ended quest, and long-term goal. The initial quest is a bounded episode within a longer life, not necessarily the completion of that life goal.

The player can propose changes to remaining quest steps. NPCs can accept, refuse, or seek clarification. The current quest objective remains stable; dialogue does not replace its motivation or targets. Completed steps are not rewritten.

Food and beverage quality materially influence quest success chances without guaranteeing success. Game rules determine quest outcomes; model calls interpret character choices and narrate supported results.

NPC motives may remain hidden. Greater trust reveals more personal context and makes the character more receptive to advice, without ensuring agreement or obedience.

## Relationship progression and repair

Display named relationship stages: strained, acquaintance, familiar, trusted, and close. Do not expose a numeric affection meter. Progress is bidirectional and can cross stage boundaries in either direction.

The first-version rewards for greater closeness are personal disclosures, clearer insight into motives, and increased receptiveness to advice. Dedicated friendship scenes and additional relationship quests are deferred. Quest trinkets depend on quest completion rather than a separate relationship tier.

Intentional insults and accidental offenses can damage relationships. Negative impact must have an obvious interface indication even when the relationship remains within the same stage. This indication establishes that harm occurred without necessarily revealing the hidden motive behind it. Character dialogue provides contextual clues.

Repair always requires follow-through over later days. An apology may be acknowledged but cannot immediately restore lost trust. Relationship changes should reflect meaningful interactions rather than allowing repeated dialogue or gifts to race through stages in a single day.

Earned trinkets remain owned and retain their effects even if the relationship deteriorates or the NPC departs.

## Authored quests and permanent failure

An initial authored quest may include a small, optional, one-time reward selected from the supported trinket catalog. The author supplies its personal meaning; authors do not introduce custom executable mechanics.

This version specifies the initial quest reward. Reward cadence for later milestones or long-term goals is not settled and must not be inferred as an automatic reward on every generated quest.

Permanent quest failure is possible. It requires both an authored failure condition and several clearly signaled setbacks. An ordinary unlucky roll alone must not abruptly end the quest. The exact supported authoring rules and warning thresholds are implementation proposals to resolve in the delivery plan.

Permanent failure can lead to departure. Preserve the departed NPC's relationship, memories, and quest history. Returning NPCs and new opportunities on return are deferred from this version.

On later days, available authored NPCs automatically fill open patron spots, with an arrival introduction. Players do not choose arrivals from an invitation roster. Selection timing and availability handling are implementation details; automatic arrivals do not imply an unlimited source of authored NPCs.

## Trinkets and visible tavern improvement

Provide four visible trinket slots in the tavern interface. Reuse the existing scene with supported trinket art placed at fixed positions; no free placement, dragging, construction, or additional material requirements.

Each reward is a complete trinket. Fill an empty active slot automatically when it is earned. If all four slots are occupied, add it to the player's collection. Players can freely swap which four are displayed and active. Only active trinkets contribute bonuses.

Multiple active trinkets may provide the same bonus. Matching bonuses add together rather than compound. For example, two ten-percent food revenue bonuses total twenty percent; these numbers illustrate arithmetic and are not approved balance values.

The initial supported effects are:

| Effect | Intended benefit |
| --- | --- |
| Food revenue | Increase revenue from food sales |
| Drink revenue | Increase revenue from drink sales |
| Harvested ingredient quality | Improve the quality of harvested ingredients |

Each trinket has one effect. The game defines its strength and arithmetic. The author chooses supported artwork and supplies the personal story meaning. Distinct earned trinkets with the same effect can coexist; the same reward event must not issue repeatedly.

The four active slots limit simultaneous bonuses. Further numerical tuning, quality caps, and the moment at which an effect applies must be explicit in implementation and validated against existing economy and harvest rules.

## Gardening discovery and feedback

Gardening should feel like learning an ecosystem through observation and experimentation, while rewarding players who enjoy optimization. Avoid presenting living conditions as a spreadsheet or exposing an optimal treatment list.

Preserve depth around soil quality, moisture and overwatering or underwatering, NPK nutrients, light, companion planting, flowering, pollination, bees, and harvest decisions. The direction does not require random failures to manufacture uncertainty or a wholesale replacement of existing simulation rules.

Reuse existing plant artwork. Use a simple attention marker, such as an exclamation point, when a plant needs inspection. Additional artwork for every plant condition is outside this version's scope.

Basic inspection is free and reveals all currently observable clues in text. It does not require diagnostic tools. Describe signs such as drooping leaves or wet soil without displaying exact underlying condition values or prescribing the correct treatment. The marker flags a problem; the text carries the evidence needed to reason about it.

Seed descriptions provide useful basic guidance before planting: sun and moisture preferences and relevant traits such as attracting bees while flowering. Reward curiosity and close reading. Subtler relationships, including companion effects, moisture retention, and harvesting versus leaving flowers for bees, become learnable through observation and experiments.

Provide a short automatic care history for each plot: planting, care actions such as watering and fertilizer, and daily inspection clues. It supports comparison across days without numerical analysis or treatment recommendations. Ordinary quantities, including inventory, seed counts, prices, and amounts applied, remain clear.

The history retention length, specific clue vocabulary, and severity thresholds are proposed tuning details rather than settled player-facing requirements.

## Model efficiency and spend tracking

Updated user decision, October 4, 2026: try GPT-6 Luna only for all text-model calls first. Do not run a Sol comparison or add an automatic Sol fallback. Image and embedding models are outside this text-model change.

Keep the current prompts, context limits, processing stages, and game-rule validation for this trial. Do not combine this routing change with prompt-release adoption, context redesign, call consolidation, or stage removal. Previously completed prompt deduplication remains separate; its text-byte reduction is not measured token savings.

Use ordinary gameplay and existing test paths for the initial trial. Do not build a new fixture suite or synthetic benchmark program for token efficiency. Record the model actually used, token usage (including cached tokens where available), cumulative spend, errors/retries, and noticeable NPC behavior issues. Use existing telemetry where possible and keep any additional recording lightweight. Label estimated costs honestly when provider billing is unavailable.

There is no user-imposed spending cap or automatic spend cutoff: the user explicitly removed the earlier one-dollar cap and requested spend tracking instead. This authorizes the scoped Luna trial, not unrelated or indefinite API workload. Simpler phrasing is acceptable; preserve personality, memory accuracy, hidden motives, promise ownership, and quest behavior. If important behavior fails, record the evidence and review the next change rather than silently switching models.

Any applicable unresolved payload-export approval restriction still applies; report it if it prevents a live run. The scoped plan requires no additional model bake-off, new fixture suite, or cost-optimization redesign before trying Luna and recording results.

## Acceptance scenarios

1. A player learns an NPC's goal, proposes different remaining steps, and receives an acceptance or refusal consistent with that character. Accepted changes persist while the objective and completed history remain intact.
2. Hospitality changes success chances without guaranteeing the overnight result. Dialogue does not announce an uncommitted change as completed.
3. An accidental offense causes a clear negative relationship indicator without requiring a stage change. An apology alone does not reverse it; follow-through on later days can support repair.
4. Increasing trust changes disclosure and receptiveness. Falling trust can reduce the displayed stage, while earned trinkets remain owned.
5. Quest completion awards its optional trinket once. An empty slot fills automatically; the fifth earned trinket enters the collection. Freely swapping changes active visuals and effects, and matching effects add.
6. A plant attention marker leads to free textual inspection. Seed guidance and care history help the player interpret clues without exact condition statistics or prescribed cures.
7. Spending time reading, experimenting, or conversing does not advance the day. Explicit end-day advances the relevant world systems.
8. Authored failure conditions plus repeated visible setbacks can culminate in permanent failure and departure. History remains intact; a later day can introduce a different available authored patron.

## Deferred scope and remaining tuning

Deferred: free furnishing placement, construction projects for quest rewards, unique author-programmed effects, new condition-specific plant art, diagnostic tool progression, dedicated friendship scenes, additional relationship quests, and departed NPC returns.

The implementing agent may choose and document reversible numerical stage thresholds, per-interaction relationship limits, multi-day repair accounting, supported failure-condition parameters, setback counts and warning rules, trinket strengths and effect timing, arrival selection details, and care-history retention without waiting for further approval. Preserve the approved product behavior; material changes to that behavior require clarification.

This specification is ready for an implementation gap review. Completion means demonstrating the acceptance scenarios as one coherent prototype, not merely adding isolated fields or prompts.
