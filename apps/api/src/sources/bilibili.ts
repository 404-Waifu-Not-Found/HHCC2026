import {
  compactTranscriptSegments,
  createTranscriptCompleteness,
} from "@clipquest/contracts";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import type { AudioStream, SourceAdapter, SourceVideo } from "./types";
import { parseBilibiliId } from "./url";

const ViewResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    bvid: z.string(),
    aid: z.number(),
    title: z.string(),
    pic: z.string(),
    duration: z.number(),
    cid: z.number(),
  }),
});

const PlayerResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    subtitle: z
      .object({
        subtitles: z.array(
          z.object({
            lan: z.string(),
            lan_doc: z.string(),
            subtitle_url: z.string(),
            type: z.number().optional(),
          }),
        ),
      })
      .optional(),
  }),
});

const SubtitleResponseSchema = z.object({
  body: z.array(
    z.object({
      from: z.number(),
      to: z.number(),
      content: z.string(),
    }),
  ),
});

const PlayUrlResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    dash: z
      .object({
        audio: z.array(
          z.object({
            baseUrl: z.string().optional(),
            base_url: z.string().optional(),
            bandwidth: z.number().optional(),
          }),
        ),
      })
      .optional(),
    durl: z.array(z.object({ url: z.string() })).optional(),
  }),
});

const BILIBILI_HEADERS = {
  Referer: "https://www.bilibili.com/",
  "User-Agent": "Mozilla/5.0 ClipQuest/1.0",
};
const MAX_BILIBILI_API_BYTES = 2 * 1024 * 1024;
const MAX_BILIBILI_SUBTITLE_BYTES = 8 * 1024 * 1024;

async function readJson(
  response: Response,
  maximumBytes = MAX_BILIBILI_API_BYTES,
): Promise<unknown | null> {
  try {
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > maximumBytes) {
      await response.body?.cancel("response_too_large");
      return null;
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > maximumBytes) return null;
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

async function getView(sourceId: string) {
  const query = sourceId.toLowerCase().startsWith("av")
    ? `aid=${encodeURIComponent(sourceId.slice(2))}`
    : `bvid=${encodeURIComponent(sourceId)}`;
  const response = await fetch(
    `https://api.bilibili.com/x/web-interface/view?${query}`,
    {
      headers: BILIBILI_HEADERS,
    },
  );
  const parsed = ViewResponseSchema.safeParse(await readJson(response));
  if (!response.ok || !parsed.success || parsed.data.code !== 0) {
    throw new ApiError(
      502,
      "bilibili_unavailable",
      "bilibili could not provide this video right now.",
    );
  }
  return parsed.data.data;
}

export class BilibiliAdapter implements SourceAdapter {
  async inspect(url: URL): Promise<SourceVideo> {
    const requestedId = parseBilibiliId(url);
    const view = await getView(requestedId);
    const playerResponse = await fetch(
      `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(view.bvid)}&cid=${view.cid}`,
      { headers: BILIBILI_HEADERS },
    );
    const player = PlayerResponseSchema.safeParse(
      await readJson(playerResponse),
    );
    const subtitles = player.success
      ? (player.data.data.subtitle?.subtitles ?? [])
      : [];

    let preferredCaptionSegments: SourceVideo["preferredCaptionSegments"];
    let preferredCaptionCompleteness: SourceVideo["preferredCaptionCompleteness"];
    const preferred =
      subtitles.find((track) => /^(zh|en)/i.test(track.lan)) ?? subtitles[0];
    if (preferred) {
      try {
        const subtitleUrl = preferred.subtitle_url.startsWith("//")
          ? `https:${preferred.subtitle_url}`
          : preferred.subtitle_url;
        const subtitleResponse = await fetch(subtitleUrl, {
          headers: BILIBILI_HEADERS,
        });
        const parsed = SubtitleResponseSchema.safeParse(
          await readJson(subtitleResponse, MAX_BILIBILI_SUBTITLE_BYTES),
        );
        if (parsed.success) {
          const sourceSegments = parsed.data.body.flatMap((item, index) => {
            const text = item.content.replace(/\s+/g, " ").trim();
            if (!text) return [];
            const startMs = Math.max(0, Math.round(item.from * 1_000));
            return [
              {
                id: `bili-${index + 1}`,
                startMs,
                endMs: Math.max(startMs + 1, Math.round(item.to * 1_000)),
                text,
              },
            ];
          });
          preferredCaptionSegments = compactTranscriptSegments(sourceSegments);
          if (preferredCaptionSegments.length) {
            preferredCaptionCompleteness = createTranscriptCompleteness(
              preferredCaptionSegments,
              view.duration,
              sourceSegments.length,
            );
          }
        }
      } catch (error) {
        console.warn(
          "bilibili captions were listed but could not be loaded",
          error,
        );
      }
    }

    return {
      source: "bilibili",
      sourceVideoId: view.bvid,
      canonicalUrl: `https://www.bilibili.com/video/${view.bvid}`,
      title: view.title,
      thumbnailUrl: view.pic.startsWith("//") ? `https:${view.pic}` : view.pic,
      durationSeconds: Math.max(0, Math.round(view.duration)),
      sourceLanguage: preferred?.lan ?? null,
      captionTracks: subtitles.map((track) => ({
        language: track.lan,
        label: track.lan_doc,
        isAutoGenerated: track.type === 1,
      })),
      ...(preferredCaptionSegments?.length ? { preferredCaptionSegments } : {}),
      ...(preferredCaptionCompleteness ? { preferredCaptionCompleteness } : {}),
    };
  }

  async streamAudio(
    sourceVideoId: string,
    request: Request,
  ): Promise<AudioStream> {
    const view = await getView(sourceVideoId);
    const playResponse = await fetch(
      `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(view.bvid)}&cid=${view.cid}&fnval=16&qn=64`,
      { headers: BILIBILI_HEADERS },
    );
    const play = PlayUrlResponseSchema.safeParse(await readJson(playResponse));
    if (!play.success || play.data.code !== 0) {
      throw new ApiError(
        502,
        "audio_stream_unavailable",
        "The bilibili audio stream could not be prepared.",
      );
    }
    const bestAudio = [...(play.data.data.dash?.audio ?? [])].sort(
      (a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0),
    )[0];
    const mediaUrl =
      bestAudio?.baseUrl ??
      bestAudio?.base_url ??
      play.data.data.durl?.[0]?.url;
    if (!mediaUrl) {
      throw new ApiError(
        502,
        "audio_stream_unavailable",
        "This bilibili video has no usable audio stream.",
      );
    }
    const headers = new Headers(BILIBILI_HEADERS);
    const range = request.headers.get("range");
    if (range) headers.set("Range", range);
    const mediaResponse = await fetch(mediaUrl, { headers });
    if (!mediaResponse.ok || !mediaResponse.body) {
      throw new ApiError(
        502,
        "audio_stream_unavailable",
        "The bilibili audio stream stopped responding.",
      );
    }
    return {
      body: mediaResponse.body,
      contentType: mediaResponse.headers.get("content-type") ?? "audio/mp4",
      ...(mediaResponse.headers.get("content-length")
        ? {
            contentLength:
              mediaResponse.headers.get("content-length") ?? undefined,
          }
        : {}),
      ...(mediaResponse.headers.get("accept-ranges")
        ? {
            acceptRanges:
              mediaResponse.headers.get("accept-ranges") ?? undefined,
          }
        : {}),
      ...(mediaResponse.headers.get("content-range")
        ? {
            contentRange:
              mediaResponse.headers.get("content-range") ?? undefined,
          }
        : {}),
    };
  }
}
