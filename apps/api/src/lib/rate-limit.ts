import { ApiError } from "./errors";

type RateLimitOptions = {
  namespace: string;
  identifier: string;
  maximum: number;
  windowSeconds: number;
};

export async function enforceRateLimit(db: D1Database, options: RateLimitOptions): Promise<void> {
  const timestamp = Date.now();
  const key = `${options.namespace}:${options.identifier}`;
  const expiresAt = timestamp + options.windowSeconds * 1_000;
  const current = await db.prepare(
    `INSERT INTO api_rate_limits (key, count, expires_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN api_rate_limits.expires_at <= ? THEN 1 ELSE api_rate_limits.count + 1 END,
       expires_at = CASE WHEN api_rate_limits.expires_at <= ? THEN excluded.expires_at ELSE api_rate_limits.expires_at END
     RETURNING count`,
  ).bind(key, expiresAt, timestamp, timestamp).first<{ count: number }>();
  if (!current || current.count > options.maximum) {
    throw new ApiError(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
  }
}

export async function clearExpiredRateLimits(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM api_rate_limits WHERE expires_at <= ?").bind(Date.now()).run();
}
