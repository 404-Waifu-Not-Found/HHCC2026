# ClipQuest UI Rebuild Handoff

**Date:** 2026-07-31 22:33 CST  
**Branch:** `codex/duolingo-ui-rebuild`  
**Primary source of truth used:** `docs/HANDOFF-2026-07-31.md`, especially its live-hardening continuation in Section 20  
**Supporting source used:** `docs/LIVE-QA-2026-07-31.md`

## Summary

ClipQuest now has a new cross-platform visual system and a rebuilt user journey centered on the real product loop:

> Paste a public YouTube or bilibili link → preview it → process it → complete a tactile lesson → see supported results.

The Expo Router application keeps the existing API, authentication, transcript, generation, persistence, and answer-validation contracts. The presentation layer was replaced in place with a distinctive ClipQuest design that adapts current Duolingo interaction patterns without using Duolingo branding, copy, characters, fonts, or visual assets.

The link input is the first major control on signed-out and signed-in entry screens. YouTube OAuth and watch-history UI are absent from the rebuilt home, library, and settings experiences. The core flow does not request Google or YouTube authentication.

## Architecture

- **Workspace/package manager:** npm workspaces, npm lockfile.
- **Client:** Expo 57, React Native 0.86, React 19, Expo Router, responsive web/iOS/Android presentation.
- **API:** Cloudflare Worker with the existing Better Auth, D1, KV, R2, Queue, source adapter, transcript, generation, and review logic.
- **Shared contracts:** `packages/contracts`; the root type-check now builds this workspace before checking dependents.
- **State:** existing providers, route state, AsyncStorage/SecureStore, server-authoritative generation/attempt data, and persisted retry/cancel behavior remain intact.
- **Testing:** Vitest workspace tests plus new Playwright browser journeys and screenshots.

## Environment setup

The supplied `/Users/unoxyrich/Desktop/clipquest.env` was used without printing or committing its values. Its four server-only values were mapped to the API's established ignored local file, `apps/api/.dev.vars`:

- `DEEPSEEK_KEY` → `DEEPSEEK_API_KEY`
- `RESEND_KEY` → `RESEND_API_KEY`
- `BETTER_AUTH_SECRET` → unchanged server variable
- `YOUTUBE_CREDENTIALS_ENCRYPTION_KEY` → unchanged server variable

No secret was copied into application source, screenshots, test fixtures, or documentation. No server-only value is exposed with an Expo public prefix.

## Research and design system

The dated source review, measurements, state behaviors, accessibility observations, and adaptation decisions are in `docs/duolingo-ui-research.md`.

### Visual language

- **Fonts:** Fredoka 600/700 for friendly display hierarchy and DM Sans 400/500/700 for readable UI/body copy. Both are licensed Google Fonts already compatible with the Expo stack.
- **Palette:** original ClipQuest indigo, action lime, sky, emerald, coral, amber, mist, and midnight roles.
- **Geometry:** centralized 2–4 px border roles, 14–26 px radii, 4 px tactile button depth, 44 px minimum interaction targets, and dedicated content/lesson/sidebar/nav widths.
- **Motion:** fast state transitions, selection feedback, staged processing, completion celebration, and reduced-motion handling.
- **Responsive shell:** fixed 248 px learning rail on desktop; compact, icon-first bottom navigation on mobile; safe-area-aware lesson actions and feedback.

### Tokens and primitives

Semantic color, typography, spacing, radius, border, shadow, size, breakpoint, motion, and safe-area tokens live in `apps/app/src/theme/tokens.ts`.

The rebuilt component layer includes:

- `Screen`, `Surface`, `AuthShell`, `Mascot`
- `PrimaryButton`, `IconButton`, `AppTextInput`, `SegmentedControl`
- `AnswerCard`, `LessonHeader`, `ProgressBar`, `FeedbackPanel`
- `ProcessingSteps`, `VideoCard`, `StatTile`, `EmptyState`, `SectionHeader`

Components provide explicit default, hover/focus, pressed, selected, correct, incorrect, disabled, loading, completed, locked, and error behavior where relevant.

