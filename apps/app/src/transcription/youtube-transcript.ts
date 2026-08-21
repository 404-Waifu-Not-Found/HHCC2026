import type { TranscriptSegment } from "@clipquest/contracts";

const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

function parseClock(value: string): number | null {
  const parts = value.split(":").map((part) => Number.parseInt(part, 10));
  if (
    parts.some((part) => !Number.isFinite(part)) ||
    parts.length < 2 ||
    parts.length > 3
  )
    return null;
  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (
    hours === undefined ||
    minutes === undefined ||
    seconds === undefined ||
    seconds > 59
  )
    return null;
  return hours * 3_600 + minutes * 60 + seconds;
}

export function parseBrowserYouTubeTranscript(
  videoId: string,
  markdown: string,
): TranscriptSegment[] {
  const source = markdown.match(/^Source video:\s*(\S+)$/m)?.[1];
  const transcriptStart = markdown.indexOf("## Transcript");
  if (!source || transcriptStart < 0) return [];

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source);
  } catch {
    return [];
  }
  if (
    sourceUrl.hostname !== "www.youtube.com" ||
    sourceUrl.searchParams.get("v") !== videoId
  )
    return [];

  const durationValue = markdown.match(
    /^Language:.*?\bDuration:\s*([0-9:]+)/m,
  )?.[1];
  const declaredDuration = durationValue ? parseClock(durationValue) : null;
  const body = markdown.slice(transcriptStart + "## Transcript".length);
  const timestampPattern =
    /\[(\d{1,3}:[0-5]\d(?::[0-5]\d)?)\]\s*([\s\S]*?)(?=\n+\[\d{1,3}:[0-5]\d(?::[0-5]\d)?\]|\s*$)/g;
  const entries = [...body.matchAll(timestampPattern)].flatMap((match) => {
    const seconds = match[1] ? parseClock(match[1]) : null;
    const text = match[2]?.replace(/\s+/g, " ").trim() ?? "";
    return seconds === null || !text
      ? []
      : [{ startMs: seconds * 1_000, text }];
  });

  return entries.map((entry, index) => {
    const nextStartMs = entries[index + 1]?.startMs;
    const declaredEndMs = (declaredDuration ?? 0) * 1_000;
    return {
      id: `yt-browser-${index + 1}`,
      startMs: entry.startMs,
      endMs: Math.max(
        entry.startMs + 1,
        nextStartMs ??
          (declaredEndMs > entry.startMs
            ? declaredEndMs
            : entry.startMs + 30_000),
      ),
      text: entry.text,
    };
  });
}

export async function fetchBrowserYouTubeTranscript(
  videoId: string,
  signal: AbortSignal,
): Promise<TranscriptSegment[]> {
  const url = new URL(
    `https://youtube-transcript.ai/transcript/${encodeURIComponent(videoId)}.txt`,
  );
  url.searchParams.set("lang", "en");
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/markdown,text/plain;q=0.9" },
      signal,
    });
    if (!response.ok) return [];
    const declaredLength = Number.parseInt(
      response.headers.get("content-length") ?? "",
      10,
    );
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_TRANSCRIPT_BYTES
    )
      return [];
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_TRANSCRIPT_BYTES)
      return [];
    return parseBrowserYouTubeTranscript(videoId, body);
  } catch (error) {
    if (signal.aborted) throw error;
    return [];
  }
}
