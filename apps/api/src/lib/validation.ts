import type { Context } from "hono";
import type { ZodType } from "zod";
import { ApiError } from "./errors";
import { safeErrorName } from "./safe-error";

const DEFAULT_MAX_JSON_BYTES = 1_048_576;

async function readBoundedText(
  request: Request,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ApiError(
      413,
      "request_too_large",
      "The request body is too large.",
    );
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel();
        throw new ApiError(
          413,
          "request_too_large",
          "The request body is too large.",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function parseJson<T>(
  c: Context,
  schema: ZodType<T>,
  maximumBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<T> {
  let body: unknown;
  try {
    body = JSON.parse(await readBoundedText(c.req.raw, maximumBytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      400,
      "invalid_json",
      "The request body must be valid JSON.",
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_request",
      "Some request fields are invalid.",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

export function parseStoredJson<T>(
  value: string | null,
  schema: ZodType<T>,
  label: string,
): T {
  if (value === null) {
    throw new ApiError(500, "corrupt_data", `${label} is missing.`);
  }
  try {
    const parsed = schema.safeParse(JSON.parse(value));
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "stored_json",
        event: "invalid",
        label,
        errorName: safeErrorName(error),
      }),
    );
    throw new ApiError(500, "corrupt_data", `${label} could not be read.`);
  }
}
