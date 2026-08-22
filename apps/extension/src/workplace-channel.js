// Workplace chat: website -> injected bridge -> background port channel.
//
// This module owns the *extension side* of a full Workplace study turn. The
// authenticated ClipQuest page opens a dedicated port through the injected
// bridge; this handler runs the shared, platform-free orchestrator
// (`runWorkplaceChatTurn`) and streams its parsed events back to the page while
// keeping two hard boundaries intact:
//
//   1. The learner's DeepSeek API key never leaves extension storage. It is
//      read here, handed to the orchestrator (which only ever places it in the
//      Authorization header), and is never posted to the page, serialized into
//      an event, a tool argument, a tool result, or a log line.
//   2. Raw captions and full notes never become synced events. Local caption
//      reads happen in the extension via the existing YouTube caption/source
//      mechanism and only bounded, sanitized, provenance-tagged excerpts are
//      handed to the model; only the orchestrator's bounded citations/summaries
//      are ever streamed to the page.
//
// The channel is stateless per connection: a Workplace turn is not replayed
// across a service-worker restart, so the transport terminal (`workplace-result`)
// is delivered exactly once through the `settled` guard below.

import {
  runWorkplaceChatTurn,
  sanitizeWorkplaceSourceText,
  WORKPLACE_CHAT_LIMITS,
} from "./workplace-chat.js";

export const WORKPLACE_AI_PORT = "clipquest-workplace-ai-v1";
export const WORKPLACE_CHAT_CAPABILITY = "workplace-chat-v1";
// A page-side tool handshake (owned library metadata / notes) must complete in
// bounded time so a slow or absent page handler cannot strand a turn.
export const MAX_WORKPLACE_PAGE_TOOL_MS = 15_000;

const YOUTUBE_VIDEO_ID = /^[\w-]{11}$/;
const DEFAULT_MAX_EXCERPTS = 3;

export function isWorkplaceChatRequest(message) {
  return (
    !!message &&
    typeof message === "object" &&
    message.type === "workplace-chat" &&
    typeof message.requestId === "string" &&
    message.requestId.length > 0 &&
    message.requestId.length <= 100 &&
    typeof message.text === "string" &&
    message.text.trim().length > 0
  );
}

function clampExcerptCount(value) {
  const requested = typeof value === "number" ? Math.trunc(value) : NaN;
  if (!Number.isFinite(requested) || requested < 1) return DEFAULT_MAX_EXCERPTS;
  return Math.min(requested, WORKPLACE_CHAT_LIMITS.maxSourceExcerptsPerRead);
}

function queryTerms(query) {
  return String(query ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 2)
    .slice(0, 12);
}

