import type { TranscriptSegment } from "@clipquest/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createFile, type MP4BoxBuffer, type Sample } from "mp4box";
import { getSpeechModelManifest } from "./manifest";
import { canTranscribeInBrowser } from "./limits";
import { assertTranscriptQuality } from "./quality";
import type { LocalTranscriptionOptions, LocalTranscriptionResult, ModelStatus } from "./types";
import { TranscriptionPausedError } from "./types";
import { readResponseErrorMessage } from "../lib/response-error";

type Checkpoint = { completedChunks: number; segments: TranscriptSegment[] };
type WorkerMessage =
  | { type: "phase"; phase: "downloading_model" | "transcribing_device" }
  | { type: "model-progress"; progress: number; loaded: number; total: number; cached?: boolean }
  | { type: "chunk"; chunkIndex: number; totalChunks: number; segments: TranscriptSegment[] }
  | { type: "done" }
  | { type: "error"; message: string };

const checkpointKey = (videoId: string) => `clipquest:transcript-checkpoint:${videoId}`;

export async function transcribeLocally(options: LocalTranscriptionOptions): Promise<LocalTranscriptionResult> {
  if (!canTranscribeInBrowser(options.durationSeconds)) {
    throw new Error("Captionless videos can be at most 90 minutes in a browser. Use the mobile app for longer videos.");
  }
  const manifest = await getSpeechModelManifest();
  options.onPhase("preparing_audio");
  const media = await downloadMedia(options.mediaUrl, options.signal, (progress) => options.onProgress(progress));
  throwIfAborted(options.signal);
  const pcm = await decodeAudio(media.buffer, media.contentType);
  throwIfAborted(options.signal);
  const checkpoint = await loadCheckpoint(options.videoId);
  const segments = [...checkpoint.segments];
  const worker = new Worker("/whisper-worker.js", { type: "module", name: "clipquest-whisper" });

  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        worker.postMessage({ type: "cancel" });
        reject(new TranscriptionPausedError());
      };
      options.signal.addEventListener("abort", abort, { once: true });
      worker.onerror = (event) => reject(new Error(event.message || "The speech worker stopped."));
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === "phase") {
          options.onPhase(message.phase);
        } else if (message.type === "model-progress") {
          options.onPhase("downloading_model");
          options.onProgress(message.progress, { loadedBytes: message.loaded, totalBytes: message.total, cached: message.cached });
        } else if (message.type === "chunk") {
          segments.push(...message.segments);
          const completedChunks = message.chunkIndex + 1;
          void AsyncStorage.setItem(checkpointKey(options.videoId), JSON.stringify({ completedChunks, segments } satisfies Checkpoint));
          options.onPhase("transcribing_device");
          options.onProgress(completedChunks / message.totalChunks);
        } else if (message.type === "done") {
          options.signal.removeEventListener("abort", abort);
          resolve();
        } else {
          reject(new Error(message.message));
        }
      };
      worker.postMessage(
        {
          type: "transcribe",
          pcm,
          language: options.language,
          manifest,
          startChunk: checkpoint.completedChunks,
        },
        [pcm.buffer],
      );
    });
  } finally {
    worker.terminate();
  }
  assertTranscriptQuality(segments, options.durationSeconds);
  await AsyncStorage.removeItem(checkpointKey(options.videoId));
  return { language: options.language ?? "und", segments: segments.sort((a, b) => a.startMs - b.startMs) };
}

export async function getLocalModelStatus(): Promise<ModelStatus> {
  const manifest = await getSpeechModelManifest().catch(() => null);
  if (!("caches" in globalThis)) return { cached: false, sizeBytes: manifest?.web.sizeBytes ?? null };
  const cache = await caches.open("clipquest-whisper-v1");
  const keys = await cache.keys();
  const cached = Boolean(manifest && manifest.web.files.every((file) => keys.some((request) => request.url.endsWith(`/${file.path}`))));
  return { cached, sizeBytes: manifest?.web.sizeBytes ?? null };
}

export async function removeLocalModel(): Promise<boolean> {
  const removed = await caches.delete("clipquest-whisper-v1");
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((key) => key.startsWith("clipquest:transcript-checkpoint:")));
  return removed;
}

async function downloadMedia(url: string, signal: AbortSignal, onProgress: (value: number) => void) {
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) {
    throw new Error(await readResponseErrorMessage(response, `Audio delivery failed (${response.status}).`));
  }
  if (!response.body) throw new Error("Audio delivery returned no data.");
  const total = Number(response.headers.get("content-length") ?? 0);
  const reader = response.body.getReader();
  const pieces: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pieces.push(value);
    loaded += value.byteLength;
    onProgress(total > 0 ? loaded / total : Math.min(0.95, loaded / 20_000_000));
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const piece of pieces) { merged.set(piece, offset); offset += piece.byteLength; }
  return { buffer: merged.buffer, contentType: response.headers.get("content-type") ?? "" };
}

