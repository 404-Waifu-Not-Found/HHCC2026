import {
  DEFAULT_QUIZ_QUESTION_TYPES,
  GenerationRecordV2Schema,
  LanguageSchema,
  QuizQuestionTypesSchema,
  VideoImportResponseSchema,
  type AppLanguage,
  type GenerationRecordV2,
  type LocalGenerationProfile,
  type LocalQuestionPlan,
  type QuizQuestionType,
  type SessionLength,
  type VideoImportResponse,
} from "@clipquest/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";

const keyFor = (videoId: string) => `clipquest:creation:${videoId}`;
const generationKeyFor = (videoId: string) => `clipquest:generation:${videoId}`;
const generationV2KeyFor = (generationId: string) =>
  `clipquest:generation:v2:${generationId}`;
const attemptGenerationKeyFor = (attemptId: string) =>
  `clipquest:generation-attempt:v2:${attemptId}`;
const preferencesKeyFor = (videoId: string) =>
  `clipquest:preferences:${videoId}`;
const TRANSCRIPT_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const GENERATION_RECORD_HEARTBEAT_TIMEOUT_MS = 15_000;

export type QuestPreferences = {
  quizLanguage: AppLanguage;
  questionTypes: QuizQuestionType[];
};

export type StoredGeneration = {
  idempotencyKey: string;
  jobId?: string;
  quizLanguage?: AppLanguage;
  questionTypes?: QuizQuestionType[];
  sessionLength?: SessionLength;
  watched?: boolean;
  quizId?: string;
  attemptId?: string;
  acceptedCount?: number;
  plannedCount?: 5 | 10 | 15;
  preworkStatus?: "running" | "ready" | "unavailable" | "failed";
};

type ImportedVideoCacheV2 = {
  version: 2;
  cachedAt: number;
  expiresAt: number;
  value: VideoImportResponse;
};

export async function saveImportedVideo(
  value: VideoImportResponse,
): Promise<void> {
  const parsed = VideoImportResponseSchema.parse(value);
  const cachedAt = Date.now();
  const cache: ImportedVideoCacheV2 = {
    version: 2,
    cachedAt,
    expiresAt: cachedAt + TRANSCRIPT_CACHE_TTL_MS,
    value: parsed,
  };
  await AsyncStorage.setItem(keyFor(parsed.video.id), JSON.stringify(cache));
}

export async function loadImportedVideo(
  videoId: string,
): Promise<VideoImportResponse | null> {
  const value = await AsyncStorage.getItem(keyFor(videoId));
  if (!value) return null;
  try {
    const parsedValue = JSON.parse(value) as
      | ImportedVideoCacheV2
      | (Partial<VideoImportResponse> & {
          video?: Partial<VideoImportResponse["video"]>;
          captions?: Partial<VideoImportResponse["captions"]>;
        });
    if (
      "version" in parsedValue &&
      parsedValue.version === 2 &&
      "value" in parsedValue
    ) {
      if (
        !Number.isFinite(parsedValue.expiresAt) ||
        parsedValue.expiresAt <= Date.now()
      ) {
        await AsyncStorage.removeItem(keyFor(videoId));
        return null;
      }
      return VideoImportResponseSchema.parse(parsedValue.value);
    }
    const stored = parsedValue as Partial<VideoImportResponse> & {
      video?: Partial<VideoImportResponse["video"]>;
      captions?: Partial<VideoImportResponse["captions"]>;
    };
    const hasCaptions = Boolean(stored.captions?.preferredSegments?.length);
    return VideoImportResponseSchema.parse({
      ...stored,
      transcriptionMode:
        stored.transcriptionMode ?? (hasCaptions ? "captions" : "device_media"),
      capture:
        stored.capture ??
        ({
          expectedDurationSeconds: stored.video?.durationSeconds ?? 0,
          requiresUserGesture: false,
        } satisfies VideoImportResponse["capture"]),
    });
  } catch {
    await AsyncStorage.removeItem(keyFor(videoId));
    return null;
  }
}

