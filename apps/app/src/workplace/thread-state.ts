// Pure, platform-free state helpers for the Workplace UI: turning a stream of
// `WorkplaceLocalChatEvent`s into a document-style timeline of text/tool/
// practice-set entries, converting a finished timeline into persisted
// message parts, and small thread-list utilities (recency ordering,
// timestamp formatting, responsive layout). Nothing here touches React or
// React Native so it can be unit tested directly.
import type {
  WorkplaceCitation,
  WorkplaceLocalChatEvent,
  WorkplaceMessage,
  WorkplaceMessagePart,
  WorkplacePracticeSet,
  WorkplaceThreadSummary,
  WorkplaceToolCallStatus,
  WorkplaceToolName,
} from "@clipquest/contracts";
import type { WorkplaceChatTurn } from "@clipquest/local-quiz-engine";
import { breakpoints } from "../theme/tokens";

export type WorkplaceLiveTextEntry = {
  kind: "text";
  id: string;
  text: string;
  final: boolean;
};

export type WorkplaceLiveToolEntry = {
  kind: "tool";
  id: string;
  name: WorkplaceToolName;
  status: WorkplaceToolCallStatus;
  summary?: string;
  citations: WorkplaceCitation[];
};

export type WorkplaceLivePracticeEntry = {
  kind: "practice";
  id: string;
  practiceSet: WorkplacePracticeSet;
};

export type WorkplaceLiveEntry =
  WorkplaceLiveTextEntry | WorkplaceLiveToolEntry | WorkplaceLivePracticeEntry;

export type WorkplaceLiveMessageStatus =
  "streaming" | "complete" | "error" | "cancelled";

export type WorkplaceLiveMessage = {
  clientMessageId: string;
  threadId: string;
  entries: WorkplaceLiveEntry[];
  status: WorkplaceLiveMessageStatus;
  error?: { code: string; message: string };
};

export function createLiveAssistantMessage(
  threadId: string,
  clientMessageId: string,
): WorkplaceLiveMessage {
  return { clientMessageId, threadId, entries: [], status: "streaming" };
}

function closeOpenText(entries: WorkplaceLiveEntry[]): WorkplaceLiveEntry[] {
  const lastIndex = entries.length - 1;
  const last = lastIndex >= 0 ? entries[lastIndex] : undefined;
  if (last?.kind === "text" && !last.final) {
    const updated = [...entries];
    updated[lastIndex] = { ...last, final: true };
    return updated;
  }
  return entries;
}

function updateToolEntry(
  entries: WorkplaceLiveEntry[],
  id: string,
  updater: (tool: WorkplaceLiveToolEntry) => WorkplaceLiveToolEntry,
): WorkplaceLiveEntry[] {
  const index = entries.findIndex(
    (entry) => entry.kind === "tool" && entry.id === id,
  );
  if (index === -1) return entries;
  const updated = [...entries];
  updated[index] = updater(entries[index] as WorkplaceLiveToolEntry);
  return updated;
}

/**
 * Fold one streamed `WorkplaceLocalChatEvent` into a live assistant message.
 * Pure: always returns a new message rather than mutating `message`.
 *
 * A `tool_requested` event always starts a new text segment even when the
 * preceding reasoning never received its own `text_complete` -- the
 * orchestrator only sends `text_complete` for the turn's final answer, so any
 * text emitted before a tool call must be closed off explicitly here to keep
 * the rendered document from re-opening a stale bubble.
 */
