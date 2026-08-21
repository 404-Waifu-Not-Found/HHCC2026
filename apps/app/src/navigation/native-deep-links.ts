export type NativeDeepLinkRoute =
  | "/(auth)/sign-in"
  | "/(auth)/forgot-password"
  | `/(auth)/reset-password?${string}`
  | `/(auth)/verify-email?${string}`
  | "/(tabs)/library"
  | `/quiz/${string}`;

export function createRecentNativeEventGate(windowMs = 1_500) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("Native event deduplication requires a positive window.");
  }
  let lastKey: string | undefined;
  let lastHandledAt = Number.NEGATIVE_INFINITY;
  return (key: string, handledAt = Date.now()): boolean => {
    const elapsed = handledAt - lastHandledAt;
    const immediateDuplicate =
      key === lastKey && elapsed >= 0 && elapsed < windowMs;
    if (immediateDuplicate) return false;
    lastKey = key;
    lastHandledAt = handledAt;
    return true;
  };
}

export function nativeRouteForUrl(rawUrl: string): NativeDeepLinkRoute | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const customScheme = url.protocol === "clipquest:";
  const webLink =
    url.protocol === "https:" && url.hostname === "clipquest.ccwu.cc";
  if (!customScheme && !webLink) return null;

  const rawPath = customScheme
    ? url.pathname === "/" || url.pathname === ""
      ? url.hostname
      : url.pathname
    : url.pathname;
  const path = `/${rawPath.replace(/^\/+/, "")}`.replace(/\/$/, "");

  if (path === "/sign-in") return "/(auth)/sign-in";
  if (path === "/forgot-password") return "/(auth)/forgot-password";
  if (path === "/library") return "/(tabs)/library";
  if (path === "/reset-password") {
    if (!webLink) return null;
    const query = new URLSearchParams();
    for (const name of ["token", "error"]) {
      const value = url.searchParams.get(name);
      if (value) query.set(name, value);
    }
    return `/(auth)/reset-password?${query.toString()}`;
  }
  if (path === "/verify-email") {
    const query = new URLSearchParams();
    const email = url.searchParams.get("email");
    if (email) query.set("email", email);
    return `/(auth)/verify-email?${query.toString()}`;
  }
  const quiz = path.match(/^\/quiz\/([0-9a-f-]+)$/i);
  return quiz ? `/quiz/${quiz[1]}` : null;
}
