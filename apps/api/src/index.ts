import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import {
  LOCAL_QUIZ_MODEL,
  LOCAL_QUIZ_PIPELINE_VERSION,
  LOCAL_QUIZ_PROMPT_VERSION,
  LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  LOCAL_QUIZ_VALIDATOR_VERSION,
} from "@clipquest/contracts";
import { createAuth } from "./auth";
import { preventStaleAppShell, publicAssetShell } from "./lib/asset-shell";
import { androidAssetLinks } from "./lib/android-app-links";
import { appleAppSiteAssociation } from "./lib/apple-app-site-association";
import {
  quizGenerationProfile,
  quizGenerationRolloutMode,
} from "./lib/generation-rollout";
import { ApiError, errorResponse } from "./lib/errors";
import { clearExpiredRateLimits } from "./lib/rate-limit";
import { isAllowedRequestOrigin } from "./lib/request-origin";
import { publicWorkerVersion } from "./lib/worker-version";
import { authenticated, type ApiBindings } from "./middleware/authenticated";
import { adminRouter } from "./routes/admin";
import { generationRouter } from "./routes/generation";
import { libraryRouter } from "./routes/library";
import { mediaRouter } from "./routes/media";
import { modelsRouter } from "./routes/models";
import { pushRouter, sendDueReviewNotifications } from "./routes/push";
import { profileRouter } from "./routes/profile";
import {
  cheatSheetContextRouter,
  cheatSheetsRouter,
} from "./routes/cheat-sheets";
import { quizImportsRouter } from "./routes/quiz-imports";
import { quizzesRouter } from "./routes/quizzes";
import { thumbnailRouter, videosRouter } from "./routes/videos";
import { youtubeRouter } from "./routes/youtube";
import type { AppEnv } from "./types";

const app = new Hono<ApiBindings>();

app.use(
  "*",
  secureHeaders({
    crossOriginEmbedderPolicy: "credentialless",
    crossOriginOpenerPolicy: "same-origin",
    crossOriginResourcePolicy: "same-origin",
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
    xXssProtection: false,
  }),
);

app.use("*", async (c, next) => {
  const origin = c.req.header("origin");
  if (!isAllowedRequestOrigin(origin, c.env)) {
    console.warn(
      JSON.stringify({ scope: "request_origin", event: "rejected", origin }),
    );
    throw new ApiError(
      403,
      "origin_forbidden",
      "This request origin is not allowed.",
    );
  }
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

app.get("/.well-known/assetlinks.json", (c) => {
  const links = androidAssetLinks(
    c.env.ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINT,
  );
  if (!links) {
    return c.json([], 503, { "Cache-Control": "no-store" });
  }
  return c.json(links, 200, { "Cache-Control": "public, max-age=3600" });
});

app.get("/.well-known/apple-app-site-association", (c) => {
  const association = appleAppSiteAssociation(c.env.IOS_APP_LINKS_TEAM_ID);
  if (!association) {
    return c.json({}, 503, { "Cache-Control": "no-store" });
  }
  return c.json(association, 200, {
    "Cache-Control": "public, max-age=3600",
    "Content-Type": "application/json",
  });
});

app.use("*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    const shellPath = publicAssetShell(c.req.path);
    if (shellPath) {
      const assetUrl = new URL(c.req.url);
      assetUrl.pathname = shellPath;
      c.res = preventStaleAppShell(
        await c.env.ASSETS.fetch(
          new Request(assetUrl.toString(), {
            method: c.req.method,
            headers: c.req.raw.headers,
          }),
        ),
        publicWorkerVersion(c.env),
      );
      return;
    }
  }
  await next();
});

app.get("/health", (c) => {
  const configuration = {
    authentication: Boolean(c.env.BETTER_AUTH_SECRET),
    backendQuizGeneration: false,
    extensionQuizGeneration: true,
    extensionRequired: true,
    androidQuizGeneration: true,
    iosQuizGeneration: true,
    email: Boolean(c.env.RESEND_API_KEY),
    youtubeEncryption: Boolean(c.env.YOUTUBE_CREDENTIALS_ENCRYPTION_KEY),
    youtubeOpenSourceAcquisition: true,
  };
  const rolloutMode = quizGenerationRolloutMode(c.env);
  const effectiveDefaultProfile = quizGenerationProfile(
    c.env,
    "__clipquest_default_profile__",
  );
  return c.json({
    ok: configuration.authentication && configuration.email,
    service: "clipquest",
    model: LOCAL_QUIZ_MODEL,
    reasoningEffort: "none",
    pipelineVersion: LOCAL_QUIZ_PIPELINE_VERSION,
    promptVersion: LOCAL_QUIZ_PROMPT_VERSION,
    validatorVersion: LOCAL_QUIZ_VALIDATOR_VERSION,
    generationProfile: "prompt_first_auto_v5_12",
    rolloutMode,
    generationSelection: {
      supportedProfile: "prompt_first_auto_v5_12",
      supportedPromptVersion: LOCAL_QUIZ_PROMPT_VERSION,
      supportedValidatorVersion: LOCAL_QUIZ_VALIDATOR_VERSION,
      rolloutMode,
      effectiveDefaultProfile: effectiveDefaultProfile.generationProfile,
      requiredExtensionVersion: "0.8.24",
      requiredCapability: LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
      clients: {
        chromeExtension: {
          minimumVersion: "0.8.24",
          requiredCapability: LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
        },
        androidApp: {
          minimumVersion: "0.2.0",
          requiredCapability: LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
          foregroundOnly: true,
        },
        iosApp: {
          minimumVersion: "0.2.0",
          requiredCapability: LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
          foregroundOnly: true,
        },
      },
    },
    worker: publicWorkerVersion(c.env),
    versionAffinity: {
      requestKeyPresent: Boolean(
        c.req.header("Cloudflare-Workers-Version-Key"),
      ),
    },
    maintenance: false,
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
app.route("/api/local-ai", generationRouter);
app.route("/api/quiz-imports", quizImportsRouter);
app.route("/api", quizzesRouter);
app.route("/api/library", libraryRouter);
app.route("/api/push", pushRouter);
app.route("/api/profile", profileRouter);
app.route("/api/cheat-sheets", cheatSheetsRouter);
app.route("/api", cheatSheetContextRouter);
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
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    Vary: "Origin",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

const worker = {
  fetch: app.fetch,
  async scheduled(_controller, env): Promise<void> {
    await Promise.all([
      sendDueReviewNotifications(env),
      clearExpiredRateLimits(env.DB),
    ]);
  },
} satisfies ExportedHandler<AppEnv>;

export default worker;
