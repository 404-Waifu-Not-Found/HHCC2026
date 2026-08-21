import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(
  fileURLToPath(
    new URL("../dist/clipquest-captions-extension", import.meta.url),
  ),
);
const profile = await mkdtemp(join(tmpdir(), "clipquest-extension-smoke-"));
const appOrigin = process.env.CLIPQUEST_ORIGIN ?? "http://localhost:8081";
const videoId = process.env.CLIPQUEST_YOUTUBE_VIDEO_ID;

const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${extensionRoot}`,
    `--load-extension=${extensionRoot}`,
  ],
});

if (process.env.CLIPQUEST_LIVE_DEBUG === "1") {
  context.on("page", (candidate) => {
    candidate.on("domcontentloaded", () => {
      if (!candidate.url().includes("youtube.com/watch")) return;
      setTimeout(() => {
        void candidate
          .evaluate(() => ({
            title: document.title,
            body: document.body?.innerText?.slice(0, 2_000),
            transcriptPanels: document.querySelectorAll(
              '[target-id*="transcript"], ytd-transcript-search-panel-renderer',
            ).length,
            transcriptRows: document.querySelectorAll(
              "transcript-segment-view-model, ytd-transcript-segment-renderer",
            ).length,
            descriptionTranscripts: Array.from(
              document.querySelectorAll(
                "ytd-video-description-transcript-section-renderer",
              ),
            ).map((element) => ({
              text: element.textContent?.trim().slice(0, 300),
              html: element.outerHTML.slice(0, 500),
            })),
            transcriptButtons: Array.from(document.querySelectorAll("button"))
              .filter((button) =>
                /transcript/i.test(
                  `${button.getAttribute("aria-label")} ${button.textContent}`,
                ),
              )
              .map((button) => ({
                label: button.getAttribute("aria-label"),
                text: button.textContent?.trim(),
              })),
          }))
          .then((diagnostics) =>
            console.log("YouTube diagnostics:", diagnostics),
          )
          .catch(() => undefined);
      }, 4_000);
    });
  });
}

try {
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  await page.goto(appOrigin, { waitUntil: "domcontentloaded" });
  const ready = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const timeout = setTimeout(() => {
          window.removeEventListener("message", receive);
          resolve(null);
        }, 5_000);
        function receive(event) {
          if (
            event.source !== window ||
            event.data?.channel !== "clipquest:captions:v1" ||
            event.data?.source !== "clipquest-extension" ||
            event.data?.type !== "ready"
          ) {
            return;
          }
          clearTimeout(timeout);
          window.removeEventListener("message", receive);
          resolve(event.data.version ?? "unknown");
        }
        window.addEventListener("message", receive);
        window.postMessage(
          {
            channel: "clipquest:captions:v1",
            source: "clipquest-website",
            type: "ping",
          },
          window.location.origin,
        );
      }),
  );
  if (!ready)
    throw new Error("The extension did not answer the website handshake.");
  console.log(`Website handshake succeeded with extension ${ready}.`);

  await page.waitForTimeout(1_500);
  const installGateVisible = await page
    .getByRole("heading", { name: "Install ClipQuest Captions" })
    .isVisible()
    .catch(() => false);
  if (installGateVisible) {
    throw new Error(
      "The production install gate stayed open after the extension connected.",
    );
  }
  console.log("The website install gate cleared automatically.");

  if (videoId) {
    const result = await page.evaluate(
      ({ requestedVideoId }) =>
        new Promise((resolve, reject) => {
          const requestId = `live-${Date.now()}`;
          const timeout = setTimeout(() => {
            window.removeEventListener("message", receive);
            reject(new Error("Live caption extraction timed out."));
          }, 65_000);
          function receive(event) {
            if (
              event.source !== window ||
              event.data?.channel !== "clipquest:captions:v1" ||
              event.data?.source !== "clipquest-extension" ||
              event.data?.type !== "result" ||
              event.data?.requestId !== requestId
            ) {
              return;
            }
            clearTimeout(timeout);
            window.removeEventListener("message", receive);
            if (!event.data.response?.ok) {
              reject(
                new Error(
                  event.data.response?.error ?? "Caption extraction failed.",
                ),
              );
              return;
            }
            resolve(event.data.response.result);
          }
          window.addEventListener("message", receive);
          window.postMessage(
            {
              channel: "clipquest:captions:v1",
              source: "clipquest-website",
              type: "extract",
              requestId,
              videoId: requestedVideoId,
              preferredLanguage: "en",
            },
            window.location.origin,
          );
        }),
      { requestedVideoId: videoId },
    );
    if (
      !result ||
      result.videoId !== videoId ||
      !Array.isArray(result.segments) ||
      result.segments.length === 0
    ) {
      throw new Error("The live extension returned an invalid transcript.");
    }
    console.log(
      `Extracted ${result.segments.length} ${result.language} caption segments (${result.isAutoGenerated === true ? "auto-generated" : result.isAutoGenerated === false ? "human-authored" : "generation type unavailable"}) via ${result.method}.`,
    );
  }
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
