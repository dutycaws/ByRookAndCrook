# Prompt instruction deduplication — local review

No external model calls or token-count requests were made. Provider transport was replaced by a local capture function. No models, context limits, schemas, validators, decision/speech separation, or repair stages changed.

## Exact measurements

Baseline: expanded working-tree prompts captured immediately before this change, including the earlier keeper-promise attribution fix and closed quest proposal contract. This is not a comparison against Git HEAD.

| Stage | Characters before → after | UTF-8 bytes before → after | Request bytes saved |
|---|---:|---:|---:|
| dialogue.investigate | 1721 → 1252 | 1721 → 1252 | 469 |
| dialogue.deliberate | 2379 → 1859 | 2379 → 1859 | 520 |
| dialogue.speak | 2461 → 1638 | 2461 → 1638 | 823 |
| dialogue.review | 2804 → 1852 | 2804 → 1852 | 952 |
| dialogue.remember | 1947 → 1445 | 1947 → 1445 | 502 |
| quest_transition.proposer | 2605 → 2015 | 2611 → 2021 | 590 |
| quest_transition.critic | 858 → 752 | 858 → 752 | 106 |
| quest_transition.repair | 2227 → 2046 | 2235 → 2052 | 183 |
| quest_transition.final_critic | 644 → 581 | 644 → 581 | 63 |

Across one instance of each changed stage: 17,660 → 13,452 system-prompt UTF-8 bytes; 4,208 fewer bytes (23.8%). This is NOT a per-turn total: stages are separate calls and conditional/retried stages vary. No token counts or behavioral quality improvement are claimed.

Dialogue measurements use the actual buildDialogueResponseBody with the same fixed synthetic user payload, schema/tool definitions, model label and controls. Quest measurements capture the actual provider preflight token-bearing projection (system/user messages and structured-output schema) before any transport. They are not full HTTP body sizes. Non-prompt fields are compared for exact equality.

## Scope and safeguards

- Retained the common evidence/instruction boundary on each separate dialogue call; compressed its repeated explanations.
- Retained canon versus attributed claims/beliefs, public/private separation, believable refusal, source/speaker attribution, keeper-versus-NPC promises, public speech limits, and concrete review findings.
- Clarified the existing invariant: dialogue can replace remaining plan steps, never the active quest objective, motivation or targets. Removed contradictory permission to change objectives.
- Retained accepted-plan authority over old retrieved plans, one step per night, terminal quest restrictions, allowed actions/targets and no invented outcomes.
- Kept the full closed quest-transition proposal contract exactly once in proposer and repair requests. Removed duplicated mechanical restatements around it; preserved author authority, continuity and all critic stages.
- Left other settlement families, all provider/model routing, structured schemas, deterministic validation, memory quotas and runtime caps unchanged.

## Versioned rollout

New migration: supabase/migrations/20261003210000_prompt_instruction_dedup.sql. It appends nine revisions, creates a full new immutable release, copies unchanged entries, and atomically activates the release for future work with an audit event. Prior revisions/releases and existing work pins are untouched. Contract IDs/hashes and prompt types stay unchanged.

The migration is prepared locally and tested only in a disposable isolated database. It has NOT been applied to the running application database. Its active prompts and existing pins therefore do not receive these savings yet. Applying it later will affect newly pinned work; existing work continues its exact original snapshot. Source changes alone do not replace stored prompt bodies.

PROMPT_VERSION remains npc-prompts-v6 for existing checkpoint compatibility; revision/content hashes identify the changed instructions.

## Verification and limits

Focused unit tests cover source/release-body parity, request controls and user data, prompt registry pin resolution, dialogue preflight/orchestration, quote checks, and quest proposal/critic/repair validation. The new SQL test covers complete old/new release maps, exactly nine changed revisions, unchanged contracts, content hashes and activation audit. Recorded local results: 96 focused unit tests passed (8 files); 43 SQL assertions passed in a fresh disposable database (2 files), which was then removed; application check reported zero errors/warnings; git diff --check passed. Local logs: /tmp/brac-prompt-dedup-tests.log, /tmp/brac-prompt-dedup-sql.log, /tmp/brac-prompt-dedup-check.log.

No live language-model quality evaluation was authorized. Static safeguards and mocked-path regressions cannot prove identical refusal quality, narrative quality, or model compliance. Before paid comparison, approve exact outgoing synthetic payloads and pricing/budget controls. The earlier incomplete synthetic comparison draft was removed during cleanup and is not restored here.

## Original local files / payload sources

- before.json (restored locally): full pre-edit repository prompt bodies, local-only.
- after.json (restored locally): full post-edit source bodies, local-only.
- assembled-prompts.diff: exact expanded-body changes relative to before.json.
- measurements.json (restored locally): character/byte counts and body SHA-256 hashes.
- measure.mts (restored locally): offline reproducible measurement; fixed synthetic message/context literals only; blocks all provider transport.
- ../../src/lib/server/dialogue/prompts.ts and ../../src/lib/server/evolving-world/prompts.ts: changed instruction sources.
- ../../src/lib/server/evolving-world/quest-transition-prompt-contract.ts: pre-existing shared contract, unchanged by this work.

None of these files or their contents was transmitted to a model endpoint. This report does not authorize transmission.

## Restoration note — October 4, 2026

This report and assembled-prompts.diff were reconstructed from retained source history, immutable migration bodies, the report generator and measurement log. All nine before/after prompt pairs match the original SHA-256 hashes (18 verified hashes). The validation and rollout statements above describe the original review; no tests or migration applications were repeated during recovery. The accompanying before/after JSON, measurement rows, and original measurement-script revision were subsequently recovered locally. See ../RECOVERY.md for provenance and limitations.
