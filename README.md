<a id="top"></a>

<h1 align="center"><strong>ClipQuest:</strong> turn lesson videos into learning quests</h1>

<p align="center">
  <img src="./apps/app/assets/illustrations/clip-explorer-ready.png" alt="ClipQuest explorer holding a video lesson" width="260" />
</p>

<p align="center">
  <strong>Paste a YouTube or bilibili link, build an evidence-backed lesson, and learn it through immediate feedback.</strong>
</p>

<p align="center">
  <a href="https://clipquest.ccwu.cc"><strong>Open ClipQuest →</strong></a>
</p>

<p align="center">
  <img alt="Expo" src="https://img.shields.io/badge/Expo-4856D8?style=for-the-badge&logo=expo&logoColor=white" />
  <img alt="React Native" src="https://img.shields.io/badge/React_Native-5968E8?style=for-the-badge&logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6171F3?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare_Workers-FF8A3D?style=for-the-badge&logo=cloudflareworkers&logoColor=white" />
</p>

<p align="center">
  <img alt="DeepSeek" src="https://img.shields.io/badge/DeepSeek-4856D8?style=for-the-badge" />
  <img alt="SQLite D1" src="https://img.shields.io/badge/Cloudflare_D1-16A88A?style=for-the-badge&logo=sqlite&logoColor=white" />
  <img alt="Vitest" src="https://img.shields.io/badge/Vitest-F4B942?style=for-the-badge&logo=vitest&logoColor=20263A" />
  <img alt="Playwright" src="https://img.shields.io/badge/Playwright-16A88A?style=for-the-badge&logo=playwright&logoColor=white" />
  <img alt="Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-4856D8?style=for-the-badge" />
</p>

<p align="center">
  <a href="#overview">Overview</a> ·
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
  <a href="./docs/HANDOFF-2026-07-31-UI-REBUILD.md">Current handoff</a> ·
  <a href="./docs/duolingo-ui-research.md">UI research</a> ·
  <a href="./docs/LIVE-QA-2026-07-31.md">Live QA</a>
</p>

---

<a id="overview"></a>

## 🧭 Product overview

ClipQuest turns public educational videos into focused learning sessions. A learner pastes a supported YouTube or bilibili URL, reviews the detected video, and starts a generated quest. Existing English or Chinese captions are preferred. If captions are unavailable, Whisper Tiny transcribes the audio on the learner's own device before timestamped transcript text reaches the backend.

DeepSeek generates questions that must cite transcript evidence. The learner then completes a tactile, keyboard-accessible lesson with dedicated choice, true/false, ordering, and written-answer interactions. Answers are validated by the server, and supported progress is saved for resume and later review.

```text
public YouTube / bilibili URL
              │
              ▼
     metadata + caption check
        ┌─────┴───────────┐
        │ captions        │ no captions
        ▼                 ▼
 timestamped text   short-lived audio stream
                           │
                           ▼
                 on-device decode + Whisper
        └─────────────┬─────────────┘
                      ▼
        evidence-backed DeepSeek questions
                      │
                      ▼
       tactile lesson → feedback → review/mastery
```

> [!IMPORTANT]
> YouTube or Google account access is not required. ClipQuest begins with a public link, does not fetch watch history, and keeps its experimental YouTube device flow disabled by default.

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="journey"></a>

## 🗺️ Learning journey

### 1. Paste first

The URL field is the primary action on desktop, tablet, and mobile. ClipQuest validates supported hosts, recognizes common YouTube URL forms, provides bilibili support, and gives actionable invalid, unsupported, private, or unavailable-video feedback.

### 2. Preview and prepare

The detected-video screen presents available title, creator, duration, language, platform, and thumbnail information before processing starts.

### 3. Build the transcript privately

ClipQuest uses captions when possible. Captionless media is streamed through a short-lived user-bound token, decoded to 16 kHz mono PCM, and transcribed locally through WebGPU/WASM on web or `whisper.rn` in a native development build.

### 4. Generate an evidence-backed quest

The Cloudflare Worker stores the timestamped transcript privately, asks DeepSeek for structured questions, validates the response with shared Zod schemas, and rejects unsupported educational claims.

### 5. Learn with immediate feedback

Large answer controls, a prominent progress bar, disabled/selected/correct/incorrect states, a lower feedback panel, and a clear Check → Continue rhythm keep each lesson focused.

> [!NOTE]
> Processing uses named stages rather than fabricated percentages. Retry, pause, cancellation, durable idempotency, and resume continue to use server-authoritative state.

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="screenshots"></a>

## 🖼️ Product screenshots

### Link-first home

