export const CLIPQUEST_PAGE_ORIGINS = new Set(["https://clipquest.ccwu.cc"]);

export function isClipQuestPageOrigin(rawUrl) {
  try {
    return CLIPQUEST_PAGE_ORIGINS.has(new URL(rawUrl).origin);
  } catch {
    return false;
  }
}
