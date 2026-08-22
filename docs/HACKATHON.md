# ClipQuest — HHCC 2026 judge brief (Education track)

> **Watch → recall → review.** ClipQuest turns any public, captioned YouTube lesson into a
> grounded quiz in about six seconds, grades every answer with reasoning, shows what you
> missed, schedules a spaced review, and hands you a one-page cheat sheet.

|                  |                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live product** | <https://clipquest.ccwu.cc> (Chrome + the bundled ClipQuest extension + your own DeepSeek key)                                                                         |
| **Repository**   | <https://github.com/404-Waifu-Not-Found/HHCC2026>                                                                                                                      |
| **Team**         | `@404-Waifu-Not-Found/cos` — UnoxyRich (lead, integration), JimmyfaQwQ (extension & AI workflow), ILikeLayla (web & product design), Justin-Yonardo (backend, quality) |
| **Demo video**   | `UnoxyRich_ClipQuest_Demo.mp4` — script in [`output/video/`](../output/video/UnoxyRich_ClipQuest_Demo_Script.md)                                                       |
| **Deep dive**    | [README](../README.md) · [docs index](./README.md) · [QA evidence](../qa-results/)                                                                                     |

---

## 1. The learning problem

Video is the most accessible explanation format students have, and also the easiest to
consume passively. A learner finishes a 12-minute lesson, recognises every idea when it
is replayed, and still cannot reproduce it the next morning — the classic _illusion of
competence_. Decades of learning-science research point to the fix: **retrieval
practice with immediate corrective feedback, spaced over time**. In practice almost nobody
does it after a video, because writing good questions takes longer than watching, and
switching to a separate flash-card tool breaks the flow.

ClipQuest makes active recall the default next step after watching, at zero authoring cost
for the learner or the teacher.

## 2. What a learner does (60-second walkthrough)

1. **Paste a YouTube link** (or press _Open in ClipQuest_ on the YouTube watch page).
2. Pick question types — multiple choice, true/false, short answer — and length (5/10/15).
3. The browser extension reads the public captions, strips timestamps, and asks DeepSeek for
   **question 1 only**. The attempt opens the moment that question validates (measured
   **6.4 s** in the 2026-08-21 live acceptance run) while the rest stream in behind.
4. Answer one question at a time. Every response is graded immediately with a **"Why"**
   explanation; a miss also shows the **correct answer** and brings the concept back later
   as an adaptive **retry** worded differently.
5. On completion: score, mastery state, **"What to review"** (every missed question with
   your answer, the correct answer, and the reasoning), and a **one-page cheat-sheet PDF**.
6. The lesson lands in the Library with a **review due in 3 days**; pass that review and
   the video is marked **mastered**. Miss it and the review moves to tomorrow.

<p align="center">
  <img alt="Quiz question with tactile answer cards" src="./screenshots/final/desktop-generated-quiz.png" width="47%" />
  <img alt="Incorrect-answer feedback with reasoning" src="./screenshots/final/desktop-feedback-incorrect.png" width="47%" />
</p>
<p align="center">
  <img alt="Completion screen with score, mastery, right-first-try count and the What to review list" src="./screenshots/final/desktop-completion-recap.png" width="72%" />
</p>

## 3. Learning science → product decisions

| Principle (evidence)                                        | What ClipQuest does                                                                                                                                                                                                                                               | Where                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Retrieval practice** beats re-watching for durable memory | Every lesson becomes a quiz; questions are generated only from what the video actually said (caption-grounded, validated, never fabricated)                                                                                                                       | `packages/local-quiz-engine`, `apps/extension/src/local-generator.js` |
| **Immediate, elaborated feedback**                          | Each answer returns `correct`, the canonical answer, and a "Why" explanation; short answers are graded deterministically on the server against the stored rubric; the optional device-local DeepSeek grade only adds reasoning text and never changes the verdict | `apps/api/src/routes/quizzes.ts`, `FeedbackPanel`                     |
| **Errors are learning opportunities**                       | A missed concept returns as a reformulated retry in the same session; the completion recap lists misses with answer + reasoning and marks those recovered on retry                                                                                                | `apps/app/src/lib/session-recap.ts`, quiz completion screen           |
| **Metacognition**                                           | "Right first try x/y", score, and mastery state are shown together so learners calibrate confidence against performance                                                                                                                                           | completion stats                                                      |
| **Spaced, expanding review**                                | 80 % unlocks a review 3 days later; a second 80 % marks _mastered_; a miss pulls the next review to tomorrow; Library surfaces "Due for review"                                                                                                                   | `apps/api/src/lib/mastery.ts`, `/api/library`                         |
| **Interleaving / varied formats**                           | Mixed MC, true/false and short-answer plans are seeded and balanced so no type runs more than twice in a row                                                                                                                                                      | `questionTypePlanForSelection` in `packages/contracts`                |
| **Consolidation**                                           | A cheat sheet (summary, key concepts, definitions, "remember this") is generated locally and exported as a one-page PDF                                                                                                                                           | `apps/app/src/lib/cheat-sheet.ts`                                     |
| **Reduce friction, keep attention**                         | Question 1 in ~6 s; the rest stream while the learner is already answering; recovery from bad model output is automatic and invisible                                                                                                                             | progressive import pipeline                                           |
| **Inclusive by design**                                     | 44 px targets, visible focus, reduced-motion support, colour-independent feedback, light/dark themes, English and 简体中文 UI, KaTeX math rendering                                                                                                               | `apps/app/src/theme`, `MathText`                                      |
| **Trust & privacy**                                         | The learner's own AI key stays on the device; the server only ever stores validated questions and progress — never captions, prompts, or model output                                                                                                             | `docs/ADMIN-CONSOLE.md`, README privacy section                       |

