import {
  YouTubeDeviceStartResponseSchema,
  YouTubeDeviceStatusSchema,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import {
  Innertube,
  type OAuth2ClientID,
  type OAuth2Tokens,
} from "youtubei.js/cf-worker";
import { classifyHistoryTitles } from "../generation/deepseek";
import { decryptJson, encryptJson } from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { enforceRateLimit } from "../lib/rate-limit";
import { cacheThumbnail } from "../lib/thumbnail";
import type { ApiBindings } from "../middleware/authenticated";

const DeviceFlowSchema = z.object({
  flowId: z.string().uuid(),
  userId: z.string(),
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUrl: z.string().url(),
  expiresAt: z.number(),
  intervalSeconds: z.number().int().positive(),
  nextPollAt: z.number(),
  client: z.object({ client_id: z.string(), client_secret: z.string() }),
  state: z.enum(["pending", "connected", "expired", "failed"]),
  importedCandidates: z.number().int().nonnegative().optional(),
});
type DeviceFlow = z.infer<typeof DeviceFlowSchema>;

const TokenResponseSchema = z.union([
  z.object({ error: z.string(), error_description: z.string().optional() }),
  z.object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_in: z.number().positive(),
    scope: z.string().optional(),
    token_type: z.string().optional(),
  }),
]);

const StoredCredentialsSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expiry_date: z.string().datetime(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
  client: z.object({ client_id: z.string(), client_secret: z.string() }),
});

type HistoryCandidate = {
  id: string;
  title: string;
  thumbnailUrl: string;
};

export const youtubeRouter = new Hono<ApiBindings>();

youtubeRouter.post("/device/start", async (c) => {
  assertFeatureEnabled(c.env.ENABLE_YOUTUBE_DEMO_HISTORY);
  const user = c.get("user");
  await enforceRateLimit(c.env.DB, {
    namespace: "youtube-device-start",
    identifier: user.id,
    maximum: 3,
    windowSeconds: 300,
  });
  try {
    const youtube = await createYouTube(false);
    const oauth = youtube.session.oauth;
    const client = await oauth.getClientID();
    oauth.client_id = client;
    const code = await oauth.getDeviceAndUserCode();
    const flowId = createId();
    const timestamp = now();
    const flow: DeviceFlow = {
      flowId,
      userId: user.id,
      deviceCode: code.device_code,
      userCode: code.user_code,
      verificationUrl: code.verification_url,
      expiresAt: timestamp + code.expires_in * 1_000,
      intervalSeconds: code.interval,
      nextPollAt: timestamp,
      client,
      state: "pending",
    };
    await c.env.CACHE.put(`youtube-flow:${flowId}`, JSON.stringify(flow), {
      expirationTtl: Math.max(60, code.expires_in),
    });
    return c.json(
      YouTubeDeviceStartResponseSchema.parse({
        flowId,
        userCode: code.user_code,
        verificationUrl: code.verification_url,
        expiresAt: new Date(flow.expiresAt).toISOString(),
        intervalSeconds: code.interval,
      }),
      201,
    );
  } catch (error) {
    console.error("YouTube TV device flow failed", error);
    throw new ApiError(
      503,
      "youtube_demo_unavailable",
      "The experimental YouTube history connection is unavailable, so it has been hidden for now.",
    );
  }
});

