import {
  AdminGenerationSchema,
  LOCAL_QUIZ_PIPELINE_VERSION,
  type AdminGeneration,
  type AdminGenerationState,
} from "@clipquest/contracts";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import {
  PROGRESSIVE_GENERATION_STALE_AFTER_MS,
  readProgressiveGenerationSnapshot,
} from "../lib/progressive-quiz";

export type AdminGenerationCounts = {
  generating: number;
  retrying: number;
  recovering: number;
  cooldown: number;
  retryRequired: number;
  actionRequired: number;
  generationFailed: number;
  ready: number;
};

export type AdminGenerationFilters = {
  page: number;
  pageSize: number;
  search: string;
  state?: AdminGenerationState;
  stalled?: boolean;
};

type AdminGenerationSeed = {
  quiz_id: string;
  created_at: number;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  video_id: string;
  video_title: string;
  video_source: string;
};

type CountRow = { count: number };

const GenerationCountsRowSchema = z.object({
  generating: z.coerce.number().int().nonnegative(),
  retrying: z.coerce.number().int().nonnegative(),
  recovering: z.coerce.number().int().nonnegative(),
  cooldown: z.coerce.number().int().nonnegative(),
  retry_required: z.coerce.number().int().nonnegative(),
  action_required: z.coerce.number().int().nonnegative(),
  generation_failed: z.coerce.number().int().nonnegative(),
  ready: z.coerce.number().int().nonnegative(),
});

const RecentGenerationFailureRowSchema = z.object({
  id: z.string(),
  video_title: z.string(),
  owner_email: z.string().email(),
  generation_state: z.string(),
  reason_code: z.string().nullable(),
  last_progress_at: z.coerce.number().int().positive(),
});

const STATE_EXPRESSION =
  "json_extract(q.quality_summary_json, '$.generationState')";
const PROFILE_EXPRESSION =
  "COALESCE(json_extract(q.quality_summary_json, '$.generationProfile'), 'legacy_reasoning_v5_1')";
const AUTOMATIC_PROFILE_EXPRESSION = `${PROFILE_EXPRESSION} IN ('stable_auto_recovery_v5_3', 'evidence_grounded_auto_v5_4', 'concept_first_auto_v5_8', 'prompt_first_auto_v5_9')`;
const AUTOMATIC_RECOVERY_EXPRESSION = `(
  ${AUTOMATIC_PROFILE_EXPRESSION}
  OR (
    ${PROFILE_EXPRESSION} = 'legacy_reasoning_v5_1'
    AND COALESCE(CAST(json_extract(q.quality_summary_json, '$.resultProtocolVersion') AS INTEGER), 5) = 5
  )
)`;
const LAST_PROGRESS_EXPRESSION = `MAX(
  COALESCE(CAST(json_extract(q.quality_summary_json, '$.lastQuestionAt') AS INTEGER), CAST(json_extract(q.quality_summary_json, '$.lastProgressAt') AS INTEGER), 0),
  COALESCE(CAST(json_extract(q.quality_summary_json, '$.stateChangedAt') AS INTEGER), CAST(json_extract(q.quality_summary_json, '$.lastProgressAt') AS INTEGER), 0),
  COALESCE((SELECT MAX(event.created_at) FROM quiz_generation_call_events event WHERE event.quiz_id = q.id), 0)
)`;

export async function readAdminGenerationPage(
  db: D1Database,
  filters: AdminGenerationFilters,
  currentTime = Date.now(),
): Promise<{ generations: AdminGeneration[]; total: number }> {
  const { clause, values } = generationFilterClause(filters, currentTime);
  const offset = (filters.page - 1) * filters.pageSize;
  const [totalRow, seeds] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM quiz_banks q
         JOIN videos v ON v.id = q.video_id
         JOIN user u ON u.id = q.user_id
         ${clause}`,
      )
      .bind(...values)
      .first<CountRow>(),
    db
      .prepare(
        `SELECT q.id AS quiz_id, q.created_at,
           u.id AS owner_id, u.name AS owner_name, u.email AS owner_email,
           v.id AS video_id, v.title AS video_title, v.source AS video_source
         FROM quiz_banks q
         JOIN videos v ON v.id = q.video_id
         JOIN user u ON u.id = q.user_id
         ${clause}
         ORDER BY q.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(...values, filters.pageSize, offset)
      .all<AdminGenerationSeed>(),
  ]);

  const generations = await Promise.all(
    seeds.results.map(async (seed) => {
      const snapshot = await readProgressiveGenerationSnapshot(
        db,
        seed.quiz_id,
      );
      return adminGenerationFromSnapshot(seed, snapshot);
    }),
  );
  return { generations, total: Number(totalRow?.count ?? 0) };
}

