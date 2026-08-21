import {
  CaptionTrackSchema,
  TranscriptSegmentSchema,
  type CaptionTrack,
  type TranscriptSegment,
} from "@clipquest/contracts";
import { z } from "zod";
import type { AppEnv } from "../types";

const BRIGHT_DATASET_ID = "gd_lk56epmy2i5g7lzu0k";
const HEDGE_DELAY_MS = 750;
const PROVIDER_TIMEOUT_MS = 7_500;
const CIRCUIT_TTL_SECONDS = 45;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const MAX_SEGMENTS = 12_000;

type ProviderName = "bright_data" | "supadata";

export type FreshCaptionResult = {
  provider: ProviderName;
  tracks: CaptionTrack[];
  segments: TranscriptSegment[];
  language: string | null;
  metadata?: {
    title?: string;
    thumbnailUrl?: string;
    durationSeconds?: number;
  };
};

const BrightItemSchema = z
  .object({
    title: z.string().optional(),
    preview_image: z.string().url().optional(),
    video_length: z.number().nonnegative().optional(),
    transcript: z.unknown().optional(),
    transcription_language: z.string().optional(),
  })
  .passthrough();

const SupadataResponseSchema = z.object({
  content: z.array(
    z.object({
      text: z.string(),
      offset: z.number().nonnegative(),
      duration: z.number().nonnegative(),
      lang: z.string().optional(),
    }),
  ),
  lang: z.string(),
  availableLangs: z.array(z.string()).optional(),
});

const GenericCaptionSchema = z.object({
  text: z.string(),
  start: z.number().nonnegative().optional(),
  offset: z.number().nonnegative().optional(),
  duration: z.number().nonnegative().optional(),
});

type CircuitState = { failures: number; openUntil: number };

function providerLog(
  level: "info" | "warn",
  event: string,
  details: Record<string, unknown>,
) {
  console[level](
    JSON.stringify({ scope: "youtube_captions", event, ...details }),
  );
}

function providerKey(provider: ProviderName): string {
  return `caption-provider:${provider}:circuit`;
}

async function circuitOpen(
  env: AppEnv,
  provider: ProviderName,
): Promise<boolean> {
  const raw = await env.CACHE.get(providerKey(provider));
  if (!raw) return false;
  try {
    const state = JSON.parse(raw) as CircuitState;
    return state.openUntil > Date.now();
  } catch {
    return false;
  }
}

async function recordProviderOutcome(
  env: AppEnv,
  provider: ProviderName,
  succeeded: boolean,
): Promise<void> {
  if (succeeded) {
    await env.CACHE.delete(providerKey(provider));
    return;
  }
  let failures = 1;
  const raw = await env.CACHE.get(providerKey(provider));
  if (raw) {
    try {
      failures = Math.min(
        CIRCUIT_FAILURE_THRESHOLD,
        (JSON.parse(raw) as CircuitState).failures + 1,
      );
    } catch {
      // A malformed operational key is replaced below.
    }
  }
  const openUntil =
    failures >= CIRCUIT_FAILURE_THRESHOLD ? Date.now() + 30_000 : 0;
  await env.CACHE.put(
    providerKey(provider),
    JSON.stringify({ failures, openUntil } satisfies CircuitState),
    { expirationTtl: CIRCUIT_TTL_SECONDS },
  );
}

function createTimedSignal(parent?: AbortSignal): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(new DOMException("Provider timed out", "TimeoutError")),
    PROVIDER_TIMEOUT_MS,
  );
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abort);
    },
  };
}

