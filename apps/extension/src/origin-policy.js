export const CLIPQUEST_PAGE_ORIGINS = new Set([
  "https://clipquest.ccwu.cc",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://localhost:19006",
  "http://127.0.0.1:19006",
]);

export function isClipQuestPageOrigin(rawUrl) {
  try {
    return CLIPQUEST_PAGE_ORIGINS.has(new URL(rawUrl).origin);
  } catch {
    return false;
  }
}