export function applyWorkplaceChatEvent(
  message: WorkplaceLiveMessage,
  event: WorkplaceLocalChatEvent,
): WorkplaceLiveMessage {
  const entries = message.entries;
  const lastIndex = entries.length - 1;
  const last = lastIndex >= 0 ? entries[lastIndex] : undefined;

  switch (event.type) {
    case "text_delta": {
      if (last?.kind === "text" && !last.final) {
        const updated = [...entries];
        updated[lastIndex] = { ...last, text: last.text + event.delta };
        return { ...message, entries: updated };
      }
      const entry: WorkplaceLiveTextEntry = {
        kind: "text",
        id: `text-${entries.length}`,
        text: event.delta,
        final: false,
      };
      return { ...message, entries: [...entries, entry] };
    }
    case "text_complete": {
      if (last?.kind === "text" && !last.final) {
        const updated = [...entries];
        updated[lastIndex] = { ...last, text: event.text, final: true };
        return { ...message, entries: updated };
      }
      const entry: WorkplaceLiveTextEntry = {
        kind: "text",
        id: `text-${entries.length}`,
        text: event.text,
        final: true,
      };
      return { ...message, entries: [...entries, entry] };
    }
    case "tool_requested": {
      const closed = closeOpenText(entries);
      const entry: WorkplaceLiveToolEntry = {
        kind: "tool",
        id: event.toolCall.id,
        name: event.toolCall.name,
        status: "requested",
        citations: [],
      };
      return { ...message, entries: [...closed, entry] };
    }
    case "tool_running":
      return {
        ...message,
        entries: updateToolEntry(entries, event.toolCallId, (tool) => ({
          ...tool,
          status: "running",
        })),
      };
    case "tool_result":
      return {
        ...message,
        entries: updateToolEntry(entries, event.toolResult.id, (tool) => ({
          ...tool,
          status: event.toolResult.status === "ok" ? "complete" : "error",
          summary: event.toolResult.summary,
          citations:
            event.toolResult.status === "ok" ? event.toolResult.citations : [],
        })),
      };
    case "tool_error":
      return {
        ...message,
        entries: updateToolEntry(entries, event.toolCallId, (tool) => ({
          ...tool,
          status: "error",
          summary: event.message,
          citations: [],
        })),
      };
    case "practice_set": {
      const entry: WorkplaceLivePracticeEntry = {
        kind: "practice",
        id: `practice-${entries.length}`,
        practiceSet: event.practiceSet,
      };
      return { ...message, entries: [...entries, entry] };
    }
    case "error":
      return {
        ...message,
        entries: closeOpenText(entries),
        status: "error",
        error: { code: event.code, message: event.message },
      };
    case "complete":
      return {
        ...message,
        entries: closeOpenText(entries),
        status: message.status === "error" ? "error" : "complete",
      };
    default:
      return message;
  }
}

/** Mark an in-flight message as cancelled, closing any open text segment. */
export function cancelWorkplaceLiveMessage(
  message: WorkplaceLiveMessage,
): WorkplaceLiveMessage {
  return {
    ...message,
    entries: closeOpenText(message.entries),
    status: "cancelled",
  };
}

const FALLBACK_TOOL_SUMMARY = "Tool call in progress.";

/**
 * Convert a finished live message into the bounded `WorkplaceMessagePart[]`
 * shape the server persists. Only meaningful once `message.status` is
 * `"complete"` -- callers should not sync a streaming/cancelled message.
 */
export function liveMessageToParts(
  message: WorkplaceLiveMessage,
): WorkplaceMessagePart[] {
  const parts: WorkplaceMessagePart[] = [];
  for (const entry of message.entries) {
    if (entry.kind === "text") {
      const text = entry.text.trim();
      if (text) parts.push({ type: "text", text });
    } else if (entry.kind === "tool") {
      parts.push({
        type: "tool_status",
        tool: {
          name: entry.name,
          status: entry.status,
          summary:
            entry.summary && entry.summary.trim()
              ? entry.summary
              : FALLBACK_TOOL_SUMMARY,
          citations: entry.status === "error" ? [] : entry.citations,
        },
      });
      if (entry.status !== "error") {
        for (const citation of entry.citations) {
          parts.push({ type: "citation", citation });
        }
      }
    } else {
      parts.push({ type: "practice_set", practiceSet: entry.practiceSet });
    }
  }
  return parts;
}

/** Render a persisted `WorkplaceMessage` into the same entry timeline the
 * live-streaming path produces, so history and in-flight turns share one
 * rendering component. */
