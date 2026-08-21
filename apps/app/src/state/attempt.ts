import type { PublicQuestion, QuizStartResponse } from "@clipquest/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type StoredAttempt = {
  attemptId: string;
  primer: string | null;
  question: PublicQuestion | null;
  primerSeen: boolean;
};

const keyFor = (attemptId: string) => `clipquest:attempt:${attemptId}`;

export async function saveAttemptStart(start: QuizStartResponse): Promise<void> {
  const value: StoredAttempt = {
    attemptId: start.attemptId,
    primer: start.primer,
    question: start.question,
    primerSeen: !start.primer,
  };
  await AsyncStorage.setItem(keyFor(start.attemptId), JSON.stringify(value));
}

export async function loadAttempt(attemptId: string): Promise<StoredAttempt | null> {
  const raw = await AsyncStorage.getItem(keyFor(attemptId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAttempt;
  } catch {
    await AsyncStorage.removeItem(keyFor(attemptId));
    return null;
  }
}

export async function saveAttemptQuestion(attemptId: string, question: PublicQuestion | null): Promise<void> {
  const current = await loadAttempt(attemptId);
  await AsyncStorage.setItem(
    keyFor(attemptId),
    JSON.stringify({
      attemptId,
      primer: current?.primer ?? null,
      question,
      primerSeen: current?.primerSeen ?? true,
    } satisfies StoredAttempt),
  );
}

export async function markPrimerSeen(attemptId: string): Promise<void> {
  const current = await loadAttempt(attemptId);
  if (!current) return;
  await AsyncStorage.setItem(keyFor(attemptId), JSON.stringify({ ...current, primerSeen: true }));
}

export async function clearAttempt(attemptId: string): Promise<void> {
  await AsyncStorage.removeItem(keyFor(attemptId));
}
