import { ApiError } from "./errors";

type RateLimitOptions = {
  namespace: string;
  identifier: string;
  maximum: number;
  windowSeconds: number;
};

export async function enforceRateLimit(kv: KVNamespace, options: RateLimitOptions): Promise<void> {
  const window = Math.floor(Date.now() / (options.windowSeconds * 1_000));
  const key = `rate:${options.namespace}:${options.identifier}:${window}`;
  const current = Number.parseInt((await kv.get(key)) ?? "0", 10);
  if (Number.isFinite(current) && current >= options.maximum) {
    throw new ApiError(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
  }
  await kv.put(key, String((Number.isFinite(current) ? current : 0) + 1), {
    expirationTtl: options.windowSeconds + 30,
  });
}

