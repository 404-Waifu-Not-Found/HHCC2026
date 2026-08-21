import {
  LocalConceptQuizQuestionChunkSchema,
  LocalGenerationCallEventSchema,
  type LocalConceptQuizQuestionChunk,
  type LocalGenerationCallEvent,
} from "@clipquest/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "clipquest:android-generation-outbox:v1:";
const MAX_ENTRIES = 48;
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;

type Entry =
  | { id: string; kind: "question"; value: LocalConceptQuizQuestionChunk }
  | { id: string; kind: "call"; value: LocalGenerationCallEvent };

type StoredOutbox = { updatedAt: number; entries: Entry[] };

let writeQueue = Promise.resolve();

function key(generationId: string): string {
  return `${PREFIX}${generationId}`;
}

async function read(generationId: string): Promise<StoredOutbox> {
  const raw = await AsyncStorage.getItem(key(generationId));
  if (!raw) return { updatedAt: Date.now(), entries: [] };
  try {
    const candidate = JSON.parse(raw) as Partial<StoredOutbox>;
    if (
      typeof candidate.updatedAt !== "number" ||
      Date.now() - candidate.updatedAt > MAX_AGE_MS ||
      !Array.isArray(candidate.entries)
    ) {
      await AsyncStorage.removeItem(key(generationId));
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
    await AsyncStorage.removeItem(key(generationId));
    return { updatedAt: Date.now(), entries: [] };
  }
}

function mutate(
  generationId: string,
  operation: (outbox: StoredOutbox) => StoredOutbox,
): Promise<void> {
  const run = writeQueue.then(async () => {
    const next = operation(await read(generationId));
    if (next.entries.length === 0) {
      await AsyncStorage.removeItem(key(generationId));
      return;
    }
    await AsyncStorage.setItem(key(generationId), JSON.stringify(next));
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

export function appendAndroidGenerationOutboxEntry(
  generationId: string,
  entry: Entry,
): Promise<void> {
  return mutate(generationId, (outbox) => ({
    updatedAt: Date.now(),
    entries: [
      ...outbox.entries.filter((candidate) => candidate.id !== entry.id),
      entry,
    ].slice(-MAX_ENTRIES),
  }));
}

export function removeAndroidGenerationOutboxEntry(
  generationId: string,
  entryId: string,
): Promise<void> {
  return mutate(generationId, (outbox) => ({
    updatedAt: Date.now(),
    entries: outbox.entries.filter((entry) => entry.id !== entryId),
  }));
}

export async function replayAndroidGenerationOutbox(
  generationId: string,
  onQuestion: (value: LocalConceptQuizQuestionChunk) => void | Promise<void>,
  onCall: (value: LocalGenerationCallEvent) => void | Promise<void>,
): Promise<{ questions: number; calls: number }> {
  await writeQueue;
  const outbox = await read(generationId);
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
    await removeAndroidGenerationOutboxEntry(generationId, entry.id);
  }
  return { questions, calls };
}
