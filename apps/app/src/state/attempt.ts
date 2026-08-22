import {
  PublicQuestionSchema,
  type PublicQuestion,
  type QuizStartResponse,
} from "@clipquest/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseRecapEntries, type RecapEntry } from "../lib/session-recap";

export type StoredAttempt = {
  version: 2;
  ownerUserId: string;
  attemptId: string;
  primer: string | null;
  question: PublicQuestion | null;
  primerSeen: boolean;
  /** Graded answers from this session, in order, for the completion recap. */
  recap: RecapEntry[];
};

const ATTEMPT_PREFIX = "clipquest:attempt:v2:";
const LEGACY_ATTEMPT_PREFIX = "clipquest:attempt:";

const keyFor = (userId: string, attemptId: string) =>
  `${ATTEMPT_PREFIX}${userId}:${attemptId}`;
const legacyKeyFor = (attemptId: string) =>
  `${LEGACY_ATTEMPT_PREFIX}${attemptId}`;

export function parseStoredAttempt(
  raw: string,
  userId: string,
  attemptId: string,
): StoredAttempt | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const question = PublicQuestionSchema.nullable().safeParse(value.question);
    if (
      value.version !== 2 ||
      value.ownerUserId !== userId ||
      value.attemptId !== attemptId ||
      (value.primer !== null && typeof value.primer !== "string") ||
      typeof value.primerSeen !== "boolean" ||
      !question.success
    ) {
      return null;
    }
    return {
      version: 2,
      ownerUserId: userId,
      attemptId,
      primer: value.primer as string | null,
      question: question.data,
      primerSeen: value.primerSeen,
      // Records written before the recap existed simply have no entries.
      recap: parseRecapEntries(value.recap),
    };
  } catch {
    return null;
  }
}

export async function saveAttemptStart(
  userId: string,
  start: QuizStartResponse,
): Promise<void> {
  const value: StoredAttempt = {
    version: 2,
    ownerUserId: userId,
    attemptId: start.attemptId,
    primer: start.primer,
    question: start.question,
    primerSeen: !start.primer,
    recap: [],
  };
  await Promise.all([
    AsyncStorage.setItem(
      keyFor(userId, start.attemptId),
      JSON.stringify(value),
    ),
    AsyncStorage.removeItem(legacyKeyFor(start.attemptId)),
  ]);
}

export async function loadAttempt(
  userId: string,
  attemptId: string,
): Promise<StoredAttempt | null> {
  await AsyncStorage.removeItem(legacyKeyFor(attemptId));
  const key = keyFor(userId, attemptId);
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  const parsed = parseStoredAttempt(raw, userId, attemptId);
  if (!parsed) await AsyncStorage.removeItem(key);
  return parsed;
}

export async function saveAttemptQuestion(
  userId: string,
  attemptId: string,
  question: PublicQuestion | null,
): Promise<void> {
  const current = await loadAttempt(userId, attemptId);
  const value: StoredAttempt = {
    version: 2,
    ownerUserId: userId,
    attemptId,
    primer: current?.primer ?? null,
    question,
    primerSeen: current?.primerSeen ?? true,
    recap: current?.recap ?? [],
  };
  await AsyncStorage.setItem(keyFor(userId, attemptId), JSON.stringify(value));
}

export async function saveAttemptRecap(
  userId: string,
  attemptId: string,
  recap: RecapEntry[],
): Promise<void> {
  const current = await loadAttempt(userId, attemptId);
  const value: StoredAttempt = {
    version: 2,
    ownerUserId: userId,
    attemptId,
    primer: current?.primer ?? null,
    question: current?.question ?? null,
    primerSeen: current?.primerSeen ?? true,
    recap,
  };
  await AsyncStorage.setItem(keyFor(userId, attemptId), JSON.stringify(value));
}

export async function markPrimerSeen(
  userId: string,
  attemptId: string,
): Promise<void> {
  const current = await loadAttempt(userId, attemptId);
  if (!current) return;
  await AsyncStorage.setItem(
    keyFor(userId, attemptId),
    JSON.stringify({ ...current, primerSeen: true }),
  );
}

export async function clearAttempt(
  userId: string,
  attemptId: string,
): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(keyFor(userId, attemptId)),
    AsyncStorage.removeItem(legacyKeyFor(attemptId)),
  ]);
}

export async function clearAccountAttemptState(userId: string): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const accountPrefix = `${ATTEMPT_PREFIX}${userId}:`;
  const removable = keys.filter(
    (key) =>
      key.startsWith(accountPrefix) ||
      (key.startsWith(LEGACY_ATTEMPT_PREFIX) &&
        !key.startsWith(ATTEMPT_PREFIX)),
  );
  if (removable.length > 0) await AsyncStorage.multiRemove(removable);
}
