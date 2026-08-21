import {
  compactTranscriptSegments,
  type TranscriptSegment,
} from "@clipquest/contracts";

const MAX_CAPTION_BYTES = 8 * 1024 * 1024;
const TRANSCRIPT_PROVIDER_ORIGIN = "https://youtube-transcript.ai";
const TRANSCRIPT_PROVIDER_ATTEMPTS = 2;
const TRANSCRIPT_PROVIDER_TIMEOUT_MS = 4_000;

type TimedTextPayload = {
  events?: {
    tStartMs?: number;
    dDurationMs?: number;
    segs?: { utf8?: string }[];
  }[];
};

type CompleteCaptionDocument = {
  segments: TranscriptSegment[];
  sourceSegmentCount: number;
};

function splitCaptionText(text: string): string[] {
  const normalized = text.replaceAll("\n", " ").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= 2_000) return [normalized];
  const pieces: string[] = [];
  let remaining = normalized;
  while (remaining.length > 2_000) {
    const splitAt = remaining.lastIndexOf(" ", 1_900);
    if (splitAt < 1) {
      throw new Error(
        "A YouTube caption event is too large to preserve safely.",
      );
    }
    pieces.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt + 1);
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

export function parseYouTubeTimedTextDocument(
  payload: TimedTextPayload,
): CompleteCaptionDocument {
  const rawSegments = (payload.events ?? []).flatMap((event, eventIndex) => {
    const startMs = Math.max(0, Math.floor(event.tStartMs ?? 0));
    const endMs = startMs + Math.max(1, Math.floor(event.dDurationMs ?? 3_000));
    const text = (event.segs ?? [])
      .map((segment) => segment.utf8 ?? "")
      .join("");
    const pieces = splitCaptionText(text);
    return pieces.map((piece, pieceIndex) => ({
      id:
        pieces.length === 1
          ? `youtube-${eventIndex}-${startMs}`
          : `youtube-${eventIndex}-${pieceIndex}-${startMs}`,
      startMs: startMs + pieceIndex,
      endMs: Math.max(startMs + pieceIndex + 1, endMs),
      text: piece,
    }));
  });
  const segments = compactTranscriptSegments(rawSegments);
  const characters = segments.reduce(
    (total, segment) => total + segment.text.length,
    0,
  );
  return {
    segments: characters >= 20 ? segments : [],
    sourceSegmentCount: rawSegments.length,
  };
}

export function parseYouTubeTimedText(
  payload: TimedTextPayload,
): TranscriptSegment[] {
  return parseYouTubeTimedTextDocument(payload).segments;
}

type BrowserTranscript = {
  language: string;
  durationSeconds: number | null;
  segments: TranscriptSegment[];
  sourceSegmentCount: number;
};

function timestampMs(first: string, second: string, third?: string): number {
  const hours = third === undefined ? 0 : Number(first);
  const minutes = Number(third === undefined ? first : second);
  const seconds = Number(third === undefined ? second : third);
  return (hours * 3_600 + minutes * 60 + seconds) * 1_000;
}

function comparableWord(word: string): string {
  return word
    .toLocaleLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function collapseAdjacentCaptionRepeats(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const output: string[] = [];
  let index = 0;
  while (index < words.length) {
    const remaining = words.length - index;
    let repeatedSpan = 0;
    let repeatedCopies = 0;
    const maximumSpan = Math.min(48, Math.floor(remaining / 2));
    for (let span = maximumSpan; span >= 1; span -= 1) {
      let matches = true;
      for (let offset = 0; offset < span; offset += 1) {
        if (
          comparableWord(words[index + offset] ?? "") !==
          comparableWord(words[index + span + offset] ?? "")
        ) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
      let copies = 2;
      while (index + (copies + 1) * span <= words.length) {
        let nextMatches = true;
        for (let offset = 0; offset < span; offset += 1) {
          if (
            comparableWord(words[index + offset] ?? "") !==
            comparableWord(words[index + copies * span + offset] ?? "")
          ) {
            nextMatches = false;
            break;
          }
        }
        if (!nextMatches) break;
        copies += 1;
      }
      if (span > 1 || copies >= 3) {
        repeatedSpan = span;
        repeatedCopies = copies;
        break;
      }
    }
    if (!repeatedSpan) {
      output.push(words[index] ?? "");
      index += 1;
      continue;
    }
    output.push(...words.slice(index, index + repeatedSpan));
    index += repeatedSpan * repeatedCopies;
  }
  return output.join(" ").trim();
}

export function parseBrowserTranscript(
  body: string,
  expectedVideoId: string,
): BrowserTranscript {
  if (!/^[\w-]{11}$/.test(expectedVideoId)) {
    throw new Error("The YouTube video id is invalid.");
  }
  const sourceLine = body.match(/^Source video:\s+(https?:\/\/\S+)\s*$/m);
  if (!sourceLine?.[1]) {
    throw new Error("The transcript source could not be verified.");
  }
  const sourceUrl = new URL(sourceLine[1]);
  const actualVideoId =
    sourceUrl.hostname === "youtu.be"
      ? sourceUrl.pathname.slice(1)
      : sourceUrl.searchParams.get("v");
  if (actualVideoId !== expectedVideoId) {
    throw new Error("The transcript source did not match the requested video.");
  }
  const language =
    body.match(/^Language:\s*([A-Za-z0-9-]{2,35})(?:\s|$)/m)?.[1] ?? "und";
  const durationMatch = body.match(
    /(?:^|[·|])\s*Duration:\s*(\d{1,3}):([0-5]\d)(?::([0-5]\d))?/m,
  );
  const durationSeconds = durationMatch?.[1]
    ? timestampMs(
        durationMatch[1],
        durationMatch[2] ?? "00",
        durationMatch[3],
      ) / 1_000
    : null;
  const parsed = body.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\[(\d{1,3}):([0-5]\d)(?::([0-5]\d))?\]\s+(.+)$/);
    if (!match?.[1] || !match[2] || !match[4]) return [];
    const text = collapseAdjacentCaptionRepeats(match[4]);
    if (!text) return [];
    return [{ startMs: timestampMs(match[1], match[2], match[3]), text }];
  });
  const rawSegments = parsed.flatMap((segment, index) => {
    const nextStartMs = parsed[index + 1]?.startMs;
    const endMs = Math.max(
      segment.startMs + 1,
      nextStartMs ?? segment.startMs + 30_000,
    );
    const pieces = splitCaptionText(segment.text);
    return pieces.map((piece, pieceIndex) => ({
      id:
        pieces.length === 1
          ? `youtube-text-${index}-${segment.startMs}`
          : `youtube-text-${index}-${pieceIndex}-${segment.startMs}`,
      startMs: segment.startMs + pieceIndex,
      endMs: Math.max(segment.startMs + pieceIndex + 1, endMs),
      text: piece,
    }));
  });
  const segments = compactTranscriptSegments(rawSegments);
  const characters = segments.reduce(
    (total, segment) => total + segment.text.length,
    0,
  );
  if (segments.length === 0 || characters < 20) {
    throw new Error("The transcript provider returned empty captions.");
  }
  return {
    language,
    durationSeconds,
    segments,
    sourceSegmentCount: rawSegments.length,
  };
}

