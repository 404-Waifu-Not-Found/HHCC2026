import {
  DEFAULT_QUIZ_QUESTION_TYPES,
  LanguageSchema,
  QuizQuestionTypesSchema,
  VideoImportResponseSchema,
  type AppLanguage,
  type QuizQuestionType,
  type VideoImportResponse,
} from "@clipquest/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";

const keyFor = (videoId: string) => `clipquest:creation:${videoId}`;
const generationKeyFor = (videoId: string) => `clipquest:generation:${videoId}`;
const preferencesKeyFor = (videoId: string) =>
  `clipquest:preferences:${videoId}`;

export type QuestPreferences = {
  quizLanguage: AppLanguage;
  questionTypes: QuizQuestionType[];
};

export type StoredGeneration = {
  idempotencyKey: string;
  jobId?: string;
  quizLanguage?: AppLanguage;
  questionTypes?: QuizQuestionType[];
  preworkStatus?: "running" | "ready" | "unavailable" | "failed";
};

export async function saveImportedVideo(
  value: VideoImportResponse,
): Promise<void> {
  await AsyncStorage.setItem(keyFor(value.video.id), JSON.stringify(value));
}

export async function loadImportedVideo(
  videoId: string,
): Promise<VideoImportResponse | null> {
  const value = await AsyncStorage.getItem(keyFor(videoId));
  if (!value) return null;
  try {
    const stored = JSON.parse(value) as Partial<VideoImportResponse> & {
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
  await AsyncStorage.multiRemove([
    keyFor(videoId),
    generationKeyFor(videoId),
    preferencesKeyFor(videoId),
  ]);
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
        !QuizQuestionTypesSchema.safeParse(value.questionTypes).success)
    ) {
      throw new Error("Invalid generation state");
    }
    return value as StoredGeneration;
  } catch {
    await AsyncStorage.removeItem(generationKeyFor(videoId));
    return null;
  }
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
