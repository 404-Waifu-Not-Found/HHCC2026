import {
  DEFAULT_QUIZ_QUESTION_TYPES,
  GenerationRecordSchema,
  LanguageSchema,
  QuizQuestionTypesSchema,
  VideoImportResponseSchema,
  type AppLanguage,
  type GenerationRecord,
  type GenerationRecordV2,
  type GenerationRecordV3,
  type GenerationRecordV4,
  type LocalGenerationProfile,
  type LocalQuestionPlan,
  type QuizQuestionType,
  type SessionLength,
  type VideoImportResponse,
} from "@clipquest/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";

const LEGACY_CREATION_PREFIX = "clipquest:creation:";
const CREATION_PREFIX = "clipquest:creation:v3:";
const LEGACY_TRANSCRIPT_CHECKPOINT_PREFIX = "clipquest:transcript-checkpoint:";
const TRANSCRIPT_CHECKPOINT_PREFIX = "clipquest:transcript-checkpoint:v2:";
const accountPart = (userId: string) => encodeURIComponent(userId);
const keyFor = (userId: string, videoId: string) =>
  `${CREATION_PREFIX}${accountPart(userId)}:${encodeURIComponent(videoId)}`;
const generationKeyFor = (videoId: string) => `clipquest:generation:${videoId}`;
const generationV2KeyFor = (generationId: string) =>
  `clipquest:generation:v2:${generationId}`;
const GENERATION_V2_PREFIX = "clipquest:generation:v2:";
const LEGACY_GENERATION_PREFIX = "clipquest:generation:";
const attemptGenerationKeyFor = (attemptId: string) =>
  `clipquest:generation-attempt:v2:${attemptId}`;
const LEGACY_PREFERENCES_PREFIX = "clipquest:preferences:";
const PREFERENCES_PREFIX = "clipquest:preferences:v2:";
const preferencesKeyFor = (userId: string, videoId: string) =>
  `${PREFERENCES_PREFIX}${accountPart(userId)}:${encodeURIComponent(videoId)}`;
const legacyPreferencesKeyFor = (videoId: string) =>
  `${LEGACY_PREFERENCES_PREFIX}${videoId}`;
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

type ImportedVideoCacheV3 = {
  version: 3;
  ownerUserId: string;
  cachedAt: number;
  expiresAt: number;
  value: VideoImportResponse;
};

export async function saveImportedVideo(
  ownerUserId: string,
  value: VideoImportResponse,
): Promise<void> {
  const parsed = VideoImportResponseSchema.parse(value);
  const cachedAt = Date.now();
  const cache: ImportedVideoCacheV3 = {
    version: 3,
    ownerUserId,
    cachedAt,
    expiresAt: cachedAt + TRANSCRIPT_CACHE_TTL_MS,
    value: parsed,
  };
  await AsyncStorage.removeItem(`${LEGACY_CREATION_PREFIX}${parsed.video.id}`);
  await AsyncStorage.setItem(
    keyFor(ownerUserId, parsed.video.id),
    JSON.stringify(cache),
  );
}

export async function loadImportedVideo(
  ownerUserId: string,
  videoId: string,
): Promise<VideoImportResponse | null> {
  await AsyncStorage.removeItem(`${LEGACY_CREATION_PREFIX}${videoId}`);
  const storageKey = keyFor(ownerUserId, videoId);
  const value = await AsyncStorage.getItem(storageKey);
  if (!value) return null;
  try {
    const parsedValue = JSON.parse(value) as
      | ImportedVideoCacheV3
      | (Partial<VideoImportResponse> & {
          video?: Partial<VideoImportResponse["video"]>;
          captions?: Partial<VideoImportResponse["captions"]>;
        });
    if (
      "version" in parsedValue &&
      parsedValue.version === 3 &&
      "value" in parsedValue
    ) {
      if (
        parsedValue.ownerUserId !== ownerUserId ||
        !Number.isFinite(parsedValue.expiresAt) ||
        parsedValue.expiresAt <= Date.now()
      ) {
        await AsyncStorage.removeItem(storageKey);
        return null;
      }
      return VideoImportResponseSchema.parse(parsedValue.value);
    }
    await AsyncStorage.removeItem(storageKey);
    return null;
  } catch {
    await AsyncStorage.removeItem(storageKey);
    return null;
  }
}

export async function clearImportedVideo(
  ownerUserId: string,
  videoId: string,
): Promise<void> {
  await AsyncStorage.multiRemove([
    keyFor(ownerUserId, videoId),
    preferencesKeyFor(ownerUserId, videoId),
    legacyPreferencesKeyFor(videoId),
  ]);
}

