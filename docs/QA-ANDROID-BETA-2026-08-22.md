# Android private beta 0.2.0 implementation QA — 2026-08-22

Status: **backward-compatible Worker/app changes are live and the source candidate passes local automated and emulator gates; private APK distribution remains blocked by external release credentials and device acceptance.**

This report records only actions observed on 2026-08-22. It does not claim an EAS build, physical-device acceptance, FCM delivery, verified App Links, or a ten-video Android matrix.

## Candidate identity

| Item                             | Observed value                             |
| -------------------------------- | ------------------------------------------ |
| Git branch during implementation | `main`                                     |
| Starting Git SHA                 | `04f00c6`                                  |
| Deployed source Git SHA          | `02da4dc2b8226242e465b3793acb463c4df63bc1` |
| Production Worker version        | `0002ea3c-6a51-4ad6-84ad-f130f0a13931`     |
| Rollback Worker version          | `f8e3bade-7f34-43cd-8779-a4bf38010ff2`     |
| Android package                  | `cc.ccwu.clipquest`                        |
| App version / code               | `0.2.0` / `2`                              |
| Min / compile / target SDK       | 29 / 36 / 36                               |
| Extension                        | `0.8.18`                                   |
| Stream capability                | `question-stream-v7`                       |
| Shared engine package            | `@clipquest/local-quiz-engine`             |
| Pipeline / current protocol      | 9 / 10                                     |
| Current model                    | `deepseek-v4-flash`                        |

The EAS build ID, release APK checksum, and EAS certificate fingerprints must be appended only after those actions occur. The documentation-only commit that records this rollout is newer than the deployed source SHA and does not change the Worker or app bundle.

## Implemented surface

- Shared pure prompt, plan, parser, validation, shuffle, retry, and serialization engine used by Chrome and Android adapters.
- Android-local DeepSeek SSE transport through Expo fetch and Expo Crypto.
- Account-scoped SecureStore key management with direct credential test and removal on account boundaries.
- Foreground-only generation, bounded outbox, abort-on-background, authoritative-frontier recovery, and accepted-prefix preservation.
- Caption-only Android boundary that stops before DeepSeek when verified subtitles are unavailable.
- Paste and Android Sharesheet handoffs, including cold and warm `ACTION_SEND` handling.
- Native mixed-prose/formula rendering using local KaTeX MathML in a locked-down WebView.
- App Links endpoint and intent filters, pending a real signing certificate.
- Opt-in notification registration/unregistration and correct Expo ticket accounting.
- Android client metadata, server profile requirements, safe admin metadata, and controlled Chrome-to-Android compatible-bank continuation.
- Extension 0.8.18 packaging while retaining Chrome 0.8.17 as the minimum accepted version.

## Automated verification

| Gate                             | Result                                                |
| -------------------------------- | ----------------------------------------------------- |
| Contracts                        | 25/25 passed                                          |
| API Vitest                       | 158/158 passed                                        |
| API release-runner Node tests    | 8/8 passed                                            |
| App Vitest                       | 100/100 passed                                        |
| App asset-verifier Node tests    | 2/2 passed                                            |
| Shared engine                    | 3/3 passed                                            |
| Extension                        | 228/228 passed                                        |
| Playwright Chrome journeys       | 23/23 passed                                          |
| TypeScript                       | Passed                                                |
| ESLint                           | Passed                                                |
| Prettier check                   | Passed                                                |
| Android Metro export             | Passed; 2,178 modules                                 |
| Web production export            | Passed; 32 shells and 470 asset references verified   |
| Worker bundle / Wrangler dry run | Passed                                                |
| Guarded Cloudflare rollout       | Passed; preview, override, and 0/2/5/10-minute probes |

The extension archive, tracked website download, and built website download matched:

`940c5fae068996c6569ccfd5f282b50441a54a57d6c82e285ea5c30ac81d49ba`

The same archive downloaded from `https://clipquest.ccwu.cc/clipquest-captions-extension.zip` after promotion with a size of 566,305 bytes and the same SHA-256.

## Production Worker rollout

The exact pushed source SHA `02da4dc2b8226242e465b3793acb463c4df63bc1` was built from a clean detached worktree and released with the guarded Wrangler version workflow:

1. Built contracts, web assets, and the Worker from the pushed SHA.
2. Uploaded Worker version `0002ea3c-6a51-4ad6-84ad-f130f0a13931` while the previous Worker stayed at 100%.
3. Staged the candidate at 0% and exercised it through the preview URL and production-domain version override.
4. Promoted the verified candidate to 100%.
5. Probed nine representative HTML shells and their nine referenced entry bundles at 0, 2, 5, and 10 minutes; every probe passed.
6. Independently confirmed the active deployment is 100% candidate traffic and `/health` reports the candidate Worker ID and Git tag.

No D1 migration was required or applied; the remote ledger reported no pending migrations. The previous Worker remains the recorded rollback baseline.

## Local APK inspection

A local managed-project Gradle build completed successfully with JDK 17. It is useful only for emulator QA because the generated local project signs `release` with the Android debug certificate.

| Property               | Observed value                                                     |
| ---------------------- | ------------------------------------------------------------------ |
| Path                   | `apps/app/android/app/build/outputs/apk/release/app-release.apk`   |
| Size                   | approximately 138 MB universal APK                                 |
| SHA-256                | `44eb7527a4e669c0953a3e78f2fdce14a13f0c94dd2c673155a764543906e577` |
| ABIs                   | arm64-v8a, armeabi-v7a, x86, x86_64                                |
| Signature verification | APK Signature Scheme v2 passed                                     |
| Signer                 | Android Debug — **not a release identity**                         |
| Removed permissions    | READ/WRITE external storage and SYSTEM_ALERT_WINDOW absent         |

This hash must not be published as the beta APK. An EAS-managed release-signed APK will have a different hash and certificate.

## Emulator observations

- API 29 arm64: standalone install and cold launch passed during the implementation run; no ClipQuest fatal exception was observed.
- API 36 arm64: the final local APK installed and cold-launched `cc.ccwu.clipquest/.MainActivity`; React ran `main`, the process remained resident, and no fatal ClipQuest exception was observed.
- Sharesheet: warm handling on API 29 and cold handling on API 36 resolved to the ClipQuest share route with a validated YouTube URL.

These launch tests validate native packaging and route startup. They do not substitute for authenticated quiz completion on a physical device.

## Open release blockers

1. `eas whoami` reported no authenticated Expo account, and no `EXPO_TOKEN` was available.
2. No real EAS project ID exists in the build environment.
3. No EAS-managed keystore or release signing-certificate fingerprint is available.
4. FCM credentials are not configured, so real push delivery is unverified.
5. `/.well-known/assetlinks.json` returns HTTP 503 with an empty array until the release fingerprint is configured, preventing unverified App Link claims.
6. No physical Android device was connected for SecureStore, notification, performance, and real Sharesheet acceptance.
7. The complete Android 5/10/15 and ten-video generation matrix has not run.

## Release decision

The backward-compatible Worker/app release is live and passed the guarded production checks. The Android APK is **not yet suitable for tester distribution**. Distribution is allowed only after Expo authentication/project creation, EAS release signing, physical-device QA, App Links/FCM configuration, and the complete real-video matrix pass.
