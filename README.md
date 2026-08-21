<a id="top"></a>

<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./apps/app/assets/brand/clipquest-lockup-on-dark.png" />
    <img src="./apps/app/assets/brand/clipquest-lockup-on-light.png" alt="ClipQuest" width="620" />
  </picture>
</h1>

<p align="center"><strong>Turn YouTube lessons into real mastery.</strong></p>

<p align="center">
  <strong>Paste a public YouTube lesson, build an evidence-based quiz in your browser, and learn through immediate feedback.</strong>
</p>

<p align="center">
  <a href="https://clipquest.ccwu.cc"><strong>Open ClipQuest →</strong></a>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=20232A" />
  <img alt="React 19" src="https://img.shields.io/badge/React_19-149ECA?style=for-the-badge&logo=react&logoColor=white" />
  <img alt="Swift" src="https://img.shields.io/badge/Swift-F05138?style=for-the-badge&logo=swift&logoColor=white" />
  <img alt="Kotlin" src="https://img.shields.io/badge/Kotlin-7F52FF?style=for-the-badge&logo=kotlin&logoColor=white" />
  <img alt="SQL" src="https://img.shields.io/badge/SQL-336791?style=for-the-badge&logoColor=white" />
  <img alt="HTML" src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" />
  <img alt="CSS" src="https://img.shields.io/badge/CSS-663399?style=for-the-badge&logo=css&logoColor=white" />
  <img alt="Groovy" src="https://img.shields.io/badge/Groovy-4298B8?style=for-the-badge&logo=apachegroovy&logoColor=white" />
  <img alt="Ruby" src="https://img.shields.io/badge/Ruby-CC342D?style=for-the-badge&logo=ruby&logoColor=white" />
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" />
</p>

<p align="center">
  <a href="#overview">Overview</a> ·
  <a href="#release-status">Release status</a> ·
  <a href="#visual-system">Visual system</a> ·
  <a href="#journey">Learning journey</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#tech-stack">Tech stack</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#verification">Verification</a> ·
  <a href="#deploy">Deploy</a> ·
  <a href="#privacy">Privacy</a>
</p>

<p align="center">
  <strong>Project guides:</strong>
  <a href="./docs/README.md">Documentation index</a> ·
  <a href="./docs/PRODUCTION-RELEASE.md">Production release</a> ·
  <a href="./docs/ADMIN-CONSOLE.md">Operations console</a> ·
  <a href="./qa-results/live-production-quiz-generation-10-runs-extension-0.8.5-2026-08-11.md">Current live QA</a> ·
  <a href="./qa-results/run-8-recovery-extension-0.8.6-implementation-2026-08-11.md">0.8.6 implementation evidence</a> ·
  <a href="./qa-results/concept-first-extension-0.8.7-implementation-2026-08-11.md">0.8.7 concept-first evidence</a> ·
  <a href="./docs/duolingo-ui-research.md">UI research</a>
</p>

---

<a id="overview"></a>

## 🧭 Product overview

ClipQuest turns public YouTube educational videos into focused learning sessions. A learner pastes a YouTube link, chooses multiple-choice, true/false, and/or short-answer questions, confirms the lesson, and starts a generated quest.

On the web, the **ClipQuest Local AI** Chrome extension is the generation boundary. It acquires YouTube captions in the browser, converts timestamped segments into normalized plain text, and sends that text directly to DeepSeek using the learner's own API key. DeepSeek returns streamed JSON in profile-sized sequential calls: the current evidence-grounded profile uses one question per primary call, while isolated compatibility profiles can request small consecutive chunks. As each complete question object closes, the extension validates its expected ordinal, requested type, fields, answer mapping, and duplicate invariants before emitting it to the ClipQuest page.

The Cloudflare Worker does **not** generate quizzes. It authenticates the learner and stores validated singleton questions in strict ordinal order. Question 1 creates a generating bank and a full-length attempt immediately; later questions append while the learner is already answering. The bank becomes passed, reviewable, and Library-eligible only after all 5, 10, or 15 requested questions have been stored.

```text
public YouTube URL
       │
       ▼
ClipQuest page ───── authenticated metadata ────► Cloudflare Worker
       │
       │ extension bridge (no API key)
       ▼
ClipQuest Local AI extension
       │
       ├─► YouTube captions → timestamp-free plain text
       │
       └─► DeepSeek V4 Flash → streamed JSON, sequential profile-sized calls
                              │
                              ▼
                validate each closed question object
                              │
                              ▼
ClipQuest page ───── ordered singleton questions ─────► storage-only append
                                                        │
                         question 1 ─► full-length attempt opens
                         questions 2…N append in background
                                                        │
                                                        ▼
                                      lesson → feedback → mastery
```