export function messageToEntries(
  message: Pick<WorkplaceMessage, "parts">,
): WorkplaceLiveEntry[] {
  const entries: WorkplaceLiveEntry[] = [];
  let pendingCitations: WorkplaceCitation[] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      entries.push({
        kind: "text",
        id: `text-${entries.length}`,
        text: part.text,
        final: true,
      });
    } else if (part.type === "tool_status") {
      entries.push({
        kind: "tool",
        id: `tool-${entries.length}`,
        name: part.tool.name,
        status: part.tool.status,
        summary: part.tool.summary,
        citations: part.tool.citations,
      });
    } else if (part.type === "citation") {
      pendingCitations = [...pendingCitations, part.citation];
    } else {
      entries.push({
        kind: "practice",
        id: `practice-${entries.length}`,
        practiceSet: part.practiceSet,
      });
    }
  }
  if (pendingCitations.length && entries.length === 0) {
    // A citation part with no owning tool entry still deserves a visible
    // trail rather than being silently dropped.
    entries.push({
      kind: "tool",
      id: "citations",
      name: "search_transcript",
      status: "complete",
      summary: "Sources",
      citations: pendingCitations,
    });
  }
  return entries;
}

/** Convert persisted history into the compact `WorkplaceChatTurn[]` shape
 * `chat-client.runTurn` replays to the orchestrator for conversational
 * continuity. Bounded to the most recent `maxTurns` messages so a long
 * thread doesn't grow the request without limit. */
export function messagesToChatTurns(
  messages: readonly WorkplaceMessage[],
  maxTurns = 12,
): WorkplaceChatTurn[] {
  const recent =
    messages.length > maxTurns ? messages.slice(-maxTurns) : messages;
  return recent.map((message) => ({
    role: message.role,
    parts: message.parts as unknown as readonly Record<string, unknown>[],
  }));
}

export function threadPreviewText(
  message: WorkplaceMessage | undefined,
): string {
  if (!message) return "";
  for (let i = message.parts.length - 1; i >= 0; i -= 1) {
    const part = message.parts[i];
    if (part?.type === "text") return part.text;
    if (part?.type === "practice_set") return "Practice set";
  }
  return "";
}

export function sortThreadsByRecency(
  threads: readonly WorkplaceThreadSummary[],
): WorkplaceThreadSummary[] {
  return [...threads].sort((a, b) => {
    const aTime = a.lastMessageAt ?? a.updatedAt;
    const bTime = b.lastMessageAt ?? b.updatedAt;
    return bTime - aTime;
  });
}

export function upsertThreadSummary(
  threads: readonly WorkplaceThreadSummary[],
  updated: WorkplaceThreadSummary,
): WorkplaceThreadSummary[] {
  const others = threads.filter((thread) => thread.id !== updated.id);
  return sortThreadsByRecency([...others, updated]);
}

export function removeThreadSummary(
  threads: readonly WorkplaceThreadSummary[],
  threadId: string,
): WorkplaceThreadSummary[] {
  return threads.filter((thread) => thread.id !== threadId);
}

export type WorkplaceLayoutMode = "mobile" | "tablet" | "desktop";

/** Desktop: side-by-side rail + detail. Tablet: proportional split. Mobile:
 * rail hidden, detail fullscreen with a back button. */
export function workplaceLayoutForWidth(width: number): WorkplaceLayoutMode {
  if (width >= breakpoints.desktop) return "desktop";
  if (width >= breakpoints.tablet) return "tablet";
  return "mobile";
}

const RELATIVE_TIME_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

/** A short, locale-aware relative timestamp ("2m", "3h", "Feb 4") for a
 * thread's last-activity time. Falls back to a plain date if
 * `Intl.RelativeTimeFormat` is unavailable on the runtime. */
export function formatWorkplaceTimestamp(
  ms: number,
  locale: string,
  nowMs: number = Date.now(),
): string {
  const diffSeconds = Math.round((nowMs - ms) / 1000);
  if (diffSeconds < 45) return "now";
  if (typeof Intl.RelativeTimeFormat !== "function") {
    return new Date(ms).toLocaleDateString(locale);
  }
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, unitSeconds] of RELATIVE_TIME_UNITS) {
    if (diffSeconds >= unitSeconds || unit === "minute") {
      const value = Math.round(diffSeconds / unitSeconds);
      if (unit === "month" && value >= 11) break;
      return formatter.format(-value, unit);
    }
  }
  return new Date(ms).toLocaleDateString(locale);
}

export function unreadCountForThread(
  thread: Pick<WorkplaceThreadSummary, "id" | "messageCount">,
  readCounts: Readonly<Record<string, number>>,
): number {
  const read = readCounts[thread.id] ?? 0;
  return Math.max(0, thread.messageCount - read);
}
