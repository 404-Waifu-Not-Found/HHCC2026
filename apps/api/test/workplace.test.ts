import { DatabaseSync } from "node:sqlite";
import {
  WorkplaceMessageSyncResponseSchema,
  WorkplaceMessagesResponseSchema,
  WorkplacePracticeSetImportResponseSchema,
  WorkplaceSuggestionsResponseSchema,
  WorkplaceThreadDeleteResponseSchema,
  WorkplaceThreadListResponseSchema,
  WorkplaceThreadResponseSchema,
  type LocalConceptQuizQuestion,
  type QuizQuestionType,
  type WorkplacePracticeSet,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { errorResponse } from "../src/lib/errors";
import type { ApiBindings } from "../src/middleware/authenticated";
import {
  collectReferencedVideoIds,
  decodeWorkplaceMessagesCursor,
  encodeWorkplaceMessagesCursor,
  workplaceRouter,
} from "../src/routes/workplace";

// ---------------------------------------------------------------------------
// A real, in-memory SQLite database standing in for D1: the route file's
// exact SQL strings run against real schema/constraints (UNIQUE, CHECK,
// foreign keys, RETURNING), rather than hand-mocked JS logic, so the tests
// exercise the same idempotency/ordinal/cascade behavior D1 would enforce.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);

CREATE TABLE videos (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('youtube', 'bilibili')),
  source_video_id TEXT NOT NULL,
  original_url TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail_key TEXT,
  thumbnail_remote_url TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  source_language TEXT,
  origin TEXT NOT NULL DEFAULT 'paste',
  education_status TEXT NOT NULL DEFAULT 'unknown',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE workplace_threads (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE workplace_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES workplace_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  client_message_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  parts_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(thread_id, ordinal),
  UNIQUE(thread_id, client_message_id)
);

CREATE TABLE quiz_banks (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  session_length TEXT NOT NULL,
  primer TEXT NOT NULL,
  concepts_json TEXT NOT NULL,
  watched INTEGER NOT NULL DEFAULT 1,
  pipeline_version INTEGER NOT NULL DEFAULT 1,
  quality_status TEXT NOT NULL DEFAULT 'legacy',
  quality_summary_json TEXT NOT NULL DEFAULT '{}',
  import_key TEXT,
  origin TEXT NOT NULL DEFAULT 'quest' CHECK(origin IN ('quest', 'workplace')),
  affects_mastery INTEGER NOT NULL DEFAULT 1 CHECK(affects_mastery IN (0, 1)),
  workplace_thread_id TEXT REFERENCES workplace_threads(id) ON DELETE SET NULL,
  assessment_rationale TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX quiz_banks_import_key_idx
  ON quiz_banks(user_id, import_key)
  WHERE import_key IS NOT NULL;

CREATE TABLE questions (
  id TEXT PRIMARY KEY NOT NULL,
  quiz_id TEXT NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
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
  generation_metadata_json TEXT,
  UNIQUE(quiz_id, ordinal)
);

CREATE TABLE mastery (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'not_started',
  best_score REAL,
  initial_passed_at INTEGER,
  review_passed_at INTEGER,
  next_review_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, video_id)
);

CREATE TABLE api_rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

type FakeStatement = {
  bind(...args: unknown[]): {
    first<T>(): Promise<T | null>;
    run(): Promise<{ meta: { changes: number; last_row_id: number } }>;
    all<T>(): Promise<{ results: T[] }>;
  };
};

function execute(
  sqliteDb: DatabaseSync,
  sql: string,
  args: unknown[],
): { results: Record<string, unknown>[]; changes: number; lastRowId: number } {
  const stmt = sqliteDb.prepare(sql);
  const results = stmt.all(
    ...(args as (string | number | null)[]),
  ) as Record<string, unknown>[];
  const changes = (
    sqliteDb.prepare("SELECT changes() AS c").get() as { c: number }
  ).c;
  const lastRowId = (
    sqliteDb.prepare("SELECT last_insert_rowid() AS id").get() as {
      id: number;
    }
  ).id;
  return { results, changes, lastRowId };
}

function makeFakeD1(sqliteDb: DatabaseSync): D1Database {
  function prepareBound(sql: string, args: unknown[]) {
    return {
      sql,
      args,
      async first<T>(): Promise<T | null> {
        const { results } = execute(sqliteDb, sql, args);
        return (results[0] as T | undefined) ?? null;
      },
      async run() {
        const { changes, lastRowId } = execute(sqliteDb, sql, args);
        return { meta: { changes, last_row_id: lastRowId } };
      },
      async all<T>() {
        const { results } = execute(sqliteDb, sql, args);
        return { results: results as T[] };
      },
    };
  }

  function prepare(sql: string): FakeStatement {
    return {
      ...prepareBound(sql, []),
      bind(...args: unknown[]) {
        return prepareBound(sql, args);
      },
    };
  }

  return {
    prepare,
    async batch(statements: ReturnType<typeof prepareBound>[]) {
      const out = [];
      for (const statement of statements) {
        const { results, changes, lastRowId } = execute(
          sqliteDb,
          statement.sql,
          statement.args,
        );
        out.push({ results, meta: { changes, last_row_id: lastRowId } });
      }
      return out;
    },
  } as unknown as D1Database;
}

function makeTestDb(): D1Database {
  const sqliteDb = new DatabaseSync(":memory:");
  sqliteDb.exec(SCHEMA_SQL);
  return makeFakeD1(sqliteDb);
}

function testApp(db: D1Database, userId: string) {
  const app = new Hono<ApiBindings>();
  app.use("*", async (context, next) => {
    context.set("user", {
      id: userId,
      email: `${userId}@example.com`,
      name: "Test user",
      username: null,
      role: "user",
      banned: false,
    });
    await next();
  });
  app.route("/workplace", workplaceRouter);
  app.onError((error, context) => errorResponse(error, context));
  return {
    app,
    env: { DB: db } as unknown as ApiBindings["Bindings"],
  };
}

function insertUser(db: D1Database, userId: string) {
  return (db.prepare("INSERT INTO user (id) VALUES (?)").bind(userId) as any)
    .run();
}

function insertVideo(
  db: D1Database,
  input: { id: string; ownerId: string; title?: string; updatedAt?: number },
) {
  return (
    db
      .prepare(
        `INSERT INTO videos (id, owner_id, source, source_video_id, original_url, title, thumbnail_remote_url, duration_seconds, source_language, created_at, updated_at)
         VALUES (?, ?, 'youtube', ?, ?, ?, ?, 600, 'en', ?, ?)`,
      )
      .bind(
        input.id,
        input.ownerId,
        `src-${input.id}`,
        `https://youtube.example/${input.id}`,
        input.title ?? `Video ${input.id}`,
        `https://thumb.example/${input.id}.jpg`,
        input.updatedAt ?? Date.now(),
        input.updatedAt ?? Date.now(),
      ) as any
  ).run();
}

const USER_ID = "11111111-0000-0000-0000-000000000001";
const OTHER_USER_ID = "22222222-0000-0000-0000-000000000002";

const VIDEO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_VIDEO_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function citation(videoId = VIDEO_ID) {
  return {
    videoId,
    title: "Ion channel gating",
    startMs: 1_000,
    endMs: 5_000,
    quote:
      "Ion channels open in response to a voltage change across the membrane.",
  };
}

function localQuestion(
  type: QuizQuestionType,
  index: number,
): LocalConceptQuizQuestion {
  const common = {
    id: `q${index + 1}`,
    concept: `Concept ${index + 1}`,
    question: `How does concept ${index + 1} work?`,
    explanation: `Concept ${index + 1} supports this answer.`,
  };
  if (type === "multiple_choice") {
    return {
      ...common,
      type,
      choices: [
        `Correct ${index + 1}`,
        `Distractor A ${index + 1}`,
        `Distractor B ${index + 1}`,
        `Distractor C ${index + 1}`,
      ],
      answerIndex: 0,
      answer: `Correct ${index + 1}`,
    };
  }
  if (type === "true_false") {
    return {
      ...common,
      type,
      answer: index % 2 === 0,
      correction: "The statement is accurate or corrected here.",
    };
  }
  return {
    ...common,
    type,
    answer: `Complete answer ${index + 1}`,
    rubricIdeas: [`Required idea ${index + 1}`],
    acceptableAnswers: [`Equivalent answer ${index + 1}`],
  };
}

function practiceSet(
  overrides: Record<string, unknown> = {},
): WorkplacePracticeSet {
  const types: QuizQuestionType[] = [
    "multiple_choice",
    "true_false",
    "short_answer",
    "multiple_choice",
    "true_false",
  ];
  return {
    questions: types.map((type, index) => localQuestion(type, index)),
    requestedPolicy: "practice",
    effectivePolicy: "practice",
    rationale: "Five questions grounded in your two most recent uploads.",
    videoIds: [VIDEO_ID],
    transcriptComplete: true,
    citations: [citation()],
    ...overrides,
  } as WorkplacePracticeSet;
}

async function createThread(
  app: Hono<ApiBindings>,
  env: ApiBindings["Bindings"],
  title?: string,
): Promise<string> {
  const response = await app.request(
    "/workplace/threads",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(title ? { title } : {}),
    },
    env,
  );
  const body = WorkplaceThreadResponseSchema.parse(await response.json());
  return body.thread.id;
}

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe("collectReferencedVideoIds", () => {
  it("collects video IDs referenced across every part kind", () => {
    const ids = collectReferencedVideoIds([
      { type: "text", text: "Hello" },
      { type: "citation", citation: citation(VIDEO_ID) },
      {
        type: "tool_status",
        tool: {
          name: "find_due_reviews",
          status: "complete",
          summary: "Found a due review.",
          citations: [citation(OTHER_VIDEO_ID)],
        },
      },
      {
        type: "practice_set",
        practiceSet: practiceSet({ videoIds: [VIDEO_ID, OTHER_VIDEO_ID] }),
      },
    ]);
    expect(new Set(ids)).toEqual(new Set([VIDEO_ID, OTHER_VIDEO_ID]));
  });

  it("returns an empty array for a text-only message", () => {
    expect(
      collectReferencedVideoIds([{ type: "text", text: "Just text" }]),
    ).toEqual([]);
  });
});

