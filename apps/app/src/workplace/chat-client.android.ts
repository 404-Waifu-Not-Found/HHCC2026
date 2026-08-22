import { runWorkplaceChatTurn } from "@clipquest/local-quiz-engine";
import { authClient } from "../lib/auth-client";
import {
  readAndroidDeepSeekKey,
  subscribeToAndroidDeepSeekKey,
} from "../generation/android-local-ai";
import { createNativeWorkplaceToolServices } from "./native-tool-services";
import { createWorkplaceToolExecutors } from "./tool-executors";
import {
  WorkplaceChatRequestError,
  mapWorkplaceOrchestratorEvent,
  type RunWorkplaceChatTurn,
  type WorkplaceChatClient,
  type WorkplaceChatClientStatus,
} from "./chat-client.types";

export const ANDROID_WORKPLACE_CHAT_VERSION = "0.1.0";

async function signedInUserId(): Promise<string | null> {
  const result = await authClient.getSession();
  return result.data?.user.id ?? null;
}

export const runWorkplaceChatTurnOnAndroid: RunWorkplaceChatTurn = async (
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
  const apiKey = await readAndroidDeepSeekKey(userId);
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

export async function detectAndroidWorkplaceChatClient(): Promise<WorkplaceChatClientStatus> {
  const userId = await signedInUserId();
  return {
    available: true,
    configured: Boolean(userId && (await readAndroidDeepSeekKey(userId))),
    version: ANDROID_WORKPLACE_CHAT_VERSION,
    kind: "android_app",
  };
}

export function subscribeToAndroidWorkplaceChatClient(
  listener: (status: WorkplaceChatClientStatus) => void,
): () => void {
  let active = true;
  let observedUserId: string | null = null;
  void signedInUserId()
    .then((userId) => {
      observedUserId = userId;
      return detectAndroidWorkplaceChatClient();
    })
    .then((status) => {
      if (active) listener(status);
    });
  const unsubscribe = subscribeToAndroidDeepSeekKey((userId, configured) => {
    if (!active || userId !== observedUserId) return;
    listener({
      available: true,
      configured,
      version: ANDROID_WORKPLACE_CHAT_VERSION,
      kind: "android_app",
    });
  });
  return () => {
    active = false;
    unsubscribe();
  };
}

export const androidWorkplaceChatClient: WorkplaceChatClient = {
  runTurn: runWorkplaceChatTurnOnAndroid,
  detectStatus: detectAndroidWorkplaceChatClient,
  subscribeToStatus: subscribeToAndroidWorkplaceChatClient,
};

/** Platform-neutral alias every `chat-client.*` implementation exports, so
 * the UI can `import { workplaceChatClient } from "./chat-client"` without
 * caring which platform file Metro resolved. */
export const workplaceChatClient = androidWorkplaceChatClient;
