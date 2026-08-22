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
  ({ DB: adapter, APP_ORIGIN }) as unknown as ApiBindings["Bindings"];

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
      .prepare(
        "UPDATE quiz_banks SET quality_status = 'generating' WHERE id = ?",
      )
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
