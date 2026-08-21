# Duolingo UI research for the ClipQuest rebuild

Accessed: 2026-07-31

## Purpose and boundaries

This document records current public Duolingo interface patterns that are useful for rebuilding ClipQuest. It is a product-design study, not permission to copy Duolingo assets.

ClipQuest will independently implement interaction principles such as focused tasks, visible progress, large controls, tactile depth, immediate feedback, and responsive navigation. It will not ship Duolingo screenshots, logos, characters, illustrations, sounds, copy, proprietary fonts, or brand colors.

Authenticated Duolingo screens are cohort- and experiment-dependent. Measurements below are estimates from current public screenshots and live public pages, not extracted proprietary design tokens.

## References

| Reference | Screen purpose | Screenshot or image reference | Notes |
| --- | --- | --- | --- |
| [Current Duolingo web entry](https://www.duolingo.com/learn) | Public entry and marketing | Inspected live; not stored in this repository | Sparse split hero, paired CTA stack, large whitespace reserve |
| [Duolingo App Store listing](https://apps.apple.com/us/app/duolingo-language-lessons/id570060128) | Current iPhone and iPad product screenshots | Official App Store screenshots; not stored | Current native navigation, exercises, and product positioning |
| [Duolingo Google Play listing](https://play.google.com/store/apps/details?id=com.duolingo) | Current Android product screenshots | Official Google Play screenshots; not stored | Current Android lesson and path examples; store slogans are not app UI |
| [Core tabs redesign](https://blog.duolingo.com/core-tabs-redesign/) | 2026 mobile navigation and hierarchy | Official article images; not stored | Consistent title anchors, flatter sections, stronger whitespace, fixed icon tab bar |
| [Six refreshed tabs image](https://storage.ghost.io/c/7a/33/7a33d0f4-927d-4fe8-a6bf-96131b5e76d4/content/images/2026/01/1.-Caption.-Refreshed-bottom-tabs.png) | Side-by-side mobile tab comparison | Remote official image | Home, quest, league, practice/profile, and feed hierarchy |
| [Header-anchor image](https://storage.ghost.io/c/7a/33/7a33d0f4-927d-4fe8-a6bf-96131b5e76d4/content/images/2026/01/10.-Caption.-Consistent-header-size-and-title-placement-1.png) | Header system | Remote official image | Different header heights preserve one title origin |
| [Spacing comparison image](https://storage.ghost.io/c/7a/33/7a33d0f4-927d-4fe8-a6bf-96131b5e76d4/content/images/2026/01/11.-Caption.-Cleaned-up-visual-spacing-1.png) | Before and after spacing | Remote official image | Containers are removed when whitespace can express grouping |
| [Frontend prediction](https://blog.duolingo.com/frontend-prediction/) | Learning path and optimistic feedback | Official path and completion images; not stored | Completed, active, and locked path states; fast perceived response |
| [Home screen path redesign](https://blog.duolingo.com/new-duolingo-home-screen-design/) | Linear learning path | Official before/after images; not stored | A guided vertical route replaces a free-form skill tree |
| [Practice tab](https://blog.duolingo.com/guide-to-duolingo-practice-hub/) | Intent-based practice choices | Official practice, matching, listening, and speaking images; not stored | Each activity type has a distinct interaction rather than one generic template |
| [Explain My Answer](https://blog.duolingo.com/explain-my-answer-now-free/) | Correct and incorrect feedback | Official green and red feedback images; not stored | Immediate state label, correct answer, optional deeper explanation |
| [2025 product highlights](https://blog.duolingo.com/product-highlights/) | Recent exercise and completion patterns | Official exercise images; not stored | Tap correction, speaking fallback, flashcards, selective celebration |
| [Hearing-oriented controls](https://blog.duolingo.com/learning-with-hearing-aids/) | Listening accessibility | Official listening, reveal, skip, and settings images; not stored | Replay, slowed audio, reveal text, defer audio, independent preferences |
| [Duolingo typography guidance](https://design.duolingo.com/identity/typography) | Brand typography | Official guideline examples; not stored | Feather Bold is proprietary; Nunito is Duolingo's public substitute recommendation |
| [Duolingo color guidance](https://design.duolingo.com/identity/color) | Brand color roles | Official palette examples; not stored | Brand green and its total color combination must not be reproduced |
| [Apple UI design tips](https://developer.apple.com/design/tips/) | Native touch and layout guidance | N/A | Use at least 44 by 44 point frequent touch targets |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Web accessibility baseline | N/A | Contrast, focus visibility, captions, target sizing, and status semantics |

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

### 2026 mobile tabs

- Six fixed icon tabs are evenly distributed above the safe area in the official refresh.
- The selected item receives a bounded background or outline treatment rather than relying on color alone.
- Large and compact headers can coexist because titles keep one leading and top anchor.
- Flat sections, alignment, whitespace, and a small number of dividers replace nested cards.
- Cards are retained for actions, progress modules, or content that genuinely needs one boundary.

ClipQuest adaptation: use three labelled destinations, Home, Library, and Settings. Labels improve clarity for this smaller information architecture. Each icon keeps an accessible name and selected state.

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

ClipQuest adaptation: preserve the four real backend types, multiple choice, true or false, ordering, and short answer. Transcript evidence is a disclosure or compact source panel, not a competing main card.

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

| Element | Observed range | ClipQuest decision |
| --- | ---: | ---: |
| Desktop persistent rail | 240-270 px | 248 px |
| Desktop main reading column | 600-760 px | 704 px default, 760 px lesson max |
| Desktop wide content region | 960-1120 px | 1080 px |
| Mobile horizontal gutter | 20-24 px | 20 px under 480 px, 24 px on tablet |
| Primary button height | 48-54 px | 52 px mobile, 56 px desktop |
| Input height | 48-56 px | 56 px standard, 62 px URL entry |
| Answer target minimum height | 64-84 px | 68 px |
| Frequent icon target | 44-48 px | 44 px minimum |
| Card radius | 14-20 px | 16 px standard, 22 px feature surfaces |
| Input/button radius | 12-16 px | 14 px |
| Border thickness | 2-3 px | 2 px standard, 3 px selected/emphasis |
| Tactile lower edge | 3-5 px | 4 px |
| Progress track height | 10-14 px | 12 px |
| Desktop feedback region | 150-210 px | content-driven, 164 px minimum |
| Mobile navigation | 64-78 px plus safe area | 68 px plus bottom inset |
| Major vertical rhythm | 24-40 px | 32 px desktop, 24 px mobile |

## Typography decision

Duolingo's Feather Bold is explicitly bespoke and unavailable to third parties. It will not be copied or bundled.

ClipQuest will keep the already licensed Expo Google Font packages:

- Fredoka 600/700 for short display headings and important interaction labels.
- DM Sans 400/500/700 for body text, metadata, fields, and longer instructions.

Fredoka provides an approachable rounded voice while remaining visually distinct from Feather Bold. DM Sans keeps dense explanatory and bilingual content readable. Chinese falls back to the platform sans stack when a Fredoka glyph is unavailable.

## ClipQuest design-system decisions

### Color roles

ClipQuest will not reproduce Duolingo's recognizable green-white-gray combination. The system keeps ClipQuest's existing deep-indigo identity and shifts lime to a controlled action accent.

- Canvas: cool mist and deep midnight equivalents for light and dark themes.
- Primary brand: indigo for structure, navigation, and selected surfaces.
- Action accent: electric lime for the single highest-priority action.
- Secondary accent: clear sky blue for information and active progress.
- Success: emerald distinct from the action lime.
- Error: warm coral-red.
- Warning: amber.
- Borders: cool gray-blue with stronger selected variants.

### Shape and depth

- Buttons and answers use 2 px borders with a 4 px lower edge.
- Pressing removes the lower edge and translates content downward by 3-4 px.
- Standard surfaces use 16 px corners; feature panels use 22 px; icon controls may be circular.
- Shadows are subtle and cool-tinted. Depth comes primarily from borders and bottom edges.
- Long pages use whitespace and dividers before adding another card.

### Motion

- 110-180 ms state transitions for press, select, and feedback.
- 220-320 ms route and question transitions.
- Spring motion is reserved for selection confirmation and meaningful completion.
- Continuous motion is limited to honest processing indicators.
- Reduced motion removes translation, bobbing, confetti, and spring overshoot while preserving state changes.

### Original illustration language

- ClipQuest imagery uses a small film-clip explorer and abstract learning sparks, not birds or Duolingo characters.
- Silhouettes, face construction, poses, colors, and animation timing must remain independent.
- Generated or original assets are stored under ClipQuest-owned names and never use Duolingo screenshots as production material.

## Accessibility observations and requirements

- Keep frequent touch targets at least 44 by 44 points.
- Meet WCAG 2.2 AA contrast. Body text targets 4.5:1 or better.
- Give every icon an accessible label, role, selected state, and predictable order.
- Announce generation stages, answer correctness, and progress changes as status updates.
- Keep focus visible and unobscured on web, including inside the bottom feedback region.
- Provide captions or transcript context for video questions. No core question may require audio alone.
- Preserve keyboard submission and add number-key selection for answer choices where practical.
- Preserve reduced-motion behavior and keep haptics nonessential.
- Ensure fixed mobile controls respect bottom safe-area insets and do not cover scrollable content.
- Keep validation attached to its field with an alert role; do not rely on toast-only form errors.

## Pre-rebuild ClipQuest baseline

Baseline screenshots:

- `docs/screenshots/baseline/welcome-desktop.png`
- `docs/screenshots/baseline/welcome-local-light-desktop.png`
- `docs/screenshots/baseline/signup-desktop.png`

Baseline behavior and issues recorded before visual replacement:

- The worktree was clean at `2f6bed1` before screenshots were added.
- `npm ci` completed successfully with the existing npm lockfile.
- The local Expo web app started successfully and rendered `/welcome`.
- All 38 existing Vitest tests passed: 19 API, 14 app, and 5 contracts.
- A typecheck immediately after clean install failed because the ignored generated `packages/contracts/dist/index.d.ts` was stale and omitted `AttemptResumeResponse.mastery`.
- The ordered root build regenerated contracts first; the subsequent workspace typecheck passed.
- `npm run build` passed and exported 23 web routes.
- `npm run cf:dry-run` passed.
- The old visual layer emits Expo warnings for legacy `shadow*` props. The rebuild will use the supported `boxShadow` style.
- The repository has no lint, format, Playwright, Detox, or browser-integration script at baseline.

## Legal-safe adaptation checklist

- Do not use Duolingo logos, names, characters, screenshots, sounds, copy, or proprietary fonts in production.
- Do not reproduce Feather Green or the complete Duolingo color combination.
- Do not draw an owl-like or Duo-like mascot.
- Do not trace official screenshots or illustrations.
- Use public references only to understand interaction principles, hierarchy, and usability patterns.
- Keep all production components independently authored for ClipQuest.

