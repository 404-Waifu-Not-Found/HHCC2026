const EXTENSION_REQUIRED_ROUTE_PREFIXES = ["/create", "/generation"];

export function routeRequiresClipQuestExtension(pathname: string): boolean {
  if (pathname === "/" || pathname === "/welcome") return true;
  return EXTENSION_REQUIRED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
