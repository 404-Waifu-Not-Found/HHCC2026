const DEFAULT_ATTEMPTS = 4;
const BASE_DELAY_MS = 125;

export async function retryAuthoritativeTelemetryWrite<T>(
  write: () => Promise<T>,
  signal: AbortSignal,
  options: {
    attempts?: number;
    wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const wait = options.wait ?? waitForRetry;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal.aborted) throw abortReason(signal);
    try {
      return await write();
    } catch (error) {
      lastError = error;
      if (signal.aborted || attempt === attempts) throw error;
      await wait(BASE_DELAY_MS * 2 ** (attempt - 1), signal);
    }
  }

  throw lastError;
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The request was cancelled.", "AbortError");
}
