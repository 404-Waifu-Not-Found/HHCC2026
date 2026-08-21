const staticShells = new Map<string, string>([
  ["/", "/index.html"],
  ["/_sitemap", "/_sitemap.html"],
  ["/admin", "/admin/index.html"],
  ["/admin/audit", "/admin/audit.html"],
  ["/admin/jobs", "/admin/jobs.html"],
  ["/admin/lessons", "/admin/lessons.html"],
  ["/admin/system", "/admin/system.html"],
  ["/admin/users", "/admin/users.html"],
  ["/forgot-password", "/forgot-password.html"],
  ["/library", "/library.html"],
  ["/reset-password", "/reset-password.html"],
  ["/settings", "/settings.html"],
  ["/sign-in", "/sign-in.html"],
  ["/sign-up", "/sign-up.html"],
  ["/verify-email", "/verify-email.html"],
  ["/welcome", "/welcome.html"],
]);

const dynamicShells: readonly (readonly [RegExp, string])[] = [
  [/^\/create\/[^/]+$/, "/create/[videoId].html"],
  [/^\/generation\/[^/]+$/, "/generation/[videoId].html"],
  [/^\/quiz\/[^/]+$/, "/quiz/[attemptId].html"],
];

export function publicAssetShell(pathname: string): string | null {
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return (
    staticShells.get(normalizedPath) ??
    dynamicShells.find(([pattern]) => pattern.test(normalizedPath))?.[1] ??
    null
  );
}

export function preventStaleAppShell(
  response: Response,
  workerVersion?: PublicWorkerVersion,
): Response {
  const headers = new Headers(response.headers);
  // The HTML shell points at a content-hashed JavaScript bundle. Never keep an
  // old shell in the browser after a deploy, or it can continue loading an old
  // bundle even though the new assets are already live.
  headers.set("Cache-Control", "no-store");
  if (workerVersion) {
    headers.set("X-ClipQuest-Worker-Version", workerVersion.versionId);
    if (workerVersion.versionTag) {
      headers.set("X-ClipQuest-Worker-Tag", workerVersion.versionTag);
    } else {
      headers.delete("X-ClipQuest-Worker-Tag");
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
import type { PublicWorkerVersion } from "./worker-version";
