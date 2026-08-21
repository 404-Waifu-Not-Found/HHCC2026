import type { TranscriptSegment } from "@clipquest/contracts";
import { z } from "zod";

const ModelFileSchema = z.object({
  path: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const SpeechModelManifestSchema = z.object({
  version: z.literal(1),
  modelId: z.literal("whisper-tiny"),
  revision: z.string().min(7),
  web: z.object({
    repository: z.literal("onnx-community/whisper-tiny"),
    sizeBytes: z.number().int().positive(),
    files: z.array(ModelFileSchema).min(1),
  }),
  native: z.object({
    file: ModelFileSchema,
  }),
});

export type SpeechModelManifest = z.infer<typeof SpeechModelManifestSchema>;

export type TranscriptionPhase =
  "preparing_audio" | "downloading_model" | "transcribing_device";

export type LocalTranscriptionOptions = {
  ownerUserId: string;
  videoId: string;
  mediaUrl: string;
  language?: string | null;
  durationSeconds: number;
  signal: AbortSignal;
  onPhase(phase: TranscriptionPhase): void;
  onProgress(
    progress: number,
    detail?: { loadedBytes?: number; totalBytes?: number; cached?: boolean },
  ): void;
};

export type LocalTranscriptionResult = {
  language: string;
  segments: TranscriptSegment[];
};

export type ModelStatus = { cached: boolean; sizeBytes: number | null };

export class TranscriptionPausedError extends Error {
  constructor() {
    super("Transcription paused");
    this.name = "TranscriptionPausedError";
  }
}
