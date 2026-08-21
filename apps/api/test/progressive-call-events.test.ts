import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { LocalGenerationCallOutcome } from "@clipquest/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { errorResponse } from "../src/lib/errors";
import {
  automaticRetryKindForOutcome,
  readProgressiveGenerationSnapshot,
  retryKindMatchesGenerationOutcome,
} from "../src/lib/progressive-quiz";
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
const RECOVERY_SESSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECOND_RECOVERY_SESSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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

function automaticSummary(
  state:
    | "generating"
    | "retrying"
    | "recovering"
    | "action_required"
    | "generation_failed" = "generating",
  timestamp = Date.now(),
) {
  return {
    ...summary("generating", timestamp),
    importVersion: "extension-progressive-import-v5",
    resultProtocolVersion: 7,
    promptVersion: "quiz-local-json-stream-v5.3",
    validatorVersion: "validator-local-progressive-v4.2",
    generationProfile: "stable_auto_recovery_v5_3",
    generationSessionId: SESSION_ID,
    recoverySessionId: RECOVERY_SESSION_ID,
    generationState: state,
    ...(state === "action_required"
      ? { reasonCode: "credential_required" }
      : state === "generation_failed"
        ? { reasonCode: "recovery_budget_exhausted" }
        : {}),
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
      protocol_version INTEGER,
      retry_kind TEXT,
      ordinal_attempt INTEGER,
      recovery_session_id TEXT,
      purpose TEXT,
      lifecycle_state TEXT NOT NULL DEFAULT 'completed',
      dispatched_at INTEGER,
      completed_at INTEGER,
      last_stream_activity_at INTEGER,
      PRIMARY KEY (quiz_id, generation_session_id, call_index)
    );
    CREATE TABLE quiz_generation_claims (
      quiz_id TEXT PRIMARY KEY REFERENCES quiz_banks(id) ON DELETE CASCADE,
      generation_session_id TEXT NOT NULL,
      claim_key TEXT NOT NULL UNIQUE,
      lease_expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      recovery_session_id TEXT,
      heartbeat_at INTEGER
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

function createAutomaticDatabase(
  state:
    | "generating"
    | "retrying"
    | "recovering"
    | "action_required"
    | "generation_failed" = "generating",
  timestamp = Date.now(),
) {
  const db = createDatabase("generating", timestamp);
  db.sqlite
    .prepare("UPDATE quiz_banks SET quality_summary_json = ? WHERE id = ?")
    .run(JSON.stringify(automaticSummary(state, timestamp)), QUIZ_ID);
  db.sqlite
    .prepare(
      `INSERT INTO quiz_generation_claims
       (quiz_id, generation_session_id, claim_key, lease_expires_at, updated_at, recovery_session_id, heartbeat_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      QUIZ_ID,
      SESSION_ID,
      IMPORT_KEY,
      timestamp + 30_000,
      timestamp,
      RECOVERY_SESSION_ID,
      timestamp,
    );
  return db;
}

function createGroundedDatabase(timestamp = Date.now()) {
  const db = createAutomaticDatabase("generating", timestamp);
  const grounded = {
    ...automaticSummary("generating", timestamp),
    importVersion: "extension-progressive-import-v6",
    resultProtocolVersion: 8,
    promptVersion: "quiz-local-json-stream-v5.5",
    validatorVersion: "validator-local-progressive-v4.4",
    generationProfile: "evidence_grounded_auto_v5_4",
  };
  db.sqlite
    .prepare("UPDATE quiz_banks SET quality_summary_json = ? WHERE id = ?")
    .run(JSON.stringify(grounded), QUIZ_ID);
  return db;
}

function createConceptFirstDatabase(timestamp = Date.now()) {
  const db = createAutomaticDatabase("generating", timestamp);
  const conceptFirst = {
    ...automaticSummary("generating", timestamp),
    importVersion: "extension-progressive-import-v7",
    resultProtocolVersion: 9,
    promptVersion: "quiz-local-json-stream-v5.8",
    validatorVersion: "validator-local-progressive-v4.12",
    generationProfile: "concept_first_auto_v5_8",
    promptFingerprint: "e".repeat(64),
    sourceSelection: {
      sentenceCount: 10,
      excludedSentenceCount: 1,
      candidateWindowCount: 6,
      selectedWindowCount: 5,
      focusWordCount: 120,
    },
  };
  db.sqlite
    .prepare("UPDATE quiz_banks SET quality_summary_json = ? WHERE id = ?")
    .run(JSON.stringify(conceptFirst), QUIZ_ID);
  return db;
}

function createPromptFirstDatabase(timestamp = Date.now()) {
  const db = createAutomaticDatabase("generating", timestamp);
  const promptFirst = {
    ...automaticSummary("generating", timestamp),
    importVersion: "extension-progressive-import-v8",
    resultProtocolVersion: 10,
    promptVersion: "quiz-local-json-stream-v5.9",
    validatorVersion: "validator-minimal-structural-v5.0",
    generationProfile: "prompt_first_auto_v5_9",
    promptFingerprint: "f".repeat(64),
    sourceSelection: {
      sentenceCount: 10,
      excludedSentenceCount: 1,
      candidateWindowCount: 6,
      selectedWindowCount: 5,
      focusWordCount: 120,
    },
  };
  db.sqlite
    .prepare("UPDATE quiz_banks SET quality_summary_json = ? WHERE id = ?")
    .run(JSON.stringify(promptFirst), QUIZ_ID);
  return db;
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

function automaticCallEvent(
  overrides: Partial<{
    callIndex: number;
    startIndex: number;
    ordinalAttempt: number;
    acceptedCount: 0 | 1;
    classification: "primary" | "automatic_retry";
    retryKind:
      | "transport"
      | "empty_content"
      | "truncated_output"
      | "content_repair"
      | "duplicate_repair"
      | "answer_repair"
      | "automatic_resume";
    outcome: LocalGenerationCallOutcome;
    retryDelayMs: number;
    recoverySessionId: string;
  }> = {},
) {
  return {
    protocolVersion: 7 as const,
    generationSessionId: SESSION_ID,
    recoverySessionId: RECOVERY_SESSION_ID,
    callIndex: 0,
    startIndex: 0,
    ordinalAttempt: 1,
    requestedCount: 1 as const,
    acceptedCount: 1 as 0 | 1,
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

function groundedCallEvent(
  overrides: Parameters<typeof automaticCallEvent>[0] = {},
) {
  return {
    ...automaticCallEvent(overrides),
    protocolVersion: 8 as const,
    purpose: "generation" as const,
  };
}

function conceptFirstLifecycleEvent(
  lifecycleState: "started" | "completed" | "abandoned",
  overrides: Partial<{
    callIndex: number;
    startIndex: number;
    ordinalAttempt: number;
    acceptedCount: 0 | 1;
    classification: "primary" | "automatic_retry";
    retryKind:
      | "transport"
      | "empty_content"
      | "truncated_output"
      | "content_repair"
      | "duplicate_repair"
      | "answer_repair"
      | "automatic_resume";
    outcome: LocalGenerationCallOutcome;
    retryDelayMs: number;
    elapsedMs: number;
  }> = {},
) {
  const terminal = lifecycleState !== "started";
  return {
    protocolVersion: 9 as const,
    purpose: "generation" as const,
    lifecycleState,
    generationSessionId: SESSION_ID,
    recoverySessionId: RECOVERY_SESSION_ID,
    callIndex: 0,
    startIndex: 0,
    ordinalAttempt: 1,
    requestedCount: 1 as const,
    acceptedCount: terminal ? (1 as const) : (0 as const),
    classification: "primary" as const,
    retryDelayMs: 0,
    usageComplete: false,
    ...(terminal ? { outcome: "complete" as const, elapsedMs: 2_000 } : {}),
    ...overrides,
  };
}

function promptFirstLifecycleEvent(
  lifecycleState: "started" | "completed" | "abandoned",
  overrides: Partial<{
    callIndex: number;
    startIndex: number;
    ordinalAttempt: number;
    acceptedCount: 0 | 1;
    classification: "primary" | "automatic_retry";
    retryKind: "transport" | "structural";
    outcome: LocalGenerationCallOutcome;
    retryDelayMs: number;
    elapsedMs: number;
  }> = {},
) {
  const terminal = lifecycleState !== "started";
  return {
    protocolVersion: 10 as const,
    purpose: "generation" as const,
    lifecycleState,
    generationSessionId: SESSION_ID,
    recoverySessionId: RECOVERY_SESSION_ID,
    callIndex: 0,
    startIndex: 0,
    ordinalAttempt: 1,
    requestedCount: 1 as const,
    acceptedCount: terminal ? (1 as const) : (0 as const),
    classification: "primary" as const,
    retryDelayMs: 0,
    usageComplete: false,
    ...(terminal ? { outcome: "complete" as const, elapsedMs: 2_000 } : {}),
    ...overrides,
  };
}

function legacyAutomaticRecoveryCallEvent(
  overrides: Partial<{
    generationSessionId: string;
    callIndex: number;
    startIndex: number;
    ordinalAttempt: number;
    acceptedCount: 0 | 1;
    classification: "primary" | "automatic_retry";
    retryKind:
      | "transport"
      | "empty_content"
      | "truncated_output"
      | "content_repair"
      | "duplicate_repair"
      | "answer_repair"
      | "automatic_resume";
    outcome:
      | "complete"
      | "transient_http"
      | "network_interrupted"
      | "schema_invalid"
      | "empty_content";
    retryDelayMs: number;
  }> = {},
) {
  const event = {
    protocolVersion: 5 as const,
    purpose: "automatic_recovery" as const,
    generationSessionId: SECOND_SESSION_ID,
    recoverySessionId: RECOVERY_SESSION_ID,
    callIndex: 7,
    startIndex: 11,
    ordinalAttempt: 2,
    requestedCount: 1 as const,
    acceptedCount: 1 as 0 | 1,
    classification: "automatic_retry" as const,
    retryKind: "content_repair" as const,
    outcome: "complete" as const,
    retryDelayMs: 0,
    elapsedMs: 2_000,
    inputTokens: 100,
    outputTokens: 20,
    reasoningTokens: 0,
    usageComplete: true,
    ...overrides,
  };
  if (event.classification === "primary" && !("retryKind" in overrides)) {
    delete (event as { retryKind?: string }).retryKind;
  }
  return event;
}

function legacyRun8Summary(
  acceptedCount: number,
  state: "generation_failed" | "recovering" | "generating" | "ready",
  timestamp = Date.now(),
) {
  return {
    source: "extension-local-json-stream",
    importVersion: "extension-progressive-import-v3",
    resultProtocolVersion: 5,
    pipelineVersion: 9,
    model: "deepseek-v4-flash",
    reasoningEffort: "high",
    promptVersion: "quiz-local-json-stream-v5.1",
    validatorVersion: "validator-local-progressive-v4.0",
    generationProfile: "legacy_reasoning_v5_1",
    generationState: state,
    ...(state === "generation_failed" ? { reasonCode: "schema_invalid" } : {}),
    requestedQuestionTypes: ["multiple_choice"],
    plannedQuestionTypes: Array(15).fill("multiple_choice"),
    generatedQuestionTypes: Array(acceptedCount).fill("multiple_choice"),
    plannedCount: 15,
    acceptedCount,
    lastProgressAt: timestamp,
    lastQuestionAt: timestamp,
    stateChangedAt: timestamp,
    telemetryAvailable: true,
    acceptedQuestionSummaries: Array.from(
      { length: acceptedCount },
      (_, index) => ({
        id: `q${index + 1}`,
        type: "multiple_choice",
        concept: `Supported concept ${index + 1}`,
        question: `Which result is supported in case ${index + 1}?`,
      }),
    ),
    transcriptStored: false,
    aiCalls: 7,
    retryCount: 0,
    inputTokens: 700,
    outputTokens: 140,
    reasoningTokens: 0,
    elapsedMs: 14_000,
  };
}

function createLegacyRun8Database(timestamp = Date.now() - 60_000) {
  const db = createDatabase("generating", timestamp);
  for (let ordinal = 2; ordinal <= 11; ordinal += 1) {
    db.sqlite
      .prepare("INSERT INTO questions VALUES (?, ?)")
      .run(
        `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
        QUIZ_ID,
      );
  }
  db.sqlite
    .prepare("UPDATE attempts SET item_count = 15 WHERE id = ?")
    .run(ATTEMPT_ID);
  db.sqlite
    .prepare(
      "UPDATE quiz_banks SET session_length = 'long', quality_summary_json = ? WHERE id = ?",
    )
    .run(
      JSON.stringify(legacyRun8Summary(11, "generation_failed", timestamp)),
      QUIZ_ID,
    );
  db.sqlite
    .prepare(
      `INSERT INTO quiz_generation_call_events
       (quiz_id, generation_session_id, call_index, start_ordinal, requested_count, accepted_count, classification, outcome_code, retry_delay_ms, elapsed_ms, input_tokens, output_tokens, reasoning_tokens, usage_complete, created_at)
       VALUES (?, ?, 6, 11, 2, 0, 'primary', 'schema_invalid', 0, 2000, 100, 20, 0, 1, ?)`,
    )
    .run(QUIZ_ID, SESSION_ID, timestamp + 1_000);
  db.sqlite
    .prepare(
      `INSERT INTO quiz_generation_call_events
       (quiz_id, generation_session_id, call_index, start_ordinal, requested_count, accepted_count, classification, outcome_code, retry_delay_ms, elapsed_ms, input_tokens, output_tokens, reasoning_tokens, usage_complete, created_at)
       VALUES (?, ?, 0, 11, 1, 0, 'manual_continuation', 'schema_invalid', 0, 2000, 100, 20, 0, 1, ?)`,
    )
    .run(QUIZ_ID, SECOND_SESSION_ID, timestamp + 2_000);
  return db;
}

function advanceLegacyRun8Frontier(db: SqliteD1Adapter, acceptedCount: number) {
  db.sqlite
    .prepare("INSERT INTO questions VALUES (?, ?)")
    .run(
      `00000000-0000-4000-8000-${String(acceptedCount).padStart(12, "0")}`,
      QUIZ_ID,
    );
  const stored = db.sqlite
    .prepare("SELECT quality_summary_json FROM quiz_banks WHERE id = ?")
    .get(QUIZ_ID) as { quality_summary_json: string };
  const current = JSON.parse(stored.quality_summary_json) as Record<
    string,
    unknown
  >;
  const next = legacyRun8Summary(
    acceptedCount,
    acceptedCount === 15 ? "ready" : "generating",
  );
  db.sqlite
    .prepare(
      "UPDATE quiz_banks SET quality_status = ?, quality_summary_json = ? WHERE id = ?",
    )
    .run(
      acceptedCount === 15 ? "passed" : "generating",
      JSON.stringify({
        ...current,
        ...next,
        aiCalls: current.aiCalls,
        retryCount: current.retryCount,
        inputTokens: current.inputTokens,
        outputTokens: current.outputTokens,
        reasoningTokens: current.reasoningTokens,
        elapsedMs: current.elapsedMs,
      }),
      QUIZ_ID,
    );
}

function putCall<T extends { generationSessionId: string; callIndex: number }>(
  app: Hono<ApiBindings>,
  env: ApiBindings["Bindings"],
  event: T,
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

describe("protocol-5 automatic compatibility recovery", () => {
  it("recovers the Run 8 q1-q11 prefix and classifies only attempted ordinals as retries", async () => {
    const db = createLegacyRun8Database();
    const { app, env } = testApp(db);

    const status = await app.request(
      `/attempts/${ATTEMPT_ID}/generation`,
      undefined,
      env,
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      quizId: QUIZ_ID,
      generation: {
        state: "generation_failed",
        availableQuestions: 11,
        totalQuestions: 15,
      },
      continuation: {
        startIndex: 11,
        generationSessionId: SECOND_SESSION_ID,
        nextCallIndex: 1,
        automaticRetryCount: 0,
        retryBudgetUsedCount: 1,
        retryOrdinals: [12, 13],
        previousOutcome: "schema_invalid",
        claim: { state: "available" },
      },
    });

    const claim = await app.request(
      `/attempts/${ATTEMPT_ID}/generation/claim`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimKey: CLAIM_KEY,
          generationSessionId: SECOND_SESSION_ID,
          recoverySessionId: RECOVERY_SESSION_ID,
        }),
      },
      env,
    );
    expect(claim.status).toBe(200);

    for (const event of [
      legacyAutomaticRecoveryCallEvent({ callIndex: 1 }),
      legacyAutomaticRecoveryCallEvent({ callIndex: 2, startIndex: 12 }),
      legacyAutomaticRecoveryCallEvent({
        callIndex: 3,
        startIndex: 13,
        ordinalAttempt: 1,
        classification: "primary",
      }),
      legacyAutomaticRecoveryCallEvent({
        callIndex: 4,
        startIndex: 14,
        ordinalAttempt: 1,
        classification: "primary",
      }),
    ]) {
      const response = await putCall(app, env, event, CLAIM_KEY);
      expect(response.status).toBe(201);
      advanceLegacyRun8Frontier(db, event.startIndex + 1);
    }

    expect(
      db.sqlite
        .prepare(
          `SELECT call_index, start_ordinal, requested_count, classification, protocol_version, retry_kind, recovery_session_id
           FROM quiz_generation_call_events
           WHERE generation_session_id = ? AND call_index >= 1
           ORDER BY call_index`,
        )
        .all(SECOND_SESSION_ID),
    ).toEqual([
      {
        call_index: 1,
        start_ordinal: 11,
        requested_count: 1,
        classification: "automatic_retry",
        protocol_version: 5,
        retry_kind: "content_repair",
        recovery_session_id: RECOVERY_SESSION_ID,
      },
      {
        call_index: 2,
        start_ordinal: 12,
        requested_count: 1,
        classification: "automatic_retry",
        protocol_version: 5,
        retry_kind: "content_repair",
        recovery_session_id: RECOVERY_SESSION_ID,
      },
      {
        call_index: 3,
        start_ordinal: 13,
        requested_count: 1,
        classification: "primary",
        protocol_version: 5,
        retry_kind: null,
        recovery_session_id: RECOVERY_SESSION_ID,
      },
      {
        call_index: 4,
        start_ordinal: 14,
        requested_count: 1,
        classification: "primary",
        protocol_version: 5,
        retry_kind: null,
        recovery_session_id: RECOVERY_SESSION_ID,
      },
    ]);
    expect(
      db.sqlite
        .prepare(
          "SELECT quality_status, quality_summary_json FROM quiz_banks WHERE id = ?",
        )
        .get(QUIZ_ID),
    ).toMatchObject({ quality_status: "passed" });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS count FROM questions WHERE quiz_id = ?")
        .get(QUIZ_ID),
    ).toMatchObject({ count: 15 });
  });

  it("replays historical manual rows exactly but rejects every new insertion", async () => {
    const db = createDatabase("retry_required");
    const { app, env } = testApp(db);
    const historical = callEvent({
      generationSessionId: SECOND_SESSION_ID,
      acceptedCount: 0,
      classification: "manual_continuation",
      outcome: "schema_invalid",
    });
    db.sqlite
      .prepare(
        `INSERT INTO quiz_generation_call_events
         (quiz_id, generation_session_id, call_index, start_ordinal, requested_count, accepted_count, classification, outcome_code, retry_delay_ms, elapsed_ms, input_tokens, output_tokens, reasoning_tokens, usage_complete, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        QUIZ_ID,
        historical.generationSessionId,
        historical.callIndex,
        historical.startIndex,
        historical.requestedCount,
        historical.acceptedCount,
        historical.classification,
        historical.outcome,
        historical.retryDelayMs,
        historical.elapsedMs,
        historical.inputTokens,
        historical.outputTokens,
        historical.reasoningTokens,
        historical.usageComplete ? 1 : 0,
        Date.now(),
      );

    expect((await putCall(app, env, historical)).status).toBe(200);
    const fresh = await putCall(app, env, {
      ...historical,
      callIndex: 1,
    });
    expect(fresh.status).toBe(422);
    expect(await fresh.json()).toMatchObject({
      error: { code: "manual_generation_continuation_removed" },
    });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS count FROM quiz_generation_call_events")
        .get(),
    ).toMatchObject({ count: 1 });
  });
});

describe("protocol-7 automatic recovery call events", () => {
  it("accepts exactly two content repairs and rejects manual classifications", async () => {
    const db = createAutomaticDatabase();
    const { app, env } = testApp(db);
    expect((await putCall(app, env, automaticCallEvent())).status).toBe(201);
    expect(
      (
        await putCall(
          app,
          env,
          automaticCallEvent({
            callIndex: 1,
            startIndex: 1,
            acceptedCount: 0,
            outcome: "schema_invalid",
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await putCall(
          app,
          env,
          automaticCallEvent({
            callIndex: 2,
            startIndex: 1,
            ordinalAttempt: 2,
            acceptedCount: 0,
            classification: "automatic_retry",
            retryKind: "content_repair",
            outcome: "schema_invalid",
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await putCall(
          app,
          env,
          automaticCallEvent({
            callIndex: 3,
            startIndex: 1,
            ordinalAttempt: 3,
            acceptedCount: 0,
            classification: "automatic_retry",
            retryKind: "content_repair",
            outcome: "schema_invalid",
          }),
        )
      ).status,
    ).toBe(201);
    const exhausted = await putCall(
      app,
      env,
      automaticCallEvent({
        callIndex: 4,
        startIndex: 1,
        ordinalAttempt: 4,
        acceptedCount: 0,
        classification: "automatic_retry",
        retryKind: "content_repair",
        outcome: "schema_invalid",
      }),
    );
    expect(exhausted.status).toBe(409);
    expect(await exhausted.json()).toMatchObject({
      error: { code: "automatic_retry_ordinal_budget_exceeded" },
    });

    const manual = await putCall(
      app,
      env,
      callEvent({
        generationSessionId: SESSION_ID,
        callIndex: 4,
        startIndex: 1,
        acceptedCount: 0,
        classification: "manual_continuation",
        outcome: "schema_invalid",
      }),
    );
    expect(manual.status).toBe(409);
    expect(await manual.json()).toMatchObject({
      error: { code: "generation_call_protocol_mismatch" },
    });
  });

  it("allows four content retries for concept-first v5.8", async () => {
    const db = createConceptFirstDatabase();
    const { app, env } = testApp(db);
    expect(
      (await putCall(app, env, conceptFirstLifecycleEvent("started"))).status,
    ).toBe(201);
    expect(
      (await putCall(app, env, conceptFirstLifecycleEvent("completed"))).status,
    ).toBe(200);
    expect(
      (
        await putCall(
          app,
          env,
          conceptFirstLifecycleEvent("started", {
            callIndex: 1,
            startIndex: 1,
            acceptedCount: 0,
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await putCall(
          app,
          env,
          conceptFirstLifecycleEvent("completed", {
            callIndex: 1,
            startIndex: 1,
            acceptedCount: 0,
            outcome: "schema_invalid",
          }),
        )
      ).status,
    ).toBe(200);
    for (let retry = 1; retry <= 4; retry += 1) {
      expect(
        (
          await putCall(
            app,
            env,
            conceptFirstLifecycleEvent("started", {
              callIndex: retry + 1,
              startIndex: 1,
              ordinalAttempt: retry + 1,
              acceptedCount: 0,
              classification: "automatic_retry",
              retryKind: "content_repair",
            }),
          )
        ).status,
      ).toBe(201);
      expect(
        (
          await putCall(
            app,
            env,
            conceptFirstLifecycleEvent("completed", {
              callIndex: retry + 1,
              startIndex: 1,
              ordinalAttempt: retry + 1,
              acceptedCount: 0,
              classification: "automatic_retry",
              retryKind: "content_repair",
              outcome: "schema_invalid",
            }),
          )
        ).status,
      ).toBe(200);
    }
    const exhausted = await putCall(
      app,
      env,
      conceptFirstLifecycleEvent("started", {
        callIndex: 6,
        startIndex: 1,
        ordinalAttempt: 5,
        acceptedCount: 0,
        classification: "automatic_retry",
        retryKind: "content_repair",
      }),
    );
    expect(exhausted.status).toBe(409);
    expect(await exhausted.json()).toMatchObject({
      error: { code: "automatic_retry_ordinal_budget_exceeded" },
    });
  });

  it("renews one recovery lease and permits takeover only after expiry", async () => {
    const db = createAutomaticDatabase("recovering");
    const { app, env } = testApp(db);
    const heartbeat = await app.request(
      `/attempts/${ATTEMPT_ID}/generation/heartbeat`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimKey: IMPORT_KEY,
          generationSessionId: SESSION_ID,
          recoverySessionId: RECOVERY_SESSION_ID,
        }),
      },
      env,
    );
    expect(heartbeat.status).toBe(200);
    const renewed = db.sqlite
      .prepare(
        "SELECT lease_expires_at, heartbeat_at FROM quiz_generation_claims WHERE quiz_id = ?",
      )
      .get(QUIZ_ID) as { lease_expires_at: number; heartbeat_at: number };
    expect(renewed.lease_expires_at).toBeGreaterThan(Date.now() + 25_000);
    expect(renewed.heartbeat_at).toBeGreaterThan(0);

    const claim = () =>
      app.request(
        `/attempts/${ATTEMPT_ID}/generation/claim`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claimKey: CLAIM_KEY,
            generationSessionId: SESSION_ID,
            recoverySessionId: SECOND_RECOVERY_SESSION_ID,
          }),
        },
        env,
      );
    expect((await claim()).status).toBe(409);
    db.sqlite
      .prepare(
        "UPDATE quiz_generation_claims SET lease_expires_at = ? WHERE quiz_id = ?",
      )
      .run(Date.now() - 1, QUIZ_ID);
    expect((await claim()).status).toBe(200);
    expect(
      db.sqlite
        .prepare(
          "SELECT claim_key, recovery_session_id FROM quiz_generation_claims WHERE quiz_id = ?",
        )
        .get(QUIZ_ID),
    ).toMatchObject({
      claim_key: CLAIM_KEY,
      recovery_session_id: SECOND_RECOVERY_SESSION_ID,
    });
    const stored = db.sqlite
      .prepare(
        "SELECT import_key, quality_summary_json FROM quiz_banks WHERE id = ?",
      )
      .get(QUIZ_ID) as { import_key: string; quality_summary_json: string };
    expect(stored.import_key).toBe(CLAIM_KEY);
    expect(JSON.parse(stored.quality_summary_json)).toMatchObject({
      generationState: "recovering",
      recoverySessionId: SECOND_RECOVERY_SESSION_ID,
    });
  });

  it("lets a validated configuration automatically reclaim action-required state", async () => {
    const timestamp = Date.now() - 60_000;
    const db = createAutomaticDatabase("action_required", timestamp);
    db.sqlite
      .prepare(
        "UPDATE quiz_generation_claims SET lease_expires_at = ? WHERE quiz_id = ?",
      )
      .run(Date.now() - 1, QUIZ_ID);
    const { app, env } = testApp(db);
    const response = await app.request(
      `/attempts/${ATTEMPT_ID}/generation/claim`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimKey: CLAIM_KEY,
          generationSessionId: SESSION_ID,
          recoverySessionId: SECOND_RECOVERY_SESSION_ID,
        }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const stored = db.sqlite
      .prepare("SELECT quality_summary_json FROM quiz_banks WHERE id = ?")
      .get(QUIZ_ID) as { quality_summary_json: string };
    expect(JSON.parse(stored.quality_summary_json)).toMatchObject({
      generationState: "recovering",
    });
    expect(JSON.parse(stored.quality_summary_json).reasonCode).toBeUndefined();
  });
});

describe("protocol-8 evidence-grounded call events", () => {
  it("keeps v5.3 isolated, stores purpose, and materializes authoritative totals", async () => {
    const db = createGroundedDatabase();
    const { app, env } = testApp(db);
    expect((await putCall(app, env, groundedCallEvent())).status).toBe(201);
    expect(
      (
        await putCall(
          app,
          env,
          groundedCallEvent({
            callIndex: 1,
            startIndex: 1,
            acceptedCount: 0,
            outcome: "schema_invalid",
          }),
        )
      ).status,
    ).toBe(201);
    for (const [callIndex, ordinalAttempt] of [
      [2, 2],
      [3, 3],
    ] as const) {
      expect(
        (
          await putCall(
            app,
            env,
            groundedCallEvent({
              callIndex,
              startIndex: 1,
              ordinalAttempt,
              acceptedCount: 0,
              classification: "automatic_retry",
              retryKind: "content_repair",
              outcome: "schema_invalid",
            }),
          )
        ).status,
      ).toBe(201);
    }

    const exhausted = await putCall(
      app,
      env,
      groundedCallEvent({
        callIndex: 4,
        startIndex: 1,
        ordinalAttempt: 4,
        acceptedCount: 0,
        classification: "automatic_retry",
        retryKind: "content_repair",
        outcome: "schema_invalid",
      }),
    );
    expect(exhausted.status).toBe(409);
    expect(await exhausted.json()).toMatchObject({
      error: { code: "automatic_retry_ordinal_budget_exceeded" },
    });

    const events = db.sqlite
      .prepare(
        "SELECT protocol_version, purpose FROM quiz_generation_call_events ORDER BY call_index",
      )
      .all() as Array<{ protocol_version: number; purpose: string }>;
    expect(events).toHaveLength(4);
    expect(events.every((event) => event.protocol_version === 8)).toBe(true);
    expect(events.every((event) => event.purpose === "generation")).toBe(true);
    const stored = db.sqlite
      .prepare("SELECT quality_summary_json FROM quiz_banks WHERE id = ?")
      .get(QUIZ_ID) as { quality_summary_json: string };
    expect(JSON.parse(stored.quality_summary_json)).toMatchObject({
      aiCalls: 4,
      retryCount: 2,
      inputTokens: 400,
      outputTokens: 80,
      elapsedMs: 8_000,
    });
  });

  it("stores a bounded cooldown and releases the recovery lease", async () => {
    const db = createGroundedDatabase();
    const { app, env } = testApp(db);
    const nextRecoveryAt = new Date(Date.now() + 30_000).toISOString();
    const response = await app.request(
      `/imports/${QUIZ_ID}/progress`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": IMPORT_KEY,
        },
        body: JSON.stringify({
          state: "cooldown",
          reasonCode: "schema_invalid",
          recoverySessionId: RECOVERY_SESSION_ID,
          nextRecoveryAt,
        }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      generation: { state: "cooldown", nextRecoveryAt },
    });
    const stored = db.sqlite
      .prepare(
        "SELECT quality_summary_json, lease_expires_at FROM quiz_banks JOIN quiz_generation_claims ON quiz_generation_claims.quiz_id = quiz_banks.id WHERE quiz_banks.id = ?",
      )
      .get(QUIZ_ID) as {
      quality_summary_json: string;
      lease_expires_at: number;
    };
    expect(JSON.parse(stored.quality_summary_json)).toMatchObject({
      generationState: "cooldown",
      nextRecoveryAt: Date.parse(nextRecoveryAt),
    });
    expect(stored.lease_expires_at).toBeLessThanOrEqual(Date.now());
  });
});

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
      .prepare(
        "INSERT INTO quiz_generation_claims (quiz_id, generation_session_id, claim_key, lease_expires_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
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

describe("protocol-9 concept-first call lifecycles", () => {
  it.each([
    ["transient_http", "transport"],
    ["network_interrupted", "transport"],
    ["timeout", "transport"],
    ["call_dispatch_timeout", "transport"],
    ["stream_idle_timeout", "transport"],
    ["empty_content", "empty_content"],
    ["truncated_json", "truncated_output"],
    ["finish_length", "truncated_output"],
    ["duplicate_question", "duplicate_repair"],
    ["schema_invalid", "content_repair"],
    ["type_or_order_mismatch", "content_repair"],
    ["source_framing_invalid", "content_repair"],
    ["course_logistics_invalid", "content_repair"],
    ["low_pedagogical_value", "content_repair"],
    ["rubric_invalid", "content_repair"],
    ["question_tautology_invalid", "content_repair"],
    ["quiz_language_mismatch", "content_repair"],
    ["answer_mapping_invalid", "answer_repair"],
    ["mc_evidence_span_invalid", "answer_repair"],
    ["mc_distractor_duplicate", "answer_repair"],
    ["mc_distractor_equivalent", "answer_repair"],
    ["mc_answer_kind_mismatch", "answer_repair"],
    ["mc_question_answer_mismatch", "answer_repair"],
    ["true_false_fact_invalid", "answer_repair"],
    ["true_false_mutation_unavailable", "answer_repair"],
    ["short_atomic_invalid", "answer_repair"],
    ["short_proposition_invalid", "answer_repair"],
    ["short_enumeration_invalid", "answer_repair"],
    ["short_formula_invalid", "answer_repair"],
    ["question_answer_kind_mismatch", "answer_repair"],
    ["local_state_conflict", "automatic_resume"],
    ["append_conflict", "automatic_resume"],
  ] as const)("maps %s to the truthful %s retry kind", (outcome, kind) => {
    expect(automaticRetryKindForOutcome(outcome)).toBe(kind);
    expect(retryKindMatchesGenerationOutcome(kind, outcome)).toBe(true);
  });

  it.each([
    "complete",
    "partial_accepted",
    "credential_required",
    "billing_required",
    "source_unavailable",
    "recovery_budget_exhausted",
    "non_instructional_source",
  ] as const)("does not retry terminal outcome %s", (outcome) => {
    expect(automaticRetryKindForOutcome(outcome)).toBeNull();
  });

  it("accepts an answer-repair lifecycle after a precise v5.8 MC failure", async () => {
    const db = createConceptFirstDatabase();
    const { app, env } = testApp(db);
    expect(
      (await putCall(app, env, conceptFirstLifecycleEvent("started"))).status,
    ).toBe(201);
    expect(
      (await putCall(app, env, conceptFirstLifecycleEvent("completed"))).status,
    ).toBe(200);

    expect(
      (
        await putCall(
          app,
          env,
          conceptFirstLifecycleEvent("started", {
            callIndex: 1,
            startIndex: 1,
            acceptedCount: 0,
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await putCall(
          app,
          env,
          conceptFirstLifecycleEvent("completed", {
            callIndex: 1,
            startIndex: 1,
            acceptedCount: 0,
            outcome: "mc_evidence_span_invalid",
          }),
        )
      ).status,
    ).toBe(200);

    const snapshot = await readProgressiveGenerationSnapshot(
      db as unknown as D1Database,
      QUIZ_ID,
    );
    expect(snapshot.nextRetryKind).toBe("answer_repair");
    expect(snapshot.nextOrdinalAttempt).toBe(2);

    expect(
      (
        await putCall(
          app,
          env,
          conceptFirstLifecycleEvent("started", {
            callIndex: 2,
            startIndex: 1,
            ordinalAttempt: 2,
            acceptedCount: 0,
            classification: "automatic_retry",
            retryKind: "answer_repair",
          }),
        )
      ).status,
    ).toBe(201);
  });

  it("accepts buffered q1 telemetry after learner-facing questions advance", async () => {
    const db = createConceptFirstDatabase();
    const { app, env } = testApp(db);
    db.sqlite
      .prepare("INSERT INTO questions VALUES ('question-2', ?)")
      .run(QUIZ_ID);
    const stored = db.sqlite
      .prepare("SELECT quality_summary_json FROM quiz_banks WHERE id = ?")
      .get(QUIZ_ID) as { quality_summary_json: string };
    const bankSummary = JSON.parse(stored.quality_summary_json);
    bankSummary.acceptedCount = 2;
    bankSummary.generatedQuestionTypes = ["multiple_choice", "multiple_choice"];
    bankSummary.acceptedQuestionSummaries.push({
      id: "q2",
      type: "multiple_choice",
      concept: "Second concept",
      question: "Which second result is supported?",
    });
    db.sqlite
      .prepare("UPDATE quiz_banks SET quality_summary_json = ? WHERE id = ?")
      .run(JSON.stringify(bankSummary), QUIZ_ID);

    expect(
      (await putCall(app, env, conceptFirstLifecycleEvent("started"))).status,
    ).toBe(201);
    expect(
      (await putCall(app, env, conceptFirstLifecycleEvent("completed"))).status,
    ).toBe(200);
  });

  it("records one dispatched request and finalizes the same row exactly once", async () => {
    const db = createConceptFirstDatabase();
    const { app, env } = testApp(db);
    const started = conceptFirstLifecycleEvent("started");
    const completed = conceptFirstLifecycleEvent("completed");

    expect((await putCall(app, env, started)).status).toBe(201);
    expect((await putCall(app, env, started)).status).toBe(200);
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) AS count, lifecycle_state, outcome_code FROM quiz_generation_call_events",
        )
        .get(),
    ).toMatchObject({
      count: 1,
      lifecycle_state: "started",
      outcome_code: "call_started",
    });
    let stored = db.sqlite
      .prepare("SELECT quality_summary_json FROM quiz_banks WHERE id = ?")
      .get(QUIZ_ID) as { quality_summary_json: string };
    expect(JSON.parse(stored.quality_summary_json)).toMatchObject({
      aiCalls: 1,
      recoveryPhase: "dispatched",
      activeCallIndex: 0,
    });

    const activeSnapshot = await readProgressiveGenerationSnapshot(
      db as unknown as D1Database,
      QUIZ_ID,
    );
    expect(activeSnapshot.previousOutcome).toBeNull();
    expect(activeSnapshot.retryOrdinals).toEqual([]);
    expect(activeSnapshot.activeCall).toEqual({
      lifecycleState: "started",
      callIndex: 0,
      startIndex: 0,
      ordinalAttempt: 1,
    });

    expect((await putCall(app, env, completed)).status).toBe(200);
    expect((await putCall(app, env, completed)).status).toBe(200);
    const row = db.sqlite
      .prepare(
        `SELECT COUNT(*) AS count, lifecycle_state, outcome_code, accepted_count,
                dispatched_at, completed_at, protocol_version
         FROM quiz_generation_call_events`,
      )
      .get() as Record<string, unknown>;
    expect(row).toMatchObject({
      count: 1,
      lifecycle_state: "completed",
      outcome_code: "complete",
      accepted_count: 1,
      protocol_version: 9,
    });
    expect(Number(row.completed_at)).toBeGreaterThanOrEqual(
      Number(row.dispatched_at),
    );
    stored = db.sqlite
      .prepare("SELECT quality_summary_json FROM quiz_banks WHERE id = ?")
      .get(QUIZ_ID) as { quality_summary_json: string };
    const summary = JSON.parse(stored.quality_summary_json) as Record<
      string,
      unknown
    >;
    expect(summary).toMatchObject({ aiCalls: 1, retryCount: 0 });
    expect(summary).not.toHaveProperty("activeCallIndex");
    expect(summary).not.toHaveProperty("recoveryPhase");

    const conflict = await putCall(app, env, {
      ...completed,
      outcome: "schema_invalid" as const,
      acceptedCount: 0 as const,
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: { code: "generation_call_conflict" },
    });
  });

  it("abandons a stale dispatched call and permits one truthful automatic retry", async () => {
    const db = createConceptFirstDatabase();
    const { app, env } = testApp(db);
    expect(
      (await putCall(app, env, conceptFirstLifecycleEvent("started"))).status,
    ).toBe(201);
    expect(
      (await putCall(app, env, conceptFirstLifecycleEvent("completed"))).status,
    ).toBe(200);
    const startedSecond = conceptFirstLifecycleEvent("started", {
      callIndex: 1,
      startIndex: 1,
      acceptedCount: 0,
    });
    expect((await putCall(app, env, startedSecond)).status).toBe(201);
    db.sqlite
      .prepare(
        "UPDATE quiz_generation_claims SET lease_expires_at = ? WHERE quiz_id = ?",
      )
      .run(Date.now() - 1, QUIZ_ID);
    db.sqlite
      .prepare(
        "UPDATE quiz_generation_call_events SET dispatched_at = ? WHERE quiz_id = ? AND call_index = 1",
      )
      .run(Date.now() - 16 * 60_000, QUIZ_ID);

    const status = await app.request(
      `/attempts/${ATTEMPT_ID}/generation`,
      undefined,
      env,
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      continuation: {
        nextCallIndex: 2,
        activeCall: {
          lifecycleState: "started",
          callIndex: 1,
          startIndex: 1,
          ordinalAttempt: 1,
        },
      },
    });

    const claim = await app.request(
      `/attempts/${ATTEMPT_ID}/generation/claim`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimKey: CLAIM_KEY,
          generationSessionId: SESSION_ID,
          recoverySessionId: SECOND_RECOVERY_SESSION_ID,
        }),
      },
      env,
    );
    expect(claim.status).toBe(200);
    expect(
      db.sqlite
        .prepare(
          "SELECT lifecycle_state, outcome_code, elapsed_ms FROM quiz_generation_call_events WHERE quiz_id = ? AND call_index = 1",
        )
        .get(QUIZ_ID),
    ).toMatchObject({
      lifecycle_state: "abandoned",
      outcome_code: "network_interrupted",
      elapsed_ms: 120_000,
    });

    const retry = conceptFirstLifecycleEvent("started", {
      callIndex: 2,
      startIndex: 1,
      ordinalAttempt: 2,
      acceptedCount: 0,
      classification: "automatic_retry",
      retryKind: "transport",
    });
    expect(
      (
        await putCall(
          app,
          env,
          { ...retry, recoverySessionId: SECOND_RECOVERY_SESSION_ID },
          CLAIM_KEY,
        )
      ).status,
    ).toBe(201);
  });

  it("reclaims a failed bank whose historical abandoned call exceeded the active watchdog", async () => {
    const timestamp = Date.now();
    const db = createConceptFirstDatabase(timestamp);
    const { app, env } = testApp(db);
    expect(
      (await putCall(app, env, conceptFirstLifecycleEvent("started"))).status,
    ).toBe(201);
    expect(
      (await putCall(app, env, conceptFirstLifecycleEvent("completed"))).status,
    ).toBe(200);
    expect(
      (
        await putCall(
          app,
          env,
          conceptFirstLifecycleEvent("started", {
            callIndex: 1,
            startIndex: 1,
            acceptedCount: 0,
          }),
        )
      ).status,
    ).toBe(201);

    db.sqlite
      .prepare(
        `UPDATE quiz_generation_call_events
         SET lifecycle_state = 'abandoned', outcome_code = 'network_interrupted',
             completed_at = ?, elapsed_ms = 900000
         WHERE quiz_id = ? AND call_index = 1`,
      )
      .run(timestamp, QUIZ_ID);
    const bank = db.sqlite
      .prepare("SELECT quality_summary_json FROM quiz_banks WHERE id = ?")
      .get(QUIZ_ID) as { quality_summary_json: string };
    db.sqlite
      .prepare("UPDATE quiz_banks SET quality_summary_json = ? WHERE id = ?")
      .run(
        JSON.stringify({
          ...(JSON.parse(bank.quality_summary_json) as Record<string, unknown>),
          generationState: "generation_failed",
          reasonCode: "local_state_conflict",
        }),
        QUIZ_ID,
      );
    db.sqlite
      .prepare(
        "UPDATE quiz_generation_claims SET lease_expires_at = ? WHERE quiz_id = ?",
      )
      .run(timestamp - 1, QUIZ_ID);

    const status = await app.request(
      `/attempts/${ATTEMPT_ID}/generation`,
      undefined,
      env,
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      generation: {
        state: "generation_failed",
        availableQuestions: 1,
        totalQuestions: 5,
      },
      continuation: {
        claim: { state: "available" },
        nextCallIndex: 2,
      },
    });

    const claim = await app.request(
      `/attempts/${ATTEMPT_ID}/generation/claim`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimKey: CLAIM_KEY,
          generationSessionId: SESSION_ID,
          recoverySessionId: SECOND_RECOVERY_SESSION_ID,
        }),
      },
      env,
    );
    expect(claim.status).toBe(200);
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS count FROM questions WHERE quiz_id = ?")
        .get(QUIZ_ID),
    ).toMatchObject({ count: 1 });
    expect(
      db.sqlite
        .prepare(
          "SELECT elapsed_ms FROM quiz_generation_call_events WHERE quiz_id = ? AND call_index = 1",
        )
        .get(QUIZ_ID),
    ).toMatchObject({ elapsed_ms: 900_000 });
    const reclaimed = db.sqlite
      .prepare("SELECT quality_summary_json FROM quiz_banks WHERE id = ?")
      .get(QUIZ_ID) as { quality_summary_json: string };
    expect(JSON.parse(reclaimed.quality_summary_json)).toMatchObject({
      acceptedCount: 1,
      generationState: "recovering",
      recoverySessionId: SECOND_RECOVERY_SESSION_ID,
    });
  });

  it("reclaims a recoverable protocol-9 failed bank without replacing its accepted prefix", async () => {
    const timestamp = Date.now();
    const db = createConceptFirstDatabase(timestamp);
    const { app, env } = testApp(db);
    expect(
      (await putCall(app, env, conceptFirstLifecycleEvent("started"))).status,
    ).toBe(201);
    expect(
      (await putCall(app, env, conceptFirstLifecycleEvent("completed"))).status,
    ).toBe(200);
    expect(
      (
        await putCall(
          app,
          env,
          conceptFirstLifecycleEvent("started", {
            callIndex: 1,
            startIndex: 1,
            acceptedCount: 0,
          }),
        )
      ).status,
    ).toBe(201);

    const bank = db.sqlite
      .prepare("SELECT quality_summary_json FROM quiz_banks WHERE id = ?")
      .get(QUIZ_ID) as { quality_summary_json: string };
    db.sqlite
      .prepare("UPDATE quiz_banks SET quality_summary_json = ? WHERE id = ?")
      .run(
        JSON.stringify({
          ...(JSON.parse(bank.quality_summary_json) as Record<string, unknown>),
          generationState: "generation_failed",
          reasonCode: "local_state_conflict",
        }),
        QUIZ_ID,
      );
    db.sqlite
      .prepare(
        "UPDATE quiz_generation_claims SET lease_expires_at = ? WHERE quiz_id = ?",
      )
      .run(Date.now() - 1, QUIZ_ID);

    const status = await app.request(
      `/attempts/${ATTEMPT_ID}/generation`,
      undefined,
      env,
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      generation: {
        state: "generation_failed",
        availableQuestions: 1,
        totalQuestions: 5,
      },
      continuation: {
        claim: { state: "available" },
        activeCall: { callIndex: 1, startIndex: 1 },
      },
    });

    const claim = await app.request(
      `/attempts/${ATTEMPT_ID}/generation/claim`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimKey: CLAIM_KEY,
          generationSessionId: SESSION_ID,
          recoverySessionId: SECOND_RECOVERY_SESSION_ID,
        }),
      },
      env,
    );
    expect(claim.status).toBe(200);
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS count FROM questions WHERE quiz_id = ?")
        .get(QUIZ_ID),
    ).toMatchObject({ count: 1 });
    expect(
      db.sqlite
        .prepare(
          "SELECT lifecycle_state, outcome_code FROM quiz_generation_call_events WHERE quiz_id = ? AND call_index = 1",
        )
        .get(QUIZ_ID),
    ).toMatchObject({
      lifecycle_state: "abandoned",
      outcome_code: "network_interrupted",
    });
    const reclaimed = db.sqlite
      .prepare("SELECT quality_summary_json FROM quiz_banks WHERE id = ?")
      .get(QUIZ_ID) as { quality_summary_json: string };
    expect(JSON.parse(reclaimed.quality_summary_json)).toMatchObject({
      acceptedCount: 1,
      generationState: "recovering",
      recoverySessionId: SECOND_RECOVERY_SESSION_ID,
    });
  });

  it("keeps terminal protocol-9 failures unclaimable", async () => {
    const db = createConceptFirstDatabase();
    const bank = db.sqlite
      .prepare("SELECT quality_summary_json FROM quiz_banks WHERE id = ?")
      .get(QUIZ_ID) as { quality_summary_json: string };
    db.sqlite
      .prepare("UPDATE quiz_banks SET quality_summary_json = ? WHERE id = ?")
      .run(
        JSON.stringify({
          ...(JSON.parse(bank.quality_summary_json) as Record<string, unknown>),
          generationState: "generation_failed",
          reasonCode: "recovery_budget_exhausted",
        }),
        QUIZ_ID,
      );
    db.sqlite
      .prepare(
        "UPDATE quiz_generation_claims SET lease_expires_at = ? WHERE quiz_id = ?",
      )
      .run(Date.now() - 1, QUIZ_ID);
    const { app, env } = testApp(db);

    const status = await app.request(
      `/attempts/${ATTEMPT_ID}/generation`,
      undefined,
      env,
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      continuation: { claim: { state: "not_required" } },
    });
    const claim = await app.request(
      `/attempts/${ATTEMPT_ID}/generation/claim`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimKey: CLAIM_KEY,
          generationSessionId: SESSION_ID,
          recoverySessionId: SECOND_RECOVERY_SESSION_ID,
        }),
      },
      env,
    );
    expect(claim.status).toBe(409);
    expect(await claim.json()).toMatchObject({
      error: { code: "generation_claim_not_available" },
    });
  });

  it("rejects a terminal lifecycle that was never dispatched", async () => {
    const db = createConceptFirstDatabase();
    const { app, env } = testApp(db);
    const response = await putCall(
      app,
      env,
      conceptFirstLifecycleEvent("abandoned", {
        acceptedCount: 0,
        outcome: "network_interrupted",
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "generation_call_lifecycle_missing" },
    });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS count FROM quiz_generation_call_events")
        .get(),
    ).toMatchObject({ count: 0 });
  });
});

describe("protocol-10 prompt-first call lifecycles", () => {
  it("accepts structural retries and rejects historical content-repair kinds", async () => {
    const db = createPromptFirstDatabase();
    const { app, env } = testApp(db);
    expect(
      (await putCall(app, env, promptFirstLifecycleEvent("started"))).status,
    ).toBe(201);
    expect(
      (
        await putCall(
          app,
          env,
          promptFirstLifecycleEvent("completed", {
            acceptedCount: 0,
            outcome: "schema_invalid",
            retryDelayMs: 200,
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await putCall(
          app,
          env,
          promptFirstLifecycleEvent("started", {
            callIndex: 1,
            ordinalAttempt: 2,
            acceptedCount: 0,
            classification: "automatic_retry",
            retryKind: "structural",
          }),
        )
      ).status,
    ).toBe(201);
    const invalid = {
      ...promptFirstLifecycleEvent("started", {
        callIndex: 2,
        ordinalAttempt: 3,
        acceptedCount: 0,
        classification: "automatic_retry",
        retryKind: "structural",
      }),
      retryKind: "content_repair",
    };
    expect((await putCall(app, env, invalid)).status).toBe(422);
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
