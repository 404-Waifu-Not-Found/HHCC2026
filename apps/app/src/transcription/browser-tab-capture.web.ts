import type { TranscriptSegment } from "@clipquest/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSpeechModelManifest } from "./manifest";
import { assertTranscriptQuality } from "./quality";
import { TranscriptionPausedError } from "./types";
import type {
  BrowserCaptureOptions,
  BrowserCaptureResult,
} from "./browser-tab-capture";

type CaptureWorkerMessage =
  | { type: "phase"; phase: "downloading_model" | "transcribing_device" }
  | { type: "model-progress"; progress: number }
  | { type: "preloaded" }
  | { type: "chunk"; chunkIndex: number; segments: TranscriptSegment[] }
  | { type: "error"; message: string };

const SAMPLE_RATE = 16_000;
const CHUNK_SAMPLES = SAMPLE_RATE * 30;
const STEP_SAMPLES = SAMPLE_RATE * 25;
const checkpointKey = (videoId: string) =>
  `clipquest:transcript-checkpoint:${videoId}`;
type CaptureCheckpoint = {
  completedChunks: number;
  segments: TranscriptSegment[];
  capturedThroughMs: number;
};

export async function getBrowserCaptureResumeMs(
  videoId: string,
): Promise<number> {
  return (await loadCaptureCheckpoint(videoId)).capturedThroughMs;
}

export async function preloadBrowserSpeechModel(): Promise<void> {
  const manifest = await getSpeechModelManifest();
  const worker = new Worker("/whisper-worker.js", {
    type: "module",
    name: "clipquest-whisper-preload",
  });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onerror = (event) => reject(new Error(event.message));
      worker.onmessage = (event: MessageEvent<CaptureWorkerMessage>) => {
        if (event.data.type === "preloaded") resolve();
        if (event.data.type === "error") reject(new Error(event.data.message));
      };
      worker.postMessage({ type: "preload", manifest });
    });
  } finally {
    worker.terminate();
  }
}

