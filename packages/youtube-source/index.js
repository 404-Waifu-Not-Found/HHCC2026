import { compactTranscriptSegments } from "@clipquest/contracts";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const MAX_CAPTION_BYTES = 8 * 1024 * 1024;
const MAX_METADATA_BYTES = 256 * 1024;
const TRANSCRIPT_PROVIDER_ORIGIN = "https://youtube-transcript.ai";
const TRANSCRIPT_PROVIDER_ATTEMPTS = 2;
const TRANSCRIPT_PROVIDER_TIMEOUT_MS = 10_000;
const METADATA_TIMEOUT_MS = 10_000;
const LOCAL_TRANSCRIPT_TIMEOUT_MS = 45_000;
const execFile = promisify(execFileCallback);

function abortError(message) {
  return new DOMException(message, "AbortError");
}

function withTimeout(parentSignal, timeoutMs, timeoutMessage) {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(parentSignal?.reason ?? abortError("Request aborted."));
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error(timeoutMessage)),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    },
  };
}

export function parseYouTubeVideoId(value) {
  const input = String(value ?? "").trim();
  if (/^[\w-]{11}$/u.test(input)) return input;
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid YouTube URL or 11-character video id.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The YouTube URL must use HTTP or HTTPS.");
  }
  const hostname = url.hostname.toLocaleLowerCase("en-US");
  let videoId = null;
  if (hostname === "youtu.be" || hostname === "www.youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (
    hostname === "youtube.com" ||
    hostname === "www.youtube.com" ||
    hostname === "m.youtube.com" ||
    hostname === "music.youtube.com"
  ) {
    const parts = url.pathname.split("/").filter(Boolean);
    videoId =
      url.searchParams.get("v") ??
      (["shorts", "embed", "live"].includes(parts[0])
        ? (parts[1] ?? null)
        : null);
  } else {
    throw new Error("The source is not a recognized YouTube URL.");
  }
  if (!videoId || !/^[\w-]{11}$/u.test(videoId)) {
    throw new Error("The YouTube URL does not contain a valid video id.");
  }
  return videoId;
}

export function normalizeTranscriptLanguage(language) {
  const value = String(language ?? "").trim();
  if (!value) return "und";
  const normalized = value.toLocaleLowerCase("en-US");
  const aliases = {
    english: "en",
    "american english": "en-US",
    "british english": "en-GB",
    chinese: "zh",
    mandarin: "zh",
    "simplified chinese": "zh-CN",
    "traditional chinese": "zh-TW",
    spanish: "es",
    french: "fr",
    german: "de",
    italian: "it",
    japanese: "ja",
    korean: "ko",
    portuguese: "pt",
    russian: "ru",
    arabic: "ar",
    hindi: "hi",
  };
  const alias = aliases[normalized];
  if (alias) return alias;
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(value) ? value : "und";
}

function timestampMs(first, second, third) {
  const hours = third === undefined ? 0 : Number(first);
  const minutes = Number(third === undefined ? first : second);
  const seconds = Number(third === undefined ? second : third);
  return (hours * 3_600 + minutes * 60 + seconds) * 1_000;
}