> [!IMPORTANT]
> Google or YouTube account access is not required. The web experience requires the unpacked Chrome extension; Android runs the same local quiz engine inside the native app. Both use a learner-supplied DeepSeek API key. The Android 0.2.0 beta accepts only public YouTube videos with usable text captions and never downloads media or invokes Whisper. Unsupported sources fail explicitly; ClipQuest does not manufacture fallback questions.

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="release-status"></a>

## 🚦 Current release status

As of **2026-08-16**, this source tree adds the native Android private-beta client while preserving the current prompt-first web-generation contracts. Android 0.2.0 and Chrome extension 0.8.18 consume one shared local quiz engine. This is source and local-emulator evidence, not proof of an EAS-signed private APK or completed physical-device acceptance. The live `/health` response and Wrangler deployment history remain authoritative for [clipquest.ccwu.cc](https://clipquest.ccwu.cc).

- Android uses package `cc.ccwu.clipquest`, version `0.2.0` / code `2`, minimum API 29, and compile/target API 36. The internal EAS profile produces an APK with Expo Updates disabled.
- Chrome and Android share prompt construction, question planning, streamed DeepSeek parsing, structural validation, option mapping, retry policy, and serialization through `@clipquest/local-quiz-engine`.
- Android reports `android_app` client metadata with capability `question-stream-v7`; Chrome 0.8.18 reports `chrome_extension`, while 0.8.17 remains the minimum accepted Chrome version because the generation protocol is unchanged.
- Android stores a successfully tested DeepSeek key in user-scoped SecureStore, generates only in the foreground, checkpoints validated uploads/events, and automatically resumes the same bank from the authoritative missing ordinal.
- Android accepts pasted and Sharesheet YouTube links, requires usable captions, performs no media-resolution or native transcription call, renders math with local KaTeX MathML, and supports opt-in review notifications.
- The 2026-08-16 local gate passed contracts, API, app, shared-engine, extension, Playwright, TypeScript, lint, formatting, Android Metro export, web build, asset verification, Worker dry run, and API 29/API 36 emulator launches. EAS authentication/project/signing, FCM, verified App Links, physical-device acceptance, and the ten-video Android matrix remain open release blockers. See the [Android guide](./docs/ANDROID-BETA.md) and [dated QA report](./docs/QA-ANDROID-BETA-2026-08-16.md).

- The current supported prompt-first contract is result protocol `10`, capability `question-stream-v7`, pipeline `9`, prompt `quiz-local-json-stream-v5.12`, validator `validator-minimal-gradeability-v5.3`, progressive import `v8`, and profile `prompt_first_auto_v5_12` when that rollout is assigned.
- The checked-in rollout configuration keeps v5.12 disabled and v5.11 enabled by default. `/api/local-ai/profile` is authoritative for each authenticated learner; an advertised supported version is not proof that a new bank received it.
- Extension `0.8.18` and Android `0.2.0` share the current engine. Chrome `0.8.17` remains accepted, and incomplete protocol-5 through protocol-10 banks retain their original prompt, validator, profile, model, and client-integrity rules.
- Backend quiz generation is disabled. Web generation requires the Chrome extension; Android generation runs inside the native app.
- No Worker generation Queue binding and no generated-question fallback path.
- Every planned question uses one sequential singleton primary call. Accepted prefixes are never regenerated, and a recovery begins at the first authoritative missing ordinal.
- The v5.9 path has no editorial repair mode and no learner continuation control. A structurally gradeable singleton is accepted immediately. Only transport/service failures and unusable wire or grading structures can trigger automatic retries: up to four transport retries or two structural retries per ordinal, bounded by the bank-wide recovery ceiling. Credential and billing failures require configuration instead of blind retries.
- Current prompt-first generation receives one preselected answer-bearing instructional window, one exact type-specific schema, and accepted question/concept summaries. Runtime validation is limited to storage and grading integrity; editorial quality is audited in tests and release QA rather than through model retry loops. Existing banks retain their original validators and recovery semantics.
- Prose short answers use one to three independent required ideas and three to six complete full-credit variants. The deterministic Worker grader preserves its 67% alternative threshold while normalizing pronouns, safe acronyms, and conservative signal-transfer/processing aliases; formula answers retain structural grading.
- Question 1 opens the planned 5-, 10-, or 15-question attempt while later questions continue uploading in order.
- Mixed multiple-choice, true/false, and short-answer plans are seeded, balanced, and bounded to avoid runs longer than two where the selection permits it.
- D1 stores the validated learner-visible questions plus privacy-safe call events and short recovery-claim leases. Call telemetry and claims never store generation instructions, captions, raw model output, credentials, or DeepSeek errors.
- Multiple-choice options are securely shuffled before import and shuffled again for each activated learner view; True/False remains True then False.
- Original green-led light and dark themes now cover learner, authentication, quiz, administration, extension, PWA, and native identity surfaces.
- A statically bundled voxel icon registry and abstract learning-prism mark replace stock glyphs and the retired human-like mascot.
- Signed-out traffic enters through `/sign-in`; account-free product exploration remains available from the sign-up screen through `/welcome`.

The live `/health` response and Wrangler deployment history are the authoritative production checks. Health exposes the model and pipeline versions plus `backendQuizGeneration`, `extensionQuizGeneration`, and `extensionRequired` readiness flags without exposing secrets or relying on a stale version number in this document.

### Verified production snapshot — 2026-08-11

- Active Worker version: `a8d8cda5-ea66-4e87-afae-388b2cf237dd`, tagged from Git SHA `9c1bc3b75929819cc18f1a7bb4a50b7cd954dc03`.
- Latest applied D1 migration: `0019_grounded_generation_telemetry.sql`.
- Chrome exposed ClipQuest Local AI `0.8.5`; `/health` advertised pipeline `9`, prompt v5.5, validator v4.4, extension-local generation, and no backend generator.
- All generation rollout variables were disabled. The ten newly created banks therefore persisted `legacy_reasoning_v5_1` and prompt v5.1 despite the current metadata advertised by `/health`.
- Ten different videos ultimately produced ten complete banks; all 100 planned questions were answered through the visible learner flow. The completed banks used 53 planned model calls with zero recorded retries or non-complete outcomes.
- First-attempt completion was only 9/10. One excluded 15-question attempt stopped at 11/15 after two schema-invalid calls; its automatic recovery was incorrectly recorded as a legacy `manual_continuation`, and a fresh quiz was required.
- Content acceptance failed: 26/100 stored prompts used the exact phrase “According to the lesson,” 79/100 included “According to,” and a display-time prefix sanitizer visibly corrupted at least five prompts.

The production matrix therefore verifies progressive entry, full-length completion after restart, storage-only privacy, and authoritative call accounting, but it **does not clear the evidence-grounded rollout or zero-intervention release gate**. See the [full extension-0.8.5 production report](./qa-results/live-production-quiz-generation-10-runs-extension-0.8.5-2026-08-11.md).

The 2026-08-09 source gate passed **138 unit, contract, API, app, and extension tests** plus **21 Playwright Chrome journeys**, repository-wide TypeScript and ESLint checks, the Expo static export, extension packaging, Worker bundling, and a Wrangler dry run. This is historical automated evidence, not a substitute for the current production matrix.

The source-level 0.8.6 remediation now reproduces the Run 8 history, reclaims the same 11/15 bank, requests q12-q13 as singleton `automatic_retry` calls, requests unseen q14-q15 as `primary`, rejects new `manual_continuation` inserts after exact historical replay handling, and reaches 15/15 without replacing q1-q11. It also replaces the corrupting presentation transformation and enforces raw concept-only validation. This is local automated evidence—not a production rollout or benchmark result. See the [0.8.6 implementation report](./qa-results/run-8-recovery-extension-0.8.6-implementation-2026-08-11.md).

The historical 0.8.7 candidate added the concept-first private-evidence prompt, strict instructional excerpt selection, precise repair outcomes, minimal rubric validation, and the sensory-neuron grading regression fix. Its focused automated tests and repository typechecks were source evidence only; see the [0.8.7 implementation report](./qa-results/concept-first-extension-0.8.7-implementation-2026-08-11.md).

Before enabling the current prompt-first v5.12 profile, deploy one immutable extension-0.8.18 candidate with `QUIZ_V5_12_ROLLOUT` disabled, install its matching ZIP, complete the recorded and direct benchmarks, assign the `unoxyrich` canary, and rerun the ten-video matrix against the v5.12 profile. Separate remaining acceptance still includes captionless local transcription on supported web hardware, Resend and push delivery, EAS-signed native builds, App Links, and physical-device verification.

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="visual-system"></a>

## 🎨 Original visual system

ClipQuest's interface takes product-craft cues from polished learning software—focused tasks, visible progress, large controls, tactile depth, immediate feedback, and generous whitespace—while using independently authored colors, geometry, components, and artwork. The [design research and adaptation boundary](./docs/duolingo-ui-research.md) explicitly excludes Duolingo assets, Feather Green, characters, proprietary fonts, sounds, copy, and traced illustrations.

| System element    | ClipQuest implementation                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Brand anchor      | Structural green `#247D49` with action green `#54C878`; neither reproduces Duolingo's palette                                 |
| Themes            | Equally supported light and deep-green dark themes with semantic blue, warning, and error roles                               |
| Brand object      | A non-anthropomorphic learning prism made from an interlocking video frame, quiz card, knowledge marker, and companion block  |
| Primary lockup    | The learning prism paired with a custom-cased Fredoka `ClipQuest` wordmark; constrained launcher icons retain the prism alone |
| Iconography       | Individually generated, transparent, low-density isometric voxel PNGs resolved through a typed static registry                |
| Typography        | Fredoka for short display copy and DM Sans for body/interface copy, with existing language fallbacks unchanged                |
| Interaction       | 44 px minimum touch targets, 16–24 px radii, visible keyboard focus, semantic feedback, and reduced-motion support            |
| Platform identity | Deterministic derivatives for favicon, PWA, browser extension, iOS, Android, and splash artwork                               |

The learning prism has no face, body, limbs, clothing, pose, mood, or character reactions. Processing, success, and error states are communicated by status copy, semantic panels, and progress—not mascot behavior.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./apps/app/assets/brand/clipquest-lockup-on-dark.png" />
    <img src="./apps/app/assets/brand/clipquest-lockup-on-light.png" alt="ClipQuest learning-prism wordmark" width="520" />
  </picture>
</p>

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="journey"></a>

## 🗺️ Learning journey

### 1. Install Local AI once

ClipQuest detects the extension before allowing the web flow to continue. If it is missing, the site downloads `clipquest-captions-extension.zip` and shows the three unpacked-extension installation steps. The extension popup stores the learner's DeepSeek key in `chrome.storage.local` and can test or remove it at any time.

### 2. Paste and preview

The YouTube URL field is the primary action on desktop, tablet, and mobile. The extension also embeds an **Open in ClipQuest** action beside YouTube's watch-page controls; it opens ClipQuest with that video's normalized URL already filled in. ClipQuest validates official YouTube hosts and common URL forms, then presents the available title, channel, duration, language, and thumbnail before generation begins.

### 3. Acquire captions as plain text

For YouTube, the extension reads the current public caption or transcript data, keeps the complete ordered segment set, removes timestamps, joins rolling auto-caption fragments, and produces clean plain text. The toolbar popup is intentionally limited to DeepSeek key configuration; caption acquisition and quiz generation begin from ClipQuest. If accepted captions are unavailable, the existing browser-side WebGPU/WASM Whisper path can transcribe transient audio locally; incomplete or low-substance results fail instead of being silently shortened.

### 4. Stream validated questions locally

For an evidence-grounded automatic-recovery bank, the site sends the verified in-memory quiz context to extension `0.8.7` through result protocol `8`. The extension sends the complete plain text directly to DeepSeek V4 Flash with thinking disabled, temperature `0.2`, `stream: true`, JSON-object response mode, and a 4,096-token singleton output limit. Its SSE parser tolerates UTF-8 and CRLF boundaries, keep-alive comments, usage-only chunks, escaped braces and quotes, truncation, and `[DONE]`. The transcript and stable instructions remain a byte-identical private-reference prefix while only the current slot, eligible instructional evidence, accepted claim summaries, and repair guidance change. The v5.7 validator permits only self-contained questions about taught concepts, rejects raw source framing and low-value logistics before normalization, and validates compact non-overlapping prose rubrics. Profile selection is server-owned: when the evidence-grounded rollout is disabled, the Worker can assign an isolated v5.3, v5.2, or v5.1 compatibility profile according to its configured rollout chain. The verified 2026-08-11 production matrix selected v5.1, so it did not exercise these v5.7 content guarantees.

Each complete object from the `questions` array must match the seeded type plan, quote an exact instructional evidence excerpt, carry a normalized claim, contain valid type-specific grading fields, and remain unique against every previously accepted semantic claim. The extension assigns the expected global ID, constructs True/False truth values and multiple-choice answer mappings, rejects equivalent choices, and serializes bounded formula tokens locally. A bounded normalizer handles only benign representation differences before strict validation. Recoverable content and transport failures retry only the missing singleton within explicit ordinal, cycle, session, time, and cost budgets.

### 5. Import, answer, and save

The page sends each validated question—not the transcript, raw DeepSeek response, or learner's key—to the authenticated progressive import endpoints. The first singleton creates a pipeline-9 generating bank and an attempt whose `item_count` is the planned total. Ordered appends reconcile attempt items and update authoritative availability; skipped or conflicting ordinals fail closed. Pipeline-7 passed banks remain readable, while incomplete pipeline-9 and historical pipeline-8 banks stay out of Library selection and review mode.

### 6. Start immediately and follow authoritative availability

The learner enters the quiz route as soon as question 1 is stored. A bottom-right polite-live pill reports authoritative stored counts such as `3/10 questions ready`, moves above the measured sticky footer and safe area, and disappears immediately at `10/10`. The generation port and ordered upload queue are module-owned, so route navigation does not cancel the active DeepSeek stream.

If a fast learner reaches a missing ordinal, ClipQuest shows the full waiting view, continues polling approximately once per second, and opens the next question automatically when it arrives. A partial bank can never finish or score. Automatic retries receive a revised first-question ETA. A 30-second owner-only recovery lease with a 10-second heartbeat lets one tab resume from the server's accepted count while other tabs remain read-only; expired leases are taken over automatically. Credential or billing failures expose extension settings and resume only after the extension reports a configuration change.

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="screenshots"></a>

## 🖼️ Product screenshots

### Link-first home

The YouTube-link field remains immediately visible and visually dominant. Saved ClipQuest lessons appear below it without turning the product into a video feed or account dashboard.

![ClipQuest desktop link-import screen](./docs/screenshots/final/desktop-link-import.png)

### Video detection and processing

| Detected video preview                                                                  | Generation timeline                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| ![ClipQuest detected-video preview](./docs/screenshots/final/desktop-video-preview.png) | ![ClipQuest processing stages](./docs/screenshots/final/desktop-processing.png) |

### Generated learning experience

The same green hierarchy, voxel vocabulary, progress treatment, and tactile answer states carry from desktop to mobile without changing the learning flow.

| Desktop quiz                                                                             | Mobile quiz                                                                            |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ![ClipQuest generated desktop quiz](./docs/screenshots/final/desktop-generated-quiz.png) | ![ClipQuest generated mobile quiz](./docs/screenshots/final/mobile-generated-quiz.png) |

### Lesson feedback

The lesson keeps the question readable while the lower action region changes state. Icons and text reinforce color so the result is understandable without relying on green or red alone.

| Correct answer                                                                              | Incorrect answer                                                                                |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ![ClipQuest correct-answer feedback](./docs/screenshots/final/desktop-feedback-correct.png) | ![ClipQuest incorrect-answer feedback](./docs/screenshots/final/desktop-feedback-incorrect.png) |

### Mobile learning and completion

| Paste a link                                                                     | Answer feedback                                                                   | Quest complete                                                                 |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ![ClipQuest mobile link import](./docs/screenshots/final/mobile-link-import.png) | ![ClipQuest mobile answer feedback](./docs/screenshots/final/mobile-feedback.png) | ![ClipQuest mobile completion](./docs/screenshots/final/mobile-completion.png) |

### Private operations

The role-gated operations console uses the same semantic colors and voxel vocabulary while retaining denser tables and controls for system work.

| Desktop overview                                                                           | Mobile people management                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| ![ClipQuest operations overview](./docs/screenshots/final/admin-overview-desktop-1440.png) | ![ClipQuest mobile people management](./docs/screenshots/final/admin-users-mobile-390.png) |

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="tech-stack"></a>

## 🧩 Tech stack and repository languages

The language inventory below comes from the tracked repository, including the native module and platform build definitions—not only the web application.

| Language or format                 | Where ClipQuest uses it                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript and TSX                 | Expo routes and components, Cloudflare Worker API, shared Zod contracts, Playwright, tests, and build configuration                                         |
| JavaScript and ESM (`.js`, `.mjs`) | Manifest V3 extension runtime, caption processing, local quiz generation, web workers, asset scripts, and packaging                                         |
| React ecosystem                    | React 19, React DOM 19, React Native 0.86, and Expo Router power the shared web, iOS, and Android product interface                                         |
| SQL                                | Nineteen ordered D1 migrations for authentication, quiz storage, reliability, administration, progressive imports, safe call telemetry, and recovery claims |
| Swift                              | iOS implementation of the local audio-decoder Expo module                                                                                                   |
| Kotlin                             | Android implementation of the local audio-decoder Expo module                                                                                               |
| HTML                               | Extension popup markup and the checked-in local extension QA harness                                                                                        |
| CSS                                | Extension popup presentation and interaction states                                                                                                         |
| Groovy                             | Android Gradle build definition for the native decoder module                                                                                               |
| Ruby                               | CocoaPods `.podspec` definition for the iOS decoder module                                                                                                  |
| JSON and JSONC                     | Package manifests, Expo/EAS configuration, extension manifest, model metadata, QA summaries, and Wrangler configuration                                     |
| XML                                | Android native resource configuration                                                                                                                       |
| Markdown                           | Product, operations, design-research, platform-asset, and deployment documentation                                                                          |
| Web App Manifest                   | Installable PWA identity, icons, theme colors, and launch behavior                                                                                          |
| WebVTT and plain text              | Non-secret caption QA fixtures and normalized-caption acceptance artifacts                                                                                  |

The primary product runtime is TypeScript/React Native, the browser extension is JavaScript/HTML/CSS, the edge and data layer is TypeScript/SQL on Cloudflare, and native audio decoding is implemented separately in Swift and Kotlin.

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="architecture"></a>

## 🔗 Architecture and module guide

| Layer                | Technology                                                       | Responsibility                                                                                                       |
| -------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Web/native app       | Expo 57, Expo Router, React 19, React Native 0.86                | Authentication, paste/share import, Android-local generation, lessons, feedback, mastery, administration, and themes |
| Browser extension    | Chrome Manifest V3, JavaScript                                   | Web caption access, local streamed DeepSeek generation, retries, and canonical option randomization                  |
| Edge API             | Cloudflare Workers, Hono, scheduled triggers                     | Better Auth, ordered storage-only question imports, grading, availability, review scheduling, and static assets      |
| Data and assets      | D1, KV, private R2                                               | Accounts, videos, generating/passed banks, attempts, mastery, rate limits, thumbnails, and model files               |
| Local quiz engine    | Shared JavaScript, DeepSeek V4 Flash, Expo fetch                 | Platform-neutral prompts, plans, SSE parsing, structural validation, retries, shuffling, and serialization           |
| Transcription        | Transformers.js, WebGPU/WASM, `whisper.rn`                       | Existing web/iOS-capable transcription sources; excluded from the Android 0.2.0 caption-only APK                     |
| Shared contracts     | TypeScript, Zod                                                  | Versioned page protocol, quiz schemas, API requests, and server validation                                           |
| Quality and delivery | Vitest, Node test runner, Playwright, ESLint, Prettier, Wrangler | Contract tests, browser journeys, static checks, builds, and deployment                                              |
| Visual identity      | Semantic tokens, typed voxel registry, Sharp                     | Shared light/dark themes and deterministic web, extension, iOS, Android, and splash assets                           |

### [Expo application](./apps/app/)

The user-facing web and native application. Expo Router owns authentication, home, library, settings, video setup, generation, lesson, completion, and not-found routes. The web build also packages the extension zip into its public output.

Best starting points: [routes](./apps/app/app/) · [components](./apps/app/src/components/) · [local generation adapters](./apps/app/src/generation/) · [theme tokens](./apps/app/src/theme/tokens.ts)

### [Chrome extension](./apps/extension/)

The local caption and quiz engine. The background service worker coordinates YouTube tabs, the ClipQuest page bridge, streamed DeepSeek calls, per-question validation, bounded automatic recovery, downloads, cancellation, and progress. Legacy continuation metadata remains readable for older banks, but the current learner flow has no continuation button. The API key never enters the page bridge.

Best starting points: [local generator](./apps/extension/src/local-generator.js) · [caption text normalization](./apps/extension/src/caption-text.js) · [background worker](./apps/extension/src/background.js) · [manifest](./apps/extension/manifest.json)

### [Shared local quiz engine](./packages/local-quiz-engine/)

The platform-neutral local generation core consumed by Chrome and Android. Platform storage, browser tabs/ports, SecureStore, and HTTP transports remain injected adapters. The package owns no credentials and has no Worker dependency.

### Android private beta

Android 0.2.0 uses Expo SecureStore, Expo fetch streaming, a bounded AsyncStorage outbox that never contains secrets or captions, a native `ACTION_SEND` config plugin, locked-down local KaTeX rendering, and opt-in Expo notifications. See the [build, privacy, EAS, and device guide](./docs/ANDROID-BETA.md).

### [Cloudflare Worker API](./apps/api/)

The authenticated server boundary. Quiz generation is intentionally absent. `/api/quiz-imports/progressive` creates a generating pipeline-9 bank from question 1, ordered singleton appends extend it, safe call-event writes make request/retry totals authoritative, and attempt-generation status exposes authoritative counts without exposing captions or model output. A short owner-only recovery claim rotates the import key and prevents competing tabs while automatic recovery resumes at the first missing ordinal. Existing passed pipeline-7 banks remain compatible.

Best starting points: [quiz import route](./apps/api/src/routes/quiz-imports.ts) · [Worker source](./apps/api/src/) · [Wrangler configuration](./apps/api/wrangler.jsonc) · [migrations](./apps/api/migrations/)

### [Shared contracts](./packages/contracts/)

The authoritative Zod schemas and version constants shared by the app and Worker. Change the local-quiz protocol or question union here before updating either consumer.

### [Local audio decoder](./modules/local-audio-decoder/)

The native bridge used to turn source media into Whisper-compatible PCM without sending raw audio to a transcription provider.

### [Private operations console](./docs/ADMIN-CONSOLE.md)

Authorized operators use `/admin` to inspect system health, accounts, sessions, read-only generation streams, lessons, and audit history. Roles are server-owned and every management API is permission checked.

## Repository structure

```text
ClipQuest/
├─ apps/
│  ├─ app/                     # Expo Router client and static web export
│  ├─ extension/               # Manifest V3 captions and local-AI extension
│  └─ api/                     # Cloudflare Worker, bindings, and migrations
├─ packages/
│  ├─ contracts/               # Shared Zod API and quiz schemas
│  └─ local-quiz-engine/       # Chrome/Android prompt, parser, validation, retry core
├─ modules/
│  └─ local-audio-decoder/     # Native PCM decoding module
├─ e2e/                        # Playwright browser journeys
├─ docs/                       # Product guides, QA notes, and screenshots
└─ scripts/                    # Whisper model preparation and upload
```

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="quick-start"></a>

## 🚀 Quick start

Recommended: Node.js 22+, npm 10+, Chrome, and a DeepSeek API key owned by the local tester.

```bash
git clone https://github.com/UnoxyRich/ClipQuest.git
cd ClipQuest
npm ci
cp .dev.vars.example apps/api/.dev.vars
npm run db:migrate:local
```

Start the API and web client in separate terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open the Expo URL shown in the web terminal. Unauthenticated visits start at `/sign-in`; choose **Create account**, or follow the trial link on the sign-up screen to open `/welcome` and try the YouTube flow without making an account first.

### Build and load the extension

`npm run dev:web` and the production app build package the extension automatically. To build it directly:

```bash
npm run build -w @clipquest/extension
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `apps/extension/dist/clipquest-captions-extension`.
5. Pin **ClipQuest Local AI**, open its popup, enter the DeepSeek key, and choose **Save & test**.
6. Reload the ClipQuest page and choose **Check again** if the install gate is still open.

The distributable archive is written to `apps/extension/dist/clipquest-captions-extension.zip`, copied to the tracked release asset at `apps/app/public/clipquest-captions-extension.zip`, and served by the built website at `/clipquest-captions-extension.zip`. The tracked archive ensures the current unpacked-extension package is present in a fresh checkout as well as in the deployed Worker assets.

### Local Worker variables

Use placeholder credentials for presentation-only UI work. Real server integrations use these values in `apps/api/.dev.vars`:

| Variable                             | Purpose                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `DEEPSEEK_API_KEY`                   | Legacy pipeline-7 short-answer grading and the disabled experimental history classifier; **not pipeline-9 generation or grading** |
| `RESEND_API_KEY`                     | Verification and password-recovery email                                                                                          |
| `BETTER_AUTH_SECRET`                 | Better Auth signing and session security                                                                                          |
| `YOUTUBE_CREDENTIALS_ENCRYPTION_KEY` | Encryption for the disabled experimental YouTube device flow                                                                      |

> [!WARNING]
> The quiz-generation key is entered only in the extension popup. Never put it in `EXPO_PUBLIC_*`, page storage, bridge messages, screenshots, logs, issues, or commits. Local `.dev.vars` and production Worker secrets are separate.

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="verification"></a>

## 🛠️ Verification and builds

Run the repository quality gate:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run cf:types
npm run cf:dry-run
```

The suite covers caption parsing and timestamp removal, one-character SSE/JSON fragmentation, early question emission, resumable suffix generation, retry budgets, the versioned extension channel, mixed question types, true/false balance, two-stage multiple-choice randomization, ordered/idempotent singleton imports, generating-attempt races, waiting and automatic-recovery states, legacy pipeline compatibility, learner feedback, and completion flows.

For a real extension smoke test with Chrome available:

```bash
npm run test:live -w @clipquest/extension
```

Automated tests do not replace live acceptance. Reload the unpacked extension after every extension build, use a fresh public educational video, confirm caption acquisition and the local DeepSeek request, inspect the generated questions, answer **every** question, and reach the completion screen.

Prepare native projects after native dependency changes:

```bash
npm run native:prebuild -w @clipquest/app
npm run android:internal -w @clipquest/app
npm run ios:development -w @clipquest/app
```

### Whisper model assets

Pinned model assets are downloaded, hash-verified, and uploaded to private R2:

```bash
npm run models:prepare
npm run models:upload
```

Native Whisper requires a development build and does not run inside Expo Go.

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="deploy"></a>

## ☁️ Cloudflare deployment

The checked-in Wrangler configuration targets [clipquest.ccwu.cc](https://clipquest.ccwu.cc) and binds D1, KV, private R2, an hourly scheduled trigger, and static assets. It has no quiz-generation Queue producer or consumer.

Authenticate and set the Worker-only production secrets from the API workspace:

```bash
cd apps/api
npx wrangler login
npx wrangler whoami
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put YOUTUBE_CREDENTIALS_ENCRYPTION_KEY
cd ../..
```

Apply migrations, build the extension/app/Worker bundle, and deploy:

```bash
npm run db:migrate:remote
npm run build
npm run cf:deploy
```

`npm run cf:deploy` is the guarded versioned rollout described in the [production release guide](./docs/PRODUCTION-RELEASE.md); do not replace it with a direct one-step production deploy.

Verify the active release after deployment:

```bash
curl -fsS https://clipquest.ccwu.cc/health
cd apps/api && npx wrangler deployments status
```

After this source revision is deployed, expected health invariants include pipeline `9`, `backendQuizGeneration: false`, `extensionQuizGeneration: true`, `extensionRequired: true`, and `maintenance: false`. Check the live response before claiming production is current. Then create one disposable quiz and inspect its stored generation profile and prompt version: `/health` reports the deployed code's current capability, while rollout configuration can intentionally select an older profile for new banks. The app and Worker share one deployment, so always build before deploying; otherwise the Worker may serve stale static assets or an old extension archive.

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="privacy"></a>

## 🛡️ Privacy and security boundary

- On web, the learner's DeepSeek key is stored only in `chrome.storage.local`. On Android, it is stored under the signed-in user in Android Keystore-backed Expo SecureStore. Each client sends the key only to `https://api.deepseek.com`; ClipQuest's page and Worker never receive it.
- Caption segments and normalized text remain inside the local Chrome/Android generation client. Progressive import receives only video/session settings, verified aggregate source metadata, bounded generation metadata, and one validated question at a time. Android's bounded, account-scoped outbox contains only validated questions and safe events—not a key, caption text, prompt, or model body. Account changes discard ambiguous legacy caption/import state instead of attaching it to a new learner.
- Current generation uses result protocol `10`, client metadata, request IDs, exact-origin or authenticated-native boundaries, payload bounds, cancellation, and timeouts. Chrome and Android advertise `question-stream-v7`; existing banks keep their original compatibility contracts. The API key is never part of any ClipQuest protocol.
- The Worker performs no backend quiz generation and returns no generated-looking fallback questions. Invalid, incomplete, wrong-type, or malformed extension output fails closed.
- Multiple-choice option order is securely randomized before import, then randomized again whenever a learner view is activated. Display indexes map back to canonical indexes before submission; True/False order is unchanged.
- D1 queries and R2/KV objects are scoped to authenticated users. Progressive imports require ownership, a UUID idempotency key, rate limits, strict pipeline metadata, and an exact next ordinal. Generating banks cannot enter Library review or complete an attempt early.
- Short answers are graded deterministically by the authenticated Worker from the bounded stored rubric, without sending the learner response or transcript to a model. Answer writes and mastery updates are guarded by the active grading reservation, and automatic generation appends require a live owner lease.
- Operations roles are stored server-side. Privileged changes require authorization and write audit records; generic Better Auth admin endpoints are blocked.
- YouTube OAuth, watch-history imports, subscriptions, playlists, liked videos, and personalized feeds are outside the core flow and disabled by default.
- Android 0.2.0 supports only public videos with usable text captions. Its build excludes `whisper.rn` and the local audio decoder from Android autolinking, and its source path rejects missing captions before `/api/media/resolve` or DeepSeek can run.
- Do not commit `.env`, `.dev.vars`, API keys, credentials, private transcripts, model caches, exported quiz answers, or QA-user secrets.

> [!WARNING]
> Playwright journeys use contract-shaped mocked API and extension responses. A green UI suite is not proof of live YouTube caption access, DeepSeek availability, Chrome extension freshness, or a completed learner flow.

<p align="right"><a href="#top">↑ Back to top</a></p>

## License

ClipQuest is available under the [Apache License 2.0](./LICENSE).

<p align="right"><a href="#top">↑ Back to top</a></p>
