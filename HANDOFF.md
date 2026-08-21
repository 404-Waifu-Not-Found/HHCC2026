# ClipQuest handoff

Updated: 2026-08-21 (Asia/Shanghai)

This file is the non-secret continuation point for moving ClipQuest to another computer. Treat the checked-out repository, `git log -1`, production `/health`, and the installed Chrome extension as authoritative; timestamps, browser state, deployment IDs, and release details below can become stale.

## Immediate continuation objective

Complete a real production Chrome learner flow with the current local ClipQuest extension:

1. Use a fresh public YouTube lesson with usable captions.
2. Select multiple choice, true/false, and short answer in a medium 10-question session.
3. Measure from clicking **Create my quiz** until the first complete, answerable question is visible. The requirement is less than 15 seconds.
4. Verify generation uses zero `automatic_retry` call events and never exposes a learner Continue or Retry control.
5. Answer all 10 questions through the normal interface, including short answers.
6. Reach the completion screen without a generation warning, dead end, or manual recovery step.
7. Click **Download PDF** or **Export notes**, capture the actual downloaded file, render every PDF page, and inspect its text, wrapping, sections, formulas, and visual layout.
8. If any condition fails, reproduce the cause, add a regression test, implement a source fix, push/deploy it, reload the extension, and repeat with a different fresh YouTube link. Do not claim success from unit tests, a Create page, a generated first question, or an Export click alone.

## Current Git and production state

- Repository: `https://github.com/UnoxyRich/ClipQuest`
- Default branch: `main`
- Tracked baseline before this handoff bundle: `ee37102ad091a19ae3d6ecdd4270cde3792f77a1`
- That baseline was already pushed to `origin/main` before this handoff commit.
- Production URL: `https://clipquest.ccwu.cc`
- Production Worker at handoff time: `3fc4c5b9-540a-4f35-bbdf-e7f69c868f59`
- Production version tag at handoff time: `ee37102ad091a19ae3d6ecdd4270cde3792f77a1`
- Required browser extension version: `0.8.31`
- Required capability: `question-stream-v7`
- Backend quiz generation is disabled. Chrome generation must run through the local extension; the server stores validated quiz/progress data.
- The production health response was HTTP 200 immediately before writing this handoff.

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

At the handoff baseline, all 244 extension tests passed and both distributed ZIP copies had SHA-256:

`4601321cdda7df9af508228739ad906c10c32c1e3b2b05b066b97776a9af6cf5`

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

## Exact live-browser interruption

The last live attempt used this captioned TED-Ed video:

`https://www.youtube.com/watch?v=qD0_yWgifDM`

Title: **The science of spiciness - Rose Eveleth**

The signed-in production account imported the video successfully and reached a medium 10-question Create page with all three question types enabled. After clicking **Create my quiz**, the learner reached the generation route, but production could not detect an installed current extension. Around seven seconds after the click, the page showed:

- `Quiz creation stopped`
- `Local generation unavailable`
- `Question 1 unavailable`
- `ClipQuest 0.8.31 or newer is required.`

The failed generation ID was:

`1244c810-fc9f-4d50-9b51-f7c80af5495a`

This was an installed-browser-state failure. No caption extraction, DeepSeek call, retry, persisted first question, completed quiz, or PDF export occurred. Do not treat it as evidence about model latency or quiz quality. Use a different fresh video after loading the correct extension.

Chrome's protected `chrome://extensions` page rejected automation, including attempts to substitute another browser-control surface. The extension load/reload must therefore be performed manually once on the destination computer. All normal ClipQuest page interactions can then be automated in the live Chrome session.

## Live acceptance evidence to collect

Capture a compact run record containing:

- Video URL, ID, title, duration, caption language, and whether captions are human-authored or automatic.
- Extension version and capability visible to the website.
- Generation ID, video ID, quiz ID, and attempt ID.
- Wall-clock timestamps for Create click and first complete question render.
- The first-question latency in milliseconds.
- The count of primary and `automatic_retry` call events.
- Each learner-visible question type, prompt, chosen response, feedback, and navigation result.
- Completion score and confirmation that the completion screen remains independent of notes generation.
- The downloaded PDF path, byte size, SHA-256, page count, extracted required section headings, and rendered-page inspection result.

For authoritative zero-retry evidence, query production telemetry for the generated quiz rather than inferring from the absence of a retry button. The relevant D1 table is `quiz_generation_call_events`; `classification = 'automatic_retry'` must have a count of zero for the run. Primary call count and accepted question coverage should also be reconciled with the requested 10-question bank.

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

The interrupted browser goal is complete only when one fresh production run proves all of the following at once:

- Correct installed extension is active and configured.
- Video captions import normally.
- First complete question appears in less than 15 seconds.
- Generation records zero automatic retries.
- No learner-visible manual retry or continuation action is needed.
- All 10 questions are answerable and completed smoothly.
- Completion state persists normally.
- Notes PDF is ready, downloads successfully, opens, and passes full-page visual/content inspection.
- Any code required to reach that state is committed, pushed, deployed, and verified on a second fresh video after the fix.

Anything less is progress, not acceptance.
