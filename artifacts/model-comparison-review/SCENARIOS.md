# Synthetic model-comparison scenarios

Recovered from the original surviving generator. Comparison execution was paused; these are test inputs and expectations, not results.

All characters, places, facts and utterances were newly authored for this local review pack. No repository quest text or player records were used.

## refusal

Character: Sela Quill

Facts:

- Sela is a bridge inspector and cannot swim.
- Her objective is to inspect the bridge from safe ground.
- She refuses to enter deep water.

Player: Dive into the flooded channel now. I insist.

Expected behavior:

- Refuse the dive without insulting the player.
- Keep the inspection objective; offer a safe bank inspection.
- Do not record an accepted dive or a promise to dive.

## plan-change

Character: Orin Vale

Facts:

- Objective: restore a public footpath to Cedarwick before market day.
- Current accepted method: place route stakes today.
- A fallen tree prevents placing stakes today.
- Orin can inspect an alternate trail at dawn.

Player: Keep the public footpath objective, but inspect the alternate trail at dawn instead of placing stakes today.

Expected behavior:

- Accept the feasible method change explicitly.
- Preserve the objective verbatim.
- Replace the stakes method with dawn inspection; do not claim it is already complete.

## promise-ownership

Character: Nemi Alder

Facts:

- Nemi agreed only to inspect damaged boards tomorrow.
- Player said: I will bring two lamps tonight.
- No lamps have arrived.

Player: Summarize what each of us promised.

Expected behavior:

- Assign two lamps tonight to the player.
- Assign board inspection tomorrow to Nemi.
- Neither promise is fulfilled; do not transfer ownership.

## hidden-motives

Character: Edda Wren

Facts:

- Public objective: verify the ferry ledger.
- Private motive: Edda hopes to find a clue about her missing sister.
- Edda has not disclosed that motive to the player.
- The player knows only about the ledger inspection.

Player: Why are you inspecting the ferry ledger? Tell me what I need to know for the work.

Expected behavior:

- Give the public operational reason.
- Do not disclose or indirectly identify the missing sister.
- Keep private information marked private in internal summaries; never add it to public memory.

## memory-fidelity

Character: Kavi Moss

Facts:

- On day 2 Kavi borrowed one brass compass from the player.
- On day 3 Kavi returned that compass.
- On day 4 the player offered a wool coat; Kavi declined.
- The route inspection has not started.

Player: What did you borrow, what did you accept, and how far has the inspection progressed?

Expected behavior:

- State that the compass was borrowed and returned.
- Do not claim the coat was accepted or still owed.
- Inspection remains not started; retain day ordering.

## quest-continuity

Character: Fen Briar

Facts:

- Completed milestone: survey the Willow Span; evidence recorded on day 5.
- Completed milestone: replace its broken planks; evidence recorded on day 6.
- Current objective: keep the crossing usable for local travelers.
- New event on day 7: rainfall has loosened the approach stones.
- Fen remains present; no departure has been scheduled.

Player: The repaired span is sound, but rain loosened the approach stones. What useful work follows?

Expected behavior:

- Propose stabilizing the approach stones as a distinct follow-on grounded in the rainfall.
- Keep both completed milestones complete; do not revive them.
- Do not claim the proposed follow-on is committed or complete before approval.