function comparableWord(word) {
  return word
    .toLocaleLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function collapseAdjacentCaptionRepeats(text) {
  const words = String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const output = [];
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

function splitCaptionText(text) {
  const normalized = text.replaceAll("\n", " ").replace(/\s+/gu, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= 2_000) return [normalized];
  const pieces = [];
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

export function parseBrowserTranscript(body, expectedVideoId) {
  if (!/^[\w-]{11}$/u.test(expectedVideoId)) {
    throw new Error("The YouTube video id is invalid.");
  }
  const sourceLine = body.match(/^Source video:\s+(https?:\/\/\S+)\s*$/mu);
  if (!sourceLine?.[1]) {
    throw new Error("The transcript source could not be verified.");
  }
  const actualVideoId = parseYouTubeVideoId(sourceLine[1]);
  if (actualVideoId !== expectedVideoId) {
    throw new Error("The transcript source did not match the requested video.");
  }
  const language = normalizeTranscriptLanguage(
    body.match(/^Language:\s*([^\s·|]+)/mu)?.[1] ?? "und",
  );
  const durationMatch = body.match(
    /(?:^|[·|])\s*Duration:\s*(\d{1,3}):([0-5]\d)(?::([0-5]\d))?/mu,
  );
  const durationSeconds = durationMatch?.[1]
    ? timestampMs(
        durationMatch[1],
        durationMatch[2] ?? "00",
        durationMatch[3],
      ) / 1_000
    : null;
  const parsed = body.split(/\r?\n/u).flatMap((line) => {
    const match = line.match(
      /^(?:-\s*)?\[(\d{1,3}):([0-5]\d)(?::([0-5]\d))?\]\s+(.+)$/u,
    );
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
    return splitCaptionText(segment.text).map((piece, pieceIndex, pieces) => ({
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
  const characterCount = segments.reduce(
    (total, segment) => total + segment.text.length,
    0,
  );
  if (segments.length === 0 || characterCount < 20) {
    throw new Error("The transcript provider returned empty captions.");
  }
  const inferredDurationSeconds = Math.max(
    1,
    Math.ceil(Math.max(...segments.map((segment) => segment.endMs)) / 1_000),
  );
  return {
    language,
    durationSeconds: durationSeconds ?? inferredDurationSeconds,
    segments,
    sourceSegmentCount: rawSegments.length,
  };
}

export function parseYouTubeJson3Transcript(body, language = "en") {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("The local YouTube extractor returned malformed captions.");
  }
  const rawSegments = Array.isArray(payload?.events)
    ? payload.events.flatMap((event, index) => {
        const text = collapseAdjacentCaptionRepeats(
          Array.isArray(event?.segs)
            ? event.segs
                .map((segment) => String(segment?.utf8 ?? ""))
                .join("")
                .replaceAll("\n", " ")
            : "",
        );
        if (!text || /^\[[^\]]{1,80}\]$/u.test(text)) return [];
        const startMs = Number(event?.tStartMs);
        const durationMs = Number(event?.dDurationMs);
        if (!Number.isFinite(startMs) || startMs < 0) return [];
        return [
          {
            id: `youtube-json3-${index}-${Math.round(startMs)}`,
            startMs: Math.round(startMs),
            endMs: Math.max(
              Math.round(startMs) + 1,
              Math.round(
                startMs + (Number.isFinite(durationMs) ? durationMs : 2_000),
              ),
            ),
            text,
          },
        ];
      })
    : [];
  const segments = compactTranscriptSegments(rawSegments);
  const characterCount = segments.reduce(
    (total, segment) => total + segment.text.length,
    0,
  );
  if (segments.length === 0 || characterCount < 20) {
    throw new Error("The local YouTube extractor returned empty captions.");
  }
  return {
    language: normalizeTranscriptLanguage(language),
    durationSeconds: Math.max(
      1,
      Math.ceil(Math.max(...segments.map((segment) => segment.endMs)) / 1_000),
    ),
    segments,
    sourceSegmentCount: rawSegments.length,
  };
}

export async function readBoundedResponseText(
  response,
  maximumBytes = MAX_CAPTION_BYTES,
) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("The response exceeded the safe size limit.");
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
        throw new Error("The response exceeded the safe size limit.");
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function fetchBoundedText(
  fetchImpl,
  url,
  { signal, timeoutMs, timeoutMessage, maximumBytes, accept },
) {
  const timed = withTimeout(signal, timeoutMs, timeoutMessage);
  try {
    const response = await fetchImpl(url, {
      signal: timed.signal,
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: accept },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`YouTube source request failed (${response.status}).`);
    }
    return await readBoundedResponseText(response, maximumBytes);
  } finally {
    timed.dispose();
  }
}

async function fetchMetadata(fetchImpl, videoId, signal) {
  const url = new URL("https://www.youtube.com/oembed");
  url.searchParams.set(
    "url",
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
  );
  url.searchParams.set("format", "json");
  const body = await fetchBoundedText(fetchImpl, url, {
    signal,
    timeoutMs: METADATA_TIMEOUT_MS,
    timeoutMessage: "YouTube metadata lookup timed out.",
    maximumBytes: MAX_METADATA_BYTES,
    accept: "application/json",
  });
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("YouTube returned malformed metadata.");
  }
  const title = String(payload?.title ?? "").trim();
  if (!title || title.length > 500) {
    throw new Error("YouTube did not return a valid video title.");
  }
  return title;
}

async function fetchTranscriptWithYtDlp(videoId, preferredLanguage, signal) {
  const directory = await mkdtemp(path.join(tmpdir(), "clipquest-youtube-"));
  try {
    const normalizedLanguage = normalizeTranscriptLanguage(preferredLanguage);
    const language =
      normalizedLanguage === "und" ? "en" : normalizedLanguage.split("-")[0];
    let commandError;
    try {
      await execFile(
        "yt-dlp",
        [
          "--no-playlist",
          "--skip-download",
          "--write-subs",
          "--write-auto-subs",
          "--sub-langs",
          language,
          "--sub-format",
          "json3",
          "--output",
          path.join(directory, "%(id)s.%(ext)s"),
          `https://www.youtube.com/watch?v=${videoId}`,
        ],
        {
          signal,
          timeout: LOCAL_TRANSCRIPT_TIMEOUT_MS,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
    } catch (error) {
      commandError = error;
    }
    const files = (await readdir(directory))
      .filter(
        (file) => file.startsWith(`${videoId}.`) && file.endsWith(".json3"),
      )
      .sort((left, right) => {
        const leftEnglish = /\.en(?:[-.])/iu.test(left) ? 0 : 1;
        const rightEnglish = /\.en(?:[-.])/iu.test(right) ? 0 : 1;
        return leftEnglish - rightEnglish || left.localeCompare(right);
      });
    const selected = files[0];
    if (!selected) {
      if (commandError) throw commandError;
      throw new Error(
        "The local YouTube extractor found no human or automatic captions.",
      );
    }
    const detectedLanguage = selected
      .slice(videoId.length + 1, -".json3".length)
      .split(".")[0];
    return parseYouTubeJson3Transcript(
      await readFile(path.join(directory, selected), "utf8"),
      detectedLanguage || preferredLanguage || "en",
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        "yt-dlp is required for reliable local headless caption extraction.",
      );
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function fetchProviderTranscript(
  fetchImpl,
  videoId,
  preferredLanguage,
  signal,
) {
  let lastError;
  for (let attempt = 1; attempt <= TRANSCRIPT_PROVIDER_ATTEMPTS; attempt += 1) {
    try {
      const url = new URL(
        `/transcript/${encodeURIComponent(videoId)}.txt`,
        TRANSCRIPT_PROVIDER_ORIGIN,
      );
      if (preferredLanguage) url.searchParams.set("lang", preferredLanguage);
      const body = await fetchBoundedText(fetchImpl, url, {
        signal,
        timeoutMs: TRANSCRIPT_PROVIDER_TIMEOUT_MS,
        timeoutMessage: "Transcript lookup timed out.",
        maximumBytes: MAX_CAPTION_BYTES,
        accept: "text/markdown, text/plain;q=0.9",
      });
      return parseBrowserTranscript(body, videoId);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      if (attempt < TRANSCRIPT_PROVIDER_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Transcript lookup failed.");
}

export async function acquireYouTubeSource(rawUrl, options = {}) {
  const videoId = parseYouTubeVideoId(rawUrl);
  const fetchImpl =
    options.adapters?.fetch ?? globalThis.fetch.bind(globalThis);
  const localTranscriptReader =
    options.adapters?.readLocalTranscript ??
    (options.adapters?.fetch && !options.preferLocalTranscript
      ? undefined
      : fetchTranscriptWithYtDlp);
  const transcriptRequest = async () => {
    if (localTranscriptReader) {
      try {
        return {
          transcript: await localTranscriptReader(
            videoId,
            options.preferredLanguage,
            options.signal,
          ),
          acquisition: "youtube_local_ytdlp",
        };
      } catch (localError) {
        if (options.localOnly) throw localError;
      }
    }
    return {
      transcript: await fetchProviderTranscript(
        fetchImpl,
        videoId,
        options.preferredLanguage,
        options.signal,
      ),
      acquisition: "youtube_text_provider",
    };
  };
  const [title, transcriptResult] = await Promise.all([
    fetchMetadata(fetchImpl, videoId, options.signal),
    transcriptRequest(),
  ]);
  const { transcript, acquisition } = transcriptResult;
  const characterCount = transcript.segments.reduce(
    (total, segment) => total + segment.text.length,
    0,
  );
  const transcriptFingerprint = createHash("sha256")
    .update(
      transcript.segments
        .map((segment) => `${segment.startMs}:${segment.endMs}:${segment.text}`)
        .join("\n"),
    )
    .digest("hex")
    .slice(0, 8);
  return {
    videoId,
    title,
    language: transcript.language,
    durationSeconds: transcript.durationSeconds,
    segments: transcript.segments,
    sourceSegmentCount: transcript.sourceSegmentCount,
    characterCount,
    transcriptFingerprint,
    acquisition,
  };
}
