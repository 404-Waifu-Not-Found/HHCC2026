import {
  VideoImportResponseSchema,
  type VideoImportResponse,
} from "@clipquest/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";

const keyFor = (videoId: string) => `clipquest:creation:${videoId}`;
const generationKeyFor = (videoId: string) => `clipquest:generation:${videoId}`;

export type StoredGeneration = {
  idempotencyKey: string;
  jobId?: string;
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
        stored.transcriptionMode ??
        (hasCaptions
          ? "captions"
          : "device_media"),
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
  await AsyncStorage.multiRemove([keyFor(videoId), generationKeyFor(videoId)]);
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
      (value.jobId !== undefined && typeof value.jobId !== "string")
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
