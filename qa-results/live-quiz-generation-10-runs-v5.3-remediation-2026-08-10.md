# ClipQuest v5.3 progressive-generation live Chrome QA

> Historical local hot-reload evidence. This matrix spans multiple working-tree revisions, did not affect production, and predates extension 0.8.5 and the current production artifact. Use the [current production report](./live-production-quiz-generation-10-runs-extension-0.8.5-2026-08-11.md) for release decisions; retain this report only as diagnostic history.

Date: 2026-08-10  
Status: **10/10 videos ultimately completed; zero-intervention release gate failed**  
Environment: local ClipQuest app/API and D1, real Google Chrome, unpacked ClipQuest Local AI 0.8.3, real YouTube captions, and real DeepSeek requests  
Production impact: none; this run did not push or deploy anything

## Executive result

- Completed all 100 planned questions across ten different videos: 5 + 5 + 10 + 5 + 10 + 10 + 10 + 15 + 15 + 15.
- Every final attempt reached the normal completed state with its full planned item count. No partial bank was scored.
- Final attempts used 113 recorded DeepSeek calls, including 13 automatic retries.
- Only 5/10 final attempts completed with zero automatic retries.
- Only 8/10 videos completed in their initial generation session. Two videos required replacement attempts after terminal failures, so the observed initial-session zero-intervention rate was 80%.
- Median observed time to an interactive first question was approximately 4.55 seconds. The mean was 32.60 seconds because the CRISPR run took 270.57 seconds to produce question 1 after four transport retries.
- Median full-bank generation time was approximately 21.84 seconds. The mean was 50.97 seconds because of the same CRISPR outlier.
- All final attempts scored 100%; correct responses were deliberately selected to exercise every question and the completion path, so this is a completion/integration check rather than a learner-accuracy study.

This is a diagnostic matrix, not a release benchmark against one immutable artifact. The extension was hot-reloaded with fixes during the matrix after real failures were found. A clean release decision requires rerunning the full matrix from a fresh database against one exact SHA and ZIP.

## Final completed attempts

| Run | Video | Length / requested types | First question interactive | Full bank ready | Start to completed quiz | Calls | Automatic retries | Result |
|---:|---|---|---:|---:|---:|---:|---:|---|
| 1 | AP Calculus AB/BC Unit 2 FULL REVIEW (`7qNE_B0r4z4`) | 5 / MC | 4.10 s | 11.53 s | 79.12 s | 6 | 1, q5 duplicate repair | 5/5, 100% |
| 2 | Just How Small is an Atom? (`yQP4UJhNn0I`) | 5 / MC + TF | 3.15 s | 9.76 s | 60.21 s | 6 | 1, q4 answer repair | 5/5, 100% |
| 3 | The Nervous System - CrashCourse Biology #26 (`x4PPZCLnVkA`) | 10 / TF | 3.10 s | 20.75 s | 41.62 s | 11 | 1, q10 duplicate repair | 10/10, 100% |
| 4 | The Periodic Table: Crash Course Chemistry #4 (`0RRVV4Diomg`) | 5 / MC | 8.43 s partial reveal* | 16.39 s | 21.94 s | 5 | 0 | 5/5, 100% |
| 5 | The Agricultural Revolution: Crash Course World History #1 (`Yocja_N5s1I`) | 10 / MC + TF | 18.44 s fully revealed* | 24.71 s | 54.59 s | 10 | 0 | 10/10, 100% |
| 6 | But what is a neural network? (`aircAruvnKk`) | 10 / MC | 5.19 s | 22.84 s | 33.81 s | 10 | 0 | 10/10, 100% |
| 7 | The Map of Mathematics (`OmJ-4B-mS-Y`) | 10 / MC + TF | 5.01 s | 20.84 s | 31.84 s | 10 | 0 | 10/10, 100% |
| 8 | Lecture 1: Einstein, Oppenheimer, Feynman (`PbITFIGLciI`) | 15 / TF | 3.95 s | 31.43 s | 57.70 s | 15 | 0 | 15/15, 100% |
| 9 | Lecture 1: Introduction to Superposition (`lZ3bPUKo5zc`) | 15 / TF | 4.05 s | 37.81 s | 61.39 s | 17 | 2, q2 and q13 duplicate repair | 15/15, 100% |
| 10 | How CRISPR lets you edit DNA (`6tw_JVz_IEc`) | 15 / MC + TF | 270.57 s | 313.71 s | 330.19 s | 23 | 8: q1 transport x4, q13 duplicate x2, q15 duplicate x2 | 15/15, 100% |

\* Run 4 exposed the progress shell and one choice before the prompt and all choices were interactive, so 8.43 seconds is not a valid full-interactivity measurement. Run 5's 18.44-second observation includes the UI's staged reveal animation. The observer was tightened for subsequent runs to require the complete prompt and every expected choice.

