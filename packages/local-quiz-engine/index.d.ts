import type {
  AutomaticRetryKind,
  GenerationFailureCode,
  GenerationStage,
  LocalConceptQuizGenerationResult,
  LocalConceptQuizQuestionChunk,
  LocalGenerationCallEvent,
  LocalQuizContext,
  LocalAnswerGrade,
  LocalAnswerGradeRequest,
} from "@clipquest/contracts";

export type LocalEngineProgress = {
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

export type LocalQuizEngineAdapters = {
  fetch?: typeof globalThis.fetch;
  crypto?: {
    subtle: {
      digest(algorithm: "SHA-256", data: BufferSource): Promise<ArrayBuffer>;
    };
    getRandomValues<T extends ArrayBufferView>(values: T): T;
    randomUUID(): string;
  };
  /** Request one bounded JSON response instead of an SSE stream. */
  disableStreaming?: boolean;
};

export const LOCAL_GENERATION_RETRY_POLICY: {
  readonly maxTransportRetriesPerOrdinal: number;
  readonly maxContentRetriesPerOrdinal: number;
  readonly maxStructuralRetriesPerOrdinal: number;
  readonly maxAutomaticRetries: number;
  readonly maxHotRetriesPerRecoveryCycle: number;
  readonly maxActiveRecoveryMs: number;
  readonly streamIdleTimeoutMs: number;
};

export function generateLocalQuiz(
  context: LocalQuizContext,
  apiKey: string,
  onProgress?: (
    stage: GenerationStage,
    progress: number,
    detail: LocalEngineProgress,
  ) => void,
  signal?: AbortSignal,
  onQuestion?: (chunk: LocalConceptQuizQuestionChunk) => void | Promise<void>,
  onCall?: (event: LocalGenerationCallEvent) => void | Promise<void>,
  adapters?: LocalQuizEngineAdapters,
): Promise<LocalConceptQuizGenerationResult>;

export function testDeepSeekKey(
  apiKey: string,
  fetchImpl?: typeof globalThis.fetch,
): Promise<true>;
export function generateLocalCheatSheet(
  context: unknown,
  apiKey: string,
  signal?: AbortSignal,
  adapters?: LocalQuizEngineAdapters,
): Promise<{
  title: string;
  source: string;
  summary: string;
  keyConcepts: string[];
  definitions: { term: string; definition: string }[];
  formulas: string[];
  rememberThis: string[];
}>;
export function gradeLocalAnswerWithDeepSeek(
  input: LocalAnswerGradeRequest,
  apiKey: string,
  signal?: AbortSignal,
  adapters?: LocalQuizEngineAdapters,
): Promise<LocalAnswerGrade>;
