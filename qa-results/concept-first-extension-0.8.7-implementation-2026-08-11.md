# Concept-first extension 0.8.7 implementation evidence

Date: 2026-08-11

## Scope

This report records local source and automated-test evidence for the concept-first quiz prompt and deterministic short-answer grading remediation. It is not a real-DeepSeek benchmark, Chrome installation result, canary result, production deployment, or evidence that the grounded rollout is enabled.

Candidate metadata:

- Extension: `0.8.7`
- Prompt: `quiz-local-json-stream-v5.7`
- Validator: `validator-local-progressive-v4.6`
- Result protocol: `8`
- Pipeline: `9`
- Capability: `question-stream-v5`
- Progressive import: `extension-progressive-import-v6`
- Generation profile: `evidence_grounded_auto_v5_4`
- Configured default during implementation: grounded rollout disabled

## Diagnosis retained

The earlier 63/100 source-framing result came from production banks persisted with the legacy v5.1 profile while the grounded rollout was disabled. It did not exercise the then-current grounded prompt. The newer source-selection layer nevertheless had a separate latent defect: a no-positive-score fallback and inclusion of score-zero sentences could reintroduce administrative or low-value material. The observed sensory-neuron answer also missed the deterministic alternative threshold because pronouns counted as semantic tokens and conservative aliases did not connect carrying information for analysis with transmitting a signal for processing.

## Implemented behavior

- The system prompt now identifies itself as a direct assessment generator and treats the transcript as private evidence that must never be mentioned to the learner.
- New v5.7 banks use `Topic hint — never test this label`, `Private reference material — never mention this source`, and per-slot `Eligible instructional evidence` labels.
- Strict excerpt selection accepts only positively scored instructional sentences. Logistics-only and score-zero-only sources fail with `non_instructional_source` before any DeepSeek request.
- Question 1 uses the strongest instructional excerpt; later singleton ordinals rotate deterministically through distinct high-value excerpts.
- Raw and normalized question candidates are checked across question, concept, explanation, answers, choices, distractors, rubric ideas, acceptable answers, and structured claims.
- New bounded outcomes distinguish `source_framing_invalid`, `course_logistics_invalid`, `low_pedagogical_value`, `rubric_invalid`, and `non_instructional_source`; targeted repairs regenerate only the missing ordinal.
- Prose rubrics require one to three independent indispensable ideas and three to six distinct complete full-credit variants, with the shortest variant first. Formula answers retain their structural path.
- The deterministic grader keeps its 67% alternative threshold, ignores non-semantic pronouns, normalizes CNS/PNS/DNA/RNA, and conservatively canonicalizes signal transfer, signal/data, processing, and detection terms.
- New grounded-bank imports must use the current v5.7/v4.6/protocol-8/import-v6 metadata. Existing incomplete v5.4-v5.6 and v5.0-v5.1 banks continue only with their original metadata.

## Local verification

- Extension parser/generator/quality suite: 71/71 passed.
- Contracts suite: 21/21 passed.
- API suite: 95/95 tests passed, plus all three Worker asset-probe tests.
- App suite: 82/82 tests passed, plus both static-export asset-verifier tests.
- Total workspace test cases: 274 passed.
- Chrome Playwright end-to-end suite: 23/23 passed.
- Repository TypeScript checks: passed for contracts, API, and app.
- Lint and Prettier formatting checks: passed.
- Contracts, app static export, extension, and Worker builds: passed.
- Static-export verification resolved 440 same-origin references across 30 HTML shells without a missing asset.
- `npx wrangler deploy --dry-run` passed with Wrangler 4.115.0 and 183 assets while all grounded-rollout variables remained disabled.
- Packaged extension: `apps/extension/dist/clipquest-captions-extension.zip`.
- Extension ZIP SHA-256: `00810890f4ae28846b72960539d501dd03a0ce8fe07c585fcc825f2dafe3e91a`.
- The packaged manifest reports extension version `0.8.7`.
- The exact observed sensory-neuron answer passes. Controls `They send signals.`, `Sensory neurons are in the PNS.`, and `CNS` remain incorrect.

The recorded-transcript 100-bank benchmark, matching Chrome installation, authenticated canary bank, and official-site ten-video matrix remain separate release gates. This local implementation report does not claim those live acceptance results.

## Release boundary

`QUIZ_V5_4_ROLLOUT` remains disabled in the checked-in production configuration. Do not enable it from this report alone. Canary assignment for user `TFu3AdSrGdHSjXMiCYaqvnBfJFOLYEf6` requires the exact committed and deployed Worker/app artifact, matching extension 0.8.7 ZIP installed in Chrome, a verified v5.7 persisted bank, and successful benchmark gates. No D1 migration is required for this remediation.
