import * as SecureStore from "expo-secure-store";

const KEY_PREFIX = "clipquest.deepseek.v1.";
const listeners = new Set<(userId: string, configured: boolean) => void>();

function accountKey(userId: string): string {
  if (!userId.trim()) throw new Error("A signed-in account is required.");
  return `${KEY_PREFIX}${userId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

export async function readAndroidDeepSeekKey(
  userId: string,
): Promise<string | null> {
  return SecureStore.getItemAsync(accountKey(userId));
}

export async function saveAndroidDeepSeekKey(
  userId: string,
  apiKey: string,
): Promise<void> {
  await SecureStore.setItemAsync(accountKey(userId), apiKey, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  listeners.forEach((listener) => listener(userId, true));
}

export async function removeAndroidDeepSeekKey(userId: string): Promise<void> {
  await SecureStore.deleteItemAsync(accountKey(userId));
  listeners.forEach((listener) => listener(userId, false));
}

export function subscribeToAndroidDeepSeekKey(
  listener: (userId: string, configured: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
