import type { VideoSource } from "@clipquest/contracts";
import { BilibiliAdapter } from "./bilibili";
import type { SourceAdapter } from "./types";
import { YouTubeAdapter } from "./youtube";

const adapters: Record<VideoSource, SourceAdapter> = {
  youtube: new YouTubeAdapter(),
  bilibili: new BilibiliAdapter(),
};

export function getSourceAdapter(source: VideoSource): SourceAdapter {
  return adapters[source];
}

export * from "./types";
export * from "./url";

