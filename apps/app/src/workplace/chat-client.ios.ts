import { runWorkplaceChatTurn } from "@clipquest/local-quiz-engine";
import { authClient } from "../lib/auth-client";
import {
  readIosDeepSeekKey,
  subscribeToIosDeepSeekKey,
} from "../generation/ios-local-ai.ios";
import { createNativeWorkplaceToolServices } from "./native-tool-services";
import { createWorkplaceToolExecutors } from "./tool-executors";
import {
  WorkplaceChatRequestError,
  mapWorkplaceOrchestratorEvent,
  type RunWorkplaceChatTurn,
  type WorkplaceChatClient,
  type WorkplaceChatClientStatus,
} from "./chat-client.types";

export const IOS_WORKPLACE_CHAT_VERSION = "0.1.0";

async function signedInUserId(): Promise<string | null> {
  const result = await authClient.getSession();
  return result.data?.user.id ?? null;
}

export const runWorkplaceChatTurnOnIos: RunWorkplaceChatTurn = async (
  input,
  onEvent,
  signal,
) => {
  const userId = await signedInUserId();
  if (!userId) {
    throw new WorkplaceChatRequestError(
      "Sign in to use Workplace chat.",
      "sign_in_required",
    );
  }
  const apiKey = await readIosDeepSeekKey(userId);
  if (!apiKey) {
    throw new WorkplaceChatRequestError(
      "Add your DeepSeek API key in Local AI settings.",
      "credential_required",
    );
  }
  const services = createNativeWorkplaceToolServices({ userId, apiKey });
  const tools = createWorkplaceToolExecutors(services);
  return runWorkplaceChatTurn({
    apiKey,
    userText: input.userText,
    thread: input.thread,
    recentVideoIds: input.recentVideoIds,
    tools,
    signal,
    onEvent: async (event) => {
      const mapped = mapWorkplaceOrchestratorEvent(event);
      if (mapped) await onEvent(mapped);
    },
    // The Workplace completion is always a single bounded JSON response (the
    // orchestrator never opens an SSE stream), so React Native's global fetch
    // is sufficient here -- no disableStreaming flag exists on this call.
    adapters: { fetch: globalThis.fetch.bind(globalThis) },
  });
};

export async function detectIosWorkplaceChatClient(): Promise<WorkplaceChatClientStatus> {
  const userId = await signedInUserId();
  return {
    available: true,
    configured: Boolean(userId && (await readIosDeepSeekKey(userId))),
    version: IOS_WORKPLACE_CHAT_VERSION,
    kind: "ios_app",
  };
}

export function subscribeToIosWorkplaceChatClient(
  listener: (status: WorkplaceChatClientStatus) => void,
): () => void {
  let active = true;
  let observedUserId: string | null = null;
  void signedInUserId()
    .then((userId) => {
      observedUserId = userId;
      return detectIosWorkplaceChatClient();
    })
    .then((status) => {
      if (active) listener(status);
    });
  const unsubscribe = subscribeToIosDeepSeekKey((userId, configured) => {
    if (!active || userId !== observedUserId) return;
    listener({
      available: true,
      configured,
      version: IOS_WORKPLACE_CHAT_VERSION,
      kind: "ios_app",
    });
  });
  return () => {
    active = false;
    unsubscribe();
  };
}

export const iosWorkplaceChatClient: WorkplaceChatClient = {
  runTurn: runWorkplaceChatTurnOnIos,
  detectStatus: detectIosWorkplaceChatClient,
  subscribeToStatus: subscribeToIosWorkplaceChatClient,
};
