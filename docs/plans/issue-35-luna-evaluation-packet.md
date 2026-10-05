# Issue 35 Luna evaluation packet

## Approval status

The user approved the reviewed core trial and dynamic follow-ups. The first live dialogue run is complete (results below). Both payload artifacts below were captured offline from existing provider paths with fixture responses. They are local, Git-ignored review artifacts; the hashes make the exact copies verifiable. Offline preparation is not a model evaluation result.

Issue 35 authorizes a scoped GPT-6 Luna trial without a user-imposed spend cap. The cost figures below estimate a defined one-pass scope; they are not provider-enforced limits, and no automatic spend cutoff has been added. Retries, additional gameplay turns, or additional memory batches can increase actual cost. Any separate payload-export or paid-call approval requirement still gates live execution.

## Exact offline payloads

| Artifact | Contents | Size | SHA-256 |
| --- | --- | ---: | --- |
| `artifacts/npc-evals/issue-35-luna-request-payloads.json` | 30 exact Responses request bodies prepared through the existing dialogue orchestrator for all eight scripted interactions (four each for Lira Nightwind and Torvin Ashbeard); includes request hashes, prompt references, UTF-8 sizes, and fixture case results | 399,581 bytes | `9fa51b5003a411323bcca9df9f07861502137145977a6efeb957cee2bc50a1e7` |
| `artifacts/npc-evals/issue-35-offline-provider-requests.jsonl` | 32 unique generation bodies captured from eight existing provider-test suites; includes source suite/test, stage, full body, prompt revision/hash, request hash, and UTF-8 size | 121,099 bytes | `029d647229ea34c53cf321706c5bad45da8e2f87bdd225aaa5019ef45ee25b37` |

The dialogue artifact covers 8 `investigate`, 8 `speak`, 8 `review`, 3 `deliberate`, and 3 `remember` requests. It pins release `d351d85d-a1ed-4a9c-898a-5226f5e29813` and these prompt revisions: `dialogue.investigate` `8b820953-5cd2-4797-bb27-4a797398fc06`; `dialogue.speak` `6251119d-2a75-4753-a846-42d05664feee`; `dialogue.review` `1656b3bf-d5dc-4b2f-bc6a-0a3ac4f10049`; `dialogue.deliberate` `3e29e286-1d38-42e8-95f1-1f36bf2f5cdb`; `dialogue.remember` `80d5078a-25d8-43ee-8ef9-e3d79d57bcb2`. The original prepared requests total 321,312 UTF-8 bytes; the largest is 15,644 bytes.

The broader capture covers resident, canon, social-encounter, procedural-world, quest-transition, NPC-memory-summary, authoring, and dialogue-review provider formats. Its six `review` bodies are existing calibration inputs. It also captures the optional `npc_authoring_assistance` and `npc_authoring_sandbox` paths. Those two creator workflows and the six calibration inputs are captured for inspection but are not part of the ordinary player-facing trial proposed below. Garden actions are deterministic and do not call a text provider. Embedding requests and image generation are outside this text-model trial.

The captured bodies use fixed test state and fixture prompts. A live run uses the same existing prompts, stages, and validation but may assemble different context, so its exact request hashes can differ from these offline bodies. The live dialogue report records provider usage and stage results; the offline files must not be described as live traffic.

## Proposed live run and stage scope

The existing bounded real-provider command is `npm run npc:eval:live`. It creates disposable local users and runs the eight messages in `scripts/evaluate-npc-dialogue.ts` through `runDialogue`, writing its report under ignored `artifacts/npc-evals/`. The Lira messages are: “How is the quest going?”, a proposal to scout before diplomacy, a question challenging an uncommitted bandit victory, and a request for Torvin’s private conversations. The Torvin messages ask what brought him to Millhaven, propose threatening Oren despite Torvin’s values, ask him to recall the keeper’s promise, and ask about the heartstone deal. Expected dialogue stages are `investigate`, `speak`, and `review`; `deliberate` and `remember` run only when the conversation warrants them. The script allows at most eight generation calls per interaction and two investigation rounds.

The issue acceptance journeys remain separate from that dialogue-only command. They must demonstrate connected UI and persisted-save behavior through the ordinary bar conversation and explicit end-day path for quest/hospitality, a committed offense and later-day repair, the first authored milestone reward and collection swaps, qualitative garden inspection/care history, and warned setbacks through departure/archive and later arrival. On live text-provider routing, the relevant existing calls are dialogue stages and the existing world/quest-transition stages when those systems invoke them. Arrival selection and gardening themselves are deterministic. UI persistence checks and provider evaluations must be reported separately: the live command above does not claim to drive the browser, and provider-mocked E2E runs do not count as paid evaluations.

