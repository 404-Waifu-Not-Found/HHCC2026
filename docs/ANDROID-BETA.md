# ClipQuest Android private beta

This guide covers the native Android 0.2.0 beta. It is an Expo/React Native application, not a WebView wrapper. Android generates quizzes inside the app with the learner's own DeepSeek key; the Cloudflare Worker remains the authenticated storage, grading, status, and privacy-safe telemetry boundary.

## Supported beta boundary

| Setting                    | Value                                                    |
| -------------------------- | -------------------------------------------------------- |
| Package                    | `cc.ccwu.clipquest`                                      |
| App version / version code | `0.2.0` / `2`                                            |
| Minimum Android            | API 29 / Android 10                                      |
| Compile and target SDK     | API 36                                                   |
| Orientation                | Portrait                                                 |
| Distribution               | EAS internal, release-signed APK                         |
| Updates                    | Disabled; install a new signed APK for every release     |
| Generation                 | Foreground-only, resumable, app-local DeepSeek streaming |
| Source support             | Public YouTube videos with usable text captions          |

Captionless videos are deliberately unsupported in this beta. Android never invokes Whisper, downloads YouTube audio/video, or calls `/api/media/resolve`. If no verified caption source is available, generation stops before the first DeepSeek request.

## Local AI and privacy

Open **Settings → Local AI** after signing in. The app tests the key directly against DeepSeek before saving it. The key is stored under a user-specific name in Expo SecureStore using Android Keystore-backed encryption and `WHEN_UNLOCKED_THIS_DEVICE_ONLY` accessibility.

The key is removed after a successful sign-out, account deletion, or observed account change. It is never written to AsyncStorage, app configuration, logs, URLs, ClipQuest API requests, D1, crash evidence, or build artifacts. Caption text, prompt instructions, evidence windows, and raw model responses also remain inside the app-to-DeepSeek connection. The Worker receives only validated questions, authenticated answer traffic, bounded source aggregates, and safe generation events.

## Generation behavior

The Android and Chrome clients use `@clipquest/local-quiz-engine` for the same prompt construction, question planning, SSE parser, structural validation, option mapping, retries, and result serialization. `/api/local-ai/profile` remains authoritative for the prompt/profile assigned to a new bank.

Android reports:

- client kind `android_app`;
- semantic app version `0.2.0` or newer;
- capability `question-stream-v7`.

Question 1 is uploaded and opened immediately. Later questions append in order. Accepted questions are never regenerated, and a 5-, 10-, or 15-question bank cannot score until its full planned length exists. There is no learner-facing continuation button.

When Android backgrounds, the active DeepSeek request is aborted without making the bank terminal. Validated but unuploaded questions and safe call events stay in a bounded local outbox. On foreground return, route mount, or network restoration, the app reads the authoritative frontier, flushes the outbox idempotently, reacquires the lease, and resumes from the first missing ordinal.

## Paste, Sharesheet, and App Links

The normal YouTube URL field remains available. The Android config plugin also registers `ACTION_SEND` for `text/plain`; sharing a supported YouTube watch/short URL to ClipQuest creates the same expiring, account-safe pending-video handoff used by paste import. Cold and warm intents normalize to `clipquest://share?url=...`, and a handoff is consumed exactly once.

Verified HTTPS App Links cover password reset, email verification, Library, and quiz attempts. `/.well-known/assetlinks.json` intentionally returns an empty 503 response until `ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINT` contains the final EAS signing certificate's uppercase colon-separated SHA-256 fingerprint. Do not publish a local debug fingerprint.

iOS uses the same HTTPS reset and verification routes through Associated Domains. `/.well-known/apple-app-site-association` remains unavailable until `IOS_APP_LINKS_TEAM_ID` contains the Apple Developer Team ID used to sign `cc.ccwu.clipquest`. Password-reset emails always use the HTTPS origin; the app rejects custom-scheme password-reset links so an unrelated app cannot claim a security-sensitive callback.

Caption, generation recovery, and per-video quiz preferences are account-scoped. Ambiguous pre-upgrade caches, preferences, and outboxes are deleted rather than migrated. Sign-out, account deletion, or an authenticated-user change first cancels in-flight caption preparation, then clears only that account's current private state plus unowned legacy records so late work cannot restore a departing account's transcript cache.

