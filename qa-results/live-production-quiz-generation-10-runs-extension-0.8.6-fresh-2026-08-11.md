# ClipQuest extension 0.8.6 official-site ten-video acceptance

Date: 2026-08-11  
Site: `https://clipquest.ccwu.cc`  
Browser: the user's real Google Chrome profile  
Result: **10/10 quizzes completed, 100/100 planned questions answered, but the intended v5.6 release profile was not exercised**

## Executive verdict

The progressive learner journey completed successfully in every run. Question 1 became visible before the full bank, each quiz remained fixed at its requested 5/10/15 questions, and every attempt reached the normal completion screen with a 100% score. No incomplete bank was scored.

The stability and content-quality release gate still fails:

- Nine banks completed with zero model retries; Run 8 needed five automatic content-repair requests after four schema-invalid calls. First-pass bank completion was therefore 9/10 (90%), below the 99% target.
- All ten banks were generated with legacy prompt v5.1, validator v4.0, protocol 5, and profile `legacy_reasoning_v5_1`.
- Production health supports v5.6/v4.5, but `rolloutMode` is `disabled` and `effectiveDefaultProfile` is still `legacy_reasoning_v5_1`.
- 63 of 100 stored prompts contain `According to`; 35 contain the exact phrase `According to the lesson`; 68 contain at least one literal source-reference marker from the bounded audit.
- A conservative literal scan found at least eight course-logistics or metadata questions. Manual inspection found examples about exams, assignments, course aims, cross-listing, instructor history, popularity, and university admission rather than the instructional concepts.

## Tested artifacts

- Extension ZIP: `/Users/unoxyrich/Downloads/clipquest-captions-extension.zip`
- ZIP SHA-256: `ab378c87ebf81e9d517dc258cac05a76c9ebecf8124bd19b0dfe04583b03c4da`
- Installed unpacked extension: ClipQuest Local AI `0.8.6`
- Extension ID: `kkfpecifnhcchelambnapkpkblenagph`
- DeepSeek configuration: the local `DEEPSEEK_API_KEY` was entered through the extension popup and passed its Save & test check. The key value was never printed, queried from Chrome storage, or included in this report.
- Worker version ID: `22e8a36d-2dfc-4004-a71c-89d7f253911d`
- Worker version tag: `98cd831ba5bfcdffb0305b334eb149f0e090fed4`
- Health-supported profile: `evidence_grounded_auto_v5_4`
- Health-supported prompt/validator: `quiz-local-json-stream-v5.6` / `validator-local-progressive-v4.5`
- Effective production default: `legacy_reasoning_v5_1` because rollout is disabled

Runs 1-3 used the existing `unoxyrich` learner account. Runs 4-10 used one disposable authenticated QA learner account so the sustained matrix could continue without altering or deleting the first account's evidence. The QA account remains in place because deleting it would cascade the attempts used by this report.

## Measurement method

- Ten distinct educational YouTube videos covered short, medium, long, science, history, mathematics, and lecture content.
- The matrix covered 5, 10, and 15 questions and every supported question type: multiple choice (MC), True/False (TF), and short answer (SA).
- Source setup is the observed wait until the extension-backed create flow reported the selected video ready. Run 1's setup interval was not captured, so it is reported as unavailable rather than inferred.
- Q1 time is measured from **Create my quiz** to visible question content on the quiz route. Run 3's route/question shell appeared at 11.386 seconds, while all four MC controls were conservatively confirmed at 22.548 seconds.
- Full-bank time is authoritative server time from the first recorded DeepSeek call start (`created_at - elapsed_ms`) to the bank's stored `lastQuestionAt`.
- Model time is the sum of safe `elapsed_ms` values in `quiz_generation_call_events`; it is not wall-clock learner time and can differ slightly from full-bank time.
- Primary calls, automatic retries, failure outcomes, completion status, score, and stored metadata were reconciled against remote D1 with `npx wrangler`.
- Every question was answered through the live learner UI. Correct server-defined answers were used to exercise display-order mapping, grading, progression, and final scoring rather than to evaluate subject knowledge.

## Per-run results

