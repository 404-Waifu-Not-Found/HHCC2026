export function usesNativeAuthCookies(platform: string): boolean {
  return platform !== "web";
}

export function readNativeAuthCookie(
  platform: string,
  getCookie: () => string,
): string | undefined {
  return usesNativeAuthCookies(platform) ? getCookie() || undefined : undefined;
}