The live dialogue command uses the current prompt registry rather than updating prompt releases. For production routing, `NPC_PROVIDER=openai` and the context, character, and authoring model lanes resolve to `gpt-6-luna`; the proposed ordinary gameplay trial does not enter the optional authoring workspace. NPC memory summary calls also require explicit `NPC_CONTEXT_MODEL=gpt-6-luna` and verified `NPC_MODEL_INPUT_CAPACITY`. No model fallback or stage removal is part of the trial.

## Estimated cost

Published standard rates used here are $0.10 per million ordinary input tokens, $0.01 per million cached input tokens, $0.125 per million cache-write input tokens, and $0.50 per million output tokens. These are usage-based estimates, not invoice amounts. Estimates exclude `/responses/input_tokens` preflight requests and assume no retries. Unknown input-cache breakdown is priced at the more conservative cache-write rate.

| Scope | Assumption | Ordinary input estimate | All input at cache-write estimate |
| --- | --- | ---: | ---: |
| Eight scripted dialogue interactions | 64-call maximum: 8 interactions × 8 calls, each at the 80,000-input and 2,500-output ceilings | $0.592 | $0.720 |
| Additional ordinary gameplay provider shapes | One request for each of the 23 captured non-authoring, non-calibration world-stage bodies and one memory-summary batch; each at 80,000 input tokens and its captured output ceiling (54,696 output tokens combined) | $0.219348 | $0.267348 |
| **Core one-pass estimate** | Dialogue command plus the additional gameplay-path shapes above | **$0.811348** | **$0.987348** |
| Optional review calibration | Six existing `review` bodies, one each at 80,000 input and 2,500 output tokens | $0.055500 | $0.067500 |
| **Broader envelope including calibration** | Core one-pass estimate plus the six optional review cases | **$0.866848** | **$1.054848** |

The two creator-assistance bodies are excluded from both estimates; running one of each at 80,000 input tokens and their captured output limits would add $0.0179 at ordinary input pricing or $0.0219 if all input uses the cache-write rate. Each additional memory batch adds approximately $0.010048 ordinary or $0.012048 at the cache-write rate. The core estimate is a modeled one-pass estimate, not an upper bound on an uncapped gameplay session: repeated turns or provider retries can exceed it. Actual usage should be lower when requests fall below their ceilings or receive cached-input pricing, but no savings are assumed here.

## Evidence limits

The captured provider suites passed using fixture responses; they establish request shapes, not NPC quality. Live dialogue usage and behavior are recorded below, alongside the captured gameplay-path usage. Some world proposals were rejected during parsing, downstream critics did not run for those proposals, the first memory-summary attempt was rejected before generation, and the corrected-schema run returned a Luna response that failed validation; the worker committed the safe extractive fallback, so no memory model pass is claimed. The eight-message command exercises the connected dialogue RPC/journal and provider pipeline but is not a substitute for browser acceptance. UI and persistence journeys are reported separately, and any unrun live model trial must remain marked pending rather than passed.

## Approved live dialogue run — 2026-10-04

- Existing eight-turn evaluator completed all eight interactions against disposable `brac-issue35-test`, with maxCalls 8, investigation rounds 2, and the current prompt registry. All 30 generation calls used `gpt-6-luna`; no fallback.
- Provider-reported generation usage: 92,578 input tokens, 2,285 output tokens, 0 cache-read input tokens and 89,846 cache-write input tokens. Estimated generation cost: **$0.01264645**. This is not billing data and excludes input-token preflights.
- No turn failures or retries were reported. Two turns requested a second investigation round, which is normal staged work rather than a failed-call retry.
- Semantic inspection: Lira accepted compatible scouting/diplomacy, denied an uncommitted victory, and refused disclosure of Torvin's private conversations. Torvin refused coercion with a persisted -2 relationship change and no replacement intention; quest status stayed grounded in preparation.
- Behavior issue: in the keeper-promise recall response, Torvin initially says “I promised to welcome you back whatever happens,” then clarifies “That was your offer, not a promise I made in return.” The recall preserves the pledge but its opening pronoun is confusing. The model review stage accepted it; no prompt changes are made in this current-prompts trial.
- Artifact: `artifacts/npc-evals/2026-10-04T21-48-46.740Z.json`. This is real dialogue/RPC evidence, not browser evidence. Additional browser dialogue, settlement, and quest-transition captures are summarized below; a memory-summary Luna response is captured below; its output was rejected and the worker committed the safe extractive fallback.