export async function captureBrowserTabAudio(
  options: BrowserCaptureOptions,
): Promise<BrowserCaptureResult> {
  if (!navigator.mediaDevices?.getDisplayMedia)
    throw new Error("This browser does not support tab-audio capture.");
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    systemAudio: "exclude",
  } as DisplayMediaStreamOptions);
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(
      "No tab audio was shared. Select the ClipQuest tab and enable Share tab audio.",
    );
  }
  const manifest = await getSpeechModelManifest();
  const checkpoint = await loadCaptureCheckpoint(options.videoId);

  const context = new AudioContext();
  await context.audioWorklet.addModule("/capture-audio-worklet.js");
  const source = context.createMediaStreamSource(stream);
  const processor = new AudioWorkletNode(context, "clipquest-capture");
  const silent = context.createGain();
  silent.gain.value = 0;
  source.connect(processor).connect(silent).connect(context.destination);
  const worker = new Worker("/whisper-worker.js", {
    type: "module",
    name: "clipquest-whisper-capture",
  });
  const segments: TranscriptSegment[] = [...checkpoint.segments];
  let rolling = new Float32Array(0);
  let capturedSamples = 0;
  let chunkIndex = 0;
  let sentChunks = 0;
  let completedChunks = 0;
  let stopped = false;
  let settleStop!: () => void;
  const stoppedPromise = new Promise<void>((resolve) => {
    settleStop = resolve;
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stream.getTracks().forEach((track) => track.stop());
    settleStop();
  };
  options.onStarted(stop);
  stream.getVideoTracks()[0]?.addEventListener("ended", stop, { once: true });
  const abort = () => stop();
  options.signal.addEventListener("abort", abort, { once: true });

  const workerDone = new Promise<void>((resolve, reject) => {
    worker.onerror = (event) => reject(new Error(event.message));
    worker.onmessage = (event: MessageEvent<CaptureWorkerMessage>) => {
      const message = event.data;
      if (message.type === "phase") options.onPhase(message.phase);
      else if (message.type === "model-progress")
        options.onProgress(Math.min(0.95, message.progress));
      else if (message.type === "chunk") {
        segments.push(...message.segments);
        completedChunks += 1;
        void AsyncStorage.setItem(
          checkpointKey(options.videoId),
          JSON.stringify({
            completedChunks: checkpoint.completedChunks + completedChunks,
            segments,
            capturedThroughMs:
              checkpoint.capturedThroughMs +
              Math.round((capturedSamples / SAMPLE_RATE) * 1_000),
          }),
        );
        options.onProgress(sentChunks ? completedChunks / sentChunks : 0);
        if (stopped && completedChunks === sentChunks) resolve();
      } else if (message.type === "error") reject(new Error(message.message));
    };
  });

  const sendChunk = (pcm: Float32Array) => {
    const startSeconds =
      checkpoint.capturedThroughMs / 1_000 +
      (chunkIndex * STEP_SAMPLES) / SAMPLE_RATE;
    const persistedChunkIndex = checkpoint.completedChunks + chunkIndex;
    worker.postMessage(
      {
        type: "transcribe-chunk",
        pcm,
        language: options.language,
        manifest,
        chunkIndex: persistedChunkIndex,
        chunkStartSeconds: startSeconds,
      },
      [pcm.buffer],
    );
    chunkIndex += 1;
    sentChunks += 1;
  };

  processor.port.onmessage = (
    event: MessageEvent<{ pcm: Float32Array; sampleRate: number }>,
  ) => {
    const next = resampleLinear(
      event.data.pcm,
      event.data.sampleRate,
      SAMPLE_RATE,
    );
    capturedSamples += next.length;
    const merged = new Float32Array(rolling.length + next.length);
    merged.set(rolling);
    merged.set(next, rolling.length);
    rolling = merged;
    while (rolling.length >= CHUNK_SAMPLES) {
      sendChunk(rolling.slice(0, CHUNK_SAMPLES));
      rolling = rolling.slice(STEP_SAMPLES);
    }
    options.onProgress(
      options.durationSeconds > 0
        ? Math.min(
            0.99,
            capturedSamples / (options.durationSeconds * SAMPLE_RATE),
          )
        : 0,
    );
  };

  try {
    await context.resume();
    await stoppedPromise;
    processor.port.onmessage = null;
    if (rolling.length > SAMPLE_RATE) sendChunk(rolling.slice());
    if (!sentChunks) throw new Error("No usable tab audio was captured.");
    if (completedChunks < sentChunks) await workerDone;
    if (options.signal.aborted) throw new TranscriptionPausedError();
    const capturedThroughMs =
      checkpoint.capturedThroughMs +
      Math.round((capturedSamples / SAMPLE_RATE) * 1_000);
    assertTranscriptQuality(segments, capturedThroughMs / 1_000);
    await AsyncStorage.removeItem(checkpointKey(options.videoId));
    return {
      language: options.language ?? "und",
      segments: segments.sort((a, b) => a.startMs - b.startMs),
      capturedThroughMs,
    };
  } finally {
    options.signal.removeEventListener("abort", abort);
    stop();
    source.disconnect();
    processor.disconnect();
    silent.disconnect();
    worker.terminate();
    await context.close();
  }
}

async function loadCaptureCheckpoint(
  videoId: string,
): Promise<CaptureCheckpoint> {
  const raw = await AsyncStorage.getItem(checkpointKey(videoId));
  if (!raw) return { completedChunks: 0, segments: [], capturedThroughMs: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<CaptureCheckpoint>;
    return {
      completedChunks: Math.max(0, Math.floor(parsed.completedChunks ?? 0)),
      segments: Array.isArray(parsed.segments) ? parsed.segments : [],
      capturedThroughMs: Math.max(0, Math.floor(parsed.capturedThroughMs ?? 0)),
    };
  } catch {
    return { completedChunks: 0, segments: [], capturedThroughMs: 0 };
  }
}

function resampleLinear(
  input: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  if (sourceRate === targetRate) return input;
  const output = new Float32Array(
    Math.max(1, Math.round((input.length * targetRate) / sourceRate)),
  );
  for (let index = 0; index < output.length; index += 1) {
    const position = (index * sourceRate) / targetRate;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] =
      (input[left] ?? 0) +
      ((input[right] ?? 0) - (input[left] ?? 0)) * fraction;
  }
  return output;
}
