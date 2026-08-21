# ClipQuest production quiz-generation QA: 10 fresh videos, extension 0.8.7 canary

Date: 2026-08-12 (Asia/Shanghai)  
Site: `https://clipquest.ccwu.cc`  
QA user: `cqqa46585354` (`WC3GVPrC6dsnijm5VHVdtwFvBgtMeH5X`)  
Code: `ba09c94b47db13f0b9187272dbac0f4571982a09`  
Canary Worker: `387c074e-e81e-4f57-95af-63cdfd52935a`  
Prompt/validator/profile: `quiz-local-json-stream-v5.7` / `validator-local-progressive-v4.6` / `evidence_grounded_auto_v5_4`  
Extension gate proven by accepted imports: `0.8.7` + `question-stream-v5`, protocol 8, pipeline 9

## Verdict

**BAD — canary rejected and disabled.**

- 10 different non-AP-math YouTube videos were tested in real Chrome.
- The matrix requested 3 five-question banks, 4 ten-question banks, and 3 fifteen-question banks: 100 planned questions total.
- **0/10 banks completed.**
- **9/100 questions were accepted and answered correctly.** The product prevented every incomplete attempt from receiving a score or `completed_at` value.
- 6/10 runs reached a fully interactive first question. Among those six, mean q1 latency was 14.445 seconds, median was 16.068 seconds, and observed p95/max was 20.682 seconds.
- The ten counted runs made 35 observed/recorded DeepSeek calls: 18 primary calls and 17 automatic retries. An additional greenhouse MC-only diagnostic rerun made 3 calls and 2 retries before q1, but is not included in the ten-run totals.
- Four runs failed before q1, four reached `generation_failed` after accepting a prefix, and two remained stuck in `recovering` without a subsequent retry event.
- The canary was rolled back after the gate failed. Production again serves Worker `3ff9639a-c300-4b42-8e1a-895c0bdf6bcb` with `rolloutMode: disabled`; D1 evidence was preserved.

## Matrix

