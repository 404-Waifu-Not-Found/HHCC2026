import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Innertube } from "youtubei.js";
import {
  createCachedYouTubeSourcePayload,
  YouTubeAdapter,
} from "../src/sources/youtube";

const CONCURRENCY = 3;

type CliOptions = {
  outputDirectory: string;
  playlistId?: string;
  urls: string[];
};

function parseOptions(argv: string[]): CliOptions {
  const urls: string[] = [];
  let outputDirectory = "";
  let playlistId: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") {
      outputDirectory = argv[++index] ?? "";
    } else if (argument === "--playlist") {
      playlistId = argv[++index];
    } else if (argument?.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (argument) {
      urls.push(argument);
    }
  }
  if (!outputDirectory) {
    throw new Error("Usage: --output <directory> [--playlist <id>] [url ...]");
  }
  if (!playlistId && urls.length === 0) {
    throw new Error("Provide at least one YouTube URL or --playlist <id>.");
  }
  return {
    outputDirectory: path.resolve(outputDirectory),
    ...(playlistId ? { playlistId } : {}),
    urls,
  };
}

async function loadPlaylistUrls(playlistId: string): Promise<string[]> {
  const youtube = await Innertube.create({
    lang: "en",
    location: "US",
    retrieve_player: false,
    generate_session_locally: true,
    enable_session_cache: false,
  });
  const playlist = await youtube.getPlaylist(playlistId);
  return playlist.items.flatMap((item) => {
    const sourceVideoId = (item as unknown as { content_id?: unknown })
      .content_id;
    return typeof sourceVideoId === "string"
      ? [`https://www.youtube.com/watch?v=${sourceVideoId}`]
      : [];
  });
}

async function cacheSource(
  url: string,
  outputDirectory: string,
): Promise<{ sourceVideoId: string; segmentCount: number; file: string }> {
  const startedAt = Date.now();
  const source = await new YouTubeAdapter().inspect(new URL(url));
  const payload = createCachedYouTubeSourcePayload(source);
  const file = path.join(outputDirectory, `${source.sourceVideoId}.json`);
  const temporaryFile = `${file}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(payload)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryFile, file);
  const segmentCount = source.preferredCaptionSegments?.length ?? 0;
  console.info(
    JSON.stringify({
      scope: "youtube_cache_warmer",
      event: "source.completed",
      sourceVideoId: source.sourceVideoId,
      segmentCount,
      elapsedMs: Date.now() - startedAt,
    }),
  );
  return { sourceVideoId: source.sourceVideoId, segmentCount, file };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  await mkdir(options.outputDirectory, { recursive: true, mode: 0o700 });
  const playlistUrls = options.playlistId
    ? await loadPlaylistUrls(options.playlistId)
    : [];
  const urls = [...new Set([...options.urls, ...playlistUrls])];
  const results: Array<Awaited<ReturnType<typeof cacheSource>>> = [];
  const failures: Array<{ url: string; errorName: string }> = [];
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, async () => {
      for (;;) {
        const index = nextIndex++;
        const url = urls[index];
        if (!url) return;
        try {
          results.push(await cacheSource(url, options.outputDirectory));
        } catch (error) {
          failures.push({
            url,
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          console.error(
            JSON.stringify({
              scope: "youtube_cache_warmer",
              event: "source.failed",
              url,
              errorName: error instanceof Error ? error.name : "UnknownError",
            }),
          );
        }
      }
    }),
  );

  console.info(
    JSON.stringify({
      scope: "youtube_cache_warmer",
      event: "run.completed",
      requestedCount: urls.length,
      completedCount: results.length,
      failedCount: failures.length,
      outputDirectory: options.outputDirectory,
    }),
  );
  if (failures.length > 0) process.exitCode = 1;
}

await main();
