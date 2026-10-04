# Lira lifecycle browser acceptance

Final replay: save `e522266e-abb2-4925-bc6a-8263f21e9c4b`, tavern Days 1–6 (five overnight transitions). Root operated the visible built-in browser. Earlier failed and interrupted runs remain in `acceptance-log.md`; their evidence is not combined to establish this run's success.

## Observed lifecycle

- Day 1: untouched baseline, Lira explicitly selected, introductory dialogue and preparation plan saved (106–107).
- Day 2: preparation complete; readiness conversation, food gift, and scouting attempt through player controls (108).
- Day 3: Scout camp archived as succeeded on Day 2; Secure road active (109). One unverified reply (110); one shorter rephrase saved (111).
- Day 4: Secure road preparation complete; saved dialogue matches the combat attempt and traveler-safety constraints; food served (112).
- Day 5: Secure road archived as succeeded on Day 4. New active quest **Maintain the safer old road** explicitly references the safer passage and restored trusted route (113).
- Day 5: subsequent player conversation saved; Lira specifies a watch record and warning signs. Food served, then the tavern closed (114).
- Day 6: the follow-on's Prepare/scouting step is done and Attempt/scouting is next (115). Reload preserves that progress, seven exchanges, and both authored successes (116).

## Defects and verification

- Fixed omission of the pinned NPC campaign's durable goal from future quest-transition author context. Migration `202610010005_quest_transition_durable_goal.sql` adds the exact canonical value; no outcome, validator, prompt, or budget was weakened. Existing snapshots were preserved. Two new SQL goal assertions failed before the fix; all 70 SQL assertions and 23 worker tests passed afterward. Independent Luna reviewed the proposal and implementation before local application and this fresh full replay.
- Earlier dialogue admission and selected-resident archive fixes are documented in the acceptance log. The final replay saved seven exchanges and consistently exposed Lira's authored archive.
- The final replay had one dialogue verification refusal, recovered with one natural rephrase. This remains reported as a reliability limitation, not silently counted as a saved exchange.
- Overnight world-news reports used the no-report fallback. Earlier local diagnostics identified `canon` provider-malformed failures; quest progression still completed. World-news generation is not accepted by this test.

## Authorized setup shortcut and coverage

At the user's request, `grant-lira-loaves.mjs` added six ordinary Resplendent loaves to the new save. It writes only food inventory, defaults to dry-run, requires an explicit apply, validates the save owner/open phase, caps a grant at six, and uses deterministic IDs to prevent duplicate grants. Five loaves were served through visible player controls; one remains. No quest, intention, readiness, relationship, day, or outcome was directly edited. The final replay bypassed garden/bakery/brewery minigames; earlier runs exercised crafting.

The departure alternative and the dynamic quest's eventual completion were not tested. The requested follow-on interaction and measurable progression were tested. Final independent evidence verdict is recorded in the acceptance log.

## Follow-on completion extension
The user subsequently requested completing the follow-on. On Day6 a new safety-planning dialogue saved (exchange8), the remaining supplied loaf was served, and the tavern closed normally. Day7 shows **Maintain the safer old road — Successor quest — Succeeded (Day6)**. Reload preserved its completed archive entry alongside both authored successes (117–119). Lira remains present, considering her next step. This extension used no additional database writes, reset, or code fixes. Departure and any second follow-on remain unverified.
