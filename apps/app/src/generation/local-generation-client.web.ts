import {
  detectClipQuestExtension,
  openClipQuestExtensionSettings,
  requestExtensionLocalQuiz,
  requestExtensionLocalCheatSheet,
  subscribeToClipQuestExtension,
} from "../transcription/clipquest-extension";
import type {
  FlushLocalGenerationOutbox,
  LocalGenerationClientStatus,
  LocalGenerationRequest,
} from "./local-generation-client.types";
import type { CheatSheetContext } from "@clipquest/contracts";

export {
  LocalGenerationRequestError,
  type LocalGenerationProgress,
} from "./local-generation-client.types";

export const requestLocalQuiz: LocalGenerationRequest =
  requestExtensionLocalQuiz;

export async function requestLocalCheatSheet(
  context: CheatSheetContext,
  signal?: AbortSignal,
): Promise<import("@clipquest/contracts").CheatSheetDocument> {
  return requestExtensionLocalCheatSheet(context, signal);
}

export const flushLocalGenerationOutbox: FlushLocalGenerationOutbox = async (
  _generationId,
  _onQuestion,
  _onCall,
) => {
  return { questions: 0, calls: 0 };
};

export async function detectLocalGenerationClient(): Promise<LocalGenerationClientStatus> {
  const status = await detectClipQuestExtension();
  return status.available
    ? { ...status, kind: "chrome_extension" }
    : { available: false };
}

export function subscribeToLocalGenerationClient(
  listener: (status: LocalGenerationClientStatus) => void,
): () => void {
  return subscribeToClipQuestExtension((status) =>
    listener({ ...status, available: true, kind: "chrome_extension" }),
  );
}

export function openLocalGenerationClientSettings(): void {
  openClipQuestExtensionSettings();
}

export async function configureLocalGenerationCredential(
  _userId: string,
  _apiKey: string,
): Promise<void> {
  openClipQuestExtensionSettings();
}

export async function removeLocalGenerationCredential(
  _userId: string,
): Promise<void> {}
