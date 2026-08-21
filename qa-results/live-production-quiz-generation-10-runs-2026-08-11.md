# ClipQuest official-site ten-video quiz-generation acceptance

> Superseded production snapshot. This earlier 2026-08-11 matrix exercised Worker `d3a9710e-2b35-497c-bda3-680cf10168a9` before extension 0.8.5 and migrations 0018/0019 were verified live. Use the later [extension-0.8.5 production report](./live-production-quiz-generation-10-runs-extension-0.8.5-2026-08-11.md) for the current tested artifact. Measurements below remain unchanged as historical evidence.

Date: 2026-08-11  
Tester: Codex through the user's real signed-in Google Chrome session  
Account: `UnoxyRich`  
Site: `https://clipquest.ccwu.cc`  
Result: **10/10 final quizzes completed; 100/100 planned questions answered; release goal failed**

## Tested production artifact

- Worker version ID: `d3a9710e-2b35-497c-bda3-680cf10168a9`
- Worker version tag: `8680a2c3b5eda0b44b04f02d6d21e9a63d2337d3`
- Pipeline: `9`
- Every newly stored bank actually used:
  - generation profile `legacy_reasoning_v5_1`
  - prompt `quiz-local-json-stream-v5.1`
  - protocol `5`
  - progressive import `extension-progressive-import-v3`
- `/health` advertises `stable_non_thinking_v5_2`, but its rollout mode is `disabled`.
- Latest production D1 migration: `0017_quiz_generation_call_events.sql`.
- Local checkout at test time: `d1890cb9cdd14ffae03717394b2aeaf62a30f2cd` on `codex/fix-security-findings`.
- The local v5.4 changes and migrations 0018/0019 were **not** the code exercised by this production matrix.

The live page bridge and local DeepSeek extension worked, but the extension's popup version was not exposed through the page. No DeepSeek key, caption text, transcript, prompt, raw model body, or authorization data was included in this report.

## Method

- Used ten distinct educational YouTube videos and the official signed-in learner flow.
- Covered 5-, 10-, and 15-question quizzes with multiple-choice, True/False, and mixed MC/TF banks.
- Timing began at the real **Create my quiz** action after the create screen reported the source ready.
- “Question 1” required the quiz route, a visible question heading, and all expected answer controls. Run 8 briefly rendered an incomplete question view; its conservative upper-bound timing is identified below.
- “Full bank ready” came from the authoritative stored `lastQuestionAt`/accepted-count transition or the equivalent learner indicator transition.
- Every answer was submitted through the visible learner UI. The server-defined correct response was selected to exercise canonical/display option mapping and the complete scoring path; this was not a blind assessment of learner knowledge.
- Every result was reconciled against remote D1: attempt status, planned/stored count, bank quality status, score, and call-event classifications.
- Caption acquisition was usually warm from the extension's local cache. This is a quiz-generation benchmark, not a cold-caption benchmark.

## Per-run results

| Run | Video | Quiz | Q1 interactive | Full bank ready | Create to completion | Stored calls | Auto retries | Learner recovery | Result |
|---:|---|---|---:|---:|---:|---:|---:|---|---|
| 1 | AP Calculus Unit 2 (`7qNE_B0r4z4`) | 5 MC | 65.625 s | 113.742 s | 210.287 s | 4* | 0 | 2: Retry + Continue | 5/5, 100% |
| 2 | Just How Small is an Atom? (`yQP4UJhNn0I`) | 5 MC/TF | 13.277 s | 32.691 s | 101.385 s | 3 | 0 | 0 | 5/5, 100% |
| 3 | Nervous System (`x4PPZCLnVkA`) | 10 TF | 15.670 s | 69.136 s | 117.223 s | 4 | 0 | 0 | 10/10, 100% |
| 4 | Periodic Table (`0RRVV4Diomg`) | 5 MC | 41.469 s | 66.722 s | 104.767 s | 3 | 0 | 0 | 5/5, 100% |
| 5 | Agricultural Revolution (`Yocja_N5s1I`) | 10 MC/TF | 42.689 s | 78.232 s | 127.261 s | 4 | 0 | 1: Retry | 10/10, 100% |
| 6 | Neural Networks (`aircAruvnKk`) | 10 MC | 19.700 s | 103.986 s | 157.118 s | 4 | 0 | 0 | 10/10, 100% |
| 7 | Map of Mathematics (`OmJ-4B-mS-Y`) | 10 MC/TF | 16.039 s | 53.229 s | 116.157 s | 4 | 0 | 0 | 10/10, 100% |
| 8 | Einstein/Oppenheimer/Feynman lecture (`PbITFIGLciI`) | 15 TF | 33.820 s** | 84.276 s | 159.684 s | 6 | 0 | 0 | 15/15, 100% |
| 9 | Superposition lecture (`lZ3bPUKo5zc`) | 15 TF | 19.365 s | 98.015 s | 168.063 s | 6 | 0 | 0 | 15/15, 100% |
| 10 | CRISPR (`6tw_JVz_IEc`) | 15 MC/TF | 14.604 s | 116.365 s | 182.552 s | 6 | 0 | 0 | 15/15, 100% |

\* Run 1 also had one malformed q1 model response before a quiz ID existed. That request is not present in the server call-event table. The four stored events are three primary events plus one `manual_continuation`.  
\** Run 8 exposed a partially rendered quiz at 18.703 s: “Check answer” and one True control existed before the prompt and False control. The accepted q1 was stored at 19.853 s; the complete prompt and both controls were conservatively confirmed by 33.820 s.