async function fetchBoundedCaptionText(
  url: string,
  signal: AbortSignal,
  options: {
    accept: string;
    timeoutMs: number;
    timeoutMessage: string;
    validateResponse(response: Response): void;
  },
): Promise<string> {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error(options.timeoutMessage)),
    options.timeoutMs,
  );
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: options.accept },
    });
    try {
      options.validateResponse(response);
    } catch (error) {
      await response.body?.cancel().catch(() => undefined);
      throw error;
    }
    return await readBoundedCaptionResponseText(response);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export async function readBoundedCaptionResponseText(
  response: Response,
  maximumBytes = MAX_CAPTION_BYTES,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("YouTube captions exceeded the safe size limit.");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("YouTube captions exceeded the safe size limit.");
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function downloadBrowserYouTubeTranscript(
  videoId: string,
  signal: AbortSignal,
): Promise<BrowserTranscript> {
  if (!/^[\w-]{11}$/.test(videoId)) {
    throw new Error("The YouTube video id is invalid.");
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= TRANSCRIPT_PROVIDER_ATTEMPTS; attempt += 1) {
    try {
      const body = await fetchBoundedCaptionText(
        `${TRANSCRIPT_PROVIDER_ORIGIN}/transcript/${encodeURIComponent(videoId)}.txt`,
        signal,
        {
          accept: "text/markdown, text/plain;q=0.9",
          timeoutMs: TRANSCRIPT_PROVIDER_TIMEOUT_MS,
          timeoutMessage: "Transcript lookup timed out.",
          validateResponse(response) {
            if (!response.ok) {
              throw new Error(
                `Browser transcript lookup failed (${response.status}).`,
              );
            }
            const contentType = response.headers
              .get("content-type")
              ?.toLowerCase();
            if (
              contentType &&
              !contentType.startsWith("text/plain") &&
              !contentType.startsWith("text/markdown")
            ) {
              throw new Error(
                "The transcript provider returned an unsafe content type.",
              );
            }
          },
        },
      );
      return parseBrowserTranscript(body, videoId);
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      if (attempt < TRANSCRIPT_PROVIDER_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Browser transcript lookup failed.");
}

export async function downloadYouTubeCaptions(
  captionUrl: string,
  signal: AbortSignal,
): Promise<CompleteCaptionDocument> {
  const url = new URL(captionUrl);
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "youtube.com" && !url.hostname.endsWith(".youtube.com"))
  ) {
    throw new Error("YouTube returned an invalid caption source.");
  }
  const body = await fetchBoundedCaptionText(url.href, signal, {
    accept: "application/json",
    timeoutMs: 15_000,
    timeoutMessage: "YouTube caption download timed out.",
    validateResponse(response) {
      if (!response.ok) {
        throw new Error(
          `YouTube caption download failed (${response.status}).`,
        );
      }
    },
  });
  const document = parseYouTubeTimedTextDocument(
    JSON.parse(body) as TimedTextPayload,
  );
  if (!document.segments.length)
    throw new Error("YouTube returned empty captions.");
  return document;
}
