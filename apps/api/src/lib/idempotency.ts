import type { Context } from "hono";
import { z } from "zod";
import { ApiError } from "./errors";

const IdempotencyKeySchema = z.string().uuid();

export function requireIdempotencyKey(c: Context): string {
  const key = IdempotencyKeySchema.safeParse(c.req.header("idempotency-key"));
  if (!key.success) {
    throw new ApiError(
      400,
      "idempotency_key_required",
      "A valid idempotency key is required.",
    );
  }
  return key.data;
}
