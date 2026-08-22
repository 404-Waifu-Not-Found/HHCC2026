import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WORKPLACE_AI_PORT,
  WORKPLACE_CHAT_CAPABILITY,
  attachWorkplaceChannel,
  createExtensionWorkplaceTools,
  isWorkplaceChatRequest,
  selectCaptionExcerpts,
} from "../src/workplace-channel.js";

const background = await readFile(
  new URL("../src/background.js", import.meta.url),
  "utf8",
);
const bridge = await readFile(
  new URL("../src/clipquest-bridge.js", import.meta.url),
  "utf8",
);
const channel = await readFile(
  new URL("../src/workplace-channel.js", import.meta.url),
  "utf8",
);
const buildScript = await readFile(
  new URL("../scripts/build.mjs", import.meta.url),
  "utf8",
);
const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

// A minimal stand-in for a Chrome runtime port that records outbound messages
// and lets a test drive inbound messages / disconnects.
function fakePort() {
  const messageListeners = [];
  const disconnectListeners = [];
  return {
    posted: [],
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    onDisconnect: { addListener: (fn) => disconnectListeners.push(fn) },
    postMessage(message) {
      this.posted.push(message);
    },
    disconnect() {
      this.disconnected = true;
    },
    emit(message) {
      for (const fn of messageListeners) fn(message);
    },
    fireDisconnect() {
      for (const fn of disconnectListeners) fn();
    },
  };
}

const TEST_KEY = "sk-workplace-secret-key-should-never-leak-1234567890";

function results(port) {
  return port.posted.filter((m) => m.type === "workplace-result");
}
function events(port) {
  return port.posted.filter((m) => m.type === "workplace-event");
}
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("the bridge advertises the workplace-chat capability and port", () => {
  assert.equal(WORKPLACE_CHAT_CAPABILITY, "workplace-chat-v1");
  assert.equal(WORKPLACE_AI_PORT, "clipquest-workplace-ai-v1");
  assert.match(bridge, /"workplace-chat-v1"/);
  assert.match(bridge, /WORKPLACE_AI_PORT = "clipquest-workplace-ai-v1"/);
  assert.match(background, /WORKPLACE_AI_PORT/);
  assert.match(background, /attachWorkplaceChannel/);
  assert.equal(manifest.version, "0.8.33");
  assert.equal(packageJson.version, "0.8.33");
});

test("version and capability gating uses the exact ClipQuest origin", () => {
  // The background only attaches the channel for the exact ClipQuest origin.
  assert.match(
    background,
    /port\.name !== WORKPLACE_AI_PORT[\s\S]*senderAllowed\(port\.sender\)/,
  );
  assert.match(background, /code: "origin_forbidden"/);
  // The page-side gating (version + capability + upgrade-required copy) lives in
  // the app bridge; the extension announces the capability so the page can gate.
  assert.doesNotMatch(bridge, /localhost/);
});

test("a successful turn streams parsed events and one terminal result", async () => {
  const port = fakePort();
  const runTurn = async ({ apiKey, userText, onEvent }) => {
    assert.equal(apiKey, TEST_KEY);
    assert.equal(userText, "Explain gradient descent");
    await onEvent({ type: "text_delta", delta: "Gradient" });
    await onEvent({
      type: "text_complete",
      text: "Gradient descent explained.",
    });
    await onEvent({ type: "complete" });
    return {
      finalText: "Gradient descent explained.",
      stopReason: "complete",
      rounds: 1,
      toolCalls: 0,
      sourceReads: 0,
      toolResults: [],
      practiceSet: null,
    };
  };
  attachWorkplaceChannel(port, {
    getApiKey: async () => TEST_KEY,
    runTurn,
  });
  port.emit({
    type: "workplace-chat",
    requestId: "req-1",
    text: "Explain gradient descent",
  });
  await flush();

  const streamed = events(port);
  assert.deepEqual(
    streamed.map((m) => m.event.type),
    ["text_delta", "text_complete", "complete"],
  );
  assert.ok(streamed.every((m) => m.requestId === "req-1"));
  const terminal = results(port);
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].response.ok, true);
  assert.equal(
    terminal[0].response.result.finalText,
    "Gradient descent explained.",
  );
});

test("the heartbeat and bounded reconnect are wired on the page side", () => {
  assert.match(bridge, /type: "heartbeat", requestId/);
  assert.match(bridge, /MAX_WORKPLACE_PORT_RECONNECTS = 2/);
  assert.match(bridge, /function scheduleReconnect\(\)/);
  assert.match(bridge, /reconnectAttempts >= MAX_WORKPLACE_PORT_RECONNECTS/);
  assert.match(bridge, /type: "workplace-accepted", requestId/);
  // A stateless reconnect must not silently start a second DeepSeek turn.
  assert.match(bridge, /if \(dispatch\) send\(outbound\)/);
});

test("cancel from the page aborts the turn with a single terminal error", async () => {
  const port = fakePort();
  const runTurn = ({ signal, onEvent }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", async () => {
        await onEvent({
          type: "error",
          code: "aborted",
          message: "Turn aborted.",
        });
        const error = new Error("Turn aborted.");
        error.code = "aborted";
        reject(error);
      });
    });
  attachWorkplaceChannel(port, { getApiKey: async () => TEST_KEY, runTurn });
  port.emit({ type: "workplace-chat", requestId: "req-2", text: "hello" });
  await flush();
  port.emit({ type: "cancel", requestId: "req-2" });
  await flush();

  const terminal = results(port);
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].response.ok, false);
  assert.equal(terminal[0].response.code, "aborted");
});