The public-video field remains immediately visible and visually dominant. Saved ClipQuest lessons appear below it without turning the product into a video feed or account dashboard.

![ClipQuest desktop link-import screen](./docs/screenshots/final/desktop-link-import.png)

### Video detection and honest processing

| Detected video preview                                                                  | Staged lesson processing                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| ![ClipQuest detected-video preview](./docs/screenshots/final/desktop-video-preview.png) | ![ClipQuest processing stages](./docs/screenshots/final/desktop-processing.png) |

### Lesson feedback

The lesson keeps the question readable while the lower action region changes state. Icons and text reinforce color so the result is understandable without relying on green or red alone.

| Correct answer                                                                              | Incorrect answer                                                                                |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ![ClipQuest correct-answer feedback](./docs/screenshots/final/desktop-feedback-correct.png) | ![ClipQuest incorrect-answer feedback](./docs/screenshots/final/desktop-feedback-incorrect.png) |

### Mobile learning and completion

| Paste a link                                                                     | Answer feedback                                                                   | Quest complete                                                                 |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ![ClipQuest mobile link import](./docs/screenshots/final/mobile-link-import.png) | ![ClipQuest mobile answer feedback](./docs/screenshots/final/mobile-feedback.png) | ![ClipQuest mobile completion](./docs/screenshots/final/mobile-completion.png) |

> [!TIP]
> The same semantic tokens drive the fixed desktop learning rail, tablet composition, and safe-area-aware mobile bottom navigation. The mobile UI is not a scaled-down desktop layout.

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="tech-stack"></a>

## 🧩 Tech stack

| Layer                 | Technology                                                                    | Purpose                                                                                          |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Cross-platform client | Expo 57, Expo Router, React 19, React Native 0.86                             | Web, iOS, and Android routes from one application architecture                                   |
| Interface system      | React Native StyleSheet, semantic tokens, Fredoka, DM Sans, Expo Vector Icons | Responsive layouts, tactile states, accessible typography, and original ClipQuest presentation   |
| Edge API              | Cloudflare Workers, Queues, scheduled triggers                                | Authentication endpoints, source processing, generation jobs, retries, and reminders             |
| Data and assets       | D1, KV, private R2                                                            | Accounts, lessons, attempts, rate limits, media tokens, transcripts, thumbnails, and model files |
| Authentication        | Better Auth                                                                   | Username/email sign-in, verification, recovery, and user-scoped data                             |
| AI and transcription  | DeepSeek, Transformers.js, WebGPU/WASM, `whisper.rn`                          | Evidence-backed question generation and private local speech recognition                         |
| Contracts             | TypeScript, Zod                                                               | Shared request/response schemas and generated-question validation                                |
| Quality               | Vitest, Playwright, ESLint, Prettier                                          | Unit/contract coverage, responsive browser journeys, linting, and formatting                     |
| Delivery              | Expo static export, Wrangler                                                  | Web assets and API deployed together through the ClipQuest Worker                                |

> [!NOTE]
> Fredoka and DM Sans are licensed Google Fonts. The ClipQuest explorer and interface assets are original; no Duolingo logo, mascot, proprietary font, illustration, or branded copy is included.

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="architecture"></a>

## 🔗 Architecture and module guide

### 1. [Expo application](./apps/app/)

The user-facing web and native application. Expo Router owns authentication, home, library, settings, video setup, processing, lesson, completion, and not-found routes. Shared components and semantic design tokens live under `apps/app/src`.

Best starting points: [routes](./apps/app/app/) · [components](./apps/app/src/components/) · [theme tokens](./apps/app/src/theme/tokens.ts)

### 2. [Cloudflare Worker API](./apps/api/)

The server boundary for Better Auth, source metadata, caption/media delivery, private transcript persistence, DeepSeek generation, answer validation, review scheduling, and static asset serving.

Best starting points: [Worker source](./apps/api/src/) · [Wrangler configuration](./apps/api/wrangler.jsonc) · [migrations](./apps/api/migrations/)

### 3. [Shared contracts](./packages/contracts/)

Zod schemas and TypeScript types shared by the Expo client and Worker. API assumptions and generated-question structures should change here before either consumer is updated.

### 4. [Local audio decoder](./modules/local-audio-decoder/)

The native bridge used to turn source media into Whisper-compatible PCM without sending raw audio to a transcription provider.

### 5. [Documentation and browser QA](./docs/)

The [current UI handoff](./docs/HANDOFF-2026-07-31-UI-REBUILD.md) records architecture and honest acceptance status. [Playwright journeys](./e2e/clipquest.spec.ts) cover the primary visual, responsive, validation, retry, feedback, and completion states.

