# Agent handoff for the relationship and garden prototype

The prompt below is for a separate coding agent. It describes future implementation work; the preparation of this handoff has not started that implementation. Tracking issue: [Complete the relationship and garden prototype with quest trinkets and visible progression](https://github.com/dutycaws/ByRookAndCrook/issues/35).

## Ready to use prompt

Implement https://github.com/dutycaws/ByRookAndCrook/issues/35 — “Complete the relationship and garden prototype with quest trinkets and visible progression” — in the By Rook and Crook repository. Use goal mode to pursue the issue's acceptance criteria through implementation and verification. Set a concrete goal for the complete issue; do not invent a token budget. Mark it complete only when the required implementation and verification are actually finished.

Read the issue in full, then read `docs/design/relationship-garden-prototype-spec.md` and `docs/plans/relationship-garden-delivery-plan.md` if available. The issue contains a portable copy of the requirements because these local documents may not yet be committed. The agreed product behavior takes precedence over earlier exploratory suggestions. Read applicable AGENTS.md instructions. Use local agent definitions where available, start with the agent organizer, assign bounded non-overlapping work, and keep a workflow overseer active until completion. Activate the repository with Serena and read its instructions for code navigation.

Begin by inspecting branch, working-tree status, existing code, migrations, pinned prompt releases, tests, and overlapping issues. The preparation audit used the checkout at commit `53b5caa` plus substantial pre-existing local changes; it was not a clean remote branch snapshot. Preserve existing edits, avoid duplicate implementations, and update the gap matrix against the actual starting state. Do not revert unrelated work or perform a destructive reset of a preserved save. A fresh disposable test database is appropriate for migration verification. Follow the repository's prototype policy: simplify obsolete implementations where justified without building unnecessary compatibility layers.

Work in short, end-to-end increments following the delivery plan dependencies. Treat relationship transitions, repair, trinket grants, active effects, quest resolution, and history as durable game state with transactional validation. Models may propose bounded character interpretation and language; they must not bypass fixed quest objectives, manufacture rewards, or override game-rule outcomes. Implement player-visible behavior, not only schemas and prompts.

Make routine engineering and reversible balance decisions autonomously. The plan explicitly identifies proposed defaults, not user-approved numbers. Record adopted defaults and their reasoning, keep them easy to tune, and do not silently expand the product scope. Resolve factual questions through code inspection. Escalate only a material product contradiction or unavailable authorization that cannot be resolved within the issue.

Build and verify these connected journeys:

- A patron accepts or refuses a remaining-plan suggestion; accepted changes persist without modifying the objective or completed steps. Hospitality affects chance without guaranteeing success.
- An accidental offense visibly damages the relationship even within a stage. An apology alone does not repair it. Later-day behavior can restore trust; repeated same-day inputs cannot farm unlimited progress.
- Completing an eligible authored quest grants its trinket exactly once. Four visible slots auto-fill; later rewards enter the collection. Free swaps update visuals and active effects. Duplicate effect types add, stored trinkets do not apply, and earned rewards survive relationship deterioration or departure.
- A garden warning marker opens free qualitative inspection using existing art. Seed guidance and per-plot history make an experiment understandable across days without exposing exact living-state values or prescribing a cure.
- Only explicit end-day advances simulation. An authored failure condition plus several warned setbacks can culminate in departure; history survives and a different eligible authored patron can arrive automatically on a later day.

Use focused unit and database tests for rules and persistence, then a small number of meaningful browser journeys for integrated behavior, including the Lira quest flow where applicable. Use mocked or deterministic model responses for most regressions. Run required repository checks; broaden tests when changes or failures justify it. Include UI checks for obvious relationship feedback, usable trinket slots, and garden inspection without requiring new condition art.

Keep the model-cost comparison separate and bounded. Candidate routes are GPT-6 Luna for all text stages versus GPT-6 Sol for character/creative work with Luna for support. Preserve validation while comparing. Measure per-stage input/output/cached tokens where available, repair counts, latency, cost per successful interaction, and behavior quality. Do not mistake prompt byte reduction for billed token reduction. Existing prompt releases are pinned; code edits alone do not adopt a new release. Do not remove safeguards to improve a cost number.

No paid model calls are authorized by this handoff alone where the existing payload-export approval restriction remains unresolved. Prepare exact reviewable synthetic payloads and an estimated run cost first, retain all applicable review decisions, and request the necessary approval without bypassing it. Continue offline implementation and verification meanwhile. Report an unrun live comparison honestly rather than claiming success.

Keep the issue checklist and a concise progress record current as implementation proceeds. Record changed files, decisions, validation evidence, and blockers. Do not mark a milestone complete from mocked coverage alone if it requires UI or live evidence. Do not merge, deploy, or publish unrelated content. If a pull request is created, attach it to the task and provide a concise description of behavior and validation.

At completion, report the implemented acceptance criteria, verification results, adopted tuning defaults, and any genuinely deferred work. If a required criterion remains blocked, keep the goal incomplete and clearly state the blocker. Follow the goal tools' lifecycle rules rather than repeatedly declaring completion or blocked status without evidence.
