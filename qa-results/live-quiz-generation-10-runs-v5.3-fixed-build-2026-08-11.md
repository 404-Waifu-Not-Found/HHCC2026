# ClipQuest v5.3 fixed-build ten-video Chrome QA rerun

> Historical local-only evidence. This report did not exercise production and predates extension 0.8.5, prompt v5.5, validator v4.4, and remote migration 0019. Use the [current production report](./live-production-quiz-generation-10-runs-extension-0.8.5-2026-08-11.md) for the latest official-site result; retain the measurements below for regression comparison.

Date: 2026-08-11  
Status: **10/10 final quizzes completed; release gate still failed**  
Environment: local ClipQuest app/API/D1, real Google Chrome, real YouTube sources/captions, real DeepSeek requests, and the unpacked ClipQuest Local AI extension 0.8.3  
Production impact: none; nothing was pushed or deployed

## Exact test artifact

- Git HEAD: `9944ef2a760f79459fe452639d2096dcb9900bac`
- Extension working-tree patch SHA-256: `d4b1bb616b9d45191bda7ddcda7c5d09ddb52f558e144f1e792784d066090104`
- Extension ZIP SHA-256: `3afe3f7517d51e17dc706d973833cda0e55fbe261006be903a36203237115a7b`
- Extension version: `0.8.3`
- Prompt / validator / protocol: `quiz-local-json-stream-v5.3` / `validator-local-progressive-v4.2` / protocol 7
- Pipeline / import profile: pipeline 9 / `extension-progressive-import-v5` / `stable_auto_recovery_v5_3`
- Pre-run extension suite: 48/48 tests passed

The extension was built and reloaded once before the matrix. No source or extension changes were made during the ten intended runs.

The timing clock starts at the learner's **Generate quiz** action after the create screen reports captions ready. It excludes link import and caption resolution. These sources were also used in the previous day's QA, so the extension's 24-hour local transcript cache may have reduced source-setup time; this report measures quiz generation, not cold caption acquisition.

## Executive result

- All ten final attempts completed all 100 planned questions: 5 + 5 + 10 + 5 + 10 + 10 + 10 + 15 + 15 + 15.
- Every final bank reached `quality_status = passed`; no incomplete bank was scored.
- Every final attempt completed with a stored score of 100%, because the server-defined correct response was deliberately selected to exercise the complete learner path.
- Final attempts used 103 recorded DeepSeek calls and three automatic retries.
- Seven of ten final attempts were retry-free.
- Nine of ten intended initial generation sessions completed without replacing the attempt. The nervous-system run stopped at 9/10 and required a replacement attempt.
- Median interactive-question-1 latency was 3.080 seconds; p95 and maximum were 3.629 seconds.
- Median full-bank generation time was 21.850 seconds; p95 and maximum were 35.926 seconds.
- The retry-free and latency results improved substantially from the previous day's diagnostic matrix, but answer correctness and semantic diversity remain release blockers.

## Final completed attempts

