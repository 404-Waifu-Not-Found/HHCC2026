import {
  CheatSheetContextSchema,
  CheatSheetDocumentSchema,
  CheatSheetFailureRequestSchema,
  CheatSheetResponseSchema,
  CheatSheetUploadRequestSchema,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import type { ApiBindings } from "../middleware/authenticated";

export const cheatSheetsRouter = new Hono<ApiBindings>();
export const cheatSheetContextRouter = new Hono<ApiBindings>();

cheatSheetContextRouter.get(
  "/quizzes/:quizId/cheat-sheet-context",
  async (c) => {
    const user = c.get("user");
    const quiz = await c.env.DB.prepare(
      `SELECT qb.id AS quiz_id, qb.video_id, v.source_video_id, qb.language, qb.primer, qb.created_at,
            v.title, v.source, q.prompt, q.reformulated_prompt, q.explanation
       FROM quiz_banks qb
       JOIN videos v ON v.id = qb.video_id AND v.owner_id = qb.user_id
       JOIN questions q ON q.quiz_id = qb.id
      WHERE qb.id = ? AND qb.user_id = ?
      ORDER BY q.ordinal ASC`,
    )
      .bind(c.req.param("quizId"), user.id)
      .all<{
        quiz_id: string;
        video_id: string;
        source_video_id: string;
        language: string;
        primer: string;
        created_at: number;
        title: string;
        source: "youtube";
        prompt: string;
        reformulated_prompt: string;
        explanation: string;
      }>();
    const first = quiz.results[0];
    if (!first) throw new ApiError(404, "quiz_not_found", "Quiz not found.");
    return c.json(
      CheatSheetContextSchema.parse({
        videoId: first.video_id,
        sourceVideoId: first.source_video_id,
        quizId: first.quiz_id,
        sourceRevision: `${first.quiz_id}:${first.created_at}`,
        title: first.title,
        source: first.source,
        language: first.language === "zh-CN" ? "zh-CN" : "en",
        primer: first.primer,
        questions: quiz.results.map((row) => ({
          prompt: row.reformulated_prompt || row.prompt,
          explanation: row.explanation,
        })),
      }),
    );
  },
);

cheatSheetsRouter.post("/", async (c) => {
  const user = c.get("user");
  const input = CheatSheetUploadRequestSchema.parse(await c.req.json());
  let expectedRevision: string;
  let existing: {
    id: string;
    notes_key: string | null;
    pdf_key: string | null;
  } | null;
  if (input.quizId) {
    const ownership = await c.env.DB.prepare(
      `SELECT qb.id, qb.video_id, qb.created_at
         FROM quiz_banks qb
        WHERE qb.id = ? AND qb.video_id = ? AND qb.user_id = ?`,
    )
      .bind(input.quizId, input.videoId, user.id)
      .first<{ id: string; video_id: string; created_at: number }>();
    if (!ownership)
      throw new ApiError(404, "quiz_not_found", "Quiz not found.");
    expectedRevision = `${input.quizId}:${ownership.created_at}`;
    existing = await c.env.DB.prepare(
      "SELECT id, notes_key, pdf_key FROM cheat_sheets WHERE user_id = ? AND video_id = ? AND quiz_id = ? AND source_revision = ?",
    )
      .bind(user.id, input.videoId, input.quizId, input.sourceRevision)
      .first<{
        id: string;
        notes_key: string | null;
        pdf_key: string | null;
      }>();
  } else {
    const video = await c.env.DB.prepare(
      "SELECT id FROM videos WHERE id = ? AND owner_id = ? AND source = 'youtube'",
    )
      .bind(input.videoId, user.id)
      .first<{ id: string }>();
    if (!video) throw new ApiError(404, "video_not_found", "Video not found.");
    expectedRevision = `video:${input.videoId}`;
    existing = await c.env.DB.prepare(
      "SELECT id, notes_key, pdf_key FROM video_cheat_sheets WHERE user_id = ? AND video_id = ? AND source_revision = ?",
    )
      .bind(user.id, input.videoId, input.sourceRevision)
      .first<{
        id: string;
        notes_key: string | null;
        pdf_key: string | null;
      }>();
  }
  if (input.sourceRevision !== expectedRevision)
    throw new ApiError(
      409,
      "stale_source_revision",
      "These notes were generated from an older quiz revision.",
    );
  const document = CheatSheetDocumentSchema.parse(input.document);
  let pdf: Uint8Array;
  try {
    pdf = decodeBase64(input.pdfBase64);
  } catch {
    throw new ApiError(400, "pdf_invalid", "The cheat sheet PDF is malformed.");
  }
  if (new TextDecoder().decode(pdf.slice(0, 4)) !== "%PDF") {
    throw new ApiError(400, "pdf_invalid", "The cheat sheet PDF is malformed.");
  }
  if (pdf.byteLength > 7_500_000)
    throw new ApiError(
      413,
      "pdf_too_large",
      "The cheat sheet PDF is too large.",
    );
  const timestamp = now();
  const id = existing?.id ?? createId();
  const storageScope = input.quizId ?? "video";
  const notesKey = `cheat-sheets/${user.id}/${input.videoId}/${storageScope}/${input.sourceRevision}.json`;
  const pdfKey = `cheat-sheets/${user.id}/${input.videoId}/${storageScope}/${input.sourceRevision}.pdf`;
  await Promise.all([
    c.env.PRIVATE_BUCKET.put(notesKey, JSON.stringify(document), {
      httpMetadata: { contentType: "application/json" },
    }),
    c.env.PRIVATE_BUCKET.put(pdfKey, pdf, {
      httpMetadata: {
        contentType: "application/pdf",
        contentDisposition: `attachment; filename="${safeFilename(document.title)}.pdf"`,
      },
    }),
  ]);
  if (input.quizId) {
    await c.env.DB.prepare(
      `INSERT INTO cheat_sheets (id,user_id,video_id,quiz_id,source_revision,status,notes_key,pdf_key,content_hash,prompt_version,created_at,updated_at,generated_at,last_error)
       VALUES (?,?,?,?,?,'ready',?,?,?,?,?,?,?,NULL)
       ON CONFLICT(user_id,video_id,quiz_id,source_revision) DO UPDATE SET status='ready',notes_key=excluded.notes_key,pdf_key=excluded.pdf_key,content_hash=excluded.content_hash,prompt_version=excluded.prompt_version,updated_at=excluded.updated_at,generated_at=excluded.generated_at,last_error=NULL`,
    )
      .bind(
        id,
        user.id,
        input.videoId,
        input.quizId,
        input.sourceRevision,
        notesKey,
        pdfKey,
        input.contentHash,
        input.promptVersion,
        timestamp,
        timestamp,
        timestamp,
      )
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO video_cheat_sheets (id,user_id,video_id,source_revision,status,notes_key,pdf_key,content_hash,prompt_version,created_at,updated_at,generated_at,last_error)
       VALUES (?,?,?,?,'ready',?,?,?,?,?,?,?,NULL)
       ON CONFLICT(user_id,video_id,source_revision) DO UPDATE SET status='ready',notes_key=excluded.notes_key,pdf_key=excluded.pdf_key,content_hash=excluded.content_hash,prompt_version=excluded.prompt_version,updated_at=excluded.updated_at,generated_at=excluded.generated_at,last_error=NULL`,
    )
      .bind(
        id,
        user.id,
        input.videoId,
        input.sourceRevision,
        notesKey,
        pdfKey,
        input.contentHash,
        input.promptVersion,
        timestamp,
        timestamp,
        timestamp,
      )
      .run();
  }
  // Concurrent completion effects can both upload the same deterministic
  // artifact. D1 keeps the first row id on conflict, so return the canonical
  // row rather than an id that may not have been stored.
  const canonical = input.quizId
    ? await c.env.DB.prepare(
        "SELECT id, updated_at FROM cheat_sheets WHERE user_id = ? AND video_id = ? AND quiz_id = ? AND source_revision = ?",
      )
        .bind(user.id, input.videoId, input.quizId, input.sourceRevision)
        .first<{ id: string; updated_at: number }>()
    : await c.env.DB.prepare(
        "SELECT id, updated_at FROM video_cheat_sheets WHERE user_id = ? AND video_id = ? AND source_revision = ?",
      )
        .bind(user.id, input.videoId, input.sourceRevision)
        .first<{ id: string; updated_at: number }>();
  return c.json(
    CheatSheetResponseSchema.parse({
      id: canonical?.id ?? id,
      videoId: input.videoId,
      quizId: input.quizId,
      sourceRevision: input.sourceRevision,
      status: "ready",
      document,
      updatedAt: canonical?.updated_at ?? timestamp,
    }),
  );
});

cheatSheetsRouter.post("/failure", async (c) => {
  const user = c.get("user");
  const input = CheatSheetFailureRequestSchema.parse(await c.req.json());
  const quiz = await c.env.DB.prepare(
    "SELECT id, created_at FROM quiz_banks WHERE id = ? AND video_id = ? AND user_id = ?",
  )
    .bind(input.quizId, input.videoId, user.id)
    .first<{ id: string; created_at: number }>();
  if (!quiz) throw new ApiError(404, "quiz_not_found", "Quiz not found.");
  if (input.sourceRevision !== `${input.quizId}:${quiz.created_at}`)
    throw new ApiError(
      409,
      "stale_source_revision",
      "These notes were generated from an older quiz revision.",
    );
  const timestamp = now();
  const id = createId();
  await c.env.DB.prepare(
    `INSERT INTO cheat_sheets (id,user_id,video_id,quiz_id,source_revision,status,prompt_version,created_at,updated_at,last_error)
     VALUES (?,?,?,?,?,'failed',?,?,?,?)
     ON CONFLICT(user_id,video_id,quiz_id,source_revision) DO UPDATE SET status='failed',prompt_version=excluded.prompt_version,updated_at=excluded.updated_at,last_error=excluded.last_error`,
  )
    .bind(
      id,
      user.id,
      input.videoId,
      input.quizId,
      input.sourceRevision,
      input.promptVersion,
      timestamp,
      timestamp,
      input.lastError,
    )
    .run();
  const stored = await c.env.DB.prepare(
    "SELECT id, updated_at FROM cheat_sheets WHERE user_id = ? AND video_id = ? AND quiz_id = ? AND source_revision = ?",
  )
    .bind(user.id, input.videoId, input.quizId, input.sourceRevision)
    .first<{ id: string; updated_at: number }>();
  return c.json({
    id: stored?.id ?? id,
    status: "failed",
    updatedAt: stored?.updated_at ?? timestamp,
  });
});

cheatSheetsRouter.get("/:sheetId", async (c) => {
  const row = await getSheet(c, c.req.param("sheetId"));
  const document = row.notes_key ? await readDocument(c, row.notes_key) : null;
  return c.json(
    CheatSheetResponseSchema.parse({
      id: row.id,
      videoId: row.video_id,
      quizId: row.quiz_id,
      sourceRevision: row.source_revision,
      status: row.status,
      document,
      updatedAt: row.updated_at,
    }),
  );
});

cheatSheetsRouter.get("/:sheetId/file", async (c) => {
  const row = await getSheet(c, c.req.param("sheetId"));
  if (row.status !== "ready" || !row.pdf_key)
    throw new ApiError(
      404,
      "cheat_sheet_unavailable",
      "The cheat sheet is not ready.",
    );
  const object = await c.env.PRIVATE_BUCKET.get(row.pdf_key);
  if (!object)
    throw new ApiError(
      404,
      "cheat_sheet_unavailable",
      "The cheat sheet is not ready.",
    );
  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${safeFilename(row.source_revision)}.pdf"`,
    "Cache-Control": "private, no-store",
  });
  return new Response(object.body, { headers });
});