export async function clearImportedVideo(videoId: string): Promise<void> {
  await AsyncStorage.multiRemove([keyFor(videoId), preferencesKeyFor(videoId)]);
}

export async function saveQuestPreferences(
  videoId: string,
  value: QuestPreferences,
): Promise<void> {
  const parsed = {
    quizLanguage: LanguageSchema.parse(value.quizLanguage),
    questionTypes: QuizQuestionTypesSchema.parse(value.questionTypes),
  };
  await AsyncStorage.setItem(
    preferencesKeyFor(videoId),
    JSON.stringify(parsed),
  );
}

export async function loadQuestPreferences(
  videoId: string,
): Promise<QuestPreferences> {
  const raw = await AsyncStorage.getItem(preferencesKeyFor(videoId));
  if (!raw) {
    return {
      quizLanguage: "en",
      questionTypes: [...DEFAULT_QUIZ_QUESTION_TYPES],
    };
  }
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      quizLanguage: LanguageSchema.parse(value.quizLanguage),
      questionTypes: QuizQuestionTypesSchema.parse(value.questionTypes),
    };
  } catch {
    await AsyncStorage.removeItem(preferencesKeyFor(videoId));
    return {
      quizLanguage: "en",
      questionTypes: [...DEFAULT_QUIZ_QUESTION_TYPES],
    };
  }
}

export async function saveGenerationRecord(
  value: GenerationRecordV2,
): Promise<GenerationRecordV2> {
  const parsed = GenerationRecordV2Schema.parse(value);
  await AsyncStorage.setItem(
    generationV2KeyFor(parsed.generationId),
    JSON.stringify(parsed),
  );
  if (parsed.attemptId) {
    await AsyncStorage.setItem(
      attemptGenerationKeyFor(parsed.attemptId),
      parsed.generationId,
    );
  }
  return parsed;
}

export async function loadGenerationRecord(
  generationId: string,
): Promise<GenerationRecordV2 | null> {
  if (!isUuid(generationId)) return null;
  const raw = await AsyncStorage.getItem(generationV2KeyFor(generationId));
  if (!raw) return null;
  try {
    return GenerationRecordV2Schema.parse(JSON.parse(raw));
  } catch {
    await AsyncStorage.removeItem(generationV2KeyFor(generationId));
    return null;
  }
}

export async function updateGenerationRecord(
  generationId: string,
  update: Partial<GenerationRecordV2>,
): Promise<GenerationRecordV2 | null> {
  const current = await loadGenerationRecord(generationId);
  if (!current) return null;
  return saveGenerationRecord({
    ...current,
    ...update,
    generationId: current.generationId,
    version: 2,
    updatedAt: Date.now(),
  });
}

export function generationRecordHasLiveHeartbeat(
  record: GenerationRecordV2,
  timestamp = Date.now(),
): boolean {
  return (
    (record.state === "generating" || record.state === "retrying") &&
    record.updatedAt + GENERATION_RECORD_HEARTBEAT_TIMEOUT_MS > timestamp
  );
}

export function startGenerationRecordHeartbeat(
  generationId: string,
): () => void {
  let active = true;
  const heartbeat = () => {
    if (!active) return;
    void updateGenerationRecord(generationId, {}).catch(() => undefined);
  };
  heartbeat();
  const timer = setInterval(heartbeat, 4_000);
  return () => {
    active = false;
    clearInterval(timer);
  };
}

export async function loadGenerationRecordForAttempt(
  attemptId: string,
): Promise<GenerationRecordV2 | null> {
  if (!isUuid(attemptId)) return null;
  const generationId = await AsyncStorage.getItem(
    attemptGenerationKeyFor(attemptId),
  );
  return generationId ? loadGenerationRecord(generationId) : null;
}

export async function bindAttemptToGeneration(
  generationId: string,
  attemptId: string,
  quizId: string,
): Promise<GenerationRecordV2 | null> {
  if (!isUuid(attemptId) || !isUuid(quizId)) return null;
  return updateGenerationRecord(generationId, { attemptId, quizId });
}

