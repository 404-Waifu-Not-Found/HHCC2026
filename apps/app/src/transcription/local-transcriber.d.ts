import type {
  LocalTranscriptionOptions,
  LocalTranscriptionResult,
  ModelStatus,
} from "./types";

export function transcribeLocally(
  options: LocalTranscriptionOptions,
): Promise<LocalTranscriptionResult>;
export function getLocalModelStatus(): Promise<ModelStatus>;
export function removeLocalModel(): Promise<boolean>;
