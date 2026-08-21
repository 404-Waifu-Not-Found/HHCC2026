import type { TranscriptSegment } from "@clipquest/contracts";
import LocalAudioDecoder from "@clipquest/local-audio-decoder";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Directory, DownloadTask, File, Paths, type DownloadPauseState } from "expo-file-system";
import { initWhisper } from "whisper.rn/index";
import { authClient } from "../lib/auth-client";
import { API_ORIGIN } from "../lib/config";
import { getSpeechModelManifest } from "./manifest";
import type { LocalTranscriptionOptions, LocalTranscriptionResult, ModelStatus, SpeechModelManifest } from "./types";
import { TranscriptionPausedError } from "./types";

type Checkpoint = { completedChunks: number; segments: TranscriptSegment[] };
const MODEL_DIR = new Directory(Paths.document, "clipquest-models", "whisper-tiny");
const MODEL_FILE = new File(MODEL_DIR, "ggml-tiny-q5_1.bin");
const PAUSED_MODEL_DOWNLOAD_KEY = "clipquest:model-download:v1";
const checkpointKey = (videoId: string) => `clipquest:transcript-checkpoint:${videoId}`;

export async function transcribeLocally(options: LocalTranscriptionOptions): Promise<LocalTranscriptionResult> {
  if (options.durationSeconds > 5_400) throw new Error("Captionless videos can be at most 90 minutes.");
  const manifest = await getSpeechModelManifest();
  const model = await ensureModel(manifest, options);
  throwIfAborted(options.signal);
  options.onPhase("preparing_audio");
  const tempDirectory = new Directory(Paths.cache, `clipquest-transcription-${options.videoId}`);
  if (tempDirectory.exists) tempDirectory.delete();
  tempDirectory.create({ intermediates: true, idempotent: true });
  const audioFile = new File(tempDirectory, "source-audio");
  const chunkDirectory = new Directory(tempDirectory, "chunks");
  chunkDirectory.create({ intermediates: true, idempotent: true });

  try {
    await downloadAudio(options.mediaUrl, audioFile, options);
    throwIfAborted(options.signal);
    const chunks = await LocalAudioDecoder.decodeToChunks(audioFile.uri, chunkDirectory.uri, 30, 5);
    if (audioFile.exists) audioFile.delete();
    throwIfAborted(options.signal);

    const checkpoint = await loadCheckpoint(options.videoId);
    const segments = [...checkpoint.segments];
    const context = await initWhisper({ filePath: model.uri, useGpu: true, useCoreMLIos: true, useFlashAttn: true });
    try {
      options.onPhase("transcribing_device");
      for (let index = checkpoint.completedChunks; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        if (!chunk) continue;
        throwIfAborted(options.signal);
        const transcription = context.transcribe(chunk.uri, {
          language: normalizeLanguage(options.language),
          translate: false,
          maxThreads: 4,
          tokenTimestamps: false,
          onProgress: (progress) => options.onProgress((index + progress / 100) / chunks.length),
        });
        const abort = () => { void transcription.stop(); };
        options.signal.addEventListener("abort", abort, { once: true });
        const result = await transcription.promise;
        options.signal.removeEventListener("abort", abort);
        if (result.isAborted || options.signal.aborted) throw new TranscriptionPausedError();
        segments.push(
          ...result.segments.flatMap((segment, segmentIndex) => {
            if (!segment.text.trim() || (index > 0 && segment.t1 <= 500)) return [];
            const startMs = chunk.startMs + Math.max(index > 0 ? 5_000 : 0, segment.t0 * 10);
            const endMs = Math.max(startMs + 50, chunk.startMs + segment.t1 * 10);
            return [{ id: `device-${index}-${segmentIndex}`, startMs, endMs, text: segment.text.trim() }];
          }),
        );
        await AsyncStorage.setItem(
          checkpointKey(options.videoId),
          JSON.stringify({ completedChunks: index + 1, segments } satisfies Checkpoint),
        );
        options.onProgress((index + 1) / chunks.length);
      }
    } finally {
      await context.release();
    }
    validateTranscriptQuality(segments, options.durationSeconds);
    await AsyncStorage.removeItem(checkpointKey(options.videoId));
    return { language: options.language ?? "und", segments: segments.sort((a, b) => a.startMs - b.startMs) };
  } finally {
    if (tempDirectory.exists) tempDirectory.delete();
  }
}

export async function getLocalModelStatus(): Promise<ModelStatus> {
  const manifest = await getSpeechModelManifest().catch(() => null);
  const expectedSize = manifest?.native.file.sizeBytes ?? null;
  return { cached: MODEL_FILE.exists && (expectedSize === null || MODEL_FILE.size === expectedSize), sizeBytes: expectedSize };
}

export async function removeLocalModel(): Promise<boolean> {
  const existed = MODEL_DIR.exists;
  if (MODEL_DIR.exists) MODEL_DIR.delete();
  await AsyncStorage.removeItem(PAUSED_MODEL_DOWNLOAD_KEY);
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.removeMany(keys.filter((key) => key.startsWith("clipquest:transcript-checkpoint:")));
  return existed;
}