| Run | Fresh source | Planned | Types | Fully interactive q1 | Accepted / answered | DeepSeek calls | Auto retries | Final observed result |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| 1 | [What Is the Greenhouse Effect?](https://www.youtube.com/watch?v=SN5-DnOHQmE) | 5 | MC / T-F / short | ~8.022 s | 2 / 2 | 5 | 2 | `generation_failed`; q3 recorded three `answer_mapping_invalid` attempts, while the later summary reason drifted to `duplicate_question` |
| 2 | [Vaccines 101: How vaccines work](https://www.youtube.com/watch?v=4SKmAlQtAj8) | 5 | MC only | 8.060 s | 2 / 2 | 5 | 2 | `generation_failed`, `answer_mapping_invalid` at q3 |
| 3 | [What is Linguistics?](https://www.youtube.com/watch?v=3yLXNzDUH58) | 5 | short only | None; stopped at 18.021 s | 0 / 0 | 3 | 2 | q1 `rubric_invalid` after all three attempts |
| 4 | [Supply and Demand](https://www.youtube.com/watch?v=g9aDizJpd_s) | 10 | T-F only | None; stopped at 9.790 s | 0 / 0 | 0 | 0 | false-positive `non_instructional_source` before a model call |
| 5 | [Public Key Cryptography](https://www.youtube.com/watch?v=GSIDS_lvRv4) | 10 | all | None; stopped at 11.372 s | 0 / 0 | 3 | 2 | q1 `answer_mapping_invalid` after all three attempts |
| 6 | [How WiFi Works](https://www.youtube.com/watch?v=vvKbMueRzrI) | 10 | all | 20.682 s | 2 / 2 | 9 | 6 | `generation_failed`, `answer_mapping_invalid` at q3 after repeated duplicate repairs |
| 7 | [Socialization](https://www.youtube.com/watch?v=K-RvJQxqVQc) | 10 | all | 14.862 s | 1 / 1 | 2 | 0 | stuck in `recovering`; q2 primary was `rubric_invalid`, but no retry event followed during the observation window |
| 8 | [Photosynthesis](https://www.youtube.com/watch?v=sQK3Yr4Sc_k) | 15 | all | None; stopped at 18.904 s | 0 / 0 | 3 | 2 | q1 `answer_mapping_invalid` after all three attempts |
| 9 | [Language Acquisition](https://www.youtube.com/watch?v=Ccsf0yX7ECg) | 15 | all | ~17.772 s | 1 / 1 | 2 | 0 | stuck in `recovering`; q2 primary was `rubric_invalid`, but no retry event followed |
| 10 | [How YouTube Works](https://www.youtube.com/watch?v=OqQk7kLuaK4) | 15 | all | ~17.273 s | 1 / 1 | 3 | 1 | `generation_failed`, `rubric_invalid`; q2 first failed as a duplicate |

Run 1 had one extra diagnostic rerun on the same source with MC only. It never created a bank: q1 failed `answer_mapping_invalid` after 3 calls and 2 automatic retries. This rerun is evidence, not an eleventh matrix video.

## Critical defects reproduced

### 1. The strict generation contract is not viable with the current prompt/model output

All three question families failed independently:

- MC: repeated `answer_mapping_invalid` on the greenhouse rerun, vaccines q3, public-key q1, photosynthesis q1, and WiFi q3.
- True/False: the first greenhouse bank stopped on its q3 True/False slot after the primary call and two answer repairs.
- Short answer: linguistics q1 failed `rubric_invalid`; socialization and language-acquisition stopped after their q2 rubric failures; How YouTube ended on a rubric failure.

The repair prompt is not failure-specific enough. In particular, `answer_repair` tells the model to make “the correct answer and distractors” distinct even when the failing slot is True/False, where the actual contract requires exact supported-statement/mutation behavior.

### 2. Automatic recovery can claim activity without making progress

Runs 7 and 9 remained `recovering` for several minutes with:

- one accepted question;
- a recorded failed q2 primary call;
- zero recorded automatic retries;
- no new accepted question; and
- no terminal state while observed.

The learner saw “Recovering this quiz in this tab,” but authoritative call telemetry did not show a recovery request. This is not zero-intervention recovery; it is an indefinite active-looking state.

Run 1 also ended with a summary reason of `duplicate_question` even though its last recorded model event was `answer_mapping_invalid`. That reason/event divergence needs reconciliation.

### 3. Concept-quality gates still admit poor questions

Observed accepted examples:

- Vaccines: “How do vaccines create immunity according to the described mechanism?” The phrase depends on an unspecified description and is not source-independent.
- WiFi: “How often does a Wi-Fi access point typically send out a beacon packet?” This tests the exact `102.4 milliseconds` statistic rather than a transferable networking concept.
- Socialization: the question described secondary socialization, while the correct option merely repeated the question’s wording instead of naming the concept. It was effectively tautological.
- How YouTube: “Which factor is identified as the most variable…” but every option was only a degree of variation; none identified a factor.
- Language acquisition feedback said “The evidence states…”, allowing learner-visible evidence/source framing through the explanation validator.

### 4. Strict excerpt selection rejects obviously instructional material

The Supply and Demand Crash Course source was rejected as `non_instructional_source` before any DeepSeek call, despite being a direct instructional explanation of supply, demand, prices, and producer behavior. Either trusted captions were incomplete at strict selection time or the positive-score sentence gate is too narrow.

### 5. Source metadata remains incomplete

All ten remote `videos` rows stored `duration_seconds = 0` and `source_language = NULL`, even though the create screen reported complete source captions. This undermines authoritative duration/language persistence and can distort ETA, resume, and source-readiness diagnostics.

### 6. First-question timing and ETA do not meet the gate

- Only 6/10 runs ever reached q1.
- Observed p95/max for fully interactive q1 was 20.682 seconds, above the 15-second target.
- On runs 1, 9, and 10, the quiz route/progress appeared before all four MC choices were present in the accessibility tree; timing must be measured at complete interaction readiness, not route navigation.
- Retry labels could still say “to question 1” while a later ordinal was being repaired immediately before q1 navigation, making the ETA phase ambiguous.

## What worked

- Every stored bank used v5.7/v4.6, protocol 8, pipeline 9, and the grounded profile. The test did not accidentally exercise legacy v5.1.
- The first validated question was shown progressively when available.
- All nine submitted answers graded correctly.
- Accepted prefixes were preserved.
- No incomplete bank received a score or completed timestamp; every planned item count stayed at 5, 10, or 15.
- DeepSeek, transcript material, and the API key remained extension-local in the exercised architecture.
- General production was not broadly enabled: the canary affected only the approved QA IDs and was disabled after failure.

## Required remediation before another canary

1. Replace the shared repair guidance with exact per-type repair contracts, especially a grounded True/False repair that explicitly regenerates `supportedStatement`, `mode`, and a locally verifiable mutation.
2. Decouple short-answer rubric validity from model paraphrase abundance: deterministically derive/dedupe safe alternatives locally where possible and reject only genuine semantic omissions.
3. Make MC grounding validate the correct answer and distractor semantics without requiring brittle substring containment between evidence and answer.
4. Fix the recovery state machine so a `recovering` transition must either produce a leased call event within a bounded heartbeat or become a safe terminal/cooldown state.
5. Make summary reason codes derive from the last authoritative call event or record the missing call before changing the reason.
6. Expand instructional sentence scoring for clear explanatory prose and log local, privacy-safe selection counts so `non_instructional_source` can be diagnosed without transcript upload.
7. Add direct-question semantic checks for unspecified phrases such as “the described mechanism,” tautological option/question pairs, malformed wh-question/answer-kind mismatches, source/evidence framing in explanations, and low-value numeric recall.
8. Persist trusted duration and source language from the extension handoff.
9. Repeat the same ten-video matrix only after deterministic fixtures reproduce and fix every failure above. Do not re-enable the grounded canary before those regressions pass.

## Release state after QA

- Active Worker: `3ff9639a-c300-4b42-8e1a-895c0bdf6bcb`
- Active tag/code: `ba09c94b47db13f0b9187272dbac0f4571982a09`
- Rollout: `disabled`
- Effective default profile: `legacy_reasoning_v5_1`
- Failed canary evidence preserved in Worker version `387c074e-e81e-4f57-95af-63cdfd52935a` and the D1 quiz/call-event rows listed above.
- No production database wipe, migration, question replacement, or partial scoring occurred.
