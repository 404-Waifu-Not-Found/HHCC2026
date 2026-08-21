import {
  detectClipQuestExtension,
  openClipQuestExtensionSettings,
  requestExtensionLocalQuiz,
  subscribeToClipQuestExtension,
} from "../transcription/clipquest-extension";
import type {
  FlushLocalGenerationOutbox,
  LocalGenerationClientStatus,
  LocalGenerationRequest,
} from "./local-generation-client.types";

export {
  LocalGenerationRequestError,
  type LocalGenerationProgress,
} from "./local-generation-client.types";

export const requestLocalQuiz: LocalGenerationRequest =
  requestExtensionLocalQuiz;

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
): Promise<void> {
  openClipQuestExtensionSettings();
}
