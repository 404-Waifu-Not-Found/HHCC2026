(function installClipQuestBridge() {
  "use strict";

  if (globalThis.__clipQuestCaptionBridgeInstalled) return;
  globalThis.__clipQuestCaptionBridgeInstalled = true;

  const CHANNEL = "clipquest:captions:v1";
  const WEBSITE_SOURCE = "clipquest-website";
  const EXTENSION_SOURCE = "clipquest-extension";
  const LOCAL_AI_PORT = "clipquest-local-ai-v1";
  const WORKPLACE_AI_PORT = "clipquest-workplace-ai-v1";
  // Keep the page-side generation watchdog informed while the service worker
  // is doing bounded local evidence work or waiting for a slow DeepSeek
  // stream. The port heartbeat alone keeps Chrome's worker alive, but it is
  // invisible to the app and can otherwise look like a disconnected request.
  const HEARTBEAT_INTERVAL_MS = 15_000;
  const MAX_GENERATION_PORT_RECONNECTS = 2;
  const MAX_WORKPLACE_PORT_RECONNECTS = 2;

  // Track in-flight Workplace turns by requestId so a route departure or an
  // explicit page cancel can stop the corresponding background turn.
  const workplaceTurns = new Map();

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
          "workplace-chat-v1",
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
      message.type === "workplace-cancel" &&
      typeof message.requestId === "string"
    ) {
      workplaceTurns.get(message.requestId)?.cancel();
      return;
    }
    if (
      message.type === "workplace-tool-result" &&
      typeof message.requestId === "string" &&
      typeof message.toolCallId === "string"
    ) {
      // The authenticated page answered a bounded tool handshake with owned
      // library metadata / notes. Relay it to the running background turn.
      workplaceTurns.get(message.requestId)?.forwardToolResult({
        type: "tool-result",
        toolCallId: message.toolCallId,
        result: message.result,
      });
      return;
    }
    if (
      message.type === "workplace-chat" &&
      typeof message.requestId === "string" &&
      typeof message.text === "string"
    ) {
      const requestId = message.requestId;
      if (workplaceTurns.has(requestId)) return;
      let port;
      let heartbeat;
      let reconnectTimer;
      let reconnectAttempts = 0;
      let settled = false;
      let acceptedByWorker = false;
      const outbound = {
        type: "workplace-chat",
        requestId,
        text: message.text,
        thread: Array.isArray(message.thread) ? message.thread : undefined,
        recentVideoIds: Array.isArray(message.recentVideoIds)
          ? message.recentVideoIds
          : undefined,
      };
      const finish = (response) => {
        if (settled) return;
        settled = true;
        workplaceTurns.delete(requestId);
        if (heartbeat) clearInterval(heartbeat);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        post({ type: "workplace-result", requestId, response });
        try {
          port?.disconnect();
        } catch {
          // The port may already be disconnected during worker recovery.
        }
      };
      const send = (payload) => {
        try {
          port.postMessage(payload);
        } catch {
          scheduleReconnect();
        }
      };
      const startHeartbeat = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = setInterval(() => {
          try {
            port.postMessage({ type: "heartbeat", requestId });
          } catch {
            scheduleReconnect();
          }
        }, HEARTBEAT_INTERVAL_MS);
      };
      const handleResponse = (response) => {
        if (
          response?.requestId !== undefined &&
          response.requestId !== requestId
        )
          return;
        if (!acceptedByWorker) {
          acceptedByWorker = true;
          // The worker responded at least once: confirm the accepted/ready
          // handshake to the page before forwarding stream events.
          post({ type: "workplace-accepted", requestId });
        }
        if (response.type === "workplace-event") {
          post({ type: "workplace-event", requestId, event: response.event });
          return;
        }
        if (response.type === "tool-request") {
          post({
            type: "workplace-tool-request",
            requestId,
            toolCallId: response.toolCallId,
            name: response.name,
            arguments: response.arguments,
          });
          return;
        }
        if (response.type === "workplace-result") finish(response.response);
      };
      function scheduleReconnect() {
        if (settled || reconnectTimer) return;
        if (heartbeat) clearInterval(heartbeat);
        if (reconnectAttempts >= MAX_WORKPLACE_PORT_RECONNECTS) {
          finish({
            ok: false,
            code: "extension_unavailable",
            error:
              chrome.runtime.lastError?.message ??
              "The ClipQuest extension stopped responding.",
          });
          return;
        }
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = undefined;
          if (settled) return;
          try {
            port = chrome.runtime.connect({ name: WORKPLACE_AI_PORT });
            attachPort(port, false);
          } catch (error) {
            finish({
              ok: false,
              code: "extension_unavailable",
              error:
                error instanceof Error
                  ? error.message
                  : "The ClipQuest extension stopped responding.",
            });
          }
        }, reconnectAttempts * 1_000);
      }
      function attachPort(nextPort, dispatch) {
        port = nextPort;
        port.onMessage.addListener(handleResponse);
        port.onDisconnect.addListener(scheduleReconnect);
        startHeartbeat();
        // A fresh reconnect cannot resume a stateless turn, so only the first
        // attachment dispatches the request. Bounded reconnects keep the page
        // watchdog honest and end in a single terminal result either way.
        if (dispatch) send(outbound);
      }
      workplaceTurns.set(requestId, {
        cancel: () => send({ type: "cancel", requestId }),
        forwardToolResult: (payload) => send(payload),
      });
      try {
        attachPort(chrome.runtime.connect({ name: WORKPLACE_AI_PORT }), true);
      } catch (error) {
        finish({
          ok: false,
          code: "extension_unavailable",
          error:
            error instanceof Error
              ? error.message
              : "The ClipQuest extension could not start Workplace chat.",
        });
      }
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
      let heartbeat;
      let reconnectTimer;
      let reconnectAttempts = 0;
      let settled = false;
      let acceptedByWorker = false;
      let lastProgress = 0.2;
      const outbound = {
        type: "generate",
        requestId,
        context: message.context,
        kind: message.kind,
      };
      const finish = (response) => {
        if (settled) return;
        settled = true;
        if (heartbeat) clearInterval(heartbeat);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        post({ type: "generation-result", requestId, response });
        try {
          port?.disconnect();
        } catch {
          // The port may already be disconnected during worker recovery.
        }
      };
      const sendOutbound = (nextPort) => {
        try {
          nextPort.postMessage(outbound);
        } catch (error) {
          // Chrome's extension boundary only accepts structured-cloneable
          // values. Retry once with a plain JSON object so a client-side
          // prototype/typed-value cannot become an opaque dispatch timeout.
          try {
            nextPort.postMessage({
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
      };
      const startHeartbeat = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = setInterval(() => {
          try {
            port.postMessage({ type: "heartbeat", requestId });
            // A connected port only proves that Chrome created a transport.
            // Do not tell the page that generation is alive until the service
            // worker has answered at least once. Otherwise a lost first
            // dispatch can refresh the page watchdog forever and strand an
            // incomplete quiz behind a synthetic progress heartbeat.
            if (!acceptedByWorker) return;
            post({
              type: "generation-progress",
              requestId,
              stage: "creating_questions",
              progress: lastProgress,
              attempt: 1,
              maxAttempts: 3,
              status: "generating",
            });
          } catch {
            scheduleReconnect();
          }
        }, HEARTBEAT_INTERVAL_MS);
      };
      const handleResponse = (response) => {
        if (response?.requestId !== requestId) return;
        acceptedByWorker = true;
        if (response.type === "progress") {
          if (typeof response.progress === "number") {
            lastProgress = Math.max(lastProgress, response.progress);
          }
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
      };
      function scheduleReconnect() {
        if (settled || reconnectTimer) return;
        if (heartbeat) clearInterval(heartbeat);
        if (reconnectAttempts >= MAX_GENERATION_PORT_RECONNECTS) {
          finish({
            ok: false,
            error:
              chrome.runtime.lastError?.message ??
              "The ClipQuest extension stopped responding.",
          });
          return;
        }
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = undefined;
          if (settled) return;
          try {
            port = chrome.runtime.connect({ name: LOCAL_AI_PORT });
            attachPort(port);
          } catch (error) {
            finish({
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "The ClipQuest extension stopped responding.",
            });
          }
        }, reconnectAttempts * 1_000);
      }
      function attachPort(nextPort) {
        port = nextPort;
        port.onMessage.addListener(handleResponse);
        port.onDisconnect.addListener(scheduleReconnect);
        startHeartbeat();
        sendOutbound(port);
      }
      try {
        attachPort(chrome.runtime.connect({ name: LOCAL_AI_PORT }));
      } catch (error) {
        finish({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "The ClipQuest extension could not start local generation.",
        });
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
