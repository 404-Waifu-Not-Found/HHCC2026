import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { AdminRole } from "@clipquest/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { errorResponse } from "../src/lib/errors";
import type { ApiBindings } from "../src/middleware/authenticated";
import { adminRouter } from "../src/routes/admin";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const VIDEO_ID = "22222222-2222-4222-8222-222222222222";
const NOW = Date.now();

type BatchResult = { success: true; meta: { changes: number } };

class SqliteD1Statement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.sqlite, this.sql, params);
  }

  async first<T>(): Promise<T | null> {
    return (
      (this.sqlite
        .prepare(this.sql)
        .get(...(this.params as Parameters<StatementSync["get"]>)) as
        T | undefined) ?? null
    );
  }

  async all<T>(): Promise<{ results: T[]; success: true }> {
    return {
      results: this.sqlite
        .prepare(this.sql)
        .all(...(this.params as Parameters<StatementSync["all"]>)) as T[],
      success: true,
    };
  }

  async run(): Promise<BatchResult> {
    const result = this.sqlite
      .prepare(this.sql)
      .run(...(this.params as Parameters<StatementSync["run"]>));
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1Adapter {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.sqlite, sql);
  }
}

function progressiveSummary(
  state: "generating" | "retrying" | "retry_required" | "ready",
  acceptedCount: number,
  lastProgressAt: number,
) {
  return {
    source: "extension-local-json-stream",
    importVersion: "extension-progressive-import-v3",
    pipelineVersion: 9,
    model: "deepseek-v4-flash",
    reasoningEffort: "high",
    promptVersion: "quiz-local-json-stream-v5.1",
    validatorVersion: "validator-local-progressive-v4.0",
    generationState: state,
    ...(state === "retry_required"
      ? { reasonCode: "automatic_retries_exhausted" }
      : {}),
    requestedQuestionTypes: ["multiple_choice"],
    generatedQuestionTypes: Array.from(
      { length: acceptedCount },
      () => "multiple_choice",
    ),
    plannedCount: 5,
    acceptedCount,
    lastProgressAt,
    acceptedQuestionSummaries: Array.from(
      { length: acceptedCount },
      (_, index) => ({
        id: `q${index + 1}`,
        type: "multiple_choice",
        concept: `Concept ${index + 1}`,
        question: `Question ${index + 1}?`,
      }),
    ),
    transcriptStored: false,
    aiCalls: 2,
    retryCount: state === "generating" || state === "ready" ? 0 : 1,
    inputTokens: 120,
    outputTokens: 80,
    reasoningTokens: 30,
    elapsedMs: 2_500,
  };
}

function createDatabase(): SqliteD1Adapter {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source TEXT NOT NULL
    );
    CREATE TABLE quiz_banks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      pipeline_version INTEGER NOT NULL,
      quality_status TEXT NOT NULL,
      quality_summary_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE questions (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL
    );
    CREATE TABLE attempts (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      status TEXT NOT NULL,
      completed_at INTEGER
    );
    CREATE TABLE d1_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  sqlite
    .prepare("INSERT INTO user VALUES (?, 'Morgan Operator', ?, ?)")
    .run(OWNER_ID, "morgan@example.com", NOW - 86_400_000);
  sqlite
    .prepare(
      "INSERT INTO videos VALUES (?, 'Calculus quotient rule', 'youtube')",
    )
    .run(VIDEO_ID);
  sqlite
    .prepare(
      "INSERT INTO d1_migrations VALUES (15, '0015_security_resource_guards.sql', '2026-08-09')",
    )
    .run();
  sqlite
    .prepare(
      "INSERT INTO d1_migrations VALUES (16, '0016_progressive_quiz_streaming.sql', '2026-08-10')",
    )
    .run();

  insertGeneration(sqlite, {
    id: "33333333-3333-4333-8333-333333333331",
    state: "generating",
    acceptedCount: 1,
    lastProgressAt: NOW - 10_000,
  });
  insertGeneration(sqlite, {
    id: "33333333-3333-4333-8333-333333333332",
    state: "retry_required",
    acceptedCount: 2,
    lastProgressAt: NOW - 20_000,
  });
  insertGeneration(sqlite, {
    id: "33333333-3333-4333-8333-333333333333",
    state: "retrying",
    acceptedCount: 1,
    lastProgressAt: NOW - 31 * 60_000,
  });
  insertGeneration(sqlite, {
    id: "33333333-3333-4333-8333-333333333334",
    state: "ready",
    acceptedCount: 5,
    lastProgressAt: NOW - 5_000,
  });
  return new SqliteD1Adapter(sqlite);
}

