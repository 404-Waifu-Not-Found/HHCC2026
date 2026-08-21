import { DatabaseSync, type StatementSync } from "node:sqlite";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { errorResponse } from "../src/lib/errors";
import type { ApiBindings } from "../src/middleware/authenticated";
import { quizImportsRouter } from "../src/routes/quiz-imports";
import { quizzesRouter } from "../src/routes/quizzes";

const USER_ID = "owner-user";
const OTHER_USER_ID = "other-user";
const VIDEO_ID = "11111111-1111-4111-8111-111111111111";
const QUIZ_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
const QUESTION_ID = "44444444-4444-4444-8444-444444444444";
const GENERATION_ID = "55555555-5555-4555-8555-555555555555";
const SESSION_ID = "66666666-6666-4666-8666-666666666666";
const SECOND_SESSION_ID = "77777777-7777-4777-8777-777777777777";
const IMPORT_KEY = "88888888-8888-4888-8888-888888888888";
const CLAIM_KEY = "99999999-9999-4999-8999-999999999999";
const SECOND_CLAIM_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type BatchResult = { success: true; meta: { changes: number } };

class SqliteD1Statement {
  constructor(
    private readonly adapter: SqliteD1Adapter,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new SqliteD1Statement(this.adapter, this.sql, params);
  }

  async first<T>(): Promise<T | null> {
    return (
      (this.adapter.sqlite
        .prepare(this.sql)
        .get(...(this.params as Parameters<StatementSync["get"]>)) as
        T | undefined) ?? null
    );
  }

  async all<T>(): Promise<{ results: T[]; success: true }> {
    return {
      results: this.adapter.sqlite
        .prepare(this.sql)
        .all(...(this.params as Parameters<StatementSync["all"]>)) as T[],
      success: true,
    };
  }

  async run(): Promise<BatchResult> {
    return this.runSync();
  }