cheatSheetsRouter.delete("/:sheetId", async (c) => {
  const row = await getSheet(c, c.req.param("sheetId"));
  const table = row.storage === "quiz" ? "cheat_sheets" : "video_cheat_sheets";
  await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`)
    .bind(row.id, c.get("user").id)
    .run();
  await c.env.PRIVATE_BUCKET.delete(
    [row.notes_key, row.pdf_key].filter((key): key is string => Boolean(key)),
  );
  return c.json({ removed: true });
});

async function getSheet(
  c: {
    env: ApiBindings["Bindings"];
    get(name: "user"): ApiBindings["Variables"]["user"];
  },
  id: string,
) {
  const quizRow = await c.env.DB.prepare(
    "SELECT id, user_id, video_id, quiz_id, source_revision, status, notes_key, pdf_key, updated_at FROM cheat_sheets WHERE id = ? AND user_id = ?",
  )
    .bind(id, c.get("user").id)
    .first<{
      id: string;
      user_id: string;
      video_id: string;
      quiz_id: string | null;
      source_revision: string;
      status: "ready" | "failed" | "none";
      notes_key: string | null;
      pdf_key: string | null;
      updated_at: number;
    }>();
  if (quizRow) return { ...quizRow, storage: "quiz" as const };
  const videoRow = await c.env.DB.prepare(
    "SELECT id, user_id, video_id, source_revision, status, notes_key, pdf_key, updated_at FROM video_cheat_sheets WHERE id = ? AND user_id = ?",
  )
    .bind(id, c.get("user").id)
    .first<{
      id: string;
      user_id: string;
      video_id: string;
      source_revision: string;
      status: "ready" | "failed" | "none";
      notes_key: string | null;
      pdf_key: string | null;
      updated_at: number;
    }>();
  if (videoRow)
    return { ...videoRow, quiz_id: null, storage: "video" as const };
  throw new ApiError(404, "cheat_sheet_not_found", "Cheat sheet not found.");
}

async function readDocument(c: { env: ApiBindings["Bindings"] }, key: string) {
  const object = await c.env.PRIVATE_BUCKET.get(key);
  if (!object) return null;
  try {
    return CheatSheetDocumentSchema.parse(await object.json());
  } catch {
    return null;
  }
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/^data:application\/pdf;base64,/, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeFilename(value: string): string {
  return (
    value
      .replace(/[^a-z0-9 _-]/gi, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "clipquest-cheat-sheet"
  );
}