## Repository structure

```text
ClipQuest/
├─ apps/
│  ├─ app/                     # Expo Router client and static web export
│  └─ api/                     # Cloudflare Worker, bindings, and migrations
├─ packages/
│  └─ contracts/               # Shared Zod API and lesson schemas
├─ modules/
│  └─ local-audio-decoder/     # Native PCM decoding module
├─ e2e/                        # Playwright browser journeys
├─ docs/                       # Handoffs, research, QA notes, screenshots
└─ scripts/                    # Whisper model preparation and upload
```

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="quick-start"></a>

## 🚀 Quick start

Recommended: Node.js 22+, npm 10+, and a modern Chromium browser.

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

Open the local Expo URL shown in the second terminal. Use placeholder credentials for presentation-only UI work; real integrations require the following server-only values in `apps/api/.dev.vars`:

| Variable                             | Purpose                                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| `DEEPSEEK_API_KEY`                   | Transcript-grounded classification and question generation   |
| `RESEND_API_KEY`                     | Verification and password-recovery email                     |
| `BETTER_AUTH_SECRET`                 | Better Auth signing and session security                     |
| `YOUTUBE_CREDENTIALS_ENCRYPTION_KEY` | Encryption for the disabled experimental YouTube device flow |

> [!WARNING]
> Never expose these values through `EXPO_PUBLIC_*`, screenshots, logs, issues, or commits. Local `.dev.vars` and production Worker secrets are separate.

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="verification"></a>

## 🛠️ Verification and builds

Run the complete repository quality gate:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

The current verified baseline is 38 Vitest tests and five Playwright journeys. Browser coverage includes YouTube/bilibili link validation, unavailable media, processing retry, keyboard answer selection, correct/incorrect feedback, completion, horizontal overflow, and target desktop/tablet/mobile viewports.

Prepare native projects after native dependency changes:

```bash
npm run native:prebuild -w @clipquest/app
```

Create internal development builds:

```bash
npm run android:internal -w @clipquest/app
npm run ios:development -w @clipquest/app
```

Native Whisper requires a development build and does not run inside Expo Go. Real-device transcription, safe-area, and virtual-keyboard behavior should be included in release acceptance.

### Whisper model assets

Model weights are not bundled into the initial app. Pinned assets are downloaded, hashed, verified, and uploaded to private R2:

```bash
npm run models:prepare
npm run models:upload
```

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="deploy"></a>

## ☁️ Cloudflare deployment

The checked-in Wrangler configuration targets [clipquest.ccwu.cc](https://clipquest.ccwu.cc) and the provisioned D1, KV, private R2, Queue, scheduled trigger, and static-asset bindings.

Authenticate and enter production secrets interactively from the Worker workspace:

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

Apply migrations, build every workspace, and deploy:

```bash
npm run db:migrate:remote
npm run build
npm run cf:deploy
```

> [!NOTE]
> The app and Worker share one deployment. Build the Expo export before deploying so `apps/app/dist` contains the intended static routes and assets.

> [!CAUTION]
> YouTube can challenge shared Cloudflare egress even when metadata succeeds. Treat live caption/media retrieval as an upstream integration that must be smoke-tested with supported public videos; do not work around it by collecting browser cookies or weakening the local-transcription privacy boundary.

<p align="right"><a href="#top">↑ Back to top</a></p>

<a id="privacy"></a>

## 🛡️ Privacy and security boundary

- Raw audio is streamed through a short-lived user-bound token, decoded locally, and discarded after transcription.
- Only timestamped transcript segments—not raw audio—are uploaded for private storage and question generation.
- DeepSeek and Resend credentials remain Worker-only and never enter Expo or web bundles.
- D1 queries and R2/KV objects are scoped to authenticated ClipQuest users and server-side authorization.
- Generated questions must pass shared schema, answer, evidence, and transcript-segment validation.
- YouTube OAuth, watch-history imports, subscriptions, playlists, liked videos, and personalized account feeds are outside the core product and disabled.
- The experimental YouTube device connection remains behind `ENABLE_YOUTUBE_DEMO_HISTORY=false`; it is not required to create a quest.
- Do not commit `.env`, `.dev.vars`, credentials, private transcripts, model caches, or QA-user secrets.

> [!WARNING]
> Browser Playwright journeys use contract-shaped mocked API responses and never write production data. A green UI suite is not a substitute for live DeepSeek, Resend, source-provider, and real-device acceptance.

<p align="right"><a href="#top">↑ Back to top</a></p>

## License

ClipQuest is available under the [Apache License 2.0](./LICENSE).

<p align="right"><a href="#top">↑ Back to top</a></p>
