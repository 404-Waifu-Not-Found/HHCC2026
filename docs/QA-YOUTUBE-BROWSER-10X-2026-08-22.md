# Production YouTube browser-caption QA — 2026-08-22

> Historical pre-extension production evidence. This report exercised the retired transcript-upload/backend-generation path and does not describe the current extension-local storage-only architecture. The 2026-08-22 full-subtitle changes below were verified locally but were not deployed during that implementation run. Use the [documentation index](./README.md), [README release status](../README.md#release-status), and [extension-0.8.5 production report](../qa-results/live-production-quiz-generation-10-runs-extension-0.8.5-2026-08-22.md) for current release decisions.

## Scope

- Production: `https://clipquest.ccwu.cc`
- Browser: the user's existing Google Chrome session
- Session length: Short (5 questions)
- Acceptance: paste a distinct public AP-course YouTube URL and reach question 1 of a schema-valid five-question quiz
- Source boundary: complete browser caption text only; sources without verified subtitles fail explicitly

## Results

|   # | Course video                  | YouTube ID    | Import to ready | Create to question 1 | Server job | Questions | Result |
| --: | ----------------------------- | ------------- | --------------: | -------------------: | ---------: | --------: | ------ |
|   1 | AP Biology Unit 1             | `gjswMPTXYk4` |        13.613 s |             12.142 s |    5.338 s |         5 | Pass   |
|   2 | AP Biology Unit 2             | `h0JkytGr07o` |        10.607 s |             11.657 s |    6.415 s |         5 | Pass   |
|   3 | AP Chemistry Unit 1           | `7HnHjnZbYNk` |         3.732 s |              9.106 s |    5.085 s |         5 | Pass   |
|   4 | AP Chemistry Unit 2           | `GBFM7Ti-P34` |        12.612 s |              8.602 s |    5.051 s |         5 | Pass   |
|   5 | AP Physics 1 Kinematics       | `qP-9wwRrJbg` |        14.100 s |             10.122 s |    5.156 s |         5 | Pass   |
|   6 | AP Biology: Chemistry of Life | `kgNBHcPvsGw` |         3.709 s |             10.595 s |    6.041 s |         5 | Pass   |
|   7 | AP Biology: The Cell          | `euG2f8Y81cU` |         3.738 s |             10.133 s |    5.194 s |         5 | Pass   |
|   8 | AP Government Unit 1          | `lxotd_zV1hc` |        13.070 s |             14.801 s |    9.342 s |         5 | Pass   |
|   9 | AP Calculus AB Unit 1         | `G8zkXA5TXgg` |         8.908 s |             10.083 s |    5.494 s |         5 | Pass   |
|  10 | AP Calculus AB Unit 2         | `fC6hYVrYdgk` |        10.604 s |              9.107 s |    4.736 s |         5 | Pass   |

Historical production result for that artifact: **10/10 passed**. It is not evidence that the current extension-local flow passes today.

## Evidence and timing

- Chrome reached `Question 1 of 5` for every URL.
- The observed Create-to-question-1 average was 10.635 seconds; this includes browser subtitle lookup, text validation, transcript upload, server generation, polling, and quiz navigation.
- Remote D1 job time averaged 5.785 seconds and ranged from 4.736 to 9.342 seconds. All ten transcript-upload-to-complete server jobs met the under-10-second target.
- Remote D1 reported `state = complete`, `error_code = null`, and five committed questions for every job.
- Remote R2 transcript metadata reported `origin = captions` and `acquisition = youtube_text_provider` for every job. Segment counts ranged from 13 to 103.
- Every accepted source used complete browser subtitle text. ClipQuest did not download or process video audio.

## Release verification

- Implementation release commit tested: `e8b1c69c379befb96dd50dbcb9c3a9dd7ab31b50`
- Acceptance Worker version tested: `e032614a-3278-4049-aebe-c576c77869ad` at 100%
- `GET /health`: healthy with authentication, generation, email, and YouTube open-source acquisition configured
- Live CSP allows the text-only browser endpoint in `connect-src` and retains the existing restrictive media policy.

## 2026-08-22 full-subtitle regression evidence

The caption pipeline now carries a completeness manifest through import, prework, upload, R2 storage, classification, and quiz generation. The manifest records source and normalized segment counts, canonical character count, first/last timing, expected duration, and a text fingerprint. A partial or changed upload is rejected with `incomplete_transcript`.

Real Chrome QA against the local Worker and web client used three unrelated public YouTube recordings:

| YouTube ID    | Source/normalized segments | Canonical characters | Last caption end | Fingerprint | Result   |
| ------------- | -------------------------: | -------------------: | ---------------: | ----------- | -------- |
| `BjRvQbWsTfM` |                    715/715 |               20,777 |     1,638,799 ms | `fbf965c6`  | Complete |
| `TTsLhDHWopI` |                    776/776 |               23,505 |     2,209,700 ms | `64556b91`  | Complete |
| `HZVwZa2vOZ8` |                    734/734 |               27,950 |     1,872,639 ms | `eae88e10`  | Complete |

For each run, structured client and Worker logs reported `transcriptComplete: true`; the stored manifest matched the loaded transcript; classification and every generation batch received the complete serialized subtitle set. The final observed paste/create-to-question flow completed in 3.646 seconds using the deterministic evidence-grounded fallback after DeepSeek timed out.

Automated regression coverage adds synthetic 12,005-event provider subtitle documents and verifies the last event survives parsing. The complete local gate passed 66 Vitest tests (33 API, 23 app, 10 contracts), workspace typecheck, lint, build, Wrangler dry deployment, and `git diff --check`.

This proves lossless handling for accepted inputs inside the documented 60,000-normalized-segment and 750,000-canonical-character safety envelope. It does not claim that private, deleted, geo-restricted, active-live, or upstream-blocked videos can provide subtitles; those inputs must fail explicitly rather than create a quiz from partial text.
