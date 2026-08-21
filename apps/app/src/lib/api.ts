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

export class ClientApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
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
  const cookie = readNativeAuthCookie(Platform.OS, () => authClient.getCookie());
  if (cookie) headers.set("Cookie", cookie);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body: unknown = contentType.includes("application/json") ? await response.json() : await response.text();
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
    throw new ClientApiError(502, "invalid_server_response", "ClipQuest received an unexpected server response.", parsed.error.flatten());
  }
  return parsed.data;
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}