youtubeRouter.get("/device/status", async (c) => {
  assertFeatureEnabled(c.env.ENABLE_YOUTUBE_DEMO_HISTORY);
  const user = c.get("user");
  const flowId = c.req.query("flowId");
  if (!flowId || !z.string().uuid().safeParse(flowId).success) {
    throw new ApiError(422, "invalid_flow_id", "A valid YouTube device flow ID is required.");
  }
  const flowRaw = await c.env.CACHE.get(`youtube-flow:${flowId}`, "json");
  const flowParsed = DeviceFlowSchema.safeParse(flowRaw);
  if (!flowParsed.success || flowParsed.data.userId !== user.id) {
    throw new ApiError(404, "youtube_flow_not_found", "This YouTube connection request expired.");
  }
  const flow = flowParsed.data;
  if (flow.state === "connected") {
    return c.json(
      YouTubeDeviceStatusSchema.parse({
        state: "connected",
        importedCandidates: flow.importedCandidates ?? 0,
      }),
    );
  }
  if (flow.expiresAt <= now()) {
    return c.json(YouTubeDeviceStatusSchema.parse({ state: "expired" }));
  }
  if (flow.nextPollAt > now()) {
    return c.json(YouTubeDeviceStatusSchema.parse({ state: "pending" }));
  }

  const token = await pollDeviceToken(flow);
  if ("error" in token) {
    if (token.error === "authorization_pending" || token.error === "slow_down") {
      await saveFlow(c.env.CACHE, {
        ...flow,
        nextPollAt: now() + (flow.intervalSeconds + (token.error === "slow_down" ? 5 : 0)) * 1_000,
      });
      return c.json(YouTubeDeviceStatusSchema.parse({ state: "pending" }));
    }
    const state = token.error === "expired_token" ? "expired" : "failed";
    await saveFlow(c.env.CACHE, { ...flow, state });
    return c.json(
      YouTubeDeviceStatusSchema.parse({
        state,
        message: token.error_description ?? "YouTube authorization failed.",
      }),
    );
  }

  const credentials: OAuth2Tokens = {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expiry_date: new Date(now() + token.expires_in * 1_000).toISOString(),
    ...(token.scope ? { scope: token.scope } : {}),
    ...(token.token_type ? { token_type: token.token_type } : {}),
    client: flow.client,
  };
  const encrypted = await encryptJson(c.env.YOUTUBE_CREDENTIALS_ENCRYPTION_KEY, credentials);
  const timestamp = now();
  await c.env.DB.prepare(
    "INSERT INTO youtube_connections (user_id, encrypted_credentials, credential_iv, connected_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET encrypted_credentials = excluded.encrypted_credentials, credential_iv = excluded.credential_iv, updated_at = excluded.updated_at",
  )
    .bind(user.id, encrypted.ciphertext, encrypted.iv, timestamp, timestamp)
    .run();

  let importedCandidates = 0;
  try {
    importedCandidates = await importLearningHistory(c.env, c.executionCtx, user.id, credentials);
  } catch (error) {
    console.error("YouTube history import failed after authentication", error);
    await c.env.DB.prepare("DELETE FROM youtube_connections WHERE user_id = ?").bind(user.id).run();
    throw new ApiError(
      503,
      "youtube_history_unavailable",
      "YouTube connected, but its private history API failed. The integration has been hidden and no credentials were kept.",
    );
  }
  await saveFlow(c.env.CACHE, { ...flow, state: "connected", importedCandidates });
  return c.json(YouTubeDeviceStatusSchema.parse({ state: "connected", importedCandidates }));
});

youtubeRouter.delete("/connection", async (c) => {
  assertFeatureEnabled(c.env.ENABLE_YOUTUBE_DEMO_HISTORY);
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    "SELECT encrypted_credentials, credential_iv FROM youtube_connections WHERE user_id = ?",
  )
    .bind(user.id)
    .first<{ encrypted_credentials: string; credential_iv: string }>();
  if (row) {
    try {
      const decrypted = await decryptJson(
        c.env.YOUTUBE_CREDENTIALS_ENCRYPTION_KEY,
        row.encrypted_credentials,
        row.credential_iv,
      );
      const credentials = StoredCredentialsSchema.parse(decrypted);
      const youtube = await createYouTube(false);
      await youtube.session.signIn(credentials);
      await youtube.session.oauth.revokeCredentials();
    } catch (error) {
      console.warn("YouTube credential revocation failed; deleting the local credential anyway", error);
    }
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM youtube_connections WHERE user_id = ?").bind(user.id),
    c.env.DB.prepare("DELETE FROM youtube_candidates WHERE user_id = ?").bind(user.id),
  ]);
  return c.json({ disconnected: true });
});

function assertFeatureEnabled(flag: string): void {
  if (flag !== "true") {
    throw new ApiError(404, "feature_disabled", "YouTube history is not enabled for this demo.");
  }
}

async function createYouTube(retrievePlayer: boolean): Promise<Innertube> {
  return Innertube.create({
    lang: "en",
    location: "US",
    retrieve_player: retrievePlayer,
    generate_session_locally: true,
    enable_session_cache: false,
  });
}

async function pollDeviceToken(flow: DeviceFlow): Promise<z.infer<typeof TokenResponseSchema>> {
  const response = await fetch("https://www.youtube.com/o/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: flow.client.client_id,
      client_secret: flow.client.client_secret,
      code: flow.deviceCode,
      grant_type: "http://oauth.net/grant_type/device/1.0",
    }),
  });
  const parsed = TokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ApiError(503, "youtube_demo_unavailable", "YouTube returned an unexpected device response.");
  }
  return parsed.data;
}