function normalizeTimestampedSegments(
  provider: ProviderName,
  input: unknown[],
): TranscriptSegment[] {
  const segments = input.slice(0, MAX_SEGMENTS).flatMap((raw, index) => {
    const parsed = GenericCaptionSchema.safeParse(raw);
    if (!parsed.success) return [];
    const text = parsed.data.text.trim();
    const start = parsed.data.start ?? parsed.data.offset;
    if (!text || start === undefined) return [];
    const duration = Math.max(0.05, parsed.data.duration ?? 4);
    const usesSeconds = parsed.data.start !== undefined;
    const multiplier = usesSeconds ? 1_000 : 1;
    return [
      TranscriptSegmentSchema.parse({
        id: `${provider}-${index}`,
        startMs: Math.round(start * multiplier),
        endMs: Math.round((start + duration) * multiplier),
        text: text.slice(0, 2_000),
      }),
    ];
  });
  return validateCaptionSegments(segments);
}

function normalizeBrightTranscript(
  transcript: unknown,
  durationSeconds: number,
): TranscriptSegment[] {
  if (Array.isArray(transcript))
    return normalizeTimestampedSegments("bright_data", transcript);
  if (typeof transcript !== "string") return [];
  const text = transcript.replace(/\s+/g, " ").trim();
  if (text.length < 20 || durationSeconds <= 0) return [];
  const chunks = text.match(/.{1,900}(?:\s|$)/g) ?? [text];
  return validateCaptionSegments(
    chunks.slice(0, MAX_SEGMENTS).map((chunk, index) => {
      const startMs = Math.round(
        (index / chunks.length) * durationSeconds * 1_000,
      );
      const endMs = Math.max(
        startMs + 50,
        Math.round(((index + 1) / chunks.length) * durationSeconds * 1_000),
      );
      return TranscriptSegmentSchema.parse({
        id: `bright_data-${index}`,
        startMs,
        endMs,
        text: chunk.trim().slice(0, 2_000),
      });
    }),
  );
}

export function validateCaptionSegments(
  segments: TranscriptSegment[],
): TranscriptSegment[] {
  const seen = new Set<string>();
  const seenContent = new Set<string>();
  let previousStart = -1;
  let characterCount = 0;
  for (const segment of segments) {
    TranscriptSegmentSchema.parse(segment);
    if (seen.has(segment.id) || segment.startMs < previousStart)
      throw new Error("Caption segments failed ordering validation.");
    const contentKey = `${segment.startMs}:${segment.endMs}:${segment.text.trim()}`;
    if (seenContent.has(contentKey))
      throw new Error("Caption segments contain duplicates.");
    seen.add(segment.id);
    seenContent.add(contentKey);
    previousStart = segment.startMs;
    characterCount += segment.text.length;
  }
  if (segments.length === 0 || characterCount < 20)
    throw new Error("Caption provider returned no usable text.");
  return segments;
}

async function fetchBrightData(
  env: AppEnv,
  url: string,
  signal: AbortSignal,
): Promise<FreshCaptionResult> {
  if (!env.BRIGHT_DATA_API_KEY) throw new Error("provider_not_configured");
  const endpoint = new URL("https://api.brightdata.com/datasets/v3/scrape");
  endpoint.searchParams.set("dataset_id", BRIGHT_DATASET_ID);
  endpoint.searchParams.set("include_errors", "true");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.BRIGHT_DATA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Cache-Control": "no-cache, no-store",
    },
    body: JSON.stringify({ input: [{ url, transcription_language: "en" }] }),
    signal,
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  const payload = z
    .array(BrightItemSchema)
    .min(1)
    .parse(await response.json());
  const item = payload[0];
  if (!item) throw new Error("empty_response");
  const durationSeconds = Math.round(item.video_length ?? 0);
  const segments = normalizeBrightTranscript(item.transcript, durationSeconds);
  const language = item.transcription_language ?? "und";
  return {
    provider: "bright_data",
    tracks: [
      CaptionTrackSchema.parse({
        language,
        label: language,
        isAutoGenerated: false,
      }),
    ],
    segments,
    language,
    metadata: {
      ...(item.title ? { title: item.title } : {}),
      ...(item.preview_image ? { thumbnailUrl: item.preview_image } : {}),
      ...(durationSeconds ? { durationSeconds } : {}),
    },
  };
}

