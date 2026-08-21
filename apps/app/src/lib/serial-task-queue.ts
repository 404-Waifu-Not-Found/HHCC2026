export function createSerialTaskQueue() {
  let pending = Promise.resolve();

  return {
    enqueue(task: () => Promise<void> | void): Promise<void> {
      pending = pending
        .catch(() => undefined)
        .then(task)
        .catch(() => undefined);
      return pending;
    },
  };
}
