import {
  GenerationFailureCodeSchema,
  LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  LocalConceptQuizGenerationResultSchema,
  LocalConceptQuizQuestionChunkSchema,
  LocalGenerationCallEventSchema,
  LocalQuizContextSchema,
  CheatSheetContextSchema,
  CheatSheetDocumentSchema,
  LocalAnswerGradeRequestSchema,
  LocalAnswerGradeSchema,
} from "@clipquest/contracts";
import {
  generateLocalQuiz,
  generateLocalCheatSheet,
  gradeLocalAnswerWithDeepSeek,
  testDeepSeekKey,
} from "@clipquest/local-quiz-engine";
import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";
import { router } from "expo-router";
import { authClient } from "../lib/auth-client";
import {
  appendAndroidGenerationOutboxEntry,
  removeAndroidGenerationOutboxEntry,
  replayAndroidGenerationOutbox,
} from "./android-generation-outbox";
import {
  readAndroidDeepSeekKey,
  removeAndroidDeepSeekKey,
  saveAndroidDeepSeekKey,
  subscribeToAndroidDeepSeekKey,
} from "./android-local-ai";
import {
  LocalGenerationRequestError,
  type LocalGenerationClientStatus,
  type LocalGenerationRequest,
} from "./local-generation-client.types";
import { createLocalCrypto } from "./local-crypto";

export {
  LocalGenerationRequestError,
  type LocalGenerationProgress,
} from "./local-generation-client.types";

export const ANDROID_LOCAL_AI_VERSION = "0.2.0";

function androidClientMetadata() {
  return {
    kind: "android_app" as const,
    version: Constants.expoConfig?.version ?? ANDROID_LOCAL_AI_VERSION,
    capability: LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY,
  };
}

async function signedInUserId(): Promise<string | null> {
  const result = await authClient.getSession();
  return result.data?.user.id ?? null;
}

export const requestLocalQuiz: LocalGenerationRequest = async (
  rawContext,
  signal,
  onProgress,
  onQuestion = () => undefined,
  onCall = () => undefined,
) => {
  const context = LocalQuizContextSchema.parse(rawContext);
  const userId = await signedInUserId();
  if (!userId) {
    throw new LocalGenerationRequestError(
      "Sign in before generating a quiz.",
      "credential_required",
    );
  }
  const apiKey = await readAndroidDeepSeekKey(userId);
  if (!apiKey) {
    throw new LocalGenerationRequestError(
      "Add your DeepSeek API key in Local AI settings.",
      "credential_required",
    );
  }
  const localCrypto = createLocalCrypto([
    userId,
    context.generationId ?? context.jobId,
    context.generationSessionId ?? "generation-session",
    context.recoverySessionId ?? "recovery-session",
    context.transcriptFingerprint,
  ]);
  try {
    const generationId = context.generationId ?? context.jobId;
    const result = await generateLocalQuiz(
      context,
      apiKey,
      onProgress,
      signal,
      async (value) => {
        const chunk = LocalConceptQuizQuestionChunkSchema.parse({
          ...value,
          client: androidClientMetadata(),
        });
        const id = `question:${chunk.startIndex}`;
        await appendAndroidGenerationOutboxEntry(userId, generationId, {
          id,
          kind: "question",
          value: chunk,
        });
        await onQuestion(chunk);
        await removeAndroidGenerationOutboxEntry(userId, generationId, id);
      },
      async (value) => {
        const event = LocalGenerationCallEventSchema.parse({
          ...value,
          client: androidClientMetadata(),
        });
        const id = `call:${event.generationSessionId}:${event.callIndex}:${"lifecycleState" in event ? event.lifecycleState : "completed"}`;
        await appendAndroidGenerationOutboxEntry(userId, generationId, {
          id,
          kind: "call",
          value: event,
        });
        await onCall(event);
        await removeAndroidGenerationOutboxEntry(userId, generationId, id);
      },
      {
        // Use the completed JSON response exposed by React Native's global
        // fetch. Expo fetch's body bridge can reject a successful DeepSeek
        // response before the first question reaches the learner.
        fetch: globalThis.fetch.bind(globalThis),
        crypto: localCrypto,
        // Android's native fetch bridge can leave an SSE body open without
        // delivering the first chunk. Use the bounded JSON envelope on this
        // platform so the AI-generated bank either arrives or times out as a
        // normal request; no fallback generator is introduced.
        disableStreaming: true,
      },
    );
    return LocalConceptQuizGenerationResultSchema.parse({
      ...result,
      client: androidClientMetadata(),
    });
  } catch (cause) {
    if (cause instanceof LocalGenerationRequestError) throw cause;
    const reasonCode = GenerationFailureCodeSchema.safeParse(
      (cause as { reasonCode?: unknown } | null)?.reasonCode,
    ).data;
    if (reasonCode) {
      throw new LocalGenerationRequestError(
        cause instanceof Error ? cause.message : "Local generation failed.",
        reasonCode,
      );
    }
    throw cause;
  }
};