async function saveFlow(kv: KVNamespace, flow: DeviceFlow): Promise<void> {
  const remainingSeconds = Math.max(60, Math.ceil((flow.expiresAt - now()) / 1_000));
  await kv.put(`youtube-flow:${flow.flowId}`, JSON.stringify(flow), { expirationTtl: remainingSeconds });
}

async function importLearningHistory(
  env: ApiBindings["Bindings"],
  executionCtx: { waitUntil(promise: Promise<unknown>): void },
  userId: string,
  credentials: OAuth2Tokens,
): Promise<number> {
  const youtube = await createYouTube(false);
  await youtube.session.signIn(credentials);
  let history = await youtube.getHistory();
  const candidates: HistoryCandidate[] = [];
  while (candidates.length < 200) {
    for (const item of history.videos) {
      const candidate = readHistoryCandidate(item);
      if (candidate && !candidates.some((existing) => existing.id === candidate.id)) candidates.push(candidate);
      if (candidates.length >= 200) break;
    }
    if (candidates.length >= 200 || !history.has_continuation) break;
    history = await history.getContinuation();
  }
  if (!candidates.length) return 0;
  const educational = await classifyHistoryTitles(
    env,
    candidates.map(({ id, title }) => ({ id, title })),
  );
  const retained = candidates.filter((candidate) => educational.has(candidate.id));
  for (let offset = 0; offset < retained.length; offset += 40) {
    const chunk = retained.slice(offset, offset + 40);
    const timestamp = now();
    await env.DB.batch(
      chunk.flatMap((candidate) => {
        const videoId = createId();
        return [
          env.DB.prepare(
            "INSERT INTO videos (id, owner_id, source, source_video_id, original_url, title, thumbnail_remote_url, duration_seconds, origin, education_status, created_at, updated_at) VALUES (?, ?, 'youtube', ?, ?, ?, ?, 0, 'youtube_history', 'educational', ?, ?) ON CONFLICT(owner_id, source, source_video_id) DO UPDATE SET title = excluded.title, thumbnail_remote_url = excluded.thumbnail_remote_url, updated_at = excluded.updated_at",
          ).bind(
            videoId,
            userId,
            candidate.id,
            `https://www.youtube.com/watch?v=${candidate.id}`,
            candidate.title,
            candidate.thumbnailUrl,
            timestamp,
            timestamp,
          ),
          env.DB.prepare(
            "INSERT INTO youtube_candidates (id, user_id, source_video_id, title, thumbnail_remote_url, selected, classification_reason, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(user_id, source_video_id) DO UPDATE SET title = excluded.title, thumbnail_remote_url = excluded.thumbnail_remote_url, selected = 1, classification_reason = excluded.classification_reason",
          ).bind(
            createId(),
            userId,
            candidate.id,
            candidate.title,
            candidate.thumbnailUrl,
            educational.get(candidate.id) ?? "Learning-related",
            timestamp,
          ),
        ];
      }),
    );
  }
  executionCtx.waitUntil(cacheHistoryThumbnails(env, userId, retained));
  return retained.length;
}

function readHistoryCandidate(item: object): HistoryCandidate | null {
  if (!("video_id" in item) || typeof item.video_id !== "string") return null;
  const title = "title" in item ? String(item.title).trim() : "";
  if (!title) return null;
  let thumbnailUrl = `https://i.ytimg.com/vi/${item.video_id}/hqdefault.jpg`;
  if ("best_thumbnail" in item && isThumbnail(item.best_thumbnail)) thumbnailUrl = item.best_thumbnail.url;
  return { id: item.video_id, title, thumbnailUrl };
}

function isThumbnail(value: unknown): value is { url: string } {
  return typeof value === "object" && value !== null && "url" in value && typeof value.url === "string";
}

async function cacheHistoryThumbnails(
  env: ApiBindings["Bindings"],
  userId: string,
  candidates: HistoryCandidate[],
): Promise<void> {
  for (const candidate of candidates) {
    const row = await env.DB.prepare(
      "SELECT id FROM videos WHERE owner_id = ? AND source = 'youtube' AND source_video_id = ?",
    )
      .bind(userId, candidate.id)
      .first<{ id: string }>();
    if (row) await cacheThumbnail(env, row.id, candidate.thumbnailUrl);
  }
}