| Run | Video | Video length | Quiz | Question 1 interactive | Full bank ready | Generate to completion* | Calls | Automatic retries | Result |
|---:|---|---:|---|---:|---:|---:|---:|---|---|
| 1 | AP Calculus Unit 2 (`7qNE_B0r4z4`) | 12:26 | 5 MC | 3.085 s | 12.700 s | 297.385 s** | 6 | 1: q5 answer repair | 5/5, 100% |
| 2 | Just How Small is an Atom? (`yQP4UJhNn0I`) | 5:28 | 5 MC/TF | 3.088 s | 10.589 s | 42.248 s | 5 | 0 | 5/5, 100% |
| 3 | Nervous System (`x4PPZCLnVkA`) | 12:04 | 10 TF | 3.079 s | 22.377 s | 49.653 s | 11 | 1: q3 duplicate repair | 10/10, 100% |
| 4 | Periodic Table (`0RRVV4Diomg`) | 11:21 | 5 MC | 3.629 s | 13.097 s | 34.660 s | 5 | 0 | 5/5, 100% |
| 5 | Agricultural Revolution (`Yocja_N5s1I`) | 11:10 | 10 MC/TF | 3.084 s | 21.323 s | 62.036 s | 10 | 0 | 10/10, 100% |
| 6 | Neural Networks (`aircAruvnKk`) | 18:40 | 10 MC | 3.071 s | 25.611 s | 56.004 s | 10 | 0 | 10/10, 100% |
| 7 | Map of Mathematics (`OmJ-4B-mS-Y`) | 11:06 | 10 MC/TF | 3.081 s | 17.984 s | 44.009 s | 10 | 0 | 10/10, 100% |
| 8 | Einstein/Oppenheimer/Feynman lecture (`PbITFIGLciI`) | 30:36 | 15 TF | 3.066 s | 31.749 s | 61.573 s | 15 | 0 | 15/15, 100% |
| 9 | Superposition lecture (`lZ3bPUKo5zc`) | 1:16:06 | 15 TF | 3.079 s | 35.926 s | 75.923 s | 15 | 0 | 15/15, 100% |
| 10 | CRISPR (`6tw_JVz_IEc`) | 5:29 | 15 MC/TF | 3.078 s | 30.712 s | 68.119 s | 16 | 1: q14 duplicate repair | 15/15, 100% |

\* Generate-to-completion includes browser inspection and deliberate answer selection. It proves the learner flow completed, but it is not a pure generation-performance metric.  
\** Run 1 includes a QA-control reconnection after a long observer poll; its full-bank time remains authoritative, but its end-to-end completion duration is not comparable with the other rows.

### Aggregate timing

| Metric | Minimum | Median | Mean | p95 / maximum |
|---|---:|---:|---:|---:|
| Interactive question 1 | 3.066 s | 3.080 s | 3.134 s | 3.629 s |
| Full bank ready | 10.589 s | 21.850 s | 22.207 s | 35.926 s |

The question-1 measurement required a visible prompt plus every expected answer control. It did not treat route navigation, progress text, or a partially rendered choice list as interactive readiness.

## Failed and excluded precursor attempts

| Classification | Attempt | Frontier | Calls | Automatic retries | Terminal reason | Treatment |
|---|---|---:|---:|---:|---|---|
| Excluded setup preflight | `2e549cf3-8324-45d9-a17b-7c55d0ebf65a` | 1/5 | 4 | 2 | `schema_invalid` on a short-answer slot | Excluded from the intended matrix because the custom type chips did not expose/toggle state correctly through semantic browser control, leaving the prior TF/short-answer selection active. |
| Run 3 initial session | `71164d99-16ec-4ad5-aef9-ea695ff359e9` | 9/10 | 12 | 2 | `duplicate_question` | Counted as a zero-intervention failure. The accepted nine questions were preserved and never scored; a replacement attempt was required. |

The Run 3 initial attempt generated q1 in 3.082 seconds, reached 9/10, then its q10 primary call and both allowed duplicate repairs failed. The new automatic-only flow had no way to reclaim and complete that bank.

## Correctness and quality findings

### 1. Definitive True/False answer inversion

Run 5 stored the following statement as false:

> Elephants are unsuitable for domestication because they take too long to breed, as they are pregnant for 22 months and have only one offspring at a time.

The generated explanation repeats those facts as the reason elephants are unsuitable. The prompt and explanation therefore support **true**, while `correct_answer_json` is `false`. The learner can receive a displayed 100% score only by choosing the factually wrong response.

This proves that changing seeded polarity from “forced” to “preferred” avoided one earlier failure mode but did not provide deterministic semantic agreement between statement, explanation, and answer.

### 2. Multiple-choice ambiguity remains

Run 1 includes at least two questions with more than one defensible correct option:

- Average rate of change is represented both by “the slope of the secant line” and by “the difference in y-values divided by the difference in x-values.” Only one was marked correct.
- The derivative answer `9x^2 - 8x + 7` is mathematically identical to the distractor `9x^2 - 8x + 7 + 0`.

Exact normalized-string uniqueness is therefore insufficient. Distractors need mathematical and semantic equivalence rejection.