export async function requestLocalCheatSheet(
  rawContext: import("@clipquest/contracts").CheatSheetContext,
  signal?: AbortSignal,
) {
  const context = CheatSheetContextSchema.parse(rawContext);
  const userId = await signedInUserId();
  if (!userId)
    throw new LocalGenerationRequestError(
      "Sign in before generating notes.",
      "credential_required",
    );
  const apiKey = await readAndroidDeepSeekKey(userId);
  if (!apiKey)
    throw new LocalGenerationRequestError(
      "Add your DeepSeek API key in Local AI settings.",
      "credential_required",
    );
  const localCrypto = createLocalCrypto([
    userId,
    context.videoId,
    context.quizId ?? "",
    context.sourceRevision,
  ]);
  const document = await generateLocalCheatSheet(context, apiKey, signal, {
    fetch: expoFetch as unknown as typeof fetch,
    crypto: localCrypto,
  });
  return CheatSheetDocumentSchema.parse({
    ...document,
    generatedAt: new Date().toISOString(),
    sourceRevision: context.sourceRevision,
  });
}

export async function requestLocalAnswerGrade(
  rawRequest: import("@clipquest/contracts").LocalAnswerGradeRequest,
  signal?: AbortSignal,
) {
  const request = LocalAnswerGradeRequestSchema.parse(rawRequest);
  const userId = await signedInUserId();
  if (!userId)
    throw new LocalGenerationRequestError(
      "Sign in before grading answers.",
      "credential_required",
    );
  const apiKey = await readAndroidDeepSeekKey(userId);
  if (!apiKey)
    throw new LocalGenerationRequestError(
      "Add your DeepSeek API key in Local AI settings.",
      "credential_required",
    );
  const localCrypto = createLocalCrypto([
    userId,
    request.questionType,
    request.question,
  ]);
  const result = await gradeLocalAnswerWithDeepSeek(request, apiKey, signal, {
    fetch: expoFetch as unknown as typeof fetch,
    crypto: localCrypto,
  });
  return LocalAnswerGradeSchema.parse(result);
}

export const flushLocalGenerationOutbox: import("./local-generation-client.types").FlushLocalGenerationOutbox =
  async (generationId, onQuestion, onCall) => {
    const userId = await signedInUserId();
    if (!userId) return { questions: 0, calls: 0 };
    return replayAndroidGenerationOutbox(
      userId,
      generationId,
      onQuestion,
      onCall,
    );
  };

export async function detectLocalGenerationClient(): Promise<LocalGenerationClientStatus> {
  const userId = await signedInUserId();
  return {
    available: true,
    configured: Boolean(userId && (await readAndroidDeepSeekKey(userId))),
    version: ANDROID_LOCAL_AI_VERSION,
    capabilities: [LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY],
    kind: "android_app",
  };
}

export function subscribeToLocalGenerationClient(
  listener: (status: LocalGenerationClientStatus) => void,
): () => void {
  let active = true;
  let observedUserId: string | null = null;
  void signedInUserId()
    .then((userId) => {
      observedUserId = userId;
      return detectLocalGenerationClient();
    })
    .then((status) => {
      if (active) listener(status);
    });
  const unsubscribe = subscribeToAndroidDeepSeekKey((userId, configured) => {
    if (!active || userId !== observedUserId) return;
    listener({
      available: true,
      configured,
      version: ANDROID_LOCAL_AI_VERSION,
      capabilities: [LOCAL_QUIZ_QUESTION_STREAM_CAPABILITY],
      kind: "android_app",
    });
  });
  return () => {
    active = false;
    unsubscribe();
  };
}

export function openLocalGenerationClientSettings(): void {
  router.push("/local-ai" as never);
}

export async function testAndroidDeepSeekKey(apiKey: string): Promise<true> {
  return testDeepSeekKey(
    apiKey,
    expoFetch as unknown as typeof globalThis.fetch,
  );
}

export async function configureLocalGenerationCredential(
  userId: string,
  apiKey: string,
): Promise<void> {
  const normalized = apiKey.trim();
  if (normalized.length < 10 || normalized.length > 512) {
    throw new Error("Enter a valid DeepSeek API key.");
  }
  await testAndroidDeepSeekKey(normalized);
  await saveAndroidDeepSeekKey(userId, normalized);
}

export async function removeLocalGenerationCredential(
  userId: string,
): Promise<void> {
  await removeAndroidDeepSeekKey(userId);
}
