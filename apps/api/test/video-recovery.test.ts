import { VideoImportResponseSchema } from "@clipquest/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { errorResponse } from "../src/lib/errors";
import type { ApiBindings } from "../src/middleware/authenticated";
import { videosRouter } from "../src/routes/videos";

const VIDEO_ID = "f7758f8f-53a9-4dd2-92a6-2f313137f0d0";
const OWNER_ID = "user-owner";

function testApp(userId: string) {
  const app = new Hono<ApiBindings>();
  app.use("*", async (context, next) => {
    context.set("user", {
      id: userId,
      email: `${userId}@example.com`,
      name: "Video owner",
      username: null,
      role: "user",
      banned: false,
    });
    await next();
  });
  app.route("/videos", videosRouter);
  app.onError((error, context) => errorResponse(error, context));

  const db = {
    prepare(sql: string) {
      expect(sql).toContain("owner_id = ?");
      return {
        bind(videoId: string, ownerId: string) {
          return {
            async first() {
              if (videoId !== VIDEO_ID || ownerId !== OWNER_ID) return null;
              return {
                id: VIDEO_ID,
                source: "youtube",
                source_video_id: "SVb9OV0bLzI",
                title: "A safe recovery lesson",
                duration_seconds: 643,
                source_language: "en",
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return {
    app,
    env: {
      DB: db,
      APP_ORIGIN: "https://clipquest.example",
    } as unknown as ApiBindings["Bindings"],
  };
}

describe("video recovery context", () => {
  it("returns only safe source metadata to the authenticated owner", async () => {
    const { app, env } = testApp(OWNER_ID);
    const response = await app.request(`/videos/${VIDEO_ID}/recovery`, {}, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = VideoImportResponseSchema.parse(await response.json());
    expect(body.video).toMatchObject({
      id: VIDEO_ID,
      sourceVideoId: "SVb9OV0bLzI",
      durationSeconds: 643,
    });
    expect(body.captions.preferredSegments).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(
      /caption text|original_url|api key/i,
    );
  });

  it("does not expose another user's recovery context", async () => {
    const { app, env } = testApp("user-other");
    const response = await app.request(`/videos/${VIDEO_ID}/recovery`, {}, env);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "video_not_found" },
    });
  });
});