// Select up to `maxExcerpts` bounded, sanitized caption excerpts, preferring
// segments that match the query. The raw segment array is never returned.
export function selectCaptionExcerpts(source, videoId, query, maxExcerpts) {
  const segments = Array.isArray(source?.segments) ? source.segments : [];
  const terms = queryTerms(query);
  const ranked = segments
    .map((segment, index) => {
      const text = String(segment?.text ?? "").toLowerCase();
      const score = terms.reduce(
        (total, term) => (text.includes(term) ? total + 1 : total),
        0,
      );
      return { segment, index, score };
    })
    .filter((entry) => (terms.length === 0 ? true : entry.score > 0));

  const chosen = (
    terms.length === 0 ? ranked : [...ranked].sort((a, b) => b.score - a.score)
  )
    .slice(0, Math.max(1, maxExcerpts))
    .sort((a, b) => a.index - b.index);

  return chosen.map((entry) => {
    const startMs = Number(entry.segment?.startMs) || 0;
    const endMs = Number(entry.segment?.endMs);
    return {
      videoId,
      title: String(source?.title ?? "").slice(0, 300) || "Untitled video",
      startMs,
      endMs: Number.isFinite(endMs) && endMs > startMs ? endMs : startMs + 1,
      quote: sanitizeWorkplaceSourceText(
        entry.segment?.text,
        WORKPLACE_CHAT_LIMITS.maxCitationQuoteLength,
      ),
    };
  });
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function boundSourceReadResult(result) {
  const excerpts = Array.isArray(result?.excerpts)
    ? result.excerpts
        .slice(0, WORKPLACE_CHAT_LIMITS.maxSourceExcerptsPerRead)
        .map((excerpt) => ({
          videoId: asString(excerpt?.videoId),
          title: asString(excerpt?.title).slice(0, 300) || "Untitled",
          startMs: Number(excerpt?.startMs) || 0,
          endMs: Number(excerpt?.endMs) || 1,
          quote: sanitizeWorkplaceSourceText(
            excerpt?.quote,
            WORKPLACE_CHAT_LIMITS.maxCitationQuoteLength,
          ),
        }))
        .filter((excerpt) => excerpt.quote)
    : [];
  return {
    summary: sanitizeWorkplaceSourceText(
      result?.summary ?? "",
      WORKPLACE_CHAT_LIMITS.maxToolResultSummaryLength,
    ),
    excerpts,
    transcriptComplete: result?.transcriptComplete === true,
  };
}

/**
 * Build the injected tool set the orchestrator calls during a Workplace turn.
 *
 * `extractCaptions(videoId, signal)` uses the existing extension caption/source
 * mechanism; its raw captions stay local and only bounded excerpts are emitted.
 * `requestPageTool(name, args, signal)` performs the bounded, authenticated
 * page handshake for owned-library metadata / saved notes that the extension
 * cannot see. It must resolve to already-bounded data.
 */
export function createExtensionWorkplaceTools({
  extractCaptions,
  requestPageTool,
} = {}) {
  const delegate = async (name, args, ctx) => {
    if (typeof requestPageTool !== "function") {
      const error = new Error(
        "This source is only available from the ClipQuest page.",
      );
      error.code = "page_tool_unavailable";
      throw error;
    }
    return requestPageTool(name, args, ctx?.signal);
  };

  return {
    async searchLibrary(args, ctx) {
      const result = await delegate("search_library", args, ctx);
      return {
        summary: sanitizeWorkplaceSourceText(
          result?.summary ?? "",
          WORKPLACE_CHAT_LIMITS.maxToolResultSummaryLength,
        ),
        results: Array.isArray(result?.results) ? result.results : undefined,
        citations: Array.isArray(result?.citations)
          ? result.citations
          : undefined,
      };
    },

    async readVideoCaptions(args, ctx) {
      const videoId = asString(args?.videoId);
      const query = asString(args?.query);
      const maxExcerpts = clampExcerptCount(args?.maxExcerpts);
      if (
        YOUTUBE_VIDEO_ID.test(videoId) &&
        typeof extractCaptions === "function"
      ) {
        const response = await extractCaptions(videoId, ctx?.signal);
        const segments =
          response?.ok && Array.isArray(response.result?.segments)
            ? response.result.segments
            : null;
        if (segments) {
          const excerpts = selectCaptionExcerpts(
            { segments, title: response.result?.title },
            videoId,
            query,
            maxExcerpts,
          );
          return {
            summary: `Read ${excerpts.length} local caption excerpt${
              excerpts.length === 1 ? "" : "s"
            }.`,
            excerpts,
            transcriptComplete: response.result?.transcriptComplete === true,
          };
        }
      }
      return boundSourceReadResult(
        await delegate("read_video_captions", args, ctx),
      );
    },

    async readPdfNotes(args, ctx) {
      return boundSourceReadResult(await delegate("read_pdf_notes", args, ctx));
    },

    async createPracticeSet(args, ctx) {
      const artifact = await delegate("create_practice_set", args, ctx);
      if (!artifact || typeof artifact !== "object") {
        const error = new Error("The practice set could not be built.");
        error.code = "practice_unavailable";
        throw error;
      }
      return artifact;
    },
  };
}

function terminalResponseFor(error, aborted) {
  const code =
    typeof error?.code === "string" && error.code
      ? error.code
      : aborted
        ? "aborted"
        : "workplace_turn_failed";
  return {
    ok: false,
    code,
    error:
      error instanceof Error && error.message
        ? error.message
        : "The Workplace turn failed.",
  };
}

function summarizeTurnResult(result) {
  return {
    finalText: typeof result?.finalText === "string" ? result.finalText : "",
    stopReason:
      typeof result?.stopReason === "string" ? result.stopReason : "complete",
    rounds: Number(result?.rounds) || 0,
    toolCalls: Number(result?.toolCalls) || 0,
    sourceReads: Number(result?.sourceReads) || 0,
    toolResults: Array.isArray(result?.toolResults) ? result.toolResults : [],
    practiceSet: result?.practiceSet ?? null,
  };
}

/**
 * Wire a connected Workplace port to the shared orchestrator.
 *
 * `deps.getApiKey()` resolves the stored DeepSeek key (or a non-string when
 * absent). `deps.extractCaptions(videoId, signal)` reads local captions.
 * `deps.runTurn` defaults to the shared `runWorkplaceChatTurn` and is injected
 * in tests. The handler guarantees exactly one terminal `workplace-result`.
 */
export function attachWorkplaceChannel(port, deps = {}) {
  const { getApiKey, extractCaptions, runTurn = runWorkplaceChatTurn } = deps;

  let started = false;
  let settled = false;
  let connected = true;
  const controller = new AbortController();
  const pageToolWaiters = new Map();

  const post = (message) => {
    if (!connected) return;
    try {
      port.postMessage(message);
    } catch {
      connected = false;
      controller.abort(new Error("The website disconnected."));
    }
  };

  const finish = (requestId, response) => {
    if (settled) return;
    settled = true;
    for (const waiter of pageToolWaiters.values()) waiter.reject(controller);
    pageToolWaiters.clear();
    post({ type: "workplace-result", requestId, response });
  };

  const requestPageTool = (name, args, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("The Workplace turn was cancelled."));
        return;
      }
      const toolCallId = `page-${name}-${Math.random().toString(36).slice(2, 12)}`;
      const timer = setTimeout(() => {
        pageToolWaiters.delete(toolCallId);
        const error = new Error("The ClipQuest page did not answer in time.");
        error.code = "page_tool_timeout";
        reject(error);
      }, MAX_WORKPLACE_PAGE_TOOL_MS);
      const onAbort = () => {
        clearTimeout(timer);
        pageToolWaiters.delete(toolCallId);
        reject(new Error("The Workplace turn was cancelled."));
      };
      signal?.addEventListener?.("abort", onAbort, { once: true });
      pageToolWaiters.set(toolCallId, {
        resolve: (result) => {
          clearTimeout(timer);
          signal?.removeEventListener?.("abort", onAbort);
          resolve(result);
        },
        reject: () => {
          clearTimeout(timer);
          signal?.removeEventListener?.("abort", onAbort);
          reject(new Error("The Workplace turn was cancelled."));
        },
      });
      // The API key is never included in a tool request.
      post({ type: "tool-request", toolCallId, name, arguments: args });
    });

  port.onDisconnect.addListener(() => {
    connected = false;
    controller.abort(new Error("The website disconnected."));
  });

  port.onMessage.addListener((message) => {
    if (message?.type === "heartbeat") return;
    if (message?.type === "cancel") {
      controller.abort(new Error("The learner cancelled the Workplace turn."));
      return;
    }
    if (message?.type === "tool-result") {
      const waiter = pageToolWaiters.get(message.toolCallId);
      if (waiter) {
        pageToolWaiters.delete(message.toolCallId);
        waiter.resolve(message.result);
      }
      return;
    }
    if (started) return;
    if (!isWorkplaceChatRequest(message)) {
      // Reject the first, malformed request rather than silently hanging.
      if (message?.type === "workplace-chat") {
        started = true;
        finish(
          typeof message?.requestId === "string" ? message.requestId : "",
          {
            ok: false,
            code: "invalid_request",
            error: "The Workplace request was malformed.",
          },
        );
      }
      return;
    }
    started = true;
    const requestId = message.requestId;

    void Promise.resolve()
      .then(async () => {
        const apiKey = await getApiKey();
        if (typeof apiKey !== "string" || apiKey.trim() === "") {
          const error = new Error(
            "Open ClipQuest from the Chrome toolbar and add your DeepSeek API key.",
          );
          error.code = "missing_key";
          throw error;
        }
        const tools = createExtensionWorkplaceTools({
          extractCaptions,
          requestPageTool,
        });
        const onEvent = (event) => {
          post({ type: "workplace-event", requestId, event });
        };
        return runTurn({
          apiKey,
          userText: message.text,
          thread: Array.isArray(message.thread) ? message.thread : [],
          recentVideoIds: Array.isArray(message.recentVideoIds)
            ? message.recentVideoIds
            : [],
          tools,
          onEvent,
          signal: controller.signal,
        });
      })
      .then((result) => {
        finish(requestId, { ok: true, result: summarizeTurnResult(result) });
      })
      .catch((error) => {
        finish(
          requestId,
          terminalResponseFor(error, controller.signal.aborted),
        );
      });
  });
}