async function ensureModel(manifest: SpeechModelManifest, options: LocalTranscriptionOptions): Promise<File> {
  options.onPhase("downloading_model");
  if (MODEL_FILE.exists && MODEL_FILE.size === manifest.native.file.sizeBytes) {
    await verifyModel(MODEL_FILE, manifest.native.file.sha256);
    options.onProgress(1, { loadedBytes: MODEL_FILE.size, totalBytes: MODEL_FILE.size, cached: true });
    return MODEL_FILE;
  }
  if (!MODEL_DIR.exists) MODEL_DIR.create({ intermediates: true, idempotent: true });
  if (MODEL_FILE.exists) MODEL_FILE.delete();
  const onProgress = ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
    options.onProgress(totalBytes > 0 ? bytesWritten / totalBytes : bytesWritten / manifest.native.file.sizeBytes, {
      loadedBytes: bytesWritten,
      totalBytes: totalBytes > 0 ? totalBytes : manifest.native.file.sizeBytes,
    });
  };
  const pausedRaw = await AsyncStorage.getItem(PAUSED_MODEL_DOWNLOAD_KEY);
  let task: DownloadTask;
  let operation: Promise<File | null>;
  if (pausedRaw) {
    try {
      task = DownloadTask.fromSavable(JSON.parse(pausedRaw) as DownloadPauseState, { onProgress });
      operation = task.resumeAsync();
    } catch {
      await AsyncStorage.removeItem(PAUSED_MODEL_DOWNLOAD_KEY);
      task = createModelDownload(manifest, onProgress);
      operation = task.downloadAsync();
    }
  } else {
    task = createModelDownload(manifest, onProgress);
    operation = task.downloadAsync();
  }
  const pause = () => task.pause();
  options.signal.addEventListener("abort", pause, { once: true });
  const downloaded = await operation;
  options.signal.removeEventListener("abort", pause);
  if (!downloaded) {
    if (task.state === "paused") await AsyncStorage.setItem(PAUSED_MODEL_DOWNLOAD_KEY, JSON.stringify(task.savable()));
    throw new TranscriptionPausedError();
  }
  await AsyncStorage.removeItem(PAUSED_MODEL_DOWNLOAD_KEY);
  if (downloaded.size !== manifest.native.file.sizeBytes) {
    downloaded.delete();
    throw new Error("The downloaded speech model had an unexpected size.");
  }
  await verifyModel(downloaded, manifest.native.file.sha256);
  return downloaded;
}

function createModelDownload(
  manifest: SpeechModelManifest,
  onProgress: (progress: { bytesWritten: number; totalBytes: number }) => void,
): DownloadTask {
  const cookie = authClient.getCookie();
  return File.createDownloadTask(
    `${API_ORIGIN}/api/models/files/${manifest.native.file.path}`,
    MODEL_FILE,
    { headers: cookie ? { Cookie: cookie } : undefined, onProgress, sessionType: "background" },
  );
}

async function verifyModel(file: File, expectedSha256: string): Promise<void> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes());
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expectedSha256) {
    file.delete();
    throw new Error("Speech model integrity check failed.");
  }
}

async function downloadAudio(url: string, destination: File, options: LocalTranscriptionOptions): Promise<void> {
  if (destination.exists) destination.delete();
  const cookie = authClient.getCookie();
  const task = File.createDownloadTask(url, destination, {
    headers: cookie ? { Cookie: cookie } : undefined,
    signal: options.signal,
    onProgress: ({ bytesWritten, totalBytes }) => options.onProgress(totalBytes > 0 ? bytesWritten / totalBytes : Math.min(0.95, bytesWritten / 20_000_000)),
  });
  try {
    const result = await task.downloadAsync();
    if (!result) throw new TranscriptionPausedError();
  } catch (error) {
    if (options.signal.aborted) throw new TranscriptionPausedError();
    throw error;
  }
}

async function loadCheckpoint(videoId: string): Promise<Checkpoint> {
  const raw = await AsyncStorage.getItem(checkpointKey(videoId));
  if (!raw) return { completedChunks: 0, segments: [] };
  try { return JSON.parse(raw) as Checkpoint; } catch { return { completedChunks: 0, segments: [] }; }
}

function normalizeLanguage(language: string | null | undefined): string {
  if (!language) return "auto";
  if (language.toLowerCase().startsWith("zh")) return "zh";
  if (language.toLowerCase().startsWith("en")) return "en";
  return "auto";
}

function validateTranscriptQuality(segments: TranscriptSegment[], durationSeconds: number): void {
  const characters = segments.reduce((total, segment) => total + segment.text.length, 0);
  if (!segments.length || characters < Math.max(20, durationSeconds * 0.12)) {
    throw new Error("The local transcript was too uncertain to create a trustworthy quiz.");
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new TranscriptionPausedError();
}
