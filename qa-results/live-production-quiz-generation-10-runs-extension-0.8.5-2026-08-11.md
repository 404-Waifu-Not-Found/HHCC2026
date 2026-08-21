# ClipQuest production quiz-generation QA — extension 0.8.5

> Current official-site generation evidence as of 2026-08-11. Pair this report with the [README release status](../README.md#release-status), [documentation index](../docs/README.md), and [production release guide](../docs/PRODUCTION-RELEASE.md). Reverify live state after any deployment, rollout change, or extension rebuild.

Date: 2026-08-11 (Asia/Shanghai)

Site: `https://clipquest.ccwu.cc`

Account: `unoxyrich`

Chrome extension observed: `ClipQuest 0.8.5`

Worker version: `a8d8cda5-ea66-4e87-afae-388b2cf237dd`
Worker tag / Git SHA: `9c1bc3b75929819cc18f1a7bb4a50b7cd954dc03`

## Result

- Ten different educational YouTube videos produced ten completed production quiz banks.
- All 100 planned questions were answered through the learner UI.
- D1 confirms 100/100 correct answers, ten `complete` attempts, ten `passed` banks, and a 100% score for every completed attempt.
- The ten completed banks used 53 planned DeepSeek calls, 0 `automatic_retry` events, 0 `manual_continuation` events, and 0 non-complete call outcomes.
- One separate first attempt for Run 8 failed at 11/15 after a schema-invalid output and a failed automatic recovery. It was excluded from the completed matrix and the same video was restarted from zero. Therefore first-attempt bank completion was 9/10, not 10/10.

## Completed runs

Times are measured from clicking **Create my quiz**. “Q1” is the time until question 1 was visibly interactive. “Ready” is the time until the authoritative stored-count indicator reached completion and disappeared stably. Model calls and retry classifications come from `quiz_generation_call_events`.

| Run | Video                                          | Length / types |    ETA | Q1 visible | Full bank ready | Model calls | Auto retries | Manual continuations | Result      |
| --: | ---------------------------------------------- | -------------- | -----: | ---------: | --------------: | ----------: | -----------: | -------------------: | ----------- |
|   1 | CRISPR gene editing (`6tw_JVz_IEc`)            | 5 · MC/TF/SA   | 15.0 s |   25.655 s |        57.993 s |           3 |            0 |                    0 | 5/5, 100%   |
|   2 | Periodic Table (`0RRVV4Diomg`)                 | 5 · MC/SA      | 15.0 s |   15.737 s |        62.617 s |           3 |            0 |                    0 | 5/5, 100%   |
|   3 | AP Calculus derivatives (`7qNE_B0r4z4`)        | 5 · MC/TF      | 15.0 s |   14.073 s |        30.554 s |           3 |            0 |                    0 | 5/5, 100%   |
|   4 | Nervous System (`x4PPZCLnVkA`)                 | 10 · TF/SA     | 15.0 s |    8.990 s |       103.692 s |           6 |            0 |                    0 | 10/10, 100% |
|   5 | Agricultural Revolution (`Yocja_N5s1I`)        | 10 · MC/TF     | 15.0 s |   10.561 s |        73.217 s |           4 |            0 |                    0 | 10/10, 100% |
|   6 | Neural Networks (`aircAruvnKk`)                | 10 · MC/SA     | 20.0 s |    7.969 s |        79.754 s |           6 |            0 |                    0 | 10/10, 100% |
|   7 | Map of Mathematics (`OmJ-4B-mS-Y`)             | 10 · MC/TF/SA  | 15.0 s |    9.429 s |        91.034 s |           6 |            0 |                    0 | 10/10, 100% |
|   8 | Einstein, Oppenheimer, Feynman (`PbITFIGLciI`) | 15 · MC/TF/SA  | 20.0 s |   12.229 s |       132.386 s |           8 |            0 |                    0 | 15/15, 100% |
|   9 | Quantum Superposition (`lZ3bPUKo5zc`)          | 15 · MC/TF     | 20.0 s |    7.702 s |       106.042 s |           6 |            0 |                    0 | 15/15, 100% |
|  10 | The Nucleus (`FSyAehMdpyI`)                    | 15 · MC/TF/SA  | 20.0 s |   12.264 s |       124.790 s |           8 |            0 |                    0 | 15/15, 100% |

Attempt IDs:

1. `fe2980f9-2702-4177-a638-f88316d0c535`
2. `2bbd086b-4329-4a56-b567-a4e8a28e05cd`
3. `25b428b1-fcfa-4184-a577-e5b11afb6dcc`
4. `dc192292-9131-4d80-8d95-accc8972aa12`
5. `ceac402d-b65c-481f-8a0a-dad4ff5428da`
6. `a55ffc43-20aa-42ef-a01e-488e42d7800a`
7. `7f5c0e10-4df5-49f8-9e93-7a8ca313baf4`
8. `a1087383-7d42-4dab-99c3-3b80b4056041`
9. `e8b16618-0534-4061-bbe8-223f553dd068`
10. `3b914ab1-c90b-4b77-92e0-d9237a4bd981`

## Timing and usage summary

- First-question latency: minimum 7.702 s; median 11.395 s; mean 12.461 s; observed p95/max 25.655 s.
- Full-bank latency: minimum 30.554 s; median 85.394 s; mean 86.208 s; observed p95/max 132.386 s.
- ETA mean absolute error: 6.818 s; median absolute error: 6.873 s.
- 7/10 runs were within 10 seconds of the displayed first-question ETA.
- The ETA was conservative in 8/10 completed runs. The cold first run was 10.655 seconds late; Run 2 was 0.737 seconds late.
- Completed-bank model time: 808.731 s across 53 planned calls.
- Completed-bank usage: 371,541 input tokens; 106,014 output tokens; 88,831 reasoning tokens.

## Excluded failed attempt

The first Run 8 attempt (`45a4b951-3811-47d2-904c-266153a5d261`) became interactive in 9.113 seconds and stored 11/15 questions. Its seventh primary call requested q12–q13 and returned `schema_invalid` with zero accepted questions. The UI then showed `Recovering legacy generation automatically · 11/15 ready` without a learner click.

That recovery made one additional DeepSeek request in a new generation session, failed with `schema_invalid`, and ended at `generation_failed`. D1 classified the automatic UI recovery as `manual_continuation`, even though the learner never clicked a continuation control. The bank correctly remained unscoreable and excluded from normal completion. The video was then started again as a fresh all-type quiz and completed as the counted Run 8.

## Problems found

### 1. Production is still generating with the legacy profile

The live `/health` response advertises current prompt `quiz-local-json-stream-v5.5` and profile `evidence_grounded_auto_v5_4`, but also reports `rolloutMode: disabled`. Every one of the ten completed banks persisted:

- Prompt: `quiz-local-json-stream-v5.1`
- Generation profile: `legacy_reasoning_v5_1`

This means extension 0.8.5 is installed, but the intended grounded/automatic profile is not active for the tested account.

### 2. The banned lesson/transcript framing is still widespread

Across the 100 completed questions:

- 26 prompts contain the exact phrase `According to the lesson`.
- 79 prompts contain `According to` somewhere.
- 12 prompts contain `transcript`.

Examples include `According to the lesson, ...`, `According to the transcript, ...`, and many speaker-attribution variants. The requested content-quality change is therefore not active in production because the tested banks use v5.1.

### 3. The display-time prefix remover corrupts some questions

The learner UI did remove some framing text, but at least five rendered prompts were visibly damaged instead of cleanly rewritten. Observed examples included:

- `In the lesson's polynomial example...` becoming `'S polynomial example...`
- `In the video's matrix-based representation...` becoming `'S matrix-based representation...`
- `Based on the lecturer's account...` becoming `R's account...`
- `According to the lecturer...` becoming `R, ...`

Stored prompts remain intact; this is a display transformation bug.

### 4. Automatic recovery telemetry is dishonest for the legacy path

The failed Run 8 recovery was started automatically with zero learner clicks, yet its new call event was classified as `manual_continuation`. This makes the user-visible automatic recovery and server telemetry disagree. It also means a dashboard can report a manual continuation that never occurred.

### 5. Zero-intervention completion is below target

- Completed-after-restart result: 10/10 videos and 100/100 questions.
- First-attempt completion: 9/10 videos (90%).
- Controlled zero-intervention target: not met.
- Completed-bank retry rate: 0/53 calls.
- Overall QA journey: one automatic recovery request, mislabeled as a manual continuation, followed by terminal failure and a fresh quiz restart.

## Privacy and methodology

- DeepSeek calls, captions, and the API key remained extension-local.
- The report records only safe IDs, timings, counts, outcomes, and aggregate token usage.
- No API key, transcript body, prompt body, or raw DeepSeek response body was copied into this report.
- Questions were completed through the visible production learner UI. Authoritative answer and call-event records were read from production D1 solely to finish and verify the QA attempts.
- No code was changed, committed, pushed, or deployed during this QA run.

## Release decision

Keep `QUIZ_V5_4_ROLLOUT` disabled. The next acceptance run must use one immutable enabled-profile artifact, complete all planned questions on the original attempt, record automatic calls honestly, and contain neither banned source framing nor display-time prompt corruption.
