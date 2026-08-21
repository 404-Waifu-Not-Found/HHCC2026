import type { TranscriptSegment } from "@clipquest/contracts";

const MAX_CAPTION_BYTES = 8 * 1024 * 1024;

type TimedTextPayload = {
  events?: Array<{
    tStartMs?: number;
    dDurationMs?: number;
    segs?: Array<{ utf8?: string }>;
  }>;
};

export function parseYouTubeTimedText(
  payload: TimedTextPayload,
): TranscriptSegment[] {
  const segments = (payload.events ?? [])
    .slice(0, 12_000)
    .map((event, index) => {
      const startMs = Math.max(0, Math.floor(event.tStartMs ?? 0));
      const text = (event.segs ?? [])
        .map((segment) => segment.utf8 ?? "")
        .join("")
        .replaceAll("\n", " ")
        .replace(/\s+/g, " ")
        .trim();
      return {
        id: `youtube-${index}-${startMs}`,
        startMs,
        endMs: startMs + Math.max(1, Math.floor(event.dDurationMs ?? 3_000)),
        text,
      };
    })
    .filter((segment) => segment.text.length > 0);
  const characters = segments.reduce(
    (total, segment) => total + segment.text.length,
    0,
  );
  return characters >= 20 ? segments : [];
}

export async function downloadYouTubeCaptions(
  captionUrl: string,
  signal: AbortSignal,
): Promise<TranscriptSegment[]> {
  const url = new URL(captionUrl);
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "youtube.com" && !url.hostname.endsWith(".youtube.com"))
  ) {
    throw new Error("YouTube returned an invalid caption source.");
  }
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`YouTube caption download failed (${response.status}).`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_CAPTION_BYTES) {
    throw new Error("YouTube captions exceeded the safe size limit.");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_CAPTION_BYTES) {
    throw new Error("YouTube captions exceeded the safe size limit.");
  }
  const segments = parseYouTubeTimedText(JSON.parse(body) as TimedTextPayload);
  if (!segments.length) throw new Error("YouTube returned empty captions.");
  return segments;
}