The caption-only Android beta never downloads video audio. The dormant native transcription implementation retained for iOS/future work nevertheless enforces the same 180 MiB hard media ceiling as the web path, cancels an oversized transfer, verifies the completed file size, and deletes partial files before decoding.

## Mathematics and notifications

Native quiz prose and formulas render through locally bundled KaTeX MathML in a locked-down, noninteractive, auto-height WebView. Model text is escaped; remote scripts, remote navigation, file access, universal access, DOM storage, and mixed content are disabled. Accessibility receives the original plain expression.

Review notifications are opt-in. Android requests notification permission only after the learner enables reminders. The app registers an Expo token for the authenticated user and unregisters it before sign-out or account deletion. The Worker marks a review notified only for an Expo `ok` ticket and deletes `DeviceNotRegistered` tokens.

Push delivery requires a real EAS project ID and Android FCM credentials. Those values are external release credentials and are never committed.

## Reproducible local build

The repository uses Expo Continuous Native Generation. EAS excludes `android/` and `ios/` through `apps/app/.easignore` and runs the same config plugins from source.

Local prerequisites:

- Node.js 22 and npm 10;
- JDK 17;
- Android SDK platforms 29 and 36;
- Android build tools 36.0.0, platform tools, emulator, CMake, and NDK 27.1;
- an untracked `apps/app/android/local.properties` containing the local SDK path.

From `apps/app`:

```bash
npx expo prebuild --platform android --clean
npx expo export --platform android --clear
```

Then use JDK 17 from `apps/app/android`. Set `JAVA_HOME` explicitly when the
machine's default Java is newer; the current Android Gradle, CMake, and SDK
toolchain is not supported on JDK 25:

```bash
JAVA_HOME=/path/to/jdk-17 ./gradlew generateCodegenArtifactsFromSchema :app:assembleRelease
```

This local Gradle artifact is only a device-test build unless a real release signing configuration is supplied. The authoritative beta is the EAS-managed APK.

## EAS private APK release

The Expo account must own a real project, and `EXPO_PUBLIC_EAS_PROJECT_ID` must be supplied to the internal profile. From `apps/app`:

```bash
npx eas-cli whoami
npx eas-cli init
npx eas-cli build --platform android --profile internal
```

The `internal` profile uses the production API origin, remote EAS credentials, no development client, and APK output. After the first build:

1. Back up the EAS-managed Android keystore through the Expo credential workflow; never commit it.
2. Record the EAS build ID, Git SHA, APK SHA-256, size, certificate SHA-256/SHA-1, ABIs, min/target SDKs, and Worker version.
3. Configure the certificate fingerprint in Cloudflare and verify Android App Links.
4. Configure FCM, enable reminders on a physical device, and verify one delivered notification and tap route.
5. Keep the internal download restricted to authenticated beta testers.

## Required device acceptance

Before distributing a candidate, complete the automated suite plus:

- API 29 emulator cold install and launch;
- API 36 emulator cold install, launch, and App Link behavior;
- an Android 13+ arm64 physical device for SecureStore, notifications, Sharesheet, foreground/background recovery, keyboard/safe-area behavior, and performance;
- paste and Sharesheet imports;
- fresh 5-, 10-, and 15-question banks across all question types;
- ten varied public captioned educational videos, including CJK, formula-heavy, short, and long sources;
- deliberate background, connectivity, retry, reload, and wrong-formula cases;
- Library, review, mastery, administration, deep-link, reminder, and account-deletion flows;
- network inspection proving the key, captions, prompt, and model response never reach ClipQuest.

Do not call the beta distribution-ready when the EAS project/signing identity, physical-device matrix, FCM delivery, App Links, or ten-video completion matrix is still unverified.

## Platform references

- [Expo streaming fetch](https://docs.expo.dev/versions/latest/sdk/expo/)
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/)
- [Expo monorepo builds](https://docs.expo.dev/build-reference/build-with-monorepos/)
- [Expo `.easignore`](https://docs.expo.dev/build-reference/easignore/)
- [Android Sharesheet receiving](https://developer.android.com/training/sharing/receive)
- [Android App Links association](https://developer.android.com/training/app-links/verify-android-applinks)
