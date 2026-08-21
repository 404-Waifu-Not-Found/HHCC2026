import type {
  AutomaticRetryKind,
  GenerationFailureCode,
  GenerationStage,
  LocalConceptQuizGenerationResult,
  LocalConceptQuizQuestionChunk,
  LocalGenerationCallEvent,
  LocalQuizContext,
} from "@clipquest/contracts";

export type LocalGenerationProgress = {
  attempt?: number;
  maxAttempts?: number;
  status?: "generating" | "retrying" | "complete";
  retryDelayMs?: number;
  retryOrdinal?: number;
  ordinalAttempt?: number;
  retryKind?: AutomaticRetryKind;
  reasonCode?: GenerationFailureCode;
  recoverySessionId?: string;
};

export type LocalGenerationClientStatus =
  | { available: false }
  | {
      available: true;
      configured: boolean;
      version?: string;
      capabilities: string[];
      kind: "chrome_extension" | "android_app";
    };

export type LocalGenerationRequest = (
  context: LocalQuizContext,
  signal: AbortSignal,
  onProgress: (
    stage: GenerationStage,
    progress: number,
    detail: LocalGenerationProgress,
  ) => void,
  onQuestion?: (chunk: LocalConceptQuizQuestionChunk) => void | Promise<void>,
  onCall?: (event: LocalGenerationCallEvent) => void | Promise<void>,
) => Promise<LocalConceptQuizGenerationResult>;

export type LocalGenerationOutboxReplay = {
  questions: number;
  calls: number;
};

export type FlushLocalGenerationOutbox = (
  generationId: string,
  onQuestion: (chunk: LocalConceptQuizQuestionChunk) => void | Promise<void>,
  onCall: (event: LocalGenerationCallEvent) => void | Promise<void>,
) => Promise<LocalGenerationOutboxReplay>;

export class LocalGenerationRequestError extends Error {
  constructor(
    message: string,
    readonly reasonCode: GenerationFailureCode,
  ) {
    super(message);
  }
}
