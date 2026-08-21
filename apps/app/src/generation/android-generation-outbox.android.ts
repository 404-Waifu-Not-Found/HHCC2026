import {
  LocalConceptQuizQuestionChunkSchema,
  LocalGenerationCallEventSchema,
  type LocalConceptQuizQuestionChunk,
  type LocalGenerationCallEvent,
} from "@clipquest/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "clipquest:native-generation-outbox:v2:";
const LEGACY_PREFIX = "clipquest:android-generation-outbox:v1:";
const MAX_ENTRIES = 128;
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;

type Entry =
  | { id: string; kind: "question"; value: LocalConceptQuizQuestionChunk }
  | { id: string; kind: "call"; value: LocalGenerationCallEvent };

type StoredOutbox = { updatedAt: number; entries: Entry[] };

let writeQueue = Promise.resolve();

function accountPrefix(userId: string): string {
  return `${PREFIX}${encodeURIComponent(userId)}:`;
}

function key(userId: string, generationId: string): string {
  return `${accountPrefix(userId)}${encodeURIComponent(generationId)}`;
}

async function discardAmbiguousLegacyOutbox(generationId: string) {
  await AsyncStorage.removeItem(`${LEGACY_PREFIX}${generationId}`);
}

async function read(
  userId: string,
  generationId: string,
): Promise<StoredOutbox> {
  await discardAmbiguousLegacyOutbox(generationId);
  const storageKey = key(userId, generationId);
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return { updatedAt: Date.now(), entries: [] };
  try {
    const candidate = JSON.parse(raw) as Partial<StoredOutbox>;
    if (
      typeof candidate.updatedAt !== "number" ||
      Date.now() - candidate.updatedAt > MAX_AGE_MS ||
      !Array.isArray(candidate.entries)
    ) {
      await AsyncStorage.removeItem(storageKey);
      return { updatedAt: Date.now(), entries: [] };
    }
    const entries = candidate.entries.flatMap((entry): Entry[] => {
      if (!entry || typeof entry !== "object") return [];
      const value = entry as Partial<Entry>;
      if (typeof value.id !== "string") return [];
      if (value.kind === "question") {
        const parsed = LocalConceptQuizQuestionChunkSchema.safeParse(
          value.value,
        );
        return parsed.success
          ? [{ id: value.id, kind: "question", value: parsed.data }]
          : [];
      }
      if (value.kind === "call") {
        const parsed = LocalGenerationCallEventSchema.safeParse(value.value);
        return parsed.success
          ? [{ id: value.id, kind: "call", value: parsed.data }]
          : [];
      }
      return [];
    });
    return { updatedAt: candidate.updatedAt, entries };
  } catch {
    await AsyncStorage.removeItem(storageKey);
    return { updatedAt: Date.now(), entries: [] };
  }
}

function mutate(
  userId: string,
  generationId: string,
  operation: (outbox: StoredOutbox) => StoredOutbox,
): Promise<void> {
  const run = writeQueue.then(async () => {
    const storageKey = key(userId, generationId);
    const next = operation(await read(userId, generationId));
    if (next.entries.length === 0) {
      await AsyncStorage.removeItem(storageKey);
      return;
    }
    await AsyncStorage.setItem(storageKey, JSON.stringify(next));
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

export function appendAndroidGenerationOutboxEntry(
  userId: string,
  generationId: string,
  entry: Entry,
): Promise<void> {
  return mutate(userId, generationId, (outbox) => ({
    updatedAt: Date.now(),
    entries: [
      ...outbox.entries.filter((candidate) => candidate.id !== entry.id),
      entry,
    ].slice(-MAX_ENTRIES),
  }));
}

export function removeAndroidGenerationOutboxEntry(
  userId: string,
  generationId: string,
  entryId: string,
): Promise<void> {
  return mutate(userId, generationId, (outbox) => ({
    updatedAt: Date.now(),
    entries: outbox.entries.filter((entry) => entry.id !== entryId),
  }));
}

export async function replayAndroidGenerationOutbox(
  userId: string,
  generationId: string,
  onQuestion: (value: LocalConceptQuizQuestionChunk) => void | Promise<void>,
  onCall: (value: LocalGenerationCallEvent) => void | Promise<void>,
): Promise<{ questions: number; calls: number }> {
  await writeQueue;
  const outbox = await read(userId, generationId);
  let questions = 0;
  let calls = 0;
  for (const entry of outbox.entries) {
    if (entry.kind === "question") {
      await onQuestion(entry.value);
      questions += 1;
    } else {
      await onCall(entry.value);
      calls += 1;
    }
    await removeAndroidGenerationOutboxEntry(userId, generationId, entry.id);
  }
  return { questions, calls };
}

export async function clearNativeGenerationOutboxes(
  userId: string,
): Promise<void> {
  await writeQueue;
  const keys = await AsyncStorage.getAllKeys();
  const ownedPrefix = accountPrefix(userId);
  const removable = keys.filter(
    (candidate) =>
      candidate.startsWith(ownedPrefix) || candidate.startsWith(LEGACY_PREFIX),
  );
  if (removable.length > 0) await AsyncStorage.multiRemove(removable);
}
