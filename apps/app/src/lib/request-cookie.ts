export function readNativeAuthCookie(platform: string, getCookie: () => string): string | undefined {
  return platform === "web" ? undefined : getCookie() || undefined;
}
