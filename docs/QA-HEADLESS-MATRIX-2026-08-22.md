# Headless production quiz matrix — re-run 2026-08-22

> Live re-run of the ten-video production matrix using the headless QA harness
> (`npm run qa:quiz`) against real public YouTube captions and the real DeepSeek API with a
> local key. This supersedes the earlier extension-0.8.5 matrix summarized in the
> [README release status](../README.md#release-status).

## Scope

- Harness: `packages/headless-quiz` CLI, `--count 10 --types all --answer-and-grade`
- Source boundary: complete public browser caption text only; no audio download or transcription
- Credential: local `DEEPSEEK_API_KEY` from the untracked `.env`; never transmitted to ClipQuest
- Videos: the same ten public AP-course lessons used by the previous matrix

## Pipeline actually exercised

| Field           | Value                                      |
| --------------- | ------------------------------------------ |
| Result protocol | `10`                                       |
| Pipeline        | `9`                                        |
| Model           | `deepseek-v4-flash`, reasoning effort none |
| Prompt          | `quiz-local-json-stream-v5.12`             |
| Validator       | `validator-minimal-gradeability-v5.3`      |
| Import          | `extension-progressive-import-v8`          |
| Profile         | `prompt_first_auto_v5_12`                  |

This run therefore exercises the prompt-first v5.12 profile that the previous matrix could not
reach, because rollout variables were disabled during that run.

## Results

### Completion

| Metric                                    | Result                                |
| ----------------------------------------- | ------------------------------------- |
| Videos attempted                          | 10                                    |
| Reached question 1 (progressive entry)    | **10 / 10**                           |
| Complete 10-question banks, first attempt | 5 / 10                                |
| Complete banks after one re-attempt       | **8 / 10**                            |
| Videos failing both attempts              | 2 / 10 (`qP-9wwRrJbg`, `G8zkXA5TXgg`) |
| Questions stored across complete banks    | 80                                    |
| Model calls                               | 80                                    |
| Automatic bounded retries                 | 13                                    |
| Fallback or invented questions emitted    | **0**                                 |

### Time to question 1 (first pass, all ten videos)

| Metric | Seconds |
| ------ | ------: |
| Min    |     5.9 |
| Median |    19.9 |
| Mean   |    22.0 |
| Max    |    41.8 |

### Content quality audit (80 stored questions)

| Audit                       | Result                      |
| --------------------------- | --------------------------- |
| `production_validator`      | 80 PASS                     |
| `exact_duplicate`           | 80 PASS (80 unique prompts) |
| `fragmentary_prompt`        | 80 PASS                     |
| `answer_prompt_consistency` | 80 PASS                     |
| `true_false_polarity`       | 27 PASS                     |
| `absolute_wording`          | 76 PASS, 4 NOTICE           |

### Content-acceptance regression — resolved

| Phrase check                                           | Previous matrix | This re-run |
| ------------------------------------------------------ | --------------: | ----------: |
| "According to"                                         |        79 / 100 |  **0 / 80** |
| "According to the lesson"                              |        26 / 100 |  **0 / 80** |
| Prompts corrupted by the display-time prefix sanitizer |      at least 5 |       **0** |

The content-acceptance failure that blocked the previous release gate no longer reproduces under
the v5.12 prompt.

### Deterministic grading

Every stored question was answered with its reference answer and graded through the live grading
path: **80 / 80 graded correct**, with no false negatives.

## Known limit — diagnosed

Both failure messages share a single root cause: a `question_answer_kind_mismatch` outcome on one
ordinal, repeated until the three bounded structural retries were exhausted.

- 3 runs failed with "the learner-facing adaptive retry prompt is missing or duplicates the original question"
- 2 runs failed with "the learner-facing question and answer are not complete and well-supported"

In every case the engine **failed closed**: the accepted prefix was preserved, no fallback content
was substituted, and no invented question was ever exposed or stored. The safety guarantee held
throughout — the system stops rather than teaching something ungrounded. The frequency is the part
to improve: roughly one ordinal per six banks spends its full retry budget, so widening that budget
and tightening the type-plan instruction for this outcome is the next task.

Re-attempting the five videos recovered three of them, which shows the behaviour is probabilistic
rather than inherent to those lessons. Two videos (`qP-9wwRrJbg` AP Physics 1
Kinematics, `G8zkXA5TXgg` AP Calculus AB Unit 1) failed on both passes and are the best
reproduction cases.

## Release-gate assessment

| Gate                                     | Status                                                  |
| ---------------------------------------- | ------------------------------------------------------- |
| Progressive entry (question 1 reachable) | **Pass** — 10 / 10                                      |
| Storage-only privacy boundary            | **Pass** — no key, caption, or prompt leaves local      |
| No fallback or invented content          | **Pass** — 0 emitted                                    |
| Content acceptance / prompt phrasing     | **Pass** — regression resolved                          |
| Deterministic grading                    | **Pass** — 80 / 80                                      |
| Zero-intervention full-bank completion   | **Open** — 5 / 10 first attempt, 8 / 10 after one retry |

The re-run clears the content-acceptance gate that previously blocked v5.12. The single remaining
open gate is zero-intervention completion, with an identified cause and a scoped fix.

## Artifacts

- First pass: `output/headless/matrix-2026-08-22/`
- Re-attempt of failures: `output/headless/matrix-2026-08-22-retry/`

Each complete run writes a `.txt` transcript, a `.json` structured record (source, generation
metadata, questions, provenance, audits, grades, events), and a `.jsonl` event stream.