test("a port disconnect aborts and still terminates exactly once", async () => {
  const port = fakePort();
  const runTurn = ({ signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("The website disconnected.");
        error.code = "aborted";
        reject(error);
      });
    });
  attachWorkplaceChannel(port, { getApiKey: async () => TEST_KEY, runTurn });
  port.emit({ type: "workplace-chat", requestId: "req-3", text: "hi" });
  await flush();
  // A disconnect marks the port closed; no further messages may be posted.
  port.fireDisconnect();
  await flush();
  assert.equal(results(port).length, 0);
});

test("unknown and malformed requests are rejected without hanging", async () => {
  const malformed = fakePort();
  let ran = false;
  attachWorkplaceChannel(malformed, {
    getApiKey: async () => TEST_KEY,
    runTurn: async () => {
      ran = true;
      return {};
    },
  });
  // Missing text.
  malformed.emit({ type: "workplace-chat", requestId: "req-4" });
  await flush();
  assert.equal(ran, false);
  const terminal = results(malformed);
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].response.ok, false);
  assert.equal(terminal[0].response.code, "invalid_request");

  // A wholly unknown message type is ignored (no terminal, no crash).
  const unknown = fakePort();
  attachWorkplaceChannel(unknown, {
    getApiKey: async () => TEST_KEY,
    runTurn: async () => ({}),
  });
  unknown.emit({ type: "not-a-workplace-message", requestId: "x" });
  await flush();
  assert.equal(results(unknown).length, 0);
  assert.equal(isWorkplaceChatRequest({ type: "workplace-chat" }), false);
  assert.equal(
    isWorkplaceChatRequest({
      type: "workplace-chat",
      requestId: "a",
      text: " ",
    }),
    false,
  );
});

test("a missing DeepSeek key ends the turn without invoking the engine", async () => {
  const port = fakePort();
  let ran = false;
  attachWorkplaceChannel(port, {
    getApiKey: async () => undefined,
    runTurn: async () => {
      ran = true;
      return {};
    },
  });
  port.emit({ type: "workplace-chat", requestId: "req-5", text: "hello" });
  await flush();
  assert.equal(ran, false);
  const terminal = results(port);
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].response.ok, false);
  assert.equal(terminal[0].response.code, "missing_key");
});

test("the DeepSeek key never appears in any message posted to the page", async () => {
  const port = fakePort();
  const runTurn = async ({ apiKey, tools, onEvent }) => {
    assert.equal(apiKey, TEST_KEY);
    // Even a tool handshake must not carry the key.
    void tools.searchLibrary({ query: "x" }, {}).catch(() => undefined);
    await onEvent({ type: "text_delta", delta: "answer" });
    await onEvent({ type: "complete" });
    return {
      finalText: "answer",
      stopReason: "complete",
      toolResults: [],
      practiceSet: null,
    };
  };
  attachWorkplaceChannel(port, { getApiKey: async () => TEST_KEY, runTurn });
  port.emit({ type: "workplace-chat", requestId: "req-6", text: "hi" });
  await flush();
  const serialized = JSON.stringify(port.posted);
  assert.doesNotMatch(serialized, /sk-workplace-secret-key/);
});

test("local caption reads emit only bounded excerpts, never the raw transcript", async () => {
  const secret = "UNIQUE_RAW_TRANSCRIPT_MARKER";
  const segments = Array.from({ length: 40 }, (_, index) => ({
    id: `seg-${index}`,
    startMs: index * 1_000,
    endMs: index * 1_000 + 900,
    text: `gradient descent detail ${index} ${secret} ${"x".repeat(600)}`,
  }));
  const extractCaptions = async () => ({
    ok: true,
    result: { title: "Neural networks", segments, transcriptComplete: true },
  });
  const tools = createExtensionWorkplaceTools({ extractCaptions });
  const read = await tools.readVideoCaptions(
    { videoId: "aircAruvnKk", query: "gradient descent" },
    { signal: undefined },
  );
  // Bounded excerpt count and quote length; the raw 40-segment array is gone.
  assert.ok(Array.isArray(read.excerpts));
  assert.ok(read.excerpts.length <= 5);
  assert.ok(read.excerpts.length < segments.length);
  for (const excerpt of read.excerpts) {
    assert.ok(excerpt.quote.length <= 320);
  }
  assert.equal(read.transcriptComplete, true);

  // selectCaptionExcerpts never returns the raw segment objects.
  const excerpts = selectCaptionExcerpts(
    { segments, title: "t" },
    "aircAruvnKk",
    "gradient",
    3,
  );
  assert.equal(excerpts.length, 3);
  assert.ok(excerpts.every((e) => typeof e.quote === "string" && !("id" in e)));
});

test("release build bundles and ships the Workplace orchestrator", () => {
  // The channel is copied as source; the orchestrator is bundled self-contained.
  assert.match(buildScript, /"workplace-channel\.js"/);
  assert.match(buildScript, /esbuild\(/);
  assert.match(buildScript, /workplace-chat\.js/);
  assert.match(buildScript, /@clipquest\/contracts/);
  assert.match(background, /\.\/workplace-channel\.js/);
  assert.match(channel, /\.\/workplace-chat\.js/);
});

test("the built extension contains a self-contained Workplace module", async () => {
  const distUrl = new URL(
    "../dist/clipquest-captions-extension/workplace-chat.js",
    import.meta.url,
  );
  let bundle;
  try {
    bundle = await readFile(distUrl, "utf8");
  } catch {
    // The dist directory only exists after `npm run build`; skip when absent.
    return;
  }
  assert.match(bundle, /runWorkplaceChatTurn/);
  assert.doesNotMatch(bundle, /from\s*["']@clipquest\/contracts["']/);
});
