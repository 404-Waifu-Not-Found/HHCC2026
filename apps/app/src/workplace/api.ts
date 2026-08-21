// REST client for the synced Workplace surface (/api/workplace/*). This
// module only ever persists already-sanitized, contract-validated payloads --
// the DeepSeek turn itself runs through the platform chat client in
// `./chat-client`, never through this module.
import {
  WorkplaceMessageSyncRequestSchema,
  WorkplaceMessageSyncResponseSchema,
  WorkplaceMessagesResponseSchema,
  WorkplacePracticeSetImportResponseSchema,
  WorkplaceSuggestionsResponseSchema,
  WorkplaceThreadCreateRequestSchema,
  WorkplaceThreadDeleteResponseSchema,
  WorkplaceThreadListResponseSchema,
  WorkplaceThreadRenameRequestSchema,
  WorkplaceThreadResponseSchema,
  type WorkplaceMessagePart,
  type WorkplaceMessageRole,
  type WorkplaceMessagesResponse,
  type WorkplacePracticeSet,
  type WorkplacePracticeSetImportResponse,
  type WorkplaceSuggestion,
  type WorkplaceThreadSummary,
} from "@clipquest/contracts";
import * as Crypto from "expo-crypto";
import { apiRequest, jsonBody } from "../lib/api";

export async function fetchWorkplaceSuggestions(): Promise<
  WorkplaceSuggestion[]
> {
  const response = await apiRequest(
    "/api/workplace/suggestions",
    {},
    WorkplaceSuggestionsResponseSchema,
  );
  return response.suggestions;
}

export async function listWorkplaceThreads(): Promise<
  WorkplaceThreadSummary[]
> {
  const response = await apiRequest(
    "/api/workplace/threads",
    {},
    WorkplaceThreadListResponseSchema,
  );
  return response.threads;
}

export async function createWorkplaceThread(
  title?: string,
): Promise<WorkplaceThreadSummary> {
  const body = WorkplaceThreadCreateRequestSchema.parse(title ? { title } : {});
  const response = await apiRequest(
    "/api/workplace/threads",
    { method: "POST", body: jsonBody(body) },
    WorkplaceThreadResponseSchema,
  );
  return response.thread;
}

export async function renameWorkplaceThread(
  threadId: string,
  title: string,
): Promise<WorkplaceThreadSummary> {
  const body = WorkplaceThreadRenameRequestSchema.parse({ title });
  const response = await apiRequest(
    `/api/workplace/threads/${threadId}`,
    { method: "PATCH", body: jsonBody(body) },
    WorkplaceThreadResponseSchema,
  );
  return response.thread;
}

export async function deleteWorkplaceThread(threadId: string): Promise<void> {
  await apiRequest(
    `/api/workplace/threads/${threadId}`,
    { method: "DELETE" },
    WorkplaceThreadDeleteResponseSchema,
  );
}

export async function fetchWorkplaceMessages(
  threadId: string,
  cursor?: string | null,
  limit?: number,
): Promise<WorkplaceMessagesResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const query = params.toString();
  return apiRequest(
    `/api/workplace/threads/${threadId}/messages${query ? `?${query}` : ""}`,
    {},
    WorkplaceMessagesResponseSchema,
  );
}

export async function syncWorkplaceMessage(input: {
  threadId: string;
  clientMessageId: string;
  role: WorkplaceMessageRole;
  parts: WorkplaceMessagePart[];
}) {
  const body = WorkplaceMessageSyncRequestSchema.parse(input);
  const response = await apiRequest(
    `/api/workplace/threads/${input.threadId}/messages`,
    { method: "POST", body: jsonBody(body) },
    WorkplaceMessageSyncResponseSchema,
  );
  return response.message;
}

export async function importWorkplacePracticeSet(
  threadId: string,
  practiceSet: WorkplacePracticeSet,
): Promise<WorkplacePracticeSetImportResponse> {
  return apiRequest(
    "/api/workplace/practice-imports",
    {
      method: "POST",
      headers: { "Idempotency-Key": Crypto.randomUUID() },
      body: jsonBody({ threadId, practiceSet }),
    },
    WorkplacePracticeSetImportResponseSchema,
  );
}

export function newWorkplaceClientMessageId(): string {
  return Crypto.randomUUID();
}
