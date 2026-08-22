export type AuthNextSearchParams = { next?: string | string[] };

/**
 * Only the shared-quest preview may be resumed after signing in. Anything
 * else (absolute URLs, protocol-relative URLs, other app routes, traversal)
 * is dropped so `next` can never become an open redirect.
 */
export const AUTH_NEXT_PATTERN = /^\/s\/[0-9a-f-]{1,64}$/i;

export function parseNextPath(params: AuthNextSearchParams): string | null {
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  const value = raw?.trim();
  if (!value || !AUTH_NEXT_PATTERN.test(value)) return null;
  return value;
}

/** Route params for links between the auth screens, keeping `next` alive. */
export function withNextParam(
  params: Record<string, string> | null | undefined,
  next: string | null,
): Record<string, string> | null {
  const merged: Record<string, string> = { ...(params ?? {}) };
  if (next) merged.next = next;
  return Object.keys(merged).length > 0 ? merged : null;
}