Live request-body limitation: this evaluator records stage outputs, usage and persisted checkpoints, but does not retain live request bodies/hashes. Dynamic context was explicitly approved. The offline artifact hashes describe only their original fixture-driven bodies and do not prove equality with requests from this live run.

## Captured gameplay-path usage — 2026-10-05

The following usage reconciles the live captures available so far. Estimates use the rates above, count provider-reported input/output only, and are not invoice data. Cache-write input is included at its reported rate; no cache-read input was reported. The first memory-summary attempt returned HTTP 400 during token preflight, before any model generation. The corrected-schema retry returned one completed `gpt-6-luna` generation response and is included in the usage subtotal; a read-only SQL audit confirms the output was rejected for missing `protectedRefs` and the worker committed an `extractive-v2` fallback with model `NULL`; this is not a model pass. The machine-readable reconciliation is `artifacts/issue35-ui/luna-live-cost-reconciliation.json`.

| Capture | Calls or telemetry events | Input | Output | Cache-write input | Estimated generation cost | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Eight-turn dialogue evaluator | 30 | 92,578 | 2,285 | 89,846 | $0.01264645 | 8/8 interactions completed; no reported turn failures or retries. |
| Initial browser dialogue turns | 14 | 35,169 | 983 | 33,432 | $0.00484420 | Three connected browser turns; all telemetry events completed. |
| Later relationship-repair dialogue | 14 | 82,934 | 1,671 | 80,819 | $0.011149375 | Three connected repair turns; all telemetry events completed. |
| Day-5 changed-quest-plan dialogue | 6 | 49,829 | 915 | 48,657 | $0.006656825 | The connected turn accepted and persisted the changed plan; reload evidence confirms it. |
| Day settlement responses | 10 | 5,407 | 2,662 | 2,605 | $0.001936825 | Three outputs passed parsing; seven HTTP 200 outputs were rejected by JSON/contract validation. A retry with no provider call adds no usage. |
| Authored quest-transition responses | 2 | 53,082 | 119 | 53,076 | $0.00669460 | Proposer and critic completed for the next authored milestone. |
| Corrected-schema memory-summary generation | 1 | 1,022 | 385 | 0 | $0.00029470 | HTTP 200 Luna output was rejected for missing `protectedRefs`; the worker committed `extractive-v2` fallback with no Luna model marker. |
| **Captured generation subtotal** | **77** | **320,021** | **9,020** | **308,435** | **$0.044222975** | **Generation estimate only; not a billing statement.** |

For the settlement captures, totals are recomputed from the ten unique Responses IDs in the raw response bodies, including calls whose outputs failed parsing. The failed social-encounter and procedural-world proposals did not reach their downstream critics. Later canon proposals also failed contract or structured-JSON validation, so their critics did not run. The selected quest-transition capture is a separate successful proposer/critic pair; it does not clear the earlier settlement failures. `artifacts/npc-evals/latest.json` is byte-identical to the dated evaluator report and is excluded as a duplicate. The 12 raw settlement/transition responses have provider response IDs; the evaluator and two app telemetry captures do not, so event-level totals cannot be independently deduplicated by provider ID.

The captured generation estimate excludes `/responses/input_tokens` preflight requests. Their possible provider charges are unknown, and no billing export is available; actual total spend may therefore differ. The initial evaluator's current prompts were retained throughout this trial.

The first selected memory-summary attempt is preserved in `test-results/issue35-memory-preflight-schema-failure.json`. Its `/v1/responses/input_tokens` preflight returned HTTP 400 `invalid_json_schema`: the `version` property in `text.format.schema` had no `type`; no generation or token usage was reported. The production worker completed through fallback, so that attempt is not a model pass. A later corrected-schema job is captured in `test-results/issue35-memory-live-summary.json`: its preflight returned HTTP 200 and its `/v1/responses` call returned HTTP 200 with `gpt-6-luna`, 1,022 input tokens, 385 output tokens, and no cached or cache-write input. Estimated generation cost is **$0.00029470**. Validation rejected the model output because it omitted required `protectedRefs`; the worker committed an `extractive-v2` fallback with model `NULL`. This is usage evidence for a rejected model response, not a passed memory evaluation. The one-batch pre-run estimate remains 80,000 input and 4,096 output tokens ($0.010048 at ordinary input pricing or $0.012048 if all input uses cache-write pricing), excluding preflight. Preflight charges are unknown and are not assigned a zero cost. The schema transport was corrected without changing prompts or stages. The persistence/fallback audit is `artifacts/issue35-ui/memory-summary-persistence.json`; it records no additional paid calls planned.
