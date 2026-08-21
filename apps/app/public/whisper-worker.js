import { env, pipeline } from "/runtime/transformers.web.min.js";

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.cacheKey = "clipquest-whisper-v1";
env.backends.onnx.wasm.wasmPaths = "/runtime/";

let transcriber;
let activeRun = 0;
let captureRun = 0;
let captureQueue = Promise.resolve();

self.onmessage = async (event) => {
  if (event.data?.type === "cancel") {
    activeRun += 1;
    captureRun += 1;
    return;
  }
  if (event.data?.type === "preload") {
    const run = ++activeRun;
    try {
      await loadTranscriber(event.data.manifest, run);
      if (run === activeRun) self.postMessage({ type: "preloaded" });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  if (event.data?.type === "transcribe-chunk") {
    const data = event.data;
    const run = captureRun;
    captureQueue = captureQueue.then(async () => {
      if (run !== captureRun) return;
      try {
        const activeTranscriber = await loadTranscriber(
          data.manifest,
          activeRun,
        );
        if (run !== captureRun) return;
        self.postMessage({ type: "phase", phase: "transcribing_device" });
        const output = await activeTranscriber(data.pcm, {
          language: normalizeLanguage(data.language),
          task: "transcribe",
          return_timestamps: true,
          chunk_length_s: 30,
          stride_length_s: 0,
        });
        if (run !== captureRun) return;
        self.postMessage({
          type: "chunk",
          chunkIndex: data.chunkIndex,
          segments: normalizeOutput(
            output,
            data.chunkIndex,
            data.chunkStartSeconds,
            data.pcm.length / 16_000,
          ),
        });
      } catch (error) {
        self.postMessage({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
    return;
  }
  if (event.data?.type !== "transcribe") return;
  const run = ++activeRun;
  try {
    const { pcm, language, manifest, startChunk = 0 } = event.data;
    await loadTranscriber(manifest, run);
    if (run !== activeRun) return;
    self.postMessage({ type: "phase", phase: "transcribing_device", device });
    const sampleRate = 16_000;
    const chunkSamples = sampleRate * 30;
    const stepSamples = sampleRate * 25;
    const totalChunks = Math.max(
      1,
      Math.ceil(Math.max(0, pcm.length - chunkSamples) / stepSamples) + 1,
    );
    for (
      let chunkIndex = startChunk;
      chunkIndex < totalChunks;
      chunkIndex += 1
    ) {
      if (run !== activeRun) return;
      const offset = chunkIndex * stepSamples;
      const audio = pcm.subarray(
        offset,
        Math.min(pcm.length, offset + chunkSamples),
      );
      const output = await transcriber(audio, {
        language: normalizeLanguage(language),
        task: "transcribe",
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 0,
      });
      const chunkStartSeconds = offset / sampleRate;
      const segments = normalizeOutput(
        output,
        chunkIndex,
        chunkStartSeconds,
        audio.length / sampleRate,
      );
      self.postMessage({ type: "chunk", chunkIndex, totalChunks, segments });
    }
    self.postMessage({ type: "done" });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

async function loadTranscriber(manifest, run) {
  const base = `${self.location.origin}/api/models/files/`;
  env.remoteHost = base;
  env.remotePathTemplate = "{model}/resolve/{revision}/";
  env.fetch = async (url, options = {}) => {
    const response = await fetch(url, { ...options, credentials: "include" });
    const pathname = new URL(typeof url === "string" ? url : url.url).pathname;
    const expected = manifest.web.files.find((file) =>
      pathname.endsWith(`/${file.path}`),
    );
    if (response.ok && expected) {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await response.clone().arrayBuffer(),
      );
      const actual = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      if (actual !== expected.sha256)
        throw new Error(
          `Speech model integrity check failed for ${expected.path}.`,
        );
    }
    return response;
  };
  const device = self.navigator?.gpu ? "webgpu" : "wasm";
  if (!transcriber) {
    self.postMessage({ type: "phase", phase: "downloading_model", device });
    transcriber = await pipeline(
      "automatic-speech-recognition",
      manifest.web.repository,
      {
        revision: manifest.revision,
        device,
        dtype: "q8",
        progress_callback: (progress) => {
          if (run !== activeRun) return;
          if (
            progress.status === "progress" ||
            progress.status === "progress_total"
          ) {
            self.postMessage({
              type: "model-progress",
              progress: Math.max(
                0,
                Math.min(1, Number(progress.progress ?? 0) / 100),
              ),
              loaded: Number(progress.loaded ?? 0),
              total: Number(progress.total ?? manifest.web.sizeBytes),
            });
          }
        },
      },
    );
  } else {
    self.postMessage({
      type: "model-progress",
      progress: 1,
      loaded: manifest.web.sizeBytes,
      total: manifest.web.sizeBytes,
      cached: true,
    });
  }
  return transcriber;
}

function normalizeLanguage(language) {
  if (!language) return null;
  if (language.toLowerCase().startsWith("zh")) return "chinese";
  if (language.toLowerCase().startsWith("en")) return "english";
  return null;
}

function normalizeOutput(
  output,
  chunkIndex,
  chunkStartSeconds,
  chunkDurationSeconds,
) {
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  if (!chunks.length && String(output?.text ?? "").trim()) {
    return [
      {
        id: `device-${chunkIndex}-0`,
        startMs: Math.round(chunkStartSeconds * 1000),
        endMs: Math.round((chunkStartSeconds + chunkDurationSeconds) * 1000),
        text: String(output.text).trim(),
      },
    ];
  }
  return chunks.flatMap((chunk, index) => {
    const text = String(chunk?.text ?? "").trim();
    const timestamp = Array.isArray(chunk?.timestamp)
      ? chunk.timestamp
      : [0, chunkDurationSeconds];
    const localStart = Number(timestamp[0] ?? 0);
    const localEnd = Number(
      timestamp[1] ?? Math.min(chunkDurationSeconds, localStart + 4),
    );
    if (!text || (chunkIndex > 0 && localEnd <= 5)) return [];
    const start =
      chunkStartSeconds + Math.max(chunkIndex > 0 ? 5 : 0, localStart);
    const end = Math.max(
      start + 0.05,
      chunkStartSeconds + Math.min(chunkDurationSeconds, localEnd),
    );
    return [
      {
        id: `device-${chunkIndex}-${index}`,
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        text,
      },
    ];
  });
}
