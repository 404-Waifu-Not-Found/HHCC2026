# ClipQuest production release

ClipQuest deploys its Cloudflare Worker and content-hashed static assets as one version. Production releases use a guarded version upload, version-override smoke test, and atomic promotion. Do not replace this workflow with a direct one-step `wrangler deploy`.

## Last verified production baseline

Verified on 2026-08-22:

| Item                        | Production value                                                        |
| --------------------------- | ----------------------------------------------------------------------- |
| Worker version              | `8350cd9a-e7ba-4b7e-883e-cd85796b8895`                                  |
| Worker tag / Git SHA        | `5d4a9e4146a4968c786439a92ad4b86c98a9332a`                              |
| Extension source artifact   | `0.8.19`; Chrome 0.8.17 remains the minimum accepted version            |
| Current generation metadata | prompt v5.12, validator v5.3, protocol 10, pipeline 9                   |
| Generation rollout          | v5.12 disabled; v5.11 effective default                                 |
| Native client metadata      | Android and iOS 0.2.0 with `question-stream-v7`, foreground-only        |
| D1 migration                | `0020_generation_call_lifecycle.sql`                                    |
| Remaining release gate      | immutable v5.12 canary plus complete Chrome/native real-client matrices |

The public Cloudflare edge reports the exact SHA, version affinity, supported prompt metadata, and storage-only architecture. This baseline is deployment evidence only: it does not enable v5.12 or clear the official-site and physical-device matrices.

### Historical 2026-08-22 baseline

Worker `c1ceecc8-4e6e-4b9a-bdea-49f48031fae2` from Git `297747e` served the 0.8.8/v5.8 canary configuration. Its official-site Chrome matrix was halted rather than bypassing `NET::ERR_CERT_COMMON_NAME_INVALID`. See the [dated 0.8.8 canary report](../qa-results/concept-first-extension-0.8.8-canary-blocked-2026-08-22.md).

### Historical 2026-08-22 baseline

Verified on 2026-08-22:

| Item                                       | Production value                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| Origin                                     | `https://clipquest.ccwu.cc`                                                  |
| Worker version                             | `a8d8cda5-ea66-4e87-afae-388b2cf237dd`                                       |
| Worker tag / Git SHA                       | `9c1bc3b75929819cc18f1a7bb4a50b7cd954dc03`                                   |
| D1 migration                               | `0019_grounded_generation_telemetry.sql`                                     |
| Extension observed in Chrome               | `0.8.5`                                                                      |
| Health architecture                        | extension-local; backend generation disabled; extension enabled and required |
| Deployed supported metadata                | model `deepseek-v4-flash`, pipeline 9, prompt v5.5, validator v4.4           |
| Generation rollout                         | disabled                                                                     |
| Profile actually persisted by new QA banks | `legacy_reasoning_v5_1`, prompt v5.1                                         |

The current [ten-video production report](../qa-results/live-production-quiz-generation-10-runs-extension-0.8.5-2026-08-22.md) completed ten final banks and all 100 planned learner questions, but only 9/10 first attempts completed. It also found legacy source-referential prompts, display-time prompt corruption, and an automatic recovery recorded as `manual_continuation`. This baseline is deployed, but the evidence-grounded rollout is **not cleared for enablement**.

This table is a dated observation, not a substitute for checking the live service before the next release.

## Current web and native source candidate

The assigned new-bank contract uses extension `0.8.31`, result protocol `6`, capability `question-stream-v2`, pipeline `9`, prompt `quiz-local-json-stream-v5.2`, validator `validator-local-progressive-v4.1`, progressive import `v4`, and generation profile `stable_non_thinking_v5_2`. Android and iOS 0.2.0 consume the same local engine and report native client metadata; web reports `chrome_extension`.

The checked-in rollout enables v5.2 and disables v5.3, v5.4, and v5.9-v5.12. `/health` reports supported metadata and the effective default separately; `/api/local-ai/profile` is authoritative for a learner. A fresh bank makes one non-thinking DeepSeek request for the exact 5/10/15 count, buffers and validates the complete JSON response, uploads only after validation, and opens the attempt only when the bank is ready. It performs no generation retry and creates no fallback content. Existing completed banks preserve their original prompt, validator, telemetry, and client-integrity metadata.

