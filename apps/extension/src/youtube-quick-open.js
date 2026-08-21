(function installClipQuestQuickOpen() {
  "use strict";

  const BUTTON_ID = "clipquest-quick-open";
  const CLIPQUEST_ORIGIN = "https://clipquest.ccwu.cc";
  const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
  let scheduled = false;

  function currentVideoId() {
    try {
      const url = new URL(location.href);
      if (
        url.pathname !== "/watch" ||
        (url.hostname !== "youtube.com" &&
          !url.hostname.endsWith(".youtube.com"))
      ) {
        return null;
      }
      const videoId = url.searchParams.get("v");
      return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
    } catch {
      return null;
    }
  }

  function clipQuestUrl(videoId) {
    const destination = new URL("/welcome", CLIPQUEST_ORIGIN);
    destination.searchParams.set(
      "url",
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    );
    return destination.href;
  }

  function actionMount() {
    return (
      document.querySelector("#top-level-buttons-computed") ??
      document.querySelector("#actions-inner") ??
      document.querySelector("#actions")
    );
  }

  function createButton() {
    const link = document.createElement("a");
    link.id = BUTTON_ID;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Open this video in ClipQuest");

    const mark = document.createElement("img");
    mark.className = "clipquest-quick-open__mark";
    mark.src = chrome.runtime.getURL("icons/icon-48.png");
    mark.alt = "";
    mark.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "clipquest-quick-open__label";
    label.textContent = "Open in ClipQuest";

    link.append(mark, label);
    return link;
  }

  function syncButton() {
    const videoId = currentVideoId();
    const existing = document.getElementById(BUTTON_ID);
    if (!videoId) {
      existing?.remove();
      return;
    }

    const mount = actionMount();
    if (!mount) return;
    const link = existing ?? createButton();
    link.href = clipQuestUrl(videoId);
    if (link.parentElement !== mount) mount.prepend(link);
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      syncButton();
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
    } else {
      setTimeout(run, 0);
    }
  }

  document.addEventListener("yt-navigate-finish", scheduleSync);
  window.addEventListener("popstate", scheduleSync);
  new MutationObserver(() => {
    if (!document.getElementById(BUTTON_ID)) scheduleSync();
  }).observe(document.documentElement, { childList: true, subtree: true });
  scheduleSync();
})();