| Run | Video ID / topic | Quiz | Source setup | Q1 visible | Full bank | Model time | Primary | Auto retry | Failed calls | Learner answer retries | Result |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | `6tw_JVz_IEc` - CRISPR | 5 MC/TF/SA | n/a | 7.645 s | 46.284 s | 48.352 s | 3 | 0 | 0 | 0 | 5/5, 100% |
| 2 | `0RRVV4Diomg` - Periodic Table | 5 MC/SA | 24.290 s | 10.647 s | 50.612 s | 52.181 s | 3 | 0 | 0 | 0 | 5/5, 100% |
| 3 | `7qNE_B0r4z4` - AP Calculus derivatives | 5 MC/TF | 28.270 s | 11.386 s* | 26.521 s | 29.435 s | 3 | 0 | 0 | 0 | 5/5, 100% |
| 4 | `x4PPZCLnVkA` - Nervous System | 10 TF/SA | 10.679 s | 11.546 s | 106.644 s | 109.573 s | 6 | 0 | 0 | 1 | 10/10, 100% |
| 5 | `Yocja_N5s1I` - Agricultural Revolution | 10 MC/TF | 17.231 s | 12.450 s | 57.932 s | 59.014 s | 4 | 0 | 0 | 0 | 10/10, 100% |
| 6 | `aircAruvnKk` - Neural Networks | 10 MC/SA | 23.905 s | 11.696 s | 84.631 s | 87.592 s | 6 | 0 | 0 | 0 | 10/10, 100% |
| 7 | `OmJ-4B-mS-Y` - Map of Mathematics | 10 MC/TF/SA | 20.923 s | 7.891 s | 61.015 s | 63.936 s | 6 | 0 | 0 | 0 | 10/10, 100% |
| 8 | `PbITFIGLciI` - Einstein/Oppenheimer/Feynman | 15 MC/TF/SA | 23.829 s | 10.854 s | 199.513 s | 195.726 s | 12 | 5 | 4 | 0 | 15/15, 100% |
| 9 | `lZ3bPUKo5zc` - Quantum superposition | 15 MC/TF | 17.547 s | 9.357 s | 102.364 s | 104.826 s | 6 | 0 | 0 | 0 | 15/15, 100% |
| 10 | `FSyAehMdpyI` - Atomic nucleus | 15 MC/TF/SA | 28.143 s | 7.453 s | 126.688 s | 128.617 s | 8 | 0 | 0 | 0 | 15/15, 100% |

\* Run 3's complete prompt and all four MC controls were confirmed at 22.548 seconds. The 11.386-second value is the first visible question-route content measurement used consistently in the aggregate.

## Aggregate results

| Metric | Result |
|---|---:|
| Completed quizzes | 10/10 |
| Completed planned questions | 100/100 |
| Attempts with score 100% | 10/10 |
| Incomplete banks scored | 0 |
| Learner generation-recovery clicks | 0 |
| Banks completed with no automatic retry | 9/10 |
| First-pass bank completion | 90% |
| Primary DeepSeek requests | 57 |
| Automatic-retry DeepSeek requests | 5 |
| Total recorded DeepSeek requests | 62 |
| Failed/schema-invalid recorded calls | 4 |
| New `manual_continuation` events | 0 |
| Learner answer retries | 1 |
| Total recorded model time | 879.252 s |

### Timing distribution

| Metric | Minimum | Median | Mean | Nearest-rank p95 / maximum |
|---|---:|---:|---:|---:|
| Q1 visible | 7.453 s | 10.751 s | 10.093 s | 12.450 s |
| Full bank ready | 26.521 s | 72.823 s | 86.220 s | 199.513 s |
| Source setup (9 measured runs) | 10.679 s | 23.867 s | 21.646 s | 28.270 s |

With ten generation observations, the nearest-rank p95 is the sample maximum. The Q1 table separately identifies Run 3's later all-controls confirmation.

## Retry accounting

Runs 1-7, 9, and 10 had only complete primary calls. Run 8 produced all five automatic retries in the matrix:

1. A primary two-question q6-q7 envelope returned `schema_invalid`; q6 and q7 were recovered as two singleton `automatic_retry` calls.
2. The q9 primary call returned `schema_invalid`; its first automatic retry also returned `schema_invalid`; the second retry completed q9.
3. The q10 primary call returned `schema_invalid`; one automatic retry completed q10.
4. q11-q15 then completed as primary singleton calls.