  runSync(): BatchResult {
    const result = this.adapter.sqlite
      .prepare(this.sql)
      .run(...(this.params as Parameters<StatementSync["run"]>));
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1Adapter {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(sql: string) {
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

function summary(
  state: "generating" | "retrying" | "retry_required" = "generating",
  timestamp = Date.now(),
) {
  return {
    source: "extension-local-json-stream",
    importVersion: "extension-progressive-import-v4",
    resultProtocolVersion: 6,
    pipelineVersion: 9,
    model: "deepseek-v4-flash",
    reasoningEffort: "none",
    promptVersion: "quiz-local-json-stream-v5.2",
    validatorVersion: "validator-local-progressive-v4.1",
    generationProfile: "stable_non_thinking_v5_2",
    generationId: GENERATION_ID,
    questionPlanSeed: "a".repeat(64),
    generationState: state,
    ...(state === "retry_required" ? { reasonCode: "schema_invalid" } : {}),
    requestedQuestionTypes: ["multiple_choice"],
    plannedQuestionTypes: Array(5).fill("multiple_choice"),
    generatedQuestionTypes: ["multiple_choice"],
    plannedCount: 5,
    acceptedCount: 1,
    lastProgressAt: timestamp,
    lastQuestionAt: timestamp,
    stateChangedAt: timestamp,
    telemetryAvailable: true,
    acceptedQuestionSummaries: [
      {
        id: "q1",
        type: "multiple_choice",
        concept: "Supported concept",
        question: "Which result is supported?",
      },
    ],
    transcriptStored: false,
    aiCalls: 0,
    retryCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    elapsedMs: 1,
  };
}

function createDatabase(
  state: "generating" | "retrying" | "retry_required" = "generating",
  timestamp = Date.now(),
) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE api_rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE quiz_banks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      language TEXT NOT NULL,
      session_length TEXT NOT NULL,
      primer TEXT NOT NULL,
      concepts_json TEXT NOT NULL,
      watched INTEGER NOT NULL,
      pipeline_version INTEGER NOT NULL,
      quality_status TEXT NOT NULL,
      quality_summary_json TEXT NOT NULL,
      import_key TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE questions (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE
    );
    CREATE TABLE attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      quiz_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      current_index INTEGER NOT NULL,
      current_variant INTEGER NOT NULL,
      retry_pending INTEGER NOT NULL,
      target_difficulty REAL NOT NULL,
      correct_count INTEGER NOT NULL,
      total_answered INTEGER NOT NULL,
      item_count INTEGER NOT NULL,
      score REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE mastery (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY(user_id, video_id)
    );
    CREATE TABLE quiz_generation_call_events (
      quiz_id TEXT NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
      generation_session_id TEXT NOT NULL,
      call_index INTEGER NOT NULL,
      start_ordinal INTEGER NOT NULL,
      requested_count INTEGER NOT NULL,
      accepted_count INTEGER NOT NULL,
      classification TEXT NOT NULL,
      outcome_code TEXT NOT NULL,
      retry_delay_ms INTEGER NOT NULL,
      elapsed_ms INTEGER NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      reasoning_tokens INTEGER,
      usage_complete INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (quiz_id, generation_session_id, call_index)
    );
    CREATE TABLE quiz_generation_claims (
      quiz_id TEXT PRIMARY KEY REFERENCES quiz_banks(id) ON DELETE CASCADE,
      generation_session_id TEXT NOT NULL,
      claim_key TEXT NOT NULL UNIQUE,
      lease_expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  sqlite
    .prepare(
      "INSERT INTO quiz_banks VALUES (?, ?, ?, 'en', 'short', 'Primer', '[]', 1, 9, 'generating', ?, ?, ?)",
    )
    .run(
      QUIZ_ID,
      USER_ID,
      VIDEO_ID,
      JSON.stringify(summary(state, timestamp)),
      IMPORT_KEY,
      timestamp,
    );
  sqlite
    .prepare("INSERT INTO questions VALUES (?, ?)")
    .run(QUESTION_ID, QUIZ_ID);
  sqlite
    .prepare(
      "INSERT INTO attempts VALUES (?, ?, ?, 'learn', 'active', 0, 0, 0, 2, 0, 0, 5, NULL, ?, ?)",
    )
    .run(ATTEMPT_ID, USER_ID, QUIZ_ID, timestamp, timestamp);
  return new SqliteD1Adapter(sqlite);
}

function testApp(db: SqliteD1Adapter, userId = USER_ID) {
  const app = new Hono<ApiBindings>();
  app.use("*", async (context, next) => {
    context.set("user", {
      id: userId,
      email: `${userId}@example.com`,
      name: "Generation owner",
      username: null,
      role: "user",
      banned: false,
    });
    await next();
  });
  app.route("/imports", quizImportsRouter);
  app.route("/", quizzesRouter);
  app.onError((error, context) => errorResponse(error, context));
  return {
    app,
    env: { DB: db } as unknown as ApiBindings["Bindings"],
  };
}

function callEvent(
  overrides: Partial<{
    generationSessionId: string;
    callIndex: number;
    startIndex: number;
    requestedCount: number;
    acceptedCount: number;
    classification: "primary" | "automatic_retry" | "manual_continuation";
    outcome:
      "complete" | "transient_http" | "network_interrupted" | "schema_invalid";
    retryDelayMs: number;
  }> = {},
) {
  return {
    generationSessionId: SESSION_ID,
    callIndex: 0,
    startIndex: 0,
    requestedCount: 1,
    acceptedCount: 1,
    classification: "primary" as const,
    outcome: "complete" as const,
    retryDelayMs: 0,
    elapsedMs: 2_000,
    inputTokens: 100,
    outputTokens: 20,
    reasoningTokens: 0,
    usageComplete: true,
    ...overrides,
  };
}

function putCall(
  app: Hono<ApiBindings>,
  env: ApiBindings["Bindings"],
  event: ReturnType<typeof callEvent>,
  importKey = IMPORT_KEY,
) {
  return app.request(
    `/imports/${QUIZ_ID}/calls/${event.generationSessionId}/${event.callIndex}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": importKey,
      },
      body: JSON.stringify(event),
    },
    env,
  );
}

describe("authoritative progressive call events", () => {
  it("records exact events idempotently and rejects conflicting replays", async () => {
    const db = createDatabase();
    const { app, env } = testApp(db);
    const event = callEvent();
    expect((await putCall(app, env, event)).status).toBe(201);
    expect((await putCall(app, env, event)).status).toBe(200);
    const conflict = await putCall(app, env, {
      ...event,
      elapsedMs: event.elapsedMs + 1,
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: { code: "generation_call_conflict" },
    });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS count FROM quiz_generation_call_events")
        .get(),
    ).toMatchObject({ count: 1 });
  });

  it("allows one retry only after a confirmed transient event", async () => {
    const db = createDatabase();
    const { app, env } = testApp(db);
    expect((await putCall(app, env, callEvent())).status).toBe(201);
    const transient = callEvent({
      callIndex: 1,
      startIndex: 1,
      requestedCount: 3,
      acceptedCount: 0,
      outcome: "transient_http",
      retryDelayMs: 750,
    });
    expect((await putCall(app, env, transient)).status).toBe(201);
    const retry = callEvent({
      callIndex: 2,
      startIndex: 1,
      requestedCount: 1,
      acceptedCount: 0,
      classification: "automatic_retry",
      outcome: "network_interrupted",
    });
    expect((await putCall(app, env, retry)).status).toBe(201);
    const secondRetry = callEvent({
      callIndex: 3,
      startIndex: 1,
      requestedCount: 1,
      acceptedCount: 0,
      classification: "automatic_retry",
      outcome: "network_interrupted",
    });
    const rejected = await putCall(app, env, secondRetry);
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({
      error: { code: "automatic_retry_budget_exceeded" },
    });
  });

  it("does not let content failures become automatic retries", async () => {
    const db = createDatabase();
    const { app, env } = testApp(db);
    expect((await putCall(app, env, callEvent())).status).toBe(201);
    expect(
      (
        await putCall(
          app,
          env,
          callEvent({
            callIndex: 1,
            startIndex: 1,
            requestedCount: 2,
            acceptedCount: 0,
            outcome: "schema_invalid",
          }),
        )
      ).status,
    ).toBe(201);
    const retry = await putCall(
      app,
      env,
      callEvent({
        callIndex: 2,
        startIndex: 1,
        requestedCount: 1,
        acceptedCount: 0,
        classification: "automatic_retry",
        outcome: "network_interrupted",
      }),
    );
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({
      error: { code: "generation_call_retry_conflict" },
    });
  });

  it("progress state changes preserve question time and release a claim lease", async () => {
    const timestamp = Date.now() - 10_000;
    const db = createDatabase("retrying", timestamp);
    db.sqlite
      .prepare("INSERT INTO quiz_generation_claims VALUES (?, ?, ?, ?, ?)")
      .run(QUIZ_ID, SESSION_ID, IMPORT_KEY, Date.now() + 900_000, timestamp);
    const { app, env } = testApp(db);
    const response = await app.request(
      `/imports/${QUIZ_ID}/progress`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": IMPORT_KEY,
        },
        body: JSON.stringify({
          state: "retry_required",
          reasonCode: "schema_invalid",
        }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const row = db.sqlite
      .prepare(
        "SELECT quality_summary_json, lease_expires_at FROM quiz_banks JOIN quiz_generation_claims ON quiz_generation_claims.quiz_id = quiz_banks.id WHERE quiz_banks.id = ?",
      )
      .get(QUIZ_ID) as {
      quality_summary_json: string;
      lease_expires_at: number;
    };
    const stored = JSON.parse(row.quality_summary_json);
    expect(stored.lastQuestionAt).toBe(timestamp);
    expect(stored.generationState).toBe("retry_required");
    expect(stored.stateChangedAt).toBeGreaterThan(timestamp);
    expect(row.lease_expires_at).toBeLessThanOrEqual(Date.now());
  });
});

describe("explicit continuation claims", () => {
  it("rotates the import key, leases one tab, replays, and allows expiry", async () => {
    const db = createDatabase("retry_required");
    const { app, env } = testApp(db);
    const claim = (claimKey: string, generationSessionId: string) =>
      app.request(
        `/attempts/${ATTEMPT_ID}/generation/claim`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claimKey, generationSessionId }),
        },
        env,
      );

    expect((await claim(CLAIM_KEY, SESSION_ID)).status).toBe(200);
    expect((await claim(CLAIM_KEY, SESSION_ID)).status).toBe(200);
    const leased = await claim(SECOND_CLAIM_KEY, SECOND_SESSION_ID);
    expect(leased.status).toBe(409);
    expect(await leased.json()).toMatchObject({
      error: { code: "generation_claim_leased" },
    });
    expect(
      db.sqlite
        .prepare("SELECT import_key FROM quiz_banks WHERE id = ?")
        .get(QUIZ_ID),
    ).toMatchObject({ import_key: CLAIM_KEY });

    db.sqlite
      .prepare(
        "UPDATE quiz_generation_claims SET lease_expires_at = ? WHERE quiz_id = ?",
      )
      .run(Date.now() - 1, QUIZ_ID);
    expect((await claim(SECOND_CLAIM_KEY, SECOND_SESSION_ID)).status).toBe(200);
    expect(
      db.sqlite
        .prepare("SELECT import_key FROM quiz_banks WHERE id = ?")
        .get(QUIZ_ID),
    ).toMatchObject({ import_key: SECOND_CLAIM_KEY });
  });

  it("allows an explicit reclaim of a derived stalled state", async () => {
    const staleTimestamp = Date.now() - 31 * 60_000;
    const db = createDatabase("generating", staleTimestamp);
    const { app, env } = testApp(db);
    const response = await app.request(
      `/attempts/${ATTEMPT_ID}/generation/claim`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimKey: CLAIM_KEY,
          generationSessionId: SESSION_ID,
        }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const stored = db.sqlite
      .prepare("SELECT quality_summary_json FROM quiz_banks WHERE id = ?")
      .get(QUIZ_ID) as { quality_summary_json: string };
    expect(JSON.parse(stored.quality_summary_json)).toMatchObject({
      generationState: "retry_required",
      reasonCode: "generation_stalled",
    });
  });

  it("never lets another owner claim an attempt", async () => {
    const db = createDatabase("retry_required");
    const { app, env } = testApp(db, OTHER_USER_ID);
    const response = await app.request(
      `/attempts/${ATTEMPT_ID}/generation/claim`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimKey: CLAIM_KEY,
          generationSessionId: SESSION_ID,
        }),
      },
      env,
    );
    expect(response.status).toBe(404);
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS count FROM quiz_generation_claims")
        .get(),
    ).toMatchObject({ count: 0 });
  });
});