## Routes rebuilt

- `/` — branded session/loading gate
- `/welcome` — link-first guest entry
- `/sign-in`
- `/sign-up`
- `/forgot-password`
- `/reset-password`
- `/verify-email`
- `/(tabs)` — responsive app shell and home
- `/(tabs)/library`
- `/(tabs)/settings`
- `/create/[videoId]` — detected-video preview and lesson setup
- `/generation/[videoId]` — honest staged processing, retry, pause, and cancel
- `/quiz/[attemptId]` — question, feedback, and completion states
- `+not-found` — branded accessible recovery screen

## Main experience status

### Link import

- URL input is immediately visible on desktop and mobile, before authentication promotion.
- Keyboard submission, paste-from-clipboard, visible focus, validation, loading, and actionable errors are implemented.
- YouTube watch, short, Shorts, Live, and Embed validation continues to use the existing source contract.
- bilibili links continue to use the existing source contract.
- A guest URL survives the short ClipQuest account step through the existing local application context.
- The home and library show ClipQuest-created activity only; no watch-history or recent-YouTube feed is rendered.

### Processing

- Existing durable API job/polling/idempotency behavior is preserved.
- The UI reports named stages instead of inventing precise backend percentages.
- Retry, pause, cancel, errors, accessible live status, and partial recovery are represented.
- A React Strict Mode race was fixed: an obsolete aborted generation effect can no longer mark the current run paused.

### Lesson

- Dedicated renderers cover single choice, true/false, ordering, and typed/fill-style questions supported by current contracts.
- Answers remain server validated; no production mock scoring was introduced.
- Answer cards are semantic keyboard-operable buttons with explicit selection and outcome indicators.
- The lower lesson action region changes from Check to correct/incorrect feedback and Continue.
- The final answer now displays its feedback before opening completion.
- Completion shows only supported score/mastery/question-count data; it does not fabricate streaks, XP, time, or goals.

## Existing functionality preserved

- ClipQuest Better Auth account, verification, recovery, and settings flows.
- Source URL validation and metadata contracts.
- Caption-first/local-transcription selection and privacy boundary.
- Server generation, Zod validation, evidence linkage, idempotency, queues, and recovery.
- Attempt creation, server-side answer validation, resume, review, and mastery data paths.
- Local appearance/language/privacy/model/push preferences.
- API, database, migrations, bindings, schemas, and backend tests were not replaced.

## Old UI removal

The visual implementation was replaced in its existing route/component files rather than leaving parallel legacy pages. The old generic cards, flat buttons, auth composition, navigation, quiz feedback, loading, empty, and error presentation are gone. YouTube recommendation/history/account-linking surfaces were removed from home, library, and settings.

No backend, schema, migration, transcript, generation, or authentication implementation was deleted. No abandoned copy of the old UI remains. Existing original files that contain behavior were refactored in place so their logic remained reviewable.

## Dependencies

### Added

- `@playwright/test` — browser journeys and visual capture
- `eslint` and `eslint-config-expo` — current flat-config linting
- `prettier` — deterministic formatting

### Removed

None. No new runtime UI library was needed.

## Accessibility

- Semantic buttons and form labels
- Logical headings and predictable tab order
- Visible high-contrast focus rings
- Error text associated with inputs
- Text/icon indicators in addition to success/error color
- Accessible progress and loading announcements
- Keyboard answer selection and activation
- Minimum 44 px targets
- Safe-area-aware fixed controls
- Reduced-motion support
- Branded accessible not-found recovery

## Responsive status

- **Desktop:** explicitly exercised at 1440×1000, 1280×900, and 1024×900. The link-first layout, 248 px rail, processing, lesson, feedback, completion, library, and settings were captured.
- **Tablet:** exercised at 768×1024 and captured.
- **Mobile:** explicitly exercised at 412×915, 393×852, 390×844, 375×812, and 360×800. No horizontal overflow was detected; URL entry, processing, quiz, feedback, completion, and safe-area navigation were captured.
- **Virtual keyboard:** responsive input behavior is implemented, but a physical-device virtual-keyboard acceptance pass was not run during this UI rebuild.

