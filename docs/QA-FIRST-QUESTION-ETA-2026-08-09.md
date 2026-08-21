# First-question ETA calibration — 2026-08-09

## Scope

This study measures the learner-visible interval from pressing **Create my
quiz** until question 1 is interactive. It does not treat completion of the
remaining progressive question stream as time the learner must wait.

The production web app and ClipQuest Local AI extension 0.8.0 were exercised
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

## Results

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

## Model

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

Requested count has only a small coefficient because the progressive
extension sends at most five questions in its first DeepSeek request. Count
strongly changes full-bank completion, but it should not dominate the ETA for
entering question 1.

Across all 15 observations, the unrounded model has 4.949s mean absolute error,
2.656s median absolute error, and +0.281s mean bias. The previous fixed
45/60/65-second mapping has 36.438s mean absolute error and +36.438s mean bias
against the same first-question target. Excluding the retained 59.353s
long-tail observation, the new model's mean absolute error is 3.268s.

The learner-facing countdown is rounded to five-second steps. If a long-tail
request exceeds the modeled interval, the UI stops promising a number and says
that question 1 is taking longer than usual while streaming continues.

## Data handling

Only video identifiers, source duration, aggregate caption counts, selected
question configuration, retry counts, and timings were retained. No transcript
text, DeepSeek response body, or API key is included in this report.
