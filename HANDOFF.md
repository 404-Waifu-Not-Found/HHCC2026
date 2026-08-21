# ClipQuest handoff

Updated: 2026-08-21 (Asia/Shanghai)

This file is the non-secret continuation point for moving ClipQuest to another computer. Treat the checked-out repository, `git log -1`, production `/health`, and the installed Chrome extension as authoritative; timestamps, browser state, deployment IDs, and release details below can become stale.

## Immediate continuation objective

The previously interrupted production-browser goal is complete. The next computer should start by pulling `main`, rebuilding/reloading the unpacked extension, restoring the local DeepSeek key through the extension UI, and rerunning a short smoke check against production. Do not repeat the historical repair unless the current checkout or production `/health` no longer matches the verified implementation and Worker IDs below.

## Current Git and production state

- Repository: `https://github.com/UnoxyRich/ClipQuest`
- Default branch: `main`
- Deployed implementation commit: `f74d2453c423911cdb3ff9f3518ae4d19a9ffe41`
- Implementation commit message: `Fix true-false polarity and duplicate retries`
- `HEAD`, `origin/main`, and GitHub `refs/heads/main` all matched that commit before the handoff-only documentation update.
- Production URL: `https://clipquest.ccwu.cc`
- Production Worker at handoff time: `d62df941-478f-4113-8eaa-7bebf5ffefec`
- Production version tag at handoff time: `f74d2453c423911cdb3ff9f3518ae4d19a9ffe41`
- Required browser extension version: `0.8.31`
- Required capability: `question-stream-v7`
- Backend quiz generation is disabled. Chrome generation must run through the local extension; the server stores validated quiz/progress data.
- The guarded Cloudflare release completed successfully: preview and override verification passed, the Worker was promoted to 100%, and all 9 shell plus 9 entry-bundle probes passed at +0, +120, +300, and +600 seconds.
- Production `/health` returned HTTP 200 and identified the Worker/version tag above immediately before this update.

After cloning or pulling, verify rather than trusting the snapshot:

```bash
git status --short --branch
git log -1 --oneline
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
curl -fsS https://clipquest.ccwu.cc/health
```

## Current release

GitHub Release `v0.2.0` is published at:

`https://github.com/UnoxyRich/ClipQuest/releases/tag/v0.2.0`

The release targets baseline `ee37102ad091a19ae3d6ecdd4270cde3792f77a1` and contains:

- `ClipQuest-v0.2.0.apk`
  - SHA-256: `569b73388dfe99f4d4fd4a7d42bbf19f80e23b99caece7d3d571b22d35b90abf`
  - This Android release APK is unsigned and must be signed before installation or distribution.
- `ClipQuest-v0.2.0-unsigned.ipa`
  - SHA-256: `f00157a7a73335e3b541d0c19b187312f707f5d2ea73bbd5340e5be7c250b5cb`
  - This iOS device IPA is intentionally unsigned and must be signed before installation.

## Extension setup on the new computer

The extension source is `apps/extension`. Build it from the current checkout:

```bash
npm ci
npm test -w @clipquest/extension
npm run build -w @clipquest/extension
```

Expected unpacked directory:

`apps/extension/dist/clipquest-captions-extension`

Expected ZIP:

`apps/extension/dist/clipquest-captions-extension.zip`

At the deployed implementation, all 245 extension tests passed and both distributed ZIP copies had SHA-256:

`bb4bcd59cc261eb3ad141c20501a241e5839547af2f5cb10d8bc061ac86b9006`

Chrome installation is device-local and cannot be transferred by Git. On the new computer:

1. Open `chrome://extensions` manually.
2. Enable Developer mode.
3. Click **Load unpacked** and select `apps/extension/dist/clipquest-captions-extension`, or click **Reload** if the same unpacked path is already installed.
4. Confirm the visible extension is named **ClipQuest** and reports version `0.8.31` or newer.
5. Open its popup and configure the DeepSeek key if Chrome says it is not configured.

Do not paste the API key into this file, Git, issue comments, logs, screenshots, or chat. Extension storage and `.env` do not move with the repository.

## Environment setup

Required tool versions:

