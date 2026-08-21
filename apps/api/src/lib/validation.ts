import type { Context } from "hono";
import type { ZodType } from "zod";
import { ApiError } from "./errors";

export async function parseJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "The request body must be valid JSON.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(422, "invalid_request", "Some request fields are invalid.", parsed.error.flatten());
  }
  return parsed.data;
}

export function parseStoredJson<T>(value: string | null, schema: ZodType<T>, label: string): T {
  if (value === null) {
    throw new ApiError(500, "corrupt_data", `${label} is missing.`);
  }
  try {
    const parsed = schema.safeParse(JSON.parse(value));
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  } catch (error) {
    console.error(`Invalid stored JSON for ${label}`, error);
    throw new ApiError(500, "corrupt_data", `${label} could not be read.`);
  }
}

