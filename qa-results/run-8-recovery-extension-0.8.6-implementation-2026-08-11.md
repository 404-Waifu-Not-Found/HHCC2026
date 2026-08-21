# ClipQuest Run 8 recovery and extension 0.8.6 implementation evidence

Date: 2026-08-11

Evidence scope: local source, automated tests, reproducible builds, and Cloudflare dry-run only

Production effect: none

## Status

The Run 8 recovery, concept-only generation, safe legacy presentation, honest compatibility telemetry, rollout enforcement, and health/admin metadata changes are implemented in the local source tree.

This report is deliberately not a live acceptance report. No branch was pushed, no D1 migration was applied, no Worker version was uploaded or deployed, no rollout variable was changed, and no extension was installed or reloaded in Chrome during this implementation pass. The verified production baseline therefore remains extension 0.8.5 with the grounded rollout disabled.

## Candidate identifiers

| Contract | Candidate value |
| --- | --- |
| Extension | `0.8.6` |
| Result protocol | `8` |
| Required capability | `question-stream-v5` |
| Pipeline | `9` |
| Prompt | `quiz-local-json-stream-v5.6` |
| Validator | `validator-local-progressive-v4.5` |
| Progressive import | `extension-progressive-import-v6` |
| Generation profile | `evidence_grounded_auto_v5_4` |
| Model | `deepseek-v4-flash` |

Protocol-8 v5.4/v5.5 and protocol-5 v5.0/v5.1 remain isolated existing-bank continuation paths. New grounded banks require extension 0.8.6 and `question-stream-v5`. Existing completed data remains readable without mixing metadata.

## Run 8 compatibility recovery

The API regression fixture reproduces both failures observed in production:

1. q1-q11 already exist in the original 15-question bank.
2. The original generation session records one primary q12-q13 call with `schema_invalid` and zero accepted questions.
3. A later legacy session records the historically mislabeled `manual_continuation` q12 call with `schema_invalid` and zero accepted questions.
4. Status returns the authoritative 11/15 frontier, the latest generation-session ID, the next consecutive call index, retry ordinals q12-q13, the previous bounded outcome, and a lifetime retry-budget count that includes the historical extra request.
5. An owner claim reopens the same recoverable `generation_failed` bank under a separate browser recovery-session lease.
6. q12 and q13 are requested as singleton protocol-5 `automatic_retry` calls with `content_repair`.
7. q14 and q15 are requested as singleton `primary` calls because no earlier call attempted them.
8. The existing bank changes to `passed` with 15 stored questions. The original attempt remains the planned 15-question attempt; q1-q11 are neither regenerated nor replaced.

The extension fixture independently verifies that the requested suffix is exactly q12-q15 and that its classifications are `automatic_retry`, `automatic_retry`, `primary`, `primary` with protocol-5 `purpose: automatic_recovery` events.

Exact idempotent replay of a historical `manual_continuation` row returns the existing event. A new manual event fails with `manual_generation_continuation_removed`, and extension 0.8.6 does not emit that classification.

## Concept-only validation

Prompt v5.6 requests direct questions about definitions, relationships, mechanisms, formulas, methods, reasoning, applications, and necessary instructional examples. Validation inspects the raw candidate before normalization and applies the concept/logistics gate to:

- the learner-visible question;
- the declared concept;
- the structured claim;
- the learner-visible explanation.

Questions beginning with `According to`, source references such as lesson/transcript/video/lecture/lecturer/presenter/narrator/speaker, and course logistics such as exam weighting, points, grades, schedules, assignments, introductions, promotions, or future coverage are rejected before chunk emission or storage. The extension then issues a targeted singleton content-repair request for only that missing ordinal.

Administrative caption sentences are excluded from instructional focus excerpts. A source containing only logistics produces an explicit source-content failure rather than trivia.

## Legacy presentation compatibility

New v5.6 questions require no display cleanup. Older stored prompts use a one-pass compatibility guard that removes only a complete anchored allowlisted attribution clause.

Verified removals include:

- `According to the lesson, what is continuity?` to `What is continuity?`
- `According to the lecturer, what is continuity?` to `What is continuity?`
- `In this lecture, how is the quotient rule applied?` to `How is the quotient rule applied?`

Verified preservation includes:

- `In the lesson's polynomial example...`
- `In the video’s matrix-based representation...`
- `Based on the lecturer's account...`
- missing-punctuation, formula, English, and CJK compatibility cases that do not match one entire safe clause.

The presentation invariant permits either the whitespace-normalized original prompt or removal of one complete clause. It cannot leave fragments such as `'S`, `R's`, or `R,`. Stored question rows and grading metadata are not rewritten.

## Profile and health truthfulness

The first progressive import must match the authenticated `/api/local-ai/profile` assignment. A grounded-assigned learner cannot create a new legacy-v5.1 bank through the former exemption. Existing legacy banks can still append only with their original prompt, validator, protocol, model, pipeline, profile, and import metadata.

Health and Admin System now distinguish:

- supported profile, prompt, and validator;
- rollout mode;
- effective default profile;
- required extension version and capability.

This prevents deployed supported metadata from being mistaken for the profile assigned to a new bank. The authenticated profile endpoint remains authoritative for a specific learner.

## Verification results

All commands below completed successfully in the local workspace:

| Gate | Result |
| --- | --- |
| Workspace tests | API 93/93 plus 3 shell-probe tests; app 82/82 plus 2 asset-verifier tests; extension 64/64; contracts 20/20 |
| Playwright Chrome | 23/23 journeys passed |
| TypeScript | All workspaces passed |
| ESLint | Passed |
| Prettier | Passed |
| Web/extension/Worker build | Passed |
| Generated shell asset graph | 440 references across 30 HTML shells verified |
| Explicit Cloudflare validation | `npx wrangler 4.115.0 deploy --dry-run` passed |

The extension ZIP was rebuilt at:

`apps/extension/dist/clipquest-captions-extension.zip`

SHA-256:

`ab378c87ebf81e9d517dc258cac05a76c9ebecf8124bd19b0dfe04583b03c4da`

No new D1 migration is required. Existing migrations 0018 and 0019 already contain the bounded protocol, retry-kind, ordinal-attempt, recovery-session, and purpose fields used by this compatibility path.

## Privacy boundary

DeepSeek calls, the learner's API key, captions, full transcript, stable generation instructions, and raw model output remain inside the Chrome extension. The Worker accepts authenticated validated question chunks and bounded call telemetry only. Call events do not contain captions, transcript fragments, raw prompts, raw model bodies, authorization headers, credentials, or raw API errors.

## Gates still required before rollout

The following were intentionally not performed in this implementation pass:

1. Push the exact tested commits.
2. Upload or deploy the Worker/app candidate with rollout disabled.
3. Install and reload the matching 0.8.6 extension artifact in Chrome.
4. Run the 100-bank DeepSeek benchmark across 5/10/15 lengths, all type combinations, English/CJK, caption sources, and formula-heavy material.
5. Canary the grounded profile for `unoxyrich` and run the official ten-video, 100-question matrix against one immutable Worker SHA and extension ZIP.
6. Revisit the original production Run 8 bank if still obtainable, or run the controlled equivalent fault in real Chrome.
7. Verify every new canary bank persisted prompt v5.6, validator v4.5, protocol 8, pipeline 9, and `evidence_grounded_auto_v5_4`.
8. Promote the rollout only if every completion, telemetry, content, latency, privacy, and no-shortened-bank gate passes.

Until those steps succeed, source-level remediation must not be reported as a production fix or enabled rollout.