function insertGeneration(
  sqlite: DatabaseSync,
  input: {
    id: string;
    state: "generating" | "retrying" | "retry_required" | "ready";
    acceptedCount: number;
    lastProgressAt: number;
  },
): void {
  sqlite
    .prepare("INSERT INTO quiz_banks VALUES (?, ?, ?, 9, ?, ?, ?)")
    .run(
      input.id,
      OWNER_ID,
      VIDEO_ID,
      input.state === "ready" ? "passed" : "generating",
      JSON.stringify(
        progressiveSummary(
          input.state,
          input.acceptedCount,
          input.lastProgressAt,
        ),
      ),
      input.lastProgressAt - 5_000,
    );
  const insertQuestion = sqlite.prepare("INSERT INTO questions VALUES (?, ?)");
  for (let index = 0; index < input.acceptedCount; index += 1) {
    insertQuestion.run(`${input.id}-question-${index}`, input.id);
  }
}

function testApp(role: AdminRole, db: SqliteD1Adapter) {
  const app = new Hono<ApiBindings>();
  app.use("*", async (context, next) => {
    context.set("user", {
      id: OWNER_ID,
      email: "morgan@example.com",
      name: "Morgan Operator",
      username: null,
      role,
      banned: false,
    });
    await next();
  });
  app.route("/", adminRouter);
  app.onError((error, context) => errorResponse(error, context));
  const env = {
    DB: db,
    BETTER_AUTH_SECRET: "configured",
    RESEND_API_KEY: "configured",
    YOUTUBE_CREDENTIALS_ENCRYPTION_KEY: "",
    ENABLE_YOUTUBE_DEMO_HISTORY: "false",
    WORKER_VERSION: {
      id: "873e0843-ab3b-4a2a-9d0d-4581dcceb810",
      tag: "test-sha",
      timestamp: "2026-08-10T05:00:00.000Z",
    },
  } as unknown as ApiBindings["Bindings"];
  return { app, env };
}

describe("admin progressive generation visibility", () => {
  it.each(["admin", "owner"] as const)(
    "lets %s read safe paginated stream summaries",
    async (role) => {
      const { app, env } = testApp(role, createDatabase());
      const response = await app.request(
        "/generations?state=retry_required&page=1&pageSize=20",
        {},
        env,
      );
      const body = (await response.json()) as {
        generations: Array<Record<string, unknown>>;
        pagination: { total: number };
      };
      expect(response.status).toBe(200);
      expect(body.pagination.total).toBe(2);
      expect(body.generations).toHaveLength(2);
      expect(body.generations.map((item) => item.state)).toEqual([
        "retry_required",
        "retry_required",
      ]);
      expect(body.generations.some((item) => item.stalled === true)).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(
        /transcript|prompt|answer|rubric|api.?key|errorMessage/i,
      );
    },
  );

  it("denies learners and keeps the legacy jobs endpoint valid and empty", async () => {
    const db = createDatabase();
    const learner = testApp("user", db);
    const denied = await learner.app.request("/generations", {}, learner.env);
    expect(denied.status).toBe(403);

    const admin = testApp("admin", db);
    const legacy = await admin.app.request(
      "/jobs?page=2&pageSize=10",
      {},
      admin.env,
    );
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toEqual({
      jobs: [],
      pagination: { page: 2, pageSize: 10, total: 0 },
    });
  });

  it("reports real stream counts, migration ledger, and Worker metadata", async () => {
    const { app, env } = testApp("owner", createDatabase());
    const response = await app.request("/system", {}, env);
    const body = (await response.json()) as Record<string, any>;
    expect(response.status).toBe(200);
    expect(body.configuration.generation).toBe(true);
    expect(body.generation).toMatchObject({
      mode: "extension_local",
      backendEnabled: false,
      extensionEnabled: true,
      extensionRequired: true,
      states: { generating: 1, retrying: 0, retryRequired: 2, ready: 1 },
    });
    expect(body.database.migration).toBe("0016_progressive_quiz_streaming.sql");
    expect(body.worker).toEqual({
      versionId: "873e0843-ab3b-4a2a-9d0d-4581dcceb810",
      versionTag: "test-sha",
    });
  });

  it("derives overview compatibility counts and safe recent failures", async () => {
    const { app, env } = testApp("admin", createDatabase());
    const response = await app.request("/overview", {}, env);
    const body = (await response.json()) as Record<string, any>;
    expect(response.status).toBe(200);
    expect(body.totals).toMatchObject({ activeJobs: 1, failedJobs: 2 });
    expect(body.recentFailures).toHaveLength(2);
    expect(body.recentFailures[0].errorMessage).toBeNull();
    expect(JSON.stringify(body.recentFailures)).not.toMatch(
      /caption|transcript|prompt|answer|rubric|api.?key/i,
    );
  });
});
