(function installBoundedResponseReader(globalScope) {
  "use strict";

  if (globalScope.ClipQuestBoundedResponse) return;

  function abortError(signal, fallback) {
    return signal?.reason instanceof Error
      ? signal.reason
      : new Error(fallback);
  }

  async function cancelBody(response) {
    await response.body?.cancel().catch(() => undefined);
  }

  async function readBoundedResponseText(response, options = {}) {
    const maxBytes = options.maxBytes;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new TypeError("A positive response byte limit is required.");
    }

    const declaredHeader = response.headers.get("content-length");
    const declaredBytes =
      declaredHeader === null ? null : Number.parseInt(declaredHeader, 10);
    if (
      declaredBytes !== null &&
      Number.isFinite(declaredBytes) &&
      declaredBytes > maxBytes
    ) {
      await cancelBody(response);
      throw new Error("The response exceeded the safe size limit.");
    }

    if (!response.body) return "";
    const reader = response.body.getReader();
    const cancelRead = () => {
      void reader.cancel(options.signal?.reason).catch(() => undefined);
    };
    if (options.signal?.aborted) {
      cancelRead();
      throw abortError(options.signal, "The response read was canceled.");
    }
    options.signal?.addEventListener("abort", cancelRead, { once: true });
    const decoder = new TextDecoder();
    let receivedBytes = 0;
    let text = "";
    try {
      for (;;) {
        if (options.signal?.aborted) {
          throw abortError(options.signal, "The response read was canceled.");
        }
        const { done, value } = await reader.read();
        if (options.signal?.aborted) {
          throw abortError(options.signal, "The response read was canceled.");
        }
        if (done) break;
        receivedBytes += value.byteLength;
        if (receivedBytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error("The response exceeded the safe size limit.");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return text;
    } finally {
      options.signal?.removeEventListener("abort", cancelRead);
      reader.releaseLock();
    }
  }

  async function fetchBoundedText(input, init = {}, options = {}) {
    const fetchImpl = options.fetchImpl ?? globalScope.fetch;
    if (typeof fetchImpl !== "function") {
      throw new TypeError("A fetch implementation is required.");
    }
    const timeoutMs = options.timeoutMs ?? 15_000;
    const controller = new AbortController();
    const callerSignal = init.signal;
    const forwardAbort = () =>
      controller.abort(abortError(callerSignal, "The request was canceled."));
    if (callerSignal?.aborted) forwardAbort();
    else callerSignal?.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("The response timed out.")),
      timeoutMs,
    );
    try {
      const response = await fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });
      const text = await readBoundedResponseText(response, {
        maxBytes: options.maxBytes,
        signal: controller.signal,
      });
      return { response, text };
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", forwardAbort);
    }
  }

  globalScope.ClipQuestBoundedResponse = Object.freeze({
    fetchBoundedText,
    readBoundedResponseText,
  });
})(globalThis);