export async function clearGenerationRecord(
  generationId: string,
): Promise<void> {
  const current = await loadGenerationRecord(generationId);
  await AsyncStorage.multiRemove([
    generationV2KeyFor(generationId),
    ...(current?.attemptId ? [attemptGenerationKeyFor(current.attemptId)] : []),
  ]);
}

export async function migrateLegacyGenerationRecord(input: {
  videoId: string;
  expectedQuizId: string;
  expectedAttemptId: string;
  ownerUserId: string;
  generationId: string;
  generationSessionId: string;
  plannedCount: 5 | 10 | 15;
  acceptedCount: number;
  sessionLength: SessionLength;
  quizLanguage: AppLanguage;
  questionTypes: QuizQuestionType[];
  watched: boolean;
  generationProfile?: LocalGenerationProfile;
  questionPlan?: LocalQuestionPlan;
}): Promise<GenerationRecordV2 | null> {
  const legacy = await loadGenerationState(input.videoId);
  if (
    !legacy?.quizId ||
    legacy.quizId !== input.expectedQuizId ||
    !isUuid(legacy.idempotencyKey) ||
    (legacy.attemptId !== undefined &&
      legacy.attemptId !== input.expectedAttemptId)
  ) {
    return null;
  }
  const timestamp = Date.now();
  const migrated = await saveGenerationRecord({
    version: 2,
    generationId: input.generationId,
    generationSessionId: input.generationSessionId,
    idempotencyKey: legacy.idempotencyKey,
    ownerUserId: input.ownerUserId,
    videoId: input.videoId,
    quizLanguage: input.quizLanguage,
    questionTypes: input.questionTypes,
    sessionLength: input.sessionLength,
    watched: input.watched,
    generationProfile: input.generationProfile,
    questionPlan: input.questionPlan,
    quizId: input.expectedQuizId,
    attemptId: input.expectedAttemptId,
    acceptedCount: Math.max(
      0,
      Math.min(input.acceptedCount, input.plannedCount),
    ),
    plannedCount: input.plannedCount,
    state: "retry_required",
    nextCallIndex: 0,
    preworkStatus: legacy.preworkStatus,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await AsyncStorage.removeItem(generationKeyFor(input.videoId));
  return migrated;
}

export async function loadGenerationState(
  videoId: string,
): Promise<StoredGeneration | null> {
  const raw = await AsyncStorage.getItem(generationKeyFor(videoId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredGeneration>;
    if (
      typeof value.idempotencyKey !== "string" ||
      (value.jobId !== undefined && typeof value.jobId !== "string") ||
      (value.quizLanguage !== undefined &&
        !LanguageSchema.safeParse(value.quizLanguage).success) ||
      (value.questionTypes !== undefined &&
        !QuizQuestionTypesSchema.safeParse(value.questionTypes).success) ||
      (value.sessionLength !== undefined &&
        !["short", "medium", "long"].includes(value.sessionLength)) ||
      (value.watched !== undefined && typeof value.watched !== "boolean") ||
      (value.quizId !== undefined && !isUuid(value.quizId)) ||
      (value.attemptId !== undefined && !isUuid(value.attemptId)) ||
      (value.acceptedCount !== undefined &&
        (!Number.isInteger(value.acceptedCount) ||
          value.acceptedCount < 1 ||
          value.acceptedCount > 15)) ||
      (value.plannedCount !== undefined &&
        ![5, 10, 15].includes(value.plannedCount))
    ) {
      throw new Error("Invalid generation state");
    }
    return value as StoredGeneration;
  } catch {
    await AsyncStorage.removeItem(generationKeyFor(videoId));
    return null;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function saveGenerationState(
  videoId: string,
  value: StoredGeneration,
): Promise<void> {
  await AsyncStorage.setItem(generationKeyFor(videoId), JSON.stringify(value));
}

export async function clearGenerationState(videoId: string): Promise<void> {
  await AsyncStorage.removeItem(generationKeyFor(videoId));
}