## Verification completed

| Command/check | Result |
| --- | --- |
| `npm run format:check` | Passed |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | Passed: 38 tests (19 API, 14 app, 5 contracts) |
| `npm run build` | Passed: contracts, Expo web export, Worker dry build |
| `npm run test:e2e` | Passed: 5 Playwright journeys in approximately 1.1 minutes |
| Chrome Computer Use | Signed-out URL input and enabled submit verified; continued to ClipQuest sign-up with no Google/YouTube control |

## Production deployment update — 2026-07-31

- Rotated `DEEPSEEK_API_KEY`, `RESEND_API_KEY`, `BETTER_AUTH_SECRET`, and `YOUTUBE_CREDENTIALS_ENCRYPTION_KEY` from the supplied environment file through Wrangler stdin. No value was printed, added to a command argument, written to a temporary file, or committed.
- Deployed the rebuilt Worker and static web assets to the configured `clipquest.ccwu.cc` custom domain.
- Cloudflare production version: `9ed676ed-1f30-44fc-ae35-1d6a5bcab9dc`.
- The hourly schedule and `clipquest-generation` producer/consumer were deployed successfully.
- Post-deploy `/health` returned HTTP 200 with authentication, generation, email, and YouTube credential encryption configured; YouTube demo history remained disabled.
- Post-deploy `/welcome` returned HTTP 200 as HTML and contained the ClipQuest application shell.

The Playwright API layer is deliberately contract-shaped and mocked, so it can deterministically cover all visual and failure states without writing production data. It verified:

- YouTube and bilibili success paths
- Invalid and unsupported URL errors
- Private/unavailable video error
- Processing failure and retry against the same durable job
- Mouse and keyboard answer selection
- Correct and incorrect feedback
- Completion
- All target viewport widths and horizontal overflow
- Zero `/api/youtube/*` account/history requests

## Screenshot evidence

Final captures live in `docs/screenshots/final/`:

- `desktop-link-import.png`
- `desktop-video-preview.png`
- `desktop-processing.png`
- `desktop-quiz-initial.png`
- `desktop-quiz-selected.png`
- `desktop-feedback-correct.png`
- `desktop-feedback-incorrect.png`
- `desktop-completion.png`
- `desktop-library.png`
- `desktop-settings.png`
- `tablet-link-import.png`
- `mobile-link-import.png`
- `mobile-processing.png`
- `mobile-quiz.png`
- `mobile-feedback.png`
- `mobile-completion.png`

The pre-rebuild reference captures remain in `docs/screenshots/baseline/`.

## Honest external-service status and known issues

- The UI's manual YouTube and bilibili paths passed contract-valid browser tests. A fresh live, end-to-end external-provider acceptance run was **not** completed as part of this visual rebuild.
- The prior authoritative handoff records a Cloudflare shared-egress YouTube bot challenge that can block caption/media bytes even when metadata succeeds. That remains an upstream acceptance risk and was not represented as fixed.
- A controlled real transcript reaching DeepSeek, live Resend inbox delivery, and real-device WebGPU/WASM/iOS/Android transcription were not rerun here.
- Physical-device virtual-keyboard and native safe-area acceptance remain to be completed.
- The current npm dependency tree reports audit advisories; no potentially breaking forced audit rewrite was performed during the UI work.

## Deferred/out of scope

- YouTube OAuth and Google account linking
- YouTube watch-history fetching or recent-watch importing
- Subscription, playlist, and liked-video imports
- YouTube-personalized feeds
- The experimental YouTube device flow remains disabled/isolated (`ENABLE_YOUTUBE_DEMO_HISTORY=false`) and is not required by the core journey.
- The live provider/device acceptance items listed above

## Exact local commands

```bash
cd /Users/unoxyrich/Documents/GitHub/ClipQuest
npm ci
npm run dev:api
npm run dev:web
```

Run API and web development commands in separate terminals. Quality and release checks:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

The environment file must remain ignored and server-only. Do not paste its contents into commands, issues, screenshots, commits, or client-prefixed variables.