Video lengths: 12:26, 5:28, 12:04, 11:21, 11:10, 18:40, 11:06, 30:36, 1:16:06, and 5:29 respectively.

## Aggregate results

| Metric | Result |
|---|---:|
| Final quizzes completed | 10/10 |
| Planned questions completed | 100/100 |
| Passed full banks | 10/10 |
| Incomplete banks scored | 0 |
| Zero-intervention runs | 8/10 |
| Question 1 under 20 seconds | 6/10 |
| Stored call events | 44 |
| Stored automatic-retry events | 0 |
| Stored manual-continuation events | 1 |
| Pre-quiz Retry clicks | 2 |
| Total learner recovery actions | 3 |

### Timing distribution

| Metric | Minimum | Median | Mean | Maximum / sample p95 |
|---|---:|---:|---:|---:|
| Question 1 interactive | 13.277 s | 19.533 s | 28.226 s | 65.625 s |
| Full bank ready | 32.691 s | 81.254 s | 81.639 s | 116.365 s |
| Create to completed result | 101.385 s | 142.190 s | 144.450 s | 210.287 s |

The q1 aggregate uses Run 8's conservative 33.820-second bound. With only ten observations, the nearest-rank p95 equals the maximum.

## Retry and call accounting

- Final-bank call events contain 43 `primary` requests, zero `automatic_retry` requests, and one `manual_continuation` request.
- Run 1 first failed before quiz creation because q1 did not have four unique choices. The page required **Retry**. This model request was not uploadable because no quiz ID existed, so authoritative server telemetry undercounts it.
- Run 1 later paused at 4/5 with `answer_mapping_invalid`. The page explicitly said no automatic request was sent and required **Continue generating**. The continuation then stored q5.
- Run 5 failed source setup with `The speech model manifest is not available yet` even though the create page had reported complete source captions. It required **Retry** but did not produce a quiz call event before recovery.
- Therefore “zero automatic retries” is technically true for the legacy server classifications, but **zero intervention is false**. Two of ten sessions needed three learner recovery actions in total.

## Problems found

### 1. The intended v5.4 automatic profile is not live

Every bank is v5.1/protocol 5. The production Worker rollout is disabled and D1 stops at migration 0017. This test does not validate extension 0.8.4, protocol 8, question-stream-v4, singleton calls, evidence-grounded generation, or the new automatic-recovery state machine.

### 2. Manual continuation still exists in production

Run 1 showed both a page-level **Retry** and a mid-quiz **Continue generating** action. This directly contradicts the requested automatic-only learner flow.

### 3. Pre-import failures are missing from authoritative telemetry

Run 1's invalid q1 request happened before the first progressive import created a quiz ID, so the server reports only 44 events although an additional malformed model call visibly occurred. Call totals cannot be exactly reconciled across the full create journey.

### 4. Source readiness is not trustworthy

Run 5 reported complete captions on the create page, then entered a speech-model download path and failed because its model manifest was unavailable. Source setup and generation readiness are still racing or using inconsistent state.

### 5. First-question ETA and latency remain unstable

Question 1 ranged from 13.277 to 65.625 seconds. Run 4's countdown expired into “taking longer than usual”; its q1 DeepSeek event alone took 24.174 seconds. Run 6 later needed 103.986 seconds to finish a 10-question bank despite a 19.700-second q1.

### 6. Long-video content focus remains poor

- Run 5 q1 tests John Green's opening “lifelong exam” framing instead of the Agricultural Revolution.
- Run 8 uses 13 of 15 questions for instructor biography, course dates, readings, papers, requirements, communication, or the course roadmap instead of physics.
- Run 9 q1 tests the teaching assistant and q4 tests textbook-sharing logistics.

### 7. Interactive readiness can be signaled before rendering finishes

Run 8 briefly exposed “Check answer” and only one True/False control before the prompt and second control rendered. Readiness detection and route activation should be atomic from the learner's perspective.

### 8. Question-type controls still lack checked semantics

The live `role="checkbox"` controls changed visual border state correctly, but had no `aria-checked` value. Browser automation had to verify selection through computed visual styles, and assistive technology still lacks an authoritative selected state.

### 9. Legacy summary telemetry is not authoritative

The v5.1 quality summaries set `telemetryAvailable: false` and retain zero token totals while the call-event table contains the real per-call elapsed/usage evidence. Admin and QA should derive current metrics from call events.

## What worked

- Question 1 became available before the full bank in every successfully created attempt.
- Stored availability advanced in order and each bank became `passed` only at its planned 5/10/15 count.
- No partial bank completed or scored.
- All 100 UI submissions mapped to the canonical server answer and every attempt reached the normal completion screen at 100%.
- Displayed MC option order differed from canonical storage order, confirming view-time choice randomization and canonical-index translation.
- The prior nervous-system q10 terminal-duplicate failure and CRISPR q14 duplicate retry did not reproduce in these two specific generations.

## Release conclusion

**The official production journey can complete ten quizzes, but the requested zero-intervention automatic profile did not work because it is not deployed or enabled.** The current live result is 8/10 zero-intervention sessions, with a manual Retry/Continue path, missing pre-import telemetry, unstable q1 latency, source-readiness failure, and serious long-video content-focus defects.

No code was changed, committed, pushed, migrated, or deployed as part of this live QA run. Existing screenshots and prior QA artifacts were preserved.