export async function clearAccountCreationState(
  ownerUserId: string,
): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const accountCreationPrefix = `${CREATION_PREFIX}${accountPart(ownerUserId)}:`;
  const accountCheckpointPrefix = `${TRANSCRIPT_CHECKPOINT_PREFIX}${accountPart(ownerUserId)}:`;
  const accountPreferencesPrefix = `${PREFERENCES_PREFIX}${accountPart(ownerUserId)}:`;
  const removable = new Set(
    keys.filter(
      (candidate) =>
        candidate.startsWith(accountCreationPrefix) ||
        candidate.startsWith(accountCheckpointPrefix) ||
        candidate.startsWith(accountPreferencesPrefix) ||
        (candidate.startsWith(LEGACY_CREATION_PREFIX) &&
          !candidate.startsWith(CREATION_PREFIX)) ||
        (candidate.startsWith(LEGACY_TRANSCRIPT_CHECKPOINT_PREFIX) &&
          !candidate.startsWith(TRANSCRIPT_CHECKPOINT_PREFIX)) ||
        (candidate.startsWith(LEGACY_PREFERENCES_PREFIX) &&
          !candidate.startsWith(PREFERENCES_PREFIX)) ||
        (candidate.startsWith(LEGACY_GENERATION_PREFIX) &&
          !candidate.startsWith(GENERATION_V2_PREFIX) &&
          !candidate.startsWith("clipquest:generation-attempt:v2:")),
    ),
  );
  const generationKeys = keys.filter((candidate) =>
    candidate.startsWith(GENERATION_V2_PREFIX),
  );
  if (generationKeys.length > 0) {
    const records = await AsyncStorage.multiGet(generationKeys);
    for (const [storageKey, raw] of records) {
      if (!raw) continue;
      try {
        const record = GenerationRecordSchema.parse(JSON.parse(raw));
        if (record.ownerUserId !== ownerUserId) continue;
        removable.add(storageKey);
        if (record.attemptId) {
          removable.add(attemptGenerationKeyFor(record.attemptId));
        }
      } catch {
        removable.add(storageKey);
      }
    }
  }
  if (removable.size > 0) {
    await AsyncStorage.multiRemove([...removable]);
  }
}

export async function saveQuestPreferences(
  ownerUserId: string,
  videoId: string,
  value: QuestPreferences,
): Promise<void> {
  const parsed = {
    quizLanguage: LanguageSchema.parse(value.quizLanguage),
    questionTypes: QuizQuestionTypesSchema.parse(value.questionTypes),
  };
  await AsyncStorage.removeItem(legacyPreferencesKeyFor(videoId));
  await AsyncStorage.setItem(
    preferencesKeyFor(ownerUserId, videoId),
    JSON.stringify(parsed),
  );
}

export async function loadQuestPreferences(
  ownerUserId: string,
  videoId: string,
): Promise<QuestPreferences> {
  await AsyncStorage.removeItem(legacyPreferencesKeyFor(videoId));
  const storageKey = preferencesKeyFor(ownerUserId, videoId);
  const raw = await AsyncStorage.getItem(storageKey);
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
    await AsyncStorage.removeItem(storageKey);
    return {
      quizLanguage: "en",
      questionTypes: [...DEFAULT_QUIZ_QUESTION_TYPES],
    };
  }
}

export async function saveGenerationRecord(
  value: GenerationRecord,
): Promise<GenerationRecord> {
  const parsed = GenerationRecordSchema.parse(value);
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
): Promise<GenerationRecord | null> {
  if (!isUuid(generationId)) return null;
  const raw = await AsyncStorage.getItem(generationV2KeyFor(generationId));
  if (!raw) return null;
  try {
    return GenerationRecordSchema.parse(JSON.parse(raw));
  } catch {
    await AsyncStorage.removeItem(generationV2KeyFor(generationId));
    return null;
  }
}

export function generationRecordForOwnerAndVideo(
  record: GenerationRecord | null,
  ownerUserId: string,
  videoId: string,
): GenerationRecord | null {
  return record?.ownerUserId === ownerUserId && record.videoId === videoId
    ? record
    : null;
}

export async function updateGenerationRecord(
  generationId: string,
  update: GenerationRecordUpdate,
): Promise<GenerationRecord | null> {
  const current = await loadGenerationRecord(generationId);
  if (!current) return null;
  return saveGenerationRecord({
    ...current,
    ...update,
    generationId: current.generationId,
    version: current.version,
    updatedAt: Date.now(),
  } as GenerationRecord);
}

type GenerationRecordVariant =
  GenerationRecordV2 | GenerationRecordV3 | GenerationRecordV4;
type KeysOfUnion<T> = T extends T ? keyof T : never;
type ValueOfUnion<T, Key extends PropertyKey> = T extends T
  ? Key extends keyof T
    ? T[Key]
    : never
  : never;
export type GenerationRecordUpdate = {
  [Key in KeysOfUnion<GenerationRecordVariant>]?: ValueOfUnion<
    GenerationRecordVariant,
    Key
  >;
};

export function generationRecordHasLiveHeartbeat(
  record: GenerationRecord,
  timestamp = Date.now(),
): boolean {
  return (
    (record.state === "generating" ||
      record.state === "retrying" ||
      record.state === "recovering") &&
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
): Promise<GenerationRecord | null> {
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
): Promise<GenerationRecord | null> {
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
  return migrated?.version === 2 ? migrated : null;
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