export function adminGenerationFromSnapshot(
  seed: AdminGenerationSeed,
  snapshot: Awaited<ReturnType<typeof readProgressiveGenerationSnapshot>>,
): AdminGeneration {
  if (
    snapshot.pipelineVersion !== LOCAL_QUIZ_PIPELINE_VERSION ||
    !snapshot.summary ||
    !snapshot.availability
  ) {
    throw new ApiError(
      409,
      "admin_generation_state_invalid",
      "A progressive generation record is not internally valid.",
    );
  }
  const telemetry = snapshot.telemetry;
  const authoritative = telemetry.available;
  const callCount = authoritative
    ? telemetry.callCount
    : snapshot.summary.aiCalls;
  const automaticRetries = authoritative
    ? telemetry.automaticRetries
    : snapshot.summary.retryCount;
  const lastActivityAt = Math.max(
    snapshot.summary.lastQuestionAt,
    snapshot.summary.stateChangedAt,
    telemetry.lastAttemptAt ?? 0,
  );
  return AdminGenerationSchema.parse({
    quizId: snapshot.quizId,
    state: snapshot.availability.state,
    acceptedQuestions: snapshot.availability.availableQuestions,
    plannedQuestions: snapshot.availability.totalQuestions,
    progress:
      snapshot.availability.availableQuestions /
      snapshot.availability.totalQuestions,
    requestedQuestionTypes: snapshot.summary.requestedQuestionTypes,
    aiCalls: callCount,
    retryCount: automaticRetries,
    elapsedMs: authoritative ? telemetry.elapsedMs : snapshot.summary.elapsedMs,
    telemetrySource: authoritative ? "authoritative_calls" : "legacy_summary",
    primaryCalls: authoritative
      ? telemetry.primaryCalls
      : Math.max(0, snapshot.summary.aiCalls - snapshot.summary.retryCount),
    automaticRetries,
    automaticRecoveries: authoritative ? telemetry.automaticRecoveries : 0,
    manualContinuations: authoritative ? telemetry.manualContinuations : 0,
    partialCalls: authoritative ? telemetry.partialCalls : 0,
    outcomeCounts: authoritative ? telemetry.outcomeCounts : {},
    tokenUsage: {
      inputTokens: authoritative
        ? telemetry.inputTokens
        : snapshot.summary.inputTokens,
      outputTokens: authoritative
        ? telemetry.outputTokens
        : snapshot.summary.outputTokens,
      reasoningTokens: authoritative
        ? telemetry.reasoningTokens
        : snapshot.summary.reasoningTokens,
      completeCalls: authoritative ? telemetry.completeUsageCalls : 0,
      unknownCalls: authoritative
        ? telemetry.callCount - telemetry.completeUsageCalls
        : snapshot.summary.aiCalls,
      complete:
        authoritative &&
        telemetry.callCount > 0 &&
        telemetry.completeUsageCalls === telemetry.callCount,
    },
    firstQuestionLatencyMs: authoritative
      ? telemetry.firstQuestionLatencyMs
      : null,
    reasonCode: snapshot.availability.reasonCode ?? null,
    stalled: snapshot.stalled,
    lastProgressAt: toIso(lastActivityAt),
    lastQuestionAt: toIso(snapshot.summary.lastQuestionAt),
    lastAttemptAt: telemetry.lastAttemptAt
      ? toIso(telemetry.lastAttemptAt)
      : null,
    stateChangedAt: toIso(snapshot.summary.stateChangedAt),
    createdAt: toIso(seed.created_at),
    owner: {
      id: seed.owner_id,
      name: seed.owner_name,
      email: seed.owner_email,
    },
    video: {
      id: seed.video_id,
      title: seed.video_title,
      source: seed.video_source,
    },
  });
}

