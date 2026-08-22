# Share a Quest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a learner publish one stable link for a finished quest; anyone can preview it publicly and a signed-in recipient gets their own copy of the validated question bank and starts it.

**Architecture:** Share token + copy-on-claim. Two new D1 tables (`quiz_shares`, `quiz_share_claims`), one new Hono router file with a public preview endpoint mounted before `authenticated` and two authenticated endpoints (create link, claim). The claim clones the owner's bank, questions and video metadata into the recipient's account in one atomic `db.batch`, so the existing `POST /api/quizzes/:quizId/start` works unchanged. The Expo app gets a share helper, a public `/s/[token]` route, a `next` return path through sign-in/sign-up, and share entry points on the completion screen and Library card.

**Tech Stack:** Cloudflare Worker (Hono, D1, TypeScript), Zod contracts package, Expo Router / React Native (web-first), vitest (`node:sqlite` in-memory D1 adapter), Playwright with mocked API routes.

**Spec:** `docs/superpowers/specs/2026-08-22-share-quiz-design.md`

## Global Constraints

- Work ONLY inside the worktree `E:\HHCC2026\.claude\worktrees\share-quiz` (branch `share-quiz`). The main checkout `E:\HHCC2026` has the user's uncommitted UI work mid-rebase — never run git or edits there.
- Node `>=22.13.0`, npm `>=10` (already installed in the worktree; `npm ci` was run).
- `@clipquest/contracts` is consumed from `packages/contracts/dist` — after ANY change to `packages/contracts/src/index.ts` run `npm run build -w @clipquest/contracts` before API/app typecheck or tests.
- Files are LF (`.gitattributes` forces `* text=auto eol=lf`; `core.autocrlf=false`). Prettier must pass: run `npx prettier --write <files>` on every file you touch before committing.
- ESLint runs with `--max-warnings 0` (`npm run lint`). No unused imports/vars.
- `t(key)` in the app has NO interpolation: compose strings in code; every key must exist in BOTH `en` and `zh-CN` in `apps/app/src/i18n/messages.ts` (`MessageKey` is derived from `en`).
- Only three question types exist: `multiple_choice`, `true_false`, `short_answer` (i18n keys `multipleChoice`, `trueFalse`, `shortAnswer`).
- Pipeline versions that can be shared/started: `7` (legacy) and `LOCAL_QUIZ_PIPELINE_VERSION` (= 9) with `quality_status = 'passed'`.
- Do NOT modify `apps/api/src/routes/quizzes.ts`. Do NOT restyle `VideoCard.tsx` spacing (the user's concurrent UI pass owns that); only add the share action block.
- Do not use `cd dir && …` compound shell commands (the worktree guard rejects them). Use `npm exec -w <pkg> -- <cmd>` / `npm run <script> -w <pkg>` from the worktree root.
- Commit after every task with the trailer lines:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa`
- Playwright needs the Expo web server (system Chrome via `channel: "chrome"`). Run it alone (no vitest/lint in parallel), and afterwards run `git checkout -- apps/app/public/clipquest-captions-extension.zip`.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `apps/api/migrations/0026_quiz_shares.sql` | New tables `quiz_shares`, `quiz_share_claims` (Task 1) |
| `packages/contracts/src/index.ts` | `QuizShareResponseSchema`, `QuizSharePreviewSchema`, `QuizShareStartSettingsSchema`, `QuizShareClaimResponseSchema` (Task 1) |
| `packages/contracts/test/quiz-share.test.ts` | Contract shape tests (Task 1) |
| `apps/api/test/support/sqlite-d1.ts` | Reusable in-memory D1 adapter for API tests (Task 2) |
| `apps/api/src/routes/shares.ts` | `publicSharesRouter` (GET preview), `sharesRouter` (POST create, POST claim), helpers `shareUrl`, `previewConcepts`, `shareStartSettings` (Tasks 2–4) |
| `apps/api/test/shares.test.ts` | Route tests for create / preview / claim (Tasks 2–4) |
| `apps/api/src/index.ts`, `apps/api/src/lib/asset-shell.ts`, `apps/api/src/lib/apple-app-site-association.ts` (+ tests) | Worker wiring, `/s/:token` shell, AASA path (Task 5) |
| `apps/app/src/lib/quiz-share.ts` (+ `apps/app/test/quiz-share.test.ts`) | `createQuizShareLink`, `shareQuizLink` (Task 6) |
| `apps/app/src/lib/auth-next.ts` (+ test), `apps/app/app/(auth)/sign-in.tsx`, `sign-up.tsx`, `verify-email.tsx` | `next` return path (Task 7) |
| `apps/app/src/navigation/native-deep-links.ts` (+ test), `apps/app/app.config.ts` | Native minimal compatibility (Task 8) |
| `apps/app/src/i18n/messages.ts`, `apps/app/app/quiz/[attemptId].tsx` | i18n keys + completion-screen share button (Task 9) |
| `apps/app/src/components/VideoCard.tsx`, `apps/app/app/(tabs)/library.tsx` | Library card share action (Task 10) |
| `apps/app/app/s/[token].tsx` | Public preview + claim route (Task 11) |
| `e2e/clipquest.spec.ts` | Share journey (Task 12) |
| `docs/HACKATHON.md`, `README.md`, `docs/PRODUCTION-RELEASE.md` | Docs (Task 13) |

---

### Task 1: Migration and contracts

**Files:**
- Create: `apps/api/migrations/0026_quiz_shares.sql`
- Modify: `packages/contracts/src/index.ts` (insert after `LibraryResponseSchema` / `export type LibraryResponse`, around line 2978)
- Create: `packages/contracts/test/quiz-share.test.ts`

**Interfaces:**
- Produces: `QuizShareResponseSchema { token: uuid; url: httpUrl }`, `QuizSharePreviewSchema`, `QuizShareStartSettingsSchema { sessionLength; questionTypes?; questionCount? }`, `QuizShareClaimResponseSchema { quizId; videoId; startSettings }` and the inferred types `QuizShareResponse`, `QuizSharePreview`, `QuizShareStartSettings`, `QuizShareClaimResponse`.

- [ ] **Step 1: Write the failing contract test**

Create `packages/contracts/test/quiz-share.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  QuizShareClaimResponseSchema,
  QuizSharePreviewSchema,
  QuizShareResponseSchema,
} from "../src/index";

const TOKEN = "9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a";
const QUIZ_ID = "33333333-3333-4333-8333-333333333333";
const VIDEO_ID = "11111111-1111-4111-8111-111111111111";