async function fetchSupadata(
  env: AppEnv,
  url: string,
  signal: AbortSignal,
): Promise<FreshCaptionResult> {
  if (!env.SUPADATA_API_KEY) throw new Error("provider_not_configured");
  const endpoint = new URL("https://api.supadata.ai/v1/transcript");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("text", "false");
  endpoint.searchParams.set("mode", "native");
  const response = await fetch(endpoint, {
    headers: {
      "x-api-key": env.SUPADATA_API_KEY,
      Accept: "application/json",
      "Cache-Control": "no-cache, no-store",
    },
    signal,
  });
  if (response.status === 202) throw new Error("native_transcript_pending");
  if (!response.ok) throw new Error(`http_${response.status}`);
  const payload = SupadataResponseSchema.parse(await response.json());
  const segments = validateCaptionSegments(
    payload.content.slice(0, MAX_SEGMENTS).map((segment, index) =>
      TranscriptSegmentSchema.parse({
        id: `supadata-${index}`,
        startMs: Math.round(segment.offset),
        endMs: Math.round(segment.offset + Math.max(50, segment.duration)),
        text: segment.text.trim().slice(0, 2_000),
      }),
    ),
  );
  return {
    provider: "supadata",
    tracks: [
      CaptionTrackSchema.parse({
        language: payload.lang,
        label: payload.lang,
        isAutoGenerated: false,
      }),
    ],
    segments,
    language: payload.lang,
  };
}

async function runProvider(
  env: AppEnv,
  provider: ProviderName,
  url: string,
  requestId: string,
  parentSignal?: AbortSignal,
): Promise<FreshCaptionResult> {
  if (await circuitOpen(env, provider)) throw new Error("circuit_open");
  const startedAt = Date.now();
  const timed = createTimedSignal(parentSignal);
  providerLog("info", "provider.started", { requestId, provider });
  try {
    const result =
      provider === "bright_data"
        ? await fetchBrightData(env, url, timed.signal)
        : await fetchSupadata(env, url, timed.signal);
    await recordProviderOutcome(env, provider, true);
    providerLog("info", "provider.succeeded", {
      requestId,
      provider,
      elapsedMs: Date.now() - startedAt,
      segmentCount: result.segments.length,
    });
    return result;
  } catch (error) {
    const cancelledAfterWinner =
      parentSignal?.aborted && parentSignal.reason === "provider_won";
    if (!cancelledAfterWinner) {
      await recordProviderOutcome(env, provider, false);
      providerLog("warn", "provider.failed", {
        requestId,
        provider,
        elapsedMs: Date.now() - startedAt,
        reason: error instanceof Error ? error.message.slice(0, 80) : "unknown",
      });
    }
    throw error;
  } finally {
    timed.dispose();
  }
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function fetchFreshYouTubeCaptions(
  env: AppEnv,
  canonicalUrl: string,
  requestId: string,
): Promise<FreshCaptionResult | null> {
  if (!env.BRIGHT_DATA_API_KEY && !env.SUPADATA_API_KEY) {
    providerLog("warn", "providers.unconfigured", { requestId });
    return null;
  }
  const controller = new AbortController();
  const candidates: Array<Promise<FreshCaptionResult>> = [];
  if (env.BRIGHT_DATA_API_KEY) {
    candidates.push(
      runProvider(
        env,
        "bright_data",
        canonicalUrl,
        requestId,
        controller.signal,
      ),
    );
  }
  if (env.SUPADATA_API_KEY) {
    const delay = env.BRIGHT_DATA_API_KEY ? HEDGE_DELAY_MS : 0;
    candidates.push(
      wait(delay, controller.signal).then(() =>
        runProvider(
          env,
          "supadata",
          canonicalUrl,
          requestId,
          controller.signal,
        ),
      ),
    );
  }
  try {
    const result = await Promise.any(candidates);
    controller.abort("provider_won");
    return result;
  } catch {
    return null;
  }
}
