# ClipQuest documentation index

This index separates current operating guidance from dated design and QA evidence. Start with the current-state documents; use historical reports only for regression context.

## Current state

- [Repository README and release status](../README.md#release-status): product architecture, current source contracts, verified production snapshot, development, verification, and privacy boundary.
- [Production release](./PRODUCTION-RELEASE.md): migration, version upload, override smoke, promotion, rollback, and post-release generation-profile checks.
- [Operations console](./ADMIN-CONSOLE.md): roles, read-only Generation streams, safe telemetry, System metadata, and admin API surface.
- [Production quiz-generation QA — extension 0.8.5](../qa-results/live-production-quiz-generation-10-runs-extension-0.8.5-2026-08-11.md): latest official-site ten-video, 100-question learner run and current defects.
- [Run 8 recovery and extension 0.8.6 implementation evidence](../qa-results/run-8-recovery-extension-0.8.6-implementation-2026-08-11.md): local compatibility-recovery, concept-validation, presentation, telemetry, and release-gate evidence. It is not a live rollout report.
- [Concept-first extension 0.8.7 implementation evidence](../qa-results/concept-first-extension-0.8.7-implementation-2026-08-11.md): local prompt, strict evidence selection, targeted validation, rubric, and deterministic-grader evidence. It is not a benchmark or live rollout report.
- [Extension 0.8.8 canary release evidence](../qa-results/concept-first-extension-0.8.8-canary-blocked-2026-08-13.md): exact pushed/deployed artifact identity, clean extension replacement, automated gates, and the untrusted TLS route that blocked the official-site matrix. General rollout remains blocked.

## Current verified snapshot

As observed on 2026-08-13, Worker `c1ceecc8-4e6e-4b9a-bdea-49f48031fae2` from Git `297747e` serves the 0.8.8/v5.8 canary configuration. The exact extension artifact was installed and locally configured, and all automated gates passed. General enablement is **not** cleared: the live Chrome matrix was stopped when the local network route presented a certificate for `183.192.65.101` instead of `clipquest.ccwu.cc`. See the dated 0.8.8 report above.

Historical 2026-08-11 baseline:

- Production Worker `a8d8cda5-ea66-4e87-afae-388b2cf237dd` was tagged from Git SHA `9c1bc3b75929819cc18f1a7bb4a50b7cd954dc03`.
- Remote D1 was migrated through `0019_grounded_generation_telemetry.sql`.
- Chrome ran ClipQuest Local AI 0.8.5.
- The deployed source advertised pipeline 9, prompt v5.5, validator v4.4, and extension-local generation, but every rollout variable was disabled. Newly tested banks therefore used the legacy v5.1 compatibility profile.
- Ten final banks and all 100 planned questions completed, but only 9/10 first attempts completed. The excluded attempt failed schema validation at 11/15, automatic recovery also failed, and a new quiz was required.
- Current release blockers are recovery reliability, incorrect legacy call classification, widespread source-referential prompt wording, and a corrupting display-time prefix transformation.

This snapshot is dated. Recheck `/health`, Wrangler deployment status, the D1 migration ledger, the installed extension, and one newly persisted bank before treating it as current.

## Current source candidate

The current source candidate identifies the canary as extension `0.8.13`, result protocol `9`, capability `question-stream-v6`, prompt `quiz-local-json-stream-v5.8`, validator `validator-local-progressive-v4.12`, pipeline `9`, progressive import `v7`, and profile `concept_first_auto_v5_8`. Current generation has no Automatic repair mode: validation failures use bounded automatic singleton retries, while credential and billing failures remain explicit configuration actions.

Automated regression coverage retains the 0.8.6 Run 8 recovery behavior and adds v5.7 private-evidence prompting, strict fail-closed excerpt selection, checks across every learner-visible field, distinct content-repair outcomes, bounded non-overlapping rubrics, and the observed sensory-neuron grading case with shallow-answer controls. The legacy presentation guard still preserves possessives and removes only complete anchored attribution clauses.

The exact candidate is pushed, deployed as a canary, and installed in Chrome. These facts do not substitute for the blocked official-origin learner matrix, so production remains canary-only until the network presents a valid ClipQuest certificate and both ten-video matrices pass.

## QA and calibration

- [First-question ETA calibration](./QA-FIRST-QUESTION-ETA-2026-08-09.md): original 15-run model plus the 2026-08-11 extension-0.8.5 revalidation.
- [Production browser-caption QA](./QA-YOUTUBE-BROWSER-10X-2026-08-03.md): historical pre-extension/backend-generation evidence. It is not the current architecture.
- [`qa-results/`](../qa-results/): append-only live and local run reports. Each report identifies its exact Worker/extension/profile and whether it affected production.

Evidence priority for a release decision is:

1. A completed real-browser learner flow against the official origin.
2. Authoritative D1 bank, attempt, and privacy-safe call-event rows.
3. The exact deployed Worker/version allocation and the installed extension version.
4. Automated tests and builds.
5. Historical reports and screenshots.

Lower-priority evidence cannot override a current failure at a higher layer.

## Product and design references

- [Motion system](./MOTION-SYSTEM.md)
- [UI research and adaptation boundary](./duolingo-ui-research.md)
- [Platform asset derivation](../apps/app/assets/platform/README.md)
- [`screenshots/final/`](./screenshots/final/): visual evidence; screenshots are illustrative and do not prove current live behavior.

## Documentation maintenance

When behavior or a release changes:

1. Update the README release snapshot and the relevant operating guide.
2. Add a new dated QA report; do not rewrite measurements from an older artifact.
3. Mark superseded reports at the top and link the newer evidence.
4. Distinguish current source capability, configured rollout, and profile actually persisted by a new bank.
5. Prefer safe IDs, timings, counts, aggregate usage, and bounded outcome codes. Never add API keys, captions, transcripts, model-instruction prompts, raw model bodies, auth headers, or QA credentials. Include only a minimal learner-visible question excerpt when it is necessary to document a content defect.
6. Do not claim commit, push, migration, extension reload, deployment, or learner completion unless that exact action was observed.
