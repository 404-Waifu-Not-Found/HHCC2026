(function installYouTubePageBridge() {
  "use strict";

  const REQUEST_EVENT = "clipquest:youtube:tracks-request:v1";
  const RESPONSE_EVENT = "clipquest:youtube:tracks-response:v1";
  let capturedCaption = null;

  function rememberCaption(url, body) {
    if (
      !String(url).includes("/api/timedtext") ||
      typeof body !== "string" ||
      body.length < 10 ||
      body.length > 8 * 1024 * 1024
    ) {
      return;
    }
    let videoId;
    try {
      videoId = new URL(url, location.href).searchParams.get("v");
    } catch {
      return;
    }
    capturedCaption = { videoId, body };
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function clipQuestObservedFetch(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (String(url).includes("/api/timedtext")) {
        void response
          .clone()
          .text()
          .then((body) => rememberCaption(url, body))
          .catch(() => undefined);
      }
    } catch {
      // The player response must remain untouched if observation fails.
    }
    return response;
  };

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function clipQuestObservedOpen(
    method,
    url,
    ...rest
  ) {
    this.__clipQuestCaptionUrl = String(url);
    return originalXhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function clipQuestObservedSend(...args) {
    this.addEventListener("load", function captureCaptionResponse() {
      try {
        if (
          String(this.__clipQuestCaptionUrl).includes("/api/timedtext") &&
          (this.responseType === "" || this.responseType === "text")
        ) {
          rememberCaption(this.__clipQuestCaptionUrl, this.responseText);
        }
      } catch {
        // Ignore response types that cannot expose text.
      }
    });
    return originalXhrSend.apply(this, args);
  };

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function currentPlayerResponse() {
    const player = document.getElementById("movie_player");
    try {
      const response = player?.getPlayerResponse?.();
      if (response) return response;
    } catch {
      // Continue to the page-level response used during initial navigation.
    }
    return globalThis.ytInitialPlayerResponse ?? null;
  }

  function observedDurationSeconds(response) {
    const player = document.getElementById("movie_player");
    const video = document.querySelector("video");
    let playerDuration;
    try {
      playerDuration = player?.getDuration?.();
    } catch {
      playerDuration = undefined;
    }
    const candidates = [
      response?.videoDetails?.lengthSeconds,
      response?.microformat?.playerMicroformatRenderer?.lengthSeconds,
      playerDuration,
      video?.duration,
    ];
    for (const candidate of candidates) {
      const duration = Number(candidate);
      if (Number.isFinite(duration) && duration > 0) {
        return Math.ceil(duration);
      }
    }
    return null;
  }

  function safeTracks(response) {
    const tracks =
      response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks)) return [];
    return tracks.flatMap((track) => {
      if (typeof track?.baseUrl !== "string") return [];
      return [
        {
          baseUrl: track.baseUrl,
          languageCode: track.languageCode,
          kind: track.kind,
          isTranslatable: track.isTranslatable,
          name: track.name,
        },
      ];
    });
  }

  function chooseTrack(tracks, preferredLanguage) {
    const normalized = String(preferredLanguage ?? "")
      .trim()
      .toLowerCase();
    const primary = normalized.split("-")[0];
    return (
      tracks.find(
        (track) => String(track.languageCode).toLowerCase() === normalized,
      ) ??
      tracks.find(
        (track) =>
          primary &&
          String(track.languageCode).toLowerCase().split("-")[0] === primary,
      ) ??
      tracks.find((track) => track.kind !== "asr") ??
      tracks[0] ??
      null
    );
  }

  async function alternatePlayerCaptions(videoId, preferredLanguage) {
    const settings = config();
    if (!settings) {
      throw new Error("YouTube page configuration is unavailable.");
    }
    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(settings.apiKey)}&prettyPrint=false`,
      {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          videoId,
          contentCheckOk: false,
          racyCheckOk: false,
          context: {
            client: {
              clientName: "ANDROID",
              clientVersion: "20.10.38",
              androidSdkVersion: 35,
              hl: "en",
              gl: "US",
            },
          },
        }),
      },
    );
    const playerResponse = await response.json().catch(() => null);
    if (!response.ok || playerResponse?.playabilityStatus?.status !== "OK") {
      throw new Error(
        playerResponse?.playabilityStatus?.reason ??
          `YouTube alternate player request failed (${response.status}).`,
      );
    }
    const tracks = safeTracks(playerResponse);
    const track = chooseTrack(tracks, preferredLanguage);
    if (!track) throw new Error("YouTube did not expose caption tracks.");
    const captionUrl = new URL(track.baseUrl);
    if (
      captionUrl.protocol !== "https:" ||
      captionUrl.hostname !== "www.youtube.com" ||
      captionUrl.pathname !== "/api/timedtext"
    ) {
      throw new Error("YouTube returned an unsafe caption URL.");
    }
    captionUrl.searchParams.set("fmt", "json3");
    const captionResponse = await fetch(captionUrl, {
      cache: "no-store",
      credentials: "omit",
    });
    const body = await captionResponse.text();
    if (!captionResponse.ok || !body.trim()) {
      throw new Error(
        `YouTube alternate captions failed (${captionResponse.status}).`,
      );
    }
    return {
      body,
      tracks,
      durationSeconds: observedDurationSeconds(playerResponse),
    };
  }

  function activatePlayerCaptions(response) {
    const player = document.getElementById("movie_player");
    const track =
      response?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0];
    if (!player || !track) return false;
    try {
      player.setOption?.("captions", "track", {
        languageCode: track.languageCode,
        kind: track.kind ?? "",
        name: track.name?.simpleText ?? track.name?.runs?.[0]?.text ?? "",
      });
    } catch {
      // Clicking the player's CC button below is the compatibility fallback.
    }
    const button = player.querySelector(
      ".ytp-subtitles-button, .ytp-caption-button",
    );
    if (button?.getAttribute("aria-pressed") !== "true") button?.click();
    return true;
  }

  async function capturePlayerCaptionBody(videoId, response) {
    if (capturedCaption?.videoId === videoId) return capturedCaption.body;
    activatePlayerCaptions(response);
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (capturedCaption?.videoId === videoId) return capturedCaption.body;
      await delay(150);
    }
    return null;
  }

  function config() {
    const apiKey = globalThis.ytcfg?.get?.("INNERTUBE_API_KEY");
    const context = globalThis.ytcfg?.get?.("INNERTUBE_CONTEXT");
    if (!apiKey || !context) return null;
    return {
      apiKey,
      context,
      clientName: String(
        globalThis.ytcfg?.get?.("INNERTUBE_CLIENT_NAME") ?? "1",
      ),
      clientVersion: String(
        globalThis.ytcfg?.get?.("INNERTUBE_CLIENT_VERSION") ??
          "2.20240401.00.00",
      ),
      visitorData: globalThis.ytcfg?.get?.("VISITOR_DATA"),
    };
  }

  async function innertubePost(endpoint, payload) {
    const settings = config();
    if (!settings)
      throw new Error("YouTube page configuration is unavailable.");
    const headers = {
      "content-type": "application/json",
      "x-origin": "https://www.youtube.com",
      "x-youtube-client-name": settings.clientName,
      "x-youtube-client-version": settings.clientVersion,
    };
    if (settings.visitorData) {
      headers["x-goog-visitor-id"] = settings.visitorData;
    }
    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/${endpoint}?key=${encodeURIComponent(settings.apiKey)}`,
      {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ context: settings.context, ...payload }),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.error) {
      throw new Error(
        body?.error?.message ??
          `YouTube ${endpoint} request failed (${response.status}).`,
      );
    }
    return body;
  }

  function collectTranscriptParams(
    value,
    output = [],
    depth = 0,
    seen = new WeakSet(),
  ) {
    if (!value || typeof value !== "object" || depth > 14) return output;
    if (seen.has(value)) return output;
    seen.add(value);
    const params = value.getTranscriptEndpoint?.params;
    if (typeof params === "string" && !output.includes(params)) {
      output.push(params);
    }
    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) {
      collectTranscriptParams(child, output, depth + 1, seen);
    }
    return output;
  }

  function toText(value) {
    if (typeof value?.simpleText === "string") return value.simpleText.trim();
    if (!Array.isArray(value?.runs)) return "";
    return value.runs
      .map((run) => run?.text ?? "")
      .join("")
      .trim();
  }

  function timestampSeconds(value) {
    const parts = String(value ?? "")
      .trim()
      .split(":")
      .map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) {
      return parts[0] * 3_600 + parts[1] * 60 + parts[2];
    }
    return null;
  }

  function parseSegmentRenderer(item) {
    const segment = item?.transcriptSegmentRenderer ?? item;
    if (!segment || segment.transcriptSectionHeaderRenderer) return null;
    const numericStart = Number(segment.startMs ?? segment.startTimeMs);
    const startMs = Number.isFinite(numericStart)
      ? numericStart
      : (timestampSeconds(segment.startTimeText?.simpleText) ?? -1) * 1_000;
    const text =
      toText(segment.snippet) || toText(segment.cue) || segment.cue?.simpleText;
    if (!Number.isFinite(startMs) || startMs < 0 || !text?.trim()) return null;
    return { startMs: Math.floor(startMs), text: text.trim() };
  }

  function parseTranscriptResponse(body) {
    const rows = [];
    for (const action of body?.actions ?? []) {
      const renderer =
        action?.updateEngagementPanelAction?.content?.transcriptRenderer;
      if (!renderer) continue;
      const lists = [
        renderer.content?.transcriptSearchPanelRenderer?.body
          ?.transcriptSegmentListRenderer,
        renderer.body?.transcriptSegmentListRenderer,
        renderer.content?.transcriptSegmentListRenderer,
      ].filter(Boolean);
      for (const list of lists) {
        for (const item of list.initialSegments ?? list.segments ?? []) {
          const row = parseSegmentRenderer(item);
          if (row) rows.push(row);
        }
      }
      for (const group of renderer.body?.transcriptBodyRenderer?.cueGroups ??
        []) {
        const cueGroup = group?.transcriptCueGroupRenderer;
        const startSeconds = timestampSeconds(
          cueGroup?.formattedStartOffset?.simpleText,
        );
        const cue = cueGroup?.cues?.[0]?.transcriptCueRenderer?.cue;
        const text = toText(cue);
        if (startSeconds !== null && text) {
          rows.push({ startMs: Math.floor(startSeconds * 1_000), text });
        }
      }
    }
    return rows;
  }

  async function transcriptRows(videoId, playerResponse) {
    const paramsList = [];
    collectTranscriptParams(playerResponse, paramsList);
    collectTranscriptParams(globalThis.ytInitialPlayerResponse, paramsList);
    collectTranscriptParams(globalThis.ytInitialData, paramsList);
    const next = await innertubePost("next", {
      videoId,
      racyCheckOk: false,
      contentCheckOk: false,
    });
    collectTranscriptParams(next, paramsList);
    let lastError;
    for (const params of paramsList) {
      for (const includeVideoId of [true, false]) {
        try {
          const response = await innertubePost("get_transcript", {
            params,
            ...(includeVideoId ? { externalVideoId: videoId } : {}),
          });
          const rows = parseTranscriptResponse(response);
          if (rows.length) return rows;
        } catch (error) {
          lastError = error;
        }
      }
    }
    if (lastError) throw lastError;
    return [];
  }

  document.addEventListener(REQUEST_EVENT, (event) => {
    const requestId = event?.detail?.requestId;
    const videoId = event?.detail?.videoId;
    const preferredLanguage = event?.detail?.preferredLanguage;
    if (typeof requestId !== "string" || !/^[\w-]{11}$/.test(videoId)) return;
    void (async () => {
      const response = currentPlayerResponse();
      let rows = [];
      let transcriptError;
      const [captionResult, transcriptResult, alternateResult] =
        await Promise.allSettled([
          capturePlayerCaptionBody(videoId, response),
          transcriptRows(videoId, response),
          alternatePlayerCaptions(videoId, preferredLanguage),
        ]);
      if (transcriptResult.status === "fulfilled") {
        rows = transcriptResult.value;
      } else {
        transcriptError =
          transcriptResult.reason instanceof Error
            ? transcriptResult.reason.message
            : "YouTube transcript request failed.";
      }
      document.dispatchEvent(
        new CustomEvent(RESPONSE_EVENT, {
          detail: {
            requestId,
            durationSeconds:
              observedDurationSeconds(response) ??
              (alternateResult.status === "fulfilled"
                ? alternateResult.value.durationSeconds
                : null),
            tracks:
              alternateResult.status === "fulfilled"
                ? alternateResult.value.tracks
                : safeTracks(response),
            captionBody:
              alternateResult.status === "fulfilled"
                ? alternateResult.value.body
                : captionResult.status === "fulfilled"
                  ? captionResult.value
                  : undefined,
            transcriptRows: rows,
            transcriptError,
          },
        }),
      );
    })();
  });
})();
