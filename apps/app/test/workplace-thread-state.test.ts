import { describe, expect, it } from "vitest";
import type {
  WorkplaceLocalChatEvent,
  WorkplaceMessage,
  WorkplaceThreadSummary,
} from "@clipquest/contracts";
import {
  applyWorkplaceChatEvent,
  cancelWorkplaceLiveMessage,
  createLiveAssistantMessage,
  formatWorkplaceTimestamp,
  liveMessageToParts,
  messageToEntries,
  messagesToChatTurns,
  removeThreadSummary,
  sortThreadsByRecency,
  threadPreviewText,
  unreadCountForThread,
  upsertThreadSummary,
  workplaceLayoutForWidth,
} from "../src/workplace/thread-state";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";

function citation(overrides: Partial<{ startMs: number; endMs: number }> = {}) {
  return {
    videoId: VIDEO_ID,
    title: "Intro to derivatives",
    startMs: overrides.startMs ?? 12_000,
    endMs: overrides.endMs ?? 18_000,
    quote: "The derivative measures instantaneous rate of change.",
  };
}

function thread(
  overrides: Partial<WorkplaceThreadSummary> = {},
): WorkplaceThreadSummary {
  return {
    id: THREAD_ID,
    title: "Calculus review",
    messageCount: 2,
    lastMessageAt: 1_000,
    createdAt: 500,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe("applyWorkplaceChatEvent", () => {
  it("accumulates streamed text deltas into a single open text entry", () => {
    let message = createLiveAssistantMessage(THREAD_ID, MESSAGE_ID);
    message = applyWorkplaceChatEvent(message, {
      type: "text_delta",
      delta: "The derivative ",
    });
    message = applyWorkplaceChatEvent(message, {
      type: "text_delta",
      delta: "is a rate of change.",
    });
    expect(message.entries).toEqual([
      {
        kind: "text",
        id: "text-0",
        text: "The derivative is a rate of change.",
        final: false,
      },
    ]);
  });

  it("closes an in-flight text segment when a tool call is requested", () => {
    let message = createLiveAssistantMessage(THREAD_ID, MESSAGE_ID);
    message = applyWorkplaceChatEvent(message, {
      type: "text_delta",
      delta: "Let me check your videos.",
    });
    message = applyWorkplaceChatEvent(message, {
      type: "tool_requested",
      toolCall: { id: "call-1", name: "search_videos", arguments: {} },
    });
    expect(message.entries).toHaveLength(2);
    expect(message.entries[0]).toMatchObject({ kind: "text", final: true });
    expect(message.entries[1]).toMatchObject({
      kind: "tool",
      id: "call-1",
      name: "search_videos",
      status: "requested",
    });
  });

  it("walks a tool call through running -> complete with citations", () => {
    let message = createLiveAssistantMessage(THREAD_ID, MESSAGE_ID);
    const events: WorkplaceLocalChatEvent[] = [
      {
        type: "tool_requested",
        toolCall: { id: "call-1", name: "search_transcript", arguments: {} },
      },
      { type: "tool_running", toolCallId: "call-1", name: "search_transcript" },
      {
        type: "tool_result",
        toolResult: {
          id: "call-1",
          name: "search_transcript",
          status: "ok",
          summary: "Found 2 matching passages.",
          citations: [citation()],
        },
      },
    ];
    for (const event of events)
      message = applyWorkplaceChatEvent(message, event);
    expect(message.entries).toHaveLength(1);
    expect(message.entries[0]).toMatchObject({
      kind: "tool",
      status: "complete",
      summary: "Found 2 matching passages.",
      citations: [citation()],
    });
  });

  it("marks a tool call errored and drops any citations", () => {
    let message = createLiveAssistantMessage(THREAD_ID, MESSAGE_ID);
    message = applyWorkplaceChatEvent(message, {
      type: "tool_requested",
      toolCall: { id: "call-1", name: "search_transcript", arguments: {} },
    });
    message = applyWorkplaceChatEvent(message, {
      type: "tool_error",
      toolCallId: "call-1",
      name: "search_transcript",
      errorCode: "timeout",
      message: "The transcript search timed out.",
    });
    expect(message.entries[0]).toMatchObject({
      kind: "tool",
      status: "error",
      summary: "The transcript search timed out.",
      citations: [],
    });
  });

  it("appends a practice-set entry and finalizes the message on complete", () => {
    let message = createLiveAssistantMessage(THREAD_ID, MESSAGE_ID);
    message = applyWorkplaceChatEvent(message, {
      type: "text_complete",
      text: "Here is a practice set.",
    });
    message = applyWorkplaceChatEvent(message, {
      type: "practice_set",
      practiceSet: {
        title: "Derivatives practice",
        mode: "practice",
        questions: [],
      } as never,
    });
    message = applyWorkplaceChatEvent(message, { type: "complete" });
    expect(message.status).toBe("complete");
    expect(message.entries.map((entry) => entry.kind)).toEqual([
      "text",
      "practice",
    ]);
  });

  it("captures the error code/message and keeps status errored through complete", () => {
    let message = createLiveAssistantMessage(THREAD_ID, MESSAGE_ID);
    message = applyWorkplaceChatEvent(message, {
      type: "error",
      code: "upstream_failure",
      message: "The model timed out.",
    });
    expect(message.status).toBe("error");
    message = applyWorkplaceChatEvent(message, { type: "complete" });
    expect(message.status).toBe("error");
    expect(message.error).toEqual({
      code: "upstream_failure",
      message: "The model timed out.",
    });
  });
});

describe("cancelWorkplaceLiveMessage", () => {
  it("closes any open text and marks the message cancelled", () => {
    let message = createLiveAssistantMessage(THREAD_ID, MESSAGE_ID);
    message = applyWorkplaceChatEvent(message, {
      type: "text_delta",
      delta: "Partial answer",
    });
    const cancelled = cancelWorkplaceLiveMessage(message);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.entries[0]).toMatchObject({ final: true });
  });
});

describe("liveMessageToParts", () => {
  it("converts a finished timeline into persisted message parts, including citations", () => {
    let message = createLiveAssistantMessage(THREAD_ID, MESSAGE_ID);
    message = applyWorkplaceChatEvent(message, {
      type: "tool_requested",
      toolCall: { id: "call-1", name: "search_transcript", arguments: {} },
    });
    message = applyWorkplaceChatEvent(message, {
      type: "tool_result",
      toolResult: {
        id: "call-1",
        name: "search_transcript",
        status: "ok",
        summary: "Found it.",
        citations: [citation()],
      },
    });
    message = applyWorkplaceChatEvent(message, {
      type: "text_complete",
      text: "The derivative is the slope of the tangent line.",
    });
    message = applyWorkplaceChatEvent(message, { type: "complete" });

    const parts = liveMessageToParts(message);
    expect(parts).toEqual([
      {
        type: "tool_status",
        tool: {
          name: "search_transcript",
          status: "complete",
          summary: "Found it.",
          citations: [citation()],
        },
      },
      { type: "citation", citation: citation() },
      {
        type: "text",
        text: "The derivative is the slope of the tangent line.",
      },
    ]);
  });

  it("drops empty text entries and falls back to a generic tool summary", () => {
    let message = createLiveAssistantMessage(THREAD_ID, MESSAGE_ID);
    message = applyWorkplaceChatEvent(message, {
      type: "tool_requested",
      toolCall: { id: "call-1", name: "lookup_mastery", arguments: {} },
    });
    message = applyWorkplaceChatEvent(message, {
      type: "tool_result",
      toolResult: {
        id: "call-1",
        name: "lookup_mastery",
        status: "ok",
        summary: "",
        citations: [],
      },
    });
    message = applyWorkplaceChatEvent(message, {
      type: "text_delta",
      delta: "  ",
    });
    message = applyWorkplaceChatEvent(message, { type: "complete" });

    const parts = liveMessageToParts(message);
    expect(parts).toEqual([
      {
        type: "tool_status",
        tool: {
          name: "lookup_mastery",
          status: "complete",
          summary: "Tool call in progress.",
          citations: [],
        },
      },
    ]);
  });
});

describe("messageToEntries", () => {
  it("mirrors a persisted message's parts back into the live entry timeline", () => {
    const message: Pick<WorkplaceMessage, "parts"> = {
      parts: [
        { type: "text", text: "Here is what I found." },
        {
          type: "tool_status",
          tool: {
            name: "search_videos",
            status: "complete",
            summary: "Found 1 video.",
            citations: [citation()],
          },
        },
      ],
    };
    const entries = messageToEntries(message);
    expect(entries).toEqual([
      {
        kind: "text",
        id: "text-0",
        text: "Here is what I found.",
        final: true,
      },
      {
        kind: "tool",
        id: "tool-1",
        name: "search_videos",
        status: "complete",
        summary: "Found 1 video.",
        citations: [citation()],
      },
    ]);
  });

  it("surfaces orphan citations as a synthetic sources trail", () => {
    const message: Pick<WorkplaceMessage, "parts"> = {
      parts: [{ type: "citation", citation: citation() }],
    };
    const entries = messageToEntries(message);
    expect(entries).toEqual([
      {
        kind: "tool",
        id: "citations",
        name: "search_transcript",
        status: "complete",
        summary: "Sources",
        citations: [citation()],
      },
    ]);
  });
});

describe("messagesToChatTurns", () => {
  function message(
    role: "user" | "assistant",
    text: string,
    index: number,
  ): WorkplaceMessage {
    return {
      id: `${MESSAGE_ID.slice(0, -1)}${index % 10}`,
      threadId: THREAD_ID,
      clientMessageId: `client-${index}`,
      role,
      parts: [{ type: "text", text }],
      createdAt: index,
    };
  }

  it("maps persisted messages to the compact chat-turn shape", () => {
    const history = [
      message("user", "Hi", 0),
      message("assistant", "Hello", 1),
    ];
    expect(messagesToChatTurns(history)).toEqual([
      { role: "user", parts: [{ type: "text", text: "Hi" }] },
      { role: "assistant", parts: [{ type: "text", text: "Hello" }] },
    ]);
  });

  it("bounds history to the most recent maxTurns messages", () => {
    const history = Array.from({ length: 20 }, (_, index) =>
      message(index % 2 === 0 ? "user" : "assistant", `msg-${index}`, index),
    );
    const turns = messagesToChatTurns(history, 5);
    expect(turns).toHaveLength(5);
    expect(turns[0]).toEqual({
      role: "assistant",
      parts: [{ type: "text", text: "msg-15" }],
    });
    expect(turns[4]).toEqual({
      role: "assistant",
      parts: [{ type: "text", text: "msg-19" }],
    });
  });
});

describe("threadPreviewText", () => {
  it("returns undefined-safe empty string for a missing message", () => {
    expect(threadPreviewText(undefined)).toBe("");
  });

  it("returns the last text part's text", () => {
    const message: WorkplaceMessage = {
      id: MESSAGE_ID,
      threadId: THREAD_ID,
      clientMessageId: "client-1",
      role: "assistant",
      parts: [
        { type: "text", text: "first" },
        { type: "text", text: "last" },
      ],
      createdAt: 1,
    };
    expect(threadPreviewText(message)).toBe("last");
  });

  it("labels a practice-set-only message generically", () => {
    const message: WorkplaceMessage = {
      id: MESSAGE_ID,
      threadId: THREAD_ID,
      clientMessageId: "client-1",
      role: "assistant",
      parts: [
        {
          type: "practice_set",
          practiceSet: {
            title: "Set",
            mode: "practice",
            questions: [],
          } as never,
        },
      ],
      createdAt: 1,
    };
    expect(threadPreviewText(message)).toBe("Practice set");
  });
});

describe("thread-list helpers", () => {
  it("sorts threads by most recent activity, falling back to updatedAt", () => {
    const older = thread({ id: "a", lastMessageAt: 100, updatedAt: 100 });
    const newer = thread({ id: "b", lastMessageAt: 900, updatedAt: 900 });
    const noMessages = thread({ id: "c", lastMessageAt: null, updatedAt: 500 });
    expect(
      sortThreadsByRecency([older, newer, noMessages]).map((t) => t.id),
    ).toEqual(["b", "c", "a"]);
  });

  it("upserts a thread summary and keeps recency order", () => {
    const original = thread({ id: "a", updatedAt: 100, lastMessageAt: 100 });
    const other = thread({ id: "b", updatedAt: 200, lastMessageAt: 200 });
    const updated = { ...original, updatedAt: 900, lastMessageAt: 900 };
    const result = upsertThreadSummary([original, other], updated);
    expect(result.map((t) => t.id)).toEqual(["a", "b"]);
    expect(result[0]?.updatedAt).toBe(900);
  });

  it("removes a thread summary by id", () => {
    const a = thread({ id: "a" });
    const b = thread({ id: "b" });
    expect(removeThreadSummary([a, b], "a")).toEqual([b]);
  });
});

describe("workplaceLayoutForWidth", () => {
  it("returns mobile below the tablet breakpoint", () => {
    expect(workplaceLayoutForWidth(400)).toBe("mobile");
  });

  it("returns tablet between the tablet and desktop breakpoints", () => {
    expect(workplaceLayoutForWidth(900)).toBe("tablet");
  });

  it("returns desktop at or above the desktop breakpoint", () => {
    expect(workplaceLayoutForWidth(1300)).toBe("desktop");
  });
});

describe("formatWorkplaceTimestamp", () => {
  it("returns 'now' for very recent timestamps", () => {
    const now = 1_700_000_000_000;
    expect(formatWorkplaceTimestamp(now - 5_000, "en-US", now)).toBe("now");
  });

  it("formats minutes/hours using Intl.RelativeTimeFormat", () => {
    const now = 1_700_000_000_000;
    expect(formatWorkplaceTimestamp(now - 5 * 60_000, "en-US", now)).toBe(
      "5 minutes ago",
    );
    expect(formatWorkplaceTimestamp(now - 3 * 60 * 60_000, "en-US", now)).toBe(
      "3 hours ago",
    );
  });
});

describe("unreadCountForThread", () => {
  it("is zero when the read count matches or exceeds the message count", () => {
    expect(unreadCountForThread({ id: "a", messageCount: 4 }, { a: 4 })).toBe(
      0,
    );
    expect(unreadCountForThread({ id: "a", messageCount: 4 }, { a: 10 })).toBe(
      0,
    );
  });

  it("counts unseen messages when the thread has never been read", () => {
    expect(unreadCountForThread({ id: "a", messageCount: 4 }, {})).toBe(4);
  });

  it("counts the delta since the thread was last read", () => {
    expect(unreadCountForThread({ id: "a", messageCount: 6 }, { a: 2 })).toBe(
      4,
    );
  });
});
