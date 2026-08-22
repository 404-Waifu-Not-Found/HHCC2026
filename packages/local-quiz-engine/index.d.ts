import type {
  AutomaticRetryKind,
  GenerationFailureCode,
  GenerationStage,
  LocalConceptQuizGenerationResult,
  LocalConceptQuizQuestion,
  LocalConceptQuizQuestionChunk,
  LocalGenerationCallEvent,
  LocalQuizContext,
  LocalAnswerGrade,
  LocalAnswerGradeRequest,
  WorkplaceCitation,
  WorkplacePracticePolicy,
  WorkplacePracticeSet,
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

// ---------------------------------------------------------------------------
// Workplace chat orchestration
// ---------------------------------------------------------------------------

export type WorkplaceChatToolName =
  | "search_library"
  | "read_video_captions"
  | "read_pdf_notes"
  | "create_practice_set";

export const WORKPLACE_CHAT_LIMITS: {
  readonly maxToolCallsPerTurn: number;
  readonly maxSourceReadsPerTurn: number;
  readonly maxRounds: number;
  readonly maxUserTextLength: number;
  readonly maxAssistantTextLength: number;
  readonly maxToolResultSummaryLength: number;
  readonly maxSourceExcerptLength: number;
  readonly maxSourceExcerptsPerRead: number;
  readonly maxCitationsPerToolResult: number;
  readonly maxCitationQuoteLength: number;
  readonly maxToolArgumentKeys: number;
  readonly maxToolArgumentStringLength: number;
  readonly maxToolArgumentArrayItems: number;
  readonly maxModelFacingToolContentLength: number;
  readonly maxRecentTurns: number;
  readonly maxCompactionSummaryLength: number;
  readonly maxOutputTokens: number;
  readonly practiceQuestionCount: number;
};

export const WORKPLACE_CHAT_TOOL_NAMES: readonly WorkplaceChatToolName[];
export const WORKPLACE_SOURCE_READ_TOOLS: readonly WorkplaceChatToolName[];
export const WORKPLACE_TOOL_SYNC_NAMES: Readonly<
  Record<WorkplaceChatToolName, string | null>
>;
export const WORKPLACE_SYSTEM_PROMPT: string;

export type WorkplaceSourceExcerpt = {
  videoId: string;
  title: string;
  startMs: number;
  endMs: number;
  quote: string;
};

/** A stored/compacted Workplace turn. Accepts either a plain `text` turn or a
 * sanitized WorkplaceMessagePart[] turn. */
export type WorkplaceChatTurn = {
  role?: "user" | "assistant";
  text?: string;
  parts?: ReadonlyArray<Record<string, unknown>>;
};

export type WorkplaceToolExecutorContext = {
  signal?: AbortSignal;
  recentVideoIds: string[];
};

export type WorkplaceSearchResult = {
  summary: string;
  results?: unknown;
  citations?: WorkplaceSourceExcerpt[];
};

export type WorkplaceSourceReadResult = {
  summary?: string;
  excerpts: WorkplaceSourceExcerpt[];
  transcriptComplete?: boolean;
};

export type WorkplacePracticeArtifact = {
  questions: LocalConceptQuizQuestion[];
  videoIds: string[];
  transcriptComplete: boolean;
  citations: WorkplaceSourceExcerpt[];
  rationale?: string;
  requestedPolicy?: WorkplacePracticePolicy;
};

export type WorkplaceChatTools = {
  searchLibrary?: (
    args: Record<
      string,
      string | number | boolean | Array<string | number | boolean>
    >,
    ctx: WorkplaceToolExecutorContext,
  ) => Promise<WorkplaceSearchResult> | WorkplaceSearchResult;
  readVideoCaptions?: (
    args: Record<
      string,
      string | number | boolean | Array<string | number | boolean>
    >,
    ctx: WorkplaceToolExecutorContext,
  ) => Promise<WorkplaceSourceReadResult> | WorkplaceSourceReadResult;
  readPdfNotes?: (
    args: Record<
      string,
      string | number | boolean | Array<string | number | boolean>
    >,
    ctx: WorkplaceToolExecutorContext,
  ) => Promise<WorkplaceSourceReadResult> | WorkplaceSourceReadResult;
  createPracticeSet?: (
    args: Record<
      string,
      string | number | boolean | Array<string | number | boolean>
    >,
    ctx: WorkplaceToolExecutorContext,
  ) => Promise<WorkplacePracticeArtifact> | WorkplacePracticeArtifact;
};

export type WorkplaceToolResult = {
  id: string;
  name: WorkplaceChatToolName;
  status: "ok" | "error";
  summary: string;
  citations: WorkplaceCitation[];
};

/** Streaming event shape, aligned with @clipquest/contracts
 * WorkplaceLocalChatEvent but keyed by the orchestrator's tool names so native
 * adapters can map them onto persisted tool statuses. */
export type WorkplaceChatEvent =
  | { type: "text_delta"; delta: string }
  | { type: "text_complete"; text: string }
  | {
      type: "tool_requested";
      toolCall: {
        id: string;
        name: WorkplaceChatToolName;
        arguments: Record<string, unknown>;
      };
    }
  | { type: "tool_running"; toolCallId: string; name: WorkplaceChatToolName }
  | { type: "tool_result"; toolResult: WorkplaceToolResult }
  | {
      type: "tool_error";
      toolCallId: string;
      name: string;
      errorCode: string;
      message: string;
    }
  | { type: "practice_set"; practiceSet: WorkplacePracticeSet }
  | { type: "error"; code: string; message: string }
  | { type: "complete" };

export type WorkplaceChatTurnOptions = {
  apiKey: string;
  userText: string;
  thread?: WorkplaceChatTurn[];
  tools?: WorkplaceChatTools;
  onEvent?: (event: WorkplaceChatEvent) => void | Promise<void>;
  signal?: AbortSignal;
  adapters?: LocalQuizEngineAdapters;
  recentVideoIds?: string[];
};

export type WorkplaceChatTurnResult = {
  finalText: string;
  toolResults: WorkplaceToolResult[];
  practiceSet: WorkplacePracticeSet | null;
  rounds: number;
  toolCalls: number;
  sourceReads: number;
  stopReason:
    "complete" | "tool_budget_exceeded" | "round_limit" | "aborted" | "error";
};

export type WorkplaceCompactedThread = {
  summary: string;
  recentTurns: WorkplaceChatTurn[];
  sources: { videoId: string; title?: string }[];
  intent: string;
};

export function sanitizeWorkplaceSourceText(
  text: unknown,
  maxLength?: number,
): string;
export function looksLikeCredential(value: unknown): boolean;
export function compactWorkplaceThread(
  thread: WorkplaceChatTurn[],
  options?: { maxRecentTurns?: number },
): WorkplaceCompactedThread;
export function finalizeWorkplacePracticeSet(
  artifact: WorkplacePracticeArtifact,
  requestedPolicy?: WorkplacePracticePolicy,
): { practiceSet: WorkplacePracticeSet; downgraded: boolean };
export function runWorkplaceChatTurn(
  options: WorkplaceChatTurnOptions,
): Promise<WorkplaceChatTurnResult>;