The “start to completed quiz” column includes deliberate browser inspection and answer-selection time. It is evidence that the attempt completed, not a pure generation-performance metric.

## Failed precursor attempts retained as evidence

| Run | Attempt | Frontier | Recorded calls | Automatic retries | Terminal reason |
|---:|---|---:|---:|---:|---|
| 3A | `6e5db26f-9c33-49ad-afa3-93d743d7e098` | 6/10 | 12 | 5 | `answer_mapping_invalid` |
| 3B | `e306a54f-405e-4624-9d54-23592487f30e` | 8/10 | 15 | 6 | `duplicate_question` |
| 10A | `13ec0d81-6cb1-4737-90f8-85d172f93897` | 11/15 | 15 | 3 | `duplicate_question` |
| 10B | `ee3f5545-e4be-4109-959d-6baa8ade69bd` | 2/15 | 2 recorded | 0 recorded | `local_state_conflict` after a request remained in flight |

Run 10B exposed a telemetry reconciliation failure: Chrome had started a third DeepSeek request, but no terminal call event existed when the tab was reloaded. A recorded call count therefore did not exactly match actual HTTP requests.

## Defects found

### Release blockers

1. **Zero intervention is not achieved.** Two of ten initial video sessions terminally failed and needed a new attempt. A `generation_failed` bank did not automatically reclaim and finish after reload.
2. **Retry frequency remains high.** Only half of the final banks were retry-free. Duplicate repair caused eight of the thirteen final-attempt retries, and the CRISPR first question consumed four transport retries.
3. **First-question retry latency and ETA are unacceptable.** The CRISPR q1 sequence was approximately 60.00 s timeout + 0.75 s delay, 59.98 s + 1.25 s, 60.00 s + 3.68 s, 60.00 s + 4.64 s, then 20.19 s to success: approximately 270.57 seconds total. The UI's retry ETA was far below the actual one-minute request timeout.
4. **Telemetry aggregates are internally inconsistent.** Every final bank reports `telemetryAvailable: true` but its quality summary stores `aiCalls: 0`, `retryCount: 0`, and zero token totals. The authoritative call-event table holds the real 113 calls and 13 retries.
5. **A started HTTP request can disappear from telemetry.** Run 10B recorded two completed calls while a third request was visibly in flight. Reloading moved the bank to a terminal local-state failure without a terminal event for that request.
6. **The first-question UI can look ready before it is usable.** Run 4 showed progress and one choice before the heading and remaining choices appeared. “Route entered” and “question stored” must not be used as the learner-visible latency metric.

### Correctness and quality defects

7. **The original hard True/False polarity contract could manufacture contradictions.** Before the local fix, the atom run accepted near-duplicate statements with opposing stored answers, and the first nervous-system attempt repeatedly failed answer mapping.
8. **The first polarity fix harmed diversity.** The successful nervous-system replacement produced ten true answers. Later runs used a preferred rather than forced polarity and recovered a more balanced mix, but the final behavior still needs a clean one-build rerun.
9. **Duplicate detection still exhausts recovery budgets.** The nervous-system, superposition, and CRISPR runs all required duplicate repairs; two precursor banks terminally failed on duplicates.
10. **Long-video focus can favor course administration over learning content.** The physics and superposition lectures generated early questions about course dates, prerequisites, tenure, or the course website. Transcript focus selection needs semantic filtering of introductions and logistics.

## Local fixes made during this QA

- Changed True/False generation from a forced hidden answer to a preferred diversity target, while retaining strict validation of the model's actual statement/answer/correction.
- Added deterministic per-slot transcript focus excerpts and stronger used-concept exclusions to reduce near-duplicate questions.
- Reduced automatic singleton request timeout from 15 minutes to 60 seconds; legacy continuation keeps its existing timeout.
- Updated the stable-generator test harness for the new preferred-polarity prompt shape.

These fixes are local working-tree changes. They were not pushed or deployed. Because they were introduced during the matrix, the matrix spans multiple local 0.8.3 hot-reload revisions.

## Verification after the final local fix

- Full extension suite: 48/48 tests passed.
- Extension build: passed.
- Final ZIP: `apps/extension/dist/clipquest-captions-extension.zip`
- SHA-256: `3afe3f7517d51e17dc706d973833cda0e55fbe261006be903a36203237115a7b`
- `git diff --check`: passed.

## Release decision

**Do not release this build yet.** It ultimately completed all ten videos, but it did not meet the requested 100% eligible zero-intervention target, the 99% first-pass objective, zero-retry healthy-path objective, or exact telemetry reconciliation requirement.

Before release, fix the five release-blocking areas above and repeat all ten videos from a fresh local database against one immutable commit and one extension ZIP. Only that clean rerun can establish a meaningful completion, retry, latency, and quality rate.