## 4. What is built and verified

- **Web app + Chrome extension (primary)** — production at clipquest.ccwu.cc on
  Cloudflare Workers/D1/R2; extension 0.8.31; the complete learner flow was exercised
  end-to-end on fresh public lessons on 2026-08-21 (question 1 in 6.4 s, 10/10 questions
  answered, 100 % stored, PDF downloaded and inspected). See [`HANDOFF.md`](../HANDOFF.md).
- **Quest sharing (web-first)** — a finished quest publishes one stable link
  (`/s/<token>`). Anyone can open the public preview (title, concept names, question
  count and types — never the questions or answers); a signed-in recipient gets their
  own copy of the validated bank and works it with the full feedback / recap / mastery
  loop. Covered by API and app tests (`apps/api/test/shares.test.ts`,
  `apps/app/test/shared-quest-route.test.ts`).
- **Quality gate** — `npm run format:check`, `lint`, `typecheck`, and the extension
  package build run in [GitHub Actions](../.github/workflows/ci.yml) on every pull request
  and every push to `main`; `npm test` (700+ unit, contract, API, app, extension, and
  engine tests) runs locally before release.
- **Evidence culture** — every production claim in [`qa-results/`](../qa-results/) names
  the exact Worker, extension, and profile it measured; dated reports are append-only.

## 5. Try it in two minutes

**Fastest (production):**

1. Open <https://clipquest.ccwu.cc> in Chrome and create an account (email verification).
2. The site offers `clipquest-captions-extension.zip`; unzip it, open `chrome://extensions`,
   enable _Developer mode_ → _Load unpacked_ → select the folder.
3. Click the extension icon, paste a DeepSeek API key (a quiz costs well under ¥0.1), _Save & test_.
4. Paste any public captioned lesson — e.g. a TED-Ed or Crash Course video — and press
   **Make my quest**. You are answering question 1 within seconds.

**Local checkout:**

```bash
git clone https://github.com/404-Waifu-Not-Found/HHCC2026.git && cd HHCC2026
npm ci
npm run typecheck && npm test          # the same gate CI runs
```

The local Worker needs `apps/api/.dev.vars` (see `.dev.vars.example`); account e-mail
verification requires a Resend key, so the production site is the quickest way to
experience the real learner flow.

## 6. Architecture in one picture

```text
YouTube watch page ──► ClipQuest Local AI extension ──► DeepSeek (learner's key, device-local)
                            │  captions → plain text, question-by-question JSON
                            │  schema + grounding + duplicate + polarity validation
                            ▼
                  ClipQuest web ───────────────► Cloudflare Worker (Hono, Better Auth)
                            │                          │ stores ONLY validated questions,
                            │                          │ attempts, mastery, cheat sheets
                            ▼                          ▼
               quiz → feedback → recap → PDF        D1 · KV · private R2
```

Shared Zod contracts (`packages/contracts`) keep the extension, web, and Worker on one
versioned quiz schema; `packages/local-quiz-engine` contains the generation core.

## 7. Honest status

- The repository history was imported into the HHCC 2026 organisation on 2026-08-21; the
  project description PDF submitted earlier described the plan before that import. This
  brief, the README, and the demo script describe the repository as it is now.
- Generation quality is measured, not assumed: the latest full production matrix is in
  [`qa-results/`](../qa-results/), including its known defects and what was fixed since.
- No backend generation, no fabricated fallback questions, no audio download or speech
  model — captions only. Videos without usable captions fail explicitly.

## 8. What we would do next

1. **Sample lesson for first-time visitors** — a pre-validated quiz from a public lesson so a
   judge or student can feel the loop before installing the extension or adding a key.
2. **Expanding spaced-repetition schedule** (1 → 3 → 7 → 21 days) with per-concept, not
   per-video, scheduling, driven by the recap data this release starts collecting.
3. **Teacher dashboard on top of quest sharing** — sharing a validated bank with a class
   ships in this release; next is a lightweight view of commonly-missed concepts across
   the recipients of one link (the `quiz_share_claims` table already records which copy
   came from which link).
4. **Caption-moment citations** on every question and multilingual question generation.

## 9. Team and contributions

| Member                 | Owned                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **UnoxyRich** (lead)   | Scope, shared contracts, cross-platform integration, release engineering, production verification, documentation |
| **JimmyfaQwQ**         | Chrome extension, caption acquisition, DeepSeek prompt/validation/recovery pipeline, answer feedback and recap   |
| **ILikeLayla (Layla)** | Learner journey, web screens, visual system, accessibility                                                       |
| **Justin-Yonardo**     | Hono API and D1 schema, authentication, automated QA                                                             |

Shared code review and joint live acceptance runs kept all platforms on the same quiz
contract and learning goals.
