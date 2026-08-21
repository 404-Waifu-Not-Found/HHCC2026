# ClipQuest

**Paste a video → quiz → build mastery.**

ClipQuest is a bilingual Expo app for web, iOS, and Android. It turns supported YouTube and bilibili videos into evidence-backed, adaptive study quests. Existing English or Chinese captions are preferred; otherwise Whisper Tiny transcribes audio on the learner's device before transcript text is sent to the backend.

## What is implemented

- Email/password and username sign-in, email verification, password recovery, and 13+ confirmation with Better Auth.
- YouTube and bilibili import, metadata, thumbnails, caption selection, and short-lived user-bound audio delivery.
- Browser transcription in a Web Worker with Transformers.js, WebGPU/WASM fallback, resumable checkpoints, and persistent model caching.
- Native transcription with `whisper.rn`, a resumable GGML model download, and a local AVFoundation/MediaCodec audio decoder.
- DeepSeek quiz classification and generation with strict Zod validation and transcript-segment evidence.
- Multiple-choice, true/false, ordering, and written answers; adaptive difficulty; reformulated retries; exact resume; and review-based mastery.
- Bilingual English/Simplified Chinese UI, light/dark themes, reduced motion, responsive layouts, and accessible controls.
- Optional experimental YouTube TV device-history flow behind `ENABLE_YOUTUBE_DEMO_HISTORY`.
- D1 persistence, KV rate limits and media tokens, private R2 transcripts/models/thumbnails, Queues generation, and scheduled push reminders.

## Privacy boundary

For a captionless video, the Worker resolves and streams the source audio through a short-lived token. The client decodes the stream to 16 kHz mono PCM and runs Whisper locally. Temporary audio is deleted after decoding/transcription. Only timestamped transcript segments are uploaded; neither raw audio nor model inference is sent to Cloudflare or DeepSeek.

```text
video source -> Worker streaming proxy -> learner device
                                         | decode + Whisper
                                         v
                                timestamped transcript
                                         |
                                         v
                           Worker -> private R2 + DeepSeek
```

## Repository

```text
apps/app/                    Expo Router app and web export
apps/api/                    Cloudflare Worker API
packages/contracts/          Shared Zod request/response contracts
modules/local-audio-decoder/ Expo native audio decoder module
scripts/                     Pinned Whisper model preparation/upload
```

## Local development

Requirements: Node.js 22+, npm 10+, and a Cloudflare account for remote resources.

```bash
npm install
cp .dev.vars.example apps/api/.dev.vars
npm run db:migrate:local
npm run dev:api
npm run dev:web
```

Use placeholder values only for UI work. Real API keys must stay in `.dev.vars` locally and Cloudflare Worker secrets in production.

## Verification

```bash
npm test
npm run typecheck
npm run build
npm run cf:dry-run
```

## Whisper model assets

The initial app does not bundle model weights. The preparation script downloads pinned revisions, verifies the native file against its expected SHA-256, hashes every browser asset, and writes a manifest. The upload script stores all files in the private R2 bucket configured as `clipquest-private`.

```bash
npm run models:prepare
npm run models:upload
```

Current pinned assets:

- Web: `onnx-community/whisper-tiny` at revision `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`, q8 ONNX, about 45 MB.
- Native: `ggerganov/whisper.cpp` at revision `98aa99a0a9db05ae2342309f5096248665f7cba3`, `ggml-tiny-q5_1.bin`, 32,152,673 bytes.

## Cloudflare deployment

The checked-in Wrangler configuration targets `clipquest.ccwu.cc` and the provisioned D1, KV, R2, and Queue resources. From `apps/api`, enter production secrets interactively:

```bash
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put YOUTUBE_CREDENTIALS_ENCRYPTION_KEY
```

Use at least 32 random bytes for `BETTER_AUTH_SECRET`. Use a base64-encoded 32-byte value for `YOUTUBE_CREDENTIALS_ENCRYPTION_KEY`. Then:

```bash
npm run db:migrate:remote
npm run cf:deploy
```

The DeepSeek key is read only inside the Worker and is never included in Expo or web bundles.

## Native builds

Generate native projects after dependency changes:

```bash
npm run native:prebuild -w @clipquest/app
```

Internal builds require an Expo/EAS project ID in `EXPO_PUBLIC_EAS_PROJECT_ID`:

```bash
npm run android:internal -w @clipquest/app
npm run ios:development -w @clipquest/app
```

Native Whisper requires a development build; it cannot run inside Expo Go. iOS local compilation requires full Xcode, and Android local compilation requires the Android SDK and acceptance of its license terms.

## Experimental YouTube history

Official YouTube Data APIs do not expose watch history. ClipQuest therefore keeps the TV device flow disabled by default. If enabled for a disposable test account, credentials are encrypted at rest, timestamps are discarded, no password or browser cookies are collected, and unlinking deletes the stored connection.
