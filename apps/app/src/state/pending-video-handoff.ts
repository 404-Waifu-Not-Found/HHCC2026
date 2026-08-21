import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import {
  PendingVideoHandoffV2Schema,
  claimPendingVideoHandoffRecord,
  createPendingVideoHandoffRecord,
  type PendingVideoHandoffV2,
} from "./pending-video-handoff-core";

export {
  PENDING_VIDEO_HANDOFF_TTL_MS,
  PendingVideoHandoffV2Schema,
  claimPendingVideoHandoffRecord,
  type PendingVideoHandoffV2,
} from "./pending-video-handoff-core";

export const LEGACY_PENDING_VIDEO_HANDOFF_KEY = "clipquest:pending-url:v1";
export const PENDING_VIDEO_HANDOFF_KEY = "clipquest:pending-video:v2";
const OBSERVED_HANDOFF_USER_KEY = "clipquest:pending-video-user:v2";

export function createPendingVideoHandoff(input: {
  url: string;
  source: PendingVideoHandoffV2["source"];
  claimedUserId?: string;
  id?: string;
  nowMs?: number;
}): PendingVideoHandoffV2 {
  return createPendingVideoHandoffRecord({
    id: input.id ?? Crypto.randomUUID(),
    url: input.url,
    source: input.source,
    claimedUserId: input.claimedUserId,
    nowMs: input.nowMs,
  });
}

export async function savePendingVideoHandoff(
  record: PendingVideoHandoffV2,
): Promise<void> {
  await clearLegacyHandoff();
  await writeStorageValue(
    PENDING_VIDEO_HANDOFF_KEY,
    JSON.stringify(PendingVideoHandoffV2Schema.parse(record)),
  );
}

export async function createAndSavePendingVideoHandoff(input: {
  url: string;
  source: PendingVideoHandoffV2["source"];
  claimedUserId?: string;
}): Promise<PendingVideoHandoffV2> {
  const handoff = createPendingVideoHandoff(input);
  await savePendingVideoHandoff(handoff);
  return handoff;
}

export async function persistAuthJourneyQuickOpenHandoff(
  url: string,
): Promise<PendingVideoHandoffV2> {
  const current = await readPendingVideoHandoff();
  if (
    current?.source === "quick_open" &&
    current.url === url &&
    current.state === "pending" &&
    !current.claimedUserId
  ) {
    return current;
  }
  return createAndSavePendingVideoHandoff({ url, source: "quick_open" });
}

export async function readPendingVideoHandoff(
  nowMs = Date.now(),
): Promise<PendingVideoHandoffV2 | null> {
  await clearLegacyHandoff();
  const raw = await readStorageValue(PENDING_VIDEO_HANDOFF_KEY);
  if (!raw) return null;
  try {
    const parsed = PendingVideoHandoffV2Schema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.expiresAt <= nowMs) {
      await removeStorageValue(PENDING_VIDEO_HANDOFF_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    await removeStorageValue(PENDING_VIDEO_HANDOFF_KEY);
    return null;
  }
}

export async function claimPendingVideoHandoff(
  userId: string,
): Promise<PendingVideoHandoffV2 | null> {
  const current = await readPendingVideoHandoff();
  if (!current) return null;
  const claimed = claimPendingVideoHandoffRecord(current, userId);
  if (!claimed) {
    await clearPendingVideoHandoff(current.id);
    return null;
  }
  await savePendingVideoHandoff(claimed);
  return claimed;
}

export async function markPendingVideoHandoffState(
  handoffId: string,
  userId: string,
  state: "in_flight" | "retry_required",
): Promise<PendingVideoHandoffV2 | null> {
  const current = await readPendingVideoHandoff();
  if (
    !current ||
    current.id !== handoffId ||
    current.claimedUserId !== userId
  ) {
    return null;
  }
  const updated = PendingVideoHandoffV2Schema.parse({ ...current, state });
  await savePendingVideoHandoff(updated);
  return updated;
}

export async function clearPendingVideoHandoff(
  expectedId?: string,
): Promise<void> {
  if (expectedId) {
    const current = await readPendingVideoHandoff();
    if (current && current.id !== expectedId) return;
  }
  await removeStorageValue(PENDING_VIDEO_HANDOFF_KEY);
}

export async function clearPendingVideoHandoffs(): Promise<void> {
  await Promise.all([
    removeStorageValue(PENDING_VIDEO_HANDOFF_KEY),
    removeStorageValue(OBSERVED_HANDOFF_USER_KEY),
    clearLegacyHandoff(),
  ]);
}

/**
 * Persist the authenticated owner observed by this tab/device. A different
 * owner means the previous handoff belongs to another auth journey and must be
 * discarded before Home can claim it.
 */
export async function observePendingHandoffUser(userId: string): Promise<void> {
  await clearLegacyHandoff();
  const previousUserId = await readStorageValue(OBSERVED_HANDOFF_USER_KEY);
  if (previousUserId && previousUserId !== userId) {
    await removeStorageValue(PENDING_VIDEO_HANDOFF_KEY);
  }
  await writeStorageValue(OBSERVED_HANDOFF_USER_KEY, userId);
}

async function clearLegacyHandoff(): Promise<void> {
  await AsyncStorage.removeItem(LEGACY_PENDING_VIDEO_HANDOFF_KEY).catch(
    () => undefined,
  );
  if (Platform.OS === "web") {
    webSessionStorage()?.removeItem(LEGACY_PENDING_VIDEO_HANDOFF_KEY);
  }
}

async function readStorageValue(key: string): Promise<string | null> {
  if (Platform.OS === "web") return webSessionStorage()?.getItem(key) ?? null;
  return AsyncStorage.getItem(key);
}

async function writeStorageValue(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    const storage = webSessionStorage();
    if (!storage) throw new Error("Session handoff storage is unavailable.");
    storage.setItem(key, value);
    return;
  }
  await AsyncStorage.setItem(key, value);
}

async function removeStorageValue(key: string): Promise<void> {
  if (Platform.OS === "web") {
    webSessionStorage()?.removeItem(key);
    return;
  }
  await AsyncStorage.removeItem(key);
}

function webSessionStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
