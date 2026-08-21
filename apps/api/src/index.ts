import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { createAuth } from "./auth";
import {
  failGeneration,
  prepareGenerationRetry,
  processGeneration,
} from "./generation/processor";
import { publicAssetShell } from "./lib/asset-shell";
import { ApiError, errorResponse } from "./lib/errors";
import { clearExpiredRateLimits } from "./lib/rate-limit";
import { authenticated, type ApiBindings } from "./middleware/authenticated";
import { adminRouter } from "./routes/admin";
import { libraryRouter } from "./routes/library";
import { mediaRouter } from "./routes/media";
import { modelsRouter } from "./routes/models";
import { pushRouter, sendDueReviewNotifications } from "./routes/push";
import { quizzesRouter } from "./routes/quizzes";
import { generationRouter, transcriptsRouter } from "./routes/transcripts";
import { thumbnailRouter, videosRouter } from "./routes/videos";
import { youtubeRouter } from "./routes/youtube";
import type { AppEnv, GenerationQueueMessage } from "./types";

const GenerationMessageSchema = z.object({
  jobId: z.string().uuid(),
  userId: z.string(),
  videoId: z.string().uuid(),
});

const app = new Hono<ApiBindings>();

app.use(
  "*",
  secureHeaders({
    crossOriginEmbedderPolicy: "require-corp",
    crossOriginOpenerPolicy: "same-origin",
    crossOriginResourcePolicy: "same-origin",
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
    xXssProtection: false,
  }),
);

app.use("*", async (c, next) => {
  const origin = c.req.header("origin");
  const allowedOrigins = new Set([
    c.env.APP_ORIGIN,
    "http://localhost:8081",
    "http://localhost:19006",
    "http://127.0.0.1:8081",
  ]);
  const allowed =
    !origin || allowedOrigins.has(origin) || origin.startsWith("clipquest://");
  if (origin && !allowed)
    throw new ApiError(
      403,
      "origin_forbidden",
      "This request origin is not allowed.",
    );
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }
  await next();
  const headers = corsHeaders(origin);
  const response = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers: c.res.headers,
  });
  headers.forEach((value, key) => response.headers.set(key, value));
  c.res = response;
});

app.use("*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    const shellPath = publicAssetShell(c.req.path);
    if (shellPath) {
      const assetUrl = new URL(c.req.url);
      assetUrl.pathname = shellPath;
      c.res = await c.env.ASSETS.fetch(
        new Request(assetUrl.toString(), {
          method: c.req.method,
          headers: c.req.raw.headers,
        }),
      );
      return;
    }
  }
  await next();
});

app.get("/health", (c) => {
  const configuration = {
    authentication: Boolean(c.env.BETTER_AUTH_SECRET),
    generation: Boolean(c.env.DEEPSEEK_API_KEY),
    email: Boolean(c.env.RESEND_API_KEY),
    youtubeEncryption: Boolean(c.env.YOUTUBE_CREDENTIALS_ENCRYPTION_KEY),
  };
  return c.json({
    ok:
      configuration.authentication &&
      configuration.generation &&
      configuration.email,
    service: "clipquest",
    model: c.env.DEEPSEEK_MODEL,
    configuration,
    youtubeDemoHistory: c.env.ENABLE_YOUTUBE_DEMO_HISTORY === "true",
  });
});

app.all("/api/auth/admin/*", () => {
  throw new ApiError(404, "not_found", "API endpoint not found.");
});
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw),
);

// R2 remains private; this opaque-ID endpoint is deliberately public so native image views
// do not need to expose the Better Auth session cookie in an image URL.
app.route("/api/videos", thumbnailRouter);

app.use("/api/*", authenticated);
app.route("/api/admin", adminRouter);
app.route("/api/videos", videosRouter);
app.route("/api/media", mediaRouter);
app.route("/api/transcripts", transcriptsRouter);
app.route("/api/generation", generationRouter);
app.route("/api", quizzesRouter);
app.route("/api/library", libraryRouter);
app.route("/api/push", pushRouter);
app.route("/api/models", modelsRouter);
app.route("/api/youtube", youtubeRouter);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json(
      { error: { code: "not_found", message: "API endpoint not found." } },
      404,
    );
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => errorResponse(error, c));

function corsHeaders(origin: string | undefined): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Cookie, Idempotency-Key",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    Vary: "Origin",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

const worker = {
  fetch: app.fetch,
  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      const parsed = GenerationMessageSchema.safeParse(message.body);
      if (!parsed.success) {
        console.error(
          JSON.stringify({
            scope: "generation_queue",
            event: "message.discarded",
            reason: "invalid_payload",
            issueCount: parsed.error.issues.length,
          }),
        );
        message.ack();
        continue;
      }
      console.info(
        JSON.stringify({
          scope: "generation_queue",
          event: "message.received",
          jobId: parsed.data.jobId,
          attempt: message.attempts,
        }),
      );
      try {
        await processGeneration(env, parsed.data);
        message.ack();
        console.info(
          JSON.stringify({
            scope: "generation_queue",
            event: "message.acknowledged",
            jobId: parsed.data.jobId,
            attempt: message.attempts,
          }),
        );
      } catch (error) {
        const nonRetryable = error instanceof ApiError && error.status === 422;
        console.error(
          JSON.stringify({
            scope: "generation_queue",
            event: "message.failed",
            jobId: parsed.data.jobId,
            attempt: message.attempts,
            errorCode:
              error instanceof ApiError ? error.code : "generation_failed",
            errorName: error instanceof Error ? error.name : "UnknownError",
            nonRetryable,
          }),
        );
        if (nonRetryable || message.attempts >= 3) {
          await failGeneration(env, parsed.data.jobId, error);
          message.ack();
        } else {
          const prepared = await prepareGenerationRetry(env, parsed.data.jobId);
          if (prepared) {
            console.warn(
              JSON.stringify({
                scope: "generation_queue",
                event: "message.retry_scheduled",
                jobId: parsed.data.jobId,
                attempt: message.attempts,
                delaySeconds: Math.min(60, 5 * message.attempts),
              }),
            );
            message.retry({ delaySeconds: Math.min(60, 5 * message.attempts) });
          } else message.ack();
        }
      }
    }
  },
  async scheduled(_controller, env): Promise<void> {
    await Promise.all([
      sendDueReviewNotifications(env),
      clearExpiredRateLimits(env.DB),
    ]);
  },
} satisfies ExportedHandler<AppEnv, GenerationQueueMessage>;

export default worker;
