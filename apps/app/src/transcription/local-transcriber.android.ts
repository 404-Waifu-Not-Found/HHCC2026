import type {
  LocalTranscriptionOptions,
  LocalTranscriptionResult,
  ModelStatus,
} from "./types";

const CAPTION_ONLY_MESSAGE =
  "This Android beta requires a public YouTube video with usable captions.";

export async function transcribeLocally(
  _options: LocalTranscriptionOptions,
): Promise<LocalTranscriptionResult> {
  throw new Error(CAPTION_ONLY_MESSAGE);
}

export async function getLocalModelStatus(): Promise<ModelStatus> {
  return { cached: false, sizeBytes: null };
}

export async function removeLocalModel(): Promise<boolean> {
  return false;
}
