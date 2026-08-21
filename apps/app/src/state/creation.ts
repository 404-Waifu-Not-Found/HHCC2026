import type { VideoImportResponse } from "@clipquest/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";

const keyFor = (videoId: string) => `clipquest:creation:${videoId}`;

export async function saveImportedVideo(value: VideoImportResponse): Promise<void> {
  await AsyncStorage.setItem(keyFor(value.video.id), JSON.stringify(value));
}

export async function loadImportedVideo(videoId: string): Promise<VideoImportResponse | null> {
  const value = await AsyncStorage.getItem(keyFor(videoId));
  if (!value) return null;
  try {
    return JSON.parse(value) as VideoImportResponse;
  } catch {
    await AsyncStorage.removeItem(keyFor(videoId));
    return null;
  }
}

export async function clearImportedVideo(videoId: string): Promise<void> {
  await AsyncStorage.removeItem(keyFor(videoId));
}

