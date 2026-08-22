# Hackathon polish for HHCC 2026 (education track) — design

Date: 2026-08-21
Status: approved for implementation (autonomous session; decisions recorded here)

## Goal

Make this repository a stronger HHCC 2026 education-track submission without
destabilising the production ClipQuest product. "Stronger" means: judges can
trust it (green checks on a fresh clone), judges can understand it in two
minutes (a judge brief that leads with the learning problem and the pedagogy),
and learners get one more evidence-based learning affordance that is easy to
demo (a session recap of missed concepts).

## Findings that drove the scope

1. `npm ci` fails on a fresh clone: `package-lock.json` is missing
   `@emnapi/core` and `@emnapi/runtime`.
2. On a Windows checkout with `core.autocrlf=true`, `npm run format:check`
   flags every file and `apps/app/test/extension-generation-profile.test.ts`
   fails, purely because of CRLF line endings. `.gitattributes` only says
   `* text=auto`.
3. `main` currently fails `npm run lint` (unused `View` import in
   `FeedbackPanel.tsx`) and `npm run format:check` (four files).
4. Commit `e96b81c` added a required `correctAnswer` field to
   `AttemptAnswerResponseSchema`, but the Playwright mock for
   `/api/attempts/:id/answer` does not return it, so the answer journeys are
   expected to fail client-side schema validation.
5. There is no CI workflow in the repository.
6. The submitted description PDF and the demo-video script still describe
   ClipQuest as "concept only, no code written", which no longer matches the
   repository. The README is a 45 KB engineering release log with no
   judge-facing entry point.
7. The completion screen shows score, mastery, question count and a PDF
   action, but never tells the learner _which_ concepts they missed. The demo
   script and project description both promise "concepts worth reviewing".

## Scope

### A. Repository hygiene (trust)

- `.gitattributes`: `* text=auto eol=lf` so every platform checks out LF;
  renormalise the working tree.
- Fix the ESLint warning and the four Prettier failures.
- Regenerate `package-lock.json` so `npm ci` is in sync.
- Fix the Playwright answer mock to return `correctAnswer`.
- Add `.github/workflows/ci.yml`: one `quality` job (Node 22, `npm ci`,
  `format:check`, `lint`, `typecheck`, `test`, extension build) and one `e2e`
  job (Playwright against the mocked web app using the preinstalled Chrome
  channel). No deploy steps, no secrets.

### B. Learner feature: session recap on completion

Pure helper `apps/app/src/lib/session-recap.ts`:

```ts
type RecapEntry = {
  questionId: string;
  prompt: string;            // already presentation-normalised
  correct: boolean;
  isRetry: boolean;
  learnerAnswer?: string;    // human-readable
  correctAnswer?: string;    // human-readable, only when incorrect
  explanation: string;
};
type RecapItem = RecapEntry & { recoveredOnRetry: boolean };
type RecapSummary = { answered: number; missed: RecapItem[]; firstTryCorrect: number };

recordRecapEntry(entries, entry) -> entries   // append, immutable
summarizeRecap(entries) -> RecapSummary
```

Rules: `missed` contains the first incorrect entry per `questionId`, in
session order; `recoveredOnRetry` is true when a later entry with the same
`questionId` and `isRetry` is correct; `firstTryCorrect` counts questions whose
first (non-retry) entry was correct; `answered` is the number of distinct
question ids.

Quiz screen (`apps/app/app/quiz/[attemptId].tsx`):

- Keep `recapEntries` in state; append in the answer handler from the graded
  response (`correct`, `correctAnswer`, `explanation`) plus the learner's
  submitted answer rendered with the existing `presentCorrectAnswer` helper.
- On the completion screen (only when the session recorded entries — a
  reopened completed attempt has none) render a "What to review" section:
  missed items with prompt, learner answer, correct answer, the "Why"
  explanation, and a "Recovered on retry" badge where applicable; when there
  are no misses show one positive line. Add a "Missed" stat tile when entries
  exist.
- i18n keys in both `en` and `zh-CN`.

Tests: vitest unit tests for the helper (TDD); extend the Playwright mock with
`completeOnAnswerCount` and add one journey that misses a question, recovers
on retry, finishes, and asserts the recap content.

### C. Judge-facing documentation

- `docs/HACKATHON.md`: problem → who it serves → pedagogy-to-feature map
  (retrieval practice, immediate corrective feedback, mixed formats, adaptive
  retry, spaced review with mastery states, consolidation via cheat sheet,
  progressive start) → what is built and verified → how to try it in two
  minutes → architecture → honesty/status → team and roles → roadmap.
- README: a short "HHCC 2026 judges — start here" block after the hero, plus
  a CI badge. No rewrite of the rest.
- `output/video/UnoxyRich_ClipQuest_Demo_Script.md`: rewrite as a live-product
  demo (same filename, ≤5:00, same team card), drop the concept-only
  disclosure, include the recap.
- `docs/README.md`: link the judge brief.

### Out of scope (recorded for the team)

- A no-extension "sample lesson" path for judges. Valuable, but it requires
  relaxing the extension gate on `/` and synthesising a pipeline-9 bank; too
  risky to ship unattended against production. Documented in the roadmap.
- Spaced-repetition schedule changes (would need a D1 migration).
- Regenerating the submitted description PDF (binary, team-owned).

## Verification

`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`,
`npm run test:e2e` all green locally on Windows after the line-ending fix;
the same commands run in CI on Ubuntu.

## Findings during implementation

- The extension build script shelled out to the `zip` CLI, which is absent on
  Windows; `dev:web`, `build`, and the Playwright web server all aborted. A
  dependency-free, deterministic Node ZIP writer now backs it up
  (`apps/extension/scripts/zip-archive.mjs`), with `zip` still preferred where
  installed so the tracked release asset stays byte-identical.
- The Playwright `seed` helper needs a loaded app page before it can touch
  `localStorage`; the recap journey navigates to `/welcome` first.

## Review follow-ups (same day)

An independent code review of the branch produced 19 findings; the ones that
changed behaviour:

- Recap entries now persist in the stored attempt record
  (`apps/app/src/state/attempt.ts`), so a reload or app resume mid-quest keeps
  earlier answers; a partial recap never claims a perfect run.
- The recap line labelled "Reason" shows the same text the feedback panel
  showed: the device-local grade's reason when it agreed with the server
  verdict, otherwise the stored explanation (`attachLocalReason`).
- Recap answer lines render through top-level `MathText` so formula answers
  typeset and native `MathText` is never nested inside `Text`.
- The answer route returns the rubric's model answer as `correctAnswer` for
  short-answer questions, so the recap and feedback can show it.
- `prepare-web-runtime.mjs` no longer overwrites the tracked release archive
  when the Node ZIP fallback produced the build; `build.mjs` records the
  packager in `dist/build-info.json`, falls back on any `zip` failure, and
  cleans its staging directory in `finally`.
- The Playwright answer mock returns a type-correct `correctAnswer`, a
  coherent score, and the recap journey now reloads the page mid-quest.
- Docs corrected: grading copy no longer claims "no second model call"; CI runs
  on pull requests and pushes to `main`; the journey count is 24.

Accepted as-is: contracts build twice in the CI quality job (root scripts own
that), the `responseText` duplication in the quiz screen (pre-existing), and the
source-reading tests' raw `readFileSync` (covered by the LF policy).
