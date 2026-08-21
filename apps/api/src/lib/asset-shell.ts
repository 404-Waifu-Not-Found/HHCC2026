const staticShells = new Map<string, string>([
  ["/", "/index.html"],
  ["/_sitemap", "/_sitemap.html"],
  ["/forgot-password", "/forgot-password.html"],
  ["/library", "/library.html"],
  ["/reset-password", "/reset-password.html"],
  ["/settings", "/settings.html"],
  ["/sign-in", "/sign-in.html"],
  ["/sign-up", "/sign-up.html"],
  ["/verify-email", "/verify-email.html"],
  ["/welcome", "/welcome.html"],
]);

const dynamicShells: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/create\/[^/]+$/, "/create/[videoId].html"],
  [/^\/generation\/[^/]+$/, "/generation/[videoId].html"],
  [/^\/quiz\/[^/]+$/, "/quiz/[attemptId].html"],
];

export function publicAssetShell(pathname: string): string | null {
  const normalizedPath = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return staticShells.get(normalizedPath) ?? dynamicShells.find(([pattern]) => pattern.test(normalizedPath))?.[1] ?? null;
}
