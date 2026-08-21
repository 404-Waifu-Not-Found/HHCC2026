(function installClipQuestBridge() {
  "use strict";

  if (globalThis.__clipQuestCaptionBridgeInstalled) return;
  globalThis.__clipQuestCaptionBridgeInstalled = true;

  const CHANNEL = "clipquest:captions:v1";
  const WEBSITE_SOURCE = "clipquest-website";
  const EXTENSION_SOURCE = "clipquest-extension";
  const LOCAL_AI_PORT = "clipquest-local-ai-v1";
  const HEARTBEAT_INTERVAL_MS = 20_000;

  function post(message) {
    window.postMessage(
      { channel: CHANNEL, source: EXTENSION_SOURCE, ...message },
      location.origin,
    );
  }

  async function announce() {
    try {
      const version = chrome.runtime.getManifest().version;
      const configuration = await chrome.runtime.sendMessage({
        type: "clipquest.config.v1",
      });
      post({
        type: "ready",
        version,
        configured: configuration?.configured === true,
        capabilities: ["question-stream-v1"],
      });
    } catch {
      // An unpacked extension can be reloaded while a page is open. The page
      // will time out and show recovery UI without an unhandled console error.
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (
      !message ||
      message.channel !== CHANNEL ||
      message.source !== WEBSITE_SOURCE
    ) {
      return;
    }
    if (message.type === "ping") {
      void announce();
      return;
    }
    if (
      message.type === "generate" &&
      typeof message.requestId === "string" &&
      message.context &&
      typeof message.context === "object"
    ) {
      const requestId = message.requestId;
      const port = chrome.runtime.connect({ name: LOCAL_AI_PORT });
      let settled = false;
      const finish = (response) => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        post({ type: "generation-result", requestId, response });
        port.disconnect();
      };
      const heartbeat = setInterval(() => {
        try {
          port.postMessage({ type: "heartbeat", requestId });
        } catch {
          finish({
            ok: false,
            error: "The ClipQuest extension stopped responding.",
          });
        }
      }, HEARTBEAT_INTERVAL_MS);
      port.onMessage.addListener((response) => {
        if (response?.requestId !== requestId) return;
        if (response.type === "progress") {
          post({
            type: "generation-progress",
            requestId,
            stage: response.stage,
            progress: response.progress,
            attempt: response.attempt,
            maxAttempts: response.maxAttempts,
            status: response.status,
            retryDelayMs: response.retryDelayMs,
          });
          return;
        }
        if (response.type === "question") {
          post({
            type: "generation-question",
            requestId,
            result: response.result,
          });
          return;
        }
        if (response.type === "result") finish(response.response);
      });
      port.onDisconnect.addListener(() => {
        finish({
          ok: false,
          error:
            chrome.runtime.lastError?.message ??
            "The ClipQuest extension stopped responding.",
        });
      });
      port.postMessage({
        type: "generate",
        requestId,
        context: message.context,
      });
      return;
    }
    if (
      message.type !== "extract" ||
      typeof message.requestId !== "string" ||
      !/^[\w-]{11}$/.test(message.videoId)
    ) {
      return;
    }
    void chrome.runtime
      .sendMessage({
        type: "clipquest.extract.v1",
        requestId: message.requestId,
        videoId: message.videoId,
        preferredLanguage:
          typeof message.preferredLanguage === "string"
            ? message.preferredLanguage
            : undefined,
      })
      .then((response) =>
        post({ type: "result", requestId: message.requestId, response }),
      )
      .catch((error) =>
        post({
          type: "result",
          requestId: message.requestId,
          response: {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "The ClipQuest extension stopped responding.",
          },
        }),
      );
  });

  void announce();
})();
