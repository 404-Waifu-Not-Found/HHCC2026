# First-question ETA calibration — 2026-08-22

> Historical calibration with a 2026-08-22 production revalidation. The original 15-run dataset below used extension 0.8.0. The latest official-site evidence is the [extension-0.8.5 ten-video report](../qa-results/live-production-quiz-generation-10-runs-extension-0.8.5-2026-08-22.md).

## Scope

This study measures the learner-visible interval from pressing **Create my
quiz** until question 1 is interactive. It does not treat completion of the
remaining progressive question stream as time the learner must wait.

The production web app and ClipQuest extension 0.8.0 were exercised
in authenticated Chrome. Each run used locally acquired YouTube captions and
extension-local DeepSeek generation. The next run did not begin until the
previous quiz reached its authoritative requested count, so model streams did
not overlap.

The five public educational sources covered 5:29 to 76:06 and 839 to 11,851
caption words:

1. [CRISPR](https://www.youtube.com/watch?v=6tw_JVz_IEc)
2. [The Nervous System](https://www.youtube.com/watch?v=x4PPZCLnVkA)
3. [But what is a neural network?](https://www.youtube.com/watch?v=aircAruvnKk)
4. [Physics in the 20th Century](https://www.youtube.com/watch?v=PbITFIGLciI)
5. [Introduction to Superposition](https://www.youtube.com/watch?v=lZ3bPUKo5zc)

## Original 2026-08-22 results

The first-question type was balanced across the 15 runs: five multiple-choice,
five true/false, and five short-answer cases. All first chunks passed without
an automatic retry.

| Run | Video                       | Duration | Caption words | Questions | First type      | Question 1 visible | Full bank ready |
| --: | --------------------------- | -------: | ------------: | --------: | --------------- | -----------------: | --------------: |
|   1 | CRISPR                      |     5:29 |           839 |         5 | Multiple choice |            13.647s |         14.768s |
|   2 | Nervous System              |    12:04 |         1,786 |         5 | True/false      |            17.917s |         17.490s |
|   3 | Neural Network              |    18:40 |         2,771 |         5 | Short answer    |            22.941s |         28.265s |
|   4 | Physics in the 20th Century |    30:36 |         5,329 |         5 | Multiple choice |            13.897s |         14.835s |
|   5 | Quantum Superposition       |    76:06 |        11,851 |         5 | True/false      |            10.311s |         11.785s |
|   6 | Quantum Superposition       |    76:06 |        11,851 |        10 | Multiple choice |            18.632s |         42.953s |
|   7 | Physics in the 20th Century |    30:36 |         5,329 |        10 | Short answer    |            25.957s |         81.248s |
|   8 | Neural Network              |    18:40 |         2,771 |        10 | Multiple choice |            20.710s |         50.029s |
|   9 | Nervous System              |    12:04 |         1,786 |        10 | Short answer    |            13.366s |         61.682s |
|  10 | CRISPR                      |     5:29 |           839 |        10 | True/false      |            15.662s |         42.908s |
|  11 | Neural Network              |    18:40 |         2,771 |        15 | True/false      |            14.833s |         88.648s |
|  12 | CRISPR                      |     5:29 |           839 |        15 | Short answer    |            28.957s |        138.840s |
|  13 | Quantum Superposition       |    76:06 |        11,851 |        15 | Short answer    |            59.353s |        178.094s |
|  14 | Nervous System              |    12:04 |         1,786 |        15 | Multiple choice |            16.536s |        108.475s |
|  15 | Physics in the 20th Century |    30:36 |         5,329 |        15 | True/false      |            10.715s |         72.061s |

“Full bank ready” is the extension completion event relative to the click. On a
small bank it can precede the learner-visible timestamp by a few hundred
milliseconds while import, attempt start, navigation, and rendering settle.

The visible first-question median was 16.536s, the 75th percentile was
21.826s, and the range was 10.311–59.353s. The 59.353s observation is retained
as a real no-retry DeepSeek long-tail event.

## Historical model

The app uses a rounded, bias-corrected robust fit:

```text
first question ETA seconds = clamp(
  15,
  35,
  12
    + 0.2 * min(caption words, 12,000) / 1,000
    + 2.0 * (question count - 5) / 5
    + first-question type adjustment
)

type adjustment:
  true/false       0.0
  multiple choice  3.5
  short answer    12.5
```

When the exact local caption word count is not available yet, source duration
estimates it at 155 words per minute. With neither input, the model uses a
2,500-word neutral default. The caption term is capped at the largest tested
input because this dataset does not justify extrapolating a stronger length
effect.

Requested count had only a small coefficient because extension 0.8.0 requested
at most five questions in its first DeepSeek call. Count strongly changed
full-bank completion, but it did not dominate the historical ETA for entering
question 1. Current profile-specific call sizing must be calibrated separately.

Across all 15 observations, the unrounded model has 4.949s mean absolute error,
2.656s median absolute error, and +0.281s mean bias. The previous fixed
45/60/65-second mapping has 36.438s mean absolute error and +36.438s mean bias
against the same first-question target. Excluding the retained 59.353s
long-tail observation, the new model's mean absolute error is 3.268s.

The learner-facing countdown is rounded to five-second steps. If a long-tail
request exceeds the modeled interval, the UI stops promising a number and says
that question 1 is taking longer than usual while streaming continues.

## Production revalidation — 2026-08-22

The model was rechecked during ten complete official-site quiz runs with Chrome extension 0.8.5. The visible countdowns were 15 or 20 seconds, and the learner reached an interactive first question in every counted run.

| Metric                    | Revalidation result |
| ------------------------- | ------------------: |
| Runs                      |                  10 |
| Minimum Q1 latency        |             7.702 s |
| Median Q1 latency         |            11.395 s |
| Mean Q1 latency           |            12.461 s |
| Observed p95 / maximum    |            25.655 s |
| Mean absolute ETA error   |             6.818 s |
| Median absolute ETA error |             6.873 s |
| Runs within 10 seconds    |                7/10 |
| ETA conservative          |                8/10 |

Per-run comparison:

| Run | Planned questions | Displayed ETA | Q1 visible | Absolute error |
| --: | ----------------: | ------------: | ---------: | -------------: |
|   1 |                 5 |        15.0 s |   25.655 s |       10.655 s |
|   2 |                 5 |        15.0 s |   15.737 s |        0.737 s |
|   3 |                 5 |        15.0 s |   14.073 s |        0.927 s |
|   4 |                10 |        15.0 s |    8.990 s |        6.010 s |
|   5 |                10 |        15.0 s |   10.561 s |        4.439 s |
|   6 |                10 |        20.0 s |    7.969 s |       12.031 s |
|   7 |                10 |        15.0 s |    9.429 s |        5.571 s |
|   8 |                15 |        20.0 s |   12.229 s |        7.771 s |
|   9 |                15 |        20.0 s |    7.702 s |       12.298 s |
|  10 |                15 |        20.0 s |   12.264 s |        7.736 s |

The countdown remained reasonably conservative, but it was not tightly calibrated: three runs missed the 10-second target, and the first cold run exceeded its estimate. Do not refit the formula from these ten timings alone because production rollout was disabled and every tested bank used the legacy v5.1 profile rather than the current evidence-grounded singleton profile. Recalibrate only after the intended profile is enabled and has an immutable real-browser benchmark; keep retry-phase delay separate from the healthy first-question model.

The excluded first Run 8 attempt reached question 1 in 9.113 seconds, later stopped at 11/15, and is not part of the ETA statistics above. Its failure affects completion reliability, not the measured healthy first-question distribution.

Extension 0.8.6 adds local automated coverage for reclaiming that same accepted prefix and completing the original bank, but it does not add a new timing sample. Do not combine source-level recovery tests with this production latency dataset. Recalibrate only from the required immutable 0.8.6 benchmark and canary; see the [0.8.6 implementation report](../qa-results/run-8-recovery-extension-0.8.6-implementation-2026-08-22.md).

## Data handling

Only video identifiers, source duration, aggregate caption counts, selected
question configuration, retry counts, and timings were retained. No transcript
text, DeepSeek response body, or API key is included in this report.
