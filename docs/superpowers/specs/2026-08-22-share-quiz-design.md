# Share a quest (quiz share links) — design

Date: 2026-08-22
Status: approved in brainstorming; ready for an implementation plan

## Goal

Let a learner (or a teacher) hand a finished ClipQuest quest to someone else
with one link. The recipient sees a public preview of the quest — what lesson
it covers, how many questions, which concepts — and can take the **same
validated question bank** as their own quest, with the full ClipQuest loop
(retrieval practice, immediate feedback, adaptive retries, recap, mastery,
cheat sheet).

This is roadmap item 3 in `docs/HACKATHON.md` §8 ("Teacher sharing — publish a
quest link so a class works the same validated bank"). The dashboard of
commonly-missed concepts stays future work; this design only lays the data it
will need.

## Decisions recorded from brainstorming

| Question | Decision |
| --- | --- |
| What is shared? | The question bank (not a score card). |
| Recipient experience | Public preview page + "Start this quest"; starting requires a ClipQuest account and copies the bank into the recipient's Library. |
| Scope priority | Web demo first. Native gets minimal compatibility: links open to the preview route; the share button uses the one-line React Native `Share` API. No native share-sheet design work. |
| Mechanics | Share token + copy-on-claim (approach A). No cross-user reads of `quiz_banks`/`attempts`; `apps/api/src/routes/quizzes.ts` is not modified. |
| Link lifecycle | One stable link per quiz (idempotent create). No revoke, no expiry, no claim counter in v1. |
| Preview content | Title, thumbnail, YouTube link, sharer display name, language, question count and types, concept titles (max 12). **No question text, no answers.** |
| If the recipient already has a bank for the same video | Still clone; the clone becomes the newest passed bank for that video. The same share claimed twice by the same user returns the same clone. |
| Owner opens their own link | Claim returns the original `quizId`; nothing is cloned. |
| OG/Twitter tags on the preview | Deferred (follow-up can inject `<head>` tags in the Worker shell interception in `apps/api/src/index.ts`). |

## Why copy-on-claim

Every ClipQuest table is owner-scoped: `videos` has
`UNIQUE(owner_id, source, source_video_id)`, `quiz_banks.user_id`,
`attempts.user_id`, `mastery(user_id, video_id)`, and the Library query is
`WHERE v.owner_id = ?`. Letting attempts reference another user's bank would
require relaxing ownership checks across `quizzes.ts` (1.7k lines: start,
answer, resume, generation claims), cheat sheets, reviews and the Library
query. Cloning keeps every invariant: the recipient's copy is an ordinary
bank that the existing `POST /api/quizzes/:quizId/start` accepts unchanged.

Feasibility checks done during design:

- `readProgressiveGenerationSnapshot` returns a normal snapshot for a bank
  with zero `quiz_generation_call_events` rows (`call_count = 0`,
  `active_call_count = 0`), so a cloned bank with `quality_status = 'passed'`
  and the source's `quality_summary_json` starts through the existing handler.
  The non-progressive extension import (`POST /api/quiz-imports`) already
  creates banks of exactly that shape.
- `GET /api/videos/:videoId/thumbnail` (`thumbnailRouter`) is mounted before
  the `authenticated` middleware and does not check the caller, so the public
  preview can use the sharer's thumbnail URL.
- The extension gate (`routeRequiresClipQuestExtension`) only covers `/`,
  `/welcome`, `/create/*`, `/generation/*`; a generated quiz is playable on
  web without the extension, so recipients do not need it.

## Data model

New migration `apps/api/migrations/0026_quiz_shares.sql`:

```sql
CREATE TABLE IF NOT EXISTS quiz_shares (
  id TEXT PRIMARY KEY NOT NULL,            -- the public token (createId() UUID)
  quiz_id TEXT NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE(quiz_id)
);

CREATE TABLE IF NOT EXISTS quiz_share_claims (
  share_id TEXT NOT NULL REFERENCES quiz_shares(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  quiz_id TEXT NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE, -- recipient's clone
  created_at INTEGER NOT NULL,
  PRIMARY KEY(share_id, user_id)
);
CREATE INDEX IF NOT EXISTS quiz_share_claims_quiz_idx ON quiz_share_claims(quiz_id);
```

- The token is the row id: a `crypto.randomUUID()` from `createId()` (122 bits
  of entropy, and it matches the `[0-9a-f-]+` shape the deep-link matcher
  already accepts for `/quiz/:id`).
- No new column on `quiz_banks`. A future "commonly missed concepts" view
  joins `quiz_share_claims.quiz_id` to the recipients' attempts.
- Deleting the owner's bank cascades the share (links 404) but leaves every
  recipient clone intact. Deleting a recipient clone cascades the claim row,
  so the recipient could claim again.

## Contracts (`packages/contracts/src/index.ts`)

```ts
export const QuizShareResponseSchema = z.object({
  token: z.string().uuid(),
  url: httpUrl,                       // `${APP_ORIGIN}/s/${token}`
});

export const QuizSharePreviewSchema = z.object({
  token: z.string().uuid(),
  title: z.string(),
  originalUrl: httpUrl,
  thumbnailUrl: z.string().url(),     // `${APP_ORIGIN}/api/videos/${sharerVideoId}/thumbnail`
  sharedBy: z.string().nullable(),    // sharer's display name (user.name)
  language: z.string(),
  sessionLength: SessionLengthSchema,
  questionCount: z.number().int().nonnegative(),
  questionTypes: z.array(QuizQuestionTypeSchema),
  concepts: z.array(z.string()).max(12),
});

export const QuizShareStartSettingsSchema = z.object({
  sessionLength: SessionLengthSchema,
  questionTypes: QuizQuestionTypesSchema.optional(),
  questionCount: QuestionCountSchema.optional(),
});

export const QuizShareClaimResponseSchema = z.object({
  quizId: z.string().uuid(),
  videoId: z.string().uuid(),
  startSettings: QuizShareStartSettingsSchema,
});
```

`startSettings` carries `questionCount` explicitly because the clone must be
startable for `sessionLength: "custom"` banks (`QuizStartRequestSchema`
requires `questionCount` there). Observation, out of scope for this work:
`LibraryCardSchema.startSettings` has no `questionCount`, so reopening a
custom-count bank from the Library currently sends `custom` without a count.

## API (`apps/api/src/routes/shares.ts`)

Two Hono routers so the preview can be public while everything else sits
behind `authenticated`:

| Route | Auth | Behaviour |
| --- | --- | --- |
| `POST /api/quizzes/:quizId/share` | user | Rate limit `quiz-share:<userId>` 30/min. Load `quiz_banks` `WHERE id = ? AND user_id = ? AND quality_status = 'passed' AND pipeline_version IN (7, 9)`; 404 `quiz_not_found` otherwise. `INSERT INTO quiz_shares … ON CONFLICT(quiz_id) DO NOTHING`, then `SELECT id` → `QuizShareResponseSchema`. |
| `GET /api/shares/:token` | **public** | Rate limit `quiz-share-preview:<cf-connecting-ip ?? "unknown">` 60/min (same header use as `videos.ts:401`). Join `quiz_shares → quiz_banks (passed, pipeline 7/9) → videos → user`; `SELECT type, COUNT(*) … GROUP BY type` over `questions`; concept titles from `concepts_json` (`title` field, first 12). 404 `share_not_found` when the token is unknown or the bank is no longer passed. |
| `POST /api/shares/:token/claim` | user | Rate limit `quiz-share-claim:<userId>` 20/min. (1) Existing `quiz_share_claims` row whose clone still exists → return it. (2) `owner_id === user.id` → return the original bank. (3) Otherwise clone (below). |

Clone algorithm (step 3):

1. Read the source bank row (all columns), the source video row and the
   source `questions` rows (`ORDER BY ordinal`).
2. Recipient video: `SELECT id FROM videos WHERE owner_id = ? AND source = ?
   AND source_video_id = ?`. If missing, the batch inserts a new row copying
   `source, source_video_id, original_url, title, thumbnail_remote_url,
   duration_seconds, source_language, caption_source_category,
   caption_segment_count, caption_word_count, source_metadata_verified_at`
   with `origin = 'paste'`, `education_status` copied, `thumbnail_key = NULL`
   (the thumbnail route re-caches from `thumbnail_remote_url`). If present, the
   existing row is reused untouched.
3. New ids via `createId()` for the bank and for every question (question ids
   must be UUIDs for `PublicQuestionSchema`; SQLite cannot mint them inside
   `INSERT … SELECT`).
4. One `db.batch([...])` (atomic, the same pattern as
   `quiz-imports.ts` `storeImportedQuiz`):
   - optional `videos` insert;
   - `quiz_banks` insert copying `language, session_length, primer,
     concepts_json, watched, pipeline_version, quality_status = 'passed',
     quality_summary_json, assessment_rationale` with `user_id = recipient`,
     `video_id = recipient video`, `import_key = NULL`, `origin = 'quest'`,
     `affects_mastery = 1`, `workplace_thread_id = NULL`, `created_at = now`;
   - one `questions` insert per source row copying every column except
     `id`/`quiz_id` (`ordinal, source_question_id, type, concept_id, prompt,
     reformulated_prompt, options_json, items_json, correct_answer_json,
     rubric_json, explanation, evidence_segment_ids_json, difficulty,
     generation_metadata_json`);
   - `INSERT INTO mastery (user_id, video_id, state, updated_at) VALUES (?, ?,
     'not_started', ?) ON CONFLICT DO NOTHING`;
   - `INSERT INTO quiz_share_claims (share_id, user_id, quiz_id, created_at)`.
   Any write with `meta.changes !== 1` (except the mastery upsert) → 409
   `quiz_share_claim_rejected`; D1 rolls the batch back.
5. Response `startSettings`: `progressiveLibraryStartSettings(...)` from
   `routes/library.ts` for pipeline-9 banks (gives `sessionLength`,
   `questionTypes`, and `questionCount` for custom); `{ sessionLength }` for
   pipeline-7 banks.

Worker wiring in `apps/api/src/index.ts`:

```ts
app.route("/api/videos", thumbnailRouter);
app.route("/api/shares", publicSharesRouter);   // GET /:token only
app.use("/api/*", authenticated);
…
app.route("/api", quizzesRouter);
app.route("/api", sharesRouter);                // POST /quizzes/:quizId/share, POST /shares/:token/claim
```

`apps/api/src/lib/asset-shell.ts` gains
`[/^\/s\/[^/]+$/, "/s/[token].html"]` so a direct open or reload of
`https://clipquest.ccwu.cc/s/<token>` serves the app shell. The Expo static
export must emit `s/[token].html`; if `apps/app/scripts/verify-web-assets`
enumerates route shells, add it there too.

## Client

### Shared helper `apps/app/src/lib/quiz-share.ts`

- `createQuizShareLink(quizId): Promise<{ token; url }>` → `POST /api/quizzes/:quizId/share`.
- `shareQuizLink({ url, title }, deps?): Promise<"shared" | "copied">`:
  - web: `navigator.share` when available (mobile browsers), otherwise
    `navigator.clipboard.writeText` with `expo-clipboard` as fallback;
  - native: `Share.share({ message: url, url, title })`.
  Dependencies (`navigator`, `Share`) are injectable for unit tests. Throws on
  failure so callers can show the URL as a selectable fallback.

### Entry points

1. **Completion screen** (`apps/app/app/quiz/[attemptId].tsx`): a
   `PrimaryButton variant="secondary"` "Share this quest" (testID
   `share-quest`) between "Download PDF" and "Return to library". `quizId`
   comes from the resume response (already held in
   `cheatSheetContextRef.current.quizId`). Success flips the label to "Link
   copied" for ~2 s (or stays on "Shared" for the native sheet). Failure shows
   the message in the existing error slot; if the failure is clipboard access,
   also render the URL as selectable text beneath the button.
2. **Library card** (`apps/app/src/components/VideoCard.tsx`): optional
   `onShare?()` prop; when provided and `card.quizId` is non-null, a third icon
   action (existing `VoxelIcon name="link"`) next to the notes action.
   `apps/app/app/(tabs)/library.tsx` wires it to the same helper and surfaces
   errors through the existing alert pattern.

### Preview / claim route `apps/app/app/s/[token].tsx`

Top-level route (outside `(tabs)` and `(auth)`), so it is not gated by the
tab auth redirect or the extension gate. `Screen contentWidth="reading"
centered`.

- Load `GET /api/shares/:token` → states: loading → not found
  (`EmptyState` "This link is no longer available" + Home) / error
  (`EmptyState` + Retry) / ready.
- Ready content: `ReliableThumbnail`, title, "Shared by X" (omitted when
  `sharedBy` is null), meta line (N questions · types · language), concept
  chips, "Watch the lesson on YouTube" external link, CTA block.
- CTA by `useAppSession()`:
  - signed in → "Start this quest": `POST claim` → `POST
    /api/quizzes/:quizId/start` with `{ mode: "learn", ...startSettings }`
    and an `Idempotency-Key` (same as `useOpenVideoCard`) →
    `saveAttemptStart(userId, start)` → `router.replace("/quiz/[attemptId]")`.
    A 401 here routes to sign-in with `next`.
  - signed out → "Sign in to start" → `/(auth)/sign-in?next=/s/<token>`;
    secondary "Create account" → `/(auth)/sign-up?next=/s/<token>`.

### `next` return path

New `apps/app/src/lib/auth-next.ts`:
`parseNextPath(params): string | null` accepts only `^/s/[0-9a-f-]+$`
(allow-list; anything else is dropped). `sign-in.tsx` and `sign-up.tsx` read
it with `useLocalSearchParams`, keep it on the links that switch between the
two screens (the way `quickOpen` params are kept today), and on success call
`router.replace(next ?? "/(tabs)")`. `sign-up.tsx` forwards `next` to
`verify-email`, whose "back to sign in" button forwards it again.

### Native minimal compatibility

- `apps/app/src/navigation/native-deep-links.ts`: `/s/<token>` →
  `` `/s/${token}` `` (add to `NativeDeepLinkRoute`).
- `apps/api/src/lib/apple-app-site-association.ts`: add `/s/*`.
- `apps/app/app.config.ts` Android intent filters: add `pathPrefix: "/s/"`.

### i18n

`apps/app/src/i18n/messages.ts`, en + zh-CN: `shareQuest`, `shareLinkCopied`,
`shareLinkShared`, `shareFailed`, `shareCopyManually`, `sharedBy`,
`startSharedQuest`, `signInToStart`, `createAccountToStart`,
`shareNotFoundTitle`, `shareNotFoundBody`, `shareLoadFailed`, `watchLesson`,
`sharePreviewQuestions` (pluralised by interpolation as existing keys do).

## Security and failure handling

- Public surface is only `GET /api/shares/:token`; tokens are UUIDs; the
  response exposes title, YouTube URL, sharer display name, language, counts,
  types and concept titles — never question text or answers. Showing the
  sharer's display name is deliberate ("Shared by …" matters for a class).
- Claim has no body and is idempotent by primary key; no `Idempotency-Key`
  needed. `authenticated` already enforces verified email and bans.
- Server errors: unknown token / unpassed bank → 404 `share_not_found`;
  non-atomic batch → 409 `quiz_share_claim_rejected`; rate limits → 429.
- Client errors: share creation failure → inline message; clipboard denied →
  selectable URL fallback; preview 404 → empty state; network error → retry;
  expired session on "Start" → sign-in with `next`.
- `next` allow-list prevents open redirects.

## Testing

- **API (vitest)** — new `apps/api/test/shares.test.ts` using an in-memory
  SQLite D1 adapter. Extract the `SqliteD1Adapter` class from
  `progressive-answer-race.test.ts` into `apps/api/test/support/sqlite-d1.ts`
  for the new test (existing tests keep their inline copies). Cases: create is
  idempotent (same token twice); non-owned / non-passed bank → 404; preview
  shape and **no question text**; unknown token → 404; claim clones bank and
  questions (same count, new ids, identical content and
  `quality_summary_json`), inserts the recipient video when missing and reuses
  it when present, inserts `mastery`, second claim returns the same `quizId`,
  owner claim returns the original `quizId`; rate limit → 429.
  `asset-shell.test.ts` and `apple-app-site-association.test.ts` get `/s/…`
  cases.
- **App (vitest)** — `quiz-share.test.ts` (web share / clipboard / native
  branches via injected deps), `auth-next.test.ts` (allow-list),
  `native-deep-links.test.ts` (`/s/:token` positive and negative cases).
- **E2E (Playwright, mocked API like the existing journeys)** — one journey:
  finish a quiz → "Share this quest" → `POST /api/quizzes/:id/share` observed
  and the clipboard receives the URL → open `/s/<token>` signed out → preview
  renders → "Sign in to start" → mocked sign-in → back on `/s/<token>` →
  "Start this quest" → mocked claim + start → lands on `/quiz/<attemptId>`.
- Completion gate: `npm run lint`, `npm run format:check`, `npm run
  typecheck`, `npm run test`, `npm run test:e2e` (sequentially on this
  machine), then `git checkout -- apps/app/public/clipquest-captions-extension.zip`.

## Documentation and release

- `docs/HACKATHON.md`: move the link-share + claim half of §8 item 3 into §4
  "What is built and verified"; keep the missed-concept dashboard in §8.
- `README.md`: one feature line for quest sharing.
- `docs/PRODUCTION-RELEASE.md`: record migration `0026_quiz_shares.sql`; D1
  migration must be applied (`npm run db:migrate:remote`) before the Worker
  deploy. The migration is additive and backward compatible; a Worker
  rollback leaves the two new tables unused.

## Out of scope (v1)

Revoking or expiring links, claim counts, teacher dashboard, OG/Twitter tag
injection, Workplace-side sharing, native share-sheet polish, sharing from the
quiz-in-progress header.