- Node.js `>=22.13.0`
- npm `>=10`
- Wrangler 4 for Cloudflare work
- Chrome with Developer mode available for the unpacked extension
- Poppler (`pdftoppm` and `pdfinfo`) for PDF verification

The local `.env` is intentionally ignored and is not included in Git. Recreate secrets through a secure channel. The variable names present on the source computer were:

- `BETTER_AUTH_SECRET`
- `DEEPSEEK_API_KEY`
- `RESEND_API_KEY`
- `YOUTUBE_CREDENTIALS_ENCRYPTION_KEY`

Never commit their values. The live Chrome path normally keeps the DeepSeek key in `chrome.storage.local` and sends caption text directly from the extension to DeepSeek.

Useful setup and validation commands:

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
npm run cf:dry-run
```

## Completed live-browser acceptance

The final all-in-one acceptance used a new public captioned TED-Ed lesson:

- URL: `https://www.youtube.com/watch?v=PSRJfaAYkW4`
- Source video ID: `PSRJfaAYkW4`
- Title: **How does your immune system work? - Emma Bryce**
- ClipQuest video ID: `da562754-eb9f-49f4-88fe-c50dde54e2ef`
- Caption language: English
- Persisted caption source category: `unknown`
- Caption evidence: 90 segments and 732 words
- Generation request ID: `47e693e4-c2b7-44f9-9cf0-fbad01172582`
- Generation session ID: `b275132a-6cce-49f5-83fe-3c05674d4191`
- Quiz ID: `079b1c00-b6ac-4001-a51a-418beb61f29c`
- Attempt ID: `9a4fa85b-5d1a-4b73-9a0e-dc8f0d25ba79`

The browser clicked **Create my quiz** at `2026-08-21T05:53:28.127Z`. A strict DOM probe required the complete prompt, four enabled choices, progress, and the Check control; it passed at `2026-08-21T05:53:34.535Z`, for a first-answerable latency of **6,408 ms**. The learner screen simultaneously showed `1/10 questions ready`, proving the first question was usable while the remaining bank continued generating.

The run used medium/10 with multiple choice, true/false, and short answer enabled. All 10 learner-visible questions were answered through the normal interface, including three short responses. Every response received coherent positive feedback, the attempt completed without a warning, dead end, manual Continue, or Retry control, and the completion screen reported 100%, 10 questions, and a working **Download PDF** button.

Production D1 is the authoritative generation record:

- Attempt status: `complete`
- Score/correct/answered: `100 / 10 / 10`
- Quiz quality status: `passed`
- Pipeline version: `9`
- Primary generation calls: `5`
- Accepted questions: `10`
- `automatic_retry` or non-null `retry_kind` events: `0`
- Call classifications: `primary,primary,primary,primary,primary`
- Per-call elapsed range: 1,685–3,337 ms

The final bank contained coherent true and false statements. Positive antigen and inflammation statements stored `true`; the spleen-origin and “exact causes are well understood” statements stored `false`, with explanations matching their polarity. The browser answers and feedback agreed with those stored answers.

The completion PDF downloaded to:

`/Users/unoxyrich/Downloads/How-does-your-immune-system-work---Emma-Bryce-cheat-sheet.pdf`

An ignored inspection copy is at `tmp/pdfs/immune-live/source.pdf` on the source computer. It is 1,688 bytes, one unencrypted Letter page, PDF 1.7, rendered by `pdf-lib`, with SHA-256:

`d23b59a58f0d98e729a88271181b13ad0e11a71ea92f4ad67d77322e581a75f6`

`pdfinfo`, `pdftotext`, and a 150-DPI full-page render verified the title wraps safely and the Summary, Key concepts, Definitions, and Remember this sections are readable with no clipping, overlap, or missing content.

An earlier post-deploy run on **The science of skin - Emma Bryce** independently verified the specific true/false polarity repair. Its positive dermal-collagen statement stored `true`, was answered `True`, and produced correct positive feedback. That attempt also finished 10/10 with zero retries and produced a clean one-page PDF. IDs: video `94f06c77-dbd0-4076-b934-1f218000f139`, quiz `0f7a9ef9-c443-4835-8d80-8da2dabf1750`, attempt `2909559d-603b-48f4-97dc-8b7a141b7fa3`.

## Implemented repair and verification

