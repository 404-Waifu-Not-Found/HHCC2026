import type { ZodType } from "zod";
import { Platform } from "react-native";
import { authClient } from "./auth-client";
import { API_ORIGIN } from "./config";
import { readNativeAuthCookie } from "./request-cookie";

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export const API_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
export const API_REQUEST_TIMEOUT_MS = 30_000;

export class ClientApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  schema?: ZodType<T>,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  const cookie = readNativeAuthCookie(Platform.OS, () =>
    authClient.getCookie(),
  );
  if (cookie) headers.set("Cookie", cookie);
  if (
    options.body &&
    !(typeof FormData !== "undefined" && options.body instanceof FormData) &&
    !headers.has("Content-Type")
  )
    headers.set("Content-Type", "application/json");
  const controller = new AbortController();
  const callerSignal = options.signal;
  let timedOut = false;
  const abortFromCaller = () =>
    controller.abort(
      callerSignal?.reason ?? new DOMException("Aborted", "AbortError"),
    );
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }, API_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_ORIGIN}${path}`, {
      ...options,
      credentials: "include",
      headers,
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const text = await readBoundedApiResponseText(response);
    let body: unknown = text;
    if (contentType.includes("application/json")) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new ClientApiError(
          502,
          "invalid_server_response",
          "ClipQuest received an unreadable server response.",
        );
      }
    }
    if (!response.ok) {
      const errorBody = body as ApiErrorBody;
      throw new ClientApiError(
        response.status,
        errorBody.error?.code ?? "request_failed",
        errorBody.error?.message ?? `Request failed (${response.status})`,
        errorBody.error?.details,
      );
    }
    if (!schema) return body as T;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ClientApiError(
        502,
        "invalid_server_response",
        "ClipQuest received an unexpected server response.",
        parsed.error.flatten(),
      );
    }
    return parsed.data;
  } catch (error) {
    if (timedOut) {
      throw new ClientApiError(
        504,
        "request_timeout",
        "ClipQuest took too long to respond. Please try again.",
      );
    }
    if (callerSignal?.aborted) throw callerSignal.reason ?? error;
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function apiMultipartRequest<T>(
  path: string,
  body: FormData,
  schema?: ZodType<T>,
): Promise<T> {
  return apiRequest(path, { method: "PUT", body }, schema);
}

export async function apiBinaryRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/pdf, image/*, application/octet-stream");
  const cookie = readNativeAuthCookie(Platform.OS, () =>
    authClient.getCookie(),
  );
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code = "request_failed";
    try {
      const body = (await response.json()) as ApiErrorBody;
      message = body.error?.message ?? message;
      code = body.error?.code ?? code;
    } catch {
      // Keep the status fallback for binary error responses.
    }
    throw new ClientApiError(response.status, code, message);
  }
  return response;
}

export async function readBoundedApiResponseText(
  response: Response,
  maximumBytes = API_RESPONSE_MAX_BYTES,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw responseTooLarge();
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw responseTooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function responseTooLarge(): ClientApiError {
  return new ClientApiError(
    502,
    "response_too_large",
    "ClipQuest returned more data than this device can process safely.",
  );
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}
