// Web (Chrome extension) implementation of the shared `WorkplaceChatClient`
// contract. Mirrors `chat-client.ios.ts` / `chat-client.android.ts`: the
// DeepSeek key never enters this module, it only ever bridges the learner's
// prompt/thread to the local ClipQuest extension and relays back sanitized
// `WorkplaceLocalChatEvent`s plus the terminal turn summary.
import type { WorkplacePracticeSet } from "@clipquest/contracts";
import type { WorkplaceToolResult } from "@clipquest/local-quiz-engine";
import {
  detectClipQuestExtension,
  isCompatibleClipQuestExtensionVersion,
  MINIMUM_WORKPLACE_CHAT_EXTENSION_VERSION,
  requestExtensionWorkplaceChatTurn,
  subscribeToClipQuestExtension,
  supportsWorkplaceChat,
} from "../transcription/clipquest-extension";
import {
  WorkplaceChatRequestError,
  type RunWorkplaceChatTurn,
  type WorkplaceChatClient,
  type WorkplaceChatClientStatus,
  type WorkplaceChatTurnResult,
} from "./chat-client.types";

function isCompatibleAndConfigured(
  version: string | undefined,
  capabilities: readonly string[],
  configured: boolean,
): boolean {
  return (
    configured &&
    isCompatibleClipQuestExtensionVersion(
      version,
      MINIMUM_WORKPLACE_CHAT_EXTENSION_VERSION,
    ) &&
    supportsWorkplaceChat(capabilities)
  );
}

export const runWorkplaceChatTurnOnWeb: RunWorkplaceChatTurn = async (
  input,
  onEvent,
  signal,
) => {
  const extension = await detectClipQuestExtension();
  if (!extension.available) {
    throw new WorkplaceChatRequestError(
      "Install the ClipQuest browser extension to use Workplace chat.",
      "credential_required",
    );
  }
  if (
    !isCompatibleClipQuestExtensionVersion(
      extension.version,
      MINIMUM_WORKPLACE_CHAT_EXTENSION_VERSION,
    ) ||
    !supportsWorkplaceChat(extension.capabilities)
  ) {
    throw new WorkplaceChatRequestError(
      `Update the ClipQuest browser extension to ${MINIMUM_WORKPLACE_CHAT_EXTENSION_VERSION} or newer to use Workplace chat.`,
      "credential_required",
    );
  }
  if (!extension.configured) {
    throw new WorkplaceChatRequestError(
      "Add your DeepSeek API key in the ClipQuest extension to use Workplace chat.",
      "credential_required",
    );
  }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    const summary = await requestExtensionWorkplaceChatTurn(
      {
        text: input.userText,
        thread: input.thread,
        recentVideoIds: input.recentVideoIds,
      },
      controller.signal,
      (event) => void onEvent(event),
    );
    const toolResults: WorkplaceToolResult[] = Array.isArray(
      summary.toolResults,
    )
      ? (summary.toolResults as WorkplaceToolResult[])
      : [];
    const stopReason = (
      typeof summary.stopReason === "string" ? summary.stopReason : "complete"
    ) as WorkplaceChatTurnResult["stopReason"];
    return {
      finalText: summary.finalText,
      toolResults,
      practiceSet: (summary.practiceSet as WorkplacePracticeSet | null) ?? null,
      // The extension bridge only returns the terminal summary, not the
      // orchestrator's internal round/tool-call bookkeeping -- these counts
      // are informational only and are not read by the UI.
      rounds: 1,
      toolCalls: toolResults.length,
      sourceReads: 0,
      stopReason,
    };
  } finally {
    signal?.removeEventListener("abort", forwardAbort);
  }
};

export async function detectWebWorkplaceChatClient(): Promise<WorkplaceChatClientStatus> {
  const extension = await detectClipQuestExtension();
  if (!extension.available) return { available: false };
  return {
    available: true,
    configured: isCompatibleAndConfigured(
      extension.version,
      extension.capabilities,
      extension.configured,
    ),
    version: extension.version,
    kind: "chrome_extension",
  };
}

export function subscribeToWebWorkplaceChatClient(
  listener: (status: WorkplaceChatClientStatus) => void,
): () => void {
  return subscribeToClipQuestExtension((status) => {
    listener({
      available: true,
      configured: isCompatibleAndConfigured(
        status.version,
        status.capabilities,
        status.configured,
      ),
      version: status.version,
      kind: "chrome_extension",
    });
  });
}

export const webWorkplaceChatClient: WorkplaceChatClient = {
  runTurn: runWorkplaceChatTurnOnWeb,
  detectStatus: detectWebWorkplaceChatClient,
  subscribeToStatus: subscribeToWebWorkplaceChatClient,
};

/** Platform-neutral alias every `chat-client.*` implementation exports, so
 * the UI can `import { workplaceChatClient } from "./chat-client"` without
 * caring which platform file Metro resolved. */
export const workplaceChatClient = webWorkplaceChatClient;
