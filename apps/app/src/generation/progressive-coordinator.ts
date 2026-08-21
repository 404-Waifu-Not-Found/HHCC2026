import type {
  AttemptGenerationAvailability,
  GenerationStage,
  QuizStartResponse,
} from "@clipquest/contracts";

export type ProgressiveGenerationSnapshot = {
  stage: GenerationStage;
  attemptId?: string;
  quizId?: string;
  generation?: AttemptGenerationAvailability;
  error?: string;
};

export type ProgressiveGenerationTaskContext = {
  signal: AbortSignal;
  publish(snapshot: Partial<ProgressiveGenerationSnapshot>): void;
  resolveFirst(start: QuizStartResponse): void;
};

type Listener = (snapshot: ProgressiveGenerationSnapshot) => void;

type Task = {
  controller: AbortController;
  firstReady: Promise<QuizStartResponse>;
  completion: Promise<void>;
  snapshot: ProgressiveGenerationSnapshot;
  listeners: Set<Listener>;
  cancel(): void;
  subscribe(listener: Listener): () => void;
};

const tasks = new Map<string, Task>();
const recoveryTasks = new Map<
  string,
  { completion: Promise<void>; cancel(): void }
>();
const attemptSnapshots = new Map<string, ProgressiveGenerationSnapshot>();
const attemptListeners = new Map<string, Set<Listener>>();

export function getOrStartProgressiveGenerationTask(
  key: string,
  runner: (context: ProgressiveGenerationTaskContext) => Promise<void>,
): Task {
  const existing = tasks.get(key);
  if (existing) return existing;

  const controller = new AbortController();
  const first = deferred<QuizStartResponse>();
  let settledFirst = false;
  const listeners = new Set<Listener>();
  const task: Task = {
    controller,
    firstReady: first.promise,
    completion: Promise.resolve(),
    snapshot: { stage: "getting_video" as const },
    listeners,
    cancel: () => controller.abort(new Error("Generation was cancelled.")),
    subscribe(listener: Listener) {
      listeners.add(listener);
      listener(task.snapshot);
      return () => listeners.delete(listener);
    },
  };

  const publish = (update: Partial<ProgressiveGenerationSnapshot>) => {
    task.snapshot = { ...task.snapshot, ...update };
    if (task.snapshot.attemptId) {
      attemptSnapshots.set(task.snapshot.attemptId, task.snapshot);
      attemptListeners
        .get(task.snapshot.attemptId)
        ?.forEach((listener) => listener(task.snapshot));
    }
    listeners.forEach((listener) => listener(task.snapshot));
  };
  const resolveFirst = (start: QuizStartResponse) => {
    if (settledFirst) return;
    settledFirst = true;
    publish({ attemptId: start.attemptId, generation: start.generation });
    first.resolve(start);
  };

  task.completion = Promise.resolve()
    .then(() => runner({ signal: controller.signal, publish, resolveFirst }))
    .catch((error) => {
      const message =
        error instanceof Error ? error.message : "Quiz generation failed.";
      publish({ error: message });
      if (!settledFirst) {
        settledFirst = true;
        first.reject(error);
      }
      throw error;
    })
    .finally(() => {
      if (tasks.get(key) === task) tasks.delete(key);
    });
  // The route waits on firstReady, not necessarily on background completion.
  // Keep a late continuation failure from becoming an unhandled rejection.
  void task.completion.catch(() => undefined);
  tasks.set(key, task);
  return task;
}

export function cancelProgressiveGenerationTask(key: string): void {
  tasks.get(key)?.cancel();
}

export function pauseAllProgressiveGenerationTasks(): void {
  tasks.forEach((task) => task.cancel());
  recoveryTasks.forEach((task) => task.cancel());
}

export function getOrStartProgressiveRecoveryTask(
  key: string,
  runner: (signal: AbortSignal) => Promise<void>,
): { completion: Promise<void>; cancel(): void } {
  const existing = recoveryTasks.get(key);
  if (existing) return existing;
  const controller = new AbortController();
  const task = {
    completion: Promise.resolve(),
    cancel: () => controller.abort(new Error("Recovery was cancelled.")),
  };
  task.completion = Promise.resolve()
    .then(() => runner(controller.signal))
    .finally(() => {
      if (recoveryTasks.get(key) === task) recoveryTasks.delete(key);
    });
  recoveryTasks.set(key, task);
  return task;
}

/**
 * A learner-triggered retry must be able to replace a stale background
 * recovery task. Removing the task before aborting prevents the next retry
 * from deduplicating onto a promise that can no longer make progress.
 */
export function cancelProgressiveRecoveryTask(key: string): void {
  const task = recoveryTasks.get(key);
  if (!task) return;
  recoveryTasks.delete(key);
  task.cancel();
}

export function publishAttemptGeneration(
  attemptId: string,
  quizId: string,
  generation: AttemptGenerationAvailability,
): void {
  const snapshot: ProgressiveGenerationSnapshot = {
    ...(attemptSnapshots.get(attemptId) ?? { stage: "creating_questions" }),
    attemptId,
    quizId,
    generation,
  };
  attemptSnapshots.set(attemptId, snapshot);
  attemptListeners.get(attemptId)?.forEach((listener) => listener(snapshot));
}

export function subscribeToAttemptGeneration(
  attemptId: string,
  listener: Listener,
): () => void {
  const listeners = attemptListeners.get(attemptId) ?? new Set<Listener>();
  listeners.add(listener);
  attemptListeners.set(attemptId, listeners);
  const snapshot = attemptSnapshots.get(attemptId);
  if (snapshot) listener(snapshot);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) attemptListeners.delete(attemptId);
  };
}

export function hasActiveProgressiveGenerationForAttempt(
  attemptId: string,
): boolean {
  if (recoveryTasks.has(attemptId)) return true;
  return [...tasks.values()].some(
    (task) =>
      !task.controller.signal.aborted && task.snapshot.attemptId === attemptId,
  );
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