### 3. Semantic duplicates bypass the duplicate detector

The completed CRISPR bank passed validation despite heavy concept repetition:

- Three questions ask that CRISPR originated as a bacterial immune system.
- Three questions ask how guide RNA directs Cas9 to a target gene.
- Four questions ask about template DNA and homology-directed repair.

Ten of fifteen questions are concentrated into those three closely repeated concepts. One q14 duplicate repair occurred, but the final bank still passed with substantial semantic duplication.

### 4. Long-video focus still overweights course administration

- The Einstein/Oppenheimer/Feynman bank begins with instructor teaching history, course time span, starting geography, prerequisites, readings, communication format, essays, and course roadmap before reaching physics concepts.
- The Superposition bank begins with where complaints should be sent and how students should share textbooks.
- The Agricultural Revolution bank begins with the presenter describing the course's life-long “test.”

Per-slot transcript excerpts improved local topic spread but do not filter introductions, logistics, syllabus material, or presenter housekeeping.

## Stability and telemetry findings

1. **Zero intervention is still not achieved.** Intended initial-session completion was 9/10, not 10/10 or the requested 100%.
2. **First-pass retry-free completion was 7/10.** The three final retries were one answer repair and two duplicate repairs.
3. **The previous transport-timeout outlier did not repeat.** CRISPR q1 improved from the previous diagnostic run's 270.57 seconds to 3.078 seconds, with no transport retry.
4. **Availability advanced monotonically.** Every completed bank grew in ordinal order and became `passed` only at its planned 5/10/15 count.
5. **No incomplete bank scored.** The failed 9/10 nervous-system bank remained active and unscoreable.
6. **Choice display shuffling worked.** Displayed option order differed from canonical stored order while the submitted canonical mapping graded correctly.
7. **Quality-summary telemetry is still wrong.** Every final bank reports `telemetryAvailable: true` while storing `aiCalls: 0`, `retryCount: 0`, `inputTokens: 0`, and `outputTokens: 0`. The authoritative call-event table contains the real 103 calls, three retries, and token totals.
8. **Question-type controls are not accessibility-authoritative.** The `role="checkbox"` elements do not expose `aria-checked`; semantic `click()` only focused them in this Chrome integration, while a physical pointer click changed the visual border and selection. This caused the excluded preflight configuration mismatch and makes automated/assistive verification unreliable.

## Comparison with the 2026-08-10 diagnostic matrix

| Metric | Previous diagnostic | Fixed-build rerun |
|---|---:|---:|
| Final questions completed | 100/100 | 100/100 |
| Intended initial sessions completed without replacement | 8/10 | 9/10 |
| Retry-free final banks | 5/10 | 7/10 |
| Final-attempt calls | 113 | 103 |
| Final-attempt automatic retries | 13 | 3 |
| Median question-1 latency | about 4.55 s | 3.080 s |
| Worst question-1 latency | 270.57 s | 3.629 s |
| Median full-bank latency | about 21.84 s | 21.850 s |

The timeout and first-question improvements are real in this sample. They do not compensate for the factual answer inversion, ambiguous multiple-choice distractors, semantic duplicates, or unrecoverable 9/10 bank.

## Release decision

**Do not release this build yet.** The exact artifact completed all ten final quizzes and substantially improved latency/retry behavior, but it still fails the core correctness and zero-intervention requirements.

Release should remain blocked until:

1. True/False statement, answer, correction, and explanation agreement is deterministically checked.
2. Mathematical and semantic distractor equivalence is rejected before persistence.
3. Duplicate protection operates on concepts/claims, not only prompt similarity.
4. Transcript focus excludes introductions, syllabi, logistics, sponsor copy, and presenter housekeeping.
5. A terminal duplicate/content failure can automatically reclaim and finish the existing bank without a replacement attempt.
6. Quality-summary telemetry is derived from the authoritative call-event table.
7. Custom checkbox/radio controls expose authoritative checked state to accessibility and browser automation.

No production deployment, remote migration, commit, or push was performed during this rerun.