export async function readAdminGenerationCounts(
  db: D1Database,
  currentTime = Date.now(),
): Promise<AdminGenerationCounts> {
  const stalledBefore = currentTime - PROGRESSIVE_GENERATION_STALE_AFTER_MS;
  const row = await db
    .prepare(
      `SELECT
        SUM(CASE WHEN ${STATE_EXPRESSION} = 'generating' AND ${LAST_PROGRESS_EXPRESSION} >= ? THEN 1 ELSE 0 END) AS generating,
        SUM(CASE WHEN ${STATE_EXPRESSION} = 'retrying' AND ${LAST_PROGRESS_EXPRESSION} >= ? THEN 1 ELSE 0 END) AS retrying,
        SUM(CASE WHEN ${STATE_EXPRESSION} = 'recovering' OR (${AUTOMATIC_RECOVERY_EXPRESSION} AND ${STATE_EXPRESSION} IN ('generating', 'retrying') AND ${LAST_PROGRESS_EXPRESSION} < ?) THEN 1 ELSE 0 END) AS recovering,
        SUM(CASE WHEN ${STATE_EXPRESSION} = 'cooldown' THEN 1 ELSE 0 END) AS cooldown,
        SUM(CASE WHEN ${STATE_EXPRESSION} = 'retry_required' OR (NOT (${AUTOMATIC_RECOVERY_EXPRESSION}) AND ${STATE_EXPRESSION} IN ('generating', 'retrying') AND ${LAST_PROGRESS_EXPRESSION} < ?) THEN 1 ELSE 0 END) AS retry_required,
        SUM(CASE WHEN ${STATE_EXPRESSION} = 'action_required' THEN 1 ELSE 0 END) AS action_required,
        SUM(CASE WHEN ${STATE_EXPRESSION} = 'generation_failed' THEN 1 ELSE 0 END) AS generation_failed,
        SUM(CASE WHEN ${STATE_EXPRESSION} = 'ready' THEN 1 ELSE 0 END) AS ready
       FROM quiz_banks q
       JOIN videos v ON v.id = q.video_id
       WHERE ${validProgressiveGenerationWhere()}`,
    )
    .bind(stalledBefore, stalledBefore, stalledBefore, stalledBefore)
    .first();
  const parsed = GenerationCountsRowSchema.safeParse(
    row ?? {
      generating: 0,
      retrying: 0,
      recovering: 0,
      cooldown: 0,
      retry_required: 0,
      action_required: 0,
      generation_failed: 0,
      ready: 0,
    },
  );
  if (!parsed.success) {
    throw new ApiError(
      409,
      "admin_generation_counts_invalid",
      "Progressive generation counts could not be validated.",
    );
  }
  return {
    generating: parsed.data.generating,
    retrying: parsed.data.retrying,
    recovering: parsed.data.recovering,
    cooldown: parsed.data.cooldown,
    retryRequired: parsed.data.retry_required,
    actionRequired: parsed.data.action_required,
    generationFailed: parsed.data.generation_failed,
    ready: parsed.data.ready,
  };
}

export async function readRecentGenerationFailures(
  db: D1Database,
  limit = 5,
  currentTime = Date.now(),
) {
  const stalledBefore = currentTime - PROGRESSIVE_GENERATION_STALE_AFTER_MS;
  const rows = await db
    .prepare(
      `SELECT q.id,
        v.title AS video_title,
        u.email AS owner_email,
        ${STATE_EXPRESSION} AS generation_state,
        json_extract(q.quality_summary_json, '$.reasonCode') AS reason_code,
        ${LAST_PROGRESS_EXPRESSION} AS last_progress_at
       FROM quiz_banks q
       JOIN videos v ON v.id = q.video_id
       JOIN user u ON u.id = q.user_id
       WHERE ${validProgressiveGenerationWhere()}
         AND (
           ${STATE_EXPRESSION} IN ('retry_required', 'action_required', 'generation_failed')
           OR (NOT (${AUTOMATIC_RECOVERY_EXPRESSION}) AND ${STATE_EXPRESSION} IN ('generating', 'retrying') AND ${LAST_PROGRESS_EXPRESSION} < ?)
         )
       ORDER BY ${LAST_PROGRESS_EXPRESSION} DESC
       LIMIT ?`,
    )
    .bind(stalledBefore, Math.max(1, Math.min(limit, 20)))
    .all();

  return rows.results.map((raw) => {
    const row = RecentGenerationFailureRowSchema.parse(raw);
    const stalled =
      (row.generation_state === "generating" ||
        row.generation_state === "retrying") &&
      row.last_progress_at < stalledBefore;
    return {
      id: row.id,
      videoTitle: row.video_title,
      ownerEmail: row.owner_email,
      errorCode:
        safeReasonCode(row.reason_code) ??
        (stalled ? "generation_stalled" : row.generation_state),
      errorMessage: null,
      updatedAt: toIso(row.last_progress_at),
    };
  });
}

