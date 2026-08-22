# ClipQuest

## Iteration overview

### Submission summary

**Project:** ClipQuest  
**Event deliverable:** A working learning product that turns public YouTube lessons into caption-grounded quizzes, immediate feedback, and mastery progress.  
**Iteration repository:** https://github.com/404-Waifu-Not-Found/HHCC2026  
**Live product:** https://clipquest.ccwu.cc

This document describes the work completed during the event and the difference
between the pre-event foundation and the post-event iteration.

## Pre-event foundation

Before the event, the project had only a short written README describing the
initial product idea. There was no implemented product flow, no completed
frontend, no quiz engine, no persistence layer, no browser extension, and no
production deployment to evaluate.

The pre-event material established the direction: use educational YouTube
content as the starting point for a focused learning experience. The event
iteration turned that written concept into the codebase and working product
submitted here.

## What changed during the event

The team built the full product in this project. The work was iterative: each
stage addressed a concrete product risk discovered in the previous stage.

| Iteration                    | Problem or goal                                                 | Improvement delivered                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product foundation           | A written idea needed a usable learning flow.                   | Built the ClipQuest web app, authentication, URL import, lesson preview, quiz flow, answer feedback, completion state, and Library.                                                                                  |
| Evidence-grounded generation | AI-generated questions needed reliable lesson context.          | Added caption-only acquisition from public YouTube videos, timestamp normalization, structured DeepSeek generation, strict schemas, validation, and explicit failure states when captions are unavailable.           |
| Progressive learning         | Waiting for a complete quiz made the experience feel slow.      | Added question-first progressive generation. The first validated question opens the attempt while the remaining questions continue in bounded background batches.                                                    |
| Correctness and recovery     | A malformed or missing question could break an entire attempt.  | Added ordinal validation, duplicate checks, answer mapping checks, bounded repair of the first missing question, idempotent imports, cancellation, timeouts, and safe recovery without replacing accepted questions. |
| Mastery loop                 | A quiz result alone did not provide a repeatable learning loop. | Added Library history, color-coded mastery ranks, review state, progress bars, due reviews, saved lessons, and practice-oriented quiz presentation.                                                                  |
| Browser access               | The experience needed to work beyond one browser screen.        | Added a Chrome extension bridge that shares the local quiz engine and privacy boundary.                                                                                                                              |
| Product polish               | The first UI needed stronger hierarchy and feedback.            | Redesigned the Library cards, hover and theme states, progress treatment, streaming feedback, error and empty states, accessibility labels, and reduced-motion behavior.                                             |
| Release readiness            | A working feature needed repeatable delivery and evidence.      | Added contracts, migrations, API routes, tests, web asset verification, extension packaging, Wrangler deployment, health checks, and release documentation.                                                          |

## Pre-event versus post-event

| Area          | Pre-event                       | Post-event                                                                                 |
| ------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| Product state | Short README only               | Deployed web product with browser extension                                                |
| Input         | Product idea                    | Public YouTube URL validation, metadata preview, and caption acquisition                   |
| AI            | No implemented AI flow          | Learner-owned DeepSeek key used locally for structured question generation                 |
| Learning      | No quiz experience              | Multiple-choice, true/false, and short-answer quizzes with immediate feedback              |
| Progress      | No persistence or mastery model | Authenticated attempts, ordered question storage, mastery ranks, review state, and Library |
| Reliability   | No validation or recovery       | Contract validation, bounded retries, repair, cancellation, timeouts, and idempotency      |
| UX            | No interface                    | ClipQuest interface with light/dark themes, motion, accessibility, and clear states        |
| Platforms     | No working client               | Web and Chrome extension bridge sharing core logic                                         |
| Delivery      | No deployment                   | Cloudflare Worker and static web assets deployed at `clipquest.ccwu.cc`                    |
| Verification  | No test suite                   | Automated contract, API, app, engine, extension, UI regression, build, and asset checks    |

## Improvement logic and scope

The team prioritized the smallest complete learning loop first: import a lesson,
obtain trustworthy text, generate a question, let the learner answer, and show
useful feedback. Once that loop worked, the team expanded it in layers:

1. **Ground the content.** The system uses public captions rather than invented
   lesson content. Unsupported or captionless sources fail explicitly.
2. **Protect correctness.** Every question is validated before it becomes
   learner-visible or persistent. Accepted questions are never silently
   replaced.
3. **Reduce waiting.** Progressive generation makes question 1 available
   quickly while preserving ordered completion of the full set.
4. **Make progress meaningful.** Results become mastery, review, and Library
   state instead of disappearing after one attempt.
5. **Make the product usable.** Clear layouts, theme parity, accessible
   controls, visible loading/error/empty states, and motion-safe feedback were
   treated as part of the feature, not post-event decoration.
6. **Ship with evidence.** The final scope includes automated checks and a
   production deployment, while unfinished or gated features remain clearly
   marked rather than presented as complete.

The current release intentionally hides the Workplace AI chat navigation for
all users while that feature remains in development. The route and source are
kept behind a release gate so future work can continue without exposing an
unfinished experience.

## Team decisions and responsibilities

The team owned the product decisions and creative direction:

- Core product concept and UX flow
- Feature scope and prioritization
- Project architecture and file structure
- Caption-only privacy boundary
- Key algorithms and validation/recovery logic
- Mastery and review model
- Testing strategy and CI/release verification
- Visual direction, interaction design, and accessibility expectations

## AI usage disclosure

### Usage cost

**$240 in API-token usage across all tools**

### Tools used

- GitHub Copilot
- Claude Code CLI

### What the team built and what AI coded

The team made the product and engineering decisions. All implementation code
for the event iteration is written in this project repository.

### Team decisions and concepts

- Project architecture and file structure
- Core product concept and UX flow
- Feature scope and design decisions
- Key algorithms and logic design
- Testing strategy and CI pipeline setup

### AI as an auxiliary tool

AI was used only as an auxiliary coding tool for:

- Boilerplate and repetitive code
- Syntax lookup and autocomplete
- Refactoring and code formatting
- Documentation drafting
- Debugging assistance

All key decisions, concepts, and creative direction were developed entirely by
the team. AI served as an auxiliary coding tool only.

## Recommended judge submission

Submit these items:

1. **Project name:** ClipQuest
2. **Iteration code:** The GitHub repository at
   https://github.com/404-Waifu-Not-Found/HHCC2026
3. **Iteration overview:** The PDF exported from this document,
   `ITERATION-OVERVIEW.pdf`
4. **Presentation/demo link:** https://clipquest.ccwu.cc
5. **AI disclosure:** The “AI usage disclosure” section above

The repository contains the complete event implementation. The README and
documentation provide additional architecture, privacy, release, and QA
context.
