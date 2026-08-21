import type { VideoSource } from "@clipquest/contracts";
import { ApiError } from "../lib/errors";

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

export async function normalizeSourceUrl(
  raw: string,
): Promise<{ source: VideoSource; url: URL }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(
      422,
      "unsupported_video_url",
      "Paste a valid YouTube link.",
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ApiError(
      422,
      "unsupported_video_url",
      "Only YouTube web links are supported.",
    );
  }

  const host = url.hostname.toLowerCase();
  if (youtubeHosts.has(host)) return { source: "youtube", url };
  throw new ApiError(
    422,
    "unsupported_video_url",
    "ClipQuest supports public YouTube links only.",
  );
}

export function parseYouTubeId(url: URL): string {
  const pathId = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
  const id =
    url.hostname === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : (url.searchParams.get("v") ?? pathId);
  if (!id || !/^[a-zA-Z0-9_-]{6,20}$/.test(id)) {
    throw new ApiError(
      422,
      "invalid_youtube_link",
      "This YouTube link does not contain a valid video ID.",
    );
  }
  return id;
}
