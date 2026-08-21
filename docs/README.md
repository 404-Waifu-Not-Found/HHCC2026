# ClipQuest documentation index

This index separates current operating guidance from dated design and QA evidence. Start with the current-state documents; use historical reports only for regression context.

## Current state

- [HHCC 2026 judge brief](./HACKATHON.md): the learning problem, how each feature maps to learning science, what is built and verified, how to try it in two minutes, architecture, honest status, and team roles. Start here if you are evaluating the hackathon submission.
- [Repository README and release status](../README.md#release-status): product architecture, current source contracts, verified production snapshot, development, verification, and privacy boundary.
- [Production release](./PRODUCTION-RELEASE.md): migration, version upload, override smoke, promotion, rollback, and post-release generation-profile checks.
- [Android private beta](./ANDROID-BETA.md): native architecture, SecureStore, caption-only generation, Sharesheet/App Links, EAS packaging, and device acceptance.
- [Android 0.2.0 implementation QA — 2026-08-16](./QA-ANDROID-BETA-2026-08-16.md): local automated, APK-inspection, and emulator evidence plus the still-open EAS and physical-device gates.
- [iOS 0.2.0 native QA and physical-install follow-up — 2026-08-18](../qa-results/ios-native-full-feature-qa-2026-08-18.md): simulator feature findings, local remediation, signed arm64 device build, installation evidence, and the remaining trust/credentialed-device gates.
- [Cumulative local production-readiness remediation — 2026-08-18](../qa-results/local-production-readiness-remediation-2026-08-18.md): current local test, security, native-build, release-integrity, and remaining external-gate evidence. It is not proof of a push or deployment.
- [Operations console](./ADMIN-CONSOLE.md): roles, read-only Generation streams, safe telemetry, System metadata, and admin API surface.
- [Production quiz-generation QA — extension 0.8.5](../qa-results/live-production-quiz-generation-10-runs-extension-0.8.5-2026-08-11.md): latest official-site ten-video, 100-question learner run and current defects.
- [Run 8 recovery and extension 0.8.6 implementation evidence](../qa-results/run-8-recovery-extension-0.8.6-implementation-2026-08-11.md): local compatibility-recovery, concept-validation, presentation, telemetry, and release-gate evidence. It is not a live rollout report.
- [Concept-first extension 0.8.7 implementation evidence](../qa-results/concept-first-extension-0.8.7-implementation-2026-08-11.md): local prompt, strict evidence selection, targeted validation, rubric, and deterministic-grader evidence. It is not a benchmark or live rollout report.
- [Extension 0.8.8 canary release evidence](../qa-results/concept-first-extension-0.8.8-canary-blocked-2026-08-13.md): exact pushed/deployed artifact identity, clean extension replacement, automated gates, and the untrusted TLS route that blocked the official-site matrix. General rollout remains blocked.

## Current verified snapshot

The Android 0.2.0 source candidate now shares the local quiz engine with Chrome, builds a managed Android bundle for API 29–36, and passes local automated and emulator launch gates. It is **not yet a distributed private beta**: the EAS project, managed release signer, FCM credentials, App Links fingerprint, physical-device matrix, and ten-video Android acceptance remain unverified. See the dated Android report above.

As observed on 2026-08-18, Worker `8350cd9a-e7ba-4b7e-883e-cd85796b8895` from Git `5d4a9e4146a4968c786439a92ad4b86c98a9332a` receives 100% of production traffic. `/health` reports prompt v5.12 as supported, v5.12 rollout disabled, v5.11 as the effective default, version affinity present, and native Android/iOS plus Chrome local-generation clients enabled. Remote D1 is migrated through `0020_generation_call_lifecycle.sql`. This verifies deployed capability and storage compatibility, not a completed v5.12 canary or real-client generation matrix.

The 2026-08-13 Worker `c1ceecc8-4e6e-4b9a-bdea-49f48031fae2` / Git `297747e` canary remains historical evidence. Its live Chrome matrix was stopped when the local network route presented a certificate for `183.192.65.101` instead of `clipquest.ccwu.cc`; it does not clear current general enablement.

Historical 2026-08-11 baseline:

- Production Worker `a8d8cda5-ea66-4e87-afae-388b2cf237dd` was tagged from Git SHA `9c1bc3b75929819cc18f1a7bb4a50b7cd954dc03`.
- Remote D1 was migrated through `0019_grounded_generation_telemetry.sql`.
- Chrome ran ClipQuest 0.8.5.
- The deployed source advertised pipeline 9, prompt v5.5, validator v4.4, and extension-local generation, but every rollout variable was disabled. Newly tested banks therefore used the legacy v5.1 compatibility profile.
- Ten final banks and all 100 planned questions completed, but only 9/10 first attempts completed. The excluded attempt failed schema validation at 11/15, automatic recovery also failed, and a new quiz was required.
- The defects recorded at that baseline were recovery reliability, incorrect legacy call classification, widespread source-referential prompt wording, and a corrupting display-time prefix transformation. Later source remediations and local regressions must not be mistaken for a completed new official-site matrix.

This snapshot is dated. Recheck `/health`, Wrangler deployment status, the D1 migration ledger, the installed extension, and one newly persisted bank before treating it as current.

## Current web and native generation candidate

Extension `0.8.31` and native app `0.2.0` share the caption-only local engine. The checked-in rollout assigns `stable_non_thinking_v5_2`: result protocol `6`, capability `question-stream-v2`, prompt `quiz-local-json-stream-v5.2`, validator `validator-local-progressive-v4.1`, pipeline `9`, and progressive import `v4`. The first non-thinking DeepSeek call requests only question 1; the client validates and imports it before opening the attempt, then generates the remaining questions in small background batches. A rejected later object preserves the accepted prefix and triggers bounded AI repair of the first missing ordinal. There is no learner retry control or fallback generation.

Automated coverage proves question-1-first admission, exact requested/accepted call accounting, fixed-speed first-question progress, accepted-prefix preservation, later-ordinal repair, mixed question types, option mapping, True/False answers, short-answer rubrics, and an explicit completion-screen PDF download action.

A commit, push, Worker deployment, matching extension installation, authenticated profile check, direct benchmark, and real-client matrices remain distinct evidence. Android additionally requires EAS signing, FCM/App Links configuration, and physical-device acceptance.

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
