import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { createAuth } from "./auth";
import { failGeneration, prepareGenerationRetry, processGeneration } from "./generation/processor";
import { ApiError, errorResponse } from "./lib/errors";
import { clearExpiredRateLimits } from "./lib/rate-limit";
import { authenticated, type ApiBindings } from "./middleware/authenticated";
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
  const allowed = !origin || allowedOrigins.has(origin) || origin.startsWith("clipquest://");
  if (origin && !allowed) throw new ApiError(403, "origin_forbidden", "This request origin is not allowed.");
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

app.get("/health", (c) => {
  const configuration = {
    authentication: Boolean(c.env.BETTER_AUTH_SECRET),
    generation: Boolean(c.env.DEEPSEEK_API_KEY),
    email: Boolean(c.env.RESEND_API_KEY),
    youtubeEncryption: Boolean(c.env.YOUTUBE_CREDENTIALS_ENCRYPTION_KEY),
  };
  return c.json({
    ok: configuration.authentication && configuration.generation && configuration.email,
    service: "clipquest",
    model: c.env.DEEPSEEK_MODEL,
    configuration,
    youtubeDemoHistory: c.env.ENABLE_YOUTUBE_DEMO_HISTORY === "true",
  });
});

app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// R2 remains private; this opaque-ID endpoint is deliberately public so native image views
// do not need to expose the Better Auth session cookie in an image URL.
app.route("/api/videos", thumbnailRouter);

app.use("/api/*", authenticated);
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
    return c.json({ error: { code: "not_found", message: "API endpoint not found." } }, 404);
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
        console.error("Discarding invalid generation queue message", parsed.error);
        message.ack();
        continue;
      }
      try {
        await processGeneration(env, parsed.data);
        message.ack();
      } catch (error) {
        console.error("Generation queue attempt failed", message.attempts, error);
        const nonRetryable = error instanceof ApiError && error.status === 422;
        if (nonRetryable || message.attempts >= 3) {
          await failGeneration(env, parsed.data.jobId, error);
          message.ack();
        } else {
          const prepared = await prepareGenerationRetry(env, parsed.data.jobId);
          if (prepared) message.retry({ delaySeconds: Math.min(60, 5 * message.attempts) });
          else message.ack();
        }
      }
    }
  },
  async scheduled(_controller, env): Promise<void> {
    await Promise.all([sendDueReviewNotifications(env), clearExpiredRateLimits(env.DB)]);
  },
} satisfies ExportedHandler<AppEnv, GenerationQueueMessage>;

export default worker;
