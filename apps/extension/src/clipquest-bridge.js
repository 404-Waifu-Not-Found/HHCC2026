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
        capabilities: [
          "question-stream-v1",
          "question-stream-v2",
          "question-stream-v3",
          "question-stream-v4",
          "question-stream-v5",
          "question-stream-v6",
          "question-stream-v7",
          "cheat-sheet-v1",
          "answer-grading-v1",
          "ensure-source-ready-v1",
        ],
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
      message.type === "ensure-source-ready" &&
      typeof message.requestId === "string" &&
      /^[\w-]{11}$/.test(message.videoId)
    ) {
      void chrome.runtime
        .sendMessage({
          type: "clipquest.source.ensure.v1",
          requestId: message.requestId,
          videoId: message.videoId,
          preferredLanguage:
            typeof message.preferredLanguage === "string"
              ? message.preferredLanguage
              : undefined,
        })
        .then((response) =>
          post({
            type: "source-ready-result",
            requestId: message.requestId,
            response,
          }),
        )
        .catch((error) =>
          post({
            type: "source-ready-result",
            requestId: message.requestId,
            response: {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "The source could not be prepared.",
            },
          }),
        );
      return;
    }
    if (message.type === "open-settings") {
      void chrome.runtime.sendMessage({ type: "clipquest.settings.open.v1" });
      return;
    }
    if (
      message.type === "grade-answer" &&
      typeof message.requestId === "string" &&
      message.request &&
      typeof message.request === "object"
    ) {
      void chrome.runtime
        .sendMessage({
          type: "clipquest.answer.grade.v1",
          requestId: message.requestId,
          request: message.request,
        })
        .then((response) =>
          post({
            type: "answer-grade-result",
            requestId: message.requestId,
            response,
          }),
        )
        .catch((error) =>
          post({
            type: "answer-grade-result",
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
      return;
    }
    if (
      message.type === "generate" &&
      typeof message.requestId === "string" &&
      message.context &&
      typeof message.context === "object"
    ) {
      const requestId = message.requestId;
      let port;
      try {
        port = chrome.runtime.connect({ name: LOCAL_AI_PORT });
      } catch (error) {
        post({
          type: "generation-result",
          requestId,
          response: {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "The ClipQuest extension could not start local generation.",
          },
        });
        return;
      }
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
            retryOrdinal: response.retryOrdinal,
            ordinalAttempt: response.ordinalAttempt,
            retryKind: response.retryKind,
            reasonCode: response.reasonCode,
            recoverySessionId: response.recoverySessionId,
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
        if (response.type === "call") {
          post({
            type: "generation-call",
            requestId,
            event: response.event,
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
      const outbound = {
        type: "generate",
        requestId,
        context: message.context,
        kind: message.kind,
      };
      try {
        port.postMessage(outbound);
      } catch (error) {
        // Chrome's extension boundary only accepts structured-cloneable
        // values. Retry once with a plain JSON object so a client-side
        // prototype/typed-value cannot become an opaque dispatch timeout.
        try {
          port.postMessage({
            ...outbound,
            context: JSON.parse(JSON.stringify(message.context)),
          });
        } catch (retryError) {
          finish({
            ok: false,
            error:
              retryError instanceof Error
                ? retryError.message
                : error instanceof Error
                  ? error.message
                  : "The ClipQuest extension could not dispatch local generation.",
          });
        }
      }
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

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.deepseekApiKey) void announce();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "clipquest.configuration.changed.v1") {
      void announce();
    }
  });

  void announce();
})();