async function decodeAudio(buffer: ArrayBuffer, contentType: string): Promise<Float32Array> {
  if (contentType.includes("mp4") && "AudioDecoder" in globalThis) {
    try { return await decodeMp4WithWebCodecs(buffer.slice(0)); } catch { /* Browser codec/container support varies. */ }
  }
  const webGlobal = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Context = webGlobal.AudioContext ?? webGlobal.webkitAudioContext;
  if (!Context) throw new Error("This browser cannot decode the video's audio.");
  const context = new Context();
  try {
    const audio = await context.decodeAudioData(buffer.slice(0));
    const mono = downmix(audio);
    return resampleLinear(mono, audio.sampleRate, 16_000);
  } finally {
    await context.close();
  }
}

async function decodeMp4WithWebCodecs(buffer: ArrayBuffer): Promise<Float32Array> {
  const file = createFile();
  const mp4Buffer = buffer as MP4BoxBuffer;
  mp4Buffer.fileStart = 0;
  const frames: Float32Array[] = [];
  let outputRate = 48_000;
  const decoder = await new Promise<AudioDecoder>((resolve, reject) => {
    file.onError = (_module, message) => reject(new Error(message));
    file.onReady = async (info) => {
      const track = info.audioTracks[0];
      if (!track?.audio) return reject(new Error("No audio track."));
      const config: AudioDecoderConfig = { codec: track.codec, sampleRate: track.audio.sample_rate, numberOfChannels: track.audio.channel_count };
      const support = await AudioDecoder.isConfigSupported(config);
      if (!support.supported) return reject(new Error("Audio codec is not supported by WebCodecs."));
      outputRate = config.sampleRate;
      const instance = new AudioDecoder({
        error: reject,
        output: (audio) => {
          const mono = new Float32Array(audio.numberOfFrames);
          const channel = new Float32Array(audio.numberOfFrames);
          for (let index = 0; index < audio.numberOfChannels; index += 1) {
            audio.copyTo(channel, { planeIndex: index, format: "f32-planar" });
            for (let frame = 0; frame < mono.length; frame += 1) mono[frame] = (mono[frame] ?? 0) + (channel[frame] ?? 0) / audio.numberOfChannels;
          }
          frames.push(mono);
          audio.close();
        },
      });
      instance.configure(support.config ?? config);
      file.onSamples = (_id: number, _user: unknown, samples: Sample[]) => {
        for (const sample of samples) {
          if (!sample.data) continue;
          instance.decode(new EncodedAudioChunk({ type: sample.is_sync ? "key" : "delta", timestamp: Math.round(sample.cts / sample.timescale * 1_000_000), duration: Math.round(sample.duration / sample.timescale * 1_000_000), data: sample.data }));
        }
      };
      file.setExtractionOptions(track.id, undefined, { nbSamples: 100 });
      file.start();
      resolve(instance);
    };
    file.appendBuffer(mp4Buffer, true);
    file.flush();
  });
  await decoder.flush();
  decoder.close();
  const length = frames.reduce((sum, frame) => sum + frame.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const frame of frames) { merged.set(frame, offset); offset += frame.length; }
  if (!merged.length) throw new Error("WebCodecs produced no audio.");
  return resampleLinear(merged, outputRate, 16_000);
}

function downmix(audio: AudioBuffer): Float32Array {
  const mono = new Float32Array(audio.length);
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    const data = audio.getChannelData(channel);
    for (let index = 0; index < mono.length; index += 1) mono[index] = (mono[index] ?? 0) + (data[index] ?? 0) / audio.numberOfChannels;
  }
  return mono;
}

function resampleLinear(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return input;
  const output = new Float32Array(Math.max(1, Math.round(input.length * targetRate / sourceRate)));
  for (let index = 0; index < output.length; index += 1) {
    const position = index * sourceRate / targetRate;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = (input[left] ?? 0) + ((input[right] ?? 0) - (input[left] ?? 0)) * fraction;
  }
  return output;
}

async function loadCheckpoint(videoId: string): Promise<Checkpoint> {
  const raw = await AsyncStorage.getItem(checkpointKey(videoId));
  if (!raw) return { completedChunks: 0, segments: [] };
  try { return JSON.parse(raw) as Checkpoint; } catch { return { completedChunks: 0, segments: [] }; }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new TranscriptionPausedError();
}