The authoritative event table therefore contains 12 primary calls, five automatic retries, four failed calls, and 17 total calls for Run 8. The extra-request count matches the five automatic-retry rows exactly. No learner clicked a continuation control and no new call was labeled `manual_continuation`.

The legacy bank summary is not authoritative for these counters: it retains old aggregate values that under-report calls and retries. Current QA and Admin reporting must continue to derive live metrics from `quiz_generation_call_events`.

## Content-quality audit

The stored 100-question set contains:

- 63 prompts containing `According to`.
- 35 prompts containing the exact phrase `According to the lesson`.
- 68 prompts containing at least one literal source-reference marker from this allowlist-based audit: `According to`, `lesson`, `transcript`, `video`, `lecture`, `lecturer`, `presenter`, `narrator`, or `speaker`.
- Zero prompts containing the literal word `transcript` in this particular matrix.
- At least eight questions matching a conservative logistics/metadata keyword scan. This is a lower bound, not a semantic classifier.

Representative defects observed in the learner flow:

- Periodic Table q1 asked about Mendeleev's university-admission destination rather than periodic-table chemistry.
- AP Calculus included an AP-exam-mechanics question instead of testing derivative concepts.
- Agricultural Revolution q1 tested the presenter's opening exam joke.
- Map of Mathematics included narrator popularity/request-count metadata.
- The Einstein/Oppenheimer/Feynman bank asked about instructor teaching history, course aims, cross-listing, and course framing.
- Quantum Superposition asked about course goals and late problem-set rules.

These questions were stored because every new bank used prompt v5.1. Extension 0.8.6 being installed is insufficient while the authenticated production profile still assigns `legacy_reasoning_v5_1`.

## Other defects and observations

### Short-answer grading is too strict for a concise correct response

Run 4 completed 10 questions but records `total_answered = 11`. A concise answer explaining that sensory neurons carry external-stimulus information toward the central nervous system was rejected; the longer exact rubric wording passed on retry. Generation was stable, but the learner-facing semantic grader produced one avoidable incorrect result.

### The completed-state indicator can look like a monitoring stall

The readiness pill hides immediately at N/N. During Run 3, an observer that began polling after the transition saw no pill and could misinterpret absence as a stall even though D1 already showed the bank `passed`. This did not block the learner, but an accessible durable ready state or authoritative route signal would improve observability.

### Grounded v5.6 remains untested in production

The active `/health` response distinguishes support from assignment correctly:

- supported profile: `evidence_grounded_auto_v5_4`
- supported prompt: `quiz-local-json-stream-v5.6`
- supported validator: `validator-local-progressive-v4.5`
- rollout mode: `disabled`
- effective default: `legacy_reasoning_v5_1`

Every tested quiz row independently confirmed the legacy metadata. This matrix validates the current production default, not the intended grounded release profile.

## What worked

- All ten real learner flows reached the normal completion result.
- All 100 planned questions were answered and no shortened quiz completed.
- Question 1 appeared progressively before the remaining bank was ready in every run.
- Nine banks required no model retry.
- Run 8 recovered automatically without a learner continuation click.
- Run 8's new call events honestly used `automatic_retry`; no new manual-continuation classification was inserted.
- Every attempt retained its planned 5/10/15 size and reached a 100% final score.
- Multiple-choice display ordering continued mapping to canonical server answers correctly.
- The DeepSeek credential and caption/model payloads stayed out of this report and the inspected safe telemetry.

## Release conclusion

**The current live system is functionally completable but does not pass the requested stability or content-quality release gate.** Ten of ten quizzes completed without learner generation intervention, but first-pass completion was only 90% because one bank needed five automatic repairs. More importantly, the intended v5.6 concept-only profile is still disabled, so 63% of prompts retain `According to` framing and several questions test course logistics or source metadata.

The next production acceptance must first assign `unoxyrich` (or the disposable QA account) to the grounded v5.6 profile, verify the first-import metadata before running the matrix, then repeat at least the failing Run 8 source plus the course-logistics-heavy sources. No code, migration, deployment, database wipe, account deletion, or Git push was performed during this QA run.
