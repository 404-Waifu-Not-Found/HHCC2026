import type { VideoSource } from "@clipquest/contracts";
import { ApiError } from "../lib/errors";

const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const bilibiliHosts = new Set(["bilibili.com", "www.bilibili.com", "m.bilibili.com", "b23.tv"]);

export async function normalizeSourceUrl(raw: string): Promise<{ source: VideoSource; url: URL }> {
  return normalizeSourceUrlWithRedirectLimit(raw, 0);
}

async function normalizeSourceUrlWithRedirectLimit(raw: string, redirectCount: number): Promise<{ source: VideoSource; url: URL }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(422, "unsupported_video_url", "Paste a valid YouTube or bilibili link.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ApiError(422, "unsupported_video_url", "Only web video links are supported.");
  }

  const host = url.hostname.toLowerCase();
  if (host === "b23.tv") {
    if (redirectCount >= 3) {
      throw new ApiError(422, "invalid_bilibili_link", "This bilibili short link redirected too many times.");
    }
    const response = await fetch(url, { redirect: "manual" });
    const location = response.headers.get("location");
    if (!location) throw new ApiError(422, "invalid_bilibili_link", "This bilibili short link could not be resolved.");
    return normalizeSourceUrlWithRedirectLimit(new URL(location, url).toString(), redirectCount + 1);
  }

  if (youtubeHosts.has(host)) return { source: "youtube", url };
  if (bilibiliHosts.has(host)) return { source: "bilibili", url };
  throw new ApiError(422, "unsupported_video_url", "ClipQuest currently supports YouTube and bilibili links.");
}

export function parseYouTubeId(url: URL): string {
  const id = url.hostname === "youtu.be" ? url.pathname.split("/").filter(Boolean)[0] : url.searchParams.get("v");
  if (!id || !/^[a-zA-Z0-9_-]{6,20}$/.test(id)) {
    throw new ApiError(422, "invalid_youtube_link", "This YouTube link does not contain a valid video ID.");
  }
  return id;
}

export function parseBilibiliId(url: URL): string {
  const match = url.pathname.match(/\/video\/(BV[a-zA-Z0-9]+|av\d+)/i);
  if (!match?.[1]) {
    throw new ApiError(422, "invalid_bilibili_link", "This bilibili link does not contain a valid video ID.");
  }
  return match[1];
}