describe("workplace messages cursor", () => {
  it("round-trips an ordinal", () => {
    expect(decodeWorkplaceMessagesCursor(encodeWorkplaceMessagesCursor(42))).toBe(
      42,
    );
  });

  it("rejects a non-numeric cursor", () => {
    expect(() => decodeWorkplaceMessagesCursor("not-a-number")).toThrow();
    expect(() => decodeWorkplaceMessagesCursor("-1")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

describe("GET /workplace/suggestions", () => {
  it("returns exactly three uniquely-kinded suggestions referencing only the caller's videos", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    insertVideo(db, { id: VIDEO_ID, ownerId: USER_ID, updatedAt: 1_000 });
    insertVideo(db, { id: OTHER_VIDEO_ID, ownerId: USER_ID, updatedAt: 2_000 });
    const { app, env } = testApp(db, USER_ID);

    const response = await app.request("/workplace/suggestions", {}, env);
    expect(response.status).toBe(200);
    const body = WorkplaceSuggestionsResponseSchema.parse(
      await response.json(),
    );
    expect(body.suggestions).toHaveLength(3);
    expect(new Set(body.suggestions.map((s) => s.kind)).size).toBe(3);
    for (const suggestion of body.suggestions) {
      expect([VIDEO_ID, OTHER_VIDEO_ID]).toContain(suggestion.videoId);
    }
  });

  it("never surfaces another user's videos", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    insertUser(db, OTHER_USER_ID);
    insertVideo(db, { id: VIDEO_ID, ownerId: OTHER_USER_ID });
    const { app, env } = testApp(db, USER_ID);

    const response = await app.request("/workplace/suggestions", {}, env);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "workplace_suggestions_unavailable" },
    });
  });

  it("returns 404 rather than inventing a video for an empty library", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    const { app, env } = testApp(db, USER_ID);

    const response = await app.request("/workplace/suggestions", {}, env);
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Thread CRUD
// ---------------------------------------------------------------------------

describe("workplace thread CRUD", () => {
  it("creates a thread with a default title when none is given", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    const { app, env } = testApp(db, USER_ID);

    const response = await app.request(
      "/workplace/threads",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      env,
    );
    expect(response.status).toBe(201);
    const body = WorkplaceThreadResponseSchema.parse(await response.json());
    expect(body.thread.title.length).toBeGreaterThan(0);
    expect(body.thread.messageCount).toBe(0);
  });

  it("lists only the caller's own threads, most recently updated first", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    insertUser(db, OTHER_USER_ID);
    const { app, env } = testApp(db, USER_ID);
    const other = testApp(db, OTHER_USER_ID);

    const firstId = await createThread(app, env, "First");
    await new Promise((resolve) => setTimeout(resolve, 2));
    const secondId = await createThread(app, env, "Second");
    await createThread(other.app, other.env, "Someone else's thread");

    const response = await app.request("/workplace/threads", {}, env);
    const body = WorkplaceThreadListResponseSchema.parse(
      await response.json(),
    );
    expect(body.threads.map((t) => t.id)).toEqual([secondId, firstId]);
  });

  it("404s getting, renaming, and deleting another user's thread", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    insertUser(db, OTHER_USER_ID);
    const { app, env } = testApp(db, USER_ID);
    const other = testApp(db, OTHER_USER_ID);
    const threadId = await createThread(app, env, "Mine");

    const getResponse = await other.app.request(
      `/workplace/threads/${threadId}`,
      {},
      other.env,
    );
    expect(getResponse.status).toBe(404);

    const renameResponse = await other.app.request(
      `/workplace/threads/${threadId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Hijacked" }),
      },
      other.env,
    );
    expect(renameResponse.status).toBe(404);

    const deleteResponse = await other.app.request(
      `/workplace/threads/${threadId}`,
      { method: "DELETE" },
      other.env,
    );
    expect(deleteResponse.status).toBe(404);
  });

  it("renames an owned thread", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);

    const response = await app.request(
      `/workplace/threads/${threadId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed thread" }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const body = WorkplaceThreadResponseSchema.parse(await response.json());
    expect(body.thread.title).toBe("Renamed thread");
  });

  it("deletes an owned thread and cascades to its messages", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    insertVideo(db, { id: VIDEO_ID, ownerId: USER_ID });
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);
    await app.request(
      `/workplace/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          clientMessageId: "m1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        }),
      },
      env,
    );

    const response = await app.request(
      `/workplace/threads/${threadId}`,
      { method: "DELETE" },
      env,
    );
    expect(response.status).toBe(200);
    expect(
      WorkplaceThreadDeleteResponseSchema.parse(await response.json()),
    ).toEqual({ deleted: true });

    const getResponse = await app.request(
      `/workplace/threads/${threadId}`,
      {},
      env,
    );
    expect(getResponse.status).toBe(404);

    const remainingMessages = await (
      db
        .prepare("SELECT COUNT(*) AS c FROM workplace_messages WHERE thread_id = ?")
        .bind(threadId) as any
    ).first();
    expect(remainingMessages.c).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Messages: pagination + idempotent append
// ---------------------------------------------------------------------------

describe("workplace message append and pagination", () => {
  it("assigns monotonically increasing ordinals across distinct appends", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);

    for (let i = 0; i < 3; i += 1) {
      const response = await app.request(
        `/workplace/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId,
            clientMessageId: `m${i}`,
            role: "user",
            parts: [{ type: "text", text: `Message ${i}` }],
          }),
        },
        env,
      );
      expect(response.status).toBe(201);
    }

    const listResponse = await app.request(
      `/workplace/threads/${threadId}/messages`,
      {},
      env,
    );
    const body = WorkplaceMessagesResponseSchema.parse(
      await listResponse.json(),
    );
    expect(body.messages.map((m) => m.clientMessageId)).toEqual([
      "m0",
      "m1",
      "m2",
    ]);
  });

  it("is idempotent under a retried append with the same client_message_id", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);
    const payload = {
      threadId,
      clientMessageId: "retry-me",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Idempotent hello" }],
    };

    const first = await app.request(
      `/workplace/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      env,
    );
    expect(first.status).toBe(201);
    const firstBody = WorkplaceMessageSyncResponseSchema.parse(
      await first.json(),
    );

    const second = await app.request(
      `/workplace/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      env,
    );
    expect(second.status).toBe(200);
    const secondBody = WorkplaceMessageSyncResponseSchema.parse(
      await second.json(),
    );
    expect(secondBody.message.id).toBe(firstBody.message.id);

    const countRow = await (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM workplace_messages WHERE thread_id = ?",
        )
        .bind(threadId) as any
    ).first();
    expect(countRow.c).toBe(1);

    const threadResponse = await app.request(
      `/workplace/threads/${threadId}`,
      {},
      env,
    );
    const threadBody = WorkplaceThreadResponseSchema.parse(
      await threadResponse.json(),
    );
    expect(threadBody.thread.messageCount).toBe(1);
  });

  it("rejects a reused client_message_id with different content", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);

    await app.request(
      `/workplace/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          clientMessageId: "dup",
          role: "user",
          parts: [{ type: "text", text: "First version" }],
        }),
      },
      env,
    );
    const conflict = await app.request(
      `/workplace/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          clientMessageId: "dup",
          role: "user",
          parts: [{ type: "text", text: "Different content" }],
        }),
      },
      env,
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "client_message_id_reused" },
    });
  });

  it("404s when appending to another user's thread", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    insertUser(db, OTHER_USER_ID);
    const { app, env } = testApp(db, USER_ID);
    const other = testApp(db, OTHER_USER_ID);
    const threadId = await createThread(app, env);

    const response = await other.app.request(
      `/workplace/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          clientMessageId: "m1",
          role: "user",
          parts: [{ type: "text", text: "Hi" }],
        }),
      },
      other.env,
    );
    expect(response.status).toBe(404);
  });

  it("404s when a citation references a video the caller does not own", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    insertUser(db, OTHER_USER_ID);
    insertVideo(db, { id: OTHER_VIDEO_ID, ownerId: OTHER_USER_ID });
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);

    const response = await app.request(
      `/workplace/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          clientMessageId: "m1",
          role: "assistant",
          parts: [
            { type: "citation", citation: citation(OTHER_VIDEO_ID) },
          ],
        }),
      },
      env,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "workplace_video_not_found" },
    });
  });

  it("rejects a secret-shaped extra field via 422", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);

    const response = await app.request(
      `/workplace/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          clientMessageId: "m1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          apiKey: "sk-live-should-never-persist",
        }),
      },
      env,
    );
    expect(response.status).toBe(422);
  });

  it("rejects an oversized message payload", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);

    const response = await app.request(
      `/workplace/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          clientMessageId: "m1",
          role: "user",
          parts: [{ type: "text", text: "x".repeat(10_000) }],
        }),
      },
      env,
    );
    expect(response.status).toBe(422);
  });

  it("paginates messages with a cursor and reports hasMore via nextCursor", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);

    for (let i = 0; i < 5; i += 1) {
      await app.request(
        `/workplace/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId,
            clientMessageId: `m${i}`,
            role: "user",
            parts: [{ type: "text", text: `Message ${i}` }],
          }),
        },
        env,
      );
    }

    const firstPage = await app.request(
      `/workplace/threads/${threadId}/messages?limit=2`,
      {},
      env,
    );
    const firstBody = WorkplaceMessagesResponseSchema.parse(
      await firstPage.json(),
    );
    expect(firstBody.messages.map((m) => m.clientMessageId)).toEqual([
      "m3",
      "m4",
    ]);
    expect(firstBody.nextCursor).not.toBeNull();

    const secondPage = await app.request(
      `/workplace/threads/${threadId}/messages?limit=2&cursor=${firstBody.nextCursor}`,
      {},
      env,
    );
    const secondBody = WorkplaceMessagesResponseSchema.parse(
      await secondPage.json(),
    );
    expect(secondBody.messages.map((m) => m.clientMessageId)).toEqual([
      "m1",
      "m2",
    ]);
    expect(secondBody.nextCursor).not.toBeNull();

    const thirdPage = await app.request(
      `/workplace/threads/${threadId}/messages?limit=2&cursor=${secondBody.nextCursor}`,
      {},
      env,
    );
    const thirdBody = WorkplaceMessagesResponseSchema.parse(
      await thirdPage.json(),
    );
    expect(thirdBody.messages.map((m) => m.clientMessageId)).toEqual(["m0"]);
    expect(thirdBody.nextCursor).toBeNull();
  });

  it("rejects an invalid cursor with 422", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);

    const response = await app.request(
      `/workplace/threads/${threadId}/messages?cursor=not-a-number`,
      {},
      env,
    );
    expect(response.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Practice-set import
// ---------------------------------------------------------------------------

describe("POST /workplace/practice-imports", () => {
  it("persists a practice set with workplace origin metadata and appends a message", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    insertVideo(db, { id: VIDEO_ID, ownerId: USER_ID });
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);

    const response = await app.request(
      "/workplace/practice-imports",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": "33333333-3333-4333-8333-333333333333",
        },
        body: JSON.stringify({ threadId, practiceSet: practiceSet() }),
      },
      env,
    );
    expect(response.status).toBe(201);
    const body = WorkplacePracticeSetImportResponseSchema.parse(
      await response.json(),
    );
    expect(body.affectsMastery).toBe(false);

    const bank = await (
      db
        .prepare("SELECT * FROM quiz_banks WHERE id = ?")
        .bind(body.quizId) as any
    ).first();
    expect(bank).toMatchObject({
      origin: "workplace",
      workplace_thread_id: threadId,
      affects_mastery: 0,
    });
    expect(bank.assessment_rationale).toBe(
      "Five questions grounded in your two most recent uploads.",
    );

    const questionCount = await (
      db
        .prepare("SELECT COUNT(*) AS c FROM questions WHERE quiz_id = ?")
        .bind(body.quizId) as any
    ).first();
    expect(questionCount.c).toBe(5);

    const messageRow = await (
      db
        .prepare("SELECT id FROM workplace_messages WHERE id = ?")
        .bind(body.messageId) as any
    ).first();
    expect(messageRow).not.toBeNull();
  });

  it("marks a single-video diagnostic practice set as affecting mastery", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    insertVideo(db, { id: VIDEO_ID, ownerId: USER_ID });
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);

    const response = await app.request(
      "/workplace/practice-imports",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": "44444444-4444-4444-8444-444444444444",
        },
        body: JSON.stringify({
          threadId,
          practiceSet: practiceSet({
            requestedPolicy: "diagnostic",
            effectivePolicy: "diagnostic",
          }),
        }),
      },
      env,
    );
    expect(response.status).toBe(201);
    const body = WorkplacePracticeSetImportResponseSchema.parse(
      await response.json(),
    );
    expect(body.affectsMastery).toBe(true);
  });

  it("is idempotent under a retried import with the same Idempotency-Key", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    insertVideo(db, { id: VIDEO_ID, ownerId: USER_ID });
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);
    const idempotencyKey = "55555555-5555-4555-8555-555555555555";

    const requestOptions = {
      method: "POST" as const,
      headers: {
        "Content-Type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ threadId, practiceSet: practiceSet() }),
    };
    const first = await app.request(
      "/workplace/practice-imports",
      requestOptions,
      env,
    );
    const second = await app.request(
      "/workplace/practice-imports",
      requestOptions,
      env,
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const firstBody = WorkplacePracticeSetImportResponseSchema.parse(
      await first.json(),
    );
    const secondBody = WorkplacePracticeSetImportResponseSchema.parse(
      await second.json(),
    );
    expect(secondBody.quizId).toBe(firstBody.quizId);
    expect(secondBody.messageId).toBe(firstBody.messageId);

    const bankCount = await (
      db.prepare("SELECT COUNT(*) AS c FROM quiz_banks").bind() as any
    ).first();
    expect(bankCount.c).toBe(1);
  });

  it("404s importing into another user's thread", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    insertUser(db, OTHER_USER_ID);
    insertVideo(db, { id: VIDEO_ID, ownerId: USER_ID });
    const { app, env } = testApp(db, USER_ID);
    const other = testApp(db, OTHER_USER_ID);
    const threadId = await createThread(app, env);

    const response = await other.app.request(
      "/workplace/practice-imports",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": "66666666-6666-4666-8666-666666666666",
        },
        body: JSON.stringify({ threadId, practiceSet: practiceSet() }),
      },
      other.env,
    );
    expect(response.status).toBe(404);
  });

  it("404s importing a practice set that references another user's video", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    insertUser(db, OTHER_USER_ID);
    insertVideo(db, { id: OTHER_VIDEO_ID, ownerId: OTHER_USER_ID });
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);

    const response = await app.request(
      "/workplace/practice-imports",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": "77777777-7777-4777-8777-777777777777",
        },
        body: JSON.stringify({
          threadId,
          practiceSet: practiceSet({
            videoIds: [OTHER_VIDEO_ID],
            citations: [citation(OTHER_VIDEO_ID)],
          }),
        }),
      },
      env,
    );
    expect(response.status).toBe(404);
  });

  it("requires a valid Idempotency-Key header", async () => {
    const db = makeTestDb();
    insertUser(db, USER_ID);
    insertVideo(db, { id: VIDEO_ID, ownerId: USER_ID });
    const { app, env } = testApp(db, USER_ID);
    const threadId = await createThread(app, env);

    const response = await app.request(
      "/workplace/practice-imports",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, practiceSet: practiceSet() }),
      },
      env,
    );
    expect(response.status).toBe(400);
  });
});