Commit `f74d2453c423911cdb3ff9f3518ae4d19a9ffe41` contains the production repair:

- Stable v5.2 local generation reconciles contradictory true/false output when the model labels a statement false but its correction simply restates that exact statement.
- The API import boundary applies the same defensive normalization, protecting already-installed extension clients as well as newly rebuilt clients.
- Incorrect answers schedule an adaptive retry only when `reformulated_prompt` is genuinely different after Unicode, case, whitespace, and punctuation normalization; identical prompts no longer repeat.
- Regression tests cover local polarity normalization, API storage normalization, and rejection of exact duplicate adaptive retries.
- The tracked downloadable extension ZIP was rebuilt with the new source.

Validation passed before deployment:

- Full `npm test`
- Contracts: 26/26
- API: 209/209
- App: 164/164
- Extension: 245/245
- Headless quiz: 6/6
- Local quiz engine: 29/29
- YouTube source: 7/7
- API release scripts: 8/8
- App web-asset scripts: 2/2
- Type checking for contracts, API (including Wrangler types), and app
- `git diff --check` and staged secret scan

## Important implementation locations

- Extension bridge and service worker:
  - `apps/extension/src/clipquest-bridge.js`
  - `apps/extension/src/background.js`
  - `apps/extension/src/local-generator.js`
  - `apps/extension/src/generation-outbox.js`
- Generation screen:
  - `apps/app/app/generation/[videoId].tsx`
- Quiz learner screen:
  - `apps/app/app/quiz/[attemptId].tsx`
- Automatic recovery policy:
  - `apps/app/src/generation/automatic-recovery-policy.ts`
- Extension profile/capability selection:
  - `apps/app/src/generation/extension-profile.ts`
- Progressive import and telemetry routes:
  - `apps/api/src/routes/quiz-imports.ts`
  - `apps/api/src/lib/progressive-quiz.ts`
- Cheat-sheet generation and PDF export:
  - search `apps/app` for `cheat-sheet`, `Export notes`, and the PDF renderer before editing; names may evolve.
- Key regression suites:
  - `apps/extension/test/*.test.mjs`
  - `apps/app/test/extension-generation-profile.test.ts`
  - `apps/app/test/automatic-recovery-policy.test.ts`
  - `apps/api/test/progressive-call-events.test.ts`

## Deployment and publishing

The Cloudflare production script is guarded and expects a pushed, clean checkout. It builds the contracts, web app, and Worker; performs a Wrangler dry run; uploads a tagged Worker version; tests it through preview and a zero-percent version override; promotes it; and probes production at 0, 120, 300, and 600 seconds.

Run from a clean worktree after pushing the intended commit:

```bash
npm run cf:deploy
```

Do not call a deployment successful until all soak probes pass and both production `/health` plus Worker deployment metadata identify the intended Git SHA.

The user has explicitly authorized committing and pushing this handoff bundle. Preserve direct `main` publishing unless the user gives a different branch instruction. Before pushing, inspect the complete staged diff, scan staged content for credentials, run `git diff --check`, and verify the remote SHA after the push.

## Files carried in this handoff bundle

The handoff commit intentionally carries forward the meaningful untracked QA state:

- Root caption JSON fixture for the neural-network lesson.
- `qa-results` report builders, recorded QA data, and Markdown/JSON evidence.
- `output/headless` generated run artifacts.
- `output/pdf` final report PDFs.
- `output/video` demo script.

The following are intentionally not committed because they are machine-local, reproducible, sensitive, or scratch state:

- `.env` and other secret files.
- `node_modules`, Gradle state, build outputs, and caches.
- The accidental generated root `android/` project.
- `tmp/` PDF renders and superseded scratch artifacts.
- Python `__pycache__`, `.pyc`, and `qa-results/.tmp-*` diagnostics.
- Native APK/IPA binaries already published through GitHub Release `v0.2.0`.

## Definition of done for the interrupted goal

Complete as of 2026-08-21. The final fresh production run proved an active configured extension, caption import, a 6.408-second first complete question, zero automatic retries, no manual generation recovery, normal completion of all 10 questions, 100% persisted completion state, and a downloaded/fully inspected notes PDF. The source repair is committed, pushed, deployed, soaked for 600 seconds, and independently verified on two fresh videos.
