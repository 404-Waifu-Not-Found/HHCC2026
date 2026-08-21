import { captionsToPlainText } from "./caption-text.js";
import {
  generateLocalQuiz,
  generateQuizFromPlainText,
  testDeepSeekKey,
} from "./local-generator.js";
import { isClipQuestPageOrigin } from "./origin-policy.js";

const CLIPQUEST_MATCHES = [
  "https://clipquest.ccwu.cc/*",
  "http://localhost/*",
  "http://127.0.0.1/*",
];
const TAB_READY_TIMEOUT_MS = 20_000;
const EXTRACTION_TIMEOUT_MS = 45_000;
const API_KEY_STORAGE_KEY = "deepseekApiKey";
const LOCAL_AI_PORT = "clipquest-local-ai-v1";

function extensionPageSender(sender) {
  return (
    sender?.id === chrome.runtime.id &&
    typeof sender?.url === "string" &&
    sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`)
  );
}

function senderAllowed(sender) {
  return isClipQuestPageOrigin(sender?.url ?? sender?.tab?.url ?? "");
}

function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(updated);
      reject(new Error("YouTube took too long to load."));
    }, TAB_READY_TIMEOUT_MS);
    function updated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(updated);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(updated);
    void chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(updated);
          resolve();
        }
      })
      .catch((error) => {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(updated);
        reject(error);
      });
  });
}

async function sendWithRetry(tabId, message) {
  const deadline = Date.now() + 8_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("The YouTube caption reader did not start.");
}

function tabVideoId(tab) {
  try {
    const url = new URL(tab?.url ?? "");
    return url.pathname === "/watch" ? url.searchParams.get("v") : null;
  } catch {
    return null;
  }
}

async function matchingYouTubeTab(videoId) {
  const tabs = await chrome.tabs.query({
    url: ["https://www.youtube.com/watch*", "https://youtube.com/watch*"],
  });
  return tabs.find((tab) => tabVideoId(tab) === videoId) ?? null;
}

async function injectYouTubeExtractor(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["youtube-page.js"],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["caption-core.js", "youtube-content.js"],
  });
}

async function extractCaptionsFromTab(request, tab) {
  if (typeof tab.id !== "number") {
    throw new Error("The existing YouTube tab is unavailable.");
  }
  if (tab.status !== "complete") await waitForTab(tab.id);
  const message = {
    type: "clipquest.youtube.extract.v1",
    videoId: request.videoId,
    preferredLanguage: request.preferredLanguage,
  };
  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    await injectYouTubeExtractor(tab.id);
    response = await sendWithRetry(tab.id, message);
  }
  if (!response?.ok || !response.result) return response;
  return {
    ...response,
    result: {
      ...response.result,
      title:
        typeof tab.title === "string"
          ? tab.title.replace(/\s*-\s*YouTube\s*$/i, "").trim()
          : response.result.title,
    },
  };
}

async function extractCaptions(request) {
  const tab = await matchingYouTubeTab(request.videoId);
  if (!tab) {
    throw new Error(
      "Keep this YouTube video open in a tab while ClipQuest prepares the quiz.",
    );
  }

  let timeout;
  try {
    return await Promise.race([
      extractCaptionsFromTab(request, tab),
      new Promise(
        (_, reject) =>
          (timeout = setTimeout(
            () => reject(new Error("YouTube caption extraction timed out.")),
            EXTRACTION_TIMEOUT_MS,
          )),
      ),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function generateQuizForVideo(request, apiKey, onProgress, signal) {
  if (!/^[\w-]{11}$/.test(request.videoId)) {
    throw new Error("The YouTube video id is invalid.");
  }
  onProgress("getting_video", 0.05);
  const response = await extractCaptions(request);
  if (!response?.ok || !Array.isArray(response.result?.segments)) {
    throw new Error(
      typeof response?.error === "string"
        ? response.error
        : "Caption extraction failed.",
    );
  }
  const plainText = captionsToPlainText(response.result.segments);
  if (!plainText) throw new Error("YouTube returned empty captions.");
  onProgress("creating_questions", 0.15);
  const result = await generateQuizFromPlainText(
    {
      title: response.result.title || `YouTube ${request.videoId}`,
      quizLanguage: request.quizLanguage || "en",
      questionCount: request.questionCount || 15,
      questionTypes: request.questionTypes ?? [
        "multiple_choice",
        "true_false",
        "short_answer",
      ],
      jobId: request.requestId,
      transcriptFingerprint: request.videoId,
      plainText,
    },
    apiKey,
    onProgress,
    signal,
  );
  const filename = `youtube-${request.videoId}-quiz.json`;
  await chrome.downloads.download({
    url: `data:application/json;charset=utf-8,${encodeURIComponent(`${JSON.stringify(result.quiz, null, 2)}\n`)}`,
    filename,
    saveAs: false,
  });
  return {
    ...result,
    source: {
      videoId: request.videoId,
      title: response.result.title || `YouTube ${request.videoId}`,
      language: response.result.language || "und",
      segmentCount: response.result.segments.length,
      plainTextCharacterCount: plainText.length,
    },
    filename,
  };
}

async function downloadPlainTextCaptions(request) {
  if (!/^[\w-]{11}$/.test(request.videoId)) {
    throw new Error("The YouTube video id is invalid.");
  }
  const response = await extractCaptions(request);
  if (!response?.ok || !Array.isArray(response.result?.segments)) {
    throw new Error(
      typeof response?.error === "string"
        ? response.error
        : "Caption extraction failed.",
    );
  }
  const text = captionsToPlainText(response.result.segments);
  if (!text) throw new Error("YouTube returned empty captions.");
  const language = String(response.result.language ?? "und")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .slice(0, 35);
  const filename = `youtube-${request.videoId}-captions-${language || "und"}.txt`;
  await chrome.downloads.download({
    url: `data:text/plain;charset=utf-8,${encodeURIComponent(`${text}\n`)}`,
    filename,
    saveAs: false,
  });
  return {
    filename,
    segmentCount: response.result.segments.length,
    characterCount: text.length,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "clipquest.captions.download-text.v1") {
    if (!extensionPageSender(sender)) {
      sendResponse({
        ok: false,
        error: "Only the ClipQuest extension popup can start a download.",
      });
      return false;
    }
    void downloadPlainTextCaptions(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message : "Caption download failed.",
        }),
      );
    return true;
  }
  if (message?.type === "clipquest.config.v1") {
    if (!senderAllowed(sender)) return false;
    void chrome.storage.local.get(API_KEY_STORAGE_KEY).then((stored) =>
      sendResponse({
        configured: typeof stored[API_KEY_STORAGE_KEY] === "string",
      }),
    );
    return true;
  }
  if (message?.type === "clipquest.key.get.v1") {
    if (!extensionPageSender(sender)) return false;
    void chrome.storage.local.get(API_KEY_STORAGE_KEY).then((stored) =>
      sendResponse({
        configured: typeof stored[API_KEY_STORAGE_KEY] === "string",
      }),
    );
    return true;
  }
  if (message?.type === "clipquest.key.save.v1") {
    if (!extensionPageSender(sender)) return false;
    const key = typeof message.apiKey === "string" ? message.apiKey.trim() : "";
    if (!/^sk-[A-Za-z0-9_-]{12,}$/.test(key)) {
      sendResponse({ ok: false, error: "Enter a valid DeepSeek API key." });
      return false;
    }
    void chrome.storage.local
      .set({ [API_KEY_STORAGE_KEY]: key })
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "clipquest.key.delete.v1") {
    if (!extensionPageSender(sender)) return false;
    void chrome.storage.local
      .remove(API_KEY_STORAGE_KEY)
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "clipquest.key.test.v1") {
    if (!extensionPageSender(sender)) return false;
    const supplied =
      typeof message.apiKey === "string" ? message.apiKey.trim() : "";
    void chrome.storage.local
      .get(API_KEY_STORAGE_KEY)
      .then((stored) => supplied || stored[API_KEY_STORAGE_KEY])
      .then((key) => {
        if (typeof key !== "string")
          throw new Error("Save a DeepSeek API key first.");
        return testDeepSeekKey(key);
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message : "The key test failed.",
        }),
      );
    return true;
  }
  if (message?.type !== "clipquest.extract.v1") return false;
  if (!senderAllowed(sender)) {
    sendResponse({
      ok: false,
      error: "This website is not allowed to use ClipQuest Captions.",
    });
    return false;
  }
  if (!/^[\w-]{11}$/.test(message.videoId)) {
    sendResponse({ ok: false, error: "The YouTube video id is invalid." });
    return false;
  }
  void extractCaptions(message)
    .then((response) => sendResponse(response))
    .catch((error) =>
      sendResponse({
        ok: false,
        error:
          error instanceof Error ? error.message : "Caption extraction failed.",
      }),
    );
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== LOCAL_AI_PORT) return;
  if (!senderAllowed(port.sender) && !extensionPageSender(port.sender)) {
    port.postMessage({
      type: "result",
      requestId: "",
      response: {
        ok: false,
        error: "This website is not allowed to generate quizzes.",
      },
    });
    port.disconnect();
    return;
  }

  let started = false;
  let connected = true;
  const controller = new AbortController();
  const post = (message) => {
    if (!connected) return;
    try {
      port.postMessage(message);
    } catch {
      connected = false;
      controller.abort(new Error("The website disconnected."));
    }
  };
  port.onDisconnect.addListener(() => {
    connected = false;
    controller.abort(new Error("The website disconnected."));
  });
  port.onMessage.addListener((message) => {
    if (message?.type === "heartbeat") return;
    if (
      started ||
      message?.type !== "generate" ||
      typeof message.requestId !== "string" ||
      ((!message.context || typeof message.context !== "object") &&
        !/^[\w-]{11}$/.test(message.videoId))
    ) {
      return;
    }
    started = true;
    const requestId = message.requestId;
    void chrome.storage.local
      .get(API_KEY_STORAGE_KEY)
      .then(async (stored) => {
        const apiKey = stored[API_KEY_STORAGE_KEY];
        if (typeof apiKey !== "string") {
          throw new Error(
            "Open ClipQuest Local AI from the Chrome toolbar and add your DeepSeek API key.",
          );
        }
        const progress = (stage, value, detail = {}) => {
          post({
            type: "progress",
            requestId,
            stage,
            progress: value,
            ...detail,
          });
        };
        return message.context
          ? generateLocalQuiz(
              message.context,
              apiKey,
              progress,
              controller.signal,
            )
          : generateQuizForVideo(message, apiKey, progress, controller.signal);
      })
      .then((result) =>
        post({ type: "result", requestId, response: { ok: true, result } }),
      )
      .catch((error) =>
        post({
          type: "result",
          requestId,
          response: {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Local quiz generation failed.",
          },
        }),
      );
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.tabs.query({ url: CLIPQUEST_MATCHES }).then((tabs) =>
    Promise.all(
      tabs.flatMap((tab) =>
        typeof tab.id === "number"
          ? [
              chrome.scripting
                .executeScript({
                  target: { tabId: tab.id },
                  files: ["clipquest-bridge.js"],
                })
                .catch(() => undefined),
            ]
          : [],
      ),
    ),
  );
});
