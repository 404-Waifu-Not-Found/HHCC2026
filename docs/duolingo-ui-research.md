# Duolingo UI research for the ClipQuest rebuild

Accessed and refreshed: 2026-08-22.

## Purpose and boundaries

This document records current public Duolingo identity and interface patterns that informed the 2026 ClipQuest rebrand. It is product-design research, not permission to copy Duolingo assets. Current implementation and acceptance status lives in the [README release status](../README.md#release-status).

ClipQuest independently implements the useful principles: green-led hierarchy, focused tasks, visible progress, large controls, tactile depth, immediate feedback, simple silhouettes, and generous negative space. It does not ship Duolingo screenshots, logos, characters, illustrations, sounds, copy, proprietary fonts, or Feather Green (`#58CC02`).

The adaptation boundary is explicit: Duolingo's recognizable mascot behavior, emotional posing, character construction, and flat-vector artwork are out of scope. ClipQuest uses an original deeper green system and individually generated low-density voxel artwork. Its learning prism is an abstract interlocking video-frame and quiz-card object with no face, limbs, clothing, pose, mood, or personality cues.

Authenticated Duolingo screens are cohort- and experiment-dependent. Measurements below are estimates from current public screenshots and live public pages, not extracted proprietary design tokens.

## References

| Reference                                                                                                                                                                         | Screen purpose                              | Screenshot or image reference                                           | Notes                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Current Duolingo web entry](https://www.duolingo.com/learn)                                                                                                                      | Public entry and marketing                  | Inspected live; not stored in this repository                           | Sparse split hero, paired CTA stack, large whitespace reserve                       |
| [Header-anchor image](https://storage.ghost.io/c/7a/33/7a33d0f4-927d-4fe8-a6bf-96131b5e76d4/content/images/2026/01/10.-Caption.-Consistent-header-size-and-title-placement-1.png) | Header system                               | Remote official image                                                   | Different header heights preserve one title origin                                  |
| [Spacing comparison image](https://storage.ghost.io/c/7a/33/7a33d0f4-927d-4fe8-a6bf-96131b5e76d4/content/images/2026/01/11.-Caption.-Cleaned-up-visual-spacing-1.png)             | Before and after spacing                    | Remote official image                                                   | Containers are removed when whitespace can express grouping                         |
| [Frontend prediction](https://blog.duolingo.com/frontend-prediction/)                                                                                                             | Learning path and optimistic feedback       | Official path and completion images; not stored                         | Completed, active, and locked path states; fast perceived response                  |
| [Home screen path redesign](https://blog.duolingo.com/new-duolingo-home-screen-design/)                                                                                           | Linear learning path                        | Official before/after images; not stored                                | A guided vertical route replaces a free-form skill tree                             |
| [Practice tab](https://blog.duolingo.com/guide-to-duolingo-practice-hub/)                                                                                                         | Intent-based practice choices               | Official practice, matching, listening, and speaking images; not stored | Each activity type has a distinct interaction rather than one generic template      |
| [Explain My Answer](https://blog.duolingo.com/explain-my-answer-now-free/)                                                                                                        | Correct and incorrect feedback              | Official green and red feedback images; not stored                      | Immediate state label, correct answer, optional deeper explanation                  |
| [2025 product highlights](https://blog.duolingo.com/product-highlights/)                                                                                                          | Recent exercise and completion patterns     | Official exercise images; not stored                                    | Tap correction, speaking fallback, flashcards, selective celebration                |
| [Hearing-oriented controls](https://blog.duolingo.com/learning-with-hearing-aids/)                                                                                                | Listening accessibility                     | Official listening, reveal, skip, and settings images; not stored       | Replay, slowed audio, reveal text, defer audio, independent preferences             |
| [Duolingo typography guidance](https://design.duolingo.com/identity/typography)                                                                                                   | Brand typography                            | Official guideline examples; not stored                                 | Feather Bold is proprietary; Nunito is Duolingo's public substitute recommendation  |
| [Duolingo color guidance](https://design.duolingo.com/identity/color)                                                                                                             | Brand color roles                           | Official palette examples; not stored                                   | Brand green and its total color combination must not be reproduced                  |
| [Duolingo shape-language guidance](https://design.duolingo.com/illustration/shape-language)                                                                                       | Illustration construction                   | Official guideline examples; not stored                                 | Few simple shapes, clear silhouettes, minimal detail, and controlled color          |
| [Duolingo imagery guidance](https://design.duolingo.com/identity/imagery)                                                                                                         | Brand imagery and mascot use                | Official guideline examples; not stored                                 | Recognizable imagery is systematic; ClipQuest excludes character behavior           |
| [Duo construction guidance](https://design.duolingo.com/illustration/duo)                                                                                                         | Mascot construction principles              | Official guideline examples; not stored                                 | Simple geometry and silhouette inform only the abstraction boundary                 |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/)                                                                                                                                         | Web accessibility baseline                  | N/A                                                                     | Contrast, focus visibility, captions, target sizing, and status semantics           |

## Current interface observations

### Public web entry

- The page is intentionally sparse and centered inside a wide desktop canvas.
- The primary composition is a two-column hero: one expressive visual and one short value proposition with two stacked actions.
- Primary and secondary actions share dimensions. Visual priority comes from fill, border, and lower-edge depth rather than size.
- The hero remains understandable in one viewport. Supporting material is visually separated from the first decision.
- At narrower widths the columns stack, the visual moves above the message, and actions remain full-width within a bounded content column.
- Marketing navigation is lightweight. It does not compete with the learning action.

ClipQuest adaptation: the signed-out entry will show a real, usable URL field in the first viewport. Account creation remains available but secondary to understanding the paste-to-lesson promise.

### Desktop product shell

- Authenticated web experiences use a persistent left rail so the main learning surface does not move between destinations.
- Navigation combines an icon and a short bold label with a clearly bounded selected state.
- Main content is deliberately narrower than the remaining viewport. Side space prevents the learning path and question UI from becoming a dashboard grid.
- Supplemental progress or account information may occupy a right-side area, but the primary action remains in the main column.

ClipQuest adaptation: desktop Home, Library, and Settings will share a 248 px rail. Lesson and generation routes will use a distraction-free full-width shell instead of carrying the rail into a focused task.

### Learning path and progression

- A unit or section banner introduces the current goal.
- Nodes form a guided vertical route. Completed, current, and locked states are visually unambiguous.
- The active node expands into a clear action rather than making every node equally prominent.
- Progress is reinforced in several places: node state, section position, compact counters, and completion feedback.

ClipQuest adaptation: do not invent a curriculum path or locked content. Existing ClipQuest lessons can form a lightweight mastery trail using only real Not Started, Learning, and Mastered records. Empty users receive an instructional empty state instead of fake nodes.

### Lesson composition

- One task dominates the viewport.
- A compact top row contains exit, continuous progress, and at most one status item.
- Instructions are short and strongly weighted. Supporting context is visually subordinate.
- Answer targets are large and separated. Selection changes border, fill, and depth.
- The bottom action region stays stable. Before checking it is neutral or disabled; after checking it becomes a feedback region with the Continue action.
- Different exercise types use different central interactions. Listening, matching, tap choice, text entry, and ordering are not forced into the same card layout.

ClipQuest adaptation: use the three current generated types—multiple choice, true or false, and short answer—and let the learner choose one or more before import or generation. Ordering is no longer generated or served. Transcript evidence is a disclosure or compact source panel, not a competing main card.

### Correct and incorrect feedback

- Correct feedback uses success color plus an explicit word or icon.
- Incorrect feedback uses error color plus an explicit word, the expected answer, and concise reasoning.
- The feedback surface occupies the lower page region without covering the prompt.
- The action changes from Check to Continue in the same predictable location.
- Deeper explanation is optional. Immediate feedback stays concise.

ClipQuest adaptation: show Correct or Not quite, a semantic icon, the existing backend explanation, and timestamped evidence IDs where available. Color is never the sole indicator.

### Completion

- Celebration is concentrated at meaningful milestones.
- Results are presented as a small set of legible statistics, not an analytics dashboard.
- The primary continuation action is visually dominant.
- Completion updates related progress quickly while server authority remains the source of truth.

ClipQuest adaptation: show only supported values such as score, completed questions, mastery state, and whether a later review is required. Do not invent XP, streak, duration, or daily-goal values.

### Authentication

- Authentication uses a narrow, focused form with large fields and one dominant action.
- Supporting navigation stays at the edges or below the form.
- The user is not shown a product dashboard before the core promise is understood.

ClipQuest adaptation: use the same design system but keep auth visually quieter than Home and the quiz. ClipQuest account auth remains clearly separate from the disabled YouTube-history experiment.

## Estimated measurements

These values are visual estimates from public screenshots and browser inspection. They are implementation targets, not Duolingo source values.

| Element                      |          Observed range |                     ClipQuest decision |
| ---------------------------- | ----------------------: | -------------------------------------: |
| Desktop persistent rail      |              240-270 px |                                 248 px |
| Desktop main reading column  |              600-760 px |      704 px default, 760 px lesson max |
| Desktop wide content region  |             960-1120 px |                                1080 px |
| Primary button height        |                48-54 px |                            56 px |
| Input height                 |                48-56 px |        56 px standard, 62 px URL entry |
| Answer target minimum height |                64-84 px |                                  68 px |
| Frequent icon target         |                44-48 px |                          44 px minimum |
| Card radius                  |                14-20 px | 20 px standard, 24 px feature surfaces |
| Input/button radius          |                12-16 px |                                  16 px |
| Border thickness             |                  2-3 px |  2 px standard, 3 px selected/emphasis |
| Tactile lower edge           |                  3-5 px |                                   4 px |
| Progress track height        |                10-14 px |                                  12 px |
| Desktop feedback region      |              150-210 px |         content-driven, 164 px minimum |
| Major vertical rhythm        |                24-40 px |                            32 px |

## Typography decision

Duolingo's Feather Bold is explicitly bespoke and unavailable to third parties. It will not be copied or bundled.

ClipQuest will keep the already licensed Google Font packages:

- Fredoka 600/700 for short display headings and important interaction labels.
- DM Sans 400/500/700 for body text, metadata, fields, and longer instructions.

Fredoka provides an approachable rounded voice while remaining visually distinct from Feather Bold. DM Sans keeps dense explanatory and bilingual content readable. Chinese falls back to the platform sans stack when a Fredoka glyph is unavailable.

## ClipQuest design-system decisions

### Color roles

Duolingo's official system makes green the dominant brand anchor, white the primary background, dark gray the principal text color, and bright secondary hues semantic. ClipQuest adopts that hierarchy without copying the palette. Its structural green is the original, deeper `#247D49`; its high-priority action green is `#54C878` rather than Duolingo's `#58CC02`.

- Light canvas and surface: `#F7F9F4` and `#FFFFFF`.
- Dark canvas and surface: `#101B15` and `#16231B`.
- Structural green: `#247D49` light and `#84D6A0` dark.
- Action green: `#54C878` light and `#62D687` dark.
- Information and focus: original blues headed by `#246FAE`.
- Success: structural green with explicit copy and iconography.
- Error: `#C53A43` light and `#FF8585` dark.
- Warning: `#B57200` light and `#F3C85C` dark.
- Borders: neutral green-gray, strengthened for selected and focus states.

### Shape and depth

- Buttons and answers use 2 px borders with a 4 px lower edge.
- Pressing removes the lower edge and translates content downward by 3-4 px.
- Standard surfaces use 20 px corners; feature panels use 24 px; controls and answer choices use 16 px corners.
- Shadows are subtle and green-tinted. Depth comes primarily from borders and bottom edges.
- Long pages use whitespace and dividers before adding another card.

### Motion

- 110-180 ms state transitions for press, select, and feedback.
- 220-320 ms route and question transitions.
- Spring motion is reserved for selection confirmation and meaningful completion.
- Continuous motion is limited to honest processing indicators.
- Reduced motion removes translation, bobbing, confetti, and spring overshoot while preserving state changes.

### Original illustration and icon language

- Duolingo's public illustration guidance favors a few simple shapes, recognizable silhouettes, minimal detail, limited colors, and generous negative space. ClipQuest translates those principles into coarse isometric voxel construction rather than copying flat vectors.
- Every product icon is generated as its own still image. The family locks one orthographic three-quarter camera, one module scale, 12-30 visible cuboids, and a 6-14 module dominant span. Canonical artwork uses a transparent background so it can sit naturally on every semantic surface; required launcher backplates use structural green rather than a white field.
- Spring Glow communicates core learning, Blue Cream information and processing, Amber Dusk warnings, Grapefruit errors, and Moon Pearl neutral utilities. Only whole-preset tone shifts are used.
- The learning prism combines a green video frame, a light quiz-card prism, a yellow knowledge marker, and a restrained blue companion block. It has no human or animal traits, moods, poses, or reaction variants.
- The same prism silhouette produces the ClipQuest mark, favicon/PWA art, browser-extension icons, and a responsive Fredoka wordmark lockup through a deterministic derivative script. The primary lockup color-splits `Clip` and `Quest` to distinguish source media from the learning action; symbol-only applications remain reserved for constrained icon surfaces. Canonical generated sources are never resized in place.

## Accessibility observations and requirements

- Keep frequent touch targets at least 44 by 44 points.
- Meet WCAG 2.2 AA contrast. Body text targets 4.5:1 or better.
- Give every icon an accessible label, role, selected state, and predictable order.
- Announce generation stages, answer correctness, and progress changes as status updates.
- Keep focus visible and unobscured on web, including inside the bottom feedback region.
- Provide captions or transcript context for video questions. No core question may require audio alone.
- Preserve keyboard submission and add number-key selection for answer choices where practical.
- Preserve reduced-motion behavior and keep haptics nonessential.
- Keep validation attached to its field with an alert role; do not rely on toast-only form errors.

## Historical pre-rebuild ClipQuest baseline

Baseline screenshots:

- `docs/screenshots/baseline/welcome-desktop.png`
- `docs/screenshots/baseline/welcome-local-light-desktop.png`
- `docs/screenshots/baseline/signup-desktop.png`

Baseline behavior and issues recorded before visual replacement:

- The worktree was clean at `2f6bed1` before screenshots were added.
- `npm ci` completed successfully with the existing npm lockfile.
- The local web app started successfully and rendered `/welcome`.
- All 38 existing Vitest tests passed: 19 API, 14 app, and 5 contracts.
- A typecheck immediately after clean install failed because the ignored generated `packages/contracts/dist/index.d.ts` was stale and omitted `AttemptResumeResponse.mastery`.
- The ordered root build regenerated contracts first; the subsequent workspace typecheck passed.
- `npm run build` passed and exported 23 web routes.
- `npm run cf:dry-run` passed.
- The old visual layer emits warnings for legacy `shadow*` props. The rebuild will use the supported `boxShadow` style.
- The repository has no lint, format, Playwright, Detox, or browser-integration script at baseline.

The baseline counts and limitations above are intentionally historical. As of 2026-08-22, the repository has ESLint, Prettier, Playwright journeys, 66 Vitest tests, complete-transcript integrity contracts, paste-time pre-generation, and learner-selected question types. Use the README release status—not this research baseline—for release decisions.

## Legal-safe adaptation checklist

- Do not use Duolingo logos, names, characters, screenshots, sounds, copy, or proprietary fonts in production.
- Do not reproduce Feather Green or the complete Duolingo color combination.
- Do not draw an owl-like or Duo-like mascot.
- Do not trace official screenshots or illustrations.
- Use public references only to understand interaction principles, hierarchy, and usability patterns.
- Keep all production components independently authored for ClipQuest.
