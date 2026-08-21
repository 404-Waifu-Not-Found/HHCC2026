import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

export class ApiError extends HTTPException {
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(status, { message });
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(error: Error, c: Context): Response {
  if (error instanceof ApiError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
      error.status,
    );
  }

  if (error instanceof HTTPException) {
    return c.json(
      { error: { code: "http_error", message: error.message } },
      error.status,
    );
  }

  console.error("Unhandled API error", error);
  return c.json(
    {
      error: {
        code: "internal_error",
        message: "Something went wrong. Please try again.",
      },
    },
    500,
  );
}