export async function readLatestAppliedMigration(
  db: D1Database,
): Promise<string> {
  try {
    const row = await db
      .prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")
      .first<{ name: unknown }>();
    return typeof row?.name === "string" && row.name.length > 0
      ? row.name.slice(0, 200)
      : "unknown";
  } catch {
    return "unknown";
  }
}

function generationFilterClause(
  filters: AdminGenerationFilters,
  currentTime: number,
): { clause: string; values: unknown[] } {
  const where = [validProgressiveGenerationWhere()];
  const values: unknown[] = [];
  const stalledBefore = currentTime - PROGRESSIVE_GENERATION_STALE_AFTER_MS;
  if (filters.search) {
    where.push(
      "(q.id LIKE ? OR v.id LIKE ? OR v.title LIKE ? OR u.name LIKE ? OR u.email LIKE ?)",
    );
    const pattern = `%${filters.search}%`;
    values.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (filters.state === "retry_required") {
    where.push(
      `(${STATE_EXPRESSION} = 'retry_required' OR (NOT (${AUTOMATIC_RECOVERY_EXPRESSION}) AND ${STATE_EXPRESSION} IN ('generating', 'retrying') AND ${LAST_PROGRESS_EXPRESSION} < ?))`,
    );
    values.push(stalledBefore);
  } else if (filters.state === "recovering") {
    where.push(
      `(${STATE_EXPRESSION} = 'recovering' OR (${AUTOMATIC_RECOVERY_EXPRESSION} AND ${STATE_EXPRESSION} IN ('generating', 'retrying') AND ${LAST_PROGRESS_EXPRESSION} < ?))`,
    );
    values.push(stalledBefore);
  } else if (filters.state === "generating" || filters.state === "retrying") {
    where.push(`${STATE_EXPRESSION} = ? AND ${LAST_PROGRESS_EXPRESSION} >= ?`);
    values.push(filters.state, stalledBefore);
  } else if (filters.state === "cooldown") {
    where.push(`${STATE_EXPRESSION} = 'cooldown'`);
  } else if (filters.state === "ready") {
    where.push(`${STATE_EXPRESSION} = 'ready'`);
  } else if (
    filters.state === "action_required" ||
    filters.state === "generation_failed"
  ) {
    where.push(`${STATE_EXPRESSION} = ?`);
    values.push(filters.state);
  }
  if (filters.stalled === true) {
    where.push(
      `${STATE_EXPRESSION} IN ('generating', 'retrying') AND ${LAST_PROGRESS_EXPRESSION} < ?`,
    );
    values.push(stalledBefore);
  } else if (filters.stalled === false) {
    where.push(
      `NOT (${STATE_EXPRESSION} IN ('generating', 'retrying') AND ${LAST_PROGRESS_EXPRESSION} < ?)`,
    );
    values.push(stalledBefore);
  }
  return { clause: `WHERE ${where.join(" AND ")}`, values };
}

function validProgressiveGenerationWhere(): string {
  return `q.pipeline_version = ${LOCAL_QUIZ_PIPELINE_VERSION}
    AND v.source = 'youtube'
    AND json_valid(q.quality_summary_json) = 1
    AND json_extract(q.quality_summary_json, '$.source') = 'extension-local-json-stream'
    AND CAST(json_extract(q.quality_summary_json, '$.pipelineVersion') AS INTEGER) = ${LOCAL_QUIZ_PIPELINE_VERSION}
    AND CAST(json_extract(q.quality_summary_json, '$.acceptedCount') AS INTEGER) = (
      SELECT COUNT(*) FROM questions stored_question WHERE stored_question.quiz_id = q.id
    )
    AND (
      (${STATE_EXPRESSION} = 'ready' AND q.quality_status = 'passed')
      OR (${STATE_EXPRESSION} IN ('generating', 'retrying', 'recovering', 'cooldown', 'retry_required', 'action_required', 'generation_failed') AND q.quality_status = 'generating')
    )`;
}

function safeReasonCode(value: string | null): string | null {
  return value && /^[a-z0-9_]{1,64}$/.test(value) ? value : null;
}

function toIso(value: number): string {
  return new Date(
    value < 1_000_000_000_000 ? value * 1_000 : value,
  ).toISOString();
}