describe("quiz share contracts", () => {
  it("accepts a share link response", () => {
    expect(
      QuizShareResponseSchema.parse({
        token: TOKEN,
        url: `https://clipquest.ccwu.cc/s/${TOKEN}`,
      }),
    ).toEqual({ token: TOKEN, url: `https://clipquest.ccwu.cc/s/${TOKEN}` });
    expect(() =>
      QuizShareResponseSchema.parse({ token: "nope", url: "javascript:x" }),
    ).toThrow();
  });

  it("keeps the public preview free of question text", () => {
    const preview = QuizSharePreviewSchema.parse({
      token: TOKEN,
      title: "How memory really works",
      originalUrl: "https://www.youtube.com/watch?v=SVb9OV0bLzI",
      thumbnailUrl: `https://clipquest.ccwu.cc/api/videos/${VIDEO_ID}/thumbnail`,
      sharedBy: "Avery Learner",
      language: "en",
      sessionLength: "short",
      questionCount: 5,
      questionTypes: ["multiple_choice", "short_answer"],
      concepts: ["Retrieval practice", "Spacing"],
    });
    expect(Object.keys(preview).sort()).toEqual([
      "concepts",
      "language",
      "originalUrl",
      "questionCount",
      "questionTypes",
      "sessionLength",
      "sharedBy",
      "thumbnailUrl",
      "title",
      "token",
    ]);
    expect(() =>
      QuizSharePreviewSchema.parse({
        ...preview,
        concepts: Array.from({ length: 13 }, (_, index) => `c${index}`),
      }),
    ).toThrow();
  });

  it("carries custom question counts in claim start settings", () => {
    expect(
      QuizShareClaimResponseSchema.parse({
        quizId: QUIZ_ID,
        videoId: VIDEO_ID,
        startSettings: {
          sessionLength: "custom",
          questionTypes: ["true_false"],
          questionCount: 7,
        },
      }).startSettings,
    ).toEqual({
      sessionLength: "custom",
      questionTypes: ["true_false"],
      questionCount: 7,
    });
    expect(
      QuizShareClaimResponseSchema.parse({
        quizId: QUIZ_ID,
        videoId: VIDEO_ID,
        startSettings: { sessionLength: "medium" },
      }).startSettings,
    ).toEqual({ sessionLength: "medium" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm exec -w @clipquest/contracts -- vitest run test/quiz-share.test.ts`
Expected: FAIL — `QuizShareResponseSchema` is not exported.

- [ ] **Step 3: Add the schemas to contracts**

In `packages/contracts/src/index.ts`, directly after
`export type LibraryResponse = z.infer<typeof LibraryResponseSchema>;` add:

```ts
export const QuizShareResponseSchema = z.object({
  token: z.string().uuid(),
  url: httpUrl,
});
export type QuizShareResponse = z.infer<typeof QuizShareResponseSchema>;

// Public preview of a shared quest. Deliberately no question text and no
// answers: the recipient only learns what the quest covers before claiming it.
export const QuizSharePreviewSchema = z.object({
  token: z.string().uuid(),
  title: z.string(),
  originalUrl: httpUrl,
  thumbnailUrl: z.string().url(),
  sharedBy: z.string().nullable(),
  language: z.string(),
  sessionLength: SessionLengthSchema,
  questionCount: z.number().int().nonnegative(),
  questionTypes: z.array(QuizQuestionTypeSchema),
  concepts: z.array(z.string()).max(12),
});
export type QuizSharePreview = z.infer<typeof QuizSharePreviewSchema>;

// Mirrors the Library start settings but keeps `questionCount` so a cloned
// custom-length bank can be started with the settings it was generated with.
export const QuizShareStartSettingsSchema = z.object({
  sessionLength: SessionLengthSchema,
  questionTypes: QuizQuestionTypesSchema.optional(),
  questionCount: QuestionCountSchema.optional(),
});
export type QuizShareStartSettings = z.infer<
  typeof QuizShareStartSettingsSchema
>;

export const QuizShareClaimResponseSchema = z.object({
  quizId: z.string().uuid(),
  videoId: z.string().uuid(),
  startSettings: QuizShareStartSettingsSchema,
});
export type QuizShareClaimResponse = z.infer<
  typeof QuizShareClaimResponseSchema
>;
```

- [ ] **Step 4: Create the migration**

Create `apps/api/migrations/0026_quiz_shares.sql`:

```sql
-- Quest sharing: one stable public token per quiz bank, and one claim row per
-- recipient recording the bank that was cloned into their account.
CREATE TABLE IF NOT EXISTS quiz_shares (
  id TEXT PRIMARY KEY NOT NULL,
  quiz_id TEXT NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE(quiz_id)
);

CREATE TABLE IF NOT EXISTS quiz_share_claims (
  share_id TEXT NOT NULL REFERENCES quiz_shares(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  quiz_id TEXT NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(share_id, user_id)
);
CREATE INDEX IF NOT EXISTS quiz_share_claims_quiz_idx
  ON quiz_share_claims(quiz_id);
```

- [ ] **Step 5: Build contracts and run the test**

Run: `npm run build -w @clipquest/contracts && npm exec -w @clipquest/contracts -- vitest run test/quiz-share.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write packages/contracts/src/index.ts packages/contracts/test/quiz-share.test.ts
git add apps/api/migrations/0026_quiz_shares.sql packages/contracts/src/index.ts packages/contracts/test/quiz-share.test.ts
git commit -m "Add quiz share tables and contracts" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa"
```

---

### Task 2: Test support adapter and `POST /api/quizzes/:quizId/share`

**Files:**
- Create: `apps/api/test/support/sqlite-d1.ts`
- Create: `apps/api/src/routes/shares.ts`
- Create: `apps/api/test/shares.test.ts`

**Interfaces:**
- Consumes: `QuizShareResponseSchema` (Task 1), `enforceRateLimit(db, {namespace, identifier, maximum, windowSeconds})`, `createId()`, `now()`, `ApiError(status, code, message)`, `errorResponse`.
- Produces: `export const sharesRouter` with `POST /quizzes/:quizId/share`; `export function shareUrl(origin: string, token: string): string`; test helper `SqliteD1Adapter` (`prepare`, `batch`, `sqlite`, `beforeFirst`) and `createSqliteD1(): { sqlite: DatabaseSync; adapter: SqliteD1Adapter }`.

- [ ] **Step 1: Create the shared D1 test adapter**

Create `apps/api/test/support/sqlite-d1.ts` (verbatim copy of the classes that live inline in `apps/api/test/progressive-answer-race.test.ts`, plus a factory; existing tests keep their inline copies):

```ts
import { DatabaseSync, type StatementSync } from "node:sqlite";

export type BatchResult = { success: true; meta: { changes: number } };

export class SqliteD1Statement {
  constructor(
    private readonly adapter: SqliteD1Adapter,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.adapter, this.sql, params);
  }

  async first<T>(): Promise<T | null> {
    this.adapter.beforeFirst?.(this.sql);
    return (
      (this.statement().get(
        ...(this.params as Parameters<StatementSync["get"]>),
      ) as T | undefined) ?? null
    );
  }

  async all<T>(): Promise<{ results: T[]; success: true }> {
    return {
      results: this.statement().all(
        ...(this.params as Parameters<StatementSync["all"]>),
      ) as T[],
      success: true,
    };
  }

  async run(): Promise<BatchResult> {
    return this.runSync();
  }

  runSync(): BatchResult {
    const result = this.statement().run(
      ...(this.params as Parameters<StatementSync["run"]>),
    );
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  private statement(): StatementSync {
    return this.adapter.sqlite.prepare(this.sql);
  }
}

export class SqliteD1Adapter {
  beforeFirst: ((sql: string) => void) | undefined;

  constructor(readonly sqlite: DatabaseSync) {}

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this, sql);
  }

  async batch(statements: SqliteD1Statement[]): Promise<BatchResult[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

export function createSqliteD1(): {
  sqlite: DatabaseSync;
  adapter: SqliteD1Adapter;
} {
  const sqlite = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: false,
  });
  return { sqlite, adapter: new SqliteD1Adapter(sqlite) };
}
```

- [ ] **Step 2: Write the failing create-link tests**

Create `apps/api/test/shares.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { errorResponse } from "../src/lib/errors";
import type { ApiBindings } from "../src/middleware/authenticated";
import { publicSharesRouter, sharesRouter } from "../src/routes/shares";
import { createSqliteD1, type SqliteD1Adapter } from "./support/sqlite-d1";

const OWNER_ID = "owner-1";
const RECIPIENT_ID = "recipient-1";
const OWNER_VIDEO_ID = "11111111-1111-4111-8111-111111111111";
const BANK_ID = "33333333-3333-4333-8333-333333333333";
const QUESTION_ONE_ID = "55555555-5555-4555-8555-555555555555";
const QUESTION_TWO_ID = "66666666-6666-4666-8666-666666666666";
const UNKNOWN_TOKEN = "9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a";
const APP_ORIGIN = "https://clipquest.test";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readySummary() {
  return {
    source: "extension-local-json-stream",
    importVersion: "extension-progressive-import-v3",
    pipelineVersion: 9,
    model: "deepseek-v4-flash",
    reasoningEffort: "high",
    promptVersion: "quiz-local-json-stream-v5.1",
    validatorVersion: "validator-local-progressive-v4.0",
    generationState: "ready",
    requestedQuestionTypes: ["short_answer"],
    generatedQuestionTypes: Array.from({ length: 15 }, () => "short_answer"),
    plannedCount: 15,
    acceptedCount: 15,
    lastProgressAt: 1_700_000_000_000,
    acceptedQuestionSummaries: Array.from({ length: 15 }, (_, index) => ({
      id: `q${index + 1}`,
      type: "short_answer",
      concept: `Concept ${index + 1}`,
      question: `Question ${index + 1}?`,
    })),
    transcriptStored: false,
    aiCalls: 3,
    retryCount: 0,
    inputTokens: 100,
    outputTokens: 200,
    reasoningTokens: 50,
    elapsedMs: 10_000,
  };
}

function createDatabase() {
  const { sqlite, adapter } = createSqliteD1();
  sqlite.exec(`
    CREATE TABLE api_rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      source TEXT NOT NULL,
      source_video_id TEXT NOT NULL,
      original_url TEXT NOT NULL,
      title TEXT NOT NULL,
      thumbnail_key TEXT,
      thumbnail_remote_url TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      source_language TEXT,
      origin TEXT NOT NULL DEFAULT 'paste',
      education_status TEXT NOT NULL DEFAULT 'unknown',
      caption_source_category TEXT,
      caption_segment_count INTEGER,
      caption_word_count INTEGER,
      source_metadata_verified_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(owner_id, source, source_video_id)
    );
    CREATE TABLE quiz_banks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      language TEXT NOT NULL,
      session_length TEXT NOT NULL,
      primer TEXT NOT NULL,
      concepts_json TEXT NOT NULL,
      watched INTEGER NOT NULL DEFAULT 1,
      pipeline_version INTEGER NOT NULL DEFAULT 1,
      quality_status TEXT NOT NULL DEFAULT 'legacy',
      quality_summary_json TEXT NOT NULL DEFAULT '{}',
      import_key TEXT,
      origin TEXT NOT NULL DEFAULT 'quest',
      affects_mastery INTEGER NOT NULL DEFAULT 1,
      workplace_thread_id TEXT,
      assessment_rationale TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE questions (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      source_question_id TEXT NOT NULL,
      type TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      reformulated_prompt TEXT NOT NULL,
      options_json TEXT,
      items_json TEXT,
      correct_answer_json TEXT,
      rubric_json TEXT,
      explanation TEXT NOT NULL,
      evidence_segment_ids_json TEXT NOT NULL,
      difficulty INTEGER NOT NULL,
      generation_metadata_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(quiz_id, ordinal)
    );
    CREATE TABLE mastery (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'not_started',
      best_score REAL,
      initial_passed_at INTEGER,
      review_passed_at INTEGER,
      next_review_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, video_id)
    );
  `);
  // Run the real migration so the test exercises the shipped DDL.
  sqlite.exec(
    readFileSync(
      resolve(import.meta.dirname, "../migrations/0026_quiz_shares.sql"),
      "utf8",
    ),
  );
  sqlite
    .prepare("INSERT INTO user (id, name) VALUES (?, ?), (?, ?)")
    .run(OWNER_ID, "Avery Learner", RECIPIENT_ID, "Sam Student");
  sqlite
    .prepare(
      `INSERT INTO videos (id, owner_id, source, source_video_id, original_url, title, thumbnail_remote_url, duration_seconds, source_language, education_status, created_at, updated_at)
       VALUES (?, ?, 'youtube', 'SVb9OV0bLzI', 'https://www.youtube.com/watch?v=SVb9OV0bLzI', 'How memory really works', 'https://i.ytimg.com/vi/SVb9OV0bLzI/hqdefault.jpg', 600, 'en', 'educational', 1, 1)`,
    )
    .run(OWNER_VIDEO_ID, OWNER_ID);
  sqlite
    .prepare(
      `INSERT INTO quiz_banks (id, user_id, video_id, language, session_length, primer, concepts_json, watched, pipeline_version, quality_status, quality_summary_json, created_at)
       VALUES (?, ?, ?, 'en', 'long', 'Memory primer', ?, 1, 9, 'passed', ?, 1)`,
    )
    .run(
      BANK_ID,
      OWNER_ID,
      OWNER_VIDEO_ID,
      JSON.stringify([
        {
          id: "c1",
          title: "Retrieval practice",
          summary: "Recalling strengthens memory.",
          evidenceSegmentIds: [],
        },
        {
          id: "c2",
          title: "Spacing",
          summary: "Spread practice out.",
          evidenceSegmentIds: [],
        },
      ]),
      JSON.stringify(readySummary()),
    );
  const insertQuestion = sqlite.prepare(
    `INSERT INTO questions (id, quiz_id, ordinal, source_question_id, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty, generation_metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, '[]', 2, '{"source":"test"}')`,
  );
  insertQuestion.run(
    QUESTION_ONE_ID,
    BANK_ID,
    0,
    "q1",
    "multiple_choice",
    "c1",
    "Why does retrieval practice work?",
    "Explain why recalling beats rereading.",
    JSON.stringify(["Reconstruction", "Shorter videos", "No sleep", "Luck"]),
    "0",
    null,
    "Recalling forces reconstruction.",
  );
  insertQuestion.run(
    QUESTION_TWO_ID,
    BANK_ID,
    1,
    "q2",
    "short_answer",
    "c2",
    "Name one benefit of spacing.",
    "State a benefit of spaced practice.",
    null,
    null,
    JSON.stringify({
      requiredIdeas: ["spacing"],
      acceptableAlternatives: ["Spacing strengthens long-term retention."],
    }),
    "Spacing interrupts forgetting.",
  );
  return { sqlite, adapter };
}

function testApp(adapter: SqliteD1Adapter, userId?: string): Hono<ApiBindings> {
  const app = new Hono<ApiBindings>();
  if (userId) {
    app.use("*", async (context, next) => {
      context.set("user", {
        id: userId,
        email: `${userId}@example.com`,
        name: userId === OWNER_ID ? "Avery Learner" : "Sam Student",
        username: null,
        role: "user",
        banned: false,
      });
      await next();
    });
  }
  app.route("/shares", publicSharesRouter);
  app.route("/", sharesRouter);
  app.onError((error, context) => errorResponse(error, context));
  return app;
}

const env = (adapter: SqliteD1Adapter) =>
  ({ DB: adapter, APP_ORIGIN } as unknown as ApiBindings["Bindings"]);

async function createShare(
  adapter: SqliteD1Adapter,
  userId = OWNER_ID,
  quizId = BANK_ID,
) {
  const response = await testApp(adapter, userId).request(
    `/quizzes/${quizId}/share`,
    { method: "POST" },
    env(adapter),
  );
  return {
    status: response.status,
    body: (await response.json()) as {
      token?: string;
      url?: string;
      error?: { code: string };
    },
  };
}

describe("POST /quizzes/:quizId/share", () => {
  it("creates one stable link per passed bank", async () => {
    const { sqlite, adapter } = createDatabase();
    const first = await createShare(adapter);
    expect(first.status).toBe(200);
    expect(first.body.token).toMatch(UUID);
    expect(first.body.url).toBe(`${APP_ORIGIN}/s/${first.body.token}`);

    const second = await createShare(adapter);
    expect(second.body.token).toBe(first.body.token);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM quiz_shares").get(),
    ).toEqual({ count: 1 });
  });

  it("refuses banks the caller does not own or that are not passed", async () => {
    const { sqlite, adapter } = createDatabase();
    const stranger = await createShare(adapter, RECIPIENT_ID);
    expect(stranger.status).toBe(404);
    expect(stranger.body.error?.code).toBe("quiz_not_found");

    sqlite
      .prepare("UPDATE quiz_banks SET quality_status = 'generating' WHERE id = ?")
      .run(BANK_ID);
    const generating = await createShare(adapter);
    expect(generating.status).toBe(404);
  });

  it("rate limits link creation per user", async () => {
    const { adapter } = createDatabase();
    let last = 0;
    for (let attempt = 0; attempt < 31; attempt += 1) {
      last = (await createShare(adapter)).status;
    }
    expect(last).toBe(429);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm exec -w @clipquest/api -- vitest run test/shares.test.ts`
Expected: FAIL — cannot resolve `../src/routes/shares`.

- [ ] **Step 4: Create the router with the create-link handler**

Create `apps/api/src/routes/shares.ts`:

```ts
import {
  LOCAL_QUIZ_PIPELINE_VERSION,
  QuizShareResponseSchema,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { enforceRateLimit } from "../lib/rate-limit";
import type { ApiBindings } from "../middleware/authenticated";

// Banks that Library selection and `POST /quizzes/:quizId/start` accept.
const LEGACY_LOCAL_QUIZ_PIPELINE_VERSION = 7;

/** Public routes (mounted before `authenticated`). */
export const publicSharesRouter = new Hono<ApiBindings>();
/** Authenticated routes (mounted after `authenticated`). */
export const sharesRouter = new Hono<ApiBindings>();

export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/s/${token}`;
}

sharesRouter.post("/quizzes/:quizId/share", async (c) => {
  const user = c.get("user");
  await enforceRateLimit(c.env.DB, {
    namespace: "quiz-share",
    identifier: user.id,
    maximum: 30,
    windowSeconds: 60,
  });
  const bank = await c.env.DB.prepare(
    "SELECT id FROM quiz_banks WHERE id = ? AND user_id = ? AND quality_status = 'passed' AND pipeline_version IN (?, ?)",
  )
    .bind(
      c.req.param("quizId"),
      user.id,
      LEGACY_LOCAL_QUIZ_PIPELINE_VERSION,
      LOCAL_QUIZ_PIPELINE_VERSION,
    )
    .first<{ id: string }>();
  if (!bank) throw new ApiError(404, "quiz_not_found", "Quiz not found.");

  await c.env.DB.prepare(
    "INSERT INTO quiz_shares (id, quiz_id, owner_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(quiz_id) DO NOTHING",
  )
    .bind(createId(), bank.id, user.id, now())
    .run();
  const share = await c.env.DB.prepare(
    "SELECT id FROM quiz_shares WHERE quiz_id = ?",
  )
    .bind(bank.id)
    .first<{ id: string }>();
  if (!share) {
    throw new ApiError(
      500,
      "quiz_share_unavailable",
      "The share link could not be created.",
    );
  }
  return c.json(
    QuizShareResponseSchema.parse({
      token: share.id,
      url: shareUrl(c.env.APP_ORIGIN, share.id),
    }),
  );
});
```

- [ ] **Step 5: Run the tests**

Run: `npm exec -w @clipquest/api -- vitest run test/shares.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write apps/api/src/routes/shares.ts apps/api/test/shares.test.ts apps/api/test/support/sqlite-d1.ts
git add apps/api/src/routes/shares.ts apps/api/test/shares.test.ts apps/api/test/support/sqlite-d1.ts
git commit -m "Add quiz share link creation endpoint" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa"
```

---

### Task 3: Public preview `GET /api/shares/:token`

**Files:**
- Modify: `apps/api/src/routes/shares.ts`
- Modify: `apps/api/test/shares.test.ts`

**Interfaces:**
- Consumes: `QuizSharePreviewSchema`, `QuizQuestionTypeSchema`, `SessionLengthSchema` (contracts), `createShare` / `createDatabase` / `testApp` / `env` helpers from Task 2's test file.
- Produces: `publicSharesRouter.get("/:token")`; exported pure helpers `previewConcepts(conceptsJson: string): string[]`; internal `loadShare(db, token): Promise<ShareRow | null>` and `ShareRow` type reused by Task 4.

- [ ] **Step 1: Add the failing preview tests**

Append to `apps/api/test/shares.test.ts`:

```ts
describe("GET /shares/:token", () => {
  it("returns the public preview without question text", async () => {
    const { adapter } = createDatabase();
    const { body } = await createShare(adapter);
    const response = await testApp(adapter).request(
      `/shares/${body.token}`,
      { method: "GET" },
      env(adapter),
    );
    expect(response.status).toBe(200);
    const preview = await response.json();
    expect(preview).toEqual({
      token: body.token,
      title: "How memory really works",
      originalUrl: "https://www.youtube.com/watch?v=SVb9OV0bLzI",
      thumbnailUrl: `${APP_ORIGIN}/api/videos/${OWNER_VIDEO_ID}/thumbnail`,
      sharedBy: "Avery Learner",
      language: "en",
      sessionLength: "long",
      questionCount: 2,
      questionTypes: ["multiple_choice", "short_answer"],
      concepts: ["Retrieval practice", "Spacing"],
    });
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain("retrieval practice work");
    expect(serialized).not.toContain("Reconstruction");
  });

  it("404s for unknown, malformed, and no-longer-passed shares", async () => {
    const { sqlite, adapter } = createDatabase();
    const { body } = await createShare(adapter);
    const unknown = await testApp(adapter).request(
      `/shares/${UNKNOWN_TOKEN}`,
      { method: "GET" },
      env(adapter),
    );
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe(
      "share_not_found",
    );
    const malformed = await testApp(adapter).request(
      "/shares/not-a-token",
      { method: "GET" },
      env(adapter),
    );
    expect(malformed.status).toBe(404);

    sqlite
      .prepare("UPDATE quiz_banks SET quality_status = 'generating' WHERE id = ?")
      .run(BANK_ID);
    const generating = await testApp(adapter).request(
      `/shares/${body.token}`,
      { method: "GET" },
      env(adapter),
    );
    expect(generating.status).toBe(404);
  });

  it("caps and de-duplicates concept titles", () => {
    expect(
      previewConcepts(
        JSON.stringify(
          Array.from({ length: 20 }, (_, index) => ({
            id: `c${index}`,
            title: index % 2 === 0 ? ` Concept ${index} ` : "Repeated",
          })),
        ),
      ),
    ).toEqual([
      "Concept 0",
      "Repeated",
      "Concept 2",
      "Concept 4",
      "Concept 6",
      "Concept 8",
      "Concept 10",
      "Concept 12",
      "Concept 14",
      "Concept 16",
      "Concept 18",
    ]);
    expect(previewConcepts("not json")).toEqual([]);
    expect(previewConcepts("[]")).toEqual([]);
  });
});
```

Also extend the import at the top of the test file:

```ts
import {
  previewConcepts,
  publicSharesRouter,
  sharesRouter,
} from "../src/routes/shares";
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm exec -w @clipquest/api -- vitest run test/shares.test.ts`
Expected: FAIL — `previewConcepts` is not exported / GET returns 404 from Hono's default not-found.

- [ ] **Step 3: Implement the preview**

In `apps/api/src/routes/shares.ts` replace the import block with:

```ts
import {
  LOCAL_QUIZ_PIPELINE_VERSION,
  QuizQuestionTypeSchema,
  QuizSharePreviewSchema,
  QuizShareResponseSchema,
  SessionLengthSchema,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { enforceRateLimit } from "../lib/rate-limit";
import type { ApiBindings } from "../middleware/authenticated";
```

Then add, after the `shareUrl` function and before the `sharesRouter.post(...)` handler:

```ts
const MAX_PREVIEW_CONCEPTS = 12;
const ShareTokenSchema = z.string().uuid();

const ShareRowSchema = z.object({
  share_id: z.string().uuid(),
  owner_id: z.string(),
  quiz_id: z.string().uuid(),
  video_id: z.string().uuid(),
  pipeline_version: z.number().int(),
  session_length: SessionLengthSchema,
  quality_summary_json: z.string(),
  language: z.string(),
  concepts_json: z.string(),
  title: z.string(),
  original_url: z.string().url(),
  shared_by: z.string().nullable(),
});
type ShareRow = z.infer<typeof ShareRowSchema>;

// Only shares whose source bank is still a passed, startable pipeline-7/9 bank
// resolve; a deleted or regressed bank makes the link 404 everywhere.
const SHARE_ROW_SQL = `
  SELECT s.id AS share_id, s.owner_id, qb.id AS quiz_id, qb.video_id,
         qb.pipeline_version, qb.session_length, qb.quality_summary_json,
         qb.language, qb.concepts_json, v.title, v.original_url,
         u.name AS shared_by
  FROM quiz_shares s
  JOIN quiz_banks qb ON qb.id = s.quiz_id AND qb.user_id = s.owner_id
    AND qb.quality_status = 'passed' AND qb.pipeline_version IN (?, ?)
  JOIN videos v ON v.id = qb.video_id
  LEFT JOIN user u ON u.id = s.owner_id
  WHERE s.id = ?`;

async function loadShare(
  db: D1Database,
  rawToken: string,
): Promise<ShareRow | null> {
  const token = ShareTokenSchema.safeParse(rawToken);
  if (!token.success) return null;
  const raw = await db
    .prepare(SHARE_ROW_SQL)
    .bind(
      LEGACY_LOCAL_QUIZ_PIPELINE_VERSION,
      LOCAL_QUIZ_PIPELINE_VERSION,
      token.data,
    )
    .first();
  if (!raw) return null;
  const row = ShareRowSchema.safeParse(raw);
  return row.success ? row.data : null;
}

function shareNotFound(): ApiError {
  return new ApiError(
    404,
    "share_not_found",
    "This share link is no longer available.",
  );
}

const ConceptTitlesSchema = z.array(z.object({ title: z.string() }).loose());

export function previewConcepts(conceptsJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(conceptsJson);
  } catch {
    return [];
  }
  const concepts = ConceptTitlesSchema.safeParse(parsed);
  if (!concepts.success) return [];
  const titles: string[] = [];
  for (const concept of concepts.data) {
    const title = concept.title.trim();
    if (title && !titles.includes(title)) titles.push(title);
    if (titles.length === MAX_PREVIEW_CONCEPTS) break;
  }
  return titles;
}

publicSharesRouter.get("/:token", async (c) => {
  await enforceRateLimit(c.env.DB, {
    namespace: "quiz-share-preview",
    identifier: c.req.header("cf-connecting-ip") ?? "unknown",
    maximum: 60,
    windowSeconds: 60,
  });
  const share = await loadShare(c.env.DB, c.req.param("token"));
  if (!share) throw shareNotFound();
  const counts = await c.env.DB.prepare(
    "SELECT type, COUNT(*) AS count FROM questions WHERE quiz_id = ? GROUP BY type ORDER BY MIN(ordinal)",
  )
    .bind(share.quiz_id)
    .all<{ type: string; count: number }>();
  const questionTypes = counts.results.flatMap((row) => {
    const type = QuizQuestionTypeSchema.safeParse(row.type);
    return type.success ? [type.data] : [];
  });
  const questionCount = counts.results.reduce(
    (sum, row) => sum + Number(row.count),
    0,
  );
  return c.json(
    QuizSharePreviewSchema.parse({
      token: share.share_id,
      title: share.title,
      originalUrl: share.original_url,
      thumbnailUrl: `${c.env.APP_ORIGIN}/api/videos/${share.video_id}/thumbnail`,
      sharedBy: share.shared_by,
      language: share.language,
      sessionLength: share.session_length,
      questionCount,
      questionTypes,
      concepts: previewConcepts(share.concepts_json),
    }),
  );
});
```

- [ ] **Step 4: Run the tests**

Run: `npm exec -w @clipquest/api -- vitest run test/shares.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write apps/api/src/routes/shares.ts apps/api/test/shares.test.ts
git add apps/api/src/routes/shares.ts apps/api/test/shares.test.ts
git commit -m "Add public quiz share preview endpoint" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa"
```

---

### Task 4: Claim `POST /api/shares/:token/claim` (copy-on-claim)

**Files:**
- Modify: `apps/api/src/routes/shares.ts`
- Modify: `apps/api/test/shares.test.ts`

**Interfaces:**
- Consumes: `loadShare`, `shareNotFound`, `ShareRow` (Task 3); `progressiveLibraryStartSettings({ pipelineVersion, sessionLength, qualitySummaryJson })` from `apps/api/src/routes/library.ts`; `QuizShareClaimResponseSchema`, `QuizShareStartSettings` (Task 1).
- Produces: `sharesRouter.post("/shares/:token/claim")` returning `QuizShareClaimResponse`; exported `shareStartSettings(bank: { pipeline_version: number; session_length: SessionLength; quality_summary_json: string }): QuizShareStartSettings`.

- [ ] **Step 1: Add the failing claim tests**

Append to `apps/api/test/shares.test.ts`:

```ts
async function claimShare(
  adapter: SqliteD1Adapter,
  token: string,
  userId = RECIPIENT_ID,
) {
  const response = await testApp(adapter, userId).request(
    `/shares/${token}/claim`,
    { method: "POST" },
    env(adapter),
  );
  return {
    status: response.status,
    body: (await response.json()) as {
      quizId?: string;
      videoId?: string;
      startSettings?: Record<string, unknown>;
      error?: { code: string };
    },
  };
}

describe("POST /shares/:token/claim", () => {
  it("clones the bank, questions, video and mastery into the recipient account", async () => {
    const { sqlite, adapter } = createDatabase();
    const { body: share } = await createShare(adapter);
    const claim = await claimShare(adapter, share.token!);
    expect(claim.status).toBe(200);
    expect(claim.body.quizId).toMatch(UUID);
    expect(claim.body.quizId).not.toBe(BANK_ID);
    expect(claim.body.videoId).toMatch(UUID);
    expect(claim.body.videoId).not.toBe(OWNER_VIDEO_ID);
    expect(claim.body.startSettings).toEqual({
      sessionLength: "long",
      questionTypes: ["short_answer"],
    });

    const bank = sqlite
      .prepare(
        "SELECT user_id, video_id, language, session_length, primer, concepts_json, pipeline_version, quality_status, quality_summary_json, import_key, origin, affects_mastery FROM quiz_banks WHERE id = ?",
      )
      .get(claim.body.quizId!) as Record<string, unknown>;
    expect(bank).toMatchObject({
      user_id: RECIPIENT_ID,
      video_id: claim.body.videoId,
      language: "en",
      session_length: "long",
      primer: "Memory primer",
      pipeline_version: 9,
      quality_status: "passed",
      quality_summary_json: JSON.stringify(readySummary()),
      import_key: null,
      origin: "quest",
      affects_mastery: 1,
    });

    const questions = sqlite
      .prepare(
        "SELECT id, ordinal, type, prompt, options_json, rubric_json FROM questions WHERE quiz_id = ? ORDER BY ordinal",
      )
      .all(claim.body.quizId!) as {
      id: string;
      ordinal: number;
      type: string;
      prompt: string;
      options_json: string | null;
      rubric_json: string | null;
    }[];
    expect(questions).toHaveLength(2);
    expect(questions.map((question) => question.id)).not.toContain(
      QUESTION_ONE_ID,
    );
    expect(questions.map((question) => question.id)).not.toContain(
      QUESTION_TWO_ID,
    );
    expect(questions.map((question) => question.prompt)).toEqual([
      "Why does retrieval practice work?",
      "Name one benefit of spacing.",
    ]);
    expect(questions[0]!.options_json).toContain("Reconstruction");
    expect(questions[1]!.rubric_json).toContain("acceptableAlternatives");

    const video = sqlite
      .prepare(
        "SELECT owner_id, source, source_video_id, title, thumbnail_key, thumbnail_remote_url, origin FROM videos WHERE id = ?",
      )
      .get(claim.body.videoId!);
    expect(video).toEqual({
      owner_id: RECIPIENT_ID,
      source: "youtube",
      source_video_id: "SVb9OV0bLzI",
      title: "How memory really works",
      thumbnail_key: null,
      thumbnail_remote_url: "https://i.ytimg.com/vi/SVb9OV0bLzI/hqdefault.jpg",
      origin: "paste",
    });
    expect(
      sqlite
        .prepare("SELECT state FROM mastery WHERE user_id = ? AND video_id = ?")
        .get(RECIPIENT_ID, claim.body.videoId!),
    ).toEqual({ state: "not_started" });
    expect(
      sqlite
        .prepare(
          "SELECT quiz_id FROM quiz_share_claims WHERE share_id = ? AND user_id = ?",
        )
        .get(share.token!, RECIPIENT_ID),
    ).toEqual({ quiz_id: claim.body.quizId });
  });

  it("is idempotent per recipient and reuses an existing video row", async () => {
    const { sqlite, adapter } = createDatabase();
    sqlite
      .prepare(
        `INSERT INTO videos (id, owner_id, source, source_video_id, original_url, title, thumbnail_remote_url, created_at, updated_at)
         VALUES ('22222222-2222-4222-8222-222222222222', ?, 'youtube', 'SVb9OV0bLzI', 'https://www.youtube.com/watch?v=SVb9OV0bLzI', 'My own copy', 'https://i.ytimg.com/vi/SVb9OV0bLzI/hqdefault.jpg', 1, 1)`,
      )
      .run(RECIPIENT_ID);
    const { body: share } = await createShare(adapter);
    const first = await claimShare(adapter, share.token!);
    const second = await claimShare(adapter, share.token!);
    expect(first.body.videoId).toBe("22222222-2222-4222-8222-222222222222");
    expect(second.status).toBe(200);
    expect(second.body.quizId).toBe(first.body.quizId);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM quiz_banks WHERE user_id = ?")
        .get(RECIPIENT_ID),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM videos WHERE owner_id = ?")
        .get(RECIPIENT_ID),
    ).toEqual({ count: 1 });
  });

  it("hands the owner their original bank without cloning", async () => {
    const { sqlite, adapter } = createDatabase();
    const { body: share } = await createShare(adapter);
    const claim = await claimShare(adapter, share.token!, OWNER_ID);
    expect(claim.body.quizId).toBe(BANK_ID);
    expect(claim.body.videoId).toBe(OWNER_VIDEO_ID);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM quiz_banks").get(),
    ).toEqual({ count: 1 });
  });

  it("404s for unknown tokens", async () => {
    const { adapter } = createDatabase();
    const claim = await claimShare(adapter, UNKNOWN_TOKEN);
    expect(claim.status).toBe(404);
    expect(claim.body.error?.code).toBe("share_not_found");
  });

  it("falls back to the stored session length for legacy banks", () => {
    expect(
      shareStartSettings({
        pipeline_version: 7,
        session_length: "medium",
        quality_summary_json: "{}",
      }),
    ).toEqual({ sessionLength: "medium" });
    expect(
      shareStartSettings({
        pipeline_version: 9,
        session_length: "long",
        quality_summary_json: JSON.stringify(readySummary()),
      }),
    ).toEqual({ sessionLength: "long", questionTypes: ["short_answer"] });
  });
});
```

Extend the import again:

```ts
import {
  previewConcepts,
  publicSharesRouter,
  shareStartSettings,
  sharesRouter,
} from "../src/routes/shares";
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm exec -w @clipquest/api -- vitest run test/shares.test.ts`
Expected: FAIL — `shareStartSettings` is not exported; claim requests 404 (no route).

- [ ] **Step 3: Implement the claim**

In `apps/api/src/routes/shares.ts`:

Replace the contracts import with:

```ts
import {
  LOCAL_QUIZ_PIPELINE_VERSION,
  QuizQuestionTypeSchema,
  QuizShareClaimResponseSchema,
  QuizSharePreviewSchema,
  QuizShareResponseSchema,
  SessionLengthSchema,
  type QuizShareStartSettings,
  type SessionLength,
} from "@clipquest/contracts";
```

and add `import { progressiveLibraryStartSettings } from "./library";` after the `../middleware/authenticated` import.

Append at the end of the file:

```ts
type ClaimableBank = {
  quiz_id: string;
  video_id: string;
  pipeline_version: number;
  session_length: SessionLength;
  quality_summary_json: string;
};

type SourceBankRow = {
  primer: string;
  concepts_json: string;
  watched: number;
  assessment_rationale: string | null;
};

type SourceVideoRow = {
  source: string;
  source_video_id: string;
  original_url: string;
  title: string;
  thumbnail_remote_url: string;
  duration_seconds: number;
  source_language: string | null;
  education_status: string;
  caption_source_category: string | null;
  caption_segment_count: number | null;
  caption_word_count: number | null;
  source_metadata_verified_at: number | null;
};

type SourceQuestionRow = {
  ordinal: number;
  source_question_id: string;
  type: string;
  concept_id: string;
  prompt: string;
  reformulated_prompt: string;
  options_json: string | null;
  items_json: string | null;
  correct_answer_json: string | null;
  rubric_json: string | null;
  explanation: string;
  evidence_segment_ids_json: string;
  difficulty: number;
  generation_metadata_json: string;
};

export function shareStartSettings(bank: {
  pipeline_version: number;
  session_length: SessionLength;
  quality_summary_json: string;
}): QuizShareStartSettings {
  return (
    progressiveLibraryStartSettings({
      pipelineVersion: bank.pipeline_version,
      sessionLength: bank.session_length,
      qualitySummaryJson: bank.quality_summary_json,
    }) ?? { sessionLength: bank.session_length }
  );
}

function claimResponse(bank: ClaimableBank) {
  return QuizShareClaimResponseSchema.parse({
    quizId: bank.quiz_id,
    videoId: bank.video_id,
    startSettings: shareStartSettings(bank),
  });
}

const EXISTING_CLAIM_SQL = `
  SELECT qb.id AS quiz_id, qb.video_id, qb.pipeline_version, qb.session_length, qb.quality_summary_json
  FROM quiz_share_claims cl
  JOIN quiz_banks qb ON qb.id = cl.quiz_id
  WHERE cl.share_id = ? AND cl.user_id = ?`;

sharesRouter.post("/shares/:token/claim", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  await enforceRateLimit(db, {
    namespace: "quiz-share-claim",
    identifier: user.id,
    maximum: 20,
    windowSeconds: 60,
  });
  const share = await loadShare(db, c.req.param("token"));
  if (!share) throw shareNotFound();

  const existing = await db
    .prepare(EXISTING_CLAIM_SQL)
    .bind(share.share_id, user.id)
    .first<ClaimableBank>();
  if (existing) return c.json(claimResponse(existing));
  if (share.owner_id === user.id) return c.json(claimResponse(share));

  const [source, sourceVideo, questions] = await Promise.all([
    db
      .prepare(
        "SELECT primer, concepts_json, watched, assessment_rationale FROM quiz_banks WHERE id = ?",
      )
      .bind(share.quiz_id)
      .first<SourceBankRow>(),
    db
      .prepare(
        "SELECT source, source_video_id, original_url, title, thumbnail_remote_url, duration_seconds, source_language, education_status, caption_source_category, caption_segment_count, caption_word_count, source_metadata_verified_at FROM videos WHERE id = ?",
      )
      .bind(share.video_id)
      .first<SourceVideoRow>(),
    db
      .prepare(
        "SELECT ordinal, source_question_id, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty, generation_metadata_json FROM questions WHERE quiz_id = ? ORDER BY ordinal ASC",
      )
      .bind(share.quiz_id)
      .all<SourceQuestionRow>(),
  ]);
  if (!source || !sourceVideo || questions.results.length === 0) {
    throw shareNotFound();
  }

  const timestamp = now();
  const recipientVideo = await db
    .prepare(
      "SELECT id FROM videos WHERE owner_id = ? AND source = ? AND source_video_id = ?",
    )
    .bind(user.id, sourceVideo.source, sourceVideo.source_video_id)
    .first<{ id: string }>();
  const videoId = recipientVideo?.id ?? createId();
  const quizId = createId();

  const statements: D1PreparedStatement[] = [];
  if (!recipientVideo) {
    // thumbnail_key stays NULL: the thumbnail route re-caches from the remote URL.
    statements.push(
      db
        .prepare(
          `INSERT INTO videos
           (id, owner_id, source, source_video_id, original_url, title, thumbnail_remote_url, duration_seconds, source_language, origin, education_status, caption_source_category, caption_segment_count, caption_word_count, source_metadata_verified_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paste', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          videoId,
          user.id,
          sourceVideo.source,
          sourceVideo.source_video_id,
          sourceVideo.original_url,
          sourceVideo.title,
          sourceVideo.thumbnail_remote_url,
          sourceVideo.duration_seconds,
          sourceVideo.source_language,
          sourceVideo.education_status,
          sourceVideo.caption_source_category,
          sourceVideo.caption_segment_count,
          sourceVideo.caption_word_count,
          sourceVideo.source_metadata_verified_at,
          timestamp,
          timestamp,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO quiz_banks
         (id, user_id, video_id, language, session_length, primer, concepts_json, watched, pipeline_version, quality_status, quality_summary_json, import_key, origin, affects_mastery, workplace_thread_id, assessment_rationale, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed', ?, NULL, 'quest', 1, NULL, ?, ?)`,
      )
      .bind(
        quizId,
        user.id,
        videoId,
        share.language,
        share.session_length,
        source.primer,
        source.concepts_json,
        source.watched,
        share.pipeline_version,
        share.quality_summary_json,
        source.assessment_rationale,
        timestamp,
      ),
  );
  for (const question of questions.results) {
    statements.push(
      db
        .prepare(
          `INSERT INTO questions
           (id, quiz_id, ordinal, source_question_id, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty, generation_metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          createId(),
          quizId,
          question.ordinal,
          question.source_question_id,
          question.type,
          question.concept_id,
          question.prompt,
          question.reformulated_prompt,
          question.options_json,
          question.items_json,
          question.correct_answer_json,
          question.rubric_json,
          question.explanation,
          question.evidence_segment_ids_json,
          question.difficulty,
          question.generation_metadata_json,
        ),
    );
  }
  const masteryIndex = statements.length;
  statements.push(
    db
      .prepare(
        "INSERT INTO mastery (user_id, video_id, state, updated_at) VALUES (?, ?, 'not_started', ?) ON CONFLICT(user_id, video_id) DO NOTHING",
      )
      .bind(user.id, videoId, timestamp),
  );
  statements.push(
    db
      .prepare(
        "INSERT INTO quiz_share_claims (share_id, user_id, quiz_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(share.share_id, user.id, quizId, timestamp),
  );

  let results: { meta: { changes: number } }[];
  try {
    results = await db.batch(statements);
  } catch (cause) {
    // Two concurrent claims by the same learner race on the claims primary
    // key; the loser simply returns the copy the winner stored.
    const raced = await db
      .prepare(EXISTING_CLAIM_SQL)
      .bind(share.share_id, user.id)
      .first<ClaimableBank>();
    if (raced) return c.json(claimResponse(raced));
    throw cause;
  }
  const rejected =
    results.length !== statements.length ||
    results.some(
      (result, index) => index !== masteryIndex && result.meta.changes !== 1,
    );
  if (rejected) {
    throw new ApiError(
      409,
      "quiz_share_claim_rejected",
      "The shared quest could not be copied atomically.",
    );
  }
  return c.json(
    claimResponse({
      quiz_id: quizId,
      video_id: videoId,
      pipeline_version: share.pipeline_version,
      session_length: share.session_length,
      quality_summary_json: share.quality_summary_json,
    }),
  );
});
```

- [ ] **Step 4: Run the tests**

Run: `npm exec -w @clipquest/api -- vitest run test/shares.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Typecheck the API**

Run: `npm run typecheck -w @clipquest/api`
Expected: no errors. (If `D1PreparedStatement` is reported as unknown, the generated `worker-configuration.d.ts` is missing — `npm run cf:types -w @clipquest/api` regenerates it; the typecheck script already runs it.)

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write apps/api/src/routes/shares.ts apps/api/test/shares.test.ts
git add apps/api/src/routes/shares.ts apps/api/test/shares.test.ts
git commit -m "Add copy-on-claim for shared quests" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa"
```

---

### Task 5: Worker wiring, `/s/:token` app shell, Universal Links path

**Files:**
- Modify: `apps/api/src/index.ts` (imports lines 22–37; mounts lines 195–211)
- Modify: `apps/api/src/lib/asset-shell.ts` (`dynamicShells`, line 21–25)
- Modify: `apps/api/src/lib/apple-app-site-association.ts` (`paths`, line 17–25)
- Modify: `apps/api/test/asset-shell.test.ts`, `apps/api/test/apple-app-site-association.test.ts`

**Interfaces:**
- Consumes: `publicSharesRouter`, `sharesRouter` (Tasks 2–4).
- Produces: `GET /api/shares/:token` public; `POST /api/quizzes/:quizId/share` and `POST /api/shares/:token/claim` behind `authenticated`; `publicAssetShell("/s/<token>") === "/s/[token].html"`; AASA `paths` includes `"/s/*"`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/asset-shell.test.ts`, inside the test `"maps dynamic navigation URLs to their exported Expo shells"`, add after the `/quiz/attempt-id` expectation:

```ts
    expect(
      publicAssetShell("/s/9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a"),
    ).toBe("/s/[token].html");
    expect(publicAssetShell("/s/token/")).toBe("/s/[token].html");
```

and inside `"does not rewrite nested, empty, or unrelated paths"` add:

```ts
    expect(publicAssetShell("/s/")).toBeNull();
    expect(publicAssetShell("/s/token/extra")).toBeNull();
    expect(publicAssetShell("/settings")).toBe("/settings.html");
```

In `apps/api/test/apple-app-site-association.test.ts` change the expected `paths` array to end with:

```ts
        "/quiz/*",
        "/s/*",
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm exec -w @clipquest/api -- vitest run test/asset-shell.test.ts test/apple-app-site-association.test.ts`
Expected: FAIL on the new `/s/` expectations.

- [ ] **Step 3: Implement**

`apps/api/src/lib/asset-shell.ts` — add to `dynamicShells`:

```ts
  [/^\/s\/[^/]+$/, "/s/[token].html"],
```

`apps/api/src/lib/apple-app-site-association.ts` — add `"/s/*",` after `"/quiz/*",`.

`apps/api/src/index.ts` — add the import after the `quizzesRouter` import:

```ts
import { publicSharesRouter, sharesRouter } from "./routes/shares";
```

and change the mounting block to:

```ts
// R2 remains private; this opaque-ID endpoint is deliberately public so native image views
// do not need to expose the Better Auth session cookie in an image URL.
app.route("/api/videos", thumbnailRouter);
// The quest-share preview is public by design: it exposes title, counts and
// concept names only (see routes/shares.ts) and is rate limited per IP.
app.route("/api/shares", publicSharesRouter);

app.use("/api/*", authenticated);
app.route("/api/admin", adminRouter);
app.route("/api/videos", videosRouter);
app.route("/api/local-ai", generationRouter);
app.route("/api/quiz-imports", quizImportsRouter);
app.route("/api", quizzesRouter);
app.route("/api", sharesRouter);
app.route("/api/library", libraryRouter);
```

(leave the remaining `app.route(...)` lines as they are).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm exec -w @clipquest/api -- vitest run test/asset-shell.test.ts test/apple-app-site-association.test.ts test/shares.test.ts && npm run typecheck -w @clipquest/api`
Expected: PASS; no type errors.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write apps/api/src/index.ts apps/api/src/lib/asset-shell.ts apps/api/src/lib/apple-app-site-association.ts apps/api/test/asset-shell.test.ts apps/api/test/apple-app-site-association.test.ts
git add apps/api/src/index.ts apps/api/src/lib/asset-shell.ts apps/api/src/lib/apple-app-site-association.ts apps/api/test/asset-shell.test.ts apps/api/test/apple-app-site-association.test.ts
git commit -m "Mount quiz share routes and shell" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa"
```

---

### Task 6: App share helper `quiz-share.ts`

**Files:**
- Create: `apps/app/src/lib/quiz-share.ts`
- Create: `apps/app/test/quiz-share.test.ts`

**Interfaces:**
- Consumes: `apiRequest(path, options, schema)` from `apps/app/src/lib/api.ts`; `QuizShareResponseSchema` (Task 1); `expo-clipboard` `setStringAsync`; React Native `Share.share`, `Platform.OS`.
- Produces:
  - `createQuizShareLink(quizId: string): Promise<QuizShareResponse>`
  - `shareQuizLink(input: { url: string; title: string }, deps?: ShareQuizLinkDeps): Promise<ShareOutcome>` where `ShareOutcome = "copied" | "shared"`
  - `ShareQuizLinkDeps` (injectable for tests).

- [ ] **Step 1: Write the failing test**

Create `apps/app/test/quiz-share.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  Share: { share: vi.fn(async () => ({ action: "sharedAction" })) },
}));
vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn(async () => true),
}));
vi.mock("../src/lib/api", () => ({
  apiRequest: vi.fn(async () => ({
    token: "9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a",
    url: "https://clipquest.ccwu.cc/s/9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a",
  })),
}));

import { apiRequest } from "../src/lib/api";
import {
  createQuizShareLink,
  shareQuizLink,
  type ShareQuizLinkDeps,
} from "../src/lib/quiz-share";

const link = {
  url: "https://clipquest.ccwu.cc/s/9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a",
  title: "How memory really works",
};

function deps(overrides: Partial<ShareQuizLinkDeps> = {}): ShareQuizLinkDeps {
  return {
    platform: "web",
    webShare: null,
    coarsePointer: false,
    writeClipboardText: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    nativeShare: vi.fn(async () => ({ action: "sharedAction" })),
    ...overrides,
  };
}

describe("createQuizShareLink", () => {
  beforeEach(() => vi.mocked(apiRequest).mockClear());

  it("posts to the quiz share endpoint and returns the link", async () => {
    const result = await createQuizShareLink(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(result.url).toBe(link.url);
    expect(vi.mocked(apiRequest).mock.calls[0]?.[0]).toBe(
      "/api/quizzes/33333333-3333-4333-8333-333333333333/share",
    );
    expect(vi.mocked(apiRequest).mock.calls[0]?.[1]).toEqual({
      method: "POST",
    });
  });
});

describe("shareQuizLink", () => {
  it("uses the native share sheet off the web", async () => {
    const d = deps({ platform: "ios" });
    await expect(shareQuizLink(link, d)).resolves.toBe("shared");
    expect(d.nativeShare).toHaveBeenCalledWith({
      message: link.url,
      url: link.url,
      title: link.title,
    });
    expect(d.writeClipboardText).not.toHaveBeenCalled();
  });

  it("copies to the clipboard on desktop web even when Web Share exists", async () => {
    const webShare = vi.fn(async () => undefined);
    const d = deps({ webShare, coarsePointer: false });
    await expect(shareQuizLink(link, d)).resolves.toBe("copied");
    expect(webShare).not.toHaveBeenCalled();
    expect(d.writeClipboardText).toHaveBeenCalledWith(link.url);
  });

  it("prefers Web Share on touch devices and falls back to the clipboard when it fails", async () => {
    const accepted = vi.fn(async () => undefined);
    await expect(
      shareQuizLink(link, deps({ webShare: accepted, coarsePointer: true })),
    ).resolves.toBe("shared");
    expect(accepted).toHaveBeenCalledWith({ title: link.title, url: link.url });

    const dismissed = vi.fn(async () => {
      throw new DOMException("Share canceled", "AbortError");
    });
    const d = deps({ webShare: dismissed, coarsePointer: true });
    await expect(shareQuizLink(link, d)).resolves.toBe("copied");
    expect(d.writeClipboardText).toHaveBeenCalledWith(link.url);
  });

  it("falls back to expo-clipboard when the browser clipboard API is missing", async () => {
    const d = deps({ writeClipboardText: null });
    await expect(shareQuizLink(link, d)).resolves.toBe("copied");
    expect(d.copyToClipboard).toHaveBeenCalledWith(link.url);
  });

  it("surfaces clipboard failures to the caller", async () => {
    const d = deps({
      writeClipboardText: vi.fn(async () => {
        throw new Error("Clipboard blocked");
      }),
    });
    await expect(shareQuizLink(link, d)).rejects.toThrow("Clipboard blocked");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm exec -w @clipquest/app -- vitest run test/quiz-share.test.ts`
Expected: FAIL — cannot resolve `../src/lib/quiz-share`.

- [ ] **Step 3: Implement the helper**

Create `apps/app/src/lib/quiz-share.ts`:

```ts
import {
  QuizShareResponseSchema,
  type QuizShareResponse,
} from "@clipquest/contracts";
import * as Clipboard from "expo-clipboard";
import { Platform, Share } from "react-native";
import { apiRequest } from "./api";

export type ShareOutcome = "copied" | "shared";

export type ShareQuizLinkDeps = {
  platform: string;
  /** `navigator.share` bound to the navigator, or null when unavailable. */
  webShare: ((data: { title: string; url: string }) => Promise<void>) | null;
  /** True on touch-first browsers, where the OS share sheet is the better UX. */
  coarsePointer: boolean;
  /** `navigator.clipboard.writeText`, or null when the browser has no clipboard API. */
  writeClipboardText: ((text: string) => Promise<void>) | null;
  copyToClipboard(text: string): Promise<void>;
  nativeShare(content: {
    message: string;
    url: string;
    title: string;
  }): Promise<unknown>;
};

export function createQuizShareLink(
  quizId: string,
): Promise<QuizShareResponse> {
  return apiRequest(
    `/api/quizzes/${quizId}/share`,
    { method: "POST" },
    QuizShareResponseSchema,
  );
}

function defaultDeps(): ShareQuizLinkDeps {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    platform: Platform.OS,
    webShare:
      nav && typeof nav.share === "function"
        ? (data) => nav.share(data)
        : null,
    coarsePointer:
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches,
    writeClipboardText:
      nav?.clipboard && typeof nav.clipboard.writeText === "function"
        ? (text) => nav.clipboard.writeText(text)
        : null,
    copyToClipboard: (text) =>
      Clipboard.setStringAsync(text).then(() => undefined),
    nativeShare: (content) => Share.share(content),
  };
}

/**
 * Hands a share URL to the learner. Desktop web copies the link (deterministic
 * and demo-friendly); touch browsers try the OS share sheet first and still
 * copy when the sheet is dismissed or refused; native uses React Native's
 * share sheet. Throws when even the clipboard is unavailable so callers can
 * show the URL for manual copying.
 */
export async function shareQuizLink(
  input: { url: string; title: string },
  deps: ShareQuizLinkDeps = defaultDeps(),
): Promise<ShareOutcome> {
  if (deps.platform !== "web") {
    await deps.nativeShare({
      message: input.url,
      url: input.url,
      title: input.title,
    });
    return "shared";
  }
  if (deps.webShare && deps.coarsePointer) {
    try {
      await deps.webShare({ title: input.title, url: input.url });
      return "shared";
    } catch {
      // Dismissed or refused: copying the link is still a useful outcome.
    }
  }
  if (deps.writeClipboardText) {
    await deps.writeClipboardText(input.url);
    return "copied";
  }
  await deps.copyToClipboard(input.url);
  return "copied";
}
```

- [ ] **Step 4: Run the test and the app typecheck**

Run: `npm exec -w @clipquest/app -- vitest run test/quiz-share.test.ts && npm run typecheck -w @clipquest/app`
Expected: PASS (6 tests); no type errors.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write apps/app/src/lib/quiz-share.ts apps/app/test/quiz-share.test.ts
git add apps/app/src/lib/quiz-share.ts apps/app/test/quiz-share.test.ts
git commit -m "Add quiz share link helper" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa"
```

---

### Task 7: `next` return path through sign-in / sign-up / verify-email

**Files:**
- Create: `apps/app/src/lib/auth-next.ts`
- Create: `apps/app/test/auth-next.test.ts`
- Modify: `apps/app/app/(auth)/sign-in.tsx`, `apps/app/app/(auth)/sign-up.tsx`, `apps/app/app/(auth)/verify-email.tsx`

**Interfaces:**
- Produces: `parseNextPath(params: AuthNextSearchParams): string | null` (allow-list `^/s/[0-9a-f-]{1,64}$`), `withNextParam(params, next): Record<string, string> | null`, type `AuthNextSearchParams = { next?: string | string[] }`. Task 11 links to sign-in/sign-up with `params: { next: "/s/<token>" }`.

- [ ] **Step 1: Write the failing test**

Create `apps/app/test/auth-next.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseNextPath, withNextParam } from "../src/lib/auth-next";

describe("auth next path", () => {
  it("accepts only shared-quest preview paths", () => {
    expect(
      parseNextPath({ next: "/s/9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a" }),
    ).toBe("/s/9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a");
    expect(parseNextPath({ next: ["/s/abc-123", "/s/other"] })).toBe(
      "/s/abc-123",
    );
    expect(parseNextPath({ next: " /s/abc " })).toBe("/s/abc");
  });

  it("drops anything that could redirect elsewhere", () => {
    expect(parseNextPath({})).toBeNull();
    expect(parseNextPath({ next: "https://evil.example/s/abc" })).toBeNull();
    expect(parseNextPath({ next: "//evil.example/s/abc" })).toBeNull();
    expect(parseNextPath({ next: "/s/../library" })).toBeNull();
    expect(parseNextPath({ next: "/library" })).toBeNull();
    expect(parseNextPath({ next: "/s/" })).toBeNull();
    expect(parseNextPath({ next: "/s/abc?x=1" })).toBeNull();
    expect(parseNextPath({ next: "/s/abc/extra" })).toBeNull();
  });

  it("merges next into route params only when present", () => {
    expect(withNextParam(null, null)).toBeNull();
    expect(withNextParam({ url: "https://youtu.be/x", autostart: "1" }, null)).toEqual({
      url: "https://youtu.be/x",
      autostart: "1",
    });
    expect(withNextParam(null, "/s/abc")).toEqual({ next: "/s/abc" });
    expect(
      withNextParam({ url: "https://youtu.be/x", autostart: "1" }, "/s/abc"),
    ).toEqual({ url: "https://youtu.be/x", autostart: "1", next: "/s/abc" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm exec -w @clipquest/app -- vitest run test/auth-next.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `auth-next.ts`**

```ts
export type AuthNextSearchParams = { next?: string | string[] };

/**
 * Only the shared-quest preview may be resumed after signing in. Anything
 * else (absolute URLs, protocol-relative URLs, other app routes, traversal)
 * is dropped so `next` can never become an open redirect.
 */
export const AUTH_NEXT_PATTERN = /^\/s\/[0-9a-f-]{1,64}$/i;

export function parseNextPath(params: AuthNextSearchParams): string | null {
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  const value = raw?.trim();
  if (!value || !AUTH_NEXT_PATTERN.test(value)) return null;
  return value;
}

/** Route params for links between the auth screens, keeping `next` alive. */
export function withNextParam(
  params: Record<string, string> | null | undefined,
  next: string | null,
): Record<string, string> | null {
  const merged: Record<string, string> = { ...(params ?? {}) };
  if (next) merged.next = next;
  return Object.keys(merged).length > 0 ? merged : null;
}
```

- [ ] **Step 4: Run the test**

Run: `npm exec -w @clipquest/app -- vitest run test/auth-next.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Thread `next` through sign-in**

In `apps/app/app/(auth)/sign-in.tsx`:

1. Add the import after the `quick-open` import:
   ```ts
   import {
     parseNextPath,
     withNextParam,
     type AuthNextSearchParams,
   } from "../../src/lib/auth-next";
   ```
2. Replace
   ```ts
   const params = useLocalSearchParams<QuickOpenSearchParams>();
   const quickOpen = parseQuickOpenRequest(params);
   ```
   with
   ```ts
   const params = useLocalSearchParams<
     QuickOpenSearchParams & AuthNextSearchParams
   >();
   const quickOpen = parseQuickOpenRequest(params);
   const next = parseNextPath(params);
   const authLinkParams = withNextParam(quickOpen, next);
   ```
3. Replace `router.replace("/(tabs)");` (the success line in `submit`) with
   ```ts
   router.replace(next ? (next as never) : "/(tabs)");
   ```
4. Replace the footer `Link` `href` with
   ```tsx
   href={
     authLinkParams
       ? { pathname: "/(auth)/sign-up", params: authLinkParams }
       : "/(auth)/sign-up"
   }
   ```

- [ ] **Step 6: Thread `next` through sign-up**

In `apps/app/app/(auth)/sign-up.tsx`:

1. Same import as above (after the `quick-open` import).
2. Replace the `params` / `quickOpen` lines with the same four-line block as in sign-in.
3. Replace the success navigation
   ```ts
   router.replace({
     pathname: "/(auth)/verify-email",
     params: { email: normalizedEmail },
   });
   ```
   with
   ```ts
   router.replace({
     pathname: "/(auth)/verify-email",
     params: next
       ? { email: normalizedEmail, next }
       : { email: normalizedEmail },
   });
   ```
4. Replace the footer `Link` `href` with
   ```tsx
   href={
     authLinkParams
       ? { pathname: "/(auth)/sign-in", params: authLinkParams }
       : "/(auth)/sign-in"
   }
   ```

- [ ] **Step 7: Thread `next` through verify-email**

In `apps/app/app/(auth)/verify-email.tsx`:

1. Add `import { parseNextPath, type AuthNextSearchParams } from "../../src/lib/auth-next";` after the `auth-client` import.
2. Replace `const { email } = useLocalSearchParams<{ email?: string }>();` with
   ```ts
   const params = useLocalSearchParams<{ email?: string } & AuthNextSearchParams>();
   const email = params.email;
   const next = parseNextPath(params);
   ```
3. Replace the sign-in button's `onPress={() => router.replace("/(auth)/sign-in")}` with
   ```tsx
   onPress={() =>
     router.replace(
       next
         ? { pathname: "/(auth)/sign-in", params: { next } }
         : "/(auth)/sign-in",
     )
   }
   ```

- [ ] **Step 8: Typecheck, lint the touched files, run app tests**

Run: `npm run typecheck -w @clipquest/app && npx eslint --max-warnings 0 "apps/app/app/(auth)" apps/app/src/lib/auth-next.ts && npm exec -w @clipquest/app -- vitest run test/auth-next.test.ts test/quick-open.test.ts`
Expected: clean.

- [ ] **Step 9: Format and commit**

```bash
npx prettier --write "apps/app/app/(auth)/sign-in.tsx" "apps/app/app/(auth)/sign-up.tsx" "apps/app/app/(auth)/verify-email.tsx" apps/app/src/lib/auth-next.ts apps/app/test/auth-next.test.ts
git add "apps/app/app/(auth)/sign-in.tsx" "apps/app/app/(auth)/sign-up.tsx" "apps/app/app/(auth)/verify-email.tsx" apps/app/src/lib/auth-next.ts apps/app/test/auth-next.test.ts
git commit -m "Return to a shared quest after signing in" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa"
```

---

### Task 8: Native minimal compatibility (deep link route, Android intent filter)

**Files:**
- Modify: `apps/app/src/navigation/native-deep-links.ts`
- Modify: `apps/app/test/native-deep-links.test.ts`
- Modify: `apps/app/app.config.ts` (Android `intentFilters[0].data`)

**Interfaces:**
- Produces: `nativeRouteForUrl("https://clipquest.ccwu.cc/s/<token>") === "/s/<token>"`; `NativeDeepLinkRoute` gains `` `/s/${string}` ``.

- [ ] **Step 1: Write the failing test**

In `apps/app/test/native-deep-links.test.ts` add a new `it` inside the `describe("native deep links")` block:

```ts
  it("opens shared quest links in the preview route", () => {
    const token = "9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a";
    expect(nativeRouteForUrl(`https://clipquest.ccwu.cc/s/${token}`)).toBe(
      `/s/${token}`,
    );
    expect(nativeRouteForUrl(`https://clipquest.ccwu.cc/s/${token}/`)).toBe(
      `/s/${token}`,
    );
    expect(nativeRouteForUrl(`clipquest:///s/${token}`)).toBe(`/s/${token}`);
    expect(nativeRouteForUrl("https://clipquest.ccwu.cc/s/")).toBeNull();
    expect(
      nativeRouteForUrl(`https://clipquest.ccwu.cc/s/${token}/extra`),
    ).toBeNull();
    expect(nativeRouteForUrl("https://clipquest.ccwu.cc/settings")).toBeNull();
    const config = readFileSync(
      resolve(import.meta.dirname, "../app.config.ts"),
      "utf8",
    );
    expect(config).toContain('pathPrefix: "/s/"');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm exec -w @clipquest/app -- vitest run test/native-deep-links.test.ts`
Expected: FAIL (route returns null; config lacks the prefix).

- [ ] **Step 3: Implement**

`apps/app/src/navigation/native-deep-links.ts`:

- Extend the union:
  ```ts
  export type NativeDeepLinkRoute =
    | "/(auth)/sign-in"
    | "/(auth)/forgot-password"
    | `/(auth)/reset-password?${string}`
    | `/(auth)/verify-email?${string}`
    | "/(tabs)/library"
    | `/quiz/${string}`
    | `/s/${string}`;
  ```
- Before the final `const quiz = path.match(...)` add:
  ```ts
  const share = path.match(/^\/s\/([0-9a-f-]+)$/i);
  if (share) return `/s/${share[1]}`;
  ```

`apps/app/app.config.ts` — add a fourth entry to `android.intentFilters[0].data` (after the `/quiz` entry). The trailing slash matters: `"/s"` would also capture `/settings` and `/sign-in`.

```ts
          {
            scheme: "https",
            host: "clipquest.ccwu.cc",
            pathPrefix: "/s/",
          },
```

- [ ] **Step 4: Run the test**

Run: `npm exec -w @clipquest/app -- vitest run test/native-deep-links.test.ts`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write apps/app/src/navigation/native-deep-links.ts apps/app/test/native-deep-links.test.ts apps/app/app.config.ts
git add apps/app/src/navigation/native-deep-links.ts apps/app/test/native-deep-links.test.ts apps/app/app.config.ts
git commit -m "Route shared quest links on native" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa"
```

---

### Task 9: i18n keys and the completion-screen "Share this quest" button

**Files:**
- Modify: `apps/app/src/i18n/messages.ts` (add keys to BOTH `en` and `zh-CN`)
- Modify: `apps/app/app/quiz/[attemptId].tsx` (imports ~line 43; state ~line 187–191; `applyResume` ~line 307; completion actions ~line 998–1064; styles ~line 1825)
- Create: `apps/app/test/quiz-share-completion.test.ts` (source-reading assertion, same style as `native-deep-links.test.ts`)

**Interfaces:**
- Consumes: `createQuizShareLink`, `shareQuizLink` (Task 6).
- Produces: i18n keys `shareQuest`, `shareLinkCopied`, `shareLinkShared`, `shareFailed`, `shareCopyManually`, `sharePreviewEyebrow`, `sharedBy`, `shareConceptsTitle`, `watchLesson`, `startSharedQuest`, `signInToStart`, `shareNotFoundTitle`, `shareNotFoundBody`, `shareLoadFailed`, `shareLoadFailedBody`, `shareClaimFailed`, `languageChinese`; completion button with `testID="share-quest"` and fallback text `testID="share-quest-fallback"`.

- [ ] **Step 1: Write the failing source assertion**

Create `apps/app/test/quiz-share-completion.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("completion share action", () => {
  it("offers a share button that copies a quest link from the resumed quiz id", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../app/quiz/[attemptId].tsx"),
      "utf8",
    );
    expect(source).toContain('testID="share-quest"');
    expect(source).toContain("createQuizShareLink(shareQuizId)");
    expect(source).toContain(
      "if (resumed.quizId) setShareQuizId(resumed.quizId);",
    );
    expect(source).toContain('testID="share-quest-fallback"');
  });

  it("ships every share message in both locales", () => {
    const messages = readFileSync(
      resolve(import.meta.dirname, "../src/i18n/messages.ts"),
      "utf8",
    );
    for (const key of [
      "shareQuest",
      "shareLinkCopied",
      "shareLinkShared",
      "shareFailed",
      "shareCopyManually",
      "sharePreviewEyebrow",
      "sharedBy",
      "shareConceptsTitle",
      "watchLesson",
      "startSharedQuest",
      "signInToStart",
      "shareNotFoundTitle",
      "shareNotFoundBody",
      "shareLoadFailed",
      "shareLoadFailedBody",
      "shareClaimFailed",
      "languageChinese",
    ]) {
      expect(messages.match(new RegExp(`^\\s+${key}:`, "gm"))).toHaveLength(2);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm exec -w @clipquest/app -- vitest run test/quiz-share-completion.test.ts`
Expected: FAIL on both tests.

- [ ] **Step 3: Add the i18n keys**

In `apps/app/src/i18n/messages.ts`, inside `en` (e.g. right after `returnToLibrary: "Return to library",`):

```ts
    shareQuest: "Share this quest",
    shareLinkCopied: "Link copied",
    shareLinkShared: "Shared",
    shareFailed: "The share link could not be created.",
    shareCopyManually: "Copy this link:",
    sharePreviewEyebrow: "A quest shared with you",
    sharedBy: "Shared by",
    shareConceptsTitle: "Concepts covered",
    watchLesson: "Watch the lesson on YouTube",
    startSharedQuest: "Start this quest",
    signInToStart: "Sign in to start",
    shareNotFoundTitle: "This link is no longer available",
    shareNotFoundBody:
      "The quest may have been removed by its owner. Ask them for a fresh link.",
    shareLoadFailed: "The shared quest could not be loaded.",
    shareLoadFailedBody: "Check your connection and try again.",
    shareClaimFailed: "The quest could not be added to your library.",
    languageChinese: "简体中文",
```

and inside `zh-CN` (right after `returnToLibrary: "返回资料库",`):

```ts
    shareQuest: "分享这个任务",
    shareLinkCopied: "链接已复制",
    shareLinkShared: "已分享",
    shareFailed: "无法创建分享链接。",
    shareCopyManually: "请复制这个链接：",
    sharePreviewEyebrow: "分享给你的学习任务",
    sharedBy: "分享者：",
    shareConceptsTitle: "涵盖的概念",
    watchLesson: "在 YouTube 观看这节课",
    startSharedQuest: "开始这个任务",
    signInToStart: "登录后开始",
    shareNotFoundTitle: "这个链接已失效",
    shareNotFoundBody: "该任务可能已被作者删除，请向对方索要新的链接。",
    shareLoadFailed: "无法加载分享的任务。",
    shareLoadFailedBody: "请检查网络后重试。",
    shareClaimFailed: "无法把这个任务加入你的资料库。",
    languageChinese: "简体中文",
```

- [ ] **Step 4: Wire the completion-screen button**

In `apps/app/app/quiz/[attemptId].tsx`:

1. Add the import after `import { apiRequest, ClientApiError, jsonBody } from "../../src/lib/api";`:
   ```ts
   import {
     createQuizShareLink,
     shareQuizLink,
   } from "../../src/lib/quiz-share";
   ```
2. After the `cheatSheetTitle` state declaration (`const [cheatSheetTitle, setCheatSheetTitle] = useState<string>("ClipQuest cheat sheet");`) add:
   ```ts
   const [shareQuizId, setShareQuizId] = useState<string>();
   const [shareState, setShareState] = useState<
     "idle" | "working" | "copied" | "shared"
   >("idle");
   const [shareFallbackUrl, setShareFallbackUrl] = useState<string>();
   ```
3. In `applyResume`, immediately after `updateGeneration(resumed.generation);` add:
   ```ts
   if (resumed.quizId) setShareQuizId(resumed.quizId);
   ```
4. After the `useEffect` that persists the recap (the one calling `saveAttemptRecap`) add:
   ```ts
   // "Link copied" is a transient confirmation; return to the neutral label.
   useEffect(() => {
     if (shareState !== "copied" && shareState !== "shared") return;
     const timer = setTimeout(() => setShareState("idle"), 2_500);
     return () => clearTimeout(timer);
   }, [shareState]);

   const shareQuest = useCallback(async () => {
     if (!shareQuizId || shareState === "working") return;
     setShareState("working");
     setShareFallbackUrl(undefined);
     setError(undefined);
     let url: string | undefined;
     try {
       url = (await createQuizShareLink(shareQuizId)).url;
     } catch (cause) {
       setShareState("idle");
       setError(cause instanceof Error ? cause.message : t("shareFailed"));
       return;
     }
     try {
       setShareState(await shareQuizLink({ url, title: cheatSheetTitle }));
     } catch {
       // The link exists but the clipboard/share sheet refused: show it so
       // the learner can copy it by hand.
       setShareFallbackUrl(url);
       setShareState("idle");
     }
   }, [cheatSheetTitle, shareQuizId, shareState, t]);
   ```
5. In the completion JSX, between the closing `</PrimaryButton>` of the `download-cheat-sheet-pdf` button and the `<PrimaryButton trailingIcon=… {t("returnToLibrary")}` button, insert:
   ```tsx
   {shareQuizId ? (
     <PrimaryButton
       testID="share-quest"
       variant="secondary"
       loading={shareState === "working"}
       leadingIcon={
         <VoxelIcon name="link" size={20} color={theme.textOnPrimary} />
       }
       onPress={() => void shareQuest()}
     >
       {shareState === "copied"
         ? t("shareLinkCopied")
         : shareState === "shared"
           ? t("shareLinkShared")
           : t("shareQuest")}
     </PrimaryButton>
   ) : null}
   {shareFallbackUrl ? (
     <Text
       selectable
       testID="share-quest-fallback"
       style={[styles.shareFallback, { color: theme.textMuted }]}
     >
       {`${t("shareCopyManually")} ${shareFallbackUrl}`}
     </Text>
   ) : null}
   ```
6. In `styles`, after `completeActions: { width: "100%", gap: spacing[3] },` add:
   ```ts
   shareFallback: {
     fontFamily: typography.body,
     fontSize: typography.size.label,
     lineHeight: typography.lineHeight.label,
     textAlign: "center",
   },
   ```

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `npm exec -w @clipquest/app -- vitest run test/quiz-share-completion.test.ts && npm run typecheck -w @clipquest/app && npx eslint --max-warnings 0 "apps/app/app/quiz" apps/app/src/i18n/messages.ts`
Expected: PASS / clean.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write "apps/app/app/quiz/[attemptId].tsx" apps/app/src/i18n/messages.ts apps/app/test/quiz-share-completion.test.ts
git add "apps/app/app/quiz/[attemptId].tsx" apps/app/src/i18n/messages.ts apps/app/test/quiz-share-completion.test.ts
git commit -m "Share a finished quest from the completion screen" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa"
```

---

### Task 10: Library card share action

**Files:**
- Modify: `apps/app/src/components/VideoCard.tsx` (props ~line 24–44; `hoveredAction` union ~line 47; insert the action block between the "open" action and the `onDelete` block)
- Modify: `apps/app/app/(tabs)/library.tsx` (imports ~line 25; state ~line 61; handlers ~line 91–170; error block ~line 234; `QuestList` props and calls ~line 270–375)
- Modify: `apps/app/test/android-ui-regressions.test.ts` or a new `apps/app/test/video-card-share.test.ts` (source-reading assertion — see step 1)

**Interfaces:**
- Consumes: `createQuizShareLink`, `shareQuizLink` (Task 6); i18n `shareQuest`, `shareLinkCopied`, `shareLinkShared`, `shareFailed` (Task 9).
- Produces: `VideoCard` props `onShare?(): void | Promise<void>; sharePending?: boolean;` with `testID={`video-card-share-${card.videoId}`}`; Library notice `testID="library-share-notice"`.

- [ ] **Step 1: Write the failing source assertion**

Create `apps/app/test/video-card-share.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Library card share action", () => {
  it("renders a share action only for cards with a quiz and wires it through the Library", () => {
    const card = readFileSync(
      resolve(import.meta.dirname, "../src/components/VideoCard.tsx"),
      "utf8",
    );
    expect(card).toContain("onShare?(): void | Promise<void>;");
    expect(card).toContain("sharePending?: boolean;");
    expect(card).toContain("testID={`video-card-share-${card.videoId}`}");
    expect(card).toContain('<VoxelIcon name="link" size={18} />');

    const library = readFileSync(
      resolve(import.meta.dirname, "../app/(tabs)/library.tsx"),
      "utf8",
    );
    expect(library).toContain(
      "onShare={card.quizId ? () => onShare(card) : undefined}",
    );
    expect(library).toContain('testID="library-share-notice"');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm exec -w @clipquest/app -- vitest run test/video-card-share.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the action to `VideoCard.tsx`**

1. Props — extend the destructuring and the type:
   ```ts
   export function VideoCard({
     card,
     onPress,
     compact = false,
     fill = false,
     onExport,
     onGenerateNotes,
     notesPending = false,
     onShare,
     sharePending = false,
     onDelete,
     deletePending = false,
   }: {
     card: LibraryCard;
     onPress(): void;
     compact?: boolean;
     fill?: boolean;
     onExport?(): void | Promise<void>;
     onGenerateNotes?(): void | Promise<void>;
     notesPending?: boolean;
     onShare?(): void | Promise<void>;
     sharePending?: boolean;
     onDelete?(): void;
     deletePending?: boolean;
   }) {
   ```
2. `hoveredAction` union: `"notes" | "open" | "share" | "delete" | undefined`.
3. Insert this block after the "open" `actionWrap` `</View>` and before `{onDelete ? (`:
   ```tsx
   {onShare ? (
     <View style={styles.actionWrap}>
       <MotionPressable
         pressDepth={0}
         pressScale={motion.scale.iconPress}
         accessibilityRole="button"
         accessibilityLabel={t("shareQuest")}
         accessibilityHint={t("shareQuest")}
         accessibilityState={{ busy: sharePending, disabled: sharePending }}
         disabled={sharePending}
         testID={`video-card-share-${card.videoId}`}
         onBlur={() => setHoveredAction(undefined)}
         onFocus={() => setHoveredAction("share")}
         onHoverIn={() => setHoveredAction("share")}
         onHoverOut={() => setHoveredAction(undefined)}
         onPress={() => {
           if (sharePending) return;
           void Promise.resolve(onShare()).catch((cause) => {
             Alert.alert(
               t("shareQuest"),
               cause instanceof Error ? cause.message : t("shareFailed"),
             );
           });
         }}
         style={({ pressed, hovered }) => [
           styles.iconButton,
           {
             backgroundColor: hovered
               ? theme.surfaceTint
               : theme.surfaceSunken,
             borderColor: hovered ? theme.primary : theme.border,
             opacity: sharePending ? 0.45 : pressed ? 0.7 : 1,
             transform: [{ scale: hovered ? 1.06 : 1 }],
           },
           Platform.OS === "web" && {
             transitionDuration: `${motion.fast}ms`,
             transitionProperty: "transform, background-color, border-color",
             outlineColor: theme.focus,
           },
         ]}
       >
         {sharePending ? (
           <ActivityIndicator color={theme.secondary} size="small" />
         ) : (
           <VoxelIcon name="link" size={18} />
         )}
       </MotionPressable>
       {hoveredAction === "share" ? (
         <MotionView
           duration={motion.fast}
           pointerEvents="none"
           preset="pop"
           style={[
             styles.tooltip,
             {
               backgroundColor: theme.surfaceRaised,
               borderColor: theme.borderStrong,
             },
           ]}
         >
           <Text style={[styles.tooltipText, { color: theme.text }]}>
             {t("shareQuest")}
           </Text>
         </MotionView>
       ) : null}
     </View>
   ) : null}
   ```
   Do not change any existing style values in this file.

- [ ] **Step 4: Wire it in `library.tsx`**

1. Import after the `cheat-sheet` import block:
   ```ts
   import {
     createQuizShareLink,
     shareQuizLink,
   } from "../../src/lib/quiz-share";
   ```
2. State, after `const [deletingId, setDeletingId] = useState<string>();`:
   ```ts
   const [sharingId, setSharingId] = useState<string>();
   const [shareError, setShareError] = useState<string>();
   const [shareNotice, setShareNotice] = useState<string>();
   ```
3. Handler, after the `confirmDeleteQuest` `useCallback` (before the `return (`):
   ```ts
   const shareQuest = useCallback(
     async (card: LibraryCard) => {
       if (!card.quizId || sharingId) return;
       setSharingId(card.videoId);
       setShareError(undefined);
       setShareNotice(undefined);
       try {
         const link = await createQuizShareLink(card.quizId);
         const outcome = await shareQuizLink({
           url: link.url,
           title: card.title,
         });
         setShareNotice(
           outcome === "copied" ? t("shareLinkCopied") : t("shareLinkShared"),
         );
       } catch (cause) {
         setShareError(
           cause instanceof Error ? cause.message : t("shareFailed"),
         );
       } finally {
         setSharingId(undefined);
       }
     },
     [sharingId, t],
   );

   useEffect(() => {
     if (!shareNotice) return;
     const timer = setTimeout(() => setShareNotice(undefined), 2_500);
     return () => clearTimeout(timer);
   }, [shareNotice]);
   ```
   Add `useEffect` to the React import (`import { useCallback, useEffect, useMemo, useState } from "react";`).
4. Error block: change the condition and the two `error ?? openError ?? notesError` expressions to include `shareError`:
   ```tsx
   {error || openError || notesError || shareError ? (
     <FeedbackMotion
       signal={error ?? openError ?? notesError ?? shareError}
       kind="error"
     >
       <MotionView preset="rise" exiting>
         <Text
           accessibilityRole="alert"
           style={[styles.error, { color: theme.error }]}
         >
           {error ?? openError ?? notesError ?? shareError}
         </Text>
       </MotionView>
     </FeedbackMotion>
   ) : null}
   {shareNotice ? (
     <FeedbackMotion signal={shareNotice} kind="success">
       <MotionView preset="rise" exiting>
         <Text
           accessibilityLiveRegion="polite"
           testID="library-share-notice"
           style={[styles.error, { color: theme.success }]}
         >
           {shareNotice}
         </Text>
       </MotionView>
     </FeedbackMotion>
   ) : null}
   ```
5. `QuestList`: add props `sharingId?: string; onShare(card: LibraryCard): void;` to both the destructuring and the type, pass to `VideoCard`:
   ```tsx
   onShare={card.quizId ? () => onShare(card) : undefined}
   sharePending={sharingId === card.videoId}
   ```
   and add `sharingId={sharingId} onShare={(card) => void shareQuest(card)}` to all three `<QuestList …/>` call sites.

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `npm exec -w @clipquest/app -- vitest run test/video-card-share.test.ts && npm run typecheck -w @clipquest/app && npx eslint --max-warnings 0 apps/app/src/components/VideoCard.tsx "apps/app/app/(tabs)/library.tsx"`
Expected: PASS / clean.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write apps/app/src/components/VideoCard.tsx "apps/app/app/(tabs)/library.tsx" apps/app/test/video-card-share.test.ts
git add apps/app/src/components/VideoCard.tsx "apps/app/app/(tabs)/library.tsx" apps/app/test/video-card-share.test.ts
git commit -m "Share quests from Library cards" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa"
```

---

### Task 11: Public preview and claim route `app/s/[token].tsx`

**Files:**
- Create: `apps/app/app/s/[token].tsx`
- Create: `apps/app/test/shared-quest-route.test.ts` (source-reading assertion)

**Interfaces:**
- Consumes: `QuizSharePreviewSchema`, `QuizShareClaimResponseSchema`, `QuizStartResponseSchema` (contracts); `apiRequest`, `ClientApiError`, `jsonBody`; `useAppSession`; `saveAttemptStart`; `parseNextPath` is NOT needed here (this screen produces `next`, see Task 7); i18n keys from Task 9; components `Screen`, `Surface`, `EmptyState`, `PrimaryButton`, `ReliableThumbnail`, `VoxelIcon`, `MotionView`.
- Produces: route `/s/[token]` with `testID`s `share-preview-meta`, `start-shared-quest`, `sign-in-to-start`, `sign-up-to-start`.

- [ ] **Step 1: Write the failing source assertion**

Create `apps/app/test/shared-quest-route.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("shared quest route", () => {
  it("claims, starts through the ordinary quiz start endpoint, and sends signed-out learners to sign-in with next", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../app/s/[token].tsx"),
      "utf8",
    );
    expect(source).toContain("/api/shares/${encodeURIComponent(shareToken)}");
    expect(source).toContain(
      "/api/shares/${encodeURIComponent(shareToken)}/claim",
    );
    expect(source).toContain("/api/quizzes/${claim.quizId}/start");
    expect(source).toContain("...claim.startSettings");
    expect(source).toContain('testID="start-shared-quest"');
    expect(source).toContain('testID="sign-in-to-start"');
    expect(source).toContain("params: { next: `/s/${shareToken}` }");
    expect(source).not.toContain("cheat-sheet");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm exec -w @clipquest/app -- vitest run test/shared-quest-route.test.ts`
Expected: FAIL — file missing.

- [ ] **Step 3: Create the route**

Create `apps/app/app/s/[token].tsx`:

```tsx
import {
  QuizShareClaimResponseSchema,
  QuizSharePreviewSchema,
  QuizStartResponseSchema,
  type QuizSharePreview,
} from "@clipquest/contracts";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, View } from "react-native";
import { EmptyState } from "../../src/components/EmptyState";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { ReliableThumbnail } from "../../src/components/ReliableThumbnail";
import { Screen } from "../../src/components/Screen";
import { Surface } from "../../src/components/Surface";
import { VoxelIcon } from "../../src/components/VoxelIcon";
import { apiRequest, ClientApiError, jsonBody } from "../../src/lib/api";
import { useAppSession } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { saveAttemptStart } from "../../src/state/attempt";
import { borders, radii, spacing, typography } from "../../src/theme/tokens";
import { MotionView } from "../../src/motion/Motion";

type LoadStatus = "loading" | "ready" | "missing" | "failed";

export default function SharedQuestScreen() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const shareToken = Array.isArray(params.token)
    ? params.token[0]
    : params.token;
  const { t, theme } = useSettings();
  const { data: session, isPending } = useAppSession();
  const [preview, setPreview] = useState<QuizSharePreview>();
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (!shareToken) {
      setStatus("missing");
      return;
    }
    setStatus("loading");
    apiRequest(
      `/api/shares/${encodeURIComponent(shareToken)}`,
      {},
      QuizSharePreviewSchema,
    )
      .then((value) => {
        if (!active) return;
        setPreview(value);
        setStatus("ready");
      })
      .catch((cause) => {
        if (!active) return;
        setStatus(
          cause instanceof ClientApiError && cause.status === 404
            ? "missing"
            : "failed",
        );
      });
    return () => {
      active = false;
    };
  }, [reloadKey, shareToken]);

  const start = useCallback(async () => {
    const userId = session?.user.id;
    if (!shareToken || !userId || starting) return;
    setStarting(true);
    setError(undefined);
    try {
      const claim = await apiRequest(
        `/api/shares/${encodeURIComponent(shareToken)}/claim`,
        { method: "POST" },
        QuizShareClaimResponseSchema,
      );
      const started = await apiRequest(
        `/api/quizzes/${claim.quizId}/start`,
        {
          method: "POST",
          headers: { "Idempotency-Key": Crypto.randomUUID() },
          body: jsonBody({ mode: "learn", ...claim.startSettings }),
        },
        QuizStartResponseSchema,
      );
      await saveAttemptStart(userId, started);
      router.replace({
        pathname: "/quiz/[attemptId]",
        params: { attemptId: started.attemptId },
      });
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.status === 401) {
        router.push({
          pathname: "/(auth)/sign-in",
          params: { next: `/s/${shareToken}` },
        });
        return;
      }
      setError(cause instanceof Error ? cause.message : t("shareClaimFailed"));
    } finally {
      setStarting(false);
    }
  }, [session?.user.id, shareToken, starting, t]);

  if (status === "loading") {
    return (
      <Screen contentWidth="reading" centered>
        <ActivityIndicator
          accessibilityLabel={t("loading")}
          size="large"
          color={theme.primary}
        />
      </Screen>
    );
  }

  if (status === "missing" || !preview) {
    return (
      <Screen contentWidth="reading" centered>
        <EmptyState
          icon="link"
          title={t("shareNotFoundTitle")}
          description={t("shareNotFoundBody")}
          action={
            <PrimaryButton
              leadingIcon={
                <VoxelIcon name="home" size={20} color={theme.textOnAction} />
              }
              onPress={() => router.replace("/")}
            >
              {t("home")}
            </PrimaryButton>
          }
        />
      </Screen>
    );
  }

  if (status === "failed") {
    return (
      <Screen contentWidth="reading" centered>
        <EmptyState
          icon="error"
          title={t("shareLoadFailed")}
          description={t("shareLoadFailedBody")}
          action={
            <PrimaryButton onPress={() => setReloadKey((key) => key + 1)}>
              {t("retry")}
            </PrimaryButton>
          }
        />
      </Screen>
    );
  }

  const typeLabels = preview.questionTypes.map((type) =>
    type === "multiple_choice"
      ? t("multipleChoice")
      : type === "true_false"
        ? t("trueFalse")
        : t("shortAnswer"),
  );
  const languageLabel =
    preview.language === "zh-CN"
      ? t("languageChinese")
      : preview.language === "en"
        ? t("languageEnglish")
        : preview.language;
  const meta = [
    `${preview.questionCount} ${t("questions").toLowerCase()}`,
    ...typeLabels,
    languageLabel,
  ].join(" · ");

  return (
    <Screen contentWidth="reading" centered>
      <MotionView preset="rise" style={styles.wrap}>
        <Surface elevated padded={false} style={styles.card}>
          <ReliableThumbnail
            uri={preview.thumbnailUrl}
            accessibilityLabel={preview.title}
            presentation="preview"
            recyclingKey={preview.token}
            testID="share-preview-thumbnail"
            style={styles.thumbnail}
          />
          <View style={styles.body}>
            <Text style={[styles.eyebrow, { color: theme.primary }]}>
              {t("sharePreviewEyebrow")}
            </Text>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: theme.text }]}
            >
              {preview.title}
            </Text>
            {preview.sharedBy ? (
              <Text style={[styles.sharedBy, { color: theme.textMuted }]}>
                {`${t("sharedBy")} ${preview.sharedBy}`}
              </Text>
            ) : null}
            <Text
              testID="share-preview-meta"
              style={[styles.meta, { color: theme.textMuted }]}
            >
              {meta}
            </Text>
            {preview.concepts.length ? (
              <View style={styles.concepts}>
                <Text
                  style={[styles.conceptsTitle, { color: theme.text }]}
                >
                  {t("shareConceptsTitle")}
                </Text>
                <View style={styles.chips}>
                  {preview.concepts.map((concept) => (
                    <View
                      key={concept}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: theme.primarySoft,
                          borderColor: theme.primary,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: theme.text }]}>
                        {concept}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            <View style={styles.actions}>
              {isPending ? (
                <ActivityIndicator color={theme.primary} />
              ) : session ? (
                <PrimaryButton
                  testID="start-shared-quest"
                  loading={starting}
                  trailingIcon={
                    <VoxelIcon
                      name="next"
                      size={20}
                      color={theme.textOnAction}
                    />
                  }
                  onPress={() => void start()}
                >
                  {t("startSharedQuest")}
                </PrimaryButton>
              ) : (
                <>
                  <PrimaryButton
                    testID="sign-in-to-start"
                    leadingIcon={
                      <VoxelIcon
                        name="sign-in"
                        size={20}
                        color={theme.textOnAction}
                      />
                    }
                    onPress={() =>
                      router.push({
                        pathname: "/(auth)/sign-in",
                        params: { next: `/s/${shareToken}` },
                      })
                    }
                  >
                    {t("signInToStart")}
                  </PrimaryButton>
                  <PrimaryButton
                    testID="sign-up-to-start"
                    variant="ghost"
                    onPress={() =>
                      router.push({
                        pathname: "/(auth)/sign-up",
                        params: { next: `/s/${shareToken}` },
                      })
                    }
                  >
                    {t("signUp")}
                  </PrimaryButton>
                </>
              )}
              <PrimaryButton
                variant="ghost"
                leadingIcon={
                  <VoxelIcon name="video" size={20} color={theme.text} />
                }
                onPress={() => void Linking.openURL(preview.originalUrl)}
              >
                {t("watchLesson")}
              </PrimaryButton>
            </View>
            {error ? (
              <Text
                accessibilityRole="alert"
                style={[styles.error, { color: theme.error }]}
              >
                {error}
              </Text>
            ) : null}
          </View>
        </Surface>
      </MotionView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  card: { overflow: "hidden" },
  thumbnail: { width: "100%", aspectRatio: 16 / 9 },
  body: { padding: spacing[5], gap: spacing[3] },
  eyebrow: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
    letterSpacing: typography.tracking.wide,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  sharedBy: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  meta: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  concepts: { gap: spacing[2], marginTop: spacing[1] },
  conceptsTitle: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  chip: {
    borderWidth: borders.hairline,
    borderRadius: radii.pill,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  chipText: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  actions: { gap: spacing[3], marginTop: spacing[2] },
  error: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
```

Notes for the implementer:
- If `npm run typecheck -w @clipquest/app` complains about the `router.push({ pathname: "/(auth)/sign-in", params })` objects under typed routes, cast the object `as never` — mirror how `_layout.tsx` casts deep-link routes. Keep the three `router.push` calls inline (no shared `href` constant) so `react-hooks/exhaustive-deps` stays quiet.
- `router.replace("/")` is typed; `/` is the index route.
- The route lives outside `(tabs)` and `(auth)`, so neither the tab auth redirect nor the extension gate applies.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npm exec -w @clipquest/app -- vitest run test/shared-quest-route.test.ts && npm run typecheck -w @clipquest/app && npx eslint --max-warnings 0 "apps/app/app/s"`
Expected: PASS / clean.

- [ ] **Step 5: Smoke the page in the browser (manual, web)**

Run (background, from the worktree root): `npm run dev:web` — wait for `http://localhost:8081`, then open `http://localhost:8081/s/9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a` (the real API is not running, so you should see the "This link is no longer available" / retry empty state, not a crash or a route 404). Stop the server afterwards and run `git checkout -- apps/app/public/clipquest-captions-extension.zip` if `git status` shows the zip modified.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write "apps/app/app/s/[token].tsx" apps/app/test/shared-quest-route.test.ts
git add "apps/app/app/s/[token].tsx" apps/app/test/shared-quest-route.test.ts
git commit -m "Add shared quest preview and claim route" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa"
```

---

### Task 12: Playwright journey — share, preview signed out, sign in, start

**Files:**
- Modify: `e2e/clipquest.spec.ts` (constants ~line 10–27; `Scenario` type ~line 30; `installMocks` defaults ~line 1866–1886; `get-session` mock ~line 1929; quiz start mock ~line 2318; resume mock ~line 2457; add the new test after the "completion recap…" test ~line 1409)

**Interfaces:**
- Consumes: `testID`s `share-quest` (Task 9), `start-shared-quest`, `sign-in-to-start`, `share-preview-meta` (Task 11); `next` param on sign-in (Task 7); helpers `installMocks`, `json`, `sessionFixture`, `expectQuizRoute`, constants `BASE_URL`, `QUIZ_ID`, `VIDEO_ID`, `COMPLETE_ATTEMPT_ID`, `importedVideo`, `THUMBNAIL_URL`.

- [ ] **Step 1: Add fixtures and scenario fields**

After `const GENERATION_IMPORT_KEY = …;` add:

```ts
const SHARE_TOKEN = "9a9a9a9a-9a9a-49a9-8a9a-9a9a9a9a9a9a";
const SHARE_URL = `${BASE_URL}/s/${SHARE_TOKEN}`;
```

Extend the `Scenario` type with:

```ts
  signedIn: boolean;
  resumeQuizContext: boolean;
  shareCreated: number;
  shareClaims: number;
```

and the defaults object in `installMocks` with:

```ts
    signedIn: true,
    resumeQuizContext: false,
    shareCreated: 0,
    shareClaims: 0,
```

After the `importedVideo` fixture (it ends with the `capture` / `captions` blocks) add:

```ts
const sharePreview = {
  token: SHARE_TOKEN,
  title: importedVideo.video.title,
  originalUrl: "https://www.youtube.com/watch?v=clipquest-learning-science",
  thumbnailUrl: THUMBNAIL_URL,
  sharedBy: "Avery Learner",
  language: "en",
  sessionLength: "short" as const,
  questionCount: 5,
  questionTypes: ["multiple_choice"] as const,
  concepts: ["Retrieval practice", "Spacing", "Sleep and consolidation"],
};
```

- [ ] **Step 2: Extend the API mock dispatcher**

Replace the `get-session` branch with:

```ts
    if (path === "/api/auth/get-session") {
      await json(route, scenario.signedIn ? sessionFixture() : null);
      return;
    }
    if (path === "/api/auth/sign-in/email" && request.method() === "POST") {
      scenario.signedIn = true;
      await json(route, {
        redirect: false,
        token: "playwright-session",
        user: sessionFixture().user,
      });
      return;
    }
    if (
      path === `/api/quizzes/${QUIZ_ID}/share` &&
      request.method() === "POST"
    ) {
      scenario.shareCreated += 1;
      await json(route, { token: SHARE_TOKEN, url: SHARE_URL });
      return;
    }
    if (path === `/api/shares/${SHARE_TOKEN}` && request.method() === "GET") {
      await json(route, sharePreview);
      return;
    }
    if (
      path === `/api/shares/${SHARE_TOKEN}/claim` &&
      request.method() === "POST"
    ) {
      scenario.shareClaims += 1;
      await json(route, {
        quizId: QUIZ_ID,
        videoId: VIDEO_ID,
        startSettings: {
          sessionLength: "short",
          questionTypes: ["multiple_choice"],
        },
      });
      return;
    }
```

In the `/resume` branch, add the quiz context when the scenario asks for it — change the `json(route, { … })` body to start with:

```ts
      await json(route, {
        attemptId: completed ? COMPLETE_ATTEMPT_ID : ATTEMPT_ID,
        ...(scenario.resumeQuizContext
          ? {
              quizId: QUIZ_ID,
              videoId: VIDEO_ID,
              title: importedVideo.video.title,
            }
          : {}),
        question: completed ? null : scenario.question,
```

(the remaining fields are unchanged). Keeping the context behind a flag leaves every existing journey byte-identical in behaviour.

- [ ] **Step 3: Write the journey**

After the test `"completion recap lists missed questions…"` add:

```ts
test("shares a finished quest; a signed-out recipient previews it, signs in, and starts it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  const scenario = await installMocks(page);
  scenario.resumeQuizContext = true;
  scenario.completedAttempt = true;
  await page.addInitScript(() => {
    const copied: string[] = [];
    (window as unknown as { __copied: string[] }).__copied = copied;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied.push(text);
        },
      },
    });
  });

  // Owner: the completion screen offers one stable link and copies it.
  await page.goto(`/quiz/${COMPLETE_ATTEMPT_ID}`);
  await expect(
    page.getByRole("heading", { name: "Quest complete!" }),
  ).toBeVisible();
  const shareButton = page.getByTestId("share-quest");
  await expect(shareButton).toContainText("Share this quest");
  await shareButton.click();
  await expect(shareButton).toContainText("Link copied");
  expect(scenario.shareCreated).toBe(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { __copied: string[] }).__copied,
    ),
  ).toEqual([SHARE_URL]);
  await expect(shareButton).toContainText("Share this quest", {
    timeout: 5_000,
  });

  // Recipient: signed out, the public preview renders without questions.
  scenario.signedIn = false;
  await page.goto(`/s/${SHARE_TOKEN}`);
  await expect(
    page.getByRole("heading", { name: importedVideo.video.title }),
  ).toBeVisible();
  await expect(page.getByText("Shared by Avery Learner")).toBeVisible();
  await expect(page.getByTestId("share-preview-meta")).toHaveText(
    "5 questions · Multiple choice · English",
  );
  await expect(page.getByText("Sleep and consolidation")).toBeVisible();
  await expect(page.getByTestId("start-shared-quest")).toHaveCount(0);
  await capture(page, "desktop-shared-quest-preview");

  // Signing in returns to the same preview.
  await page.getByTestId("sign-in-to-start").click();
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await page.getByLabel("Email / Username").fill("avery@example.com");
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(SHARE_URL);

  // Claim + ordinary start land on the quiz route.
  const startButton = page.getByTestId("start-shared-quest");
  await expect(startButton).toBeVisible({ timeout: 10_000 });
  await startButton.click();
  await expectQuizRoute(page);
  expect(scenario.shareClaims).toBe(1);
  expect(scenario.quizStartBodies).toEqual([
    {
      mode: "learn",
      sessionLength: "short",
      questionTypes: ["multiple_choice"],
    },
  ]);
  expect(
    scenario.requestedPaths.filter((path) =>
      path.startsWith(`/api/shares/${SHARE_TOKEN}`),
    ),
  ).toEqual([
    `/api/shares/${SHARE_TOKEN}`,
    `/api/shares/${SHARE_TOKEN}`,
    `/api/shares/${SHARE_TOKEN}/claim`,
  ]);
});
```

If the preview is fetched a different number of times before the claim (React strict effects / the post-sign-in remount), adjust the final `requestedPaths` expectation to the observed sequence rather than weakening it to a `toContain` — the point is that the claim happens exactly once.

- [ ] **Step 4: Run the new journey alone, then the whole e2e suite**

Run: `npx playwright test -g "shares a finished quest"`
Expected: 1 passed. The web server is started by Playwright (`npm run web:e2e -w @clipquest/app`); the local start budget is 120 s, so do not run other heavy processes at the same time.

Then run: `npm run test:e2e`
Expected: all journeys pass (24 existing + 1 new).

After both runs: `git checkout -- apps/app/public/clipquest-captions-extension.zip` (only if `git status` lists it).

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write e2e/clipquest.spec.ts
git add e2e/clipquest.spec.ts
git commit -m "Cover the shared quest journey end to end" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa"
```

---

### Task 13: Documentation

**Files:**
- Modify: `docs/HACKATHON.md` (§4 "What is built and verified", §8 "What we would do next")
- Modify: `README.md` (§ "Learning journey", add step 7; § "Verification and builds" sentence)
- Modify: `docs/PRODUCTION-RELEASE.md` (§ "Current web and native source candidate")

- [ ] **Step 1: HACKATHON.md**

In §4, add a bullet after the "Android / iOS" bullet:

```markdown
- **Quest sharing (web-first)** — a finished quest publishes one stable link
  (`/s/<token>`). Anyone can open the public preview (title, concept names, question
  count and types — never the questions or answers); a signed-in recipient gets their
  own copy of the validated bank and works it with the full feedback / recap / mastery
  loop. Covered by API tests (`apps/api/test/shares.test.ts`) and a Playwright journey.
```

In §8, replace item 3 with:

```markdown
3. **Teacher dashboard on top of quest sharing** — sharing a validated bank with a class
   ships in this release; next is a lightweight view of commonly-missed concepts across
   the recipients of one link (the `quiz_share_claims` table already records which copy
   came from which link).
```

- [ ] **Step 2: README.md**

In "🗺️ Learning journey", after "### 6. Open on question 1 and recover invisibly" paragraph (before `<p align="right">…Back to top`), add:

```markdown
### 7. Share the quest

The completion screen and every Library card offer **Share this quest**. ClipQuest mints one stable link per bank (`https://clipquest.ccwu.cc/s/<token>`), copies it to the clipboard on desktop web and opens the share sheet on touch devices. The link renders a public preview—lesson title, concept names, question count and types, never the questions or answers—and a signed-in recipient gets their own copy of the validated bank with the complete feedback, recap, mastery and cheat-sheet loop. Links require no extension to play.
```

In "🛠️ Verification and builds", extend the coverage sentence (the long paragraph starting "The suite covers …") by appending before its final period: `, and quest sharing (link creation, the public preview, and copy-on-claim)`.

- [ ] **Step 3: PRODUCTION-RELEASE.md**

In "## Current web and native source candidate", after the paragraph that ends "No D1 migration is required. Worker deployment, extension installation, …", add:

```markdown
Quest sharing adds D1 migration `0026_quiz_shares.sql` (two additive tables: `quiz_shares`, `quiz_share_claims`). Apply it with `npm run db:migrate:remote` **before** promoting the Worker version that mounts `/api/shares`; a Worker rollback leaves the tables unused and is safe. The public preview endpoint is rate limited per IP and exposes no question text.
```

- [ ] **Step 4: Format check and commit**

Run: `npx prettier --check README.md docs/HACKATHON.md docs/PRODUCTION-RELEASE.md` (fix with `--write` if needed).

```bash
git add README.md docs/HACKATHON.md docs/PRODUCTION-RELEASE.md
git commit -m "Document quest sharing" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UvsizRivyBxDaSuMRdMuoa"
```

---

### Task 14: Full gate and hand-off

**Files:** none new.

- [ ] **Step 1: Run the complete quality gate sequentially**

```bash
npm run build -w @clipquest/contracts
npm run format:check
npm run lint
npm run typecheck
npm test
```

Expected: all green. Fix anything that fails inside the task that introduced it (small follow-up commit).

- [ ] **Step 2: Run the browser journeys once more if any app/e2e file changed after Task 12**

`npm run test:e2e`, then `git checkout -- apps/app/public/clipquest-captions-extension.zip` if needed.

- [ ] **Step 3: Rebase onto the latest `origin/main` and re-run the gate if anything moved**

```bash
git fetch origin
git rebase origin/main
```

If the rebase touches `apps/app/app/quiz/[attemptId].tsx`, `VideoCard.tsx`, or `library.tsx` (the user's concurrent UI work), resolve keeping both sides, then re-run `npm run typecheck && npm test` and the share e2e test.

- [ ] **Step 4: Hand off**

Invoke `superpowers:finishing-a-development-branch` to choose between opening a PR from `share-quiz` (CI runs the same gate) or merging locally. The PR description should link the spec and note the migration requirement.

---

## Self-review (done while writing)

- **Spec coverage:** data model (T1), contracts (T1), create/preview/claim API (T2–T4), wiring + shell + AASA (T5), share helper (T6), `next` return path (T7), native deep link + intent filter (T8), i18n + completion button (T9), Library card (T10), preview/claim route (T11), e2e (T12), docs (T13), gate (T14). Revocation, OG tags and the dashboard are out of scope per the spec.
- **Placeholders:** none — every step carries the code or the exact command.
- **Type consistency:** `ShareQuizLinkDeps` fields (`platform`, `webShare`, `coarsePointer`, `writeClipboardText`, `copyToClipboard`, `nativeShare`) match between T6 code and tests; `QuizShareStartSettings` is produced by `shareStartSettings` (T4) and consumed verbatim by the claim route and by `…claim.startSettings` in T11; the e2e claim fixture (T12) matches `QuizShareClaimResponseSchema`; `testID`s match between T9/T10/T11 and T12.
