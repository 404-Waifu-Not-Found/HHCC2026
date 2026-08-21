// Shared TypeScript contract for the native Workplace chat client.
//
// iOS and Android each implement `WorkplaceChatClient` (see
// `chat-client.android.ts` / `chat-client.ios.ts`) by wiring the account-scoped
// SecureStore DeepSeek key into the platform-free `runWorkplaceChatTurn`
// orchestrator from `@clipquest/local-quiz-engine`. This module owns:
//   * the client-facing types both platforms conform to,
//   * the credential-required error both platforms throw, and
//   * the pure event adapter that turns the orchestrator's engine-keyed
//     events into the contract-validated `WorkplaceLocalChatEvent` shape a
//     synced Workplace thread understands.
//
// The DeepSeek key itself never appears here: this module only shapes status,
// requests, and events, never a credential.

import {
  WorkplaceLocalChatEventSchema,
  type WorkplaceLocalChatEvent,
} from "@clipquest/contracts";
import {
  WORKPLACE_TOOL_SYNC_NAMES,
  type WorkplaceChatEvent as EngineWorkplaceChatEvent,
  type WorkplaceChatTurn,
  type WorkplaceChatTurnResult as EngineWorkplaceChatTurnResult,
} from "@clipquest/local-quiz-engine";

export type WorkplaceChatClientKind =
  | "android_app"
  | "ios_app"
  | "chrome_extension";

export type WorkplaceChatClientStatus =
  | { available: false }
  | {
      available: true;
      configured: boolean;
      kind: WorkplaceChatClientKind;
      version?: string;
    };

export type WorkplaceChatTurnInput = {
  userText: string;
  thread?: WorkplaceChatTurn[];
  recentVideoIds?: string[];
};

/** Re-exported verbatim: the orchestrator's own per-turn result summary. */
export type WorkplaceChatTurnResult = EngineWorkplaceChatTurnResult;

export type WorkplaceChatEventListener = (
  event: WorkplaceLocalChatEvent,
) => void | Promise<void>;

export type RunWorkplaceChatTurn = (
  input: WorkplaceChatTurnInput,
  onEvent: WorkplaceChatEventListener,
  signal?: AbortSignal,
) => Promise<WorkplaceChatTurnResult>;

export type WorkplaceChatClient = {
  runTurn: RunWorkplaceChatTurn;
  detectStatus: () => Promise<WorkplaceChatClientStatus>;
  subscribeToStatus: (
    listener: (status: WorkplaceChatClientStatus) => void,
  ) => () => void;
};

export type WorkplaceChatRequestErrorCode =
  | "sign_in_required"
  | "credential_required";

/** Thrown before any DeepSeek call when the learner cannot run a Workplace
 * turn yet -- mirrors `LocalGenerationRequestError`'s Local AI UX so the same
 * "sign in" / "add your DeepSeek key" messaging applies. */
export class WorkplaceChatRequestError extends Error {
  constructor(
    message: string,
    readonly code: WorkplaceChatRequestErrorCode,
  ) {
    super(message);
    this.name = "WorkplaceChatRequestError";
  }
}

function toolSyncName(name: string): string | null {
  return (
    (WORKPLACE_TOOL_SYNC_NAMES as Record<string, string | null | undefined>)[
      name
    ] ?? null
  );
}

/**
 * Adapt one orchestrator-emitted event (keyed by the engine's own tool names,
 * e.g. `read_video_captions`) into the contract-validated
 * `WorkplaceLocalChatEvent` shape (keyed by the synced tool names, e.g.
 * `search_transcript`) a persisted Workplace thread understands.
 *
 * Tools with no sync counterpart (`read_pdf_notes` maps to `null` in
 * `WORKPLACE_TOOL_SYNC_NAMES`) are intentionally dropped here rather than
 * forwarded with an invalid or misleading name -- the model still receives
 * that tool's sanitized content during the turn, it is simply never
 * represented as its own synced event. Any event that still fails schema
 * validation after remapping is dropped rather than thrown, so a single
 * unexpected shape cannot crash an otherwise-successful turn.
 */
export function mapWorkplaceOrchestratorEvent(
  event: EngineWorkplaceChatEvent,
): WorkplaceLocalChatEvent | null {
  let candidate: unknown = event;
  switch (event.type) {
    case "tool_requested": {
      const syncName = toolSyncName(event.toolCall.name);
      if (!syncName) return null;
      candidate = {
        type: event.type,
        toolCall: { ...event.toolCall, name: syncName },
      };
      break;
    }
    case "tool_running": {
      const syncName = toolSyncName(event.name);
      if (!syncName) return null;
      candidate = { ...event, name: syncName };
      break;
    }
    case "tool_result": {
      const syncName = toolSyncName(event.toolResult.name);
      if (!syncName) return null;
      candidate = {
        type: event.type,
        toolResult: { ...event.toolResult, name: syncName },
      };
      break;
    }
    case "tool_error": {
      const syncName = toolSyncName(event.name);
      if (!syncName) return null;
      candidate = { ...event, name: syncName };
      break;
    }
    default:
      break;
  }
  const parsed = WorkplaceLocalChatEventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
