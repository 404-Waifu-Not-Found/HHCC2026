import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkplaceChatEvent } from "@clipquest/local-quiz-engine";
import { mapWorkplaceOrchestratorEvent } from "../src/workplace/chat-client.types";

const appRoot = resolve(import.meta.dirname, "..");
function source(path: string) {
  return readFileSync(resolve(appRoot, path), "utf8");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("mapWorkplaceOrchestratorEvent", () => {
  it("remaps a tool_requested event's engine tool name to its synced name", () => {
    const event: WorkplaceChatEvent = {
      type: "tool_requested",
      toolCall: { id: "call-1", name: "search_library", arguments: {} },
    };
    expect(mapWorkplaceOrchestratorEvent(event)).toEqual({
      type: "tool_requested",
      toolCall: { id: "call-1", name: "search_videos", arguments: {} },
    });
  });

  it("remaps tool_running/tool_result/tool_error by their own name field", () => {
    expect(
      mapWorkplaceOrchestratorEvent({
        type: "tool_running",
        toolCallId: "call-1",
        name: "read_video_captions",
      }),
    ).toEqual({
      type: "tool_running",
      toolCallId: "call-1",
      name: "search_transcript",
    });

    expect(
      mapWorkplaceOrchestratorEvent({
        type: "tool_result",
        toolResult: {
          id: "call-1",
          name: "create_practice_set",
          status: "ok",
          summary: "Built a set.",
          citations: [],
        },
      }),
    ).toEqual({
      type: "tool_result",
      toolResult: {
        id: "call-1",
        name: "generate_practice_set",
        status: "ok",
        summary: "Built a set.",
        citations: [],
      },
    });

    expect(
      mapWorkplaceOrchestratorEvent({
        type: "tool_error",
        toolCallId: "call-1",
        name: "read_video_captions",
        errorCode: "timeout",
        message: "Timed out.",
      }),
    ).toEqual({
      type: "tool_error",
      toolCallId: "call-1",
      name: "search_transcript",
      errorCode: "timeout",
      message: "Timed out.",
    });
  });

  it("drops tool events with no synced counterpart instead of forwarding an invalid name", () => {
    expect(
      mapWorkplaceOrchestratorEvent({
        type: "tool_requested",
        toolCall: { id: "call-1", name: "read_pdf_notes", arguments: {} },
      }),
    ).toBeNull();
    expect(
      mapWorkplaceOrchestratorEvent({
        type: "tool_running",
        toolCallId: "call-1",
        name: "read_pdf_notes",
      }),
    ).toBeNull();
  });

  it("passes text/practice/error/complete events through unchanged when valid", () => {
    expect(
      mapWorkplaceOrchestratorEvent({ type: "text_delta", delta: "Hi" }),
    ).toEqual({ type: "text_delta", delta: "Hi" });
    expect(
      mapWorkplaceOrchestratorEvent({
        type: "error",
        code: "upstream_failure",
        message: "boom",
      }),
    ).toEqual({ type: "error", code: "upstream_failure", message: "boom" });
    expect(mapWorkplaceOrchestratorEvent({ type: "complete" })).toEqual({
      type: "complete",
    });
  });

  it("drops an event that fails contract validation after remapping", () => {
    expect(
      mapWorkplaceOrchestratorEvent({
        type: "tool_result",
        toolResult: {
          id: "call-1",
          name: "search_library",
          status: "ok",
          // An empty summary violates WorkplaceLocalToolResultSchema's
          // trim().min(1) bound and should be dropped rather than thrown.
          summary: "",
          citations: [],
        },
      } as unknown as WorkplaceChatEvent),
    ).toBeNull();
  });
});

describe("Workplace web chat client", () => {
  it("throws credential_required when the ClipQuest extension is not installed", async () => {
    vi.doMock("../src/transcription/clipquest-extension", () => ({
      detectClipQuestExtension: vi.fn().mockResolvedValue({ available: false }),
      isCompatibleClipQuestExtensionVersion: vi.fn().mockReturnValue(false),
      MINIMUM_WORKPLACE_CHAT_EXTENSION_VERSION: "0.8.32",
      requestExtensionWorkplaceChatTurn: vi.fn(),
      subscribeToClipQuestExtension: vi.fn(),
      supportsWorkplaceChat: vi.fn().mockReturnValue(false),
    }));
    const { runWorkplaceChatTurnOnWeb } =
      await import("../src/workplace/chat-client.web");

    await expect(
      runWorkplaceChatTurnOnWeb({ userText: "Hi" }, () => {}),
    ).rejects.toMatchObject({ code: "credential_required" });
  });

  it("throws credential_required when the extension is outdated", async () => {
    vi.doMock("../src/transcription/clipquest-extension", () => ({
      detectClipQuestExtension: vi.fn().mockResolvedValue({
        available: true,
        configured: true,
        version: "0.1.0",
        capabilities: ["workplace_chat"],
      }),
      isCompatibleClipQuestExtensionVersion: vi.fn().mockReturnValue(false),
      MINIMUM_WORKPLACE_CHAT_EXTENSION_VERSION: "0.8.32",
      requestExtensionWorkplaceChatTurn: vi.fn(),
      subscribeToClipQuestExtension: vi.fn(),
      supportsWorkplaceChat: vi.fn().mockReturnValue(true),
    }));
    const { runWorkplaceChatTurnOnWeb } =
      await import("../src/workplace/chat-client.web");

    await expect(
      runWorkplaceChatTurnOnWeb({ userText: "Hi" }, () => {}),
    ).rejects.toMatchObject({ code: "credential_required" });
  });

  it("throws credential_required when no DeepSeek key is configured", async () => {
    vi.doMock("../src/transcription/clipquest-extension", () => ({
      detectClipQuestExtension: vi.fn().mockResolvedValue({
        available: true,
        configured: false,
        version: "1.0.0",
        capabilities: ["workplace_chat"],
      }),
      isCompatibleClipQuestExtensionVersion: vi.fn().mockReturnValue(true),
      MINIMUM_WORKPLACE_CHAT_EXTENSION_VERSION: "0.8.32",
      requestExtensionWorkplaceChatTurn: vi.fn(),
      subscribeToClipQuestExtension: vi.fn(),
      supportsWorkplaceChat: vi.fn().mockReturnValue(true),
    }));
    const { runWorkplaceChatTurnOnWeb } =
      await import("../src/workplace/chat-client.web");

    await expect(
      runWorkplaceChatTurnOnWeb({ userText: "Hi" }, () => {}),
    ).rejects.toMatchObject({ code: "credential_required" });
  });

  it("forwards streamed events and returns the terminal turn summary", async () => {
    const requestExtensionWorkplaceChatTurn = vi
      .fn()
      .mockImplementation(async (_input, _signal, onEvent) => {
        onEvent({ type: "text_delta", delta: "Hi" });
        onEvent({ type: "complete" });
        return {
          finalText: "Hi there.",
          toolResults: [],
          practiceSet: null,
          stopReason: "complete",
        };
      });
    vi.doMock("../src/transcription/clipquest-extension", () => ({
      detectClipQuestExtension: vi.fn().mockResolvedValue({
        available: true,
        configured: true,
        version: "1.0.0",
        capabilities: ["workplace_chat"],
      }),
      isCompatibleClipQuestExtensionVersion: vi.fn().mockReturnValue(true),
      MINIMUM_WORKPLACE_CHAT_EXTENSION_VERSION: "0.8.32",
      requestExtensionWorkplaceChatTurn,
      subscribeToClipQuestExtension: vi.fn(),
      supportsWorkplaceChat: vi.fn().mockReturnValue(true),
    }));
    const { runWorkplaceChatTurnOnWeb } =
      await import("../src/workplace/chat-client.web");

    const onEvent = vi.fn();
    const result = await runWorkplaceChatTurnOnWeb(
      { userText: "Hi", thread: [], recentVideoIds: ["video-1"] },
      onEvent,
    );

    expect(onEvent).toHaveBeenCalledWith({ type: "text_delta", delta: "Hi" });
    expect(onEvent).toHaveBeenCalledWith({ type: "complete" });
    expect(result).toEqual({
      finalText: "Hi there.",
      toolResults: [],
      practiceSet: null,
      rounds: 1,
      toolCalls: 0,
      sourceReads: 0,
      stopReason: "complete",
    });
    expect(requestExtensionWorkplaceChatTurn).toHaveBeenCalledWith(
      { text: "Hi", thread: [], recentVideoIds: ["video-1"] },
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("Native chat-client platform aliases", () => {
  it("iOS module exposes a stable workplaceChatClient alias with sign-in/credential errors", () => {
    const ios = source("src/workplace/chat-client.ios.ts");
    expect(ios).toContain(
      "export const workplaceChatClient = iosWorkplaceChatClient;",
    );
    expect(ios).toContain('"sign_in_required"');
    expect(ios).toContain('"credential_required"');
    expect(ios).toContain("mapWorkplaceOrchestratorEvent(event)");
    expect(ios).toContain('kind: "ios_app"');
  });

  it("Android module exposes a stable workplaceChatClient alias with sign-in/credential errors", () => {
    const android = source("src/workplace/chat-client.android.ts");
    expect(android).toContain(
      "export const workplaceChatClient = androidWorkplaceChatClient;",
    );
    expect(android).toContain('"sign_in_required"');
    expect(android).toContain('"credential_required"');
    expect(android).toContain("mapWorkplaceOrchestratorEvent(event)");
    expect(android).toContain('kind: "android_app"');
  });

  it("the tsc/vitest-visible facade re-exports the web implementation", () => {
    const facade = source("src/workplace/chat-client.ts");
    expect(facade).toContain('export * from "./chat-client.web"');
  });
});