The same release adds backward-compatible Android client metadata, push-token unregister behavior, safe Android generation status, and a certificate-gated App Links endpoint. No D1 migration is required. Worker deployment, extension installation, EAS signing, physical-device acceptance, and real-video matrices remain separate release actions.

Quest sharing adds D1 migration `0027_quiz_shares.sql` (two additive tables: `quiz_shares`, `quiz_share_claims`). Apply it with `npm run db:migrate:remote` **before** promoting the Worker version that mounts `/api/shares`; a Worker rollback leaves the tables unused and is safe. The public preview endpoint is rate limited per IP and exposes no question text.

## One-time Cloudflare version affinity

Create a zone-level Request Header Transform Rule for `clipquest.ccwu.cc` in the `http_request_late_transform` phase:

- Expression: `http.host eq "clipquest.ccwu.cc"`
- Operation: set dynamic request header
- Header: `Cloudflare-Workers-Version-Key`
- Value: `ip.src`

The release runner verifies this rule through `/health` while the candidate Worker is at 0% and aborts with rollback if the header is absent. Version affinity prevents an HTML shell from one Worker version from requesting a content-hashed asset available only in another version.

References:

- [Cloudflare version affinity](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/)
- [Cloudflare version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/)
- [Cloudflare versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Cloudflare rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

## Release prerequisites

- The exact branch HEAD is committed and pushed upstream.
- The worktree is clean so source, version tag, app assets, Worker code, and extension ZIP refer to one immutable revision.
- Every migration has a backward-compatible rollout plan. A Worker rollback does not roll back D1.
- The compatible unpacked extension has been built and its exact version has passed Chrome acceptance.
- For an Android beta, the Expo account/project, EAS-managed keystore, FCM credentials, release certificate, authenticated internal distribution, and physical-device acceptance must also be available.
- The target generation rollout mode is deliberate. Enabling a profile is a separate product gate from merely deploying code that supports it.
- No API key, transcript, DeepSeek body, raw prompt, answer export, or QA credential is present in release evidence.

Before deploying:

```bash
git status --short
git rev-parse HEAD
git rev-parse @{upstream}
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run cf:types
npm run cf:dry-run
```

Apply and verify migrations before the candidate promotion:

```bash
npm run db:migrate:remote
cd apps/api
npx wrangler d1 execute DB --remote --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 5"
cd ../..
```

Resolve exact migration targets and inspect the ledger before any production write. Do not report a local migration as proof that remote D1 is current.

## Guarded release

From the workspace root:

```bash
npm run cf:deploy
```

The runner uses the workspace-pinned Wrangler through `npx` and performs these gates in order:

1. Build contracts, the extension ZIP, the web app, and the Worker.
2. Recursively verify that every generated HTML shell references files present in the final asset directory.
3. Run `npx wrangler deploy --dry-run`.
4. Record the single version currently receiving 100% of production traffic.
5. Upload the pushed Git SHA with `npx wrangler versions upload` and smoke-test its preview URL with the same bounded propagation retry used for version overrides. A newly allocated `workers.dev` hostname can briefly time out before Cloudflare begins accepting connections; production remains untouched until this probe passes.
6. Create a deployment with the old version at 100% and the candidate at 0%.
7. Probe every production shell and entry asset with `Cloudflare-Workers-Version-Overrides` on every request, while verifying the version-affinity transform rule.
8. Promote the verified candidate directly to 100%.
9. Repeat shell and bundle probes at 0, 2, 5, and 10 minutes.

Any failure after the 0% deployment automatically runs `npx wrangler rollback <previous-version-id>`. Evidence is retained under the ignored `apps/api/.wrangler/release-evidence/` directory. Preserve that evidence when diagnosing a failed release.

The matching extension artifacts are:

- `apps/extension/dist/clipquest-captions-extension/`
- `apps/extension/dist/clipquest-captions-extension.zip`

## Post-promotion verification

Verify the deployed version and architecture:

```bash
curl -fsS https://clipquest.ccwu.cc/health
cd apps/api
npx wrangler deployments status
```

Require the health response to identify the promoted Worker version and report:

- maintenance disabled;
- pipeline 9;
- backend quiz generation disabled;
- extension quiz generation enabled and required;
- Android in-app generation enabled, foreground-only, and requiring Android 0.2.0 plus `question-stream-v7`;
- expected model, current prompt, validator, and rollout mode;
- the expected newest applied D1 migration.

Probe `/`, `/library`, `/settings`, `/admin`, `/admin/jobs`, `/admin/system`, and representative dynamic quiz routes. Parse each HTML shell, request every same-origin script/module preload/stylesheet/font/image reference, and require the expected content type and a successful response.

Health metadata alone is insufficient for a generation-profile release. Create a disposable quiz through the real Chrome extension, then verify its stored `generationProfile`, `promptVersion`, `validatorVersion`, `protocolVersion`, and planned count. `/health` describes the deployed code's current capability; rollout flags can still assign a compatibility profile to a newly created bank.

## Android private-beta release

The Worker/app rollout may proceed before the private APK because the API additions are backward compatible. APK distribution is a separate gate:

1. Run the guarded Cloudflare release first and record the exact active Worker version.
2. Create/authenticate the EAS project from `apps/app`, supply the real project ID, and configure FCM.
3. Run `npx eas-cli build --platform android --profile internal` from `apps/app` at the exact pushed Git SHA.
4. Verify the APK is release-signed, version 0.2.0/code 2, min API 29, target API 36, and contains no key, transcript fixture, environment secret, or signing material.
5. Back up the EAS-managed keystore securely and configure its SHA-256 certificate fingerprint as `ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINT`.
6. Configure `IOS_APP_LINKS_TEAM_ID` from the production Apple signing identity and verify both `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` before treating HTTPS authentication links as native-ready.
7. Verify notification delivery/tap routing, install and upgrade behavior, and the full API 29/API 36/physical-device matrix.
8. Run and complete the ten-video Android matrix before sharing the restricted APK URL.

Do not distribute a locally debug-signed Gradle artifact. See [Android private beta](./ANDROID-BETA.md) and the [current dated QA report](./QA-ANDROID-BETA-2026-08-22.md).

## Generation rollout gate

Do not treat extension installation, a successful local test, or `/health` alone as proof that progressive generation works for real learners. Before declaring the v5.2 assignment accepted:

1. Deploy one immutable pushed Worker/app candidate, install its matching extension-0.8.31 ZIP, and record the exact Worker version, Git SHA, and extension checksum.
2. Verify that authenticated `/api/local-ai/profile` assigns `stable_non_thinking_v5_2` with extension minimum 0.8.31.
3. Run complete 5/10/15 banks across every question-type combination, English/CJK, short/long captions, formulas, and manual/automatic caption tracks.
4. Require question 1 to validate, persist, and navigate before suffix generation completes. Verify ordered requested/accepted call accounting, accepted-prefix preservation through an injected later-question failure, automatic missing-ordinal repair, full-length completion, and no fallback content.
5. Run the immutable artifact across ten different real YouTube videos and answer every planned learner question on the original bank; do not replace a failed bank and count the replacement as success.
6. Audit question grounding, true/false polarity, answer-to-prompt consistency, duplicate objectives, fragmentary answers, unsupported absolute wording, and soft short-answer grading.
7. Confirm the page bridge, native API traffic, and Worker requests contain no API key, captions, transcript, generation instructions, or raw DeepSeek response.

If a gate fails, disable `QUIZ_V5_2_ROLLOUT` or replace the candidate; do not add generated fallback questions or expose a learner-facing continuation action. Retain privacy-safe call-event evidence for diagnosis.

## Reporting rules

Report these states separately:

- local source and test status;
- commit and pushed SHA;
- remote migration state;
- uploaded Worker version;
- production traffic allocation;
- installed/reloaded extension version;
- profile actually persisted by a fresh bank;
- completed real-browser learner acceptance.

A green test, generated ZIP, successful upload, browser toast, or healthy `/health` response proves only its own layer. None of those observations alone proves the full learner journey or the enabled generation profile.
